"""
backend/paper_positioning.py — PaperPositioningTool (F4.2)

For any paper (by abstract or full text): identify where it sits in the intellectual
landscape, find its natural comparators, suggest the strongest framing, and recommend
appropriate publication venues.

Uses pgvector for landscape search + Groq LLM for framing suggestions.
Does NOT call NLP worker for existing papers (uses stored embeddings).

FIX: LLMClient → get_llm_client() (spec bug)
FIX: llm.call_llm() → llm.generate_chat_response() (spec bug)
"""
import logging
import re
from collections import Counter
from dataclasses import dataclass
from typing import Optional

import backend.db as db
from backend.config import Config
from backend.llm_client import get_llm_client

logger = logging.getLogger(__name__)

MAX_COMPARATORS = 8
SIMILARITY_FLOOR = 0.55


@dataclass
class PositioningResult:
    paper_id:          Optional[str]
    paper_title:       str
    intellectual_cluster: str
    comparators:       list
    strongest_framing: str
    venue_recommendations: list
    positioning_statement: str

    def to_dict(self) -> dict:
        return {
            "paper_id":            self.paper_id,
            "paper_title":         self.paper_title,
            "intellectual_cluster": self.intellectual_cluster,
            "comparators":         self.comparators,
            "strongest_framing":   self.strongest_framing,
            "venue_recommendations": self.venue_recommendations,
            "positioning_statement": self.positioning_statement,
        }


class PaperPositioningTool:
    """Stateless — instantiate fresh per request."""

    def position_by_abstract(self, title: str, abstract: str) -> PositioningResult:
        """Position a paper that may not yet be in the DB."""
        embedding = self._embed_text(abstract)
        comparators = self._find_comparators_by_embedding(embedding) if embedding else []
        return self._build_result(None, title, abstract, comparators)

    def position_by_paper_id(self, paper_id: str, graph_json: dict) -> PositioningResult:
        """Position a paper that is already in the graph."""
        node_by_id = {n["id"]: n for n in graph_json.get("nodes", [])}
        node = node_by_id.get(paper_id, {})
        title    = node.get("title", paper_id)
        abstract = node.get("abstract", "")

        comparators = self._find_comparators_by_paper_id(paper_id)
        if not comparators and abstract:
            embedding   = self._embed_text(abstract)
            comparators = self._find_comparators_by_embedding(embedding) if embedding else []

        return self._build_result(paper_id, title, abstract, comparators)

    def _embed_text(self, text: str) -> Optional[list]:
        try:
            import httpx
            resp = httpx.post(
                f"{Config.NLP_WORKER_URL}/encode_batch",
                json={"texts": [text[:4000]], "model": "abstract"},
                headers={"X-API-Key": Config.WORKER_SECRET},
                timeout=15.0,
            )
            return resp.json()["embeddings"][0]
        except Exception as exc:
            logger.warning(f"Embedding failed: {exc}")
            return None

    def _find_comparators_by_embedding(self, embedding: list) -> list:
        emb_str = "[" + ",".join(str(x) for x in embedding) + "]"
        try:
            rows = db.fetchall(
                """
                SELECT p.paper_id, p.title, p.year, p.citation_count,
                       p.fields_of_study,
                       1 - (pe.embedding <=> %s::vector) AS similarity
                FROM paper_embeddings pe
                JOIN papers p ON p.paper_id = pe.paper_id
                WHERE 1 - (pe.embedding <=> %s::vector) > %s
                ORDER BY pe.embedding <=> %s::vector
                LIMIT %s
                """,
                (emb_str, emb_str, SIMILARITY_FLOOR, emb_str, MAX_COMPARATORS),
            )
            return [dict(r) for r in rows]
        except Exception as exc:
            logger.warning(f"Comparator search failed: {exc}")
            return []

    def _find_comparators_by_paper_id(self, paper_id: str) -> list:
        try:
            rows = db.fetchall(
                """
                SELECT p2.paper_id, p2.title, p2.year, p2.citation_count,
                       p2.fields_of_study,
                       1 - (pe1.embedding <=> pe2.embedding) AS similarity
                FROM paper_embeddings pe1
                JOIN paper_embeddings pe2 ON pe2.paper_id != pe1.paper_id
                JOIN papers p2 ON p2.paper_id = pe2.paper_id
                WHERE pe1.paper_id = %s
                  AND 1 - (pe1.embedding <=> pe2.embedding) > %s
                ORDER BY pe1.embedding <=> pe2.embedding
                LIMIT %s
                """,
                (paper_id, SIMILARITY_FLOOR, MAX_COMPARATORS),
            )
            return [dict(r) for r in rows]
        except Exception as exc:
            logger.warning(f"Paper comparator search failed: {exc}")
            return []

    def _build_result(
        self, paper_id: Optional[str], title: str, abstract: str, comparators: list
    ) -> PositioningResult:
        llm = get_llm_client()

        cluster = self._identify_cluster(comparators)
        enriched = []
        for c in comparators[:5]:
            enriched.append({
                "paper_id":    c["paper_id"],
                "title":       c.get("title", ""),
                "year":        c.get("year"),
                "similarity":  round(float(c.get("similarity", 0)), 3),
                "how_different": self._differentiate(title, c.get("title", "")),
            })

        framing, statement, venues = self._generate_framing(title, abstract, enriched, llm)

        return PositioningResult(
            paper_id=paper_id,
            paper_title=title,
            intellectual_cluster=cluster,
            comparators=enriched,
            strongest_framing=framing,
            venue_recommendations=venues,
            positioning_statement=statement,
        )

    def _identify_cluster(self, comparators: list) -> str:
        if not comparators:
            return "Unknown cluster"
        fields = []
        for c in comparators[:4]:
            fs = c.get("fields_of_study") or []
            fields.extend(fs[:1])
        if fields:
            most_common = Counter(fields).most_common(1)[0][0]
            return most_common
        return "Interdisciplinary"

    def _differentiate(self, title_a: str, title_b: str) -> str:
        words_a = set(title_a.lower().split())
        words_b = set(title_b.lower().split())
        unique_to_a = words_a - words_b - {"the","a","of","in","for","and","with","on"}
        if unique_to_a:
            return f"This work focuses on: {', '.join(list(unique_to_a)[:3])}"
        return "Closely related — differentiate by scope or method"

    def _generate_framing(self, title, abstract, comparators, llm):
        comp_str = "\n".join(
            f"- {c['title']} ({c.get('year','?')}) — similarity {c['similarity']:.2f}"
            for c in comparators[:4]
        )
        system = (
            "You are an expert academic positioning advisor. "
            "Given a paper and its closest comparators, generate a framing statement, "
            "a positioning paragraph, and venue recommendations."
        )
        user = (
            f"Paper title: '{title}'\n"
            f"Abstract: {abstract[:1500]}\n\n"
            f"Most similar existing work:\n{comp_str}\n\n"
            f"Respond in exactly this format:\n"
            f"FRAMING: [one sentence: what makes this paper distinct]\n"
            f"STATEMENT: [2-3 sentence related-work positioning paragraph]\n"
            f"VENUE1: [venue name] | [one-sentence rationale]\n"
            f"VENUE2: [venue name] | [one-sentence rationale]\n"
            f"VENUE3: [venue name] | [one-sentence rationale]\n"
        )
        try:
            raw = llm.generate_chat_response(system, user) or ""
            framing   = ""
            statement = ""
            venues    = []
            for line in raw.strip().split("\n"):
                if line.startswith("FRAMING:"):
                    framing = line[8:].strip()
                elif line.startswith("STATEMENT:"):
                    statement = line[10:].strip()
                elif line.startswith("VENUE"):
                    parts = line.split("|")
                    if len(parts) >= 2:
                        vname = re.sub(r'^VENUE\d+:\s*', '', parts[0]).strip()
                        venues.append({"venue": vname, "rationale": parts[1].strip()})
            return framing or title, statement or "Positioning analysis unavailable.", venues
        except Exception as exc:
            logger.warning(f"Framing generation failed: {exc}")
            return title, "Positioning analysis unavailable.", []
