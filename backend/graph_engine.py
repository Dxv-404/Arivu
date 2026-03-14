"""
graph_engine.py — AncestryGraph: BFS citation graph builder.

Orchestrates:
  1. BFS crawl via SmartPaperResolver
  2. Reference selection (semantic relevance + citation count)
  3. DAG enforcement (cycle removal)
  4. Paper embedding population (paper_embeddings table, for Phase 3+ pgvector)
  5. NLP pipeline (InheritanceDetector)
  6. export_to_json() — D3.js-compatible format
  7. R2 caching and DB graph record

Phase 2 produces the graph JSON. Pruning impact precomputation is added in Phase 3.
DNA profiling and diversity scoring are added in Phase 4.

Full-text extraction: deferred to Phase 3. In Phase 2, all text comes from
abstracts (text_tier 3) or titles only (text_tier 4). The full-text pipeline
(PDF fetch → section extraction → text_tier 1/2) will be implemented in Phase 3
alongside the pruning engine which benefits most from richer text.
"""
import asyncio
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
    Adaptive depth: 2 for recent papers, 3 for older papers, capped at 3.
    Spec §7: always cap total nodes at 400.
    """
    base = 2
    if seed_paper.year and seed_paper.year < 2000:
        base = 3
    if user_goal == "quick_overview":
        return min(base, 2)
    if user_goal == "deep_ancestry":
        return min(base + 1, 3)
    return base


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
        self._job_id: Optional[str] = None
        self._resolver: SmartPaperResolver = resolver
        self._nlp: InheritanceDetector = InheritanceDetector()

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

        # ── Step 1: Resolve seed paper ────────────────────────────────────
        await self._emit("searching", "Finding seed paper…")
        from backend.normalizer import normalize_user_input
        canonical_id, id_type = normalize_user_input(seed_paper_id)
        seed_paper = await self._resolver.resolve(canonical_id, id_type)
        all_papers[seed_paper.paper_id] = seed_paper

        max_depth = determine_crawl_depth(seed_paper, user_goal)
        logger.info(f"Building graph: seed={seed_paper.paper_id[:8]}… depth={max_depth}")

        # ── Step 2: BFS crawl ─────────────────────────────────────────────
        await self._emit("crawling", f"Building ancestry graph to depth {max_depth}…")
        self.graph.add_node(seed_paper.paper_id, depth=0)

        visited: set[str] = {seed_paper.paper_id}
        queue: deque[tuple[Paper, int]] = deque([(seed_paper, 0)])

        while queue:
            paper, depth = queue.popleft()

            if depth >= max_depth:
                continue

            await self._emit(
                "crawling",
                f"Depth {depth+1}: expanding '{paper.title[:50]}…'"
            )

            refs = await self._resolver.get_references(paper.paper_id, limit=100)
            selected = select_references(seed_paper, refs, limit=config.MAX_REFS_PER_PAPER)

            if not selected:
                continue

            ref_ids = [r.paper_id for r in selected]
            enriched = await self._resolver.resolve_batch(ref_ids)

            for ref in enriched:
                all_papers[ref.paper_id] = ref
                if ref.paper_id not in visited:
                    visited.add(ref.paper_id)
                    self.graph.add_node(ref.paper_id, depth=depth + 1)
                    queue.append((ref, depth + 1))
                # Edge: paper cites ref
                if not self.graph.has_edge(paper.paper_id, ref.paper_id):
                    self.graph.add_edge(paper.paper_id, ref.paper_id)

            # Safety cap
            if len(self.graph.nodes) > config.MAX_GRAPH_SIZE:
                logger.warning(f"Graph size cap reached ({config.MAX_GRAPH_SIZE} nodes)")
                break

        if len(self.graph.nodes) < 2:
            raise EmptyGraphError(seed_paper.paper_id)

        logger.info(f"BFS complete: {len(self.graph.nodes)} nodes, {len(self.graph.edges)} edges")

        # ── Step 3: DAG enforcement ───────────────────────────────────────
        self._ensure_dag()

        # ── Step 4: Populate paper embeddings (for Phase 3+ pgvector search) ─
        await self._emit("analyzing", "Encoding paper embeddings…")
        await self._populate_embeddings(all_papers)

        # ── Step 5: NLP analysis ──────────────────────────────────────────
        await self._emit(
            "analyzing",
            f"Running NLP analysis on {len(self.graph.edges())} edges…"
        )
        edges = list(self.graph.edges())
        edge_analyses = await self._nlp.analyze_edges(edges, all_papers, self.graph)

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

        # ── Step 6: Export and cache ──────────────────────────────────────
        await self._emit("finalizing", "Building graph export…")
        graph_json = self._export_to_json(seed_paper, all_papers)
        build_time = time.time() - build_start

        # Cache to R2
        from backend.r2_client import R2Client
        from backend.config import config as _config
        r2 = R2Client(_config)
        graph_key = f"graphs/{self._job_id}.json"
        try:
            r2.put_json(graph_key, graph_json)
            logger.info(f"Graph cached to R2: {graph_key}")
        except Exception as e:
            logger.warning(f"R2 cache failed (non-fatal): {e}")

        # Persist graph record to DB
        db.execute(
            """
            INSERT INTO graphs (
                graph_id, seed_paper_id, graph_json_url,
                node_count, edge_count, max_depth,
                coverage_score, coverage_report,
                model_version, build_time_seconds,
                created_at, last_accessed
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, NOW(), NOW())
            ON CONFLICT (graph_id) DO UPDATE SET
                last_accessed = NOW(),
                computed_at = NOW()
            """,
            (
                self._job_id,
                seed_paper.paper_id,
                graph_key,
                len(graph_json["nodes"]),
                len(graph_json["edges"]),
                max_depth,
                None,          # coverage_score — computed in Phase 3
                json.dumps({}),  # coverage_report — populated in Phase 3
                MODEL_VERSION,
                round(build_time, 2),
            ),
        )

        # Link graph to session (via job record)
        try:
            job_row = db.fetchone(
                "SELECT session_id FROM build_jobs WHERE job_id = %s",
                (self._job_id,),
            )
            if job_row and job_row.get("session_id"):
                db.execute(
                    """
                    INSERT INTO session_graphs (session_id, graph_id, created_at)
                    VALUES (%s, %s, NOW())
                    ON CONFLICT DO NOTHING
                    """,
                    (job_row["session_id"], self._job_id),
                )
        except Exception as e:
            logger.debug(f"session_graphs insert failed (non-fatal): {e}")

        await self._emit("done", "Graph ready.", graph=graph_json)
        return graph_json

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
                headers={"Authorization": f"Bearer {config.NLP_WORKER_SECRET}"},
            ) as client:
                for i in range(0, len(texts), chunk_size):
                    chunk = texts[i:i + chunk_size]
                    try:
                        resp = await client.post(
                            f"{config.NLP_WORKER_URL}/encode_batch",
                            json={"texts": chunk, "normalize": True},
                        )
                        resp.raise_for_status()
                        data = resp.json()
                        all_embeddings.extend(data["embeddings"])
                    except Exception as e:
                        logger.warning(f"Embedding chunk {i//chunk_size} failed: {e}")
                        # Fill with None placeholders so indices stay aligned
                        all_embeddings.extend([None] * len(chunk))
        except Exception as e:
            logger.warning(f"Embedding population failed (non-fatal): {e}")
            return

        # Persist embeddings to paper_embeddings table
        inserted = 0
        for (paper_id, _), embedding in zip(to_encode, all_embeddings):
            if embedding is None:
                continue
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
                    (paper_id, str(embedding), MODEL_VERSION),
                )
                inserted += 1
            except Exception as e:
                logger.debug(f"Embedding insert failed for {paper_id}: {e}")

        logger.info(f"Embeddings stored: {inserted}/{len(to_encode)}")

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
                      pruning_impact (0 placeholder — computed in Phase 3),
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
                "pruning_impact":   0,           # Phase 3
                "is_bottleneck":    False,        # Phase 3
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
                "graph_id":         self._job_id,
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
            logger.debug(f"_emit DB write failed (non-fatal): {e}")
