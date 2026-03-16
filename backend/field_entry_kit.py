"""
backend/field_entry_kit.py — FieldEntryKit (F4.7)

Generates a structured "field entry kit" for newcomers to a research area,
based on the intellectual ancestry graph.
"""
import logging
from dataclasses import dataclass
from typing import Optional

from backend.llm_client import get_llm_client

logger = logging.getLogger(__name__)


@dataclass
class FieldEntryKitResult:
    seed_title:        str
    prerequisites:     list
    key_concepts:      list
    reading_order:     list
    common_pitfalls:   list
    open_questions:    list

    def to_dict(self) -> dict:
        return {
            "seed_title":      self.seed_title,
            "prerequisites":   self.prerequisites,
            "key_concepts":    self.key_concepts,
            "reading_order":   self.reading_order,
            "common_pitfalls": self.common_pitfalls,
            "open_questions":  self.open_questions,
        }


class FieldEntryKit:
    """Stateless — instantiate fresh per request."""

    def generate(self, graph_json: dict, research_question: str = "", user_id: str = None) -> dict:
        nodes = graph_json.get("nodes", [])
        edges = graph_json.get("edges", [])
        meta  = graph_json.get("metadata", {})
        seed_title = meta.get("seed_paper_title", "Unknown")

        if len(nodes) < 3:
            return {"error": "Graph too small for field entry kit generation."}

        node_by_id = {n["id"]: n for n in nodes}

        # Prerequisites: oldest, most-cited papers (foundational)
        sorted_by_year = sorted(
            [n for n in nodes if n.get("year")],
            key=lambda n: (n.get("year", 9999), -(n.get("citation_count") or 0)),
        )
        prerequisites = [
            {"paper_id": n["id"], "title": n.get("title", ""), "year": n.get("year"),
             "why": f"Foundational work ({n.get('citation_count', 0):,} citations)"}
            for n in sorted_by_year[:5]
        ]

        # Key concepts: extract from fields of study
        field_counts: dict = {}
        for n in nodes:
            for f in (n.get("fields_of_study") or []):
                field_counts[f] = field_counts.get(f, 0) + 1
        key_concepts = sorted(field_counts.items(), key=lambda x: x[1], reverse=True)[:8]
        key_concepts = [{"concept": k, "paper_count": v} for k, v in key_concepts]

        # Reading order: topological sort by citation chain
        reading_order = []
        cited_counts: dict = {}
        for e in edges:
            tgt = e.get("target") or e.get("cited_paper_id", "")
            cited_counts[tgt] = cited_counts.get(tgt, 0) + 1

        # Start with roots (most cited), work towards leaves
        sorted_nodes = sorted(nodes, key=lambda n: (
            -cited_counts.get(n["id"], 0),
            n.get("year") or 9999,
        ))
        for i, n in enumerate(sorted_nodes[:10]):
            reading_order.append({
                "order":    i + 1,
                "paper_id": n["id"],
                "title":    n.get("title", ""),
                "year":     n.get("year"),
                "reason":   f"Cited by {cited_counts.get(n['id'], 0)} papers in this lineage.",
            })

        # Common pitfalls and open questions via LLM (or template fallback)
        pitfalls = []
        open_questions = []
        try:
            llm = get_llm_client()
            titles = ", ".join(n.get("title", "?")[:50] for n in sorted_by_year[:5])
            raw = llm.generate_chat_response(
                system_prompt="You are a research mentor helping newcomers enter a field.",
                user_prompt=(
                    f"Based on these foundational papers in the ancestry of '{seed_title}':\n"
                    f"{titles}\n\n"
                    f"List 2 common pitfalls newcomers face and 2 open questions.\n"
                    f"PITFALL1: ...\nPITFALL2: ...\nQUESTION1: ...\nQUESTION2: ...\n"
                ),
            )
            if raw:
                import re
                for i in range(1, 3):
                    m = re.search(rf"PITFALL{i}:\s*(.+)", raw, re.IGNORECASE)
                    if m:
                        pitfalls.append(m.group(1).strip())
                    m = re.search(rf"QUESTION{i}:\s*(.+)", raw, re.IGNORECASE)
                    if m:
                        open_questions.append(m.group(1).strip())
        except Exception as exc:
            logger.warning(f"FieldEntryKit LLM failed: {exc}")

        if not pitfalls:
            pitfalls = [
                "Assuming foundational results still hold without checking for retractions or corrections.",
                "Skipping the historical context — understanding WHY a method was developed matters.",
            ]
        if not open_questions:
            open_questions = [
                "Which foundational assumptions remain unverified?",
                "What cross-domain applications remain unexplored?",
            ]

        result = FieldEntryKitResult(
            seed_title=seed_title,
            prerequisites=prerequisites,
            key_concepts=key_concepts,
            reading_order=reading_order,
            common_pitfalls=pitfalls,
            open_questions=open_questions,
        )
        return result.to_dict()
