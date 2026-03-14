"""
backend/orphan_detector.py

OrphanDetector: peaked-and-faded concept detection.
Identifies papers in a graph that were once influential but have been
largely forgotten — potential revival candidates.

Implemented in Phase 3.
"""
import logging
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class Orphan:
    """A paper identified as an orphaned idea."""
    paper_id: str
    title: str
    year: int | None
    citation_count: int
    peak_year: int | None
    decline_rate: float        # 0-1, how sharply citations declined
    relevance_score: float     # 0-1, combined orphan score
    fields_of_study: list = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "paper_id": self.paper_id,
            "title": self.title,
            "year": self.year,
            "citation_count": self.citation_count,
            "peak_year": self.peak_year,
            "decline_rate": round(self.decline_rate, 2),
            "relevance_score": round(self.relevance_score, 2),
            "fields_of_study": self.fields_of_study,
        }


class OrphanDetector:
    """Detect orphaned ideas in a paper's ancestry graph."""

    def detect_orphans(self, paper_ids: list, all_papers: dict,
                       top_k: int = 5) -> list:
        """
        Detect orphaned ideas from the graph's papers.

        Args:
            paper_ids: list of paper_id strings
            all_papers: dict[paper_id -> Paper]
            top_k: max number of orphans to return

        Returns:
            list[Orphan]
        """
        if not all_papers or len(paper_ids) < 3:
            return []

        # Get year range
        years = []
        for pid in paper_ids:
            paper = all_papers.get(pid)
            if paper and getattr(paper, "year", None):
                years.append(paper.year)

        if not years or (max(years) - min(years)) < 5:
            return []  # Insufficient temporal data

        current_year = max(years)
        median_year = sorted(years)[len(years) // 2]

        candidates = []
        for pid in paper_ids:
            paper = all_papers.get(pid)
            if not paper:
                continue

            year = getattr(paper, "year", None)
            if not year:
                continue

            citation_count = getattr(paper, "citation_count", 0) or 0

            # Skip very recent papers (not enough time to become orphaned)
            if year > current_year - 5:
                continue

            # Skip papers with very low citations (never influential)
            if citation_count < 5:
                continue

            # Compute orphan score
            # Age factor: older papers that are forgotten score higher
            age = current_year - year
            age_factor = min(1.0, age / 30)

            # Citation ratio: low citation relative to age = more orphaned
            # Compare to median citations for papers of similar age
            expected_citations = max(10, age * 2)  # rough heuristic
            citation_ratio = citation_count / expected_citations
            underperformance = max(0, 1.0 - citation_ratio)

            # Papers before the median year with moderate citations = orphan candidates
            temporal_factor = 1.0 if year < median_year else 0.3

            # Combined score
            relevance_score = (
                0.4 * age_factor +
                0.3 * underperformance +
                0.3 * temporal_factor
            )

            # Decline rate approximation (simplified without citation timeline)
            decline_rate = min(1.0, age_factor * (1 - min(1.0, citation_count / 100)))

            if relevance_score > 0.3:
                candidates.append(Orphan(
                    paper_id=pid,
                    title=getattr(paper, "title", "Unknown"),
                    year=year,
                    citation_count=citation_count,
                    peak_year=year + min(5, age // 2),
                    decline_rate=decline_rate,
                    relevance_score=relevance_score,
                    fields_of_study=getattr(paper, "fields_of_study", []) or [],
                ))

        # Sort by relevance, return top_k
        candidates.sort(key=lambda o: o.relevance_score, reverse=True)
        return candidates[:top_k]
