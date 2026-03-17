"""
api_client.py — SmartPaperResolver: paper data from multiple academic APIs.

Architecture:
    SmartPaperResolver.resolve(paper_id, id_type) -> Paper
    SmartPaperResolver.resolve_batch(paper_ids) -> list[Paper]
    SmartPaperResolver.get_references(paper_id, limit) -> list[Paper]
    SmartPaperResolver.search_papers(query, limit) -> list[Paper]

Source priority for metadata (spec section 5.3):
    Title / year / DOI / venue: CrossRef > S2 > OpenAlex
    Abstract: longest of (S2, OpenAlex reconstructed)
    References: UNION(S2, OpenAlex) deduplicated by DOI
    Citation count: S2 only
    Full text: arXiv PDF > Europe PMC > CORE > Unpaywall

All HTTP calls go through CoordinatedRateLimiter to respect upstream limits.
All calls are async. Flask routes use await_sync() to bridge sync/async.

Caching:
    Resolved papers are cached in the papers table by paper_id.
    Cache TTL is 30 days (field-dependent per spec section 5.11). Embeddings cached separately.
"""
import asyncio
import hashlib
import json
import logging
import re
import threading
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


# Semantic Scholar rate limit:
# No API key → 1 req/sec. With API key → 10 req/sec.
# 1.1s delay gives a small buffer above the 1 req/sec limit.
# In Tier 2 mode (OpenAlex-primary), S2 calls are optional enrichment
# and use a shorter delay since we don't depend on them succeeding.
async def _s2_delay() -> None:
    """Sleep between S2 API calls when no API key is configured.

    In Tier 2 (no S2 key), we DON'T add extra delay beyond what the
    CoordinatedRateLimiter enforces (1 req/s). The old 1.1s delay was
    redundant with the limiter and wasted time. The limiter handles
    actual rate enforcement; this function is now a no-op.
    """
    # The CoordinatedRateLimiter handles all rate limiting for S2.
    # No additional sleep needed — the limiter's SlidingWindow(1, 1)
    # already enforces 1 req/s without API key.
    pass


_DEDUP = PaperDeduplicator()

# Semantic Scholar fields we always request
_S2_FIELDS = (
    "paperId,title,abstract,year,citationCount,fieldsOfStudy,"
    "authors,externalIds,url,references"
)

# Semantic Scholar batch fields — must include "references" for BFS expansion.
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

    3-Tier Architecture:
        Tier 1: S2_API_KEY set → S2-primary, full speed (10 req/s)
        Tier 2: No S2 key → OpenAlex-primary, S2 unauthenticated for enrichment
                After first S2 429 → skip S2 entirely for rest of build
        Tier 3: No APIs working → minimal graph (~30 nodes)

    Usage:
        resolver = SmartPaperResolver()
        paper = await resolver.resolve("1706.03762", "arxiv")
        refs   = await resolver.get_references(paper.paper_id, limit=50)
    """

    def __init__(self):
        self._http: Optional[httpx.AsyncClient] = None
        # Adaptive S2 availability tracking (3-tier system)
        # Thread-safe: resolver is a module-level singleton shared across build threads
        self._tier_lock = threading.Lock()
        self._s2_skip_until: float = 0.0    # timestamp; skip S2 calls until this time
        self._s2_consecutive_429s: int = 0   # track 429 frequency
        self._build_tier: int = 0            # 0=not detected, 1/2/3=active tier

    @property
    def s2_is_usable(self) -> bool:
        """Check if S2 API is currently usable (not in backoff). Thread-safe."""
        if config.S2_API_KEY:
            return True  # Tier 1: always usable with key
        with self._tier_lock:
            return time.time() >= self._s2_skip_until

    def mark_s2_down(self, duration: int = 300) -> None:
        """After S2 429, skip all S2 calls for `duration` seconds. Thread-safe."""
        with self._tier_lock:
            self._s2_skip_until = time.time() + duration
            self._s2_consecutive_429s += 1
            count = self._s2_consecutive_429s
        logger.info(
            f"S2 marked as down for {duration}s (429 #{count}) "
            f"— switching to OpenAlex-primary mode"
        )

    def detect_tier(self) -> int:
        """
        Detect current operational tier at build start.
        Called once per build — sets self._build_tier. Thread-safe.

        Without an S2 API key, we proactively skip S2 to avoid wasting 5+ seconds
        per batch on rate-limited 429 failures. S2 without a key has a 1 req/s limit;
        with 5 concurrent papers expanding at depth 2, the rate limiter serializes
        all 5 S2 attempts (5+ seconds wasted), and they all 429 anyway. Going straight
        to OpenAlex (9 req/s) is both faster and more reliable.
        """
        with self._tier_lock:
            if config.S2_API_KEY:
                self._build_tier = 1
            else:
                # No API key → proactively skip S2 for this build.
                # Use max() to avoid shortening an existing mark_s2_down() window.
                # This avoids the 5-second rate-limiter penalty of trying S2
                # just to get 429'd on every concurrent BFS expansion.
                self._s2_skip_until = max(self._s2_skip_until, time.time() + 60)
                self._build_tier = 2
            tier = self._build_tier
        tier_label = {1: "S2-primary", 2: "OpenAlex-primary", 3: "OpenAlex-only"}
        logger.info(f"API tier detected: Tier {tier} ({tier_label.get(tier, '?')})")
        return tier

    def reset_for_new_build(self) -> None:
        """Reset per-build state. Called at the start of each build. Thread-safe."""
        with self._tier_lock:
            self._s2_consecutive_429s = 0
        # Don't reset _s2_skip_until — it's time-based and shared across builds

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

    @staticmethod
    def _oa_headers() -> dict:
        """Standard headers for all OpenAlex requests."""
        headers = {}
        if config.OPENALEX_EMAIL:
            headers["User-Agent"] = f"Arivu/1.0 (mailto:{config.OPENALEX_EMAIL})"
        return headers

    @staticmethod
    def _oa_params(params: dict) -> dict:
        """Inject OpenAlex API key into query params if configured."""
        if config.OPENALEX_API_KEY:
            params["api_key"] = config.OPENALEX_API_KEY
        return params

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
            # S2 couldn't resolve — try OpenAlex-only for DOI/arXiv types
            if id_type in (ID_TYPE_DOI, ID_TYPE_ARXIV):
                paper = await self._resolve_without_s2(identifier, id_type)
                if paper:
                    return paper
            # Title search: _to_s2_id may have found results via OpenAlex but
            # couldn't convert to S2 ID (S2 is down). Try direct OpenAlex search.
            if id_type == ID_TYPE_TITLE:
                results = await self._search_openalex(identifier, limit=1)
                if results and results[0].doi:
                    paper = await self._resolve_without_s2(results[0].doi, ID_TYPE_DOI)
                    if paper:
                        return paper
                elif results:
                    # No DOI but have paper data — return directly
                    return results[0]
            raise PaperNotFoundError(identifier)

        # Check DB cache
        cached = self._load_from_cache(s2_id)
        if cached:
            logger.debug(f"Cache hit: {s2_id[:8]}...")
            return cached

        # Fetch from S2 (primary)
        s2_data = await self._fetch_s2(s2_id)

        if not s2_data:
            # S2 fully rate-limited — try building Paper from OpenAlex only
            paper = await self._resolve_via_openalex(s2_id, identifier, id_type)
            if paper:
                return paper
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
        Resolve multiple paper IDs. Checks DB cache first, then S2 batch API.

        In Tier 2/3 (S2 down): skips the S2 batch call entirely.
        Papers from OpenAlex were already cached in _get_openalex_references(),
        so DB cache hits handle most papers. Papers without cache entries
        are returned with minimal metadata (just the ID from the graph).
        """
        if not paper_ids:
            return []

        # Split into chunks of 500 (S2 batch limit)
        chunks = [paper_ids[i:i+500] for i in range(0, len(paper_ids), 500)]
        all_papers = []

        for chunk in chunks:
            # Batch DB cache lookup — single query instead of N individual ones.
            # For depth-2 expansion with 50 papers × 50 refs each, this reduces
            # 2,500 DB round trips down to ~5 (one per chunk of 500).
            cached_ids = set()
            try:
                rows = db.fetchall(
                    """
                    SELECT * FROM papers
                    WHERE paper_id = ANY(%s)
                      AND created_at > NOW() - INTERVAL '30 days'
                    """,
                    (chunk,),
                )
                for row in rows:
                    paper = Paper.from_db_row(row)
                    all_papers.append(paper)
                    cached_ids.add(paper.paper_id)
            except Exception as e:
                logger.debug(f"Batch cache load failed: {e}")
                # Fallback to individual lookups
                for pid in chunk:
                    cached = self._load_from_cache(pid)
                    if cached:
                        all_papers.append(cached)
                        cached_ids.add(pid)

            missing = [p for p in chunk if p not in cached_ids]
            if not missing:
                continue

            # Skip S2 batch if S2 is down (Tier 2 after 429, or Tier 3)
            if not self.s2_is_usable:
                logger.debug(
                    f"S2 in backoff — skipping batch resolve for {len(missing)} papers "
                    f"(already cached from OpenAlex: {len(cached_ids)})"
                )
                # Return stub papers for uncached IDs so BFS can continue
                for pid in missing:
                    # Try to find by DOI in our cache (OpenAlex papers stored with DOI)
                    try:
                        doi_row = db.fetchone(
                            "SELECT * FROM papers WHERE doi IS NOT NULL AND paper_id = %s",
                            (pid,),
                        )
                        if doi_row:
                            all_papers.append(Paper.from_db_row(doi_row))
                            continue
                    except Exception:
                        pass
                    # Last resort: stub paper so BFS doesn't break
                    all_papers.append(Paper(
                        paper_id=pid,
                        title="(Metadata pending)",
                        text_tier=4,
                    ))
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

        3-Tier routing:
          Tier 1 (S2 key): S2-primary, OpenAlex supplement if sparse
          Tier 2 (no key, S2 usable): Try S2 once, no retries. On 429→mark down→OpenAlex
          Tier 2 (no key, S2 down): OpenAlex-primary, skip S2 entirely
          Tier 3: OpenAlex only
        """
        # If S2 is marked as down (post-429 backoff), go straight to OpenAlex
        if not self.s2_is_usable:
            logger.debug(f"S2 in backoff — using OpenAlex directly for {s2_paper_id[:12]}…")
            return await self._get_openalex_references(s2_paper_id, limit=limit)

        # Attempt S2 (Tier 1 or Tier 2 first-try)
        client = await self._client()
        url = f"https://api.semanticscholar.org/graph/v1/paper/{s2_paper_id}/references"
        params = {
            "fields": "paperId,title,abstract,year,citationCount,externalIds",
            "limit": min(limit, 100),
        }
        headers = {}
        if config.S2_API_KEY:
            headers["x-api-key"] = config.S2_API_KEY

        # Tier 2: use fast delay (0.3s) since S2 is optional enrichment
        is_tier2 = not config.S2_API_KEY
        await _s2_delay()
        await coordinated_rate_limiter.throttle("semantic_scholar")
        try:
            resp = await client.get(url, params=params, headers=headers)
            if resp.status_code == 429:
                await coordinated_rate_limiter.record_rate_limit("semantic_scholar")
                if is_tier2:
                    # Tier 2: first 429 → mark S2 as down for 5 min, skip for rest of build
                    self.mark_s2_down(duration=300)
                logger.info(f"S2 references 429 for {s2_paper_id[:12]}…, falling back to OpenAlex")
                return await self._get_openalex_references(s2_paper_id, limit=limit)
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPStatusError as e:
            logger.warning(f"S2 references fetch failed for {s2_paper_id}: {e}")
            if is_tier2:
                self.mark_s2_down(duration=180)  # HTTP error → skip S2 for 3 min
            return await self._get_openalex_references(s2_paper_id, limit=limit)
        except Exception as e:
            logger.warning(f"S2 references request failed for {s2_paper_id}: {e}")
            if is_tier2:
                self.mark_s2_down(duration=180)
            return await self._get_openalex_references(s2_paper_id, limit=limit)

        refs: list[Paper] = []
        if not data:
            return refs
        for item in (data.get("data") or []):
            if not item:
                continue
            cited = item.get("citedPaper") or {}
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

        # S2 returned too few references — supplement with OpenAlex
        # This is common for non-CS papers where S2 has poor coverage
        if len(refs) < 5:
            logger.info(
                f"S2 returned only {len(refs)} refs for {s2_paper_id[:12]}…, "
                f"supplementing with OpenAlex"
            )
            oa_refs = await self._get_openalex_references(s2_paper_id, limit=limit)
            existing_ids = {r.paper_id for r in refs}
            for r in oa_refs:
                if r.paper_id not in existing_ids:
                    refs.append(r)
                    existing_ids.add(r.paper_id)

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

        is_tier2 = not config.S2_API_KEY
        # Skip S2 search if S2 is in backoff
        if not self.s2_is_usable:
            return await self._search_openalex(query, limit)

        await _s2_delay()
        await coordinated_rate_limiter.throttle("semantic_scholar")
        try:
            resp = await client.get(url, params=params, headers=headers)
            if resp.status_code == 429:
                await coordinated_rate_limiter.record_rate_limit("semantic_scholar")
                if is_tier2:
                    self.mark_s2_down(duration=300)
                logger.info(f"S2 search 429, falling back to OpenAlex for '{query}'")
                return await self._search_openalex(query, limit)
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPStatusError as e:
            logger.warning(f"S2 search failed for '{query}': {e}, trying OpenAlex")
            if is_tier2:
                self.mark_s2_down(duration=180)
            return await self._search_openalex(query, limit)

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
        """Translate any identifier type to a Semantic Scholar corpus ID.

        In Tier 2 (no S2 key, S2 down), returns None quickly so the caller
        can fall through to _resolve_without_s2() which uses OpenAlex.
        """
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
            # Title search — search_papers has built-in OpenAlex fallback
            results = await self.search_papers(identifier, limit=1)
            if not results:
                return None
            pid = results[0].paper_id
            # S2 IDs are 40-char hex; OpenAlex fallback returns DOI as paper_id
            if re.match(r'^[0-9a-f]{40}$', pid, re.IGNORECASE):
                return pid
            # Got a DOI from OpenAlex fallback — resolve it to S2 ID
            if results[0].doi:
                return await self._to_s2_id(results[0].doi, ID_TYPE_DOI)
            return None

        if id_type == ID_TYPE_OPENALEX:
            # OpenAlex ID → get DOI via OpenAlex API → resolve DOI to S2
            client = await self._client()
            await coordinated_rate_limiter.throttle("openalex")
            try:
                resp = await client.get(
                    f"https://api.openalex.org/works/{identifier}",
                    params=self._oa_params({"select": "id,doi"}),
                    headers=self._oa_headers(),
                )
                if resp.status_code == 200:
                    doi_raw = resp.json().get("doi") or ""
                    doi = doi_raw.replace("https://doi.org/", "").replace("http://doi.org/", "")
                    if doi:
                        return await self._to_s2_id(doi, ID_TYPE_DOI)
            except Exception:
                pass
            return None

        prefix = prefix_map.get(id_type)
        if not prefix:
            return None

        # Skip S2 translation if S2 is in backoff — let caller use OpenAlex path
        if not self.s2_is_usable:
            logger.debug(f"S2 in backoff — skipping ID translation for {prefix}:{identifier}")
            return None

        s2_ref = f"{prefix}:{identifier}"
        url = f"https://api.semanticscholar.org/graph/v1/paper/{s2_ref}"
        params = {"fields": "paperId"}

        is_tier2 = not config.S2_API_KEY
        max_attempts = 1 if is_tier2 else 3

        for attempt in range(max_attempts):
            await _s2_delay()
            await coordinated_rate_limiter.throttle("semantic_scholar")
            try:
                resp = await client.get(url, params=params, headers=headers)
                if resp.status_code in (404, 400):
                    return None
                if resp.status_code == 429:
                    if is_tier2:
                        self.mark_s2_down(duration=300)
                        return None
                    wait = min(3 * (2 ** attempt), 10)
                    logger.debug(f"S2 429 on ID translate, retrying in {wait}s (attempt {attempt+1}/{max_attempts})")
                    await coordinated_rate_limiter.record_rate_limit("semantic_scholar", retry_after=wait)
                    await asyncio.sleep(wait)
                    continue
                resp.raise_for_status()
                return resp.json().get("paperId")
            except Exception as e:
                logger.debug(f"S2 ID translation failed ({s2_ref}): {e}")
                if is_tier2:
                    self.mark_s2_down(duration=180)
                return None
        return None

    async def _fetch_s2(self, s2_id: str) -> Optional[dict]:
        """Fetch full metadata for a single paper from Semantic Scholar.

        In Tier 2 (no API key): reduces retries from 3 to 1 and uses fast delay.
        After a 429 in Tier 2, marks S2 as down to skip future calls.
        """
        # Skip entirely if S2 is in backoff
        if not self.s2_is_usable:
            return None

        client = await self._client()
        url = f"https://api.semanticscholar.org/graph/v1/paper/{s2_id}"
        params = {"fields": _S2_FIELDS}
        headers = {"x-api-key": config.S2_API_KEY} if config.S2_API_KEY else {}

        is_tier2 = not config.S2_API_KEY
        max_attempts = 1 if is_tier2 else 3  # Tier 2: no retries (fast fail)

        for attempt in range(max_attempts):
            await _s2_delay()
            await coordinated_rate_limiter.throttle("semantic_scholar")
            try:
                resp = await client.get(url, params=params, headers=headers)
                if resp.status_code == 404:
                    return None
                if resp.status_code == 429:
                    if is_tier2:
                        self.mark_s2_down(duration=300)
                        return None  # Don't retry in Tier 2
                    wait = min(3 * (2 ** attempt), 10)
                    logger.debug(f"S2 429 on fetch, retrying in {wait}s (attempt {attempt+1}/{max_attempts})")
                    await coordinated_rate_limiter.record_rate_limit("semantic_scholar", retry_after=wait)
                    await asyncio.sleep(wait)
                    continue
                resp.raise_for_status()
                return self._parse_s2_response(resp.json())
            except httpx.HTTPStatusError as e:
                logger.warning(f"S2 fetch failed for {s2_id}: {e}")
                if is_tier2:
                    self.mark_s2_down(duration=180)
                return None
        return None

    async def _fetch_s2_batch(self, s2_ids: list[str]) -> list[dict]:
        """
        Fetch up to 500 papers in one S2 batch POST call.
        Skips entirely if S2 is in backoff (Tier 2/3).
        """
        if not self.s2_is_usable:
            return []

        client = await self._client()
        url = "https://api.semanticscholar.org/graph/v1/paper/batch"
        params = {"fields": _S2_BATCH_FIELDS}
        headers = {"x-api-key": config.S2_API_KEY} if config.S2_API_KEY else {}
        body = {"ids": s2_ids}

        is_tier2 = not config.S2_API_KEY
        await _s2_delay()
        await coordinated_rate_limiter.throttle("semantic_scholar")
        try:
            resp = await client.post(url, json=body, params=params, headers=headers)
            if resp.status_code == 429:
                await coordinated_rate_limiter.record_rate_limit("semantic_scholar")
                if is_tier2:
                    self.mark_s2_down(duration=300)
                return []
            resp.raise_for_status()
            items = resp.json()
        except Exception as e:
            logger.warning(f"S2 batch fetch failed: {e}")
            if is_tier2:
                self.mark_s2_down(duration=180)
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

        await coordinated_rate_limiter.throttle("openalex")
        try:
            resp = await client.get(
                url,
                params=self._oa_params({"select": _OA_FIELDS}),
                headers=self._oa_headers(),
            )
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

    # ─── OpenAlex fallback methods ─────────────────────────────────────────────

    async def _search_openalex(self, query: str, limit: int = 8) -> list[Paper]:
        """Fallback title search via OpenAlex when S2 is rate-limited."""
        client = await self._client()

        await coordinated_rate_limiter.throttle("openalex")
        try:
            resp = await client.get(
                "https://api.openalex.org/works",
                params=self._oa_params({
                    "search": query,
                    "per_page": limit,
                    "select": _OA_FIELDS,
                }),
                headers=self._oa_headers(),
            )
            if resp.status_code in (429, 404):
                return []
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            logger.warning(f"OpenAlex search also failed for '{query}': {e}")
            return []

        results = []
        for item in data.get("results", []):
            parsed = self._parse_openalex_response(item)
            if not parsed or not parsed.get("title"):
                continue
            doi = parsed.get("doi")
            oa_id = (parsed.get("openalex_id") or "").rsplit("/", 1)[-1]
            # Use DOI as paper_id (normalizer handles DOI resolution downstream)
            pid = doi if doi else oa_id
            if not pid:
                continue
            results.append(Paper(
                paper_id=pid,
                title=parsed["title"],
                abstract=parsed.get("abstract"),
                year=parsed.get("year"),
                citation_count=parsed.get("citation_count", 0) or 0,
                authors=parsed.get("authors") or [],
                doi=doi,
                url=f"https://openalex.org/{oa_id}" if oa_id else "",
                text_tier=3 if parsed.get("abstract") else 4,
                fields_of_study=parsed.get("fields_of_study") or [],
            ))
        logger.info(f"OpenAlex search returned {len(results)} results for '{query}'")
        return results

    async def _get_openalex_references(self, paper_id: str, limit: int = 100) -> list[Paper]:
        """
        Fallback: get references via OpenAlex when S2 is rate-limited.
        Looks up the paper's DOI in our DB, queries OpenAlex for its
        referenced_works, then batch-resolves DOIs to S2 IDs.
        Returns at most `limit` references (respects MAX_REFS_PER_PAPER).

        If no DOI is available, falls back to title-based search in OpenAlex.
        """
        doi = self._lookup_paper_doi(paper_id)
        client = await self._client()

        if doi:
            # Primary path: look up by DOI (fast, exact match)
            await coordinated_rate_limiter.throttle("openalex")
            try:
                resp = await client.get(
                    f"https://api.openalex.org/works/doi:{doi}",
                    params=self._oa_params({"select": "id,referenced_works"}),
                    headers=self._oa_headers(),
                )
                if resp.status_code != 200:
                    return []
                data = resp.json()
            except Exception as e:
                logger.debug(f"OpenAlex reference lookup failed for DOI {doi}: {e}")
                return []
        else:
            # Fallback: no DOI → search by title to find the OpenAlex work
            title = self._lookup_paper_title(paper_id)
            if not title or title in ("(Metadata pending)", "Unknown"):
                logger.debug(f"No DOI or title for {paper_id[:12]}… — cannot get OpenAlex refs")
                return []
            data = await self._find_openalex_work_by_title(title)
            if not data:
                logger.debug(f"OpenAlex title search found no match for {paper_id[:12]}…")
                return []

        ref_urls = data.get("referenced_works", [])
        if not ref_urls:
            return []

        # Extract OpenAlex IDs ("https://openalex.org/W123" → "W123")
        # Cap at `limit` to respect MAX_REFS_PER_PAPER from graph engine
        ref_oa_ids = []
        for url in ref_urls[:limit]:
            oa_id = url.rsplit("/", 1)[-1] if "/" in url else url
            if oa_id.startswith("W"):
                ref_oa_ids.append(oa_id)

        if not ref_oa_ids:
            return []

        # Step 2: Batch-fetch referenced works from OpenAlex — CONCURRENT.
        # Previously this was a serial for-loop: 4 batches × 2-3s each = 8-12s.
        # With asyncio.gather(), all 4 batches run concurrently: ~2-3s total.
        parsed_refs = []
        dois_to_resolve = []
        OA_BATCH_SIZE = 25

        async def _fetch_oa_batch(batch_ids: list[str]) -> list[dict]:
            """Fetch one batch of OpenAlex works. Rate-limited."""
            await coordinated_rate_limiter.throttle("openalex")
            try:
                id_filter = "|".join(batch_ids)
                resp = await client.get(
                    "https://api.openalex.org/works",
                    params=self._oa_params({
                        "filter": f"openalex:{id_filter}",
                        "per_page": len(batch_ids),
                        "select": _OA_FIELDS,
                    }),
                    headers=self._oa_headers(),
                )
                if resp.status_code != 200:
                    return []
                return resp.json().get("results", [])
            except Exception as e:
                logger.debug(f"OpenAlex batch reference fetch failed: {e}")
                return []

        # Split into batches of 25 (URL length limit)
        oa_batches = [
            ref_oa_ids[i:i + OA_BATCH_SIZE]
            for i in range(0, len(ref_oa_ids), OA_BATCH_SIZE)
        ]

        # Run all batches concurrently — rate limiter handles throughput control
        batch_results = await asyncio.gather(
            *[_fetch_oa_batch(batch) for batch in oa_batches],
            return_exceptions=True,
        )

        for result in batch_results:
            if isinstance(result, Exception):
                logger.debug(f"OpenAlex batch raised: {result}")
                continue
            for item in result:
                parsed = self._parse_openalex_response(item)
                if not parsed or not parsed.get("title"):
                    continue
                parsed_refs.append(parsed)
                if parsed.get("doi"):
                    dois_to_resolve.append(parsed["doi"])

        # Step 3: Batch-resolve DOIs to S2 IDs (graph needs S2 IDs for consistency)
        doi_to_s2 = await self._batch_resolve_dois_to_s2(dois_to_resolve)

        papers = []
        for ref in parsed_refs:
            ref_doi = ref.get("doi")
            pid = doi_to_s2.get(ref_doi) if ref_doi else None
            is_synthetic = False
            if not pid and ref_doi:
                # S2 couldn't resolve this DOI — use synthetic ID so BFS can continue
                pid = hashlib.sha256(f"doi:{ref_doi}".encode()).hexdigest()[:40]
                is_synthetic = True
            if not pid:
                continue
            # Use DOI URL for synthetic IDs (S2 URLs would 404), S2 URL for real IDs
            if is_synthetic and ref_doi:
                paper_url = f"https://doi.org/{ref_doi}"
            else:
                paper_url = f"https://www.semanticscholar.org/paper/{pid}"
            paper = Paper(
                paper_id=pid,
                title=ref.get("title", "Unknown"),
                abstract=ref.get("abstract"),
                year=ref.get("year"),
                citation_count=ref.get("citation_count", 0) or 0,
                authors=ref.get("authors") or [],
                doi=ref_doi,
                url=paper_url,
                text_tier=3 if ref.get("abstract") else 4,
                fields_of_study=ref.get("fields_of_study") or [],
            )
            papers.append(paper)

        # Batch cache save — one connection + one COMMIT for all papers instead of
        # N individual _save_to_cache() calls, each with their own pool round-trip.
        # At depth 2 with 50+ refs per paper, this saves significant Neon latency.
        self._save_batch_to_cache(papers)

        logger.info(
            f"OpenAlex refs fallback: {len(papers)}/{len(parsed_refs)} "
            f"references resolved for {paper_id[:12]}…"
        )
        return papers

    async def _batch_resolve_dois_to_s2(self, dois: list[str]) -> dict[str, str]:
        """
        Batch-translate DOIs to S2 paper IDs.
        Checks DB cache first, then uses S2's batch endpoint for the rest.
        Returns {doi: s2_paper_id} mapping.

        When S2 is down (Tier 2 backoff or Tier 3), skips the S2 API call
        and returns only DB-cached results. This is fast and avoids wasting
        time on API calls that will 429.
        """
        if not dois:
            return {}

        result: dict[str, str] = {}
        uncached: list[str] = []

        # Check DB cache first — single batch query instead of N round trips.
        # With 50 DOIs per paper at depth 2, this saves ~2500 individual queries.
        try:
            rows = db.fetchall(
                "SELECT doi, paper_id FROM papers WHERE doi = ANY(%s)",
                (list(dois),),
            )
            cached_dois = {row["doi"]: row["paper_id"] for row in rows}
            for doi in dois:
                if doi in cached_dois:
                    result[doi] = cached_dois[doi]
                else:
                    uncached.append(doi)
        except Exception:
            # DB batch failed — treat all as uncached
            uncached = list(dois)

        if not uncached:
            return result

        # Skip S2 API call if S2 is in backoff (Tier 2 post-429 or Tier 3)
        if not self.s2_is_usable:
            logger.debug(
                f"S2 in backoff — skipping batch DOI resolution for {len(uncached)} DOIs "
                f"({len(result)} resolved from DB cache)"
            )
            return result

        # S2 batch endpoint with DOI: prefix identifiers
        client = await self._client()
        headers = {"x-api-key": config.S2_API_KEY} if config.S2_API_KEY else {}
        s2_ids = [f"DOI:{d}" for d in uncached[:500]]

        is_tier2 = not config.S2_API_KEY
        await _s2_delay()
        await coordinated_rate_limiter.throttle("semantic_scholar")
        try:
            resp = await client.post(
                "https://api.semanticscholar.org/graph/v1/paper/batch",
                json={"ids": s2_ids},
                params={"fields": "paperId,externalIds"},
                headers=headers,
            )
            if resp.status_code == 429:
                logger.debug("S2 batch DOI resolution 429'd — returning DB-cached results only")
                if is_tier2:
                    self.mark_s2_down(duration=300)
                return result
            resp.raise_for_status()
            items = resp.json()
        except Exception as e:
            logger.debug(f"S2 batch DOI resolution failed: {e}")
            if is_tier2:
                self.mark_s2_down(duration=180)
            return result

        for item, doi in zip(items, uncached):
            if item and item.get("paperId"):
                result[doi] = item["paperId"]

        return result

    async def _resolve_via_openalex(
        self, s2_id: str, identifier: str, id_type: str,
    ) -> Optional[Paper]:
        """
        Last-resort paper resolution: build a Paper from OpenAlex metadata
        when S2 is fully rate-limited. Uses the already-validated s2_id as
        canonical paper_id to maintain graph consistency.
        """
        doi_for_oa = None
        if id_type == ID_TYPE_DOI:
            doi_for_oa = identifier
        elif id_type == ID_TYPE_ARXIV:
            doi_for_oa = f"10.48550/arXiv.{identifier}"

        # If we don't have a DOI, try searching OpenAlex by the paper's s2_id DOI from cache
        if not doi_for_oa:
            doi_for_oa = self._lookup_paper_doi(s2_id)

        if not doi_for_oa:
            logger.debug(f"No DOI available for OpenAlex resolve fallback: {s2_id[:12]}…")
            return None

        oa_data = await self._fetch_openalex_by_doi(doi_for_oa)
        if not oa_data:
            return None

        paper = Paper(
            paper_id=s2_id,
            title=oa_data.get("title", "Unknown"),
            abstract=oa_data.get("abstract"),
            year=oa_data.get("year"),
            citation_count=oa_data.get("citation_count", 0) or 0,
            authors=oa_data.get("authors") or [],
            doi=oa_data.get("doi"),
            url=f"https://www.semanticscholar.org/paper/{s2_id}",
            text_tier=3 if oa_data.get("abstract") else 4,
            source_ids={"s2": s2_id, "openalex": oa_data.get("openalex_id")},
            fields_of_study=oa_data.get("fields_of_study") or [],
        )
        self._save_to_cache(paper)
        logger.info(f"Resolved {s2_id[:12]}… via OpenAlex fallback (DOI: {doi_for_oa})")
        return paper

    async def _resolve_without_s2(
        self, identifier: str, id_type: str,
    ) -> Optional[Paper]:
        """
        Resolve a paper when S2 is fully rate-limited or unavailable.

        Uses OpenAlex data with a synthetic paper_id: a deterministic 40-char
        hex string derived from SHA-256(doi). The rest of the system (graph
        engine, BFS, exports) works unchanged because synthetic IDs have the
        same format as real S2 corpus IDs.

        The DOI is stored in the papers table, so:
        - _get_openalex_references() can find it for BFS expansion
        - The graph cache query (WHERE doi = %s) can match it
        """
        if id_type == ID_TYPE_DOI:
            doi = identifier
        elif id_type == ID_TYPE_ARXIV:
            doi = f"10.48550/arXiv.{identifier}"
        else:
            return None

        # Check if we already have this DOI in our DB with a real paper_id.
        # NO TTL filter here — if a real S2 ID exists for this DOI, always reuse it
        # to prevent creating a duplicate synthetic ID for the same paper.
        try:
            row = db.fetchone(
                "SELECT paper_id, title, abstract, year, citation_count, "
                "fields_of_study, authors, doi, url, text_tier, is_retracted, "
                "language, canonical_id, source_ids, venue "
                "FROM papers WHERE doi = %s LIMIT 1",
                (doi,),
            )
            if row:
                logger.info(f"Resolved {doi} from DB cache (existing paper_id, no TTL)")
                return Paper.from_db_row(row)
        except Exception:
            pass

        # Generate synthetic paper_id from DOI (deterministic, 40-char hex)
        synthetic_id = hashlib.sha256(f"doi:{doi}".encode()).hexdigest()[:40]

        # Check if we already cached this synthetic ID
        cached = self._load_from_cache(synthetic_id)
        if cached:
            return cached

        # Fetch from OpenAlex
        oa_data = await self._fetch_openalex_by_doi(doi)
        if not oa_data:
            return None

        paper = Paper(
            paper_id=synthetic_id,
            title=oa_data.get("title", "Unknown"),
            abstract=oa_data.get("abstract"),
            year=oa_data.get("year"),
            citation_count=oa_data.get("citation_count", 0) or 0,
            authors=oa_data.get("authors") or [],
            doi=doi,
            url=f"https://doi.org/{doi}",
            text_tier=3 if oa_data.get("abstract") else 4,
            source_ids={"openalex": oa_data.get("openalex_id"), "doi": doi},
            fields_of_study=oa_data.get("fields_of_study") or [],
        )
        self._save_to_cache(paper)
        logger.info(f"Resolved {doi} via OpenAlex-only (synthetic ID: {synthetic_id[:12]}…)")
        return paper

    @staticmethod
    def _lookup_paper_doi(paper_id: str) -> Optional[str]:
        """Look up a paper's DOI from our DB cache."""
        try:
            row = db.fetchone(
                "SELECT doi FROM papers WHERE paper_id = %s", (paper_id,),
            )
            return row["doi"] if row and row.get("doi") else None
        except Exception:
            return None

    @staticmethod
    def _lookup_paper_title(paper_id: str) -> Optional[str]:
        """Look up a paper's title from our DB cache."""
        try:
            row = db.fetchone(
                "SELECT title FROM papers WHERE paper_id = %s", (paper_id,),
            )
            return row["title"] if row and row.get("title") else None
        except Exception:
            return None

    async def _find_openalex_work_by_title(self, title: str) -> Optional[dict]:
        """
        Search OpenAlex for a work by title and return its metadata
        (including referenced_works). Used as fallback when no DOI is available.
        Returns the best-matching result dict, or None.
        """
        client = await self._client()
        await coordinated_rate_limiter.throttle("openalex")
        try:
            resp = await client.get(
                "https://api.openalex.org/works",
                params=self._oa_params({
                    "search": title[:200],
                    "per_page": 1,
                    "select": "id,title,referenced_works,doi",
                }),
                headers=self._oa_headers(),
            )
            if resp.status_code != 200:
                return None
            data = resp.json()
            results = data.get("results", [])
            if not results:
                return None
            # Basic sanity check: title should partially match
            # Filter stop words to prevent false matches on short/generic titles
            _STOP_WORDS = {
                "a", "an", "the", "of", "in", "on", "at", "to", "for", "and",
                "or", "is", "are", "was", "were", "be", "been", "by", "with",
                "from", "as", "its", "it", "this", "that", "their", "not", "no",
            }
            best = results[0]
            best_title = (best.get("title") or "").lower()
            query_title = title.lower()
            query_words = set(query_title.split()) - _STOP_WORDS
            match_words = set(best_title.split()) - _STOP_WORDS
            # Require at least 3 content words and 60% overlap
            if len(query_words) < 3:
                logger.debug(f"Title too short for reliable match ({len(query_words)} content words): '{title[:40]}…'")
                return None
            if not match_words:
                logger.debug(f"OpenAlex result has no content words in title — rejecting")
                return None
            overlap = len(query_words & match_words) / max(len(query_words), 1)
            if overlap < 0.6:
                logger.debug(f"OpenAlex title match too weak ({overlap:.0%}) for '{title[:40]}…'")
                return None
            return best
        except Exception as e:
            logger.debug(f"OpenAlex title search failed for '{title[:40]}…': {e}")
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
            "fields_of_study": [f if isinstance(f, str) else f.get("category", "") for f in (data.get("fieldsOfStudy") or [])],
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

        # Extract fields_of_study from OpenAlex concepts
        # OpenAlex "concepts" map roughly to S2 "fieldsOfStudy"
        fields_of_study = []
        for concept in (data.get("concepts") or []):
            name = concept.get("display_name")
            level = concept.get("level", 99)
            # Only include top-level concepts (level 0-1) for clean field colors
            if name and level <= 1:
                fields_of_study.append(name)

        return {
            "_source":    "openalex",
            "openalex_id": data.get("id"),
            "title":      data.get("title"),
            "abstract":   abstract,
            "year":       data.get("publication_year"),
            "citation_count": data.get("cited_by_count", 0),
            "authors":    authors,
            "doi":        doi or None,
            "fields_of_study": fields_of_study,
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
                    doi            = COALESCE(EXCLUDED.doi, papers.doi),
                    url            = COALESCE(EXCLUDED.url, papers.url),
                    fields_of_study = CASE
                        WHEN EXCLUDED.fields_of_study::text != '[]'
                        THEN EXCLUDED.fields_of_study
                        ELSE papers.fields_of_study
                    END,
                    authors        = CASE
                        WHEN EXCLUDED.authors::text != '[]'
                        THEN EXCLUDED.authors
                        ELSE papers.authors
                    END,
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

    @staticmethod
    def _save_batch_to_cache(papers: list[Paper]) -> None:
        """
        Batch upsert resolved papers into the papers table.
        Uses executemany to share one connection checkout + one COMMIT for all N papers,
        instead of N individual _save_to_cache() calls each with their own connection.
        Note: psycopg2 executemany still sends N SQL statements, but avoids N pool
        round-trips (getconn/putconn) and N transaction commits — significant on Neon.
        Falls back to individual saves if batch fails.
        """
        if not papers:
            return
        import json as _json
        rows = []
        for p in papers:
            rows.append((
                p.paper_id, p.title, p.abstract, p.year, p.citation_count,
                _json.dumps(p.fields_of_study), _json.dumps(p.authors),
                p.doi, p.url, p.text_tier, p.is_retracted, p.language,
                _json.dumps(p.source_ids),
            ))
        try:
            db.executemany(
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
                    doi            = COALESCE(EXCLUDED.doi, papers.doi),
                    url            = COALESCE(EXCLUDED.url, papers.url),
                    fields_of_study = CASE
                        WHEN EXCLUDED.fields_of_study::text != '[]'
                        THEN EXCLUDED.fields_of_study
                        ELSE papers.fields_of_study
                    END,
                    authors        = CASE
                        WHEN EXCLUDED.authors::text != '[]'
                        THEN EXCLUDED.authors
                        ELSE papers.authors
                    END,
                    source_ids     = EXCLUDED.source_ids,
                    created_at     = NOW()
                """,
                rows,
            )
            logger.debug(f"Batch cache save: {len(papers)} papers")
        except Exception as e:
            logger.warning(f"Batch cache save failed, falling back to individual: {e}")
            for p in papers:
                SmartPaperResolver._save_to_cache(p)


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
