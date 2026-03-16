"""
backend/science_journalism.py — ScienceJournalismLayer (F6.4)

Separate interface optimized for non-academic users. Components:
  - Hype detector: genuinely novel or incremental advance?
  - Context generator: intellectual backstory for any paper
  - Plain language graph: jargon replaced by plain language
  - Stakes analyzer: what does it mean if this paper is correct?
"""
import logging
from dataclasses import dataclass

from backend.llm_client import get_llm_client

logger = logging.getLogger(__name__)


@dataclass
class JournalismResult:
    paper_id:       str
    paper_title:    str
    hype_detector:  dict
    context_story:  str
    plain_language: str
    stakes_if_true: str

    def to_dict(self) -> dict:
        return {
            "paper_id":       self.paper_id,
            "paper_title":    self.paper_title,
            "hype_detector":  self.hype_detector,
            "context_story":  self.context_story,
            "plain_language": self.plain_language,
            "stakes_if_true": self.stakes_if_true,
        }


class ScienceJournalismLayer:
    """Stateless — instantiate fresh per request."""

    def analyze(self, graph_data: dict, paper_id: str) -> JournalismResult:
        nodes      = graph_data.get("nodes", [])
        node_by_id = {n["id"]: n for n in nodes}
        node       = node_by_id.get(paper_id, {})
        title      = node.get("title", paper_id)
        abstract   = node.get("abstract", "") or node.get("abstract_preview", "")

        # Gather context: ancestor titles, fields, year range
        edges      = graph_data.get("edges", [])
        ancestors  = self._get_ancestors(paper_id, nodes, edges, node_by_id)
        fields     = set()
        for n in nodes:
            for f in (n.get("fields_of_study") or []):
                fields.add(f)
        years = [n.get("year") for n in nodes if n.get("year")]
        year_range = f"{min(years)}–{max(years)}" if years else "unknown"

        ancestor_titles = ", ".join(
            a.get("title", "?")[:50] for a in ancestors[:5]
        )

        # LLM analysis
        hype_detector  = {"hype_score": 0.5, "hype_verdict": "unknown", "hype_reasoning": ""}
        context_story  = ""
        plain_language = ""
        stakes_if_true = ""

        try:
            llm = get_llm_client()
            prompt = (
                f"You are a science journalist analyzing a paper for a general audience.\n\n"
                f"Paper: '{title}'\n"
                f"Abstract: {(abstract or 'Not available')[:2000]}\n"
                f"Field(s): {', '.join(list(fields)[:5]) or 'Unknown'}\n"
                f"Year range of lineage: {year_range}\n"
                f"Key ancestors: {ancestor_titles or 'None identified'}\n\n"
                f"Respond in EXACTLY this format:\n"
                f"HYPE_SCORE: [0.0 to 1.0 — how hyped vs. incremental]\n"
                f"HYPE_VERDICT: [one word: groundbreaking / significant / incremental / overhyped]\n"
                f"HYPE_REASONING: [One sentence explaining the hype assessment]\n"
                f"CONTEXT_STORY: [2-3 sentences — the intellectual backstory for a general reader]\n"
                f"PLAIN_LANGUAGE: [2-3 sentences — what this paper does, no jargon]\n"
                f"STAKES_IF_TRUE: [2-3 sentences — what becomes possible if this is correct]\n"
            )
            raw = llm.generate_chat_response(
                system_prompt="You are a science journalist making research accessible to the public.",
                user_prompt=prompt,
            )
            if raw:
                parsed = self._parse(raw)
                try:
                    score = float(parsed.get("hype_score", "0.5"))
                except (ValueError, TypeError):
                    score = 0.5
                hype_detector = {
                    "hype_score":     round(min(1.0, max(0.0, score)), 2),
                    "hype_verdict":   parsed.get("hype_verdict", "unknown").strip(),
                    "hype_reasoning": parsed.get("hype_reasoning", "").strip(),
                }
                context_story  = parsed.get("context_story", "").strip()
                plain_language = parsed.get("plain_language", "").strip()
                stakes_if_true = parsed.get("stakes_if_true", "").strip()
        except Exception as exc:
            logger.warning(f"ScienceJournalismLayer LLM failed for {paper_id}: {exc}")

        # Fallbacks
        if not context_story:
            context_story = f"This paper belongs to a research lineage spanning {year_range} in {', '.join(list(fields)[:3]) or 'multiple fields'}."
        if not plain_language:
            plain_language = f"'{title}' is a research paper that builds on {len(ancestors)} previous works."
        if not stakes_if_true:
            stakes_if_true = "If confirmed, this work could influence future research directions in its field."

        return JournalismResult(
            paper_id=paper_id,
            paper_title=title,
            hype_detector=hype_detector,
            context_story=context_story,
            plain_language=plain_language,
            stakes_if_true=stakes_if_true,
        )

    def _get_ancestors(self, paper_id: str, nodes: list, edges: list, node_by_id: dict) -> list:
        """Get papers cited by this paper (immediate ancestors)."""
        ancestor_ids = set()
        for e in edges:
            src = e.get("source") or e.get("citing_paper_id", "")
            tgt = e.get("target") or e.get("cited_paper_id", "")
            if src == paper_id:
                ancestor_ids.add(tgt)
        return [node_by_id[pid] for pid in ancestor_ids if pid in node_by_id]

    def _parse(self, raw: str) -> dict:
        import re
        keys = {
            "hype_score":     r"HYPE_SCORE:\s*(.+)",
            "hype_verdict":   r"HYPE_VERDICT:\s*(.+)",
            "hype_reasoning": r"HYPE_REASONING:\s*(.+)",
            "context_story":  r"CONTEXT_STORY:\s*(.+)",
            "plain_language": r"PLAIN_LANGUAGE:\s*(.+)",
            "stakes_if_true": r"STAKES_IF_TRUE:\s*(.+)",
        }
        result = {}
        for key, pattern in keys.items():
            m = re.search(pattern, raw, re.IGNORECASE)
            result[key] = m.group(1).strip() if m else ""
        return result
