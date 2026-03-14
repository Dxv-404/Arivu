"""
deduplicator.py — PaperDeduplicator: canonical paper record construction.

The same paper may be returned by Semantic Scholar, OpenAlex, and CrossRef
with different IDs and slightly different metadata. This module resolves them
into a single authoritative Paper instance using field-level priority rules
defined in section 5.3 of ARIVU_COMPLETE_SPEC_v3.md.

The S2 corpus ID is always the canonical paper_id. If S2 did not return a
record, the paper cannot be used (we need a stable graph node identifier).
"""
import logging
import re
from difflib import SequenceMatcher

from backend.models import Paper

logger = logging.getLogger(__name__)

# Field-level priority rules (spec section 5.3).
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
        Given >=1 raw dicts representing the same paper (from different sources),
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
