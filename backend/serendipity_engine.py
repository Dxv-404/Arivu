"""
backend/serendipity_engine.py — SerendipityEngine
Finds structural analogs — papers in different fields solving the same mathematical problem.
Uses pgvector similarity search filtered by field-of-study distance.
"""
import logging
from dataclasses import dataclass
import backend.db as db

logger = logging.getLogger(__name__)
SIMILARITY_THRESHOLD  = 0.68
MAX_ANALOGS_PER_PAPER = 5
MAX_TOTAL_RESULTS     = 20


@dataclass
class StructuralAnalog:
    source_paper_id: str
    source_title:    str
    source_fields:   list
    analog_paper_id: str
    analog_title:    str
    analog_fields:   list
    similarity:      float
    field_distance:  float
    relevance_score: float
    insight:         str

    def to_dict(self) -> dict:
        return {
            "source_paper_id": self.source_paper_id,
            "source_title":    self.source_title,
            "source_fields":   self.source_fields,
            "analog_paper_id": self.analog_paper_id,
            "analog_title":    self.analog_title,
            "analog_fields":   self.analog_fields,
            "similarity":      round(self.similarity, 3),
            "field_distance":  round(self.field_distance, 3),
            "relevance_score": round(self.relevance_score, 3),
            "insight":         self.insight,
        }


class SerendipityEngine:
    def find_analogs(self, graph_json: dict) -> list[StructuralAnalog]:
        nodes = graph_json.get("nodes", [])
        if not nodes:
            return []

        node_by_id = {n["id"]: n for n in nodes}
        node_ids   = [n["id"] for n in nodes]

        rows = db.fetchall(
            "SELECT paper_id, embedding FROM paper_embeddings WHERE paper_id = ANY(%s)",
            (node_ids,),
        )
        graph_embeddings = {r["paper_id"]: r["embedding"] for r in rows if r.get("embedding")}

        results: list[StructuralAnalog] = []
        seen_pairs: set = set()

        for node in nodes:
            paper_id = node["id"]
            emb = graph_embeddings.get(paper_id)
            if not emb:
                continue
            paper_fields = set(node.get("fields_of_study", []))
            if not paper_fields:
                continue

            try:
                emb_list = emb.tolist() if hasattr(emb, "tolist") else list(emb)
                emb_str  = "[" + ",".join(str(x) for x in emb_list) + "]"
                similar_rows = db.fetchall(
                    """
                    SELECT p.paper_id, p.title, p.fields_of_study,
                           1 - (pe.embedding <=> %s::vector) AS similarity
                    FROM paper_embeddings pe
                    JOIN papers p ON p.paper_id = pe.paper_id
                    WHERE pe.paper_id != ALL(%s)
                      AND p.fields_of_study IS NOT NULL
                      AND p.fields_of_study != '[]'::jsonb
                      AND 1 - (pe.embedding <=> %s::vector) >= %s
                    ORDER BY pe.embedding <=> %s::vector
                    LIMIT 20
                    """,
                    (emb_str, node_ids, emb_str, SIMILARITY_THRESHOLD, emb_str),
                )
            except Exception as exc:
                logger.debug(f"pgvector search failed for {paper_id}: {exc}")
                continue

            count = 0
            for row in similar_rows:
                if count >= MAX_ANALOGS_PER_PAPER:
                    break
                analog_id     = row["paper_id"]
                analog_fields = set(row.get("fields_of_study") or [])
                if not analog_fields or paper_fields & analog_fields:
                    continue
                pair_key = tuple(sorted([paper_id, analog_id]))
                if pair_key in seen_pairs:
                    continue
                seen_pairs.add(pair_key)

                similarity  = float(row["similarity"])
                s_field     = list(paper_fields)[0] if paper_fields else "one field"
                a_field     = list(analog_fields)[0] if analog_fields else "another field"
                results.append(StructuralAnalog(
                    source_paper_id=paper_id, source_title=node.get("title", "Unknown"),
                    source_fields=list(paper_fields),
                    analog_paper_id=analog_id, analog_title=row.get("title", "Unknown"),
                    analog_fields=list(analog_fields),
                    similarity=similarity, field_distance=1.0,
                    relevance_score=similarity,
                    insight=(f"Papers in {s_field} and {a_field} appear to solve "
                             f"structurally similar problems — methods may transfer."),
                ))
                count += 1

        results.sort(key=lambda r: r.relevance_score, reverse=True)
        return results[:MAX_TOTAL_RESULTS]
