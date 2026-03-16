"""
backend/reading_between_lines.py — ReadingBetweenLines (F11.3)
"""
import logging
from dataclasses import dataclass
from backend.llm_client import get_llm_client

logger = logging.getLogger(__name__)


@dataclass
class BetweenTheLinesResult:
    paper_id:           str
    paper_title:        str
    real_claim:         str
    implicit_foil:      str
    confidence_signals: str
    minimal_claim:      str
    confidence:         str  # "abstract_only" | "full_text" | "unavailable"

    def to_dict(self) -> dict:
        return {
            "paper_id":           self.paper_id,
            "paper_title":        self.paper_title,
            "real_claim":         self.real_claim,
            "implicit_foil":      self.implicit_foil,
            "confidence_signals": self.confidence_signals,
            "minimal_claim":      self.minimal_claim,
            "confidence":         self.confidence,
        }


class ReadingBetweenLines:
    def analyze(self, graph_json: dict, paper_id: str) -> BetweenTheLinesResult:
        nodes      = graph_json.get("nodes", [])
        node_by_id = {n["id"]: n for n in nodes}
        node       = node_by_id.get(paper_id, {})
        title      = node.get("title", paper_id)
        abstract   = node.get("abstract", "") or node.get("abstract_preview", "")

        if not abstract:
            return BetweenTheLinesResult(
                paper_id=paper_id, paper_title=title,
                real_claim="Abstract unavailable.", implicit_foil="",
                confidence_signals="", minimal_claim="", confidence="unavailable",
            )

        llm    = get_llm_client()
        prompt = (
            f"You are a sharp academic reader. Analyze this paper's abstract:\n\n"
            f"Title: '{title}'\nAbstract: {abstract[:3000]}\n\n"
            f"Respond in exactly this format:\n"
            f"REAL_CLAIM: [One sentence — what the paper is actually claiming, stripped of all hedges.]\n"
            f"IMPLICIT_FOIL: [One sentence — what existing approach this paper is designed to challenge.]\n"
            f"CONFIDENCE_SIGNALS: [One sentence — what hedging language reveals about author confidence.]\n"
            f"MINIMAL_CLAIM: [One sentence — the simplest system that would demonstrate the core contribution.]\n"
        )
        try:
            raw = llm.generate_chat_response(
                system_prompt="You are a critical academic reader. Analyze papers precisely.",
                user_prompt=prompt,
            )
            if not raw:
                raise ValueError("Empty LLM response")
            parsed = self._parse(raw)
            return BetweenTheLinesResult(
                paper_id=paper_id, paper_title=title,
                real_claim=parsed.get("real_claim", "Could not extract."),
                implicit_foil=parsed.get("implicit_foil", ""),
                confidence_signals=parsed.get("confidence_signals", ""),
                minimal_claim=parsed.get("minimal_claim", ""),
                confidence="abstract_only",
            )
        except Exception as exc:
            logger.warning(f"ReadingBetweenLines LLM failed for {paper_id}: {exc}")
            return BetweenTheLinesResult(
                paper_id=paper_id, paper_title=title,
                real_claim="LLM analysis unavailable.", implicit_foil="",
                confidence_signals="", minimal_claim="", confidence="unavailable",
            )

    def _parse(self, raw: str) -> dict:
        import re
        keys = {
            "real_claim":         r"REAL_CLAIM:\s*(.+)",
            "implicit_foil":      r"IMPLICIT_FOIL:\s*(.+)",
            "confidence_signals": r"CONFIDENCE_SIGNALS:\s*(.+)",
            "minimal_claim":      r"MINIMAL_CLAIM:\s*(.+)",
        }
        result = {}
        for key, pattern in keys.items():
            m = re.search(pattern, raw, re.IGNORECASE)
            result[key] = m.group(1).strip() if m else ""
        return result
