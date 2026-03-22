"""
graph_engine.py — AncestryGraph: BFS citation graph builder.

Orchestrates:
  1. BFS crawl via SmartPaperResolver
  2. Reference selection (semantic relevance + citation count)
  3. DAG enforcement (cycle removal)
  4. Paper embedding population (paper_embeddings table, for pgvector)
  5. NLP pipeline (InheritanceDetector)
  6. export_to_json() — D3.js-compatible format
  7. R2 caching and DB graph record
  8. Post-build: leaderboard, DNA profile, diversity score (Phase 3)

Phase 2 established the graph JSON pipeline.
Phase 3 adds _on_graph_complete() for leaderboard/DNA/diversity computation,
from_json() for reconstructing cached graphs, and data_completeness for
coverage-gated features like gap finding.
"""
import asyncio
import hashlib
import json
import logging
import time
import uuid
from collections import deque
from typing import Optional

import networkx as nx

import backend.db as db
from backend.api_client import SmartPaperResolver, resolver
from backend.config import config
from backend.models import Paper, get_confidence_tier
from backend.nlp_pipeline import InheritanceDetector
from exceptions import (
    EmptyGraphError, GraphBuildError, GraphTooLargeError,
    NLPWorkerError, PaperNotFoundError,
)

logger = logging.getLogger(__name__)

MODEL_VERSION = "1.0.0"


def select_references(
    seed_paper: Paper,
    references: list[Paper],
    limit: int = 50,
) -> list[Paper]:
    """
    Select the most relevant references for BFS expansion.
    Combines semantic relevance to seed paper (65%) and citation count (35%).
    Falls back to citation-count-only ordering when no abstract is available.
    """
    if not references:
        return []

    max_citations = max((r.citation_count for r in references if r.citation_count), default=1)

    scored: list[tuple[float, Paper]] = []
    for ref in references:
        citation_score = (ref.citation_count or 0) / max_citations

        # Semantic score: title overlap as cheap proxy (no NLP worker call here)
        # Full semantic similarity via embeddings added in Phase 3+
        if ref.title and seed_paper.title:
            seed_words = set(seed_paper.title.lower().split())
            ref_words = set(ref.title.lower().split())
            overlap = len(seed_words & ref_words) / max(len(seed_words), 1)
        else:
            overlap = 0.0

        relevance = (overlap * 0.65) + (citation_score * 0.35)
        scored.append((relevance, ref))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [paper for _, paper in scored[:limit]]


def determine_crawl_depth(seed_paper: Paper, user_goal: str) -> int:
    """
    Adaptive depth: 2 for recent papers, 3 for older papers.
    Always capped by config.MAX_GRAPH_DEPTH (1 without S2 key, 2 default).
    """
    base = 2
    if seed_paper.year and seed_paper.year < 2000:
        base = 3
    if user_goal == "quick_overview":
        depth = min(base, 2)
    elif user_goal == "deep_ancestry":
        depth = min(base + 1, 3)
    else:
        depth = base
    # Hard cap from config — respects S2 rate-limit fallback
    return min(depth, config.MAX_GRAPH_DEPTH)


class AncestryGraph:
    """
    Builds and exports a citation ancestry graph for one seed paper.

    Usage (from Flask route via await_sync):
        graph_engine = AncestryGraph()
        graph_json = await graph_engine.build_graph(
            seed_paper_id="abc123...",
            user_goal="general",
            job_id="uuid-...",
        )
    """

    def __init__(self):
        self.graph: nx.DiGraph = nx.DiGraph()
        self.nodes: dict[str, Paper] = {}          # paper_id → Paper
        self.seed_paper_id: Optional[str] = None
        self._job_id: Optional[str] = None
        self._graph_id: Optional[str] = None       # stable SHA256-based ID
        self._resolver: SmartPaperResolver = resolver
        self._nlp: InheritanceDetector = InheritanceDetector()

    # ─── Stable graph_id computation ─────────────────────────────────────────

    def _compute_graph_id(self, seed_paper_id: str, session_id: str) -> str:
        """
        Canonical graph_id: SHA256(seed_paper_id + "_" + session_id)[:32].
        Stable across rebuilds — the same user/session rebuilding the same paper
        gets the same graph_id. Phase 8 caching (graph_memory_state,
        live_subscriptions) depends on this stability.
        """
        raw = f"{seed_paper_id}_{session_id}"
        return hashlib.sha256(raw.encode()).hexdigest()[:32]

    # ─── Reconstruct from cached JSON ──────────────────────────────────────────

    @classmethod
    def from_json(cls, graph_json: dict) -> "AncestryGraph":
        """
        Reconstruct an AncestryGraph from the JSON dict produced by export_to_json().
        Used by /api/prune, /api/dna, /api/diversity — they load the cached graph
        from R2 / DB rather than rebuilding it.
        """
        instance = cls.__new__(cls)
        instance.nodes = {}
        instance.graph = nx.DiGraph()

        for node_data in graph_json.get("nodes", []):
            # Map "id" → "paper_id" since export uses "id"
            node_dict = dict(node_data)
            if "id" in node_dict and "paper_id" not in node_dict:
                node_dict["paper_id"] = node_dict.pop("id")

            try:
                paper = Paper(**{
                    k: v for k, v in node_dict.items()
                    if k in Paper.__dataclass_fields__
                })
                instance.nodes[paper.paper_id] = paper
                instance.graph.add_node(paper.paper_id)
            except Exception:
                pass

        for edge_data in graph_json.get("edges", []):
            src = edge_data.get("source")
            tgt = edge_data.get("target")
            if src and tgt:
                instance.graph.add_edge(src, tgt, **edge_data)

        instance.metadata = graph_json.get("metadata", {})
        instance.seed_paper_id = instance.metadata.get("seed_paper_id")
        instance._graph_id = instance.metadata.get("graph_id")
        instance._job_id = instance._graph_id  # backward compat
        instance._resolver = resolver
        instance._nlp = InheritanceDetector()
        return instance

    # ─── Public export method ─────────────────────────────────────────────────

    def export_to_json(self) -> dict:
        """Public export — delegates to _export_to_json with stored context."""
        seed_paper = self.nodes.get(self.seed_paper_id)
        if seed_paper:
            return self._export_to_json(seed_paper, self.nodes)
        return {"nodes": [], "edges": [], "metadata": {}}

    # ─── Coverage score ───────────────────────────────────────────────────────

    @property
    def data_completeness(self):
        """Coverage score based on text_tier distribution."""
        if not self.nodes:
            return None

        class _Coverage:
            def __init__(self, score):
                self.coverage_score = score

        total = len(self.nodes)
        full_text = sum(
            1 for p in self.nodes.values()
            if getattr(p, "text_tier", 4) <= 2
        )
        return _Coverage(full_text / total if total > 0 else 0.0)

    # ─── Main entry point ────────────────────────────────────────────────────

    async def build_graph(
        self,
        seed_paper_id: str,
        user_goal: str = "general",
        job_id: Optional[str] = None,
    ) -> dict:
        """
        Full graph build pipeline. Emits SSE progress events via job_events table.

        Returns the graph JSON dict (same format as export_to_json).
        Raises GraphBuildError on unrecoverable failures.
        """
        self._job_id = job_id or str(uuid.uuid4())
        self.graph = nx.DiGraph()

        try:
            return await self._build(seed_paper_id, user_goal)
        except (PaperNotFoundError, GraphTooLargeError, EmptyGraphError):
            raise   # Pass through known errors
        except Exception as e:
            logger.error(f"Graph build failed for {seed_paper_id}: {e}", exc_info=True)
            await self._emit("error", f"Graph build failed: {str(e)[:200]}")
            raise GraphBuildError(seed_paper_id, str(e)) from e

    async def _build(self, seed_paper_id: str, user_goal: str) -> dict:
        all_papers: dict[str, Paper] = {}
        build_start = time.time()

        # ── Step 0: Detect API tier and reset per-build state ──────────
        self._resolver.reset_for_new_build()
        tier = self._resolver.detect_tier()
        tier_labels = {1: "S2-primary (API key)", 2: "OpenAlex-primary", 3: "degraded"}
        await self._emit(
            "searching",
            f"API tier: {tier_labels.get(tier, 'unknown')} — Finding seed paper…"
        )

        # ── Step 1: Resolve seed paper ────────────────────────────────────
        from backend.normalizer import normalize_user_input
        canonical_id, id_type = normalize_user_input(seed_paper_id)
        seed_paper = await self._resolver.resolve(canonical_id, id_type)
        all_papers[seed_paper.paper_id] = seed_paper
        self.seed_paper_id = seed_paper.paper_id

        # Compute stable graph_id from seed_paper_id + session_id
        try:
            job_row = db.fetchone(
                "SELECT session_id FROM build_jobs WHERE job_id = %s",
                (self._job_id,),
            )
            session_id = (job_row or {}).get("session_id", self._job_id or "")
        except Exception:
            session_id = self._job_id or ""
        self._graph_id = self._compute_graph_id(seed_paper.paper_id, session_id)

        max_depth = determine_crawl_depth(seed_paper, user_goal)
        # Report effective tier after seed resolution (may have changed if S2 429'd during resolve)
        effective_tier = self._resolver.detect_tier()
        logger.info(
            f"Building graph: seed={seed_paper.paper_id[:8]}… depth={max_depth} "
            f"tier={effective_tier} refs_cap={config.MAX_REFS_PER_PAPER}"
        )

        # ── Step 2: BFS crawl ─────────────────────────────────────────────
        tier_msg = f" [Tier {effective_tier}]" if effective_tier > 1 else ""
        await self._emit("crawling", f"Building ancestry graph to depth {max_depth}{tier_msg}…")
        self.graph.add_node(seed_paper.paper_id, depth=0)

        visited: set[str] = {seed_paper.paper_id}

        # ── BFS by depth level — depth 2+ uses concurrent expansion ─────
        # At depth 0, there is 1 paper (seed) — sequential is fine.
        # At depth 1+, there can be 30-50 papers — processing them serially
        # takes 4-25 minutes (each paper requires 5-7 sequential API calls).
        # Using asyncio.gather() with a semaphore processes them concurrently,
        # cutting depth-2 time from minutes to tens of seconds.
        current_level: list[tuple[Paper, int]] = [(seed_paper, 0)]
        _concurrency_sem = asyncio.Semaphore(5)  # Max 5 concurrent API call chains
        _cap_reached = False

        while current_level and not _cap_reached:
            next_level: list[tuple[Paper, int]] = []

            async def _expand_one(paper: Paper, depth: int):
                """Expand a single paper's references. Thread-safe via semaphore."""
                nonlocal _cap_reached
                if _cap_reached or depth >= max_depth:
                    return []
                async with _concurrency_sem:
                    # Live graph size check — stops fetching if cap already exceeded
                    # (checked under semaphore to catch growth from concurrent tasks)
                    if _cap_reached or len(self.graph.nodes) > config.MAX_GRAPH_SIZE:
                        _cap_reached = True
                        return []
                    await self._emit(
                        "crawling",
                        f"Depth {depth+1}: expanding '{paper.title[:50]}…'"
                    )
                    fetch_limit = min(config.MAX_REFS_PER_PAPER * 2, 100)
                    refs = await self._resolver.get_references(paper.paper_id, limit=fetch_limit)
                    selected = select_references(seed_paper, refs, limit=config.MAX_REFS_PER_PAPER)
                    if not selected:
                        return []
                    ref_ids = [r.paper_id for r in selected]
                    enriched = await self._resolver.resolve_batch(ref_ids)
                    return [(paper, ref, depth) for ref in enriched]

            # Depth 0 (seed): sequential for simplicity
            # Depth 1+: concurrent expansion of all papers at this depth
            if len(current_level) <= 3:
                # Small batches: run sequentially (less overhead)
                results = []
                for _paper, _depth in current_level:
                    r = await _expand_one(_paper, _depth)
                    results.append(r)
            else:
                # Large batches (depth 2+): run concurrently
                await self._emit(
                    "crawling",
                    f"Depth {current_level[0][1]+1}: expanding {len(current_level)} papers concurrently…"
                )
                tasks = [_expand_one(p, d) for p, d in current_level]
                results = await asyncio.gather(*tasks, return_exceptions=True)

            for result in results:
                if isinstance(result, Exception):
                    logger.warning(f"Concurrent BFS expansion error: {result}")
                    continue
                for parent_paper, ref, ref_depth in result:
                    all_papers[ref.paper_id] = ref
                    if ref.paper_id not in visited:
                        visited.add(ref.paper_id)
                        self.graph.add_node(ref.paper_id, depth=ref_depth + 1)
                        next_level.append((ref, ref_depth + 1))
                    if not self.graph.has_edge(parent_paper.paper_id, ref.paper_id):
                        self.graph.add_edge(parent_paper.paper_id, ref.paper_id)

                    # Safety cap
                    if len(self.graph.nodes) > config.MAX_GRAPH_SIZE:
                        logger.warning(f"Graph size cap reached ({config.MAX_GRAPH_SIZE} nodes)")
                        _cap_reached = True
                        break
                if _cap_reached:
                    break

            current_level = next_level

        if len(self.graph.nodes) < 2:
            raise EmptyGraphError(seed_paper.paper_id)

        logger.info(f"BFS complete: {len(self.graph.nodes)} nodes, {len(self.graph.edges)} edges")

        # ── Step 3: DAG enforcement ───────────────────────────────────────
        self._ensure_dag()

        # ── Step 4: Populate paper embeddings (for Phase 3+ pgvector search) ─
        await self._emit("analyzing", "Waking up NLP worker (may take up to 60 s on first request)…")
        await self._populate_embeddings(all_papers)
        await self._emit("analyzing", "Embeddings complete.")

        # ── Step 5: NLP analysis ──────────────────────────────────────────
        num_edges = len(self.graph.edges())
        await self._emit(
            "analyzing",
            f"Running NLP analysis on {num_edges} edges…"
        )
        edges = list(self.graph.edges())
        edge_analyses = await self._nlp.analyze_edges(
            edges, all_papers, self.graph, progress_callback=self._emit
        )

        # Attach analysis results as edge attributes
        for ea in edge_analyses:
            citing_id = ea.citing_paper_id
            cited_id = ea.cited_paper_id
            if self.graph.has_edge(citing_id, cited_id):
                self.graph[citing_id][cited_id].update({
                    "edge_id":                ea.edge_id,
                    "similarity_score":       ea.similarity_score,
                    "citing_sentence":        ea.citing_sentence,
                    "cited_sentence":         ea.cited_sentence,
                    "citing_text_source":     ea.citing_text_source,
                    "cited_text_source":      ea.cited_text_source,
                    "mutation_type":          ea.mutation_type,
                    "mutation_confidence":    ea.mutation_confidence,
                    "citation_intent":        ea.citation_intent,
                    "base_confidence":        ea.base_confidence,
                    "llm_classified":         ea.llm_classified,
                    "comparable":             ea.comparable,
                })

        # ── Step 6: Store node references for downstream use ─────────────
        self.nodes = all_papers

        # ── Step 7: Export, compute pruning impacts, then cache ──────────
        await self._emit("finalizing", "Building graph export…")
        graph_json = self._export_to_json(seed_paper, all_papers)
        build_time = time.time() - build_start

        # Compute pruning impacts BEFORE caching to R2.
        # Previously R2 was written before this step, so cached graphs had
        # pruning_impact=0 for every node.  Moving it here ensures the R2
        # cache contains the fully enriched graph JSON.
        from backend.pruning import compute_all_pruning_impacts
        try:
            pruning_impacts = compute_all_pruning_impacts(self.graph, self.seed_paper_id)
            self._pruning_impacts = pruning_impacts
            impact_lookup = {pid: data.get("collapse_count", 0) for pid, data in pruning_impacts.items()}
            # Bottleneck threshold: top 20% of NON-ZERO impacts, not all nodes.
            # In sparse graphs (e.g. 601 nodes, only 21 with impact > 0), using
            # all nodes gives threshold=0 which marks nothing as bottleneck.
            nonzero_vals = sorted([v for v in impact_lookup.values() if v > 0], reverse=True)
            if nonzero_vals:
                threshold = nonzero_vals[min(len(nonzero_vals) - 1, max(0, len(nonzero_vals) // 5))]
            else:
                threshold = 0
            for node in graph_json.get("nodes", []):
                cc = impact_lookup.get(node["id"], 0)
                node["pruning_impact"] = cc
                node["is_bottleneck"] = cc >= threshold if threshold > 0 else False
        except Exception as exc:
            logger.warning(f"Pruning impact computation failed (non-fatal): {exc}")

        # Cache to R2 — NOW with pruning impacts already populated
        from backend.r2_client import R2Client
        from backend.config import config as _config
        r2 = R2Client(_config)
        graph_key = f"graphs/{self._graph_id}.json"
        try:
            r2.put_json(graph_key, graph_json)
            logger.info(f"Graph cached to R2: {graph_key}")
        except Exception as e:
            logger.warning(f"R2 cache failed (non-fatal): {e}")

        # Persist graph record to DB — use stable graph_id
        db.execute(
            """
            INSERT INTO graphs (
                graph_id, seed_paper_id, graph_json_url,
                node_count, edge_count, max_depth,
                coverage_score, coverage_report,
                model_version, build_time_seconds,
                created_at, last_accessed, computed_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, NOW(), NOW(), NOW())
            ON CONFLICT (graph_id) DO UPDATE SET
                graph_json_url = EXCLUDED.graph_json_url,
                node_count = EXCLUDED.node_count,
                edge_count = EXCLUDED.edge_count,
                model_version = EXCLUDED.model_version,
                build_time_seconds = EXCLUDED.build_time_seconds,
                last_accessed = NOW(),
                computed_at = NOW()
            """,
            (
                self._graph_id,
                seed_paper.paper_id,
                graph_key,
                len(graph_json["nodes"]),
                len(graph_json["edges"]),
                max_depth,
                None,          # coverage_score
                json.dumps({}),  # coverage_report
                MODEL_VERSION,
                round(build_time, 2),
            ),
        )

        # Emit "done" with fully enriched graph JSON (including pruning impacts)
        await self._emit("done", "Graph ready.", graph=graph_json)

        # ── Step 9: Post-build bookkeeping (runs AFTER done, non-blocking) ────
        # Heavy operations (DB writes, DNA/diversity, researcher profiles) happen
        # after the client has the graph. This prevents pool exhaustion from
        # killing the SSE worker during Koyeb's gunicorn timeout window.
        try:
            job_row2 = db.fetchone(
                "SELECT session_id FROM build_jobs WHERE job_id = %s",
                (self._job_id,),
            )
            session_id_bk = (job_row2 or {}).get("session_id", "")
        except Exception:
            session_id_bk = ""

        self._on_graph_complete(self._graph_id, session_id_bk)

        return graph_json

    # ─── Post-build bookkeeping ──────────────────────────────────────────────

    def _on_graph_complete(self, graph_id: str, session_id: str) -> None:
        """
        Post-build bookkeeping:
        1. INSERT into session_graphs linking session → graph
        2. Compute leaderboard JSON and store in graphs table
        3. Compute DNA profile and store in graphs table
        4. Compute diversity score and store in graphs table

        Called AFTER streaming 'done' event so the client gets the graph
        immediately.  All failures are logged and swallowed — graph is still usable.
        """
        from backend.pruning import compute_all_pruning_impacts

        # 1. Link session to graph
        if session_id:
            try:
                db.execute(
                    """
                    INSERT INTO session_graphs (session_id, graph_id, created_at)
                    VALUES (%s, %s, NOW())
                    ON CONFLICT (session_id, graph_id) DO NOTHING
                    """,
                    (session_id, graph_id),
                )
            except Exception as exc:
                logger.warning(f"session_graphs insert failed: {exc}")

        # 2. Leaderboard — reuse pruning impacts from _build() if available
        try:
            leaderboard = getattr(self, '_pruning_impacts', None) or \
                          compute_all_pruning_impacts(self.graph, self.seed_paper_id)
            sorted_leaderboard = sorted(
                [{"paper_id": k, **v} for k, v in leaderboard.items()],
                key=lambda x: x["collapse_count"],
                reverse=True,
            )[:20]

            # Enrich with paper metadata for the UI
            for entry in sorted_leaderboard:
                paper = self.nodes.get(entry["paper_id"])
                if paper:
                    entry["title"] = getattr(paper, "title", "")
                    entry["year"] = getattr(paper, "year", None)
                    entry["authors"] = (getattr(paper, "authors", []) or [])[:2]

            db.execute(
                "UPDATE graphs SET leaderboard_json = %s WHERE graph_id = %s",
                (json.dumps(sorted_leaderboard), graph_id),
            )
        except Exception as exc:
            logger.warning(f"leaderboard computation failed: {exc}")

        # Phase 8: seed researcher_profiles with author stubs (batch insert)
        try:
            profile_rows = []
            seen_author_ids = set()
            for paper_id, paper in self.nodes.items():
                for author_name in (getattr(paper, "authors", []) or []):
                    if not author_name or not author_name.strip():
                        continue
                    author_id = hashlib.sha256(author_name.strip().lower().encode()).hexdigest()[:32]
                    if author_id not in seen_author_ids:
                        seen_author_ids.add(author_id)
                        profile_rows.append((author_id, author_name.strip()))
            if profile_rows:
                db.executemany(
                    """
                    INSERT INTO researcher_profiles (author_id, display_name)
                    VALUES (%s, %s)
                    ON CONFLICT (author_id) DO NOTHING
                    """,
                    profile_rows,
                )
                logger.info(f"Seeded {len(profile_rows)} researcher profiles (batch)")
        except Exception as exc:
            logger.warning(f"researcher_profiles seeding failed: {exc}")

        # 3 + 4. DNA profile + diversity score (best-effort)
        try:
            from backend.dna_profiler import DNAProfiler
            from backend.diversity_scorer import DiversityScorer

            paper_ids = list(self.nodes.keys())
            profiler = DNAProfiler()
            dna = profiler.compute_profile(paper_ids, self.seed_paper_id, self.nodes)

            scorer = DiversityScorer()
            diversity = scorer.compute_score(paper_ids, self.nodes, dna_profile=dna)

            db.execute(
                "UPDATE graphs SET dna_json = %s, diversity_json = %s WHERE graph_id = %s",
                (json.dumps(dna.to_dict()), json.dumps(diversity.to_dict()), graph_id),
            )
        except Exception as exc:
            logger.warning(f"DNA/diversity computation failed: {exc}")

    # ─── Embedding population ─────────────────────────────────────────────────

    async def _populate_embeddings(self, all_papers: dict[str, Paper]) -> None:
        """
        Batch-encode paper abstracts/titles and store in paper_embeddings.

        Called after BFS crawl, before NLP analysis. Skips papers
        that already have an embedding in the DB. Uses /encode_batch on the NLP
        worker in chunks of 512. Non-fatal: embedding failures are logged and
        skipped so the graph build always completes.
        """
        import httpx as _httpx

        # Find papers that do not yet have embeddings
        paper_ids = list(all_papers.keys())
        if not paper_ids:
            return

        try:
            rows = db.fetchall(
                "SELECT paper_id FROM paper_embeddings WHERE paper_id = ANY(%s)",
                (paper_ids,),
            )
            existing_ids = {r["paper_id"] for r in rows}
        except Exception as e:
            logger.debug(f"Could not check existing embeddings: {e}")
            existing_ids = set()

        to_encode = [
            (pid, all_papers[pid])
            for pid in paper_ids
            if pid not in existing_ids
        ]

        if not to_encode:
            logger.debug("All papers already have embeddings")
            return

        logger.info(f"Encoding embeddings for {len(to_encode)} papers")
        await self._emit("analyzing", f"Encoding {len(to_encode)} paper embeddings (NLP worker may need 30-60 s to wake)…")

        # Build text list (abstract preferred, title fallback)
        texts = [
            (p.abstract or p.title or "")[:512]
            for _, p in to_encode
        ]

        # Encode in chunks of 512 (NLP worker limit)
        chunk_size = 512
        all_embeddings: list[list[float]] = []

        try:
            async with _httpx.AsyncClient(
                timeout=_httpx.Timeout(config.NLP_WORKER_TIMEOUT, connect=5.0),
                headers={"X-API-Key": config.NLP_WORKER_SECRET},
            ) as client:
                for i in range(0, len(texts), chunk_size):
                    chunk = texts[i:i + chunk_size]
                    chunk_num = i // chunk_size + 1
                    total_chunks = (len(texts) + chunk_size - 1) // chunk_size
                    await self._emit("analyzing", f"Sending embedding batch {chunk_num}/{total_chunks} to NLP worker…")
                    try:
                        resp = await client.post(
                            f"{config.NLP_WORKER_URL}/encode_batch",
                            json={"texts": chunk, "normalize": True},
                        )
                        resp.raise_for_status()
                        data = resp.json()
                        embeddings_chunk = data.get("embeddings", [])
                        # Validate length — mismatched count would misalign
                        # the zip(to_encode, all_embeddings) and silently pair
                        # wrong embeddings with wrong paper_ids.
                        if len(embeddings_chunk) != len(chunk):
                            logger.warning(
                                f"NLP worker embedding count mismatch: "
                                f"sent {len(chunk)}, got {len(embeddings_chunk)} — padding with None"
                            )
                            all_embeddings.extend([None] * len(chunk))
                        else:
                            all_embeddings.extend(embeddings_chunk)
                    except Exception as e:
                        logger.warning(f"Embedding chunk {i//chunk_size} failed: {e}")
                        # Fill with None placeholders so indices stay aligned
                        all_embeddings.extend([None] * len(chunk))
        except Exception as e:
            logger.warning(f"Embedding population failed (non-fatal): {e}")
            return

        # Persist embeddings to paper_embeddings table — batched for performance.
        # Individual INSERTs for 200+ papers causes 200+ DB round trips on Neon.
        # Using executemany reduces this to a single round trip.
        insert_rows = []
        for (paper_id, _), embedding in zip(to_encode, all_embeddings):
            if embedding is not None:
                insert_rows.append((paper_id, str(embedding), MODEL_VERSION))

        if insert_rows:
            try:
                db.executemany(
                    """
                    INSERT INTO paper_embeddings (paper_id, embedding, model_version, computed_at)
                    VALUES (%s, %s::vector, %s, NOW())
                    ON CONFLICT (paper_id) DO UPDATE SET
                        embedding     = EXCLUDED.embedding,
                        model_version = EXCLUDED.model_version,
                        computed_at   = NOW()
                    """,
                    insert_rows,
                )
                logger.info(f"Embeddings stored: {len(insert_rows)}/{len(to_encode)}")
            except Exception as e:
                logger.warning(f"Batch embedding insert failed, falling back to individual: {e}")
                inserted = 0
                for paper_id, emb_str, version in insert_rows:
                    try:
                        db.execute(
                            """
                            INSERT INTO paper_embeddings (paper_id, embedding, model_version, computed_at)
                            VALUES (%s, %s::vector, %s, NOW())
                            ON CONFLICT (paper_id) DO UPDATE SET
                                embedding     = EXCLUDED.embedding,
                                model_version = EXCLUDED.model_version,
                                computed_at   = NOW()
                            """,
                            (paper_id, emb_str, version),
                        )
                        inserted += 1
                    except Exception as e2:
                        logger.debug(f"Individual embedding insert failed for {paper_id}: {e2}")
                logger.info(f"Embeddings stored (fallback): {inserted}/{len(insert_rows)}")

    # ─── DAG enforcement ──────────────────────────────────────────────────────

    def _ensure_dag(self) -> None:
        """Remove edges that create cycles (sampling artifacts from BFS)."""
        try:
            while not nx.is_directed_acyclic_graph(self.graph):
                cycle = next(nx.simple_cycles(self.graph))
                # Remove the last edge in the cycle (the one that closes it)
                edge_to_remove = (cycle[-1], cycle[0])
                if self.graph.has_edge(*edge_to_remove):
                    self.graph.remove_edge(*edge_to_remove)
                    logger.debug(f"Removed cycle edge: {edge_to_remove}")
        except StopIteration:
            pass   # No cycles found
        except Exception as e:
            logger.warning(f"DAG enforcement error (non-fatal): {e}")

    # ─── JSON export ─────────────────────────────────────────────────────────

    def _export_to_json(self, seed_paper: Paper, all_papers: dict[str, Paper]) -> dict:
        """
        Export NetworkX graph to D3.js-compatible JSON.

        Node fields:  id, title, authors, year, citation_count, fields_of_study,
                      abstract_preview, url, doi, is_seed, is_root, depth,
                      pruning_impact (initialized 0, overwritten by _build() Step 7),
                      is_bottleneck, text_tier, is_retracted, language
        Edge fields:  source, target, similarity_score, citing_sentence,
                      cited_sentence, mutation_type, citation_intent,
                      final_confidence, confidence_tier, comparable,
                      citing_text_source, cited_text_source
        """
        nodes = []
        for paper_id, node_data in self.graph.nodes(data=True):
            paper = all_papers.get(paper_id)
            if not paper:
                continue
            nodes.append({
                "id":               paper.paper_id,
                "title":            paper.title,
                "authors":          paper.authors[:3],
                "year":             paper.year,
                "citation_count":   paper.citation_count,
                "fields_of_study":  paper.fields_of_study,
                "abstract_preview": (paper.abstract or "")[:200],
                "url":              paper.url,
                "doi":              paper.doi,
                "is_seed":          paper.paper_id == seed_paper.paper_id,
                "is_root":          self.graph.out_degree(paper_id) == 0,
                "depth":            node_data.get("depth", -1),
                "pruning_impact":   0,           # Overwritten by _build() Step 7 after pruning computation
                "is_bottleneck":    False,        # Overwritten by _build() Step 7 bottleneck detection
                "text_tier":        paper.text_tier,
                "is_retracted":     paper.is_retracted,
                "language":         paper.language,
            })

        edges = []
        for citing_id, cited_id, edge_data in self.graph.edges(data=True):
            conf = edge_data.get("base_confidence", 0.0)
            edges.append({
                "source":              citing_id,
                "target":              cited_id,
                "similarity_score":    edge_data.get("similarity_score", 0.0),
                "citing_sentence":     edge_data.get("citing_sentence"),
                "cited_sentence":      edge_data.get("cited_sentence"),
                "mutation_type":       edge_data.get("mutation_type", "unknown"),
                "citation_intent":     edge_data.get("citation_intent", "unknown"),
                "final_confidence":    round(conf, 4),
                "confidence_tier":     get_confidence_tier(conf),
                "comparable":          edge_data.get("comparable", False),
                "citing_text_source":  edge_data.get("citing_text_source", "none"),
                "cited_text_source":   edge_data.get("cited_text_source", "none"),
            })

        return {
            "nodes": nodes,
            "edges": edges,
            "metadata": {
                "seed_paper_id":    seed_paper.paper_id,
                "seed_paper_title": seed_paper.title,
                "total_nodes":      len(nodes),
                "total_edges":      len(edges),
                "model_version":    MODEL_VERSION,
                "build_timestamp":  time.time(),
                "graph_id":         self._graph_id or self._job_id,
            },
        }

    # ─── SSE progress events ──────────────────────────────────────────────────

    async def _emit(
        self,
        status: str,
        message: str,
        graph: Optional[dict] = None,
    ) -> None:
        """
        Append a progress event to job_events. Flask SSE endpoint polls this table.

        Column note: INSERT uses 'sequence' (logical order within a job, computed via
        MAX subquery). The SSE poller in _event_stream() queries using 'id' (the SERIAL
        PK). Both columns exist in the Phase 1 schema. 'id' is used for polling because
        it is a stable, monotonically increasing cursor that works correctly even if the
        SSE client reconnects mid-stream via the Last-Event-ID header.
        """
        event: dict = {"status": status, "message": message, "timestamp": time.time()}
        if graph is not None:
            event["graph"] = graph
        try:
            db.execute(
                """
                INSERT INTO job_events (job_id, sequence, event_data, created_at)
                SELECT %s,
                       COALESCE((SELECT MAX(sequence) FROM job_events WHERE job_id = %s), 0) + 1,
                       %s::jsonb,
                       NOW()
                """,
                (self._job_id, self._job_id, json.dumps(event)),
            )
        except Exception as e:
            logger.warning(f"_emit DB write failed (non-fatal): {e}")
