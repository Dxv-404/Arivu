"""
backend/cross_domain_spark.py — CrossDomainSparkDetector (F1.14)
"""
import logging
import datetime
from collections import defaultdict
from dataclasses import dataclass
from typing import Optional

import backend.db as db
from backend.llm_client import get_llm_client

logger = logging.getLogger(__name__)

CROSS_DOMAIN_SIMILARITY_FLOOR = 0.60
MAX_FUTURE_SPARKS = 10
_CURRENT_YEAR = datetime.datetime.now().year


@dataclass
class CrossDomainSpark:
    source_paper_id:  str
    source_title:     str
    source_field:     str
    source_year:      Optional[int]
    target_paper_id:  str
    target_title:     str
    target_field:     str
    idea_transferred: str
    enabled_count:    int
    years_ago:        Optional[int]
    similarity:       float

    def to_dict(self) -> dict:
        return {
            "source": {"paper_id": self.source_paper_id, "title": self.source_title,
                       "field": self.source_field, "year": self.source_year},
            "target": {"paper_id": self.target_paper_id, "title": self.target_title,
                       "field": self.target_field},
            "idea_transferred": self.idea_transferred,
            "enabled_count":    self.enabled_count,
            "years_ago":        self.years_ago,
            "similarity":       round(self.similarity, 3),
        }


@dataclass
class FutureSpark:
    field_a:      str
    field_b:      str
    paper_a_id:   str
    paper_a_title: str
    paper_b_id:   str
    paper_b_title: str
    similarity:   float
    opportunity:  str

    def to_dict(self) -> dict:
        return {
            "field_a":     self.field_a,
            "field_b":     self.field_b,
            "paper_a":     {"id": self.paper_a_id, "title": self.paper_a_title},
            "paper_b":     {"id": self.paper_b_id, "title": self.paper_b_title},
            "similarity":  round(self.similarity, 3),
            "opportunity": self.opportunity,
        }


class CrossDomainSparkDetector:
    """Stateless — instantiate fresh per request."""

    def detect(self, graph_json: dict) -> dict:
        nodes      = graph_json.get("nodes", [])
        edges      = graph_json.get("edges", [])
        node_by_id = {n["id"]: n for n in nodes}

        sparks        = self._find_historical_sparks(nodes, edges, node_by_id)
        future_sparks = self._find_future_sparks(nodes, edges, node_by_id)
        summary       = self._build_summary(sparks, future_sparks)
        return {
            "sparks":        [s.to_dict() for s in sparks],
            "future_sparks": [f.to_dict() for f in future_sparks],
            "summary":       summary,
        }

    def _find_historical_sparks(self, nodes, edges, node_by_id) -> list:
        results = []
        for edge in edges:
            src_id = edge.get("source") or edge.get("citing_paper_id", "")
            tgt_id = edge.get("target") or edge.get("cited_paper_id", "")
            src    = node_by_id.get(src_id, {})
            tgt    = node_by_id.get(tgt_id, {})

            src_fields = src.get("fields_of_study") or []
            tgt_fields = tgt.get("fields_of_study") or []
            if not src_fields or not tgt_fields:
                continue

            src_field = src_fields[0]
            tgt_field = tgt_fields[0]
            if src_field == tgt_field:
                continue

            similarity = float(edge.get("similarity_score") or 0)
            if similarity < CROSS_DOMAIN_SIMILARITY_FLOOR:
                continue

            src_year = src.get("year") or 0
            enabled  = sum(
                1 for n in nodes
                if n.get("year", 0) > src_year
                and src_field in (n.get("fields_of_study") or [])
                and tgt_field in (n.get("fields_of_study") or [])
            )

            idea      = edge.get("inherited_idea") or f"Technique from {tgt_field} applied to {src_field}"
            years_ago = (_CURRENT_YEAR - src_year) if src_year else None

            results.append(CrossDomainSpark(
                source_paper_id=src_id, source_title=src.get("title", ""),
                source_field=src_field, source_year=src.get("year"),
                target_paper_id=tgt_id, target_title=tgt.get("title", ""),
                target_field=tgt_field, idea_transferred=idea,
                enabled_count=enabled, years_ago=years_ago, similarity=similarity,
            ))
        return sorted(results, key=lambda x: (x.enabled_count, x.similarity), reverse=True)[:10]

    def _find_future_sparks(self, nodes, edges, node_by_id) -> list:
        existing_pairs = {
            (e.get("source") or e.get("citing_paper_id", ""),
             e.get("target") or e.get("cited_paper_id", ""))
            for e in edges
        }
        all_node_ids   = [n["id"] for n in nodes if n.get("id")]
        node_field_map = {n["id"]: (n.get("fields_of_study") or ["unknown"])[0] for n in nodes}
        if not all_node_ids:
            return []

        try:
            rows = db.fetchall(
                """
                SELECT pe1.paper_id AS id_a, pe2.paper_id AS id_b,
                       1 - (pe1.embedding <=> pe2.embedding) AS similarity
                FROM paper_embeddings pe1
                JOIN paper_embeddings pe2 ON pe1.paper_id < pe2.paper_id
                WHERE pe1.paper_id = ANY(%s)
                  AND pe2.paper_id = ANY(%s)
                  AND 1 - (pe1.embedding <=> pe2.embedding) > %s
                ORDER BY similarity DESC
                LIMIT 30
                """,
                (all_node_ids, all_node_ids, CROSS_DOMAIN_SIMILARITY_FLOOR),
            )
        except Exception as exc:
            logger.warning(f"Future spark pgvector query failed: {exc}")
            return []

        results = []
        llm     = get_llm_client()
        for row in rows:
            id_a, id_b = row["id_a"], row["id_b"]
            if (id_a, id_b) in existing_pairs or (id_b, id_a) in existing_pairs:
                continue
            fa = node_field_map.get(id_a, "unknown")
            fb = node_field_map.get(id_b, "unknown")
            if fa == fb:
                continue
            pa = node_by_id.get(id_a, {})
            pb = node_by_id.get(id_b, {})
            try:
                prompt = (
                    f"Two papers from different fields have high semantic similarity "
                    f"({float(row['similarity']):.2f}) but no citation between them.\n"
                    f"Paper A ({fa}): '{pa.get('title','?')}'\n"
                    f"Paper B ({fb}): '{pb.get('title','?')}'\n"
                    f"In one sentence, what research opportunity does this cross-domain gap represent? "
                    f"Be specific about what technique or concept from one field could transfer."
                )
                opportunity = (llm.generate_chat_response(
                    system_prompt="You are a research opportunity analyst. Be concise.",
                    user_prompt=prompt,
                ) or "").strip()
            except Exception:
                opportunity = (
                    f"High-similarity work across {fa} and {fb} — "
                    f"techniques from one field may be transferable to the other."
                )
            if not opportunity:
                opportunity = f"Potential cross-domain transfer between {fa} and {fb}."
            results.append(FutureSpark(
                field_a=fa, field_b=fb,
                paper_a_id=id_a, paper_a_title=pa.get("title", ""),
                paper_b_id=id_b, paper_b_title=pb.get("title", ""),
                similarity=float(row["similarity"]), opportunity=opportunity,
            ))
            if len(results) >= MAX_FUTURE_SPARKS:
                break
        return results

    def _build_summary(self, sparks, future_sparks) -> str:
        if not sparks and not future_sparks:
            return "No cross-domain activity detected in this graph."
        parts = []
        if sparks:
            fields = set()
            for s in sparks[:5]:
                fields.add(s.source_field)
                fields.add(s.target_field)
            parts.append(f"Found {len(sparks)} cross-domain idea transfer(s) spanning {', '.join(list(fields)[:4])}.")
        if future_sparks:
            parts.append(f"{len(future_sparks)} potential future spark(s) identified.")
        return " ".join(parts)
