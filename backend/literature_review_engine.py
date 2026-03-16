"""
backend/literature_review_engine.py — LiteratureReviewEngine (F4.5)

Multi-seed graph analysis. Uses the current session's graph as the primary corpus,
supplemented by DB lookups for deeper ancestry.
"""
import json
import logging
from collections import defaultdict
from dataclasses import dataclass
from typing import Optional

import backend.db as db
from backend.config import Config
from backend.llm_client import get_llm_client

logger = logging.getLogger(__name__)

MAX_SEED_PAPERS   = 5
MAX_THREAD_PAPERS = 8
MAX_REVIEW_PAPERS = 30


@dataclass
class ConceptThread:
    label:       str
    description: str
    papers:      list

    def to_dict(self) -> dict:
        return {"label": self.label, "description": self.description, "papers": self.papers}


@dataclass
class LiteratureReviewResult:
    research_question: str
    seed_papers:       list
    threads:           list
    minimum_reading:   list
    gaps:              list
    docx_r2_key:       Optional[str]

    def to_dict(self) -> dict:
        return {
            "research_question": self.research_question,
            "seed_papers":       self.seed_papers,
            "threads":           [t.to_dict() for t in self.threads],
            "minimum_reading":   self.minimum_reading,
            "gaps":              self.gaps,
            "docx_r2_key":       self.docx_r2_key,
        }


class LiteratureReviewEngine:

    def generate(
        self,
        research_question: str,
        user_id: str,
        graph_json: Optional[dict] = None,
        seed_paper_ids: Optional[list] = None,
    ) -> LiteratureReviewResult:
        llm = get_llm_client()

        question_embedding = self._embed_question(research_question)

        if graph_json:
            seed_papers = self._find_seeds_in_graph(question_embedding, research_question, graph_json)
        else:
            seed_papers = self._find_seed_papers(question_embedding, research_question)

        if not seed_papers:
            return LiteratureReviewResult(
                research_question=research_question,
                seed_papers=[], threads=[], minimum_reading=[], gaps=[],
                docx_r2_key=None,
            )

        all_papers = self._collect_ancestry_two_hop(seed_papers, graph_json)
        minimum_reading = self._find_minimum_reading(all_papers, seed_papers)
        threads = self._build_threads(all_papers, research_question, llm)
        gaps = self._identify_gaps(all_papers, research_question, llm)

        result = LiteratureReviewResult(
            research_question=research_question,
            seed_papers=[{"paper_id": p["paper_id"], "title": p.get("title", ""), "year": p.get("year")}
                         for p in seed_papers],
            threads=threads, minimum_reading=minimum_reading, gaps=gaps,
            docx_r2_key=None,
        )

        try:
            result.docx_r2_key = self._generate_docx(result, user_id)
        except Exception as exc:
            logger.warning(f"LiteratureReview docx generation failed: {exc}")

        return result

    def _embed_question(self, question: str) -> Optional[list]:
        try:
            import httpx
            resp = httpx.post(
                f"{Config.NLP_WORKER_URL}/encode_batch",
                json={"texts": [question[:2000]], "model": "abstract"},
                headers={"Authorization": f"Bearer {Config.NLP_WORKER_SECRET}"},
                timeout=15.0,
            )
            return resp.json()["embeddings"][0]
        except Exception as exc:
            logger.warning(f"Question embedding failed: {exc}")
            return None

    def _find_seeds_in_graph(self, embedding, question, graph_json) -> list:
        nodes = graph_json.get("nodes", [])
        if not nodes:
            return self._find_seed_papers(embedding, question)

        if embedding:
            node_ids = [n["id"] for n in nodes if n.get("id")]
            try:
                emb_str = "[" + ",".join(str(x) for x in embedding) + "]"
                rows = db.fetchall(
                    """
                    SELECT p.paper_id, p.title, p.year, p.citation_count, p.abstract,
                           p.fields_of_study,
                           1 - (pe.embedding <=> %s::vector) AS similarity
                    FROM paper_embeddings pe
                    JOIN papers p ON p.paper_id = pe.paper_id
                    WHERE pe.paper_id = ANY(%s) AND p.abstract IS NOT NULL
                    ORDER BY pe.embedding <=> %s::vector
                    LIMIT %s
                    """,
                    (emb_str, node_ids, emb_str, MAX_SEED_PAPERS),
                )
                if rows:
                    return [dict(r) for r in rows]
            except Exception as exc:
                logger.warning(f"Graph-scoped seed search failed: {exc}")

        sorted_nodes = sorted(
            [n for n in nodes if n.get("abstract") or n.get("abstract_preview")],
            key=lambda n: n.get("citation_count") or 0,
            reverse=True,
        )
        return [
            {
                "paper_id":       n["id"],
                "title":          n.get("title", ""),
                "year":           n.get("year"),
                "citation_count": n.get("citation_count", 0),
                "abstract":       n.get("abstract", "") or n.get("abstract_preview", ""),
                "fields_of_study": n.get("fields_of_study", []),
            }
            for n in sorted_nodes[:MAX_SEED_PAPERS]
        ]

    def _find_seed_papers(self, embedding, question) -> list:
        if embedding:
            emb_str = "[" + ",".join(str(x) for x in embedding) + "]"
            try:
                rows = db.fetchall(
                    """
                    SELECT p.paper_id, p.title, p.year, p.citation_count, p.abstract,
                           p.fields_of_study,
                           1 - (pe.embedding <=> %s::vector) AS similarity
                    FROM paper_embeddings pe
                    JOIN papers p ON p.paper_id = pe.paper_id
                    WHERE p.abstract IS NOT NULL
                    ORDER BY pe.embedding <=> %s::vector
                    LIMIT %s
                    """,
                    (emb_str, emb_str, MAX_SEED_PAPERS),
                )
                return [dict(r) for r in rows]
            except Exception as exc:
                logger.warning(f"Seed paper search failed: {exc}")
        words = question.split()[:5]
        rows  = db.fetchall(
            "SELECT paper_id, title, year, citation_count, abstract, fields_of_study "
            "FROM papers WHERE title ILIKE ANY(%s) ORDER BY citation_count DESC LIMIT %s",
            ([f"%{w}%" for w in words], MAX_SEED_PAPERS),
        )
        return [dict(r) for r in rows]

    def _collect_ancestry_two_hop(self, seed_papers: list, graph_json: Optional[dict]) -> list:
        paper_ids  = [p["paper_id"] for p in seed_papers]
        seen_ids   = set(paper_ids)
        all_papers = list(seed_papers)

        hop1 = db.fetchall(
            """
            SELECT DISTINCT p.paper_id, p.title, p.year, p.citation_count,
                   p.abstract, p.fields_of_study
            FROM edge_analysis ea
            JOIN papers p ON p.paper_id = ea.cited_paper_id
            WHERE ea.citing_paper_id = ANY(%s) AND p.year IS NOT NULL
            ORDER BY p.citation_count DESC
            LIMIT %s
            """,
            (paper_ids, 20),
        )
        hop1_ids = []
        for r in hop1:
            if r["paper_id"] not in seen_ids:
                seen_ids.add(r["paper_id"])
                all_papers.append(dict(r))
                hop1_ids.append(r["paper_id"])

        if hop1_ids:
            hop2 = db.fetchall(
                """
                SELECT DISTINCT p.paper_id, p.title, p.year, p.citation_count,
                       p.abstract, p.fields_of_study
                FROM edge_analysis ea
                JOIN papers p ON p.paper_id = ea.cited_paper_id
                WHERE ea.citing_paper_id = ANY(%s) AND p.year IS NOT NULL
                ORDER BY p.citation_count DESC
                LIMIT %s
                """,
                (hop1_ids, 20),
            )
            for r in hop2:
                if r["paper_id"] not in seen_ids:
                    seen_ids.add(r["paper_id"])
                    all_papers.append(dict(r))

        return all_papers[:MAX_REVIEW_PAPERS]

    def _find_minimum_reading(self, all_papers: list, seed_papers: list) -> list:
        sorted_papers = sorted(all_papers, key=lambda p: p.get("citation_count") or 0, reverse=True)
        return [
            {
                "paper_id":     p["paper_id"],
                "title":        p.get("title", ""),
                "year":         p.get("year"),
                "why_essential": f"Cited {p.get('citation_count', 0):,} times — foundational to this area.",
            }
            for p in sorted_papers[:10]
        ]

    def _build_threads(self, papers: list, question: str, llm) -> list:
        paper_list = "\n".join(
            f"- '{p.get('title', '?')}' ({p.get('year', '?')}) — {(p.get('abstract') or '')[:150]}"
            for p in papers[:15]
        )
        prompt = (
            f"Research question: '{question}'\n\n"
            f"Papers in the intellectual ancestry:\n{paper_list}\n\n"
            f"Organize these papers into 3-5 conceptual threads.\n"
            f"For each thread:\nTHREAD: [2-4 word name]\n"
            f"DESCRIPTION: [One sentence]\nPAPERS: [comma-separated titles]\n---\n"
        )
        try:
            raw = llm.generate_chat_response(
                system_prompt="You are a research analyst organizing papers into conceptual threads.",
                user_prompt=prompt,
            )
            if not raw:
                raise ValueError("Empty LLM response")
            threads = self._parse_threads(raw, papers)
            return threads
        except Exception as exc:
            logger.warning(f"Thread building failed: {exc}")
            by_field: dict = defaultdict(list)
            for p in papers:
                field = (p.get("fields_of_study") or ["General"])[0]
                by_field[field].append(p)
            return [
                ConceptThread(
                    label=field,
                    description=f"Papers from {field} contributing to this research question.",
                    papers=[{"paper_id": p["paper_id"], "title": p.get("title", ""),
                             "year": p.get("year"), "role": "contributor"}
                            for p in sorted(plist, key=lambda x: x.get("year") or 0)]
                )
                for field, plist in list(by_field.items())[:4]
            ]

    def _parse_threads(self, raw: str, papers: list) -> list:
        import re
        blocks    = raw.split("---")
        threads   = []
        paper_map = {p.get("title", "").lower(): p for p in papers}
        for block in blocks:
            if not block.strip():
                continue
            label_m = re.search(r"THREAD:\s*(.+)",      block, re.IGNORECASE)
            desc_m  = re.search(r"DESCRIPTION:\s*(.+)", block, re.IGNORECASE)
            pap_m   = re.search(r"PAPERS:\s*(.+)",      block, re.IGNORECASE)
            if not label_m:
                continue
            paper_titles = [t.strip().strip("'\"") for t in (pap_m.group(1) if pap_m else "").split(",")]
            thread_papers = []
            for title in paper_titles:
                for ptitle, p in paper_map.items():
                    if title.lower() in ptitle or ptitle in title.lower():
                        thread_papers.append({
                            "paper_id": p["paper_id"], "title": p.get("title", ""),
                            "year": p.get("year"), "role": "contributor",
                        })
                        break
            threads.append(ConceptThread(
                label=label_m.group(1).strip(),
                description=desc_m.group(1).strip() if desc_m else "",
                papers=sorted(thread_papers, key=lambda x: x.get("year") or 0),
            ))
        return threads[:5]

    def _identify_gaps(self, papers: list, question: str, llm) -> list:
        paper_list = "\n".join(f"- '{p.get('title', '?')}' ({p.get('year', '?')})" for p in papers[:12])
        prompt = (
            f"Research question: '{question}'\nExisting papers:\n{paper_list}\n\n"
            f"Identify 3 research gaps. One sentence per gap.\nGAP1: ...\nGAP2: ...\nGAP3: ...\n"
        )
        try:
            import re
            raw = llm.generate_chat_response(
                system_prompt="You are a research gap analyst. Be specific and actionable.",
                user_prompt=prompt,
            )
            if not raw:
                return []
            gaps = []
            for i in range(1, 4):
                m = re.search(rf"GAP{i}:\s*(.+)", raw, re.IGNORECASE)
                if m:
                    gaps.append(m.group(1).strip())
            return gaps
        except Exception:
            return []

    def _generate_docx(self, result: LiteratureReviewResult, user_id: str) -> str:
        from backend.export_generator import ExportGenerator
        from backend.r2_client import R2Client
        import uuid
        sections = [
            {"heading": "Research Question", "body": result.research_question},
            {"heading": "Seed Papers", "body": "\n\n".join(
                f"- {p['title']} ({p.get('year', 'n.d.')})" for p in result.seed_papers
            )},
        ]
        for t in result.threads:
            thread_dict = t.to_dict()
            body_parts = [thread_dict["description"]]
            for p in thread_dict.get("papers", []):
                body_parts.append(f"- {p.get('title', '')} ({p.get('year', 'n.d.')})")
            sections.append({"heading": thread_dict["label"], "body": "\n\n".join(body_parts)})
        if result.minimum_reading:
            sections.append({"heading": "Minimum Reading Set", "body": "\n\n".join(
                f"- {p['title']} — {p.get('why_essential', '')}" for p in result.minimum_reading
            )})
        if result.gaps:
            sections.append({"heading": "Research Gaps", "body": "\n\n".join(
                f"{i+1}. {g}" for i, g in enumerate(result.gaps)
            )})
        generator  = ExportGenerator()
        docx_bytes = generator.generate_docx(sections, title=f"Literature Review: {result.research_question[:80]}")
        r2_key     = f"exports/{user_id}/litrev-{uuid.uuid4().hex[:8]}.docx"
        R2Client().upload_bytes(r2_key, docx_bytes,
                                content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        return r2_key
