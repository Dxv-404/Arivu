"""
rate_limiter.py — Rate limiting for all API calls, inbound and outbound.

CoordinatedRateLimiter:  Controls calls to external APIs (S2, OpenAlex, ...).
                         Prevents hitting upstream rate limits.
ArivuRateLimiter:        Controls inbound calls to Arivu endpoints per session.
                         Prevents resource exhaustion by any single user.

Both use an in-memory sliding-window counter. They do NOT persist across
server restarts — this is intentional: limits are per-process, not per-cluster.
"""
import asyncio
import logging
import time
from collections import defaultdict

logger = logging.getLogger(__name__)

# ─── External-API Throttle ───────────────────────────────────────────────────


class _SlidingWindow:
    """Thread-safe sliding-window counter for one (source, session) pair."""

    __slots__ = ("limit", "window_seconds", "timestamps", "_lock")

    def __init__(self, limit: int, window_seconds: int):
        self.limit = limit
        self.window_seconds = window_seconds
        self.timestamps: list[float] = []
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        """Block until a request slot is available."""
        async with self._lock:
            now = time.time()
            cutoff = now - self.window_seconds
            self.timestamps = [t for t in self.timestamps if t > cutoff]

            if len(self.timestamps) >= self.limit:
                # Wait until the oldest timestamp leaves the window
                wait_until = self.timestamps[0] + self.window_seconds
                await asyncio.sleep(wait_until - now + 0.01)
                now = time.time()
                cutoff = now - self.window_seconds
                self.timestamps = [t for t in self.timestamps if t > cutoff]

            self.timestamps.append(time.time())

    def is_available(self) -> bool:
        now = time.time()
        cutoff = now - self.window_seconds
        active = [t for t in self.timestamps if t > cutoff]
        return len(active) < self.limit


class CoordinatedRateLimiter:
    """
    Per-source sliding-window limiter for all external API calls.

    Rates are conservative to stay well under upstream limits.
    Backoff is applied when a 429 is received from any source.

    Usage:
        rate_limiter = CoordinatedRateLimiter()
        await rate_limiter.throttle("semantic_scholar")
        response = await http_client.get(...)
    """

    # (requests, window_seconds) per external source
    LIMITS: dict[str, tuple[int, int]] = {
        "semantic_scholar": (9, 1),       # S2: 10 req/s with key -> use 9
        "openalex":         (9, 1),       # OA: 10 req/s with email header
        "crossref":         (45, 1),      # CrossRef: 50 req/s polite pool
        "arxiv":            (3, 1),       # arXiv: be polite (3/s)
        "europepmc":        (9, 1),
        "core":             (9, 1),
        "unpaywall":        (9, 1),
        "base":             (1, 1),       # BASE: 60 req/min -> 1/s
        "pubpeer":          (2, 1),       # PubPeer: conservative 2/s
        "groq":             (90, 1),      # Groq: 100 req/min on free tier
    }

    def __init__(self):
        # Per-source sliding windows
        self._windows: dict[str, _SlidingWindow] = {
            src: _SlidingWindow(limit, window)
            for src, (limit, window) in self.LIMITS.items()
        }
        # Tracks when a source was rate-limited (backoff until)
        self._backoff_until: dict[str, float] = {}
        self._backoff_lock = asyncio.Lock()

    async def throttle(self, source: str):
        """
        Async function: acquires a rate-limit slot before returning.

        Usage:
            await rate_limiter.throttle("semantic_scholar")
            response = await http_client.get(...)
        """
        # Check backoff
        async with self._backoff_lock:
            until = self._backoff_until.get(source, 0)
            if until > time.time():
                wait = until - time.time()
                logger.debug(f"Backing off {source} for {wait:.1f}s")
                await asyncio.sleep(wait)

        window = self._windows.get(source)
        if window:
            await window.acquire()

    async def record_rate_limit(self, source: str, retry_after: int = 30) -> None:
        """Call when a 429 is received from an external API."""
        async with self._backoff_lock:
            self._backoff_until[source] = time.time() + retry_after
        logger.warning(f"External 429 from {source} — backing off {retry_after}s")


# ─── Inbound Arivu Rate Limiter ───────────────────────────────────────────────


class ArivuRateLimiter:
    """
    Per-session sliding-window limiter for Arivu's own API endpoints.

    Keyed by (session_id, endpoint). Prevents any one session from exhausting
    external API quota or running thousands of LLM calls.

    check() is called by the require_rate_limit() decorator in app.py.
    It returns (allowed, headers). If allowed=False, return 429 immediately.
    """

    # endpoint_key -> (max_requests, window_seconds)
    LIMITS: dict[str, tuple[int, int]] = {
        "GET /api/graph/stream":  (3,  3600),  # 3 graph builds per hour
        "POST /api/search":       (30, 60),    # 30 searches per minute
        "POST /api/prune":        (60, 60),    # 60 prune ops per minute
        "POST /api/chat":         (20, 60),    # 20 chat messages per minute
        "POST /api/upload":       (5,  3600),  # 5 PDF uploads per hour
        "GET /api/dna":           (20, 60),
        "GET /api/diversity":     (20, 60),
        "GET /api/orphans":       (10, 60),
        "GET /api/export":        (10, 3600),
        # Phase 5 — export + intelligence endpoints
        "POST /api/export":       (10, 3600),  # 10 exports/hour — storage intensive
        "GET /api/living-score":  (30, 60),    # 30/minute — computed from DB
        "GET /api/originality":   (20, 60),    # 20/minute — embedding lookups
        "GET /api/paradigm":      (10, 60),    # 10/minute — heavier computation
        # Phase 6 — auth + intelligence + billing
        "GET /api/independent-discovery": (5,  60),
        "GET /api/citation-shadow":       (10, 60),
        "GET /api/field-fingerprint":     (10, 60),
        "GET /api/serendipity":           (5,  60),
        "POST /api/billing/checkout":     (3,  60),
        "POST /api/account/export-data":  (2,  3600),
        "POST /api/account/delete":       (3,  3600),
        "GET /api/account/api-keys":      (20, 60),
        "GET /api/graph-memory":          (30, 60),
        "POST /api/graph-memory":         (20, 60),
        # Anonymous graph build limit: 5 fresh builds per hour per session
        "POST /api/graph/stream":         (5,  3600),
    }

    def __init__(self):
        # (session_id, endpoint) -> list[timestamp]
        self._windows: dict[tuple[str, str], list[float]] = defaultdict(list)
        self._lock = asyncio.Lock()

    async def check(
        self, session_id: str, endpoint: str
    ) -> tuple[bool, dict[str, str]]:
        """
        Returns (allowed, rate_limit_headers).
        Mutates the window if allowed (records this request).
        """
        if endpoint not in self.LIMITS:
            return True, {}

        max_req, window_secs = self.LIMITS[endpoint]
        key = (session_id, endpoint)

        async with self._lock:
            now = time.time()
            cutoff = now - window_secs
            self._windows[key] = [t for t in self._windows[key] if t > cutoff]
            count = len(self._windows[key])
            remaining = max_req - count
            reset_at = int(cutoff + window_secs)

            headers = {
                "X-RateLimit-Limit":     str(max_req),
                "X-RateLimit-Remaining": str(max(0, remaining - 1)),
                "X-RateLimit-Reset":     str(reset_at),
                "X-RateLimit-Window":    str(window_secs),
            }

            if count >= max_req:
                retry_after = int(self._windows[key][0] + window_secs - now) + 1
                headers["Retry-After"] = str(retry_after)
                return False, headers

            self._windows[key].append(now)
            return True, headers

    def check_sync(self, session_id: str, endpoint: str) -> tuple[bool, dict]:
        """Synchronous wrapper around async check() for Flask route handlers."""
        import asyncio as _asyncio
        try:
            loop = _asyncio.get_event_loop()
            if loop.is_running():
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                    return pool.submit(_asyncio.run, self.check(session_id, endpoint)).result()
            return loop.run_until_complete(self.check(session_id, endpoint))
        except Exception:
            return True, {}  # fail-open on errors

    def get_429_response(self, headers: dict) -> dict:
        """Alias for get_429_body() — used by Phase 3+ routes."""
        return self.get_429_body(headers)

    def get_429_body(self, headers: dict) -> dict:
        return {
            "error": "rate_limit_exceeded",
            "message": (
                f"Rate limit exceeded. Retry after "
                f"{headers.get('Retry-After', 60)} seconds."
            ),
            "retry_after": int(headers.get("Retry-After", 60)),
        }


# ─── Module-level singletons — imported by app.py ────────────────────────────
coordinated_rate_limiter = CoordinatedRateLimiter()
arivu_rate_limiter = ArivuRateLimiter()

# Adjust S2 rate limit based on API key availability.
# Without an API key, S2 enforces ~1 req/s (not 10 req/s).
try:
    from backend.config import config as _cfg
    if not _cfg.S2_API_KEY:
        coordinated_rate_limiter._windows["semantic_scholar"] = _SlidingWindow(1, 1)
except Exception:
    pass  # Config not loaded yet — will use default 9 req/s
