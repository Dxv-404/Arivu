# PHASE 2 — Data Layer, NLP Worker & Graph Build Pipeline
## Version 2 — Authoritative implementation spec (gap-resolved)

<!--
  GAP RESOLUTION LOG (v1 → v2)
  All gaps identified in the pre-implementation review have been fixed inline.
  Each fix is annotated with a [FIX: Gap N] comment at the point of change.
  Gaps that were determined INVALID after deeper analysis are noted below.

  Gap 1  FIXED  — rate_limiter.py: throttle() docstring corrected (await, not async with)
  Gap 2  FIXED  — session_manager.py: FLASK_DEBUG_MODE → os.environ FLASK_DEBUG
  Gap 3  FIXED  — nlp_pipeline.py: nx.pagerank() computed once, not per-edge
  Gap 4  FIXED  — app.py: cached graph None guard added before streaming
  Gap 5  FIXED  — rate_limiter.py: ArivuRateLimiter key "POST /api/graph/stream" → "GET"
  Gap 6  FIXED  — app.py: paper_id normalized before cache lookup
  Gap 7  FIXED  — app.py: build_jobs stores canonical ID, not raw user input
  Gap 8  FIXED  — nlp_worker/app.py: require_auth applied via FastAPI Depends
  Gap 9  FIXED  — Spec: GET /api/graph/<paper_id> added to deliverables + Done When
  Gap 10 INVALID — OPENALEX_EMAIL already in Phase 1 .env.example; no change needed
  Gap 11 INVALID — session_graphs table exists in Phase 1 migration; no change needed
  Gap 12 NOTE   — job_events id vs sequence: both columns exist (id=PK, sequence=order);
                   usage in Phase 2 is correct; documented in §9 comments
  Gap 13 INVALID — Paper.from_db_row() defined in Phase 1 models.py; no change needed
  Gap 14 FIXED  — CLAUDE.md content defined in §20 (new section)
  Gap 15 FIXED  — graph_engine.py: dead sklearn import removed
  Gap 16 NOTED  — NLI pipeline deferred by design; rationale documented in §8
  Gap 17 NOTED  — Full-text extraction deferred to Phase 3; documented in §18
  Gap 18 FIXED  — app.py: SSE cleanup added for abandoned clients
  Gap 19 FIXED  — graph_engine.py: graphs INSERT now includes max_depth,
                   coverage_score, coverage_report, build_time_seconds
  Gap 20 NOTE   — complete spec §5.11 says "inheritance_confidence" in one diagram but
                   Phase 1 migration SQL (authoritative) uses "base_confidence".
                   Phase 2 code is correct. Discrepancy noted in §20.
  Gap 21 FIXED  — graph_engine.py: paper_embeddings populated during BFS crawl
  Gap 22 FIXED  — api_client.py: _fetch_s2_batch() now includes "references" field
  Gap 23 FIXED  — NLP_WORKER_TIMEOUT=90 added to §13 .env.example; timeout docs added §19
  Gap 24 NOTE   — complete spec uses "groq_llm" in one section, "groq" elsewhere.
                   Phase 2 consistently uses "groq" in both LIMITS and throttle() calls.
                   Documented in §20.
  Gap 25 FIXED  — conftest.py + pytest.ini updates added to §15
  Gap 26 FIXED  — api_client.py: _save_to_cache() ON CONFLICT now resets created_at
-->

## Before You Start
1. Read `CLAUDE.md` — see §20 of this file if it does not yet exist; create it first.
2. Read `CONTEXT.md` — verify Phase 1 is marked **Completed** before continuing.
3. This file is the **only** spec you need right now. Do not open `PHASE_3.md`.
4. **Phase 1 must be complete.** Run `python -m pytest tests/test_smoke.py -v` — all 3 must pass.
5. The NLP worker runs as a **separate process** on port 7860. See §27 for startup instructions.

---

## What Phase 2 Produces
When this phase is complete:
- `backend/api_client.py` — SmartPaperResolver fetches real paper data from Semantic Scholar
- `backend/normalizer.py` — `normalize_user_input()` handles DOI / arXiv / S2 URL / title inputs
- `backend/deduplicator.py` — `PaperDeduplicator` merges multi-source records into one canonical `Paper`
- `backend/rate_limiter.py` — `CoordinatedRateLimiter` + `ArivuRateLimiter` fully implemented
- `backend/r2_client.py` — `R2Client` wraps boto3 S3-compatible calls to Cloudflare R2
- `backend/session_manager.py` — real `SessionManager` with DB-backed anonymous sessions
- `backend/nlp_pipeline.py` — `InheritanceDetector` orchestrates NLP worker calls (no model loading)
- `backend/graph_engine.py` — `AncestryGraph` builds full BFS graph, runs NLP analysis, exports JSON
- `nlp_worker/app.py` — FastAPI NLP microservice with `/encode_batch`, `/similarity_matrix`, `/health`
- `app.py` — adds `POST /api/search`, `GET /api/graph/stream`, and `GET /api/graph/<paper_id>` routes
- `scripts/test_pipeline.py` — end-to-end integration test: resolves a paper, builds a graph
- `tests/test_phase2.py` — pytest suite covering normalizer, deduplicator, session, rate limiter

<!-- [FIX: Gap 9] GET /api/graph/<paper_id> was missing from this list in v1. -->

Nothing else. No pruning, no DNA profiler, no frontend HTML, no LLM genealogy story.

---

## Files Changed / Created

### Modified (real implementation replaces stub)
```
backend/rate_limiter.py          ← stub → real
backend/r2_client.py             ← stub → real
backend/session_manager.py       ← stub → real
backend/normalizer.py            ← stub → real
backend/deduplicator.py          ← stub → real
backend/api_client.py            ← stub → real
backend/nlp_pipeline.py          ← stub → real
backend/graph_engine.py          ← stub → real
nlp_worker/app.py                ← stub → real
scripts/test_pipeline.py         ← stub → real
app.py                           ← add /api/search, /api/graph/stream, /api/graph/<paper_id>
.env.example                     ← add Phase 2 vars
pytest.ini                       ← add asyncio_mode = auto
```

### New files
```
tests/test_phase2.py
CLAUDE.md                        ← see §20 for content
```

### Unchanged (do not touch)
```
backend/config.py
backend/db.py
backend/models.py
backend/schemas.py
backend/utils.py
exceptions.py
scripts/migrate.py
tests/test_smoke.py
```

---

## Architecture Reminder — Service Boundary

The **main Koyeb server** (`app.py` + `backend/`) may **never** import:
- `sentence_transformers`
- `torch`
- Any ML model loading library

These live **exclusively** in `nlp_worker/app.py`.

The main server calls the NLP worker over HTTP with `httpx.AsyncClient`. The NLP worker URL comes from `config.NLP_WORKER_URL` (default `http://localhost:7860` for local dev).

```
app.py (Flask, Koyeb)
  └── backend/nlp_pipeline.py  → HTTP → nlp_worker/app.py (FastAPI, HuggingFace Spaces)
                                              └── SentenceTransformer model
```

Violating this boundary will cause the Koyeb server to OOM on startup.

---

## §1 — nlp_worker/app.py

Full implementation of the NLP microservice. Replaces the Phase 1 stub.

```python
"""
nlp_worker/app.py — NLP microservice for Arivu.

Deployed on HuggingFace Spaces (free CPU tier, persistent).
Main API calls this over HTTP — the model NEVER loads on the main server.

Auth: Every request (except /health) must include:
    Authorization: Bearer {NLP_WORKER_SECRET}
The secret is stored as a HuggingFace Space secret and in .env locally.

Endpoints:
    POST /encode_batch       — encode a batch of texts to embeddings
    POST /similarity_matrix  — compute sentence-pair similarity matrix
    GET  /health             — no auth required
"""
import os
import time
import logging
from functools import wraps

import numpy as np
from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(title="Arivu NLP Worker", version="1.0.0")

# ─── Model — loaded once at startup ──────────────────────────────────────────
# all-MiniLM-L6-v2: 22M params, 384-dim output, fast on CPU.
# Load time: ~3-5 seconds. Stays resident in memory.
logger.info("Loading SentenceTransformer model...")
_start = time.time()
MODEL = SentenceTransformer("all-MiniLM-L6-v2")
logger.info(f"Model loaded in {time.time() - _start:.1f}s")

# ─── Auth ─────────────────────────────────────────────────────────────────────
NLP_WORKER_SECRET = os.environ.get("NLP_WORKER_SECRET", "")


def require_auth(f):
    """
    Decorator: validate Bearer token matches NLP_WORKER_SECRET.

    NOTE: FastAPI uses dependency injection (Depends) rather than decorators
    for request-level auth. This decorator is retained for documentation and
    non-FastAPI testing purposes. Protected endpoints use _auth_dependency
    (a Depends-compatible equivalent) which enforces the same logic via
    FastAPI's DI system. See _auth_dependency below.
    """
    @wraps(f)
    async def wrapper(request: Request, *args, **kwargs):
        if NLP_WORKER_SECRET:
            auth = request.headers.get("Authorization", "")
            token = auth.removeprefix("Bearer ").strip()
            if token != NLP_WORKER_SECRET:
                raise HTTPException(status_code=401, detail="Invalid NLP worker secret")
        return await f(request, *args, **kwargs)
    return wrapper


# [FIX: Gap 8] require_auth was defined but never applied. FastAPI endpoints
# require Depends-based injection rather than raw decorators (decorators cannot
# intercept FastAPI's Pydantic body injection). _auth_dependency is the
# Depends-compatible equivalent and is applied to all protected endpoints.
async def _auth_dependency(request: Request) -> None:
    """
    FastAPI dependency: validate Bearer token.
    Applied to all endpoints except /health via Depends(_auth_dependency).
    Raises HTTP 401 if NLP_WORKER_SECRET is set and token does not match.
    """
    if NLP_WORKER_SECRET:
        auth = request.headers.get("Authorization", "")
        token = auth.removeprefix("Bearer ").strip()
        if token != NLP_WORKER_SECRET:
            raise HTTPException(status_code=401, detail="Invalid NLP worker secret")


# ─── Request / Response models ────────────────────────────────────────────────

class EncodeBatchRequest(BaseModel):
    texts: list[str]          # Up to 512 texts per call
    normalize: bool = True    # L2-normalize embeddings (required for cosine sim)


class SimilarityMatrixRequest(BaseModel):
    texts_a: list[str]        # Sentences from paper A (citing)
    texts_b: list[str]        # Sentences from paper B (cited)


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    """Health check — no auth required. Called by main app on startup."""
    return {
        "status": "ok",
        "model": "all-MiniLM-L6-v2",
        "dimensions": 384,
    }


@app.post("/encode_batch")
async def encode_batch(
    body: EncodeBatchRequest,
    _auth: None = Depends(_auth_dependency),   # [FIX: Gap 8]
):
    """
    Encode a batch of texts. Returns embeddings as list[list[float]].

    Limits:
        Max 512 texts per call.
        Each text is truncated to 256 tokens by the model (SentenceTransformer default).

    Performance (CPU):
        ~3000 sentences (300 papers × 10 sentences) in ~60 seconds.
        Split large batches into 512-chunk calls.
    """
    if not body.texts:
        return {"embeddings": [], "model": "all-MiniLM-L6-v2", "dimensions": 384}

    if len(body.texts) > 512:
        raise HTTPException(
            status_code=400,
            detail=f"Max 512 texts per batch. Received {len(body.texts)}."
        )

    try:
        t0 = time.time()
        embeddings = MODEL.encode(
            body.texts,
            normalize_embeddings=body.normalize,
            batch_size=64,
            show_progress_bar=False,
        )
        elapsed = time.time() - t0
        logger.info(f"encode_batch: {len(body.texts)} texts in {elapsed:.2f}s")

        return {
            "embeddings": embeddings.tolist(),
            "model": "all-MiniLM-L6-v2",
            "dimensions": 384,
            "count": len(body.texts),
        }
    except Exception as e:
        logger.error(f"encode_batch error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Encoding failed: {str(e)}")


@app.post("/similarity_matrix")
async def similarity_matrix(
    body: SimilarityMatrixRequest,
    _auth: None = Depends(_auth_dependency),   # [FIX: Gap 8]
):
    """
    Compute pairwise cosine similarity between two sentence lists.

    Returns the full matrix plus the highest-scoring pair — used by
    InheritanceDetector.stage1_similarity() to find the best-matching
    sentence pair between a citing and cited paper.

    Both lists are capped at 50 sentences (enforced server-side).
    """
    if not body.texts_a or not body.texts_b:
        raise HTTPException(status_code=400, detail="Both texts_a and texts_b must be non-empty")

    # Server-side cap: 50 × 50 max matrix
    a = body.texts_a[:50]
    b = body.texts_b[:50]

    try:
        emb_a = MODEL.encode(a, normalize_embeddings=True, show_progress_bar=False)
        emb_b = MODEL.encode(b, normalize_embeddings=True, show_progress_bar=False)

        # Matrix multiplication gives cosine similarity when both are L2-normalized
        matrix = (emb_a @ emb_b.T).tolist()

        # Find maximum pair
        best_score = -1.0
        best_i, best_j = 0, 0
        for i, row in enumerate(matrix):
            for j, score in enumerate(row):
                if score > best_score:
                    best_score = score
                    best_i, best_j = i, j

        return {
            "matrix": matrix,
            "max_pair": {
                "idx_a": best_i,
                "idx_b": best_j,
                "score": float(best_score),
                "sentence_a": a[best_i],
                "sentence_b": b[best_j],
            },
            "shape": [len(a), len(b)],
        }
    except Exception as e:
        logger.error(f"similarity_matrix error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Similarity computation failed: {str(e)}")


# ─── Error handler ────────────────────────────────────────────────────────────

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled exception in NLP worker: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"error": "internal_error", "detail": str(exc)},
    )
```

### Running the NLP worker locally
```bash
# Terminal 2 (separate from Flask)
cd nlp_worker
pip install -r requirements.txt
NLP_WORKER_SECRET=your_secret_here uvicorn app:app --host 0.0.0.0 --port 7860 --reload
# Health check: curl http://localhost:7860/health
```

HuggingFace Spaces deployment: see `nlp_worker/README.md`.

---

## §2 — backend/rate_limiter.py

Replaces the Phase 1 stub. Two classes:
- `CoordinatedRateLimiter` — sliding-window throttle for each **external** API source (S2, OpenAlex, etc.)
- `ArivuRateLimiter` — sliding-window throttle for each **Arivu** API endpoint, keyed by session

```python
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

    # [FIX: Gap 1] v1 docstring incorrectly showed "async with rate_limiter.throttle(...)".
    # throttle() is a plain async def, not a context manager. Correct usage is:
    #   await rate_limiter.throttle("source_name")
    """

    # (requests, window_seconds) per external source
    # [FIX: Gap 24 NOTE] The complete spec §5.10 uses the key "groq_llm" in one diagram
    # and "groq" elsewhere. Phase 2 consistently uses "groq" throughout rate_limiter.py
    # and nlp_pipeline.py. If the complete spec is updated to unify on "groq_llm",
    # rename this key and update all throttle("groq") calls in nlp_pipeline.py to match.
    LIMITS: dict[str, tuple[int, int]] = {
        "semantic_scholar": (9, 1),       # S2: 10 req/s with key → use 9
        "openalex":         (9, 1),       # OA: 10 req/s with email header
        "crossref":         (45, 1),      # CrossRef: 50 req/s polite pool
        "arxiv":            (3, 1),       # arXiv: be polite (3/s)
        "europepmc":        (9, 1),
        "core":             (9, 1),
        "unpaywall":        (9, 1),
        "base":             (1, 1),       # BASE: 60 req/min → 1/s
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

        # [FIX: Gap 1] This is NOT a context manager. Do not use "async with".
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

    # endpoint_key → (max_requests, window_seconds)
    # [FIX: Gap 5] v1 had "POST /api/graph/stream" — the route is GET, not POST.
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
    }

    def __init__(self):
        # (session_id, endpoint) → list[timestamp]
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
```

---

## §3 — backend/r2_client.py

Replaces the Phase 1 stub. Wraps boto3 for Cloudflare R2 (S3-compatible).

```python
"""
r2_client.py — Cloudflare R2 object storage client.

R2 is S3-compatible. We use boto3 with a custom endpoint_url.
Credentials come exclusively from Config (environment variables).

Key naming conventions (never deviate from these):
    graphs/{graph_id}.json         — built graph JSON for D3.js
    full_text/{paper_id}.txt       — extracted full text (section-structured)
    exports/{session_id}/{name}    — generated export files
    precomputed/{slug}.json        — pre-built gallery graphs
"""
import json
import logging
from typing import Optional

import boto3
from botocore.exceptions import ClientError

from exceptions import StorageError

logger = logging.getLogger(__name__)


class R2Client:
    """
    Cloudflare R2 object storage wrapper.

    Instantiated once per process. The Config object is passed in so this
    class never reads os.environ directly.
    """

    def __init__(self, config):
        """
        Args:
            config: the Config singleton from backend/config.py
        """
        self._bucket = config.R2_BUCKET_NAME
        self._enabled = config.R2_ENABLED

        if not self._enabled:
            logger.warning(
                "R2 credentials not configured — R2Client running in no-op mode. "
                "Graph caching disabled."
            )
            self._client = None
            return

        self._client = boto3.client(
            "s3",
            endpoint_url=(
                f"https://{config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
            ),
            aws_access_key_id=config.R2_ACCESS_KEY_ID,
            aws_secret_access_key=config.R2_SECRET_ACCESS_KEY,
            region_name="auto",
        )
        logger.info(f"R2Client initialized — bucket: {self._bucket}")

    # ─── Core operations ─────────────────────────────────────────────────────

    def put(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
        """Upload bytes. Silently skips if R2 is not configured."""
        if not self._enabled:
            return
        try:
            self._client.put_object(
                Bucket=self._bucket,
                Key=key,
                Body=data,
                ContentType=content_type,
            )
            logger.debug(f"R2 PUT {key} ({len(data)} bytes)")
        except ClientError as e:
            raise StorageError("upload", key, str(e)) from e

    def get(self, key: str) -> Optional[bytes]:
        """
        Download and return bytes, or None if the key does not exist.
        Returns None (not raises) on missing key — callers check None.
        """
        if not self._enabled:
            return None
        try:
            response = self._client.get_object(Bucket=self._bucket, Key=key)
            return response["Body"].read()
        except ClientError as e:
            code = e.response["Error"]["Code"]
            if code in ("NoSuchKey", "404"):
                return None
            raise StorageError("download", key, str(e)) from e

    def exists(self, key: str) -> bool:
        """Return True if the key exists. Returns False if R2 not configured."""
        if not self._enabled:
            return False
        try:
            self._client.head_object(Bucket=self._bucket, Key=key)
            return True
        except ClientError as e:
            if e.response["Error"]["Code"] in ("404", "NoSuchKey"):
                return False
            raise StorageError("exists", key, str(e)) from e

    def delete(self, key: str) -> None:
        """Delete a key. Silently skips if R2 not configured or key missing."""
        if not self._enabled:
            return
        try:
            self._client.delete_object(Bucket=self._bucket, Key=key)
        except ClientError as e:
            raise StorageError("delete", key, str(e)) from e

    # ─── JSON convenience methods ─────────────────────────────────────────────

    def put_json(self, key: str, data: dict) -> None:
        """Serialize dict to UTF-8 JSON and upload as application/json."""
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.put(key, payload, content_type="application/json")

    def get_json(self, key: str) -> Optional[dict]:
        """Download and deserialize JSON. Returns None if key missing."""
        raw = self.get(key)
        if raw is None:
            return None
        return json.loads(raw.decode("utf-8"))

    # ─── Text convenience methods ─────────────────────────────────────────────

    def put_text(self, key: str, text: str) -> None:
        """Upload a UTF-8 text string."""
        self.put(key, text.encode("utf-8"), content_type="text/plain; charset=utf-8")

    def get_text(self, key: str) -> Optional[str]:
        """Download a UTF-8 text string. Returns None if key missing."""
        raw = self.get(key)
        if raw is None:
            return None
        return raw.decode("utf-8")
```

---

## §4 — backend/session_manager.py

Replaces the Phase 1 pass-through stub. Full DB-backed anonymous sessions.

```python
"""
session_manager.py — Anonymous session management.

Sessions are the identity mechanism for users without accounts.
A session is created automatically on first request and persists for
SESSION_DURATION_DAYS via a secure httpOnly cookie.

Cookie name:    arivu_session
Cookie flags:   HttpOnly, Secure (HTTPS only), SameSite=Lax, Path=/
DB table:       sessions (session_id, created_at, last_seen, persona, graph_memory)

The require_session decorator is imported by app.py and applied to every
route that needs a session. It sets g.session_id and g.session_response
so downstream code can read the session ID.

IMPORTANT: set_cookie() must be called on the response AFTER the route handler
returns. This is done via after_this_request() — see _attach_cookie_if_new().
"""
import logging
import os
import secrets
from functools import wraps

from flask import after_this_request, g, request

import backend.db as db

logger = logging.getLogger(__name__)

SESSION_COOKIE_NAME = "arivu_session"
SESSION_DURATION_DAYS = 365
_SESSION_MAX_AGE = SESSION_DURATION_DAYS * 24 * 3600


class SessionManager:
    """
    Creates and validates anonymous sessions backed by the sessions table.
    """

    def create_session(self) -> str:
        """Create a new anonymous session. Returns the session_id."""
        session_id = secrets.token_urlsafe(32)
        db.execute(
            """
            INSERT INTO sessions (session_id, created_at, last_seen, persona, graph_memory)
            VALUES (%s, NOW(), NOW(), 'explorer', '{}'::jsonb)
            """,
            (session_id,),
        )
        logger.debug(f"Created session: {session_id[:8]}…")
        return session_id

    def get_session(self, session_id: str) -> bool:
        """
        Validate that session_id exists in the DB and update last_seen.
        Returns True if valid, False if not.
        """
        if not session_id or len(session_id) > 64:
            return False
        row = db.fetchone(
            "SELECT session_id FROM sessions WHERE session_id = %s",
            (session_id,),
        )
        if not row:
            return False
        db.execute(
            "UPDATE sessions SET last_seen = NOW() WHERE session_id = %s",
            (session_id,),
        )
        return True

    def require_session(self) -> str:
        """
        Get the session_id from the cookie, validating it against the DB.
        If missing or invalid, create a new session.
        Schedules a Set-Cookie header on the response if a new session was created.
        Returns the valid session_id.
        """
        existing = request.cookies.get(SESSION_COOKIE_NAME)
        is_valid = self.get_session(existing) if existing else False

        if is_valid:
            return existing

        # Create new session
        new_id = self.create_session()

        # [FIX: Gap 2] v1 used request.environ.get("FLASK_DEBUG_MODE", False) which
        # reads a key that Flask never sets, always returning False → secure=True even
        # in local HTTP dev, breaking session cookies. The correct source is the
        # FLASK_DEBUG environment variable (set to "1" in local .env).
        is_debug = os.environ.get("FLASK_DEBUG", "0") == "1"

        @after_this_request
        def _set_cookie(response):
            response.set_cookie(
                SESSION_COOKIE_NAME,
                new_id,
                max_age=_SESSION_MAX_AGE,
                httponly=True,
                secure=not is_debug,   # HTTPS-only in production; allow HTTP in dev
                samesite="Lax",
                path="/",
            )
            return response

        return new_id


# Module-level singleton
_manager = SessionManager()


def require_session(f):
    """
    Route decorator: ensures g.session_id is set before the handler runs.
    Creates a new session automatically if the cookie is absent or invalid.

    Usage in app.py:
        @app.route("/api/search", methods=["POST"])
        @require_session
        def search_papers():
            session_id = g.session_id
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        g.session_id = _manager.require_session()
        return f(*args, **kwargs)
    return decorated
```

---

## §5 — backend/normalizer.py

Replaces the Phase 1 stub. Parses any user-supplied paper identifier.

```python
"""
normalizer.py — Input normalization for paper identifiers.

Any reasonable way a user might paste a paper reference is handled here.
Returns (canonical_id, id_type) where id_type drives the resolver strategy.

Also exports split_into_sentences() used by the NLP pipeline.
"""
import re
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# ─── ID type constants ────────────────────────────────────────────────────────
ID_TYPE_DOI      = "doi"
ID_TYPE_ARXIV    = "arxiv"
ID_TYPE_S2       = "s2"
ID_TYPE_PUBMED   = "pubmed"
ID_TYPE_OPENALEX = "openalex"
ID_TYPE_TITLE    = "title"


def normalize_user_input(user_input: str) -> tuple[str, str]:
    """
    Parse any paper identifier the user might provide.

    Supported formats:
        DOI:       10.1234/example  |  https://doi.org/10.1234/example  |  doi:10.1234/example
        arXiv:     1706.03762  |  2303.08774v2  |  https://arxiv.org/abs/1706.03762
        S2:        https://www.semanticscholar.org/paper/Title/abc123def456...
        PubMed:    https://pubmed.ncbi.nlm.nih.gov/12345678/  |  bare 7-9 digit number
        OpenAlex:  W2741809807
        Title:     Anything else (free text title search)

    Returns:
        (canonical_id, id_type)
        canonical_id is stripped, lowercased where appropriate, and prefix-free.
    """
    text = user_input.strip()
    if not text:
        return "", ID_TYPE_TITLE

    # ── arXiv URL formats ────────────────────────────────────────────────────
    for pattern in [
        r"arxiv\.org/abs/(\d{4}\.\d{4,5}(?:v\d+)?)",
        r"arxiv\.org/pdf/(\d{4}\.\d{4,5}(?:v\d+)?)",
    ]:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            return _clean_arxiv(m.group(1)), ID_TYPE_ARXIV

    # ── Bare arXiv ID (YYMM.NNNNN or YYMM.NNNNNvN) ──────────────────────────
    m = re.match(r"^(\d{4}\.\d{4,5}(?:v\d+)?)$", text)
    if m:
        return _clean_arxiv(m.group(1)), ID_TYPE_ARXIV

    # ── Semantic Scholar URL ─────────────────────────────────────────────────
    m = re.search(r"semanticscholar\.org/paper/[^/]+/([a-f0-9]{40})", text, re.IGNORECASE)
    if m:
        return m.group(1).lower(), ID_TYPE_S2

    # ── Bare S2 corpus ID (40-char hex) ──────────────────────────────────────
    if re.match(r"^[0-9a-f]{40}$", text, re.IGNORECASE):
        return text.lower(), ID_TYPE_S2

    # ── DOI — various prefix forms ────────────────────────────────────────────
    for prefix in [
        "https://doi.org/",
        "http://doi.org/",
        "https://dx.doi.org/",
        "http://dx.doi.org/",
        "doi:",
        "DOI:",
        "DOI: ",
    ]:
        if text.lower().startswith(prefix.lower()):
            return text[len(prefix):].strip(), ID_TYPE_DOI

    # ── Bare DOI (always starts with 10.) ────────────────────────────────────
    if re.match(r"^10\.\d{4,9}/\S+$", text):
        return text, ID_TYPE_DOI

    # ── PubMed URL ───────────────────────────────────────────────────────────
    m = re.search(r"pubmed\.ncbi\.nlm\.nih\.gov/(\d{6,9})", text, re.IGNORECASE)
    if m:
        return m.group(1), ID_TYPE_PUBMED

    # ── Bare PubMed ID (7-9 digits) ──────────────────────────────────────────
    if re.match(r"^\d{7,9}$", text):
        return text, ID_TYPE_PUBMED

    # ── OpenAlex Work ID ─────────────────────────────────────────────────────
    if re.match(r"^W\d{6,}$", text):
        return text, ID_TYPE_OPENALEX

    # ── Fallback: title search ────────────────────────────────────────────────
    return text, ID_TYPE_TITLE


def _clean_arxiv(raw: str) -> str:
    """
    Normalize an arXiv ID. Strip version suffix (vN) for canonical lookup.
    The resolver queries by base ID; S2 handles version disambiguation.
    """
    base = raw.split("v")[0]   # "2303.08774v2" → "2303.08774"
    return base


# ─── Text splitting ───────────────────────────────────────────────────────────

# Sentence boundary patterns for academic text
_SENTENCE_END = re.compile(
    r'(?<=[.!?])\s+'           # Standard sentence boundary
    r'(?=[A-Z])',               # Followed by capital letter
)

# Section header patterns (don't split on these)
_SECTION_HEADER = re.compile(
    r'^\s*(abstract|introduction|related\s+work|background|methods?|'
    r'approach|model|architecture|results?|experiments?|evaluation|'
    r'discussion|conclusion|acknowledgments?)\s*$',
    re.IGNORECASE | re.MULTILINE,
)


def split_into_sentences(text: str, max_sentences: int = 50) -> list[str]:
    """
    Split academic text into sentences, respecting common paper patterns.

    Used by InheritanceDetector to prepare inputs for the /similarity_matrix
    NLP worker endpoint. Capped at max_sentences to prevent oversized calls.

    Returns a list of non-empty sentence strings.
    """
    if not text or not text.strip():
        return []

    # Remove section headers (they pollute similarity scores)
    text = _SECTION_HEADER.sub(" ", text)

    # Split on sentence boundaries
    sentences = _SENTENCE_END.split(text)

    # Clean each sentence
    result = []
    for s in sentences:
        s = s.strip()
        if s and len(s) > 15:   # Ignore very short fragments
            result.append(s)
        if len(result) >= max_sentences:
            break

    return result if result else [text[:500]]   # Fallback: return truncated text
```

---

## §6 — backend/deduplicator.py

Replaces the Phase 1 stub. Merges multi-source records into one canonical `Paper`.

```python
"""
deduplicator.py — PaperDeduplicator: canonical paper record construction.

The same paper may be returned by Semantic Scholar, OpenAlex, and CrossRef
with different IDs and slightly different metadata. This module resolves them
into a single authoritative Paper instance using field-level priority rules
defined in §5.3 of ARIVU_COMPLETE_SPEC_v3.md.

The S2 corpus ID is always the canonical paper_id. If S2 did not return a
record, the paper cannot be used (we need a stable graph node identifier).
"""
import logging
import re
from difflib import SequenceMatcher

from backend.models import Paper

logger = logging.getLogger(__name__)

# Field-level priority rules (spec §5.3).
# Earlier source in the list wins if it has a non-None value.
_FIELD_PRIORITY: dict[str, list[str]] = {
    "title":          ["crossref", "s2", "openalex", "core"],
    "year":           ["crossref", "s2", "openalex"],
    "authors":        ["s2", "openalex", "crossref"],
    "venue":          ["crossref", "s2", "openalex"],
    "doi":            ["crossref", "s2", "openalex"],
    "citation_count": ["s2"],      # Only S2 has reliable citation counts
    "url":            ["s2", "openalex"],
}

_STOP_WORDS = frozenset({
    "a", "an", "the", "of", "and", "or", "for",
    "in", "on", "with", "to", "from", "by",
})


class PaperDeduplicator:
    """
    Merges candidate records from multiple sources into one canonical Paper.

    Each candidate is a raw dict tagged with a "_source" key (e.g. "s2",
    "openalex", "crossref"). The SmartPaperResolver passes these dicts here
    before returning a Paper to the rest of the app.
    """

    def merge(self, candidates: list[dict]) -> Paper:
        """
        Given ≥1 raw dicts representing the same paper (from different sources),
        return a single canonical Paper dataclass.

        The S2 corpus ID is required. If no candidate has an "s2_id" key,
        raises ValueError.
        """
        if not candidates:
            raise ValueError("PaperDeduplicator.merge() called with empty candidates list")

        if len(candidates) == 1:
            return self._build_paper(candidates[0], candidates)

        return self._build_paper(self._pick_fields(candidates), candidates)

    def _pick_fields(self, candidates: list[dict]) -> dict:
        """Apply field-level priority rules across all candidates."""
        merged: dict = {}

        for field, priority in _FIELD_PRIORITY.items():
            for source in priority:
                value = next(
                    (c.get(field) for c in candidates
                     if c.get("_source") == source and c.get(field) is not None),
                    None,
                )
                if value is not None:
                    merged[field] = value
                    break

        # Abstract: take the longest non-null string across all sources
        abstracts = [
            (c.get("abstract", "") or "", c.get("_source", ""))
            for c in candidates
            if c.get("abstract")
        ]
        if abstracts:
            best, src = max(abstracts, key=lambda x: len(x[0]))
            merged["abstract"] = best
            merged["abstract_source"] = src

        # References: union across all sources, deduplicated by DOI
        all_refs: list[dict] = []
        seen_dois: set[str] = set()
        for c in candidates:
            for ref in c.get("references", []):
                doi = ref.get("doi")
                if doi:
                    if doi in seen_dois:
                        continue
                    seen_dois.add(doi)
                all_refs.append(ref)
        merged["references"] = all_refs

        # S2 paper_id is the canonical ID — required
        s2_id = next(
            (c.get("s2_id") or c.get("paper_id")
             for c in candidates
             if c.get("_source") == "s2"),
            None,
        )
        if s2_id:
            merged["paper_id"] = s2_id

        # Collect all known external IDs
        merged["source_ids"] = {}
        for c in candidates:
            src = c.get("_source", "unknown")
            if src == "s2":
                merged["source_ids"]["s2"] = c.get("s2_id") or c.get("paper_id")
            elif src == "openalex":
                merged["source_ids"]["openalex"] = c.get("openalex_id")
            elif src == "crossref":
                merged["source_ids"]["crossref_doi"] = c.get("doi")
            elif src == "arxiv":
                merged["source_ids"]["arxiv"] = c.get("arxiv_id")

        merged["sources_queried"] = [c.get("_source") for c in candidates]
        return merged

    def _build_paper(self, merged: dict, candidates: list[dict]) -> Paper:
        """Construct a Paper dataclass from a merged dict."""
        paper_id = merged.get("paper_id")
        if not paper_id:
            raise ValueError(
                "Cannot build Paper without a Semantic Scholar corpus ID. "
                f"Sources queried: {[c.get('_source') for c in candidates]}"
            )

        return Paper(
            paper_id=paper_id,
            title=merged.get("title", "Unknown Title"),
            abstract=merged.get("abstract"),
            year=merged.get("year"),
            citation_count=merged.get("citation_count", 0) or 0,
            fields_of_study=merged.get("fields_of_study") or [],
            authors=merged.get("authors") or [],
            doi=merged.get("doi"),
            url=merged.get("url") or "",
            text_tier=4,              # Set by full-text fetching step, default title-only
            is_retracted=merged.get("is_retracted", False),
            language=merged.get("language", "en"),
            source_ids=merged.get("source_ids", {}),
            venue=merged.get("venue"),
        )

    @staticmethod
    def titles_match(title_a: str, title_b: str, threshold: float = 0.92) -> bool:
        """
        Return True if two titles are likely the same paper.
        Uses normalized sequence similarity (strips stop words and punctuation).
        Threshold 0.92 is deliberately high to avoid false merges.
        """
        def normalize(t: str) -> str:
            t = re.sub(r"[^\w\s]", "", t.lower())
            return " ".join(w for w in t.split() if w not in _STOP_WORDS)

        a, b = normalize(title_a), normalize(title_b)
        if not a or not b:
            return False
        return SequenceMatcher(None, a, b).ratio() >= threshold
```

---

## §7 — backend/api_client.py

Replaces the Phase 1 stub. SmartPaperResolver fetches from multiple sources in priority order.

```python
"""
api_client.py — SmartPaperResolver: paper data from multiple academic APIs.

Architecture:
    SmartPaperResolver.resolve(paper_id, id_type) → Paper
    SmartPaperResolver.resolve_batch(paper_ids) → list[Paper]
    SmartPaperResolver.get_references(paper_id, limit) → list[Paper]
    SmartPaperResolver.search_papers(query, limit) → list[Paper]

Source priority for metadata (spec §5.3):
    Title / year / DOI / venue: CrossRef > S2 > OpenAlex
    Abstract: longest of (S2, OpenAlex reconstructed)
    References: UNION(S2, OpenAlex) deduplicated by DOI
    Citation count: S2 only
    Full text: arXiv PDF > Europe PMC > CORE > Unpaywall

All HTTP calls go through CoordinatedRateLimiter to respect upstream limits.
All calls are async. Flask routes use await_sync() to bridge sync/async.

Caching:
    Resolved papers are cached in the papers table by paper_id.
    Cache TTL is 30 days (field-dependent per spec §5.11). Embeddings cached separately.
"""
import asyncio
import json
import logging
import time
from typing import Optional

import httpx

import backend.db as db
from backend.config import config
from backend.deduplicator import PaperDeduplicator
from backend.models import Paper
from backend.normalizer import (
    ID_TYPE_ARXIV, ID_TYPE_DOI, ID_TYPE_OPENALEX,
    ID_TYPE_PUBMED, ID_TYPE_S2, ID_TYPE_TITLE,
)
from backend.rate_limiter import coordinated_rate_limiter
from exceptions import (
    ExternalAPIError, ExternalAPIRateLimitError,
    NoAbstractError, PaperNotFoundError, PaperResolutionError,
)

logger = logging.getLogger(__name__)

_DEDUP = PaperDeduplicator()

# Semantic Scholar fields we always request
_S2_FIELDS = (
    "paperId,title,abstract,year,citationCount,fieldsOfStudy,"
    "authors,externalIds,url,references"
)

# Semantic Scholar batch fields — must include "references" for BFS expansion.
# [FIX: Gap 22] v1 omitted "references" from batch fetch. Without it, batch-fetched
# papers (all depth-2+ nodes) had no children and BFS was artificially shallow.
_S2_BATCH_FIELDS = (
    "paperId,title,abstract,year,citationCount,fieldsOfStudy,"
    "authors,externalIds,url,references"
)

# OpenAlex fields
_OA_FIELDS = (
    "id,title,abstract_inverted_index,publication_year,"
    "cited_by_count,authorships,primary_location,doi,concepts,"
    "referenced_works,best_oa_location"
)


class SmartPaperResolver:
    """
    Fetches and merges paper metadata from multiple academic APIs.

    Usage:
        resolver = SmartPaperResolver()
        paper = await resolver.resolve("1706.03762", "arxiv")
        refs   = await resolver.get_references(paper.paper_id, limit=50)
    """

    def __init__(self):
        self._http: Optional[httpx.AsyncClient] = None

    async def _client(self) -> httpx.AsyncClient:
        """Lazy-initialize the shared HTTP client."""
        if self._http is None or self._http.is_closed:
            self._http = httpx.AsyncClient(
                timeout=httpx.Timeout(30.0, connect=5.0),
                headers={"User-Agent": "Arivu/1.0 (research tool; contact@arivu.dev)"},
                follow_redirects=True,
            )
        return self._http

    async def close(self):
        if self._http and not self._http.is_closed:
            await self._http.aclose()

    # ─── Public API ──────────────────────────────────────────────────────────

    async def resolve(self, identifier: str, id_type: str) -> Paper:
        """
        Resolve any paper identifier to a canonical Paper.
        Checks DB cache first, fetches from APIs if missing or stale.

        Raises PaperNotFoundError if the paper cannot be found in any source.
        Raises PaperResolutionError if API calls fail.
        """
        # Translate non-S2 IDs to S2 corpus ID first
        s2_id = await self._to_s2_id(identifier, id_type)
        if not s2_id:
            raise PaperNotFoundError(identifier)

        # Check DB cache
        cached = self._load_from_cache(s2_id)
        if cached:
            logger.debug(f"Cache hit: {s2_id[:8]}…")
            return cached

        # Fetch from S2 (primary)
        s2_data = await self._fetch_s2(s2_id)
        if not s2_data:
            raise PaperNotFoundError(s2_id)

        candidates = [s2_data]

        # Fetch from OpenAlex (for abstract + concept enrichment)
        doi = s2_data.get("doi")
        if doi:
            oa_data = await self._fetch_openalex_by_doi(doi)
            if oa_data:
                candidates.append(oa_data)

        # Merge and build Paper
        paper = _DEDUP.merge(candidates)

        # Assign text tier based on available text
        paper.text_tier = 3 if paper.abstract else 4

        # Persist to DB cache
        self._save_to_cache(paper)

        return paper

    async def resolve_batch(self, paper_ids: list[str]) -> list[Paper]:
        """
        Resolve multiple S2 corpus IDs in parallel (up to 500 per S2 batch call).
        Returns successfully resolved papers (silently drops failed ones).
        """
        if not paper_ids:
            return []

        # Split into chunks of 500 (S2 batch limit)
        chunks = [paper_ids[i:i+500] for i in range(0, len(paper_ids), 500)]
        all_papers = []

        for chunk in chunks:
            # Check DB cache for each ID
            cached_ids = set()
            for pid in chunk:
                cached = self._load_from_cache(pid)
                if cached:
                    all_papers.append(cached)
                    cached_ids.add(pid)

            missing = [p for p in chunk if p not in cached_ids]
            if not missing:
                continue

            # Batch fetch from S2
            fetched = await self._fetch_s2_batch(missing)
            for data in fetched:
                try:
                    paper = _DEDUP.merge([data])
                    paper.text_tier = 3 if paper.abstract else 4
                    self._save_to_cache(paper)
                    all_papers.append(paper)
                except Exception as e:
                    logger.debug(f"Could not build Paper from batch result: {e}")

        return all_papers

    async def get_references(self, s2_paper_id: str, limit: int = 100) -> list[Paper]:
        """
        Return the referenced papers for a given S2 paper ID.
        Returns up to `limit` reference records (lightweight, title/year/ID only).
        Used by AncestryGraph.build_graph() for BFS expansion.
        """
        client = await self._client()
        url = f"https://api.semanticscholar.org/graph/v1/paper/{s2_paper_id}/references"
        params = {
            "fields": "paperId,title,abstract,year,citationCount,externalIds",
            "limit": min(limit, 100),
        }
        headers = {}
        if config.S2_API_KEY:
            headers["x-api-key"] = config.S2_API_KEY

        await coordinated_rate_limiter.throttle("semantic_scholar")
        try:
            resp = await client.get(url, params=params, headers=headers)
            if resp.status_code == 429:
                await coordinated_rate_limiter.record_rate_limit("semantic_scholar")
                return []
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPStatusError as e:
            logger.warning(f"S2 references fetch failed for {s2_paper_id}: {e}")
            return []

        refs: list[Paper] = []
        for item in data.get("data", []):
            cited = item.get("citedPaper", {})
            if not cited.get("paperId") or not cited.get("title"):
                continue
            refs.append(Paper(
                paper_id=cited["paperId"],
                title=cited["title"],
                abstract=cited.get("abstract"),
                year=cited.get("year"),
                citation_count=cited.get("citationCount", 0) or 0,
                doi=(cited.get("externalIds") or {}).get("DOI"),
                url=f"https://www.semanticscholar.org/paper/{cited['paperId']}",
                text_tier=3 if cited.get("abstract") else 4,
            ))

        return refs

    async def search_papers(self, query: str, limit: int = 8) -> list[Paper]:
        """
        Title-based search. Returns up to `limit` candidates for disambiguation UI.
        """
        client = await self._client()
        url = "https://api.semanticscholar.org/graph/v1/paper/search"
        params = {
            "query": query,
            "fields": "paperId,title,abstract,year,citationCount,authors,externalIds",
            "limit": limit,
        }
        headers = {}
        if config.S2_API_KEY:
            headers["x-api-key"] = config.S2_API_KEY

        await coordinated_rate_limiter.throttle("semantic_scholar")
        try:
            resp = await client.get(url, params=params, headers=headers)
            if resp.status_code == 429:
                await coordinated_rate_limiter.record_rate_limit("semantic_scholar")
                return []
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPStatusError as e:
            logger.warning(f"S2 search failed for '{query}': {e}")
            return []

        results = []
        for item in data.get("data", []):
            if not item.get("paperId") or not item.get("title"):
                continue
            results.append(Paper(
                paper_id=item["paperId"],
                title=item["title"],
                abstract=item.get("abstract"),
                year=item.get("year"),
                citation_count=item.get("citationCount", 0) or 0,
                authors=[a.get("name", "") for a in item.get("authors", [])],
                doi=(item.get("externalIds") or {}).get("DOI"),
                url=f"https://www.semanticscholar.org/paper/{item['paperId']}",
                text_tier=3 if item.get("abstract") else 4,
            ))
        return results

    # ─── Internal fetch helpers ───────────────────────────────────────────────

    async def _to_s2_id(self, identifier: str, id_type: str) -> Optional[str]:
        """Translate any identifier type to a Semantic Scholar corpus ID."""
        if id_type == ID_TYPE_S2:
            return identifier

        client = await self._client()
        headers = {"x-api-key": config.S2_API_KEY} if config.S2_API_KEY else {}

        # Map id_type to S2 prefix
        prefix_map = {
            ID_TYPE_DOI:      "DOI",
            ID_TYPE_ARXIV:    "ARXIV",
            ID_TYPE_PUBMED:   "PMID",
            ID_TYPE_OPENALEX: None,   # OpenAlex IDs not natively supported by S2
        }

        if id_type == ID_TYPE_TITLE:
            # Title search
            results = await self.search_papers(identifier, limit=1)
            return results[0].paper_id if results else None

        prefix = prefix_map.get(id_type)
        if not prefix:
            return None

        s2_ref = f"{prefix}:{identifier}"
        url = f"https://api.semanticscholar.org/graph/v1/paper/{s2_ref}"
        params = {"fields": "paperId"}

        await coordinated_rate_limiter.throttle("semantic_scholar")
        try:
            resp = await client.get(url, params=params, headers=headers)
            if resp.status_code in (404, 400):
                return None
            if resp.status_code == 429:
                await coordinated_rate_limiter.record_rate_limit("semantic_scholar")
                return None
            resp.raise_for_status()
            return resp.json().get("paperId")
        except Exception as e:
            logger.debug(f"S2 ID translation failed ({s2_ref}): {e}")
            return None

    async def _fetch_s2(self, s2_id: str) -> Optional[dict]:
        """Fetch full metadata for a single paper from Semantic Scholar."""
        client = await self._client()
        url = f"https://api.semanticscholar.org/graph/v1/paper/{s2_id}"
        params = {"fields": _S2_FIELDS}
        headers = {"x-api-key": config.S2_API_KEY} if config.S2_API_KEY else {}

        await coordinated_rate_limiter.throttle("semantic_scholar")
        try:
            resp = await client.get(url, params=params, headers=headers)
            if resp.status_code == 404:
                return None
            if resp.status_code == 429:
                await coordinated_rate_limiter.record_rate_limit("semantic_scholar")
                return None
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPStatusError as e:
            logger.warning(f"S2 fetch failed for {s2_id}: {e}")
            return None

        return self._parse_s2_response(data)

    async def _fetch_s2_batch(self, s2_ids: list[str]) -> list[dict]:
        """
        Fetch up to 500 papers in one S2 batch POST call.

        [FIX: Gap 22] v1 used a hard-coded field string that omitted "references".
        Batch-fetched papers are used for BFS expansion — without references, they
        have no children and the graph is artificially shallow beyond depth 1.
        _S2_BATCH_FIELDS now matches _S2_FIELDS and includes "references".
        """
        client = await self._client()
        url = "https://api.semanticscholar.org/graph/v1/paper/batch"
        params = {"fields": _S2_BATCH_FIELDS}
        headers = {"x-api-key": config.S2_API_KEY} if config.S2_API_KEY else {}
        body = {"ids": s2_ids}

        await coordinated_rate_limiter.throttle("semantic_scholar")
        try:
            resp = await client.post(url, json=body, params=params, headers=headers)
            if resp.status_code == 429:
                await coordinated_rate_limiter.record_rate_limit("semantic_scholar")
                return []
            resp.raise_for_status()
            items = resp.json()
        except Exception as e:
            logger.warning(f"S2 batch fetch failed: {e}")
            return []

        results = []
        for item in items:
            if item and item.get("paperId"):
                results.append(self._parse_s2_response(item))
        return results

    async def _fetch_openalex_by_doi(self, doi: str) -> Optional[dict]:
        """Fetch OpenAlex metadata by DOI. Used for abstract enrichment."""
        client = await self._client()
        url = f"https://api.openalex.org/works/doi:{doi}"
        params = {"select": _OA_FIELDS}
        headers = {}
        if config.OPENALEX_EMAIL:
            headers["User-Agent"] = f"Arivu/1.0 (mailto:{config.OPENALEX_EMAIL})"

        await coordinated_rate_limiter.throttle("openalex")
        try:
            resp = await client.get(url, params=params, headers=headers)
            if resp.status_code in (404, 400):
                return None
            if resp.status_code == 429:
                await coordinated_rate_limiter.record_rate_limit("openalex")
                return None
            resp.raise_for_status()
            return self._parse_openalex_response(resp.json())
        except Exception as e:
            logger.debug(f"OpenAlex fetch failed for DOI {doi}: {e}")
            return None

    # ─── Response parsers ─────────────────────────────────────────────────────

    @staticmethod
    def _parse_s2_response(data: dict) -> dict:
        """Normalize an S2 API response to a standard dict."""
        external_ids = data.get("externalIds") or {}
        return {
            "_source":      "s2",
            "paper_id":     data.get("paperId"),
            "s2_id":        data.get("paperId"),
            "title":        data.get("title"),
            "abstract":     data.get("abstract"),
            "year":         data.get("year"),
            "citation_count": data.get("citationCount", 0),
            "authors":      [a.get("name", "") for a in (data.get("authors") or [])],
            "doi":          external_ids.get("DOI"),
            "arxiv_id":     external_ids.get("ArXiv"),
            "fields_of_study": [f.get("category", "") for f in (data.get("fieldsOfStudy") or [])],
            "url":          data.get("url") or f"https://www.semanticscholar.org/paper/{data.get('paperId')}",
            "references":   [
                {"paper_id": r.get("paperId"), "title": r.get("title"), "doi": (r.get("externalIds") or {}).get("DOI")}
                for r in (data.get("references") or [])
                if r.get("paperId")
            ],
        }

    @staticmethod
    def _parse_openalex_response(data: dict) -> Optional[dict]:
        """Normalize an OpenAlex API response. Reconstructs abstract from inverted index."""
        if not data:
            return None

        abstract = None
        inverted = data.get("abstract_inverted_index")
        if inverted:
            abstract = _reconstruct_abstract(inverted)

        authors = []
        for a in (data.get("authorships") or []):
            name = (a.get("author") or {}).get("display_name")
            if name:
                authors.append(name)

        doi_raw = data.get("doi") or ""
        doi = doi_raw.replace("https://doi.org/", "").replace("http://doi.org/", "")

        return {
            "_source":    "openalex",
            "openalex_id": data.get("id"),
            "title":      data.get("title"),
            "abstract":   abstract,
            "year":       data.get("publication_year"),
            "citation_count": data.get("cited_by_count", 0),
            "authors":    authors,
            "doi":        doi or None,
        }

    # ─── DB caching ──────────────────────────────────────────────────────────

    @staticmethod
    def _load_from_cache(paper_id: str) -> Optional[Paper]:
        """Load a paper from the papers table if it was fetched within 30 days."""
        try:
            row = db.fetchone(
                """
                SELECT * FROM papers
                WHERE paper_id = %s
                AND created_at > NOW() - INTERVAL '30 days'
                """,
                (paper_id,),
            )
            return Paper.from_db_row(row) if row else None
        except Exception as e:
            logger.debug(f"Cache load failed for {paper_id}: {e}")
            return None

    @staticmethod
    def _save_to_cache(paper: Paper) -> None:
        """
        Upsert a resolved paper into the papers table.

        [FIX: Gap 26] v1 ON CONFLICT block never updated created_at. After 30 days,
        _load_from_cache() would always miss (created_at > NOW() - 30 days fails),
        causing re-fetches from S2 on every single request forever. The fix resets
        created_at on conflict so the 30-day TTL restarts on each successful fetch.
        """
        import json as _json
        try:
            db.execute(
                """
                INSERT INTO papers (
                    paper_id, title, abstract, year, citation_count,
                    fields_of_study, authors, doi, url, text_tier,
                    is_retracted, language, source_ids, created_at
                ) VALUES (
                    %s, %s, %s, %s, %s,
                    %s::jsonb, %s::jsonb, %s, %s, %s,
                    %s, %s, %s::jsonb, NOW()
                )
                ON CONFLICT (paper_id) DO UPDATE SET
                    title          = EXCLUDED.title,
                    abstract       = COALESCE(EXCLUDED.abstract, papers.abstract),
                    year           = COALESCE(EXCLUDED.year, papers.year),
                    citation_count = EXCLUDED.citation_count,
                    source_ids     = EXCLUDED.source_ids,
                    created_at     = NOW()
                """,
                (
                    paper.paper_id,
                    paper.title,
                    paper.abstract,
                    paper.year,
                    paper.citation_count,
                    _json.dumps(paper.fields_of_study),
                    _json.dumps(paper.authors),
                    paper.doi,
                    paper.url,
                    paper.text_tier,
                    paper.is_retracted,
                    paper.language,
                    _json.dumps(paper.source_ids),
                ),
            )
        except Exception as e:
            logger.debug(f"Cache save failed for {paper.paper_id}: {e}")


def _reconstruct_abstract(inverted_index: dict) -> Optional[str]:
    """
    Reconstruct an abstract from OpenAlex's inverted index format.
    Format: {"word": [position1, position2, ...], ...}
    """
    if not inverted_index:
        return None
    position_word: dict[int, str] = {}
    for word, positions in inverted_index.items():
        for pos in positions:
            position_word[pos] = word
    if not position_word:
        return None
    max_pos = max(position_word)
    words = [position_word.get(i, "") for i in range(max_pos + 1)]
    text = " ".join(w for w in words if w).strip()
    return text if text else None


# Module-level singleton
resolver = SmartPaperResolver()
```

---

## §8 — backend/nlp_pipeline.py

Replaces the Phase 1 stub. Orchestrates NLP worker HTTP calls. **No model loading.**

**NLI pipeline note:** Natural Language Inference (NLI) for fine-grained entailment
detection between sentence pairs is absent from this implementation. This is intentional
for Phase 2. NLI would provide higher-precision mutation classification but requires
either a separate NLI model endpoint or a more capable LLM prompt. The current pipeline
uses semantic similarity (Stage 1) + Groq LLM classification (Stage 2) + PageRank
structural validation (Stage 3). NLI can be added as Stage 1b in a future phase by
adding a `/nli_batch` endpoint to the NLP worker. Until then, the LLM in Stage 2
performs an equivalent role at lower throughput.

```python
"""
nlp_pipeline.py — InheritanceDetector: NLP analysis orchestrator.

This module runs on the MAIN Koyeb server. It calls the NLP worker (HuggingFace
Spaces) over HTTP. It NEVER loads sentence-transformers or torch.

Responsibilities:
    Stage 1: Call /similarity_matrix on NLP worker → similarity score + best pair
    Stage 2: Call Groq LLM for mutation type classification (5 edges per call)
    Stage 3: Graph structural validation (adjust confidence by PageRank)
    Combined: compute_inheritance_confidence() — multi-signal weighted score

Results are persisted in the edge_analysis table for reuse across graphs.
If Groq API key is not set (config.GROQ_ENABLED = False), Stage 2 is skipped
and edges are auto-classified as "incidental" with LLM_classified=False.

NLI pipeline: deliberately deferred to a future phase. See module docstring
in §8 of PHASE_2.md for rationale.

Column naming note: the edge_analysis table (Phase 1 migration) uses the column
name "base_confidence" for the final multi-signal confidence score. The complete
spec diagram §5.11 uses "inheritance_confidence" in one place. The Phase 1 SQL
migration is authoritative — "base_confidence" is correct. See §20 for details.
"""
import asyncio
import json
import logging
import re
import time
from typing import Optional

import httpx
import networkx as nx

import backend.db as db
from backend.config import config
from backend.models import (
    CITATION_INTENTS, CONFIDENCE_TIERS, MUTATION_TYPES,
    EdgeAnalysis, Paper, get_confidence_tier,
)
from backend.normalizer import split_into_sentences
from backend.rate_limiter import coordinated_rate_limiter
from exceptions import NLPTimeoutError, NLPWorkerError

logger = logging.getLogger(__name__)

_GROQ_HEADERS = {"Content-Type": "application/json"}


class InheritanceDetector:
    """
    Three-stage NLP pipeline for citation edge analysis.

    Usage (inside AncestryGraph):
        detector = InheritanceDetector()
        edge_analyses = await detector.analyze_edges(edges, all_papers, graph)
        # edge_analyses: list[EdgeAnalysis] — one per (citing, cited) pair
    """

    def __init__(self):
        self._http: Optional[httpx.AsyncClient] = None

    async def _client(self) -> httpx.AsyncClient:
        if self._http is None or self._http.is_closed:
            self._http = httpx.AsyncClient(
                timeout=httpx.Timeout(config.NLP_WORKER_TIMEOUT, connect=5.0),
                headers={
                    "Authorization": f"Bearer {config.NLP_WORKER_SECRET}",
                    "User-Agent": "Arivu/1.0",
                },
            )
        return self._http

    # ─── Public API ──────────────────────────────────────────────────────────

    async def analyze_edges(
        self,
        edges: list[tuple[str, str]],
        all_papers: dict[str, Paper],
        graph: nx.DiGraph,
    ) -> list[EdgeAnalysis]:
        """
        Run all three stages on a list of (citing_id, cited_id) pairs.

        Stage 1 runs on all edges (NLP worker similarity).
        Stage 2 runs only on edges with similarity > threshold (LLM classification).
        Stage 3 runs on all edges (graph structural validation).

        Returns one EdgeAnalysis per edge. Low-similarity edges get
        mutation_type="incidental" with llm_classified=False.
        """
        results: list[EdgeAnalysis] = []

        # Check cache first — avoid re-analyzing edges we've seen before
        edges_to_analyze: list[tuple[str, str]] = []
        for citing_id, cited_id in edges:
            edge_id = f"{citing_id}:{cited_id}"
            cached = self._load_cached_analysis(edge_id)
            if cached:
                results.append(cached)
            else:
                edges_to_analyze.append((citing_id, cited_id))

        logger.info(
            f"Edge analysis: {len(results)} cached, {len(edges_to_analyze)} to analyze"
        )

        if not edges_to_analyze:
            return results

        # Stage 1: Similarity for all uncached edges
        stage1_results = await self._run_stage1_all(edges_to_analyze, all_papers)

        # Separate candidates (similarity > threshold) from low-similarity edges
        threshold = config.NLP_SIMILARITY_THRESHOLD
        candidates = [r for r in stage1_results if r["similarity_score"] >= threshold]
        low_sim = [r for r in stage1_results if r["similarity_score"] < threshold]

        # Stage 2: LLM classification for candidates only
        if candidates and config.GROQ_ENABLED:
            await self._run_stage2_llm(candidates)
        else:
            for r in candidates:
                r["mutation_type"] = "incidental"
                r["citation_intent"] = "incidental_mention"
                r["mutation_confidence"] = 0.5
                r["mutation_evidence"] = "Auto-classified (LLM unavailable)"
                r["llm_classified"] = False

        # Low-similarity edges → auto-classify as incidental
        for r in low_sim:
            r["mutation_type"] = "incidental"
            r["citation_intent"] = "incidental_mention"
            r["mutation_confidence"] = 0.3
            r["mutation_evidence"] = "Similarity below threshold — incidental citation"
            r["llm_classified"] = False

        # Stage 3: Graph structure validation for all
        # [FIX: Gap 3] v1 called nx.pagerank() inside _run_stage3() which was called
        # per-edge. For a 200-node graph, this is O(200 * edges * iterations) — extremely
        # slow. PageRank is computed ONCE here and passed into _run_stage3().
        all_stage_results = candidates + low_sim
        try:
            pagerank_scores = nx.pagerank(graph, alpha=0.85)
        except Exception as e:
            logger.warning(f"PageRank computation failed, using uniform scores: {e}")
            pagerank_scores = {}

        for r in all_stage_results:
            self._run_stage3(r, graph, pagerank_scores)

        # Build EdgeAnalysis objects and cache them
        for r in all_stage_results:
            ea = self._build_edge_analysis(r, all_papers)
            self._save_cached_analysis(ea)
            results.append(ea)

        return results

    # ─── Stage 1: Similarity ─────────────────────────────────────────────────

    async def _run_stage1_all(
        self, edges: list[tuple[str, str]], all_papers: dict[str, Paper]
    ) -> list[dict]:
        """Run Stage 1 on all edges concurrently (bounded concurrency)."""
        sem = asyncio.Semaphore(10)   # Max 10 concurrent NLP worker calls

        async def analyze_one(edge: tuple[str, str]) -> dict:
            async with sem:
                return await self._stage1_similarity(edge[0], edge[1], all_papers)

        return await asyncio.gather(*[analyze_one(e) for e in edges])

    async def _stage1_similarity(
        self, citing_id: str, cited_id: str, all_papers: dict[str, Paper]
    ) -> dict:
        """
        Call /similarity_matrix on the NLP worker.
        Returns a dict with edge_id, similarity_score, best sentence pair.
        """
        edge_id = f"{citing_id}:{cited_id}"
        citing = all_papers.get(citing_id)
        cited = all_papers.get(cited_id)

        base = {
            "edge_id": edge_id,
            "citing_paper_id": citing_id,
            "cited_paper_id": cited_id,
            "similarity_score": 0.0,
            "citing_sentence": None,
            "cited_sentence": None,
            "citing_text_source": "none",
            "cited_text_source": "none",
            "comparable": False,
            "signals_used": [],
        }

        if not citing or not cited:
            base["comparison_note"] = "Paper data missing"
            return base

        citing_text = citing.abstract or citing.title or ""
        cited_text = cited.abstract or cited.title or ""
        citing_src = "abstract" if citing.abstract else "title"
        cited_src = "abstract" if cited.abstract else "title"

        if not citing_text.strip() or not cited_text.strip():
            base["comparison_note"] = "No text available for one or both papers"
            return base

        citing_sents = split_into_sentences(citing_text, max_sentences=50)
        cited_sents = split_into_sentences(cited_text, max_sentences=50)

        if not citing_sents or not cited_sents:
            base["comparison_note"] = "Could not split text into sentences"
            return base

        try:
            client = await self._client()
            resp = await client.post(
                f"{config.NLP_WORKER_URL}/similarity_matrix",
                json={"texts_a": citing_sents, "texts_b": cited_sents},
            )
            resp.raise_for_status()
            data = resp.json()
        except httpx.TimeoutException:
            logger.warning(f"NLP worker timeout for edge {edge_id}")
            base["comparison_note"] = "NLP worker timeout"
            return base
        except Exception as e:
            logger.warning(f"NLP worker call failed for edge {edge_id}: {e}")
            base["comparison_note"] = f"NLP worker error: {str(e)[:100]}"
            return base

        max_pair = data.get("max_pair", {})
        score = float(max_pair.get("score", 0.0))

        base.update({
            "similarity_score": round(score, 4),
            "citing_sentence": max_pair.get("sentence_a"),
            "cited_sentence": max_pair.get("sentence_b"),
            "citing_text_source": citing_src,
            "cited_text_source": cited_src,
            "comparable": True,
            "signals_used": ["similarity"],
        })
        return base

    # ─── Stage 2: LLM Classification ─────────────────────────────────────────

    async def _run_stage2_llm(self, edges: list[dict]) -> None:
        """
        Classify edges in batches of NLP_BATCH_SIZE via Groq.
        Mutates each edge dict in-place with mutation_type, citation_intent, etc.
        """
        batch_size = config.NLP_BATCH_SIZE   # default 5
        for i in range(0, len(edges), batch_size):
            batch = edges[i:i + batch_size]
            await self._classify_batch(batch)

    async def _classify_batch(self, batch: list[dict]) -> None:
        """Send one LLM request for a batch of edges. Mutates each dict in-place."""
        edges_data = []
        for edge in batch:
            edges_data.append({
                "edge_id": edge["edge_id"],
                "citing_sentence": edge.get("citing_sentence") or "(no text)",
                "cited_sentence":  edge.get("cited_sentence")  or "(no text)",
            })

        mutation_opts = ", ".join(f'"{m}"' for m in MUTATION_TYPES)
        intent_opts = ", ".join(f'"{c}"' for c in CITATION_INTENTS)

        prompt = f"""Classify each academic citation relationship based on the sentence pair.

Edges:
{json.dumps(edges_data, indent=2)}

For each edge_id, return:
  mutation_type: one of {mutation_opts}
  citation_intent: one of {intent_opts}
  confidence: "high" | "medium" | "low"
  evidence: one concise sentence explaining your classification

Return ONLY valid JSON — no markdown, no preamble:
{{
  "classifications": [
    {{"edge_id": "...", "mutation_type": "...", "citation_intent": "...", "confidence": "...", "evidence": "..."}}
  ]
}}"""

        await coordinated_rate_limiter.throttle("groq")
        try:
            client = await self._client()
            resp = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {config.GROQ_API_KEY}"},
                json={
                    "model": config.GROQ_FAST_MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 800,
                    "temperature": 0.1,
                },
            )
            if resp.status_code == 429:
                await coordinated_rate_limiter.record_rate_limit("groq", 60)
                self._apply_fallback_classification(batch)
                return
            resp.raise_for_status()
            raw = resp.json()["choices"][0]["message"]["content"]
        except Exception as e:
            logger.warning(f"Groq classification failed: {e}")
            self._apply_fallback_classification(batch)
            return

        try:
            # Strip markdown fences if present
            cleaned = re.sub(r"```(?:json)?", "", raw).strip()
            parsed = json.loads(cleaned)
            classes = {c["edge_id"]: c for c in parsed.get("classifications", [])}
        except Exception as e:
            logger.warning(f"Groq JSON parse failed: {e}")
            self._apply_fallback_classification(batch)
            return

        conf_map = {"high": 0.9, "medium": 0.7, "low": 0.5}
        for edge in batch:
            cls = classes.get(edge["edge_id"])
            if cls:
                mt = cls.get("mutation_type", "incidental")
                ci = cls.get("citation_intent", "incidental_mention")
                # Validate against known values
                if mt not in MUTATION_TYPES:
                    mt = "incidental"
                if ci not in CITATION_INTENTS:
                    ci = "incidental_mention"
                edge["mutation_type"] = mt
                edge["citation_intent"] = ci
                edge["mutation_confidence"] = conf_map.get(cls.get("confidence", "medium"), 0.7)
                edge["mutation_evidence"] = cls.get("evidence", "")[:500]
                edge["llm_classified"] = True
                if "similarity" in edge.get("signals_used", []):
                    edge["signals_used"].append("llm")
            else:
                self._apply_fallback_single(edge)

    @staticmethod
    def _apply_fallback_classification(batch: list[dict]) -> None:
        for edge in batch:
            InheritanceDetector._apply_fallback_single(edge)

    @staticmethod
    def _apply_fallback_single(edge: dict) -> None:
        """Classify a single edge as incidental when LLM is unavailable."""
        sim = edge.get("similarity_score", 0)
        if sim >= 0.65:
            mt = "adoption"
        elif sim >= 0.45:
            mt = "generalization"
        else:
            mt = "incidental"
        edge["mutation_type"] = mt
        edge["citation_intent"] = "methodological_adoption" if mt != "incidental" else "incidental_mention"
        edge["mutation_confidence"] = sim * 0.8
        edge["mutation_evidence"] = f"Auto-classified from similarity score {sim:.2f}"
        edge["llm_classified"] = False

    # ─── Stage 3: Structural Validation ──────────────────────────────────────

    @staticmethod
    def _run_stage3(edge: dict, graph: nx.DiGraph, pagerank_scores: dict) -> None:
        """
        Adjust confidence based on PageRank (structural importance).
        Mutates edge dict in-place — adds structural_importance_modifier and base_confidence.

        [FIX: Gap 3] PageRank is now passed in as a pre-computed dict rather than
        being recomputed here. v1 called nx.pagerank(graph) inside this method, which
        was invoked per-edge — O(nodes * iterations) per edge instead of O(nodes * iterations)
        total. The caller (analyze_edges) computes PageRank once and passes pagerank_scores.
        """
        cited_id = edge.get("cited_paper_id")
        sim = edge.get("similarity_score", 0)

        try:
            struct = min(1.0, (pagerank_scores.get(cited_id, 0.01) * len(graph.nodes)) / 5)
        except Exception:
            struct = 0.5

        # Multi-signal confidence
        signals = edge.get("signals_used", [])
        weights = {"similarity": 0.50, "llm": 0.40, "structural": 0.10}

        score = 0.0
        total_w = 0.0
        if "similarity" in signals:
            score += sim * weights["similarity"]
            total_w += weights["similarity"]
        if "llm" in signals:
            mc = edge.get("mutation_confidence", 0.5)
            score += mc * weights["llm"]
            total_w += weights["llm"]
        # structural always contributes
        score += struct * weights["structural"]
        total_w += weights["structural"]

        if total_w > 0:
            score = score / total_w

        # Degradation factor: fewer signals → lower max confidence
        n = len(signals)
        degradation = {0: 0.5, 1: 0.65, 2: 0.85, 3: 1.0}.get(n, 1.0)

        edge["structural_importance_modifier"] = round(struct, 4)
        edge["base_confidence"] = round(score * degradation, 4)
        if "structural" not in signals:
            edge.get("signals_used", []).append("structural")

    # ─── EdgeAnalysis construction ────────────────────────────────────────────

    @staticmethod
    def _build_edge_analysis(edge: dict, all_papers: dict[str, Paper]) -> EdgeAnalysis:
        conf = edge.get("base_confidence", 0.0)
        return EdgeAnalysis(
            edge_id=edge["edge_id"],
            citing_paper_id=edge["citing_paper_id"],
            cited_paper_id=edge["cited_paper_id"],
            similarity_score=edge.get("similarity_score", 0.0),
            citing_sentence=edge.get("citing_sentence"),
            cited_sentence=edge.get("cited_sentence"),
            citing_text_source=edge.get("citing_text_source", "none"),
            cited_text_source=edge.get("cited_text_source", "none"),
            comparable=edge.get("comparable", False),
            mutation_type=edge.get("mutation_type", "incidental"),
            mutation_confidence=edge.get("mutation_confidence", 0.0),
            mutation_evidence=edge.get("mutation_evidence", ""),
            citation_intent=edge.get("citation_intent", "incidental_mention"),
            base_confidence=conf,
            signals_used=edge.get("signals_used", []),
            llm_classified=edge.get("llm_classified", False),
            flagged_by_users=0,
            model_version="1.0.0",
        )

    # ─── DB caching ──────────────────────────────────────────────────────────

    @staticmethod
    def _load_cached_analysis(edge_id: str) -> Optional[EdgeAnalysis]:
        """Load from edge_analysis table if present and model version matches."""
        try:
            row = db.fetchone(
                "SELECT * FROM edge_analysis WHERE edge_id = %s AND model_version = %s",
                (edge_id, "1.0.0"),
            )
            if not row:
                return None
            return EdgeAnalysis(
                edge_id=row["edge_id"],
                citing_paper_id=row["citing_paper_id"],
                cited_paper_id=row["cited_paper_id"],
                similarity_score=float(row.get("similarity_score", 0)),
                citing_sentence=row.get("citing_sentence"),
                cited_sentence=row.get("cited_sentence"),
                citing_text_source=row.get("citing_text_source", "none"),
                cited_text_source=row.get("cited_text_source", "none"),
                comparable=bool(row.get("comparable", False)),
                mutation_type=row.get("mutation_type", "incidental"),
                mutation_confidence=float(row.get("mutation_confidence", 0)),
                mutation_evidence=row.get("mutation_evidence", ""),
                citation_intent=row.get("citation_intent", "incidental_mention"),
                base_confidence=float(row.get("base_confidence", 0)),
                signals_used=row.get("signals_used") or [],
                llm_classified=bool(row.get("llm_classified", False)),
                flagged_by_users=int(row.get("flagged_by_users", 0)),
                model_version=row.get("model_version", "1.0.0"),
            )
        except Exception as e:
            logger.debug(f"Cache load failed for edge {edge_id}: {e}")
            return None

    @staticmethod
    def _save_cached_analysis(ea: EdgeAnalysis) -> None:
        """Upsert an EdgeAnalysis into the edge_analysis table."""
        import json as _json
        try:
            db.execute(
                """
                INSERT INTO edge_analysis (
                    edge_id, citing_paper_id, cited_paper_id,
                    similarity_score, citing_sentence, cited_sentence,
                    citing_text_source, cited_text_source, comparable,
                    mutation_type, mutation_confidence, mutation_evidence,
                    citation_intent, base_confidence, signals_used,
                    llm_classified, flagged_by_users, model_version,
                    computed_at
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, NOW()
                )
                ON CONFLICT (edge_id) DO UPDATE SET
                    similarity_score   = EXCLUDED.similarity_score,
                    mutation_type      = EXCLUDED.mutation_type,
                    mutation_confidence = EXCLUDED.mutation_confidence,
                    base_confidence    = EXCLUDED.base_confidence,
                    llm_classified     = EXCLUDED.llm_classified,
                    model_version      = EXCLUDED.model_version,
                    computed_at        = NOW()
                """,
                (
                    ea.edge_id, ea.citing_paper_id, ea.cited_paper_id,
                    ea.similarity_score, ea.citing_sentence, ea.cited_sentence,
                    ea.citing_text_source, ea.cited_text_source, ea.comparable,
                    ea.mutation_type, ea.mutation_confidence, ea.mutation_evidence,
                    ea.citation_intent, ea.base_confidence,
                    _json.dumps(ea.signals_used),
                    ea.llm_classified, ea.flagged_by_users, ea.model_version,
                ),
            )
        except Exception as e:
            logger.debug(f"Cache save failed for edge {ea.edge_id}: {e}")
```

---

## §9 — backend/graph_engine.py

Replaces the Phase 1 stub. Full BFS ancestry graph with NLP analysis and R2 caching.

**job_events column note:** The `job_events` table has two numeric fields:
- `id SERIAL PRIMARY KEY` — auto-incremented by Postgres; used for polling (`WHERE id > last_seen_id`)
- `sequence INTEGER` — app-assigned sequential counter within a job; used in INSERT

The `_emit()` method inserts using `sequence` (computed via MAX subquery). The SSE
`_event_stream()` polls using `id` (the PK). Both are correct — `id` is a stable
cursor for the SSE poller, while `sequence` tracks logical event order per job.

```python
"""
graph_engine.py — AncestryGraph: BFS citation graph builder.

Orchestrates:
  1. BFS crawl via SmartPaperResolver
  2. Reference selection (semantic relevance + citation count)
  3. DAG enforcement (cycle removal)
  4. Paper embedding population (paper_embeddings table, for Phase 3+ pgvector)
  5. NLP pipeline (InheritanceDetector)
  6. export_to_json() — D3.js-compatible format
  7. R2 caching and DB graph record

Phase 2 produces the graph JSON. Pruning impact precomputation is added in Phase 3.
DNA profiling and diversity scoring are added in Phase 4.

Full-text extraction: deferred to Phase 3. In Phase 2, all text comes from
abstracts (text_tier 3) or titles only (text_tier 4). The full-text pipeline
(PDF fetch → section extraction → text_tier 1/2) will be implemented in Phase 3
alongside the pruning engine which benefits most from richer text.
"""
import asyncio
import json
import logging
import time
import uuid
from collections import deque
from typing import Optional

import networkx as nx

import backend.db as db
from backend.api_client import SmartPaperResolver, resolver
from backend.config import config
from backend.models import Paper, get_confidence_tier
from backend.nlp_pipeline import InheritanceDetector
from exceptions import (
    EmptyGraphError, GraphBuildError, GraphTooLargeError,
    NLPWorkerError, PaperNotFoundError,
)

# [FIX: Gap 15] Removed dead import: "from sklearn.metrics.pairwise import cosine_similarity
# as sklearn_cosine". sklearn was imported but never called — select_references() uses
# title word overlap, not sklearn cosine similarity. The import caused a dependency
# warning and would fail on environments without scikit-learn installed.

logger = logging.getLogger(__name__)

MODEL_VERSION = "1.0.0"


def select_references(
    seed_paper: Paper,
    references: list[Paper],
    limit: int = 50,
) -> list[Paper]:
    """
    Select the most relevant references for BFS expansion.
    Combines semantic relevance to seed paper (65%) and citation count (35%).
    Falls back to citation-count-only ordering when no abstract is available.
    """
    if not references:
        return []

    max_citations = max((r.citation_count for r in references if r.citation_count), default=1)

    scored: list[tuple[float, Paper]] = []
    for ref in references:
        citation_score = (ref.citation_count or 0) / max_citations

        # Semantic score: title overlap as cheap proxy (no NLP worker call here)
        # Full semantic similarity via embeddings added in Phase 3+
        if ref.title and seed_paper.title:
            seed_words = set(seed_paper.title.lower().split())
            ref_words = set(ref.title.lower().split())
            overlap = len(seed_words & ref_words) / max(len(seed_words), 1)
        else:
            overlap = 0.0

        relevance = (overlap * 0.65) + (citation_score * 0.35)
        scored.append((relevance, ref))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [paper for _, paper in scored[:limit]]


def determine_crawl_depth(seed_paper: Paper, user_goal: str) -> int:
    """
    Adaptive depth: 2 for recent papers, 3 for older papers, capped at 3.
    Spec §7: always cap total nodes at 400.
    """
    base = 2
    if seed_paper.year and seed_paper.year < 2000:
        base = 3
    if user_goal == "quick_overview":
        return min(base, 2)
    if user_goal == "deep_ancestry":
        return min(base + 1, 3)
    return base


class AncestryGraph:
    """
    Builds and exports a citation ancestry graph for one seed paper.

    Usage (from Flask route via await_sync):
        graph_engine = AncestryGraph()
        graph_json = await graph_engine.build_graph(
            seed_paper_id="abc123...",
            user_goal="general",
            job_id="uuid-...",
        )
    """

    def __init__(self):
        self.graph: nx.DiGraph = nx.DiGraph()
        self._job_id: Optional[str] = None
        self._resolver: SmartPaperResolver = resolver
        self._nlp: InheritanceDetector = InheritanceDetector()

    # ─── Main entry point ────────────────────────────────────────────────────

    async def build_graph(
        self,
        seed_paper_id: str,
        user_goal: str = "general",
        job_id: Optional[str] = None,
    ) -> dict:
        """
        Full graph build pipeline. Emits SSE progress events via job_events table.

        Returns the graph JSON dict (same format as export_to_json).
        Raises GraphBuildError on unrecoverable failures.
        """
        self._job_id = job_id or str(uuid.uuid4())
        self.graph = nx.DiGraph()

        try:
            return await self._build(seed_paper_id, user_goal)
        except (PaperNotFoundError, GraphTooLargeError, EmptyGraphError):
            raise   # Pass through known errors
        except Exception as e:
            logger.error(f"Graph build failed for {seed_paper_id}: {e}", exc_info=True)
            await self._emit("error", f"Graph build failed: {str(e)[:200]}")
            raise GraphBuildError(seed_paper_id, str(e)) from e

    async def _build(self, seed_paper_id: str, user_goal: str) -> dict:
        all_papers: dict[str, Paper] = {}
        build_start = time.time()

        # ── Step 1: Resolve seed paper ────────────────────────────────────
        await self._emit("searching", "Finding seed paper…")
        from backend.normalizer import normalize_user_input
        canonical_id, id_type = normalize_user_input(seed_paper_id)
        seed_paper = await self._resolver.resolve(canonical_id, id_type)
        all_papers[seed_paper.paper_id] = seed_paper

        max_depth = determine_crawl_depth(seed_paper, user_goal)
        logger.info(f"Building graph: seed={seed_paper.paper_id[:8]}… depth={max_depth}")

        # ── Step 2: BFS crawl ─────────────────────────────────────────────
        await self._emit("crawling", f"Building ancestry graph to depth {max_depth}…")
        self.graph.add_node(seed_paper.paper_id, depth=0)

        visited: set[str] = {seed_paper.paper_id}
        queue: deque[tuple[Paper, int]] = deque([(seed_paper, 0)])

        while queue:
            paper, depth = queue.popleft()

            if depth >= max_depth:
                continue

            await self._emit(
                "crawling",
                f"Depth {depth+1}: expanding '{paper.title[:50]}…'"
            )

            refs = await self._resolver.get_references(paper.paper_id, limit=100)
            selected = select_references(seed_paper, refs, limit=config.MAX_REFS_PER_PAPER)

            if not selected:
                continue

            ref_ids = [r.paper_id for r in selected]
            enriched = await self._resolver.resolve_batch(ref_ids)

            for ref in enriched:
                all_papers[ref.paper_id] = ref
                if ref.paper_id not in visited:
                    visited.add(ref.paper_id)
                    self.graph.add_node(ref.paper_id, depth=depth + 1)
                    queue.append((ref, depth + 1))
                # Edge: paper cites ref
                if not self.graph.has_edge(paper.paper_id, ref.paper_id):
                    self.graph.add_edge(paper.paper_id, ref.paper_id)

            # Safety cap
            if len(self.graph.nodes) > config.MAX_GRAPH_SIZE:
                logger.warning(f"Graph size cap reached ({config.MAX_GRAPH_SIZE} nodes)")
                break

        if len(self.graph.nodes) < 2:
            raise EmptyGraphError(seed_paper.paper_id)

        logger.info(f"BFS complete: {len(self.graph.nodes)} nodes, {len(self.graph.edges)} edges")

        # ── Step 3: DAG enforcement ───────────────────────────────────────
        self._ensure_dag()

        # ── Step 4: Populate paper embeddings (for Phase 3+ pgvector search) ─
        # [FIX: Gap 21] v1 never populated paper_embeddings. Phase 3+ features
        # (Research Gap Finder, Serendipity Engine, semantic clustering) all rely on
        # pgvector similarity search against paper_embeddings. Without population here,
        # those queries would return empty results. We batch-encode abstracts/titles
        # now while we have all_papers in memory.
        await self._emit("analyzing", "Encoding paper embeddings…")
        await self._populate_embeddings(all_papers)

        # ── Step 5: NLP analysis ──────────────────────────────────────────
        await self._emit(
            "analyzing",
            f"Running NLP analysis on {len(self.graph.edges())} edges…"
        )
        edges = list(self.graph.edges())
        edge_analyses = await self._nlp.analyze_edges(edges, all_papers, self.graph)

        # Attach analysis results as edge attributes
        for ea in edge_analyses:
            citing_id = ea.citing_paper_id
            cited_id = ea.cited_paper_id
            if self.graph.has_edge(citing_id, cited_id):
                self.graph[citing_id][cited_id].update({
                    "edge_id":                ea.edge_id,
                    "similarity_score":       ea.similarity_score,
                    "citing_sentence":        ea.citing_sentence,
                    "cited_sentence":         ea.cited_sentence,
                    "citing_text_source":     ea.citing_text_source,
                    "cited_text_source":      ea.cited_text_source,
                    "mutation_type":          ea.mutation_type,
                    "mutation_confidence":    ea.mutation_confidence,
                    "citation_intent":        ea.citation_intent,
                    "base_confidence":        ea.base_confidence,
                    "llm_classified":         ea.llm_classified,
                    "comparable":             ea.comparable,
                })

        # ── Step 6: Export and cache ──────────────────────────────────────
        await self._emit("finalizing", "Building graph export…")
        graph_json = self._export_to_json(seed_paper, all_papers)
        build_time = time.time() - build_start

        # Cache to R2
        from backend.r2_client import R2Client
        from backend.config import config as _config
        r2 = R2Client(_config)
        graph_key = f"graphs/{self._job_id}.json"
        try:
            r2.put_json(graph_key, graph_json)
            logger.info(f"Graph cached to R2: {graph_key}")
        except Exception as e:
            logger.warning(f"R2 cache failed (non-fatal): {e}")

        # Persist graph record to DB
        # [FIX: Gap 19] v1 INSERT omitted max_depth, coverage_score, coverage_report,
        # build_time_seconds — all present in the Phase 1 graphs table schema.
        # Leaving them NULL would break Phase 3+ features that read coverage_score
        # and coverage_report. We populate what we can now; coverage_* will be
        # computed properly in Phase 3 when the coverage analyser is implemented.
        db.execute(
            """
            INSERT INTO graphs (
                graph_id, seed_paper_id, graph_json_url,
                node_count, edge_count, max_depth,
                coverage_score, coverage_report,
                model_version, build_time_seconds,
                created_at, last_accessed
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, NOW(), NOW())
            ON CONFLICT (graph_id) DO UPDATE SET
                last_accessed = NOW(),
                computed_at = NOW()
            """,
            (
                self._job_id,
                seed_paper.paper_id,
                graph_key,
                len(graph_json["nodes"]),
                len(graph_json["edges"]),
                max_depth,
                None,          # coverage_score — computed in Phase 3
                json.dumps({}),  # coverage_report — populated in Phase 3
                MODEL_VERSION,
                round(build_time, 2),
            ),
        )

        # Link graph to session (via job record)
        try:
            job_row = db.fetchone(
                "SELECT session_id FROM build_jobs WHERE job_id = %s",
                (self._job_id,),
            )
            if job_row and job_row.get("session_id"):
                db.execute(
                    """
                    INSERT INTO session_graphs (session_id, graph_id, created_at)
                    VALUES (%s, %s, NOW())
                    ON CONFLICT DO NOTHING
                    """,
                    (job_row["session_id"], self._job_id),
                )
        except Exception as e:
            logger.debug(f"session_graphs insert failed (non-fatal): {e}")

        await self._emit("done", "Graph ready.", graph=graph_json)
        return graph_json

    # ─── Embedding population ─────────────────────────────────────────────────

    async def _populate_embeddings(self, all_papers: dict[str, Paper]) -> None:
        """
        Batch-encode paper abstracts/titles and store in paper_embeddings.

        [FIX: Gap 21] Called after BFS crawl, before NLP analysis. Skips papers
        that already have an embedding in the DB. Uses /encode_batch on the NLP
        worker in chunks of 512. Non-fatal: embedding failures are logged and
        skipped so the graph build always completes.

        Papers with embeddings enable Phase 3+ pgvector similarity searches:
        Research Gap Finder, Serendipity Engine, semantic paper clustering.
        """
        import httpx as _httpx

        # Find papers that do not yet have embeddings
        paper_ids = list(all_papers.keys())
        if not paper_ids:
            return

        try:
            rows = db.fetchall(
                "SELECT paper_id FROM paper_embeddings WHERE paper_id = ANY(%s)",
                (paper_ids,),
            )
            existing_ids = {r["paper_id"] for r in rows}
        except Exception as e:
            logger.debug(f"Could not check existing embeddings: {e}")
            existing_ids = set()

        to_encode = [
            (pid, all_papers[pid])
            for pid in paper_ids
            if pid not in existing_ids
        ]

        if not to_encode:
            logger.debug("All papers already have embeddings")
            return

        logger.info(f"Encoding embeddings for {len(to_encode)} papers")

        # Build text list (abstract preferred, title fallback)
        texts = [
            (p.abstract or p.title or "")[:512]
            for _, p in to_encode
        ]

        # Encode in chunks of 512 (NLP worker limit)
        chunk_size = 512
        all_embeddings: list[list[float]] = []

        try:
            async with _httpx.AsyncClient(
                timeout=_httpx.Timeout(config.NLP_WORKER_TIMEOUT, connect=5.0),
                headers={"Authorization": f"Bearer {config.NLP_WORKER_SECRET}"},
            ) as client:
                for i in range(0, len(texts), chunk_size):
                    chunk = texts[i:i + chunk_size]
                    try:
                        resp = await client.post(
                            f"{config.NLP_WORKER_URL}/encode_batch",
                            json={"texts": chunk, "normalize": True},
                        )
                        resp.raise_for_status()
                        data = resp.json()
                        all_embeddings.extend(data["embeddings"])
                    except Exception as e:
                        logger.warning(f"Embedding chunk {i//chunk_size} failed: {e}")
                        # Fill with None placeholders so indices stay aligned
                        all_embeddings.extend([None] * len(chunk))
        except Exception as e:
            logger.warning(f"Embedding population failed (non-fatal): {e}")
            return

        # Persist embeddings to paper_embeddings table
        inserted = 0
        for (paper_id, _), embedding in zip(to_encode, all_embeddings):
            if embedding is None:
                continue
            try:
                db.execute(
                    """
                    INSERT INTO paper_embeddings (paper_id, embedding, model_version, computed_at)
                    VALUES (%s, %s::vector, %s, NOW())
                    ON CONFLICT (paper_id) DO UPDATE SET
                        embedding     = EXCLUDED.embedding,
                        model_version = EXCLUDED.model_version,
                        computed_at   = NOW()
                    """,
                    (paper_id, str(embedding), MODEL_VERSION),
                )
                inserted += 1
            except Exception as e:
                logger.debug(f"Embedding insert failed for {paper_id}: {e}")

        logger.info(f"Embeddings stored: {inserted}/{len(to_encode)}")

    # ─── DAG enforcement ──────────────────────────────────────────────────────

    def _ensure_dag(self) -> None:
        """Remove edges that create cycles (sampling artifacts from BFS)."""
        try:
            while not nx.is_directed_acyclic_graph(self.graph):
                cycle = next(nx.simple_cycles(self.graph))
                # Remove the last edge in the cycle (the one that closes it)
                edge_to_remove = (cycle[-1], cycle[0])
                if self.graph.has_edge(*edge_to_remove):
                    self.graph.remove_edge(*edge_to_remove)
                    logger.debug(f"Removed cycle edge: {edge_to_remove}")
        except StopIteration:
            pass   # No cycles found
        except Exception as e:
            logger.warning(f"DAG enforcement error (non-fatal): {e}")

    # ─── JSON export ─────────────────────────────────────────────────────────

    def _export_to_json(self, seed_paper: Paper, all_papers: dict[str, Paper]) -> dict:
        """
        Export NetworkX graph to D3.js-compatible JSON.

        Node fields:  id, title, authors, year, citation_count, fields_of_study,
                      abstract_preview, url, doi, is_seed, is_root, depth,
                      pruning_impact (0 placeholder — computed in Phase 3),
                      is_bottleneck, text_tier, is_retracted, language
        Edge fields:  source, target, similarity_score, citing_sentence,
                      cited_sentence, mutation_type, citation_intent,
                      final_confidence, confidence_tier, comparable,
                      citing_text_source, cited_text_source
        """
        nodes = []
        for paper_id, node_data in self.graph.nodes(data=True):
            paper = all_papers.get(paper_id)
            if not paper:
                continue
            nodes.append({
                "id":               paper.paper_id,
                "title":            paper.title,
                "authors":          paper.authors[:3],
                "year":             paper.year,
                "citation_count":   paper.citation_count,
                "fields_of_study":  paper.fields_of_study,
                "abstract_preview": (paper.abstract or "")[:200],
                "url":              paper.url,
                "doi":              paper.doi,
                "is_seed":          paper.paper_id == seed_paper.paper_id,
                "is_root":          self.graph.out_degree(paper_id) == 0,
                "depth":            node_data.get("depth", -1),
                "pruning_impact":   0,           # Phase 3
                "is_bottleneck":    False,        # Phase 3
                "text_tier":        paper.text_tier,
                "is_retracted":     paper.is_retracted,
                "language":         paper.language,
            })

        edges = []
        for citing_id, cited_id, edge_data in self.graph.edges(data=True):
            conf = edge_data.get("base_confidence", 0.0)
            edges.append({
                "source":              citing_id,
                "target":              cited_id,
                "similarity_score":    edge_data.get("similarity_score", 0.0),
                "citing_sentence":     edge_data.get("citing_sentence"),
                "cited_sentence":      edge_data.get("cited_sentence"),
                "mutation_type":       edge_data.get("mutation_type", "unknown"),
                "citation_intent":     edge_data.get("citation_intent", "unknown"),
                "final_confidence":    round(conf, 4),
                "confidence_tier":     get_confidence_tier(conf),
                "comparable":          edge_data.get("comparable", False),
                "citing_text_source":  edge_data.get("citing_text_source", "none"),
                "cited_text_source":   edge_data.get("cited_text_source", "none"),
            })

        return {
            "nodes": nodes,
            "edges": edges,
            "metadata": {
                "seed_paper_id":    seed_paper.paper_id,
                "seed_paper_title": seed_paper.title,
                "total_nodes":      len(nodes),
                "total_edges":      len(edges),
                "model_version":    MODEL_VERSION,
                "build_timestamp":  time.time(),
                "graph_id":         self._job_id,
            },
        }

    # ─── SSE progress events ──────────────────────────────────────────────────

    async def _emit(
        self,
        status: str,
        message: str,
        graph: Optional[dict] = None,
    ) -> None:
        """
        Append a progress event to job_events. Flask SSE endpoint polls this table.

        Column note: INSERT uses 'sequence' (logical order within a job, computed via
        MAX subquery). The SSE poller in _event_stream() queries using 'id' (the SERIAL
        PK). Both columns exist in the Phase 1 schema. 'id' is used for polling because
        it is a stable, monotonically increasing cursor that works correctly even if the
        SSE client reconnects mid-stream via the Last-Event-ID header.
        """
        event: dict = {"status": status, "message": message, "timestamp": time.time()}
        if graph is not None:
            event["graph"] = graph
        try:
            db.execute(
                """
                INSERT INTO job_events (job_id, sequence, event_data, created_at)
                SELECT %s,
                       COALESCE((SELECT MAX(sequence) FROM job_events WHERE job_id = %s), 0) + 1,
                       %s::jsonb,
                       NOW()
                """,
                (self._job_id, self._job_id, json.dumps(event)),
            )
        except Exception as e:
            logger.debug(f"_emit DB write failed (non-fatal): {e}")
```

---

## §10 — app.py additions

Add these routes to the existing `app.py`. Keep `/health` exactly as it was.

### New imports to add at top of app.py
```python
import uuid
import json
from threading import Thread
import time

from flask import request, jsonify, Response, stream_with_context, g

from backend.api_client import resolver
from backend.graph_engine import AncestryGraph
from backend.normalizer import normalize_user_input
from backend.schemas import GraphBuildRequest, SearchRequest
from backend.session_manager import require_session
from backend.rate_limiter import arivu_rate_limiter
from backend.utils import await_sync, log_action
import backend.db as db
```

### Route: POST /api/search
```python
@app.route("/api/search", methods=["POST"])
@require_session
def search_papers():
    """
    Search for papers by title, DOI, arXiv ID, or S2 URL.

    Request body:  {"query": "Attention Is All You Need"}
    Response:      {"results": [Paper.to_dict(), ...], "id_type": "search"|"doi"|...}

    Direct-lookup inputs (DOI, arXiv, S2 ID) return a single result.
    Title inputs return up to 8 candidates for the disambiguation UI.
    """
    allowed, headers = await_sync(
        arivu_rate_limiter.check(g.session_id, "POST /api/search")
    )
    if not allowed:
        return jsonify(arivu_rate_limiter.get_429_body(headers)), 429, headers

    try:
        body = SearchRequest(**request.get_json(force=True))
    except Exception as e:
        return jsonify({"error": "VALIDATION_ERROR", "message": str(e)}), 400

    canonical_id, id_type = normalize_user_input(body.query)

    try:
        if id_type in ("doi", "arxiv", "s2", "pubmed", "openalex"):
            # Direct lookup — single result
            paper = await_sync(resolver.resolve(canonical_id, id_type))
            results = [_paper_to_dict(paper)]
        else:
            # Title search — up to 8 candidates
            papers = await_sync(resolver.search_papers(body.query, limit=8))
            results = [_paper_to_dict(p) for p in papers]
    except Exception as e:
        app.logger.error(f"Search failed: {e}", exc_info=True)
        return jsonify({"error": "SEARCH_ERROR", "message": str(e)}), 500

    log_action(g.session_id, "search", {"query": body.query[:200], "id_type": id_type})
    return jsonify({"results": results, "id_type": id_type})


def _paper_to_dict(paper) -> dict:
    """Convert a Paper dataclass to a JSON-safe dict for API responses."""
    return {
        "paper_id":       paper.paper_id,
        "title":          paper.title,
        "abstract":       (paper.abstract or "")[:500],
        "year":           paper.year,
        "citation_count": paper.citation_count,
        "authors":        paper.authors[:5],
        "doi":            paper.doi,
        "url":            paper.url,
        "fields_of_study": paper.fields_of_study,
        "text_tier":      paper.text_tier,
    }
```

### Route: GET /api/graph/stream
```python
@app.route("/api/graph/stream")
@require_session
def graph_stream():
    """
    Server-Sent Events endpoint. Client connects here; events stream as graph builds.
    Events are persisted to job_events so reconnection works transparently.

    Query params:
        paper_id  — any format accepted by normalize_user_input()
        goal      — "general" | "quick_overview" | "deep_ancestry" (default: "general")

    SSE event shapes:
        {"status": "searching",  "message": "..."}
        {"status": "crawling",   "message": "..."}
        {"status": "analyzing",  "message": "..."}
        {"status": "finalizing", "message": "..."}
        {"status": "done",       "message": "...", "graph": {...}}
        {"status": "error",      "message": "..."}
    """
    paper_id_raw = request.args.get("paper_id", "").strip()
    user_goal = request.args.get("goal", "general")
    session_id = g.session_id

    if not paper_id_raw:
        return jsonify({"error": "paper_id query parameter is required"}), 400

    if user_goal not in ("general", "quick_overview", "deep_ancestry"):
        user_goal = "general"

    # [FIX: Gap 6] v1 used raw user input directly for the cache lookup and build_jobs
    # INSERT. Normalize first so the canonical S2 paper_id is used consistently.
    canonical_id, id_type = normalize_user_input(paper_id_raw)
    paper_id = canonical_id if canonical_id else paper_id_raw

    # Rate limiting
    # [FIX: Gap 5] Rate limiter key must match the actual HTTP method of this route (GET).
    allowed, headers = await_sync(
        arivu_rate_limiter.check(session_id, "GET /api/graph/stream")
    )
    if not allowed:
        return jsonify(arivu_rate_limiter.get_429_body(headers)), 429, headers

    # Check for recently cached graph (within GRAPH_CACHE_TTL_DAYS)
    from backend.config import config as _cfg
    # [FIX: Gap 6] Cache lookup now uses canonical paper_id instead of raw user input.
    cached_graph = db.fetchone(
        """
        SELECT g.graph_id, g.graph_json_url
        FROM graphs g
        JOIN session_graphs sg ON sg.graph_id = g.graph_id
        WHERE sg.session_id = %s
          AND g.seed_paper_id IN (
            SELECT paper_id FROM papers
            WHERE paper_id = %s OR doi = %s
          )
          AND g.computed_at > NOW() - INTERVAL '7 days'
        ORDER BY g.computed_at DESC
        LIMIT 1
        """,
        (session_id, paper_id, paper_id),
    )

    job_id = str(uuid.uuid4())

    # [FIX: Gap 7] v1 stored raw user input (paper_id_raw) in build_jobs.paper_id.
    # Storing canonical ID ensures the cache lookup JOIN on graphs.seed_paper_id works.
    db.execute(
        """
        INSERT INTO build_jobs (job_id, paper_id, session_id, status, created_at)
        VALUES (%s, %s, %s, 'pending', NOW())
        """,
        (job_id, paper_id[:200], session_id),
    )

    # If cached, stream it immediately and finish
    if cached_graph:
        from backend.r2_client import R2Client
        r2 = R2Client(_cfg)
        graph_data = r2.get_json(cached_graph["graph_json_url"])

        # [FIX: Gap 4] v1 streamed graph_data without checking for None. If R2 is
        # unconfigured or the key was deleted, get_json() returns None and the frontend
        # receives {"status": "done", "graph": null} — a silent crash. Fall through to
        # a fresh build instead.
        if graph_data is None:
            logger.warning(
                f"Cached graph {cached_graph['graph_id']} missing from R2 — "
                "falling through to fresh build"
            )
            # cached_graph is truthy but data is gone; fall through to background build
        else:
            def _cached_stream():
                payload = {"status": "done", "cached": True, "graph": graph_data}
                yield f"data: {json.dumps(payload)}\n\n"

            return Response(
                stream_with_context(_cached_stream()),
                mimetype="text/event-stream",
                headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
            )

    # Start background build thread
    def _background_build():
        engine = AncestryGraph()
        try:
            await_sync(engine.build_graph(paper_id, user_goal, job_id))
            db.execute(
                "UPDATE build_jobs SET status = 'done' WHERE job_id = %s",
                (job_id,),
            )
        except Exception as e:
            app.logger.error(f"Background build failed for job {job_id}: {e}", exc_info=True)
            db.execute(
                """
                INSERT INTO job_events (job_id, sequence, event_data, created_at)
                VALUES (%s, 1, %s::jsonb, NOW())
                """,
                (job_id, json.dumps({"status": "error", "message": str(e)[:500]})),
            )
            db.execute(
                "UPDATE build_jobs SET status = 'error' WHERE job_id = %s",
                (job_id,),
            )

    thread = Thread(target=_background_build, daemon=True)
    thread.start()

    log_action(session_id, "graph_build_start", {"paper_id": paper_id, "goal": user_goal})

    # Stream events from job_events as background thread writes them
    last_id_header = request.headers.get("Last-Event-ID", "0")

    def _event_stream():
        """
        Poll job_events and yield SSE frames.

        [FIX: Gap 18] v1 had no cleanup for abandoned clients. If the client
        disconnects mid-stream (tab close, navigation), the generator keeps polling
        the DB every second for up to 5 minutes, wasting connections. Flask's
        stream_with_context() raises GeneratorExit when the client disconnects;
        we catch it to log and exit cleanly.
        """
        sequence = int(last_id_header) if last_id_header.isdigit() else 0
        deadline = time.time() + 300   # 5-minute timeout

        try:
            while time.time() < deadline:
                events = db.fetchall(
                    """
                    SELECT id, event_data
                    FROM job_events
                    WHERE job_id = %s AND id > %s
                    ORDER BY id ASC
                    LIMIT 10
                    """,
                    (job_id, sequence),
                )

                for ev in events:
                    sequence = ev["id"]
                    data = ev["event_data"]
                    yield f"id: {sequence}\ndata: {json.dumps(data)}\n\n"
                    if data.get("status") in ("done", "error"):
                        return

                if not events:
                    yield ": keepalive\n\n"
                    time.sleep(1)
                else:
                    time.sleep(0.1)

            yield f"data: {json.dumps({'status': 'timeout', 'message': 'Graph build timed out after 5 minutes'})}\n\n"

        except GeneratorExit:
            # Client disconnected — clean up and exit silently
            app.logger.debug(f"SSE client disconnected for job {job_id}")
            return

    return Response(
        stream_with_context(_event_stream()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
```

### Route: GET /api/graph/\<paper_id\>
```python
@app.route("/api/graph/<paper_id>")
@require_session
def get_cached_graph(paper_id):
    """
    Return a previously built graph JSON from R2.
    Used by the gallery and for repeat visits.

    [FIX: Gap 9] This route was fully implemented in v1 but missing from the
    "What Phase 2 Produces" deliverables list and §17 "Done When" criteria.
    Both have been updated in v2.
    """
    row = db.fetchone(
        """
        SELECT graph_json_url FROM graphs
        WHERE seed_paper_id = %s
        AND computed_at > NOW() - INTERVAL '7 days'
        ORDER BY computed_at DESC LIMIT 1
        """,
        (paper_id,),
    )
    if not row:
        return jsonify({
            "error": "Graph not found. Use /api/graph/stream to build it."
        }), 404

    from backend.r2_client import R2Client
    from backend.config import config as _cfg
    r2 = R2Client(_cfg)
    graph_data = r2.get_json(row["graph_json_url"])
    if not graph_data:
        return jsonify({"error": "Graph data not available in storage"}), 404

    return jsonify(graph_data)
```

---

## §11 — scripts/test_pipeline.py

End-to-end integration test. Run this to verify Phase 2 works before committing.

```python
#!/usr/bin/env python3
"""
scripts/test_pipeline.py — Phase 2 integration test.

Tests the full paper resolution and graph build pipeline end-to-end.
Requires:
    - DATABASE_URL set in .env
    - NLP worker running at config.NLP_WORKER_URL
    - Network access to Semantic Scholar

Run: python scripts/test_pipeline.py
Exit 0 = all tests passed. Exit 1 = any test failed.
"""
import asyncio
import logging
import sys
import time

# Load .env before any config import
from dotenv import load_dotenv
load_dotenv()

sys.path.insert(0, ".")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("test_pipeline")

ATTENTION_DOI = "10.48550/arXiv.1706.03762"   # "Attention Is All You Need"
ATTENTION_ARXIV = "1706.03762"


async def run_tests() -> int:
    """Returns number of failures."""
    from backend.config import config
    from backend.api_client import SmartPaperResolver
    from backend.normalizer import normalize_user_input
    from backend.deduplicator import PaperDeduplicator
    import backend.db as db

    failures = 0
    passed = 0

    logger.info("=" * 60)
    logger.info("ARIVU PHASE 2 INTEGRATION TEST")
    logger.info("=" * 60)

    # ── Test 1: NLP worker health ─────────────────────────────────────────────
    logger.info("\n[1] NLP Worker Health")
    try:
        import httpx
        async with httpx.AsyncClient(timeout=10) as c:
            resp = await c.get(f"{config.NLP_WORKER_URL}/health")
            resp.raise_for_status()
            data = resp.json()
            assert data.get("status") == "ok", f"Expected status=ok, got: {data}"
            logger.info(f"  ✓ NLP worker healthy — model: {data.get('model')}")
            passed += 1
    except Exception as e:
        logger.error(f"  ✗ NLP worker unreachable: {e}")
        logger.error(f"    Start it with: cd nlp_worker && uvicorn app:app --port 7860")
        failures += 1

    # ── Test 2: Input normalization ───────────────────────────────────────────
    logger.info("\n[2] Input Normalization")
    test_cases = [
        ("10.1145/3292500.3330683", "doi"),
        ("1706.03762", "arxiv"),
        ("https://arxiv.org/abs/1706.03762", "arxiv"),
        ("https://www.semanticscholar.org/paper/Title/" + "a" * 40, "s2"),
        ("12345678", "pubmed"),
        ("Attention Is All You Need", "title"),
    ]
    for inp, expected_type in test_cases:
        _, id_type = normalize_user_input(inp)
        if id_type == expected_type:
            logger.info(f"  ✓ '{inp[:40]}' → {id_type}")
            passed += 1
        else:
            logger.error(f"  ✗ '{inp[:40]}' → {id_type} (expected {expected_type})")
            failures += 1

    # ── Test 3: Paper resolution ──────────────────────────────────────────────
    logger.info("\n[3] Paper Resolution (requires network)")
    resolver = SmartPaperResolver()
    seed_paper = None

    try:
        seed_paper = await resolver.resolve(ATTENTION_ARXIV, "arxiv")
        assert seed_paper.paper_id, "paper_id is empty"
        assert seed_paper.title, "title is empty"
        assert "Attention" in seed_paper.title or "attention" in seed_paper.title.lower(), \
            f"Unexpected title: {seed_paper.title}"
        logger.info(f"  ✓ Resolved: '{seed_paper.title[:60]}'")
        logger.info(f"    paper_id={seed_paper.paper_id[:12]}… year={seed_paper.year}")
        logger.info(f"    abstract={'yes' if seed_paper.abstract else 'no'}")
        passed += 1
    except Exception as e:
        logger.error(f"  ✗ Resolution failed: {e}")
        failures += 1

    # ── Test 4: Reference fetching ────────────────────────────────────────────
    logger.info("\n[4] Reference Fetching")
    if seed_paper:
        try:
            refs = await resolver.get_references(seed_paper.paper_id, limit=20)
            assert len(refs) > 0, "No references returned"
            logger.info(f"  ✓ Got {len(refs)} references for '{seed_paper.title[:40]}'")
            logger.info(f"    Sample: '{refs[0].title[:50]}'")
            passed += 1
        except Exception as e:
            logger.error(f"  ✗ Reference fetch failed: {e}")
            failures += 1
    else:
        logger.warning("  ⚠ Skipped — seed paper not resolved")

    # ── Test 5: NLP similarity ────────────────────────────────────────────────
    logger.info("\n[5] NLP Similarity (NLP worker)")
    try:
        import httpx
        from backend.config import config
        headers = {}
        if config.NLP_WORKER_SECRET:
            headers["Authorization"] = f"Bearer {config.NLP_WORKER_SECRET}"

        async with httpx.AsyncClient(timeout=30) as c:
            resp = await c.post(
                f"{config.NLP_WORKER_URL}/similarity_matrix",
                headers=headers,
                json={
                    "texts_a": [
                        "We propose a new attention mechanism that allows the model "
                        "to focus on relevant parts of the input sequence."
                    ],
                    "texts_b": [
                        "Multi-head attention allows the model to jointly attend to "
                        "information from different representation subspaces."
                    ],
                },
            )
            resp.raise_for_status()
            data = resp.json()
            score = data["max_pair"]["score"]
            assert score > 0.5, f"Expected similarity > 0.5, got {score:.3f}"
            logger.info(f"  ✓ Attention pair similarity: {score:.3f}")
            passed += 1
    except Exception as e:
        logger.error(f"  ✗ NLP similarity test failed: {e}")
        failures += 1

    # ── Test 6: Graph build (shallow) ─────────────────────────────────────────
    logger.info("\n[6] Graph Build (depth=1, quick_overview)")
    if seed_paper:
        try:
            from backend.graph_engine import AncestryGraph
            import backend.db as _db
            # Temporarily override max depth
            engine = AncestryGraph()
            job_id = "test-" + str(int(time.time()))
            # Create minimal build_jobs row so _emit() doesn't fail
            _db.execute(
                "INSERT INTO build_jobs (job_id, paper_id, session_id, status, created_at) "
                "VALUES (%s, %s, 'test', 'pending', NOW()) ON CONFLICT DO NOTHING",
                (job_id, seed_paper.paper_id),
            )
            graph_json = await engine.build_graph(
                seed_paper.paper_id,
                user_goal="quick_overview",
                job_id=job_id,
            )
            n_nodes = graph_json["metadata"]["total_nodes"]
            n_edges = graph_json["metadata"]["total_edges"]
            assert n_nodes >= 2, f"Graph too small: {n_nodes} nodes"
            assert n_edges >= 1, f"Graph has no edges"
            logger.info(f"  ✓ Graph built: {n_nodes} nodes, {n_edges} edges")
            # Verify all required metadata fields
            meta = graph_json["metadata"]
            for field in ("seed_paper_id", "seed_paper_title", "total_nodes",
                          "total_edges", "model_version", "graph_id"):
                assert field in meta, f"Missing metadata field: {field}"
            logger.info(f"  ✓ All metadata fields present")
            passed += 2
        except Exception as e:
            logger.error(f"  ✗ Graph build failed: {e}", exc_info=True)
            failures += 1
    else:
        logger.warning("  ⚠ Skipped — seed paper not resolved")

    # ── Summary ───────────────────────────────────────────────────────────────
    total = passed + failures
    logger.info("\n" + "=" * 60)
    logger.info(f"RESULTS: {passed}/{total} passed, {failures} failed")

    if failures:
        logger.error("\nFailed tests:")
        return failures
    else:
        logger.info("All tests passed! Phase 2 complete.")
        return 0


if __name__ == "__main__":
    code = asyncio.run(run_tests())
    sys.exit(code)
```

---

## §12 — tests/test_phase2.py

Pytest unit tests for Phase 2 modules. These run without network access.

```python
"""
tests/test_phase2.py — Unit tests for Phase 2 modules.

All tests are offline (no network, no NLP worker, no external APIs).
Database calls are not tested here — that is covered by test_pipeline.py.
"""
import pytest


# ─── Normalizer tests ─────────────────────────────────────────────────────────

class TestNormalizeUserInput:
    """normalize_user_input() correctly identifies all input types."""

    def setup_method(self):
        from backend.normalizer import normalize_user_input
        self.fn = normalize_user_input

    def test_bare_doi(self):
        cid, itype = self.fn("10.1145/3292500.3330683")
        assert itype == "doi"
        assert cid == "10.1145/3292500.3330683"

    def test_doi_url(self):
        cid, itype = self.fn("https://doi.org/10.1038/s41586-021-03275-y")
        assert itype == "doi"
        assert cid == "10.1038/s41586-021-03275-y"

    def test_doi_prefix(self):
        cid, itype = self.fn("doi:10.1145/12345")
        assert itype == "doi"
        assert cid == "10.1145/12345"

    def test_arxiv_bare(self):
        cid, itype = self.fn("1706.03762")
        assert itype == "arxiv"
        assert "1706" in cid

    def test_arxiv_url(self):
        cid, itype = self.fn("https://arxiv.org/abs/1706.03762")
        assert itype == "arxiv"
        assert "1706" in cid

    def test_arxiv_version_stripped(self):
        cid, itype = self.fn("2303.08774v2")
        assert itype == "arxiv"
        assert "v2" not in cid

    def test_s2_url(self):
        s2_id = "a" * 40
        cid, itype = self.fn(f"https://www.semanticscholar.org/paper/Title/{s2_id}")
        assert itype == "s2"
        assert cid == s2_id

    def test_s2_bare_id(self):
        s2_id = "a1b2c3" + "0" * 34
        cid, itype = self.fn(s2_id)
        assert itype == "s2"

    def test_pubmed_id(self):
        cid, itype = self.fn("12345678")
        assert itype == "pubmed"

    def test_pubmed_url(self):
        cid, itype = self.fn("https://pubmed.ncbi.nlm.nih.gov/12345678/")
        assert itype == "pubmed"
        assert cid == "12345678"

    def test_openalex_id(self):
        cid, itype = self.fn("W2741809807")
        assert itype == "openalex"

    def test_title_fallback(self):
        cid, itype = self.fn("Attention Is All You Need")
        assert itype == "title"
        assert "Attention" in cid

    def test_empty_string(self):
        cid, itype = self.fn("")
        assert itype == "title"


# ─── split_into_sentences tests ───────────────────────────────────────────────

class TestSplitIntoSentences:
    def setup_method(self):
        from backend.normalizer import split_into_sentences
        self.fn = split_into_sentences

    def test_empty_text_returns_empty(self):
        assert self.fn("") == []

    def test_single_sentence(self):
        result = self.fn("This is a single long sentence about machine learning.")
        assert len(result) >= 1

    def test_max_sentences_respected(self):
        text = " ".join([f"Sentence number {i} is here now." for i in range(100)])
        result = self.fn(text, max_sentences=10)
        assert len(result) <= 10

    def test_short_fragments_excluded(self):
        result = self.fn("Hi. This is a much longer sentence that should be included.")
        # "Hi." is too short (≤15 chars), should not appear as standalone sentence
        for s in result:
            assert len(s) > 15


# ─── Deduplicator tests ───────────────────────────────────────────────────────

class TestPaperDeduplicator:
    def setup_method(self):
        from backend.deduplicator import PaperDeduplicator
        self.dedup = PaperDeduplicator()

    def _s2_candidate(self, **kwargs) -> dict:
        defaults = {
            "_source":      "s2",
            "paper_id":     "a" * 40,
            "s2_id":        "a" * 40,
            "title":        "Test Paper",
            "abstract":     "Short abstract.",
            "year":         2020,
            "citation_count": 100,
            "authors":      ["Author One"],
            "doi":          "10.1234/test",
            "url":          "https://semanticscholar.org/paper/" + "a" * 40,
            "fields_of_study": ["Computer Science"],
            "references":   [],
        }
        defaults.update(kwargs)
        return defaults

    def test_single_candidate_returns_paper(self):
        paper = self.dedup.merge([self._s2_candidate()])
        assert paper.paper_id == "a" * 40
        assert paper.title == "Test Paper"

    def test_abstract_longest_wins(self):
        short = self._s2_candidate(abstract="Short.")
        long_oa = {
            "_source": "openalex",
            "openalex_id": "W123",
            "title": "Test Paper",
            "abstract": "A much longer abstract that has more information about the paper.",
            "year": 2020,
            "citation_count": 100,
            "authors": ["Author One"],
            "doi": "10.1234/test",
        }
        paper = self.dedup.merge([short, long_oa])
        assert "longer" in (paper.abstract or "")

    def test_missing_s2_id_raises(self):
        bad = {"_source": "openalex", "title": "No S2 ID here"}
        with pytest.raises((ValueError, Exception)):
            self.dedup.merge([bad])

    def test_titles_match_high_similarity(self):
        assert self.dedup.titles_match(
            "Attention Is All You Need",
            "attention is all you need"
        )

    def test_titles_match_rejects_different(self):
        assert not self.dedup.titles_match(
            "Attention Is All You Need",
            "Deep Residual Learning for Image Recognition"
        )


# ─── ArivuRateLimiter tests ───────────────────────────────────────────────────

class TestArivuRateLimiter:
    def setup_method(self):
        from backend.rate_limiter import ArivuRateLimiter
        import asyncio
        self.limiter = ArivuRateLimiter()
        self.loop = asyncio.new_event_loop()

    def teardown_method(self):
        self.loop.close()

    def _check(self, session_id: str, endpoint: str):
        return self.loop.run_until_complete(
            self.limiter.check(session_id, endpoint)
        )

    def test_unknown_endpoint_always_allowed(self):
        allowed, headers = self._check("sess1", "GET /unknown")
        assert allowed is True
        assert headers == {}

    def test_within_limit_allowed(self):
        allowed, headers = self._check("sess_fresh", "POST /api/search")
        assert allowed is True
        assert "X-RateLimit-Limit" in headers

    def test_exceeds_limit_blocked(self):
        # Exhaust the 30/min search limit
        for _ in range(30):
            self._check("sess_exhaust", "POST /api/search")
        allowed, headers = self._check("sess_exhaust", "POST /api/search")
        assert allowed is False
        assert "Retry-After" in headers

    def test_different_sessions_independent(self):
        # Exhaust session A
        for _ in range(30):
            self._check("sess_a", "POST /api/search")
        # Session B should still work
        allowed, _ = self._check("sess_b", "POST /api/search")
        assert allowed is True

    def test_graph_stream_key_is_get(self):
        # [FIX: Gap 5] Verify the rate limiter uses the correct HTTP method for
        # the graph stream endpoint. "POST /api/graph/stream" should be unknown
        # (always allowed), while "GET /api/graph/stream" should be rate-limited.
        allowed_post, _ = self._check("sess_test", "POST /api/graph/stream")
        assert allowed_post is True, "POST /api/graph/stream should not be in LIMITS"
        allowed_get, headers = self._check("sess_test", "GET /api/graph/stream")
        assert "X-RateLimit-Limit" in headers, "GET /api/graph/stream should be rate-limited"


# ─── R2Client no-op mode tests ────────────────────────────────────────────────

class TestR2ClientNoOp:
    """R2Client in no-op mode (no credentials) should not raise."""

    def setup_method(self):
        from backend.r2_client import R2Client

        class _FakeCfg:
            R2_ENABLED = False
            R2_BUCKET_NAME = "test-bucket"
            R2_ACCOUNT_ID = ""
            R2_ACCESS_KEY_ID = ""
            R2_SECRET_ACCESS_KEY = ""

        self.client = R2Client(_FakeCfg())

    def test_put_no_op(self):
        self.client.put("some/key", b"data")   # Should not raise

    def test_get_returns_none(self):
        assert self.client.get("some/key") is None

    def test_exists_returns_false(self):
        assert self.client.exists("some/key") is False

    def test_put_json_no_op(self):
        self.client.put_json("some/key.json", {"a": 1})   # Should not raise

    def test_get_json_returns_none(self):
        assert self.client.get_json("some/key.json") is None
```

---

## §13 — .env.example additions

Add these lines to the existing `.env.example` file created in Phase 1.

```bash
# ── Phase 2 additions ─────────────────────────────────────────────────────────
# Note: S2_API_KEY, OPENALEX_EMAIL, GROQ_API_KEY, CORE_API_KEY, CROSSREF_MAILTO,
# R2_*, and NLP_WORKER_* vars are already present in Phase 1 .env.example.
# The entries below supplement Phase 1 with Phase 2-specific guidance only.

# Semantic Scholar API key (free — request at https://www.semanticscholar.org/product/api)
# Without this, rate limit is 1 req/s. With key, 10 req/s.
S2_API_KEY=your_s2_key_here

# OpenAlex polite pool (add your email to get 10 req/s instead of throttled)
# Already in Phase 1 .env.example — confirm it is set.
OPENALEX_EMAIL=you@yourdomain.com

# CrossRef polite pool (same format)
# Already in Phase 1 .env.example — confirm it is set.
CROSSREF_MAILTO=you@yourdomain.com

# CORE API key (free at https://core.ac.uk/services/api)
CORE_API_KEY=your_core_key_here

# Cloudflare R2 (free tier: 10 GB storage, 1M requests/month)
# Create a bucket at dash.cloudflare.com → R2
# Then create API token with Read+Write on that bucket
R2_ACCOUNT_ID=your_cloudflare_account_id
R2_BUCKET_NAME=arivu-graphs
R2_ACCESS_KEY_ID=your_r2_access_key
R2_SECRET_ACCESS_KEY=your_r2_secret_key

# Groq API key (free at console.groq.com) — enables LLM mutation classification
# Without this, all edges default to similarity-based classification
GROQ_API_KEY=your_groq_api_key

# NLP worker secret — must match the value set in HuggingFace Spaces secrets
# Generate: python -c "import secrets; print(secrets.token_hex(32))"
# This is already in Phase 1 .env.example — verify it is set
# NLP_WORKER_SECRET=already_set_in_phase1

# NLP worker URL (leave as default for local dev)
# NLP_WORKER_URL=http://localhost:7860  ← already in Phase 1 .env.example

# [FIX: Gap 23] NLP_WORKER_TIMEOUT default in config.py is 30 seconds, which is
# too short for CPU inference on HuggingFace Spaces free tier.
# Encoding 512 texts takes ~60-90 seconds on CPU.
# Set this to at least 90 seconds in your .env:
NLP_WORKER_TIMEOUT=90
```

---

## §14 — nlp_worker/Dockerfile (update)

Replace the Phase 1 stub with the real Dockerfile for HuggingFace Spaces deployment.

```dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install dependencies first (for layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download the model so it's baked into the image
# HuggingFace Spaces caches this between restarts
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"

# Copy app code
COPY app.py .

EXPOSE 7860

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860", "--workers", "1"]
```

---

## §15 — What to Update in Existing Files

### app.py — full import block (replace the Phase 1 import block)
```python
"""
app.py — Arivu Flask application factory and routes.
"""
import json
import logging
import time
import uuid
from threading import Thread

import structlog
from flask import Flask, Response, g, jsonify, request, stream_with_context

from backend.config import config
from backend.session_manager import require_session
from backend.rate_limiter import arivu_rate_limiter
import backend.db as db
from backend.utils import (
    await_sync, load_gallery_index, load_precomputed_graph, log_action,
)
from exceptions import register_error_handlers

structlog.configure(
    processors=[
        structlog.stdlib.add_log_level,
        structlog.stdlib.TimeStamper(fmt="iso"),
        structlog.dev.ConsoleRenderer(),
    ],
    wrapper_class=structlog.stdlib.BoundLogger,
    logger_factory=structlog.stdlib.LoggerFactory(),
)

logger = logging.getLogger(__name__)
```

### scripts/test_pipeline.py — remove the Phase 1 stub comment
The file should contain only the code from §11 above.

### conftest.py — update for async test support
```python
# tests/conftest.py
# [FIX: Gap 25] Updated to support async tests in test_phase2.py.
# pytest-asyncio requires asyncio_mode="auto" (set in pytest.ini) for
# coroutine test functions. The conftest sets up the path and env.

import sys
import os
from pathlib import Path

# Add project root to sys.path so all backend imports resolve
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
load_dotenv()
```

### pytest.ini — add asyncio_mode
```ini
# pytest.ini
# [FIX: Gap 25] asyncio_mode = auto is required for pytest-asyncio to collect
# and run async test functions without the @pytest.mark.asyncio decorator on
# every single test. Without this, async tests raise "coroutine was never awaited".
[pytest]
asyncio_mode = auto
testpaths = tests
```

---

## §16 — Build Sequence

Run each step in order. Do not skip steps. Do not proceed to the next step if a step fails.

```bash
# ============================================================
# PREREQUISITES
# ============================================================

# 0. Verify Phase 1 is complete
python -m pytest tests/test_smoke.py -v
# Must show: 3 passed, 0 failed

# ============================================================
# ENVIRONMENT SETUP
# ============================================================

# 1. Add Phase 2 env vars to .env
# Copy the additions from §13 above into .env
# Minimum required: S2_API_KEY (or accept 1 req/s rate limit)
# Optional for now: GROQ_API_KEY, R2_* (features degrade gracefully without them)
# NLP_WORKER_SECRET must match what you set in the NLP worker
# IMPORTANT: Set NLP_WORKER_TIMEOUT=90 (default 30s is too short for CPU inference)

# ============================================================
# NLP WORKER SETUP
# ============================================================

# 2. Set up NLP worker dependencies
cd nlp_worker
pip install -r requirements.txt
# This installs sentence-transformers, torch, fastapi, uvicorn
# Takes ~2 minutes on first install (torch download)
cd ..

# 3. Start NLP worker (keep this terminal open)
cd nlp_worker
NLP_WORKER_SECRET=your_secret_here uvicorn app:app --host 0.0.0.0 --port 7860 --reload &
cd ..
# Wait ~10 seconds for the model to load
# Verify: curl http://localhost:7860/health
# Expected: {"status":"ok","model":"all-MiniLM-L6-v2","dimensions":384}

# ============================================================
# MAIN APP
# ============================================================

# 4. Install Phase 2 dependencies (httpx, networkx, scikit-learn already in requirements.txt)
pip install -r requirements.txt

# 5. Run unit tests (no network required)
python -m pytest tests/test_phase2.py -v
# All tests must pass before proceeding

# 6. Run all tests (includes smoke tests from Phase 1)
python -m pytest tests/ -v
# Expected: test_smoke.py (3 passed) + test_phase2.py (N passed)

# 7. Run end-to-end integration test (requires network + NLP worker running)
python scripts/test_pipeline.py
# Expected final line: "All tests passed! Phase 2 complete."
# If paper resolution fails: check S2_API_KEY in .env and network access
# If NLP worker fails: verify it is running on port 7860

# ============================================================
# COMMIT
# ============================================================

# 8. Commit Phase 2 implementation
git add -A
git commit -m "[phase2] data layer, NLP worker, graph build pipeline"

# 9. Update CONTEXT.md: Phase 2 → Completed, Phase 3 → In Progress
git add CONTEXT.md
git commit -m "[context] Phase 2 complete"
```

---

## §17 — Done When

Phase 2 is complete when **all six are simultaneously true:**

1. `python -m pytest tests/ -v` → **all tests passed, 0 failed**
   (includes Phase 1 smoke tests + Phase 2 unit tests)
2. `python scripts/test_pipeline.py` → **"All tests passed! Phase 2 complete."** (exit code 0)
3. NLP worker health: `curl http://localhost:7860/health` → `{"status":"ok",...}`
4. `git log --oneline` shows the two commits from §16 steps 8 and 9, both on branch `main`
5. `CONTEXT.md` shows Phase 2 under "Completed", Phase 3 under "In Progress"
6. `GET /api/graph/<paper_id>` returns a previously built graph (or 404 if none built yet)

<!-- [FIX: Gap 9] Added criterion 6 for GET /api/graph/<paper_id> which was missing from Done When in v1. -->

Do not proceed to Phase 3 until all six are true.

---

## §18 — What NOT To Do In This Phase

- Do not import `sentence_transformers`, `torch`, or any ML library in `app.py` or any `backend/` file
- Do not implement `backend/pruning.py` — that is Phase 3
- Do not implement `backend/dna_profiler.py`, `backend/diversity_scorer.py`, `backend/orphan_detector.py` — Phase 4
- Do not implement `backend/llm_client.py`, `backend/chat_guide.py` — Phase 4
- Do not implement any HTML templates — Phase 3
- Do not run `scripts/precompute_gallery.py` — Phase 5
- Do not add `/api/prune`, `/api/dna`, `/api/diversity`, `/api/chat`, `/api/genealogy` routes
- Do not add auth, login, registration, billing, or payments
- Do not hard-code any API keys or secrets — always read from `config`
- Do not increase `--workers` in Procfile — Neon connection cap applies
- Do not panic if Groq is not configured — edges will auto-classify from similarity score
- Do not panic if R2 is not configured — R2Client runs in no-op mode and logs a warning
- Do not implement full-text extraction (PDF fetch, section parsing, text_tier 1/2) — this is Phase 3.
  In Phase 2, all text is abstract (text_tier 3) or title-only (text_tier 4). The NLP pipeline
  degrades gracefully — lower text_tier produces lower similarity scores and more "incidental"
  classifications, which is correct and expected.

---

## §19 — Common Failure Modes & Fixes

### `ModuleNotFoundError: No module named 'httpx'`
```bash
pip install -r requirements.txt
```

### `NLP worker unreachable` in test_pipeline.py
```bash
# Verify NLP worker is running
curl http://localhost:7860/health
# If not running:
cd nlp_worker && uvicorn app:app --port 7860
```

### `NLP worker timeout` during graph build
```bash
# [FIX: Gap 23] The default NLP_WORKER_TIMEOUT of 30s is too short for CPU inference.
# HuggingFace Spaces free tier takes ~60-90s for 512 texts.
# Add to .env:
NLP_WORKER_TIMEOUT=90
# For very large graphs (300+ papers), consider 120s.
```

### `PaperNotFoundError` in test_pipeline.py
- Check network access to `api.semanticscholar.org`
- If S2_API_KEY is not set, you are rate-limited to 1 req/s — wait and retry
- arXiv ID `1706.03762` is well-known; S2 always has it

### `ValueError: Cannot build Paper without a Semantic Scholar corpus ID`
- S2 returned no data for this paper (unusual for Attention paper)
- Check `config.S2_API_KEY` is set correctly in `.env`

### `psycopg2.OperationalError: could not connect to server`
- Docker not running (local dev) or DATABASE_URL wrong
- Run `python scripts/migrate.py` to verify DB connectivity

### `401 Invalid NLP worker secret` in integration test
- `NLP_WORKER_SECRET` in `.env` must match what you started the NLP worker with
- Set to empty string in both places to disable auth during dev:
  `NLP_WORKER_SECRET=`

### R2 not configured — no error, graphs not cached
- This is fine for local dev. Graphs are still built and returned in the SSE stream.
- The `get_cached_graph` route will return 404 until R2 is configured.
- To enable: set all `R2_*` vars in `.env`.

### Session cookie not set in local dev (graph builds but session resets)
- Check that `FLASK_DEBUG=1` is set in `.env` (not `FLASK_DEBUG_MODE`).
- With `FLASK_DEBUG=1`, the session cookie is set with `secure=False`, which is
  required for HTTP (local dev). Without it, the cookie requires HTTPS and is silently
  dropped by the browser.

---

## §20 — Known Spec Divergences & CLAUDE.md

### CLAUDE.md

Create this file at the project root before starting Phase 2 implementation.
Claude Code reads it at the start of every session.

```markdown
# CLAUDE.md — Arivu project rules for Claude Code

## Architecture non-negotiables
1. The main server (app.py, backend/) NEVER imports sentence_transformers, torch, or any ML library.
   These live exclusively in nlp_worker/app.py. Violating this causes OOM on Koyeb startup.
2. All secrets are read from config (backend/config.py). Never hardcode keys.
3. Never increase --workers in Procfile. Neon has a connection cap.

## Git rules
- Commit after each phase is complete, not during.
- Commit message format: [phaseN] brief description
- Two commits per phase: one for implementation, one for CONTEXT.md update.
- Never commit .env or any file containing secrets.

## Current phase
See CONTEXT.md for which phase is active. Only implement what the current phase spec says.
Do not read ahead into future phase specs.

## Key file locations
- Phase spec:         PHASE_2.md (current), PHASE_3.md (next — do not open yet)
- Complete spec:      ARIVU_COMPLETE_SPEC_v3.md (reference only, never implement all at once)
- DB migration:       scripts/migrate.py
- NLP worker:         nlp_worker/app.py (separate process, port 7860)
- Config:             backend/config.py (all env vars documented here)

## Testing
- Unit tests (offline): python -m pytest tests/test_phase2.py -v
- Integration test:     python scripts/test_pipeline.py
- Both must pass before committing.
```

---

### Known naming divergences (spec vs code)

**`base_confidence` vs `inheritance_confidence`:**
The complete spec diagram §5.11 labels the final edge confidence score as
`inheritance_confidence` in one place. The Phase 1 SQL migration (authoritative source)
creates the column as `base_confidence`. Phase 2 code uses `base_confidence` throughout
(`nlp_pipeline.py`, `edge_analysis` INSERT, `EdgeAnalysis` dataclass). This is **correct**.
If the complete spec is revised to unify on one name, update the migration and all
Phase 2 references together. Do not change Phase 2 code to match the spec diagram
without also updating the migration — a column rename without migration will break
all INSERT/SELECT statements.

**`"groq"` vs `"groq_llm"` rate limiter key:**
The complete spec §5.10 uses `"groq_llm"` as the key in `CoordinatedRateLimiter.LIMITS`
in one diagram. Phase 2 consistently uses `"groq"` in both `LIMITS` (rate_limiter.py)
and `throttle("groq")` calls (nlp_pipeline.py). The two Phase 2 files are internally
consistent — there is no runtime `KeyError`. If the spec is revised to use `"groq_llm"`,
update both files simultaneously.

**NLI pipeline:**
Natural Language Inference is absent from Phase 2 by design. See §8 for rationale.
It can be added as Stage 1b in Phase 3+ by adding `/nli_batch` to the NLP worker.

**Full-text extraction:**
PDF fetching and section-structured text extraction (text_tier 1/2) are absent from
Phase 2 by design. See §18. These will be implemented in Phase 3 alongside the pruning
engine, which benefits most from richer text signals.
