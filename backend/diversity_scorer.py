"""
backend/diversity_scorer.py

DiversityScorer: 4-component score for a paper's ancestry graph.
Components: field diversity, temporal span, cluster count, citation entropy.

Uses pre-stored metadata from the papers table. No NLP worker calls.
Implemented in Phase 3.
"""
import logging
import math
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class DiversityScore:
    """4-component diversity score for a graph."""
    field_diversity: float      # 0-100 (Shannon entropy of fields)
    temporal_span: float        # 0-100 (years normalized to 100-year scale)
    cluster_count: int          # raw count of DNA clusters
    citation_entropy: float     # 0-100 (Shannon entropy of citation distribution)
    overall: float              # weighted average
    contextual_note: str        # human-readable explanation

    def to_dict(self) -> dict:
        return {
            "field_diversity": round(self.field_diversity, 1),
            "temporal_span": round(self.temporal_span, 1),
            "cluster_count": self.cluster_count,
            "citation_entropy": round(self.citation_entropy, 1),
            "overall": round(self.overall, 1),
            "contextual_note": self.contextual_note,
        }


class DiversityScorer:
    """Compute diversity score for a paper's ancestry graph."""

    def compute_score(self, paper_ids: list, all_papers: dict,
                      dna_profile=None) -> DiversityScore:
        """
        Compute diversity score from paper metadata.

        Args:
            paper_ids: list of paper_id strings in the graph
            all_papers: dict[paper_id -> Paper] for metadata
            dna_profile: DNAProfile (optional, for cluster count)

        Returns:
            DiversityScore
        """
        # Component 1: Field diversity (Shannon entropy)
        field_div = self._compute_field_diversity(paper_ids, all_papers)

        # Component 2: Temporal span
        temporal = self._compute_temporal_span(paper_ids, all_papers)

        # Component 3: Cluster count from DNA profile
        n_clusters = 1
        if dna_profile and hasattr(dna_profile, "clusters"):
            n_clusters = len(dna_profile.clusters)
        cluster_score = min(100.0, (n_clusters / max(len(paper_ids), 1)) * 100 * 10)

        # Component 4: Citation entropy
        citation_ent = self._compute_citation_entropy(paper_ids, all_papers)

        # Overall: weighted average
        overall = (
            0.30 * field_div +
            0.25 * temporal +
            0.20 * citation_ent +
            0.25 * cluster_score
        )

        # Contextual note
        note = self._generate_note(field_div, temporal, citation_ent, n_clusters)

        return DiversityScore(
            field_diversity=field_div,
            temporal_span=temporal,
            cluster_count=n_clusters,
            citation_entropy=citation_ent,
            overall=overall,
            contextual_note=note,
        )

    def _compute_field_diversity(self, paper_ids: list, all_papers: dict) -> float:
        """Shannon entropy of fields_of_study distribution, normalized to 0-100."""
        field_counts: dict[str, int] = {}
        total = 0
        for pid in paper_ids:
            paper = all_papers.get(pid)
            if paper:
                fields = getattr(paper, "fields_of_study", []) or []
                for f in fields:
                    field_counts[f] = field_counts.get(f, 0) + 1
                    total += 1

        if total == 0 or len(field_counts) <= 1:
            return 0.0

        entropy = 0.0
        for count in field_counts.values():
            p = count / total
            if p > 0:
                entropy -= p * math.log2(p)

        max_entropy = math.log2(len(field_counts))
        if max_entropy == 0:
            return 0.0

        return (entropy / max_entropy) * 100

    def _compute_temporal_span(self, paper_ids: list, all_papers: dict) -> float:
        """Year range normalized to 100-year scale, 0-100."""
        years = []
        for pid in paper_ids:
            paper = all_papers.get(pid)
            if paper and getattr(paper, "year", None):
                years.append(paper.year)

        if len(years) < 2:
            return 0.0

        span = max(years) - min(years)
        return min(100.0, (span / 100) * 100)

    def _compute_citation_entropy(self, paper_ids: list, all_papers: dict) -> float:
        """Shannon entropy of log(citation_count+1) distribution, 0-100."""
        counts = []
        for pid in paper_ids:
            paper = all_papers.get(pid)
            if paper:
                cc = getattr(paper, "citation_count", 0) or 0
                counts.append(math.log(cc + 1))

        if len(counts) < 2:
            return 0.0

        total = sum(counts) or 1.0
        entropy = 0.0
        for c in counts:
            p = c / total
            if p > 0:
                entropy -= p * math.log2(p)

        max_entropy = math.log2(len(counts))
        if max_entropy == 0:
            return 0.0

        return (entropy / max_entropy) * 100

    def _generate_note(self, field_div: float, temporal: float,
                       citation_ent: float, n_clusters: int) -> str:
        """Generate contextual note explaining the diversity score."""
        parts = []

        if field_div < 30:
            parts.append("narrow field focus")
        elif field_div > 70:
            parts.append("highly interdisciplinary")
        else:
            parts.append("moderate field diversity")

        if temporal < 20:
            parts.append("concentrated time period")
        elif temporal > 60:
            parts.append("wide temporal span")

        if n_clusters > 5:
            parts.append(f"{n_clusters} distinct research threads")
        elif n_clusters <= 2:
            parts.append("few distinct threads")

        return ". ".join(parts).capitalize() + "."
