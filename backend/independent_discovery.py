"""
backend/independent_discovery.py — IndependentDiscoveryTracker

Detection criteria (ALL must be true):
  1. High semantic similarity (>= SIMILARITY_THRESHOLD)
  2. No citation relationship in either direction
  3. Publication dates within CONVERGENCE_WINDOW_MONTHS of each other
  4. Authors from different institutions (skipped if data unavailable, lowers confidence)

Uses pre-computed embeddings from paper_embeddings via pgvector. No NLP worker calls.
shared_concept descriptions generated via single batched LLM call (falls back to template).
"""
import logging
import math
import re
from dataclasses import dataclass
from typing import Optional

import backend.db as db

logger = logging.getLogger(__name__)

SIMILARITY_THRESHOLD      = 0.72
CONVERGENCE_WINDOW_MONTHS = 24
MAX_PAIRS_RETURNED        = 10


def _extract_institutions(node: dict) -> set:
    """Extract institution names from a graph node's authors field."""
    institutions = set()
    for author in node.get("authors", []):
        if isinstance(author, dict):
            for affiliation in author.get("affiliations", []):
                if isinstance(affiliation, dict):
                    name = affiliation.get("name", "").strip().lower()
                elif isinstance(affiliation, str):
                    name = affiliation.strip().lower()
                else:
                    continue
                if name:
                    institutions.add(name)
    return institutions


@dataclass
class DiscoveryPair:
    paper_a_id:     str
    paper_b_id:     str
    paper_a_title:  str
    paper_b_title:  str
    paper_a_year:   Optional[int]
    paper_b_year:   Optional[int]
    similarity:     float
    months_apart:   int
    date_precision: str   # "month" | "year"
    shared_concept: str
    confidence:     str   # "high" | "medium" | "low"

    def to_dict(self) -> dict:
        return {
            "paper_a_id":     self.paper_a_id,
            "paper_b_id":     self.paper_b_id,
            "paper_a_title":  self.paper_a_title,
            "paper_b_title":  self.paper_b_title,
            "paper_a_year":   self.paper_a_year,
            "paper_b_year":   self.paper_b_year,
            "similarity":     round(self.similarity, 3),
            "months_apart":   self.months_apart,
            "date_precision": self.date_precision,
            "shared_concept": self.shared_concept,
            "confidence":     self.confidence,
        }


class IndependentDiscoveryTracker:
    """Stateless — instantiate fresh per request."""

    def find_independent_discoveries(self, graph_json: dict) -> list[DiscoveryPair]:
        nodes = graph_json.get("nodes", [])
        edges = graph_json.get("edges", [])

        if len(nodes) < 2:
            return []

        cited_pairs: set = set()
        for edge in edges:
            src = edge.get("source") or edge.get("citing_paper_id", "")
            tgt = edge.get("target") or edge.get("cited_paper_id", "")
            if src and tgt:
                cited_pairs.add((src, tgt))
                cited_pairs.add((tgt, src))

        node_by_id = {n["id"]: n for n in nodes}
        node_ids   = [n["id"] for n in nodes if n.get("year")]

        if not node_ids:
            return []

        rows = db.fetchall(
            "SELECT paper_id, embedding FROM paper_embeddings WHERE paper_id = ANY(%s)",
            (node_ids,),
        )
        embeddings = {r["paper_id"]: r["embedding"] for r in rows if r.get("embedding")}

        if len(embeddings) < 2:
            return []

        pairs: list[DiscoveryPair] = []
        ids_with_emb = list(embeddings.keys())

        for i, id_a in enumerate(ids_with_emb):
            for id_b in ids_with_emb[i+1:]:
                if (id_a, id_b) in cited_pairs:
                    continue

                node_a = node_by_id.get(id_a, {})
                node_b = node_by_id.get(id_b, {})
                year_a = node_a.get("year")
                year_b = node_b.get("year")

                if not year_a or not year_b:
                    continue

                # Criterion 3: publication date proximity
                pub_date_a = node_a.get("publication_date")
                pub_date_b = node_b.get("publication_date")
                date_precision = "year"
                if pub_date_a and pub_date_b:
                    try:
                        from datetime import datetime
                        d_a = datetime.strptime(pub_date_a[:7], "%Y-%m")
                        d_b = datetime.strptime(pub_date_b[:7], "%Y-%m")
                        months_apart = abs((d_a.year - d_b.year) * 12 + (d_a.month - d_b.month))
                        date_precision = "month"
                    except ValueError:
                        months_apart = abs((year_a - year_b) * 12)
                else:
                    months_apart = abs((year_a - year_b) * 12)

                if months_apart > CONVERGENCE_WINDOW_MONTHS:
                    continue

                # Criterion 4: different institutions
                inst_a = _extract_institutions(node_a)
                inst_b = _extract_institutions(node_b)
                institution_data_available = bool(inst_a and inst_b)
                if institution_data_available and inst_a == inst_b:
                    continue   # same institution — skip

                # Criterion 2: semantic similarity
                sim = self._cosine_similarity(embeddings[id_a], embeddings[id_b])
                if sim < SIMILARITY_THRESHOLD:
                    continue

                # Confidence
                if months_apart <= 6 and institution_data_available:
                    confidence = "high"
                elif months_apart <= 12:
                    confidence = "medium"
                else:
                    confidence = "low"
                if not institution_data_available and confidence == "high":
                    confidence = "medium"

                pairs.append(DiscoveryPair(
                    paper_a_id=id_a, paper_b_id=id_b,
                    paper_a_title=node_a.get("title", "Unknown"),
                    paper_b_title=node_b.get("title", "Unknown"),
                    paper_a_year=year_a, paper_b_year=year_b,
                    similarity=sim, months_apart=months_apart,
                    date_precision=date_precision,
                    shared_concept="",   # filled by batch LLM below
                    confidence=confidence,
                ))

        pairs.sort(key=lambda p: p.similarity, reverse=True)
        top_pairs = pairs[:MAX_PAIRS_RETURNED]

        # Generate shared_concept descriptions via single LLM call
        concepts = self._generate_shared_concepts_batch(top_pairs, node_by_id)
        for pair, concept in zip(top_pairs, concepts):
            pair.shared_concept = concept

        return top_pairs

    def _generate_shared_concepts_batch(self, pairs: list, node_by_id: dict) -> list[str]:
        """Single LLM call for all pairs. Falls back to template on failure."""
        if not pairs:
            return []
        try:
            from backend.llm_client import get_llm_client
            client = get_llm_client()
            if not client.available:
                raise RuntimeError("LLM not available")
            descriptions = []
            for i, pair in enumerate(pairs):
                descriptions.append(
                    f"{i+1}. Paper A: \"{pair.paper_a_title}\" ({pair.paper_a_year})\n"
                    f"   Paper B: \"{pair.paper_b_title}\" ({pair.paper_b_year})\n"
                    f"   Similarity: {pair.similarity:.2f}, {pair.months_apart} months apart"
                )
            prompt = (
                "The following pairs of papers appear to be independent simultaneous discoveries. "
                "For each pair, write one concise sentence (max 20 words) describing the shared "
                "intellectual contribution. Focus on the specific problem both solved.\n\n"
                + "\n".join(descriptions)
                + "\n\nRespond with exactly one numbered line per pair. No preamble."
            )
            result   = client.generate_chat_response(
                "You are a research analyst identifying independent discoveries.",
                prompt,
            )
            if not result:
                raise RuntimeError("LLM returned empty")
            lines    = [l.strip() for l in result.strip().split("\n") if l.strip()]
            concepts = [re.sub(r"^\d+\.\s*", "", line) for line in lines]
            while len(concepts) < len(pairs):
                idx = len(concepts)
                concepts.append(self._infer_shared_concept_fallback(
                    node_by_id.get(pairs[idx].paper_a_id, {}),
                    node_by_id.get(pairs[idx].paper_b_id, {}),
                ))
            return concepts[:len(pairs)]
        except Exception as exc:
            logger.warning(f"LLM batch concept generation failed: {exc} — using fallbacks")
            return [
                self._infer_shared_concept_fallback(
                    node_by_id.get(p.paper_a_id, {}),
                    node_by_id.get(p.paper_b_id, {}),
                )
                for p in pairs
            ]

    def _infer_shared_concept_fallback(self, node_a: dict, node_b: dict) -> str:
        fields_a = set(node_a.get("fields_of_study", []))
        fields_b = set(node_b.get("fields_of_study", []))
        shared   = fields_a & fields_b
        field_str = next(iter(shared), "multiple fields") if shared else "different fields"
        return f"Simultaneous contribution to {field_str} — no citation relationship found."

    @staticmethod
    def _cosine_similarity(a, b) -> float:
        try:
            if hasattr(a, "tolist"): a = a.tolist()
            if hasattr(b, "tolist"): b = b.tolist()
            dot   = sum(x * y for x, y in zip(a, b))
            mag_a = math.sqrt(sum(x * x for x in a))
            mag_b = math.sqrt(sum(x * x for x in b))
            if mag_a == 0 or mag_b == 0: return 0.0
            return dot / (mag_a * mag_b)
        except Exception:
            return 0.0
