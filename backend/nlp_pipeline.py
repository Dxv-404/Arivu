"""
nlp_pipeline.py — InheritanceDetector: NLP analysis orchestrator.

This module runs on the MAIN Koyeb server. It calls the NLP worker (HuggingFace
Spaces) over HTTP. It NEVER loads sentence-transformers or torch.

Responsibilities:
    Stage 1: Call /similarity_matrix on NLP worker → similarity score + best pair
    Stage 2: Call Groq LLM for mutation type classification (5 edges per call)
    Stage 3: Graph structural validation (adjust confidence by PageRank)
    Combined: compute_inheritance_confidence() — multi-signal weighted score

Results are persisted in the edge_analysis table for reuse across graphs.
If Groq API key is not set (config.GROQ_ENABLED = False), Stage 2 is skipped
and edges are auto-classified as "incidental" with LLM_classified=False.

NLI pipeline: deliberately deferred to a future phase. See module docstring
in §8 of PHASE_2.md for rationale.

Column naming note: the edge_analysis table (Phase 1 migration) uses the column
name "base_confidence" for the final multi-signal confidence score. The complete
spec diagram §5.11 uses "inheritance_confidence" in one place. The Phase 1 SQL
migration is authoritative — "base_confidence" is correct. See §20 for details.
"""
import asyncio
import json
import logging
import re
import time
from typing import Optional

import httpx
import networkx as nx

import backend.db as db
from backend.config import config
from backend.models import (
    CITATION_INTENTS, CONFIDENCE_TIERS, MUTATION_TYPES,
    EdgeAnalysis, Paper, get_confidence_tier,
)
from backend.normalizer import split_into_sentences
from backend.rate_limiter import coordinated_rate_limiter
from exceptions import NLPTimeoutError, NLPWorkerError

logger = logging.getLogger(__name__)

_GROQ_HEADERS = {"Content-Type": "application/json"}


class InheritanceDetector:
    """
    Three-stage NLP pipeline for citation edge analysis.

    Usage (inside AncestryGraph):
        detector = InheritanceDetector()
        edge_analyses = await detector.analyze_edges(edges, all_papers, graph)
        # edge_analyses: list[EdgeAnalysis] — one per (citing, cited) pair
    """

    def __init__(self):
        self._http: Optional[httpx.AsyncClient] = None

    async def _client(self) -> httpx.AsyncClient:
        if self._http is None or self._http.is_closed:
            self._http = httpx.AsyncClient(
                timeout=httpx.Timeout(config.NLP_WORKER_TIMEOUT, connect=5.0),
                headers={
                    "Authorization": f"Bearer {config.NLP_WORKER_SECRET}",
                    "User-Agent": "Arivu/1.0",
                },
            )
        return self._http

    # ─── Public API ──────────────────────────────────────────────────────────

    async def analyze_edges(
        self,
        edges: list[tuple[str, str]],
        all_papers: dict[str, Paper],
        graph: nx.DiGraph,
    ) -> list[EdgeAnalysis]:
        """
        Run all three stages on a list of (citing_id, cited_id) pairs.

        Stage 1 runs on all edges (NLP worker similarity).
        Stage 2 runs only on edges with similarity > threshold (LLM classification).
        Stage 3 runs on all edges (graph structural validation).

        Returns one EdgeAnalysis per edge. Low-similarity edges get
        mutation_type="incidental" with llm_classified=False.
        """
        results: list[EdgeAnalysis] = []

        # Check cache first — avoid re-analyzing edges we've seen before
        edges_to_analyze: list[tuple[str, str]] = []
        for citing_id, cited_id in edges:
            edge_id = f"{citing_id}:{cited_id}"
            cached = self._load_cached_analysis(edge_id)
            if cached:
                results.append(cached)
            else:
                edges_to_analyze.append((citing_id, cited_id))

        logger.info(
            f"Edge analysis: {len(results)} cached, {len(edges_to_analyze)} to analyze"
        )

        if not edges_to_analyze:
            return results

        # Stage 1: Similarity for all uncached edges
        stage1_results = await self._run_stage1_all(edges_to_analyze, all_papers)

        # Separate candidates (similarity > threshold) from low-similarity edges
        threshold = config.NLP_SIMILARITY_THRESHOLD
        candidates = [r for r in stage1_results if r["similarity_score"] >= threshold]
        low_sim = [r for r in stage1_results if r["similarity_score"] < threshold]

        # Stage 2: LLM classification for candidates only
        if candidates and config.GROQ_ENABLED:
            await self._run_stage2_llm(candidates)
        else:
            for r in candidates:
                r["mutation_type"] = "incidental"
                r["citation_intent"] = "incidental_mention"
                r["mutation_confidence"] = 0.5
                r["mutation_evidence"] = "Auto-classified (LLM unavailable)"
                r["llm_classified"] = False

        # Low-similarity edges → auto-classify as incidental
        for r in low_sim:
            r["mutation_type"] = "incidental"
            r["citation_intent"] = "incidental_mention"
            r["mutation_confidence"] = 0.3
            r["mutation_evidence"] = "Similarity below threshold — incidental citation"
            r["llm_classified"] = False

        # Stage 3: Graph structure validation for all
        # PageRank is computed ONCE here and passed into _run_stage3().
        all_stage_results = candidates + low_sim
        try:
            pagerank_scores = nx.pagerank(graph, alpha=0.85)
        except Exception as e:
            logger.warning(f"PageRank computation failed, using uniform scores: {e}")
            pagerank_scores = {}

        for r in all_stage_results:
            self._run_stage3(r, graph, pagerank_scores)

        # Build EdgeAnalysis objects and cache them
        for r in all_stage_results:
            ea = self._build_edge_analysis(r, all_papers)
            self._save_cached_analysis(ea)
            results.append(ea)

        return results

    # ─── Stage 1: Similarity ─────────────────────────────────────────────────

    async def _run_stage1_all(
        self, edges: list[tuple[str, str]], all_papers: dict[str, Paper]
    ) -> list[dict]:
        """Run Stage 1 on all edges concurrently (bounded concurrency)."""
        sem = asyncio.Semaphore(10)   # Max 10 concurrent NLP worker calls

        async def analyze_one(edge: tuple[str, str]) -> dict:
            async with sem:
                return await self._stage1_similarity(edge[0], edge[1], all_papers)

        return await asyncio.gather(*[analyze_one(e) for e in edges])

    async def _stage1_similarity(
        self, citing_id: str, cited_id: str, all_papers: dict[str, Paper]
    ) -> dict:
        """
        Call /similarity_matrix on the NLP worker.
        Returns a dict with edge_id, similarity_score, best sentence pair.
        """
        edge_id = f"{citing_id}:{cited_id}"
        citing = all_papers.get(citing_id)
        cited = all_papers.get(cited_id)

        base = {
            "edge_id": edge_id,
            "citing_paper_id": citing_id,
            "cited_paper_id": cited_id,
            "similarity_score": 0.0,
            "citing_sentence": None,
            "cited_sentence": None,
            "citing_text_source": "none",
            "cited_text_source": "none",
            "comparable": False,
            "signals_used": [],
        }

        if not citing or not cited:
            base["comparison_note"] = "Paper data missing"
            return base

        citing_text = citing.abstract or citing.title or ""
        cited_text = cited.abstract or cited.title or ""
        citing_src = "abstract" if citing.abstract else "title"
        cited_src = "abstract" if cited.abstract else "title"

        if not citing_text.strip() or not cited_text.strip():
            base["comparison_note"] = "No text available for one or both papers"
            return base

        citing_sents = split_into_sentences(citing_text, max_sentences=50)
        cited_sents = split_into_sentences(cited_text, max_sentences=50)

        if not citing_sents or not cited_sents:
            base["comparison_note"] = "Could not split text into sentences"
            return base

        try:
            client = await self._client()
            resp = await client.post(
                f"{config.NLP_WORKER_URL}/similarity_matrix",
                json={"texts_a": citing_sents, "texts_b": cited_sents},
            )
            resp.raise_for_status()
            data = resp.json()
        except httpx.TimeoutException:
            logger.warning(f"NLP worker timeout for edge {edge_id}")
            base["comparison_note"] = "NLP worker timeout"
            return base
        except Exception as e:
            logger.warning(f"NLP worker call failed for edge {edge_id}: {e}")
            base["comparison_note"] = f"NLP worker error: {str(e)[:100]}"
            return base

        max_pair = data.get("max_pair", {})
        score = float(max_pair.get("score", 0.0))

        base.update({
            "similarity_score": round(score, 4),
            "citing_sentence": max_pair.get("sentence_a"),
            "cited_sentence": max_pair.get("sentence_b"),
            "citing_text_source": citing_src,
            "cited_text_source": cited_src,
            "comparable": True,
            "signals_used": ["similarity"],
        })
        return base

    # ─── Stage 2: LLM Classification ─────────────────────────────────────────

    async def _run_stage2_llm(self, edges: list[dict]) -> None:
        """
        Classify edges in batches of NLP_BATCH_SIZE via Groq.
        Mutates each edge dict in-place with mutation_type, citation_intent, etc.
        """
        batch_size = config.NLP_BATCH_SIZE   # default 5
        for i in range(0, len(edges), batch_size):
            batch = edges[i:i + batch_size]
            await self._classify_batch(batch)

    async def _classify_batch(self, batch: list[dict]) -> None:
        """Send one LLM request for a batch of edges. Mutates each dict in-place."""
        edges_data = []
        for edge in batch:
            edges_data.append({
                "edge_id": edge["edge_id"],
                "citing_sentence": edge.get("citing_sentence") or "(no text)",
                "cited_sentence":  edge.get("cited_sentence")  or "(no text)",
            })

        mutation_opts = ", ".join(f'"{m}"' for m in MUTATION_TYPES)
        intent_opts = ", ".join(f'"{c}"' for c in CITATION_INTENTS)

        prompt = f"""Classify each academic citation relationship based on the sentence pair.

Edges:
{json.dumps(edges_data, indent=2)}

For each edge_id, return:
  mutation_type: one of {mutation_opts}
  citation_intent: one of {intent_opts}
  confidence: "high" | "medium" | "low"
  evidence: one concise sentence explaining your classification

Return ONLY valid JSON — no markdown, no preamble:
{{
  "classifications": [
    {{"edge_id": "...", "mutation_type": "...", "citation_intent": "...", "confidence": "...", "evidence": "..."}}
  ]
}}"""

        await coordinated_rate_limiter.throttle("groq")
        try:
            client = await self._client()
            resp = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {config.GROQ_API_KEY}"},
                json={
                    "model": config.GROQ_FAST_MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 800,
                    "temperature": 0.1,
                },
            )
            if resp.status_code == 429:
                await coordinated_rate_limiter.record_rate_limit("groq", 60)
                self._apply_fallback_classification(batch)
                return
            resp.raise_for_status()
            raw = resp.json()["choices"][0]["message"]["content"]
        except Exception as e:
            logger.warning(f"Groq classification failed: {e}")
            self._apply_fallback_classification(batch)
            return

        try:
            # Strip markdown fences if present
            cleaned = re.sub(r"```(?:json)?", "", raw).strip()
            parsed = json.loads(cleaned)
            classes = {c["edge_id"]: c for c in parsed.get("classifications", [])}
        except Exception as e:
            logger.warning(f"Groq JSON parse failed: {e}")
            self._apply_fallback_classification(batch)
            return

        conf_map = {"high": 0.9, "medium": 0.7, "low": 0.5}
        for edge in batch:
            cls = classes.get(edge["edge_id"])
            if cls:
                mt = cls.get("mutation_type", "incidental")
                ci = cls.get("citation_intent", "incidental_mention")
                # Validate against known values
                if mt not in MUTATION_TYPES:
                    mt = "incidental"
                if ci not in CITATION_INTENTS:
                    ci = "incidental_mention"
                edge["mutation_type"] = mt
                edge["citation_intent"] = ci
                edge["mutation_confidence"] = conf_map.get(cls.get("confidence", "medium"), 0.7)
                edge["mutation_evidence"] = cls.get("evidence", "")[:500]
                edge["llm_classified"] = True
                if "similarity" in edge.get("signals_used", []):
                    edge["signals_used"].append("llm")
            else:
                self._apply_fallback_single(edge)

    @staticmethod
    def _apply_fallback_classification(batch: list[dict]) -> None:
        for edge in batch:
            InheritanceDetector._apply_fallback_single(edge)

    @staticmethod
    def _apply_fallback_single(edge: dict) -> None:
        """Classify a single edge as incidental when LLM is unavailable."""
        sim = edge.get("similarity_score", 0)
        if sim >= 0.65:
            mt = "adoption"
        elif sim >= 0.45:
            mt = "generalization"
        else:
            mt = "incidental"
        edge["mutation_type"] = mt
        edge["citation_intent"] = "methodological_adoption" if mt != "incidental" else "incidental_mention"
        edge["mutation_confidence"] = sim * 0.8
        edge["mutation_evidence"] = f"Auto-classified from similarity score {sim:.2f}"
        edge["llm_classified"] = False

    # ─── Stage 3: Structural Validation ──────────────────────────────────────

    @staticmethod
    def _run_stage3(edge: dict, graph: nx.DiGraph, pagerank_scores: dict) -> None:
        """
        Adjust confidence based on PageRank (structural importance).
        Mutates edge dict in-place — adds structural_importance_modifier and base_confidence.

        PageRank is now passed in as a pre-computed dict rather than
        being recomputed here. The caller (analyze_edges) computes PageRank
        once and passes pagerank_scores.
        """
        cited_id = edge.get("cited_paper_id")
        sim = edge.get("similarity_score", 0)

        try:
            struct = min(1.0, (pagerank_scores.get(cited_id, 0.01) * len(graph.nodes)) / 5)
        except Exception:
            struct = 0.5

        # Multi-signal confidence
        signals = edge.get("signals_used", [])
        weights = {"similarity": 0.50, "llm": 0.40, "structural": 0.10}

        score = 0.0
        total_w = 0.0
        if "similarity" in signals:
            score += sim * weights["similarity"]
            total_w += weights["similarity"]
        if "llm" in signals:
            mc = edge.get("mutation_confidence", 0.5)
            score += mc * weights["llm"]
            total_w += weights["llm"]
        # structural always contributes
        score += struct * weights["structural"]
        total_w += weights["structural"]

        if total_w > 0:
            score = score / total_w

        # Degradation factor: fewer signals → lower max confidence
        n = len(signals)
        degradation = {0: 0.5, 1: 0.65, 2: 0.85, 3: 1.0}.get(n, 1.0)

        edge["structural_importance_modifier"] = round(struct, 4)
        edge["base_confidence"] = round(score * degradation, 4)
        if "structural" not in signals:
            edge.get("signals_used", []).append("structural")

    # ─── EdgeAnalysis construction ────────────────────────────────────────────

    @staticmethod
    def _build_edge_analysis(edge: dict, all_papers: dict[str, Paper]) -> EdgeAnalysis:
        conf = edge.get("base_confidence", 0.0)
        return EdgeAnalysis(
            edge_id=edge["edge_id"],
            citing_paper_id=edge["citing_paper_id"],
            cited_paper_id=edge["cited_paper_id"],
            similarity_score=edge.get("similarity_score", 0.0),
            citing_sentence=edge.get("citing_sentence"),
            cited_sentence=edge.get("cited_sentence"),
            citing_text_source=edge.get("citing_text_source", "none"),
            cited_text_source=edge.get("cited_text_source", "none"),
            comparable=edge.get("comparable", False),
            mutation_type=edge.get("mutation_type", "incidental"),
            mutation_confidence=edge.get("mutation_confidence", 0.0),
            mutation_evidence=edge.get("mutation_evidence", ""),
            citation_intent=edge.get("citation_intent", "incidental_mention"),
            base_confidence=conf,
            signals_used=edge.get("signals_used", []),
            llm_classified=edge.get("llm_classified", False),
            flagged_by_users=0,
            model_version="1.0.0",
        )

    # ─── DB caching ──────────────────────────────────────────────────────────

    @staticmethod
    def _load_cached_analysis(edge_id: str) -> Optional[EdgeAnalysis]:
        """Load from edge_analysis table if present and model version matches."""
        try:
            row = db.fetchone(
                "SELECT * FROM edge_analysis WHERE edge_id = %s AND model_version = %s",
                (edge_id, "1.0.0"),
            )
            if not row:
                return None
            return EdgeAnalysis(
                edge_id=row["edge_id"],
                citing_paper_id=row["citing_paper_id"],
                cited_paper_id=row["cited_paper_id"],
                similarity_score=float(row.get("similarity_score", 0)),
                citing_sentence=row.get("citing_sentence"),
                cited_sentence=row.get("cited_sentence"),
                citing_text_source=row.get("citing_text_source", "none"),
                cited_text_source=row.get("cited_text_source", "none"),
                comparable=bool(row.get("comparable", False)),
                mutation_type=row.get("mutation_type", "incidental"),
                mutation_confidence=float(row.get("mutation_confidence", 0)),
                mutation_evidence=row.get("mutation_evidence", ""),
                citation_intent=row.get("citation_intent", "incidental_mention"),
                base_confidence=float(row.get("base_confidence", 0)),
                signals_used=row.get("signals_used") or [],
                llm_classified=bool(row.get("llm_classified", False)),
                flagged_by_users=int(row.get("flagged_by_users", 0)),
                model_version=row.get("model_version", "1.0.0"),
            )
        except Exception as e:
            logger.debug(f"Cache load failed for edge {edge_id}: {e}")
            return None

    @staticmethod
    def _save_cached_analysis(ea: EdgeAnalysis) -> None:
        """Upsert an EdgeAnalysis into the edge_analysis table."""
        import json as _json
        try:
            db.execute(
                """
                INSERT INTO edge_analysis (
                    edge_id, citing_paper_id, cited_paper_id,
                    similarity_score, citing_sentence, cited_sentence,
                    citing_text_source, cited_text_source, comparable,
                    mutation_type, mutation_confidence, mutation_evidence,
                    citation_intent, base_confidence, signals_used,
                    llm_classified, flagged_by_users, model_version,
                    computed_at
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, NOW()
                )
                ON CONFLICT (edge_id) DO UPDATE SET
                    similarity_score   = EXCLUDED.similarity_score,
                    mutation_type      = EXCLUDED.mutation_type,
                    mutation_confidence = EXCLUDED.mutation_confidence,
                    base_confidence    = EXCLUDED.base_confidence,
                    llm_classified     = EXCLUDED.llm_classified,
                    model_version      = EXCLUDED.model_version,
                    computed_at        = NOW()
                """,
                (
                    ea.edge_id, ea.citing_paper_id, ea.cited_paper_id,
                    ea.similarity_score, ea.citing_sentence, ea.cited_sentence,
                    ea.citing_text_source, ea.cited_text_source, ea.comparable,
                    ea.mutation_type, ea.mutation_confidence, ea.mutation_evidence,
                    ea.citation_intent, ea.base_confidence,
                    _json.dumps(ea.signals_used),
                    ea.llm_classified, ea.flagged_by_users, ea.model_version,
                ),
            )
        except Exception as e:
            logger.debug(f"Cache save failed for edge {ea.edge_id}: {e}")
