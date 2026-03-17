"""
backend/dna_profiler.py

Computes the "research DNA profile" of a paper's ancestry graph.
A DNA profile clusters the papers in the graph by semantic similarity
and assigns human-readable labels to each cluster.

Key insight: clustering is done on pre-stored sentence-transformer embeddings
from the paper_embeddings table. The NLP worker is NOT called at request time.
pgvector handles the similarity computation in SQL.

Architecture note: all clustering uses 'average' or 'complete' linkage with
cosine distance. Ward linkage is FORBIDDEN — it is incompatible with cosine metric.
"""
import logging
from dataclasses import dataclass, field

import numpy as np

from backend.db import fetchall

logger = logging.getLogger(__name__)

# Cluster colors — maps cluster index to a hex color
CLUSTER_COLORS = [
    "#648FFF",  # Blue
    "#785EF0",  # Purple
    "#DC267F",  # Magenta
    "#FE6100",  # Orange
    "#FFB000",  # Amber
    "#009E73",  # Green
    "#56B4E9",  # Light blue
    "#E69F00",  # Yellow-orange
]


@dataclass
class DNACluster:
    """One concept cluster in a DNA profile."""
    cluster_id: int
    name: str             # LLM-generated or fallback label
    papers: list          # list of paper_ids
    percentage: float     # fraction of total graph
    color: str
    top_authors: list = field(default_factory=list)


@dataclass
class DNAProfile:
    """Complete DNA profile for a paper's ancestry graph."""
    paper_id: str
    clusters: list        # list of DNACluster
    total_papers: int
    method_used: str      # "consensus_clustering" | "field_fallback" | "insufficient_data"

    def to_dict(self) -> dict:
        return {
            "paper_id": self.paper_id,
            "total_papers": self.total_papers,
            "method_used": self.method_used,
            "clusters": [
                {
                    "cluster_id": c.cluster_id,
                    "name": c.name,
                    "papers": c.papers,
                    "percentage": round(c.percentage, 1),
                    "color": c.color,
                    "top_authors": c.top_authors,
                }
                for c in self.clusters
            ],
        }


class DNAProfiler:
    """Compute research DNA profile for a paper's ancestry graph."""

    def compute_profile(self, paper_ids: list, seed_paper_id: str,
                        all_papers: dict = None) -> DNAProfile:
        """
        Compute DNA profile from a list of paper IDs.

        Args:
            paper_ids: list of paper_id strings in the graph
            seed_paper_id: the root paper ID
            all_papers: dict[paper_id -> Paper] for metadata

        Returns:
            DNAProfile
        """
        if len(paper_ids) < 5:
            return self._insufficient_data(seed_paper_id, paper_ids, all_papers)

        # Fetch embeddings from paper_embeddings table
        embeddings_map = self._fetch_embeddings(paper_ids)

        if len(embeddings_map) < 5:
            return self._field_fallback(seed_paper_id, paper_ids, all_papers)

        # Build embedding matrix (only papers with embeddings)
        ordered_ids = list(embeddings_map.keys())
        matrix = np.array([embeddings_map[pid] for pid in ordered_ids])

        # Consensus clustering
        labels = stable_dna_clustering(matrix)
        if labels is None:
            return self._field_fallback(seed_paper_id, paper_ids, all_papers)

        # Build clusters
        cluster_map: dict[int, list] = {}
        for i, label in enumerate(labels):
            cluster_map.setdefault(int(label), []).append(ordered_ids[i])

        # If consensus clustering produced only 1 cluster, it's not informative
        # (e.g. all ML papers cluster together). Fall back to field-of-study
        # distribution which gives the user a more useful breakdown.
        if len(cluster_map) <= 1:
            logger.info("Consensus clustering produced ≤1 cluster — using field fallback")
            return self._field_fallback(seed_paper_id, paper_ids, all_papers)

        clusters = []
        for cid, pids in sorted(cluster_map.items()):
            name = self._generate_cluster_label(pids, all_papers)
            top_authors = self._get_top_authors(pids, all_papers)
            clusters.append(DNACluster(
                cluster_id=cid,
                name=name,
                papers=pids,
                percentage=(len(pids) / len(ordered_ids)) * 100,
                color=CLUSTER_COLORS[cid % len(CLUSTER_COLORS)],
                top_authors=top_authors[:5],
            ))

        return DNAProfile(
            paper_id=seed_paper_id,
            clusters=clusters,
            total_papers=len(ordered_ids),
            method_used="consensus_clustering",
        )

    def _fetch_embeddings(self, paper_ids: list) -> dict:
        """Fetch embeddings from paper_embeddings table."""
        if not paper_ids:
            return {}
        try:
            rows = fetchall(
                "SELECT paper_id, embedding FROM paper_embeddings WHERE paper_id = ANY(%s)",
                (paper_ids,),
            )
            result = {}
            for row in rows:
                emb = row.get("embedding")
                if emb is not None:
                    # pgvector returns string like "[0.1, 0.2, ...]" or list
                    if isinstance(emb, str):
                        emb = [float(x) for x in emb.strip("[]").split(",")]
                    result[row["paper_id"]] = emb
            return result
        except Exception as e:
            logger.warning(f"Failed to fetch embeddings: {e}")
            return {}

    def _generate_cluster_label(self, paper_ids: list, all_papers: dict = None) -> str:
        """Generate a label for a cluster based on its papers' fields."""
        if not all_papers:
            return f"Cluster ({len(paper_ids)} papers)"

        field_counts: dict[str, int] = {}
        for pid in paper_ids:
            paper = all_papers.get(pid)
            if paper:
                for f in (getattr(paper, "fields_of_study", []) or []):
                    field_counts[f] = field_counts.get(f, 0) + 1

        if field_counts:
            top_field = max(field_counts, key=field_counts.get)
            return f"{top_field} ({len(paper_ids)} papers)"

        return f"Cluster ({len(paper_ids)} papers)"

    def _get_top_authors(self, paper_ids: list, all_papers: dict = None) -> list:
        """Get most frequent authors in a cluster."""
        if not all_papers:
            return []
        author_counts: dict[str, int] = {}
        for pid in paper_ids:
            paper = all_papers.get(pid)
            if paper:
                for author in (getattr(paper, "authors", []) or []):
                    author_counts[author] = author_counts.get(author, 0) + 1
        return sorted(author_counts, key=author_counts.get, reverse=True)[:5]

    def _insufficient_data(self, seed_paper_id: str, paper_ids: list,
                           all_papers: dict = None) -> DNAProfile:
        """Return a profile indicating insufficient data."""
        clusters = [DNACluster(
            cluster_id=0,
            name="All papers",
            papers=paper_ids,
            percentage=100.0,
            color=CLUSTER_COLORS[0],
        )]
        return DNAProfile(
            paper_id=seed_paper_id,
            clusters=clusters,
            total_papers=len(paper_ids),
            method_used="insufficient_data",
        )

    def _field_fallback(self, seed_paper_id: str, paper_ids: list,
                        all_papers: dict = None) -> DNAProfile:
        """Fallback: cluster by field of study."""
        if not all_papers:
            return self._insufficient_data(seed_paper_id, paper_ids, all_papers)

        field_groups: dict[str, list] = {}
        for pid in paper_ids:
            paper = all_papers.get(pid)
            if paper:
                fields = getattr(paper, "fields_of_study", []) or []
                f = fields[0] if fields else "Unknown"
            else:
                f = "Unknown"
            field_groups.setdefault(f, []).append(pid)

        clusters = []
        for i, (field_name, pids) in enumerate(sorted(field_groups.items())):
            clusters.append(DNACluster(
                cluster_id=i,
                name=f"{field_name} ({len(pids)} papers)",
                papers=pids,
                percentage=(len(pids) / len(paper_ids)) * 100,
                color=CLUSTER_COLORS[i % len(CLUSTER_COLORS)],
                top_authors=self._get_top_authors(pids, all_papers)[:5],
            ))

        return DNAProfile(
            paper_id=seed_paper_id,
            clusters=clusters,
            total_papers=len(paper_ids),
            method_used="field_fallback",
        )


def stable_dna_clustering(embeddings: np.ndarray) -> np.ndarray | None:
    """
    Consensus clustering over hierarchical clustering runs.

    Uses 'average' and 'complete' linkage (NOT 'ward' — incompatible with cosine).
    Tests multiple thresholds, builds co-occurrence matrix, then final clustering.

    Args:
        embeddings: n x 384 embedding matrix

    Returns:
        np.ndarray of cluster labels (0-indexed), or None on failure
    """
    try:
        from scipy.cluster.hierarchy import linkage, fcluster
        from scipy.spatial.distance import pdist
    except ImportError:
        logger.warning("scipy not installed — DNA clustering unavailable")
        return None

    n = len(embeddings)
    if n < 3:
        return np.zeros(n, dtype=int)

    # Compute cosine distance matrix
    try:
        distances = pdist(embeddings, metric="cosine")
    except Exception as e:
        logger.warning(f"Distance computation failed: {e}")
        return None

    # Replace any NaN/Inf with 1.0 (maximum cosine distance)
    distances = np.nan_to_num(distances, nan=1.0, posinf=1.0, neginf=0.0)

    # Consensus clustering: run multiple configurations
    methods = ["average", "complete"]  # Ward is FORBIDDEN with cosine
    thresholds = [0.40, 0.45, 0.50, 0.55, 0.60]

    co_occurrence = np.zeros((n, n), dtype=float)
    num_runs = 0

    for method in methods:
        try:
            Z = linkage(distances, method=method)
        except Exception:
            continue

        for threshold in thresholds:
            try:
                labels = fcluster(Z, t=threshold, criterion="distance")
                # Update co-occurrence: papers in same cluster get +1
                for i in range(n):
                    for j in range(i + 1, n):
                        if labels[i] == labels[j]:
                            co_occurrence[i, j] += 1
                            co_occurrence[j, i] += 1
                num_runs += 1
            except Exception:
                continue

    if num_runs == 0:
        return np.zeros(n, dtype=int)

    # Normalize co-occurrence to [0, 1]
    co_occurrence /= num_runs

    # Final clustering on co-occurrence matrix using cityblock distance
    try:
        co_dist = pdist(co_occurrence, metric="cityblock")
        co_dist = np.nan_to_num(co_dist, nan=1.0, posinf=1.0, neginf=0.0)
        Z_final = linkage(co_dist, method="average")
        final_labels = fcluster(Z_final, t=0.5 * n, criterion="distance")
        # Convert to 0-indexed
        return final_labels - 1
    except Exception as e:
        logger.warning(f"Final consensus clustering failed: {e}")
        return np.zeros(n, dtype=int)
