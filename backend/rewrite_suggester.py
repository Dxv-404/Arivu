"""
backend/rewrite_suggester.py — RewriteSuggester (F4.3)

Takes an existing related-work section (as text) and suggests a rewrite that
frames it as an intellectual narrative — tracing idea evolution rather than
listing papers chronologically.

Stateless per-call. Uses Groq LLM only — no NLP worker call.

FIX: LLMClient → get_llm_client() (spec bug)
FIX: llm.call_llm() → llm.generate_chat_response() (spec bug)
"""
import logging
from dataclasses import dataclass

from backend.llm_client import get_llm_client

logger = logging.getLogger(__name__)

MAX_INPUT_CHARS = 6000


@dataclass
class RewriteResult:
    original_critique: str
    suggested_rewrite: str
    narrative_arc:     str
    principles_applied: list

    def to_dict(self) -> dict:
        return {
            "original_critique":  self.original_critique,
            "suggested_rewrite":  self.suggested_rewrite,
            "narrative_arc":      self.narrative_arc,
            "principles_applied": self.principles_applied,
        }


REWRITE_PRINCIPLES = [
    "Chronological listing → problem-driven narrative",
    "Paper citations as evidence, not as the subject",
    "Explicit statement of intellectual debt",
    "Identification of the contested gap this paper fills",
    "Forward-looking bridge to the paper's contribution",
]


class RewriteSuggester:
    """Stateless — instantiate fresh per request."""

    def suggest(self, related_work_text: str, paper_title: str = "") -> RewriteResult:
        if not related_work_text or not related_work_text.strip():
            return RewriteResult(
                original_critique="No text provided.",
                suggested_rewrite="",
                narrative_arc="",
                principles_applied=[],
            )

        truncated = related_work_text[:MAX_INPUT_CHARS]
        llm       = get_llm_client()

        critique, rewrite, arc, principles = self._call_llm(truncated, paper_title, llm)
        return RewriteResult(
            original_critique=critique,
            suggested_rewrite=rewrite,
            narrative_arc=arc,
            principles_applied=principles,
        )

    def _call_llm(self, text, title, llm):
        system = (
            "You are an expert academic writing coach specializing in related work sections. "
            "Given an existing related-work section, critique its structure and rewrite it as "
            "an intellectual narrative that traces idea evolution."
        )
        user = (
            f"Paper being written: '{title or 'Unknown'}'\n\n"
            f"EXISTING RELATED WORK SECTION:\n{text}\n\n"
            f"---\n"
            f"Respond in exactly this format:\n"
            f"CRITIQUE: [2-3 sentences describing what's weak about the original structure]\n"
            f"ARC: [one sentence describing the intellectual story arc of the rewrite]\n"
            f"REWRITE:\n[The full rewritten related-work section — preserve all citations]\n"
            f"PRINCIPLE1: [name] | [one sentence explanation of how it was applied]\n"
            f"PRINCIPLE2: [name] | [one sentence explanation]\n"
            f"PRINCIPLE3: [name] | [one sentence explanation]\n"
        )
        try:
            raw = llm.generate_chat_response(system, user) or ""
            critique  = ""
            arc       = ""
            rewrite   = ""
            principles = []
            in_rewrite = False

            for line in raw.split("\n"):
                if line.startswith("CRITIQUE:"):
                    critique   = line[9:].strip()
                    in_rewrite = False
                elif line.startswith("ARC:"):
                    arc        = line[4:].strip()
                    in_rewrite = False
                elif line.startswith("REWRITE:"):
                    in_rewrite = True
                    rewrite    = line[8:].strip()
                elif line.startswith("PRINCIPLE"):
                    in_rewrite = False
                    parts = line.split("|")
                    if len(parts) >= 2:
                        name = parts[0].split(":", 1)[-1].strip()
                        principles.append({"principle": name, "explanation": parts[1].strip()})
                elif in_rewrite:
                    rewrite += "\n" + line

            return (
                critique or "Could not analyze the original text.",
                rewrite.strip(),
                arc or "Narrative arc not determined.",
                principles,
            )
        except Exception as exc:
            logger.warning(f"Rewrite suggestion failed: {exc}")
            return (
                "Analysis unavailable — LLM call failed.",
                "",
                "",
                [],
            )
