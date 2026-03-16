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
import json
import logging
import re
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
async def _s2_delay() -> None:
    """Sleep between S2 API calls when no API key is configured."""
    from backend.config import Config
    if not Config.S2_API_KEY:
        await asyncio.sleep(1.1)


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

        await _s2_delay()
        await coordinated_rate_limiter.throttle("semantic_scholar")
        try:
            resp = await client.get(url, params=params, headers=headers)
            if resp.status_code == 429:
                await coordinated_rate_limiter.record_rate_limit("semantic_scholar")
                logger.info(f"S2 references 429 for {s2_paper_id[:12]}…, falling back to OpenAlex")
                return await self._get_openalex_references(s2_paper_id)
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPStatusError as e:
            logger.warning(f"S2 references fetch failed for {s2_paper_id}: {e}")
            return await self._get_openalex_references(s2_paper_id)

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
            oa_refs = await self._get_openalex_references(s2_paper_id)
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

        await _s2_delay()
        await coordinated_rate_limiter.throttle("semantic_scholar")
        try:
            resp = await client.get(url, params=params, headers=headers)
            if resp.status_code == 429:
                await coordinated_rate_limiter.record_rate_limit("semantic_scholar")
                logger.info(f"S2 search 429, falling back to OpenAlex for '{query}'")
                return await self._search_openalex(query, limit)
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPStatusError as e:
            logger.warning(f"S2 search failed for '{query}': {e}, trying OpenAlex")
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
            oa_headers = {}
            if config.OPENALEX_EMAIL:
                oa_headers["User-Agent"] = f"Arivu/1.0 (mailto:{config.OPENALEX_EMAIL})"
            await coordinated_rate_limiter.throttle("openalex")
            try:
                resp = await client.get(
                    f"https://api.openalex.org/works/{identifier}",
                    params={"select": "id,doi"},
                    headers=oa_headers,
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

        s2_ref = f"{prefix}:{identifier}"
        url = f"https://api.semanticscholar.org/graph/v1/paper/{s2_ref}"
        params = {"fields": "paperId"}

        for attempt in range(3):
            await _s2_delay()
            await coordinated_rate_limiter.throttle("semantic_scholar")
            try:
                resp = await client.get(url, params=params, headers=headers)
                if resp.status_code in (404, 400):
                    return None
                if resp.status_code == 429:
                    wait = min(30 * (2 ** attempt), 120)
                    logger.debug(f"S2 429 on ID translate, retrying in {wait}s (attempt {attempt+1}/3)")
                    await coordinated_rate_limiter.record_rate_limit("semantic_scholar", retry_after=wait)
                    await asyncio.sleep(wait)
                    continue
                resp.raise_for_status()
                return resp.json().get("paperId")
            except Exception as e:
                logger.debug(f"S2 ID translation failed ({s2_ref}): {e}")
                return None
        return None

    async def _fetch_s2(self, s2_id: str) -> Optional[dict]:
        """Fetch full metadata for a single paper from Semantic Scholar."""
        client = await self._client()
        url = f"https://api.semanticscholar.org/graph/v1/paper/{s2_id}"
        params = {"fields": _S2_FIELDS}
        headers = {"x-api-key": config.S2_API_KEY} if config.S2_API_KEY else {}

        for attempt in range(3):
            await _s2_delay()
            await coordinated_rate_limiter.throttle("semantic_scholar")
            try:
                resp = await client.get(url, params=params, headers=headers)
                if resp.status_code == 404:
                    return None
                if resp.status_code == 429:
                    wait = min(30 * (2 ** attempt), 120)
                    logger.debug(f"S2 429 on fetch, retrying in {wait}s (attempt {attempt+1}/3)")
                    await coordinated_rate_limiter.record_rate_limit("semantic_scholar", retry_after=wait)
                    await asyncio.sleep(wait)
                    continue
                resp.raise_for_status()
                return self._parse_s2_response(resp.json())
            except httpx.HTTPStatusError as e:
                logger.warning(f"S2 fetch failed for {s2_id}: {e}")
                return None
        return None

    async def _fetch_s2_batch(self, s2_ids: list[str]) -> list[dict]:
        """
        Fetch up to 500 papers in one S2 batch POST call.
        """
        client = await self._client()
        url = "https://api.semanticscholar.org/graph/v1/paper/batch"
        params = {"fields": _S2_BATCH_FIELDS}
        headers = {"x-api-key": config.S2_API_KEY} if config.S2_API_KEY else {}
        body = {"ids": s2_ids}

        await _s2_delay()
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

    # ─── OpenAlex fallback methods ─────────────────────────────────────────────

    async def _search_openalex(self, query: str, limit: int = 8) -> list[Paper]:
        """Fallback title search via OpenAlex when S2 is rate-limited."""
        client = await self._client()
        params = {
            "search": query,
            "per_page": limit,
            "select": _OA_FIELDS,
        }
        headers = {}
        if config.OPENALEX_EMAIL:
            headers["User-Agent"] = f"Arivu/1.0 (mailto:{config.OPENALEX_EMAIL})"

        await coordinated_rate_limiter.throttle("openalex")
        try:
            resp = await client.get(
                "https://api.openalex.org/works", params=params, headers=headers,
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
            ))
        logger.info(f"OpenAlex search returned {len(results)} results for '{query}'")
        return results

    async def _get_openalex_references(self, paper_id: str) -> list[Paper]:
        """
        Fallback: get references via OpenAlex when S2 is rate-limited.
        Looks up the paper's DOI in our DB, queries OpenAlex for its
        referenced_works, then batch-resolves DOIs to S2 IDs.
        """
        doi = self._lookup_paper_doi(paper_id)
        if not doi:
            logger.debug(f"No DOI in cache for {paper_id[:12]}… — cannot fall back to OpenAlex refs")
            return []

        client = await self._client()
        headers = {}
        if config.OPENALEX_EMAIL:
            headers["User-Agent"] = f"Arivu/1.0 (mailto:{config.OPENALEX_EMAIL})"

        # Step 1: Get referenced_works list from OpenAlex
        await coordinated_rate_limiter.throttle("openalex")
        try:
            resp = await client.get(
                f"https://api.openalex.org/works/doi:{doi}",
                params={"select": "id,referenced_works"},
                headers=headers,
            )
            if resp.status_code != 200:
                return []
            data = resp.json()
        except Exception as e:
            logger.debug(f"OpenAlex reference lookup failed for DOI {doi}: {e}")
            return []

        ref_urls = data.get("referenced_works", [])
        if not ref_urls:
            return []

        # Extract OpenAlex IDs ("https://openalex.org/W123" → "W123")
        ref_oa_ids = []
        for url in ref_urls[:100]:
            oa_id = url.rsplit("/", 1)[-1] if "/" in url else url
            if oa_id.startswith("W"):
                ref_oa_ids.append(oa_id)

        if not ref_oa_ids:
            return []

        # Step 2: Batch-fetch referenced works from OpenAlex
        await coordinated_rate_limiter.throttle("openalex")
        try:
            id_filter = "|".join(ref_oa_ids)
            resp = await client.get(
                "https://api.openalex.org/works",
                params={
                    "filter": f"openalex:{id_filter}",
                    "per_page": 100,
                    "select": _OA_FIELDS,
                },
                headers=headers,
            )
            if resp.status_code != 200:
                return []
            refs_data = resp.json()
        except Exception as e:
            logger.debug(f"OpenAlex batch reference fetch failed: {e}")
            return []

        # Parse references and collect DOIs
        parsed_refs = []
        dois_to_resolve = []
        for item in refs_data.get("results", []):
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
            s2_id = doi_to_s2.get(ref_doi) if ref_doi else None
            if not s2_id:
                continue
            papers.append(Paper(
                paper_id=s2_id,
                title=ref.get("title", "Unknown"),
                abstract=ref.get("abstract"),
                year=ref.get("year"),
                citation_count=ref.get("citation_count", 0) or 0,
                authors=ref.get("authors") or [],
                doi=ref_doi,
                url=f"https://www.semanticscholar.org/paper/{s2_id}",
                text_tier=3 if ref.get("abstract") else 4,
            ))

        logger.info(
            f"OpenAlex refs fallback: {len(papers)}/{len(parsed_refs)} "
            f"resolved to S2 IDs for {paper_id[:12]}…"
        )
        return papers

    async def _batch_resolve_dois_to_s2(self, dois: list[str]) -> dict[str, str]:
        """
        Batch-translate DOIs to S2 paper IDs.
        Checks DB cache first, then uses S2's batch endpoint for the rest.
        Returns {doi: s2_paper_id} mapping.
        """
        if not dois:
            return {}

        result: dict[str, str] = {}
        uncached: list[str] = []

        # Check DB cache first (free, no API call)
        for doi in dois:
            try:
                row = db.fetchone(
                    "SELECT paper_id FROM papers WHERE doi = %s", (doi,),
                )
                if row:
                    result[doi] = row["paper_id"]
                else:
                    uncached.append(doi)
            except Exception:
                uncached.append(doi)

        if not uncached:
            return result

        # S2 batch endpoint with DOI: prefix identifiers
        client = await self._client()
        headers = {"x-api-key": config.S2_API_KEY} if config.S2_API_KEY else {}
        s2_ids = [f"DOI:{d}" for d in uncached[:500]]

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
                logger.debug("S2 batch DOI resolution also 429'd — returning DB-cached results only")
                return result
            resp.raise_for_status()
            items = resp.json()
        except Exception as e:
            logger.debug(f"S2 batch DOI resolution failed: {e}")
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
        )
        self._save_to_cache(paper)
        logger.info(f"Resolved {s2_id[:12]}… via OpenAlex fallback (DOI: {doi_for_oa})")
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
