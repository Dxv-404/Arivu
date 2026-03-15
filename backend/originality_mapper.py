"""
backend/originality_mapper.py

OriginalityMapper: classifies each paper's contribution type by comparing
its embeddings to those of its direct ancestors in the graph.

Contribution types (spec F1.11):
  Pioneer     — introduces concepts with no close ancestor in this graph
  Synthesizer — combines multiple existing ideas (>=3 ancestors, moderate sim)
  Bridge      — connects previously separate fields
  Refiner     — deeply extends a single prior idea (high sim, <=3 ancestors)
  Contradictor— primary contribution challenges prior work

Uses pre-computed embeddings from paper_embeddings table via pgvector.
Falls back to structural heuristics if embeddings are unavailable.
Does NOT call the NLP worker at request time.
"""
import logging
import math
from dataclasses import dataclass
from typing import Optional
from collections import Counter

import backend.db as db

logger = logging.getLogger(__name__)

PIONEER_THRESHOLD = 0.30   # max_sim below this -> Pioneer
NOVEL_THRESHOLD   = 0.45   # ancestor sims below this -> novel contribution


@dataclass
class OriginalityScore:
    paper_id:           str
    contribution_type:  str    # Pioneer|Synthesizer|Bridge|Refiner|Contradictor
    score:              float  # 0-1 novelty fraction
    inherited_fraction: float  # 0-1 how much came from ancestors
    novel_idea_count:   int
    total_idea_count:   int
    dominant_ancestor:  Optional[str]
    ancestor_count:     int
    confidence:         str    # "high"|"medium"|"low"
    evidence:           str

    def to_dict(self) -> dict:
        return {
            "paper_id":           self.paper_id,
            "contribution_type":  self.contribution_type,
            "score":              round(self.score, 3),
            "inherited_fraction": round(self.inherited_fraction, 3),
            "novel_idea_count":   self.novel_idea_count,
            "total_idea_count":   self.total_idea_count,
            "dominant_ancestor":  self.dominant_ancestor,
            "ancestor_count":     self.ancestor_count,
            "confidence":         self.confidence,
            "evidence":           self.evidence,
        }


class OriginalityMapper:
    """Stateless — instantiate fresh per request."""

    def compute_originality(
        self, paper_id: str, graph_json: dict
    ) -> Optional[OriginalityScore]:
        """
        Classify the contribution type of paper_id within this graph.
        Returns None if paper_id is not in the graph.
        """
        nodes    = graph_json.get("nodes", [])
        edges    = graph_json.get("edges", [])
        nodes_by_id = {n["id"]: n for n in nodes}

        if paper_id not in nodes_by_id:
            return None

        ancestor_ids: list     = []
        edge_to_ancestors: dict = {}
        for edge in edges:
            src = edge.get("source") or edge.get("citing_paper_id", "")
            tgt = edge.get("target") or edge.get("cited_paper_id", "")
            if src == paper_id:
                ancestor_ids.append(tgt)
                edge_to_ancestors[tgt] = edge

        if not ancestor_ids:
            return OriginalityScore(
                paper_id=paper_id, contribution_type="Pioneer",
                score=1.0, inherited_fraction=0.0,
                novel_idea_count=0, total_idea_count=0,
                dominant_ancestor=None, ancestor_count=0,
                confidence="low",
                evidence="No ancestors found in graph — Pioneer classification by default.",
            )

        all_ids = [paper_id] + ancestor_ids
        try:
            rows = db.fetchall(
                "SELECT paper_id, embedding FROM paper_embeddings "
                "WHERE paper_id = ANY(%s)",
                (all_ids,),
            )
        except Exception as exc:
            logger.warning(f"Embedding lookup failed: {exc} — using structural fallback")
            rows = []

        embeddings = {r["paper_id"]: r["embedding"] for r in rows if r.get("embedding")}

        paper_emb = embeddings.get(paper_id)
        if not paper_emb:
            return self._structural_fallback(
                paper_id, ancestor_ids, edge_to_ancestors, nodes_by_id
            )

        ancestor_sims: dict = {}
        for aid in ancestor_ids:
            anc_emb = embeddings.get(aid)
            if anc_emb:
                sim = self._cosine_similarity(paper_emb, anc_emb)
                ancestor_sims[aid] = sim

        if not ancestor_sims:
            return self._structural_fallback(
                paper_id, ancestor_ids, edge_to_ancestors, nodes_by_id
            )

        max_sim    = max(ancestor_sims.values())
        mean_sim   = sum(ancestor_sims.values()) / len(ancestor_sims)
        n_ancestors = len(ancestor_ids)

        mutation_counts = Counter(
            edge_to_ancestors[aid].get("mutation_type", "unknown")
            for aid in ancestor_ids if aid in edge_to_ancestors
        )

        contribution_type, evidence = self._classify(
            max_sim=max_sim, mean_sim=mean_sim, n_ancestors=n_ancestors,
            mutation_counts=mutation_counts, nodes_by_id=nodes_by_id,
            ancestor_ids=ancestor_ids, paper_node=nodes_by_id[paper_id],
        )

        novel_sims        = [s for s in ancestor_sims.values() if s < NOVEL_THRESHOLD]
        novel_fraction    = len(novel_sims) / max(len(ancestor_sims), 1)
        inherited_fraction = 1.0 - novel_fraction
        dominant_ancestor  = max(ancestor_sims, key=ancestor_sims.get) if ancestor_sims else None

        n_with_embedding = len(ancestor_sims)
        n_without        = n_ancestors - n_with_embedding
        if n_without == 0:
            confidence = "high"
        elif n_without <= n_ancestors * 0.3:
            confidence = "medium"
        else:
            confidence = "low"

        return OriginalityScore(
            paper_id=paper_id, contribution_type=contribution_type,
            score=round(novel_fraction, 3),
            inherited_fraction=round(inherited_fraction, 3),
            novel_idea_count=len(novel_sims), total_idea_count=len(ancestor_sims),
            dominant_ancestor=dominant_ancestor, ancestor_count=n_ancestors,
            confidence=confidence, evidence=evidence,
        )

    def _classify(self, max_sim, mean_sim, n_ancestors, mutation_counts,
                  nodes_by_id, ancestor_ids, paper_node):
        contradiction_rate = (
            mutation_counts.get("contradiction", 0) /
            max(sum(mutation_counts.values()), 1)
        )
        if contradiction_rate >= 0.4:
            return "Contradictor", (
                f"Primary contribution challenges prior work: "
                f"{mutation_counts['contradiction']} contradiction edges "
                f"({contradiction_rate:.0%} of all edges)."
            )
        if max_sim < PIONEER_THRESHOLD:
            return "Pioneer", (
                f"Max similarity to any ancestor is {max_sim:.2f} (< {PIONEER_THRESHOLD}). "
                f"Introduces concepts with no close ancestor in this graph."
            )
        paper_fields    = set(paper_node.get("fields_of_study", []))
        ancestor_fields = set()
        for aid in ancestor_ids:
            ancestor_fields.update(nodes_by_id.get(aid, {}).get("fields_of_study", []))
        new_fields = paper_fields - ancestor_fields
        if len(new_fields) >= 1 and len(paper_fields) >= 2:
            return "Bridge", (
                f"Connects fields: paper spans {paper_fields}, "
                f"introducing {new_fields} not present in ancestors."
            )
        if n_ancestors <= 3 and max_sim >= 0.70:
            return "Refiner", (
                f"Deeply develops a single idea: max similarity {max_sim:.2f} "
                f"to dominant ancestor, {n_ancestors} total ancestors."
            )
        if n_ancestors >= 3 and 0.35 <= mean_sim <= 0.70:
            return "Synthesizer", (
                f"Combines {n_ancestors} existing ideas: mean similarity {mean_sim:.2f}."
            )
        if max_sim >= 0.60:
            return "Refiner", f"Extends prior work closely (max sim {max_sim:.2f})."
        return "Synthesizer", f"Combines multiple ideas (mean sim {mean_sim:.2f})."

    def _structural_fallback(self, paper_id, ancestor_ids, edge_to_ancestors, nodes_by_id):
        n = len(ancestor_ids)
        mutation_counts = Counter(
            edge_to_ancestors.get(aid, {}).get("mutation_type", "unknown")
            for aid in ancestor_ids
        )
        if mutation_counts.get("contradiction", 0) / max(n, 1) >= 0.4:
            ctype = "Contradictor"
        elif n <= 2:
            ctype = "Refiner"
        else:
            ctype = "Synthesizer"
        return OriginalityScore(
            paper_id=paper_id, contribution_type=ctype,
            score=0.5, inherited_fraction=0.5,
            novel_idea_count=0, total_idea_count=0,
            dominant_ancestor=ancestor_ids[0] if ancestor_ids else None,
            ancestor_count=n, confidence="low",
            evidence="Classified from graph structure only — no embeddings available.",
        )

    @staticmethod
    def _cosine_similarity(a, b) -> float:
        try:
            if hasattr(a, "tolist"): a = a.tolist()
            if hasattr(b, "tolist"): b = b.tolist()
            dot   = sum(x * y for x, y in zip(a, b))
            mag_a = math.sqrt(sum(x * x for x in a))
            mag_b = math.sqrt(sum(x * x for x in b))
            if mag_a == 0 or mag_b == 0:
                return 0.0
            return dot / (mag_a * mag_b)
        except Exception:
            return 0.0
