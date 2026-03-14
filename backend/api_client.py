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
