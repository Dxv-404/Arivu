"""
backend/interdisciplinary_translation.py — InterdisciplinaryTranslator (F8.3)

Cross-field vocabulary equivalence map. Identifies when two different fields
use different vocabulary for the same underlying mathematical or conceptual
structure. Shows which techniques from Field A have been translated into
Field B and which haven't (untranslated = research opportunities).
"""
import logging
from collections import defaultdict

from backend.llm_client import get_llm_client

logger = logging.getLogger(__name__)


class InterdisciplinaryTranslator:
    """Stateless — instantiate fresh per request."""

    def translate(self, graph_data: dict) -> dict:
        nodes = graph_data.get("nodes", [])
        edges = graph_data.get("edges", [])

        if len(nodes) < 3:
            return {"equivalences": [], "untranslated": [], "summary": "Graph too small for translation analysis."}

        # Group papers by field
        field_groups = defaultdict(list)
        for n in nodes:
            for f in (n.get("fields_of_study") or []):
                field_groups[f].append(n)

        # Need at least 2 fields for cross-domain analysis
        if len(field_groups) < 2:
            return {
                "equivalences": [],
                "untranslated": [],
                "summary": "Only one field detected — interdisciplinary translation requires at least two fields.",
            }

        # Build field pairs and their shared/unique concepts
        fields = sorted(field_groups.keys(), key=lambda f: -len(field_groups[f]))[:5]
        field_pairs = []
        for i, f1 in enumerate(fields):
            for f2 in fields[i + 1:]:
                field_pairs.append((f1, f2))

        equivalences = []
        untranslated = []

        try:
            llm = get_llm_client()

            for field_a, field_b in field_pairs[:3]:
                papers_a = field_groups[field_a][:5]
                papers_b = field_groups[field_b][:5]

                titles_a = ", ".join(p.get("title", "?")[:50] for p in papers_a)
                titles_b = ", ".join(p.get("title", "?")[:50] for p in papers_b)

                prompt = (
                    f"You are an interdisciplinary research translator.\n\n"
                    f"Field A ({field_a}) papers: {titles_a}\n"
                    f"Field B ({field_b}) papers: {titles_b}\n\n"
                    f"Identify vocabulary equivalences: concepts that mean the same thing "
                    f"but use different terminology in each field.\n"
                    f"Also identify techniques from one field that have NOT been translated "
                    f"to the other (these are research opportunities).\n\n"
                    f"Respond in EXACTLY this format (you may repeat lines):\n"
                    f"TERM_A: [term from {field_a}]\n"
                    f"TERM_B: [equivalent term from {field_b}]\n"
                    f"EXPLANATION: [why they are equivalent]\n"
                    f"UNTRANSLATED: [technique with no cross-field equivalent]\n"
                )
                raw = llm.generate_chat_response(
                    system_prompt="You are an interdisciplinary research translator finding vocabulary equivalences across fields.",
                    user_prompt=prompt,
                )
                if raw:
                    parsed = self._parse(raw, field_a, field_b)
                    equivalences.extend(parsed.get("equivalences", []))
                    untranslated.extend(parsed.get("untranslated", []))
        except Exception as exc:
            logger.warning(f"InterdisciplinaryTranslator LLM failed: {exc}")

        # Fallback if LLM produced nothing
        if not equivalences and not untranslated:
            equivalences = [{
                "term_a": "N/A",
                "term_b": "N/A",
                "field_a": fields[0] if fields else "",
                "field_b": fields[1] if len(fields) > 1 else "",
                "explanation": "LLM analysis unavailable — try again later.",
            }]

        n_fields = len(fields)
        summary = (
            f"Analyzed {n_fields} fields across {len(nodes)} papers. "
            f"Found {len(equivalences)} vocabulary equivalence(s) and "
            f"{len(untranslated)} untranslated technique(s) (potential research opportunities)."
        )

        return {
            "equivalences": equivalences[:20],
            "untranslated": untranslated[:10],
            "summary": summary,
        }

    def _parse(self, raw: str, field_a: str, field_b: str) -> dict:
        import re
        equivalences = []
        untranslated = []

        # Find TERM_A/TERM_B/EXPLANATION groups
        term_a_matches = re.findall(r"TERM_A:\s*(.+)", raw, re.IGNORECASE)
        term_b_matches = re.findall(r"TERM_B:\s*(.+)", raw, re.IGNORECASE)
        explanation_matches = re.findall(r"EXPLANATION:\s*(.+)", raw, re.IGNORECASE)

        for i in range(min(len(term_a_matches), len(term_b_matches))):
            equivalences.append({
                "term_a": term_a_matches[i].strip(),
                "term_b": term_b_matches[i].strip(),
                "field_a": field_a,
                "field_b": field_b,
                "explanation": explanation_matches[i].strip() if i < len(explanation_matches) else "",
            })

        # Find UNTRANSLATED entries
        for m in re.finditer(r"UNTRANSLATED:\s*(.+)", raw, re.IGNORECASE):
            untranslated.append({
                "technique": m.group(1).strip(),
                "fields": [field_a, field_b],
                "opportunity": True,
            })

        return {"equivalences": equivalences, "untranslated": untranslated}
