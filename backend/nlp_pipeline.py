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

# Titles used by stub papers from resolve_batch() — skip NLP analysis for these
_STUB_TITLES = frozenset({"(Metadata pending)", "Unknown", ""})


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
        progress_callback=None,
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

        # Check cache first — batch lookup instead of N individual queries.
        # For 200+ edges, this reduces DB round trips from 200+ to 1.
        all_edge_ids = [f"{c}:{d}" for c, d in edges]
        cached_map: dict[str, EdgeAnalysis] = {}
        try:
            cached_rows = db.fetchall(
                """
                SELECT * FROM edge_analysis
                WHERE edge_id = ANY(%s) AND model_version = %s
                """,
                (all_edge_ids, "1.0.0"),
            )
            for row in cached_rows:
                try:
                    ea = EdgeAnalysis(
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
                    cached_map[ea.edge_id] = ea
                except Exception as e:
                    logger.debug(f"Could not reconstruct cached edge: {e}")
        except Exception as e:
            logger.debug(f"Batch edge cache lookup failed, falling back to individual: {e}")
            # Fallback to individual lookups
            for edge_id in all_edge_ids:
                cached = self._load_cached_analysis(edge_id)
                if cached:
                    cached_map[edge_id] = cached

        edges_to_analyze: list[tuple[str, str]] = []
        for citing_id, cited_id in edges:
            edge_id = f"{citing_id}:{cited_id}"
            if edge_id in cached_map:
                results.append(cached_map[edge_id])
            else:
                edges_to_analyze.append((citing_id, cited_id))

        logger.info(
            f"Edge analysis: {len(results)} cached, {len(edges_to_analyze)} to analyze"
        )

        if not edges_to_analyze:
            return results

        # Stage 1: Similarity for all uncached edges
        if progress_callback:
            await progress_callback(
                "analyzing",
                f"Stage 1: Computing similarity for {len(edges_to_analyze)} edges…"
            )
        stage1_results = await self._run_stage1_all(edges_to_analyze, all_papers)

        # Separate candidates (similarity > threshold) from low-similarity edges
        threshold = config.NLP_SIMILARITY_THRESHOLD
        candidates = [r for r in stage1_results if r["similarity_score"] >= threshold]
        low_sim = [r for r in stage1_results if r["similarity_score"] < threshold]

        # Stage 2: LLM classification for candidates only
        if candidates and config.GROQ_ENABLED:
            if progress_callback:
                await progress_callback(
                    "analyzing",
                    f"Stage 2: Classifying {len(candidates)} edges via LLM…"
                )
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

        # Stage 3: Graph structure validation
        if progress_callback:
            await progress_callback(
                "computing",
                f"Stage 3: Validating {len(candidates) + len(low_sim)} edges against graph structure…"
            )
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

        # Skip stub papers from resolve_batch() that have placeholder titles.
        # NLP similarity against "(Metadata pending)" would produce garbage
        # scores that get cached permanently in edge_analysis.
        if citing.title in _STUB_TITLES or cited.title in _STUB_TITLES:
            base["comparison_note"] = "Stub paper — skipping NLP analysis"
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

    # ─── Phase 3: Full-text enrichment ─────────────────────────────────────

    async def _enrich_with_full_text_signals(
        self,
        edge: dict,
        citing_full_text,   # PaperFullText | None
        cited_paper,        # Paper
    ) -> dict:
        """
        When citing_paper has full text (Tier 1), compute:
        - citation_position: where in the paper is the cited paper mentioned
        - linguistic_markers: dict from LinguisticMarkerDetector.detect_markers()
        These become Signal 2 and Signal 3 in compute_inheritance_confidence().
        """
        if not citing_full_text or citing_full_text.text_tier != 1:
            return edge

        detector = linguistic_marker_detector

        # Citation position
        position = detector.get_citation_position(citing_full_text, cited_paper)
        edge["citation_position"] = position

        # Linguistic markers — search in intro + methods sections
        search_text = " ".join(filter(None, [
            citing_full_text.introduction,
            citing_full_text.methods,
        ]))
        if search_text:
            markers = detector.detect_markers(search_text, cited_paper)
            edge["linguistic_markers"] = markers

        return edge

    def compute_inheritance_confidence(
        self,
        citing_paper,         # Paper
        cited_paper,          # Paper
        stage1_result: dict,
        stage2_result: dict,
        stage3_result: dict,
        citing_full_text=None,  # PaperFullText | None
    ) -> float:
        """
        Combine all signals into final inheritance confidence score.
        Weights adapt based on available signals — fewer signals = lower max confidence.
        Phase 3 upgrade: position and linguistic marker signals when full text available.
        """
        signals = {}
        weights = {}

        # Signal 1: Semantic similarity (always available)
        similarity = stage1_result.get("similarity_score", 0)
        signals["similarity"] = similarity
        weights["similarity"] = 0.30

        # Signal 2: Citation position in full text (Tier 1 only)
        if citing_full_text and citing_full_text.text_tier == 1:
            position = stage2_result.get("citation_position", "unknown")
            position_scores = {
                "methods": 1.0,
                "introduction": 0.65,
                "results": 0.5,
                "related_work_only": 0.2,
                "conclusion": 0.3,
                "unknown": 0.4,
            }
            signals["position"] = position_scores.get(position, 0.4)
            weights["position"] = 0.25

        # Signal 3: Linguistic inheritance markers (Tier 1 only)
        if citing_full_text and citing_full_text.text_tier == 1:
            markers = stage2_result.get("linguistic_markers")
            if markers:
                signals["linguistic"] = markers.get("inheritance_score", 0)
                weights["linguistic"] = 0.25

        # Signal 4: LLM classification confidence
        if stage2_result.get("llm_classified"):
            llm_conf = stage2_result.get("mutation_confidence", 0.5)
            signals["llm"] = llm_conf
            weights["llm"] = 0.15

        # Signal 5: Structural importance
        struct_importance = stage3_result.get("structural_importance_modifier", 0.5)
        signals["structural"] = struct_importance
        weights["structural"] = 0.05

        # Normalize weights to sum to 1.0
        total_weight = sum(weights.values())
        normalized_weights = {k: v / total_weight for k, v in weights.items()}

        # Weighted combination
        confidence = sum(signals[k] * normalized_weights[k] for k in signals)

        # Confidence degrades when fewer signals available
        signal_modifiers = {5: 1.0, 4: 0.90, 3: 0.80, 2: 0.70, 1: 0.55}
        modifier = signal_modifiers.get(len(signals), 0.55)

        return confidence * modifier


# ─── LINGUISTIC INHERITANCE MARKER DETECTION ─────────────────────────────────
# Only usable for Tier 1 papers with full text available.

class LinguisticMarkerDetector:
    """
    Detects explicit inheritance language in full text.
    When full text is available (Tier 1), linguistic markers are the
    highest-confidence signal for inheritance classification.
    """

    STRONG_INHERITANCE = [
        r"we (extend|build on|build upon|follow|adopt|use|employ|apply)",
        r"following \w+",
        r"building on \w+",
        r"based on (the (work|approach|method|framework) of)",
        r"inspired by \w+",
        r"similar to \w+.{0,20}we",
        r"as (proposed|introduced|described) by \w+",
        r"the (method|approach|technique|framework) (of|from|by) \w+",
    ]

    CONTRADICTION_MARKERS = [
        r"unlike \w+",
        r"in contrast to \w+",
        r"\w+ fail(s|ed) to",
        r"contrary to \w+",
        r"\w+ (overlook|ignore|neglect)(s|ed)",
        r"the limitation(s?) of \w+",
        r"we show that \w+",
        r"we argue that \w+.{0,50}incorrect",
    ]

    INCIDENTAL_MARKERS = [
        r"(related|similar) work include(s?)",
        r"(see also|see e\.g\.|see for example)",
        r"among others",
        r"and (many )?others",
    ]

    def __init__(self):
        self._strong = [re.compile(p, re.IGNORECASE) for p in self.STRONG_INHERITANCE]
        self._contra = [re.compile(p, re.IGNORECASE) for p in self.CONTRADICTION_MARKERS]
        self._incident = [re.compile(p, re.IGNORECASE) for p in self.INCIDENTAL_MARKERS]

    def detect_markers(self, text: str, cited_paper) -> dict:
        """
        Find citation markers in text and link them to the cited paper.
        cited_paper: backend.models.Paper instance.
        """
        author_names = self._get_searchable_names(cited_paper)

        results = {
            "strong_inheritance": [],
            "contradiction": [],
            "incidental": [],
            "author_mentions": [],
            "inheritance_score": 0.0,
        }

        for author_name in author_names:
            name_pattern = re.compile(rf"\b{re.escape(author_name)}\b", re.IGNORECASE)
            for match in name_pattern.finditer(text):
                ctx_start = max(0, match.start() - 150)
                ctx_end = min(len(text), match.end() + 150)
                context = text[ctx_start:ctx_end]
                results["author_mentions"].append({
                    "position": match.start(),
                    "context": context,
                    "author": author_name,
                })

                for pattern in self._strong:
                    if pattern.search(context):
                        results["strong_inheritance"].append(context)
                        break
                for pattern in self._contra:
                    if pattern.search(context):
                        results["contradiction"].append(context)
                        break
                for pattern in self._incident:
                    if pattern.search(context):
                        results["incidental"].append(context)
                        break

        n_strong = len(results["strong_inheritance"])
        n_contra = len(results["contradiction"])
        n_incidental = len(results["incidental"])
        n_total = n_strong + n_contra + n_incidental

        if n_total == 0:
            results["inheritance_score"] = 0.3      # Mentioned but no clear marker
        elif n_strong > 0 and n_contra == 0:
            results["inheritance_score"] = 0.8 + min(0.15, n_strong * 0.05)
        elif n_contra > 0 and n_strong == 0:
            results["inheritance_score"] = 0.1      # Contradiction, not inheritance
        elif n_incidental > 0 and n_strong == 0:
            results["inheritance_score"] = 0.2      # Incidental only
        else:
            results["inheritance_score"] = 0.5      # Mixed signals

        return results

    def get_citation_position(self, full_text, cited_paper) -> str:
        """
        Where in the paper is the cited paper mentioned?
        full_text: PaperFullText instance.
        Returns the most significant position found.
        Priority: methods > results > introduction > conclusion > related_work.
        """
        author_names = self._get_searchable_names(cited_paper)

        sections = {
            "methods": full_text.methods,
            "results": full_text.results,
            "introduction": full_text.introduction,
            "conclusion": full_text.conclusion,
            "related_work": full_text.related_work,
        }

        positions_found = set()
        for section_name, section_text in sections.items():
            if not section_text:
                continue
            for name in author_names:
                if re.search(rf"\b{re.escape(name)}\b", section_text, re.IGNORECASE):
                    positions_found.add(section_name)

        PRIORITY = ["methods", "results", "introduction", "conclusion", "related_work"]
        for pos in PRIORITY:
            if pos in positions_found:
                return pos

        return "related_work_only" if positions_found else "unknown"

    def _get_searchable_names(self, paper) -> list:
        """Extract searchable last names from paper authors."""
        names = []
        for author in (getattr(paper, "authors", []) or []):
            if "," in author:
                lastname = author.split(",")[0].strip()
            else:
                parts = author.strip().split()
                lastname = parts[-1] if parts else author
            lastname = re.sub(r"[^\w\s]", "", lastname).strip()
            if len(lastname) > 2:
                names.append(lastname)
        return names


# Singleton for use by graph_engine
linguistic_marker_detector = LinguisticMarkerDetector()


# ─── CITATION INTENT CLASSIFICATION (F1.11 — Phase 8) ────────────────────────

CITATION_INTENT_CATEGORIES = (
    "methodological_adoption",   # Paper adopts this paper's method
    "theoretical_foundation",    # Paper uses as theoretical basis
    "empirical_baseline",        # Paper uses as comparison baseline
    "conceptual_inspiration",    # Paper inspired by but diverges
    "direct_contradiction",      # Paper explicitly challenges
    "incidental_mention",        # Passing reference, not central
    "negative_citation",         # Cited as example of what NOT to do
    "revival",                   # Resurrects forgotten work
)

INTENT_LINGUISTIC_MARKERS = {
    "direct_contradiction": [
        "contrary to", "in contrast to", "unlike", "challenge", "refute",
        "disprove", "however", "argue against", "fail to",
    ],
    "methodological_adoption": [
        "following", "adopt", "implement", "we use", "as in", "similar to",
        "based on", "building on", "extending",
    ],
    "empirical_baseline": [
        "baseline", "benchmark", "compare", "outperform", "compared to",
        "relative to", "versus",
    ],
    "incidental_mention": [
        "e.g.", "for example", "such as", "among others", "see also",
    ],
    "revival": [
        "revisit", "rediscover", "renewed interest", "overlooked", "forgotten",
        "original work by",
    ],
}


class CitationIntentClassifier:
    """
    Classifies WHY a paper cites another paper.
    Called from InheritanceDetector for each edge.
    Results stored in edge_analysis.citation_intent.

    Strategy:
      1. Try linguistic marker detection on citing_sentence (fast, no LLM)
      2. Fall back to mutation_type mapping
      3. LLM classification as last resort
    """

    def classify(
        self,
        citing_sentence: str,
        citing_abstract: str,
        cited_title: str,
        mutation_type: str,
    ) -> str:
        """Return one of CITATION_INTENT_CATEGORIES."""
        # Fast path: linguistic markers
        intent = self._detect_markers(citing_sentence or "")
        if intent:
            return intent

        # Map from already-classified mutation_type to a likely intent
        intent = self._from_mutation_type(mutation_type)
        if intent:
            return intent

        # LLM fallback
        return self._llm_classify(citing_sentence, citing_abstract, cited_title)

    def _detect_markers(self, sentence: str) -> str:
        lower = sentence.lower()
        for intent, markers in INTENT_LINGUISTIC_MARKERS.items():
            if any(m in lower for m in markers):
                return intent
        return ""

    def _from_mutation_type(self, mutation_type: str) -> str:
        mapping = {
            "adoption":       "methodological_adoption",
            "contradiction":  "direct_contradiction",
            "revival":        "revival",
            "incidental":     "incidental_mention",
        }
        return mapping.get(mutation_type, "")

    def _llm_classify(self, sentence: str, abstract: str, cited_title: str) -> str:
        try:
            from backend.llm_client import get_llm_client
            llm    = get_llm_client()
            prompt = (
                f"Classify WHY this paper cites '{cited_title}'.\n"
                f"Citing sentence: {(sentence or abstract or '')[:500]}\n\n"
                f"Choose exactly one: {', '.join(CITATION_INTENT_CATEGORIES)}\n"
                f"Reply with only the category name, nothing else."
            )
            result = llm.generate_chat_response(
                system_prompt="You classify citation intent. Reply with ONLY the category name.",
                user_prompt=prompt,
            )
            if result:
                cleaned = result.strip().lower().replace(" ", "_")
                if cleaned in CITATION_INTENT_CATEGORIES:
                    return cleaned
        except Exception:
            pass
        return "methodological_adoption"  # safe default
