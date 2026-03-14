"""
backend/gap_finder.py

GapFinder: pgvector-based semantic search for research gaps.
Finds papers semantically similar to the graph's papers but NOT in the graph,
suggesting unexplored research directions.

CONFLICT-013 resolved: This IS in scope for Phase 3.
An earlier draft said "do not implement" — that was incorrect.
Implemented in Phase 3.
"""
import logging

from backend.db import fetchall

logger = logging.getLogger(__name__)


class GapFinder:
    """Find research gaps using pgvector similarity search."""

    def find_gaps(self, paper_ids: list, all_papers: dict,
                  coverage_score: float = 0.0, top_k: int = 10) -> list:
        """
        Find research gaps: papers similar to the graph but not in it.

        Args:
            paper_ids: list of paper_id strings in the graph
            all_papers: dict[paper_id -> Paper]
            coverage_score: graph coverage score (0-1). Only returns gaps
                           if coverage >= 0.7 (70%+ full-text coverage)
            top_k: max number of gaps to return

        Returns:
            list[dict] with gap paper info
        """
        if coverage_score < 0.7:
            logger.info(f"Coverage score {coverage_score:.2f} < 0.7, skipping gap analysis")
            return []

        if len(paper_ids) < 3:
            return []

        # Use the seed paper's embedding to find similar papers not in graph
        gaps = self._search_similar_outside_graph(paper_ids, top_k)
        return gaps

    def _search_similar_outside_graph(self, paper_ids: list,
                                       top_k: int = 10) -> list:
        """
        Use pgvector to find papers semantically similar to graph papers
        but not in the graph.
        """
        if not paper_ids:
            return []

        try:
            # Get the centroid embedding of the graph's papers
            rows = fetchall(
                """
                SELECT paper_id, embedding
                FROM paper_embeddings
                WHERE paper_id = ANY(%s)
                """,
                (paper_ids,),
            )

            if not rows:
                return []

            # Find papers NOT in the graph that are similar to graph papers
            # Use the first paper's embedding as anchor (seed paper)
            anchor_embedding = rows[0].get("embedding")
            if anchor_embedding is None:
                return []

            # pgvector cosine similarity search
            gap_rows = fetchall(
                """
                SELECT pe.paper_id, p.title, p.year, p.citation_count,
                       p.fields_of_study,
                       1 - (pe.embedding <=> %s::vector) AS similarity
                FROM paper_embeddings pe
                JOIN papers p ON p.paper_id = pe.paper_id
                WHERE pe.paper_id != ALL(%s)
                ORDER BY pe.embedding <=> %s::vector
                LIMIT %s
                """,
                (str(anchor_embedding), paper_ids, str(anchor_embedding), top_k * 2),
            )

            gaps = []
            for row in gap_rows:
                similarity = float(row.get("similarity", 0))
                if similarity < 0.3:
                    continue  # Too dissimilar

                gaps.append({
                    "gap_paper_id": row["paper_id"],
                    "gap_paper_title": row.get("title", "Unknown"),
                    "year": row.get("year"),
                    "citation_count": row.get("citation_count", 0),
                    "fields_of_study": row.get("fields_of_study") or [],
                    "similarity_to_graph": round(similarity, 3),
                    "gap_score": round(similarity * 0.8, 3),
                    "rationale": f"Semantically related but not in ancestry graph (similarity: {similarity:.2f})",
                })

            # Sort by gap_score descending
            gaps.sort(key=lambda g: g["gap_score"], reverse=True)
            return gaps[:top_k]

        except Exception as e:
            logger.warning(f"Gap finding failed: {e}")
            return []
