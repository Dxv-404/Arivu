"""
app.py — Arivu Flask application factory and routes.
"""
import json
import logging
import os
import time
import uuid
from threading import Thread
from typing import Optional

from flask import Flask, Response, g, jsonify, render_template, request, stream_with_context
from flask_cors import CORS

from backend.config import Config, config
import backend.session_manager as session_manager
from backend.session_manager import require_session
from backend.rate_limiter import arivu_rate_limiter as rate_limiter
import backend.db as db
from backend.utils import (
    await_sync, load_gallery_index, load_precomputed_graph, log_action,
)
from backend.pruning import compute_pruning_result
from backend.dna_profiler import DNAProfiler
from backend.diversity_scorer import DiversityScorer
from backend.orphan_detector import OrphanDetector
from backend.gap_finder import GapFinder
from backend.llm_client import get_llm_client
from backend.chat_guide import ChatGuide
from backend.prompt_sanitizer import PromptSanitizer
from backend.graph_engine import AncestryGraph
from backend.export_generator import ExportGenerator
from backend.living_paper_scorer import LivingPaperScorer
from backend.originality_mapper import OriginalityMapper
from backend.paradigm_detector import ParadigmShiftDetector
from exceptions import ArivuError, register_error_handlers

logger = logging.getLogger(__name__)

# Module-level Flask app — required for @app.route decorators and app.logger
app = Flask(__name__)
app.secret_key = Config.SECRET_KEY


# ── Sentry ────────────────────────────────────────────────────────────────────

def _init_sentry(app) -> None:
    """
    Initialise Sentry. No-op if SENTRY_DSN is not configured.
    PII scrubbing: never sends cookies, session IDs, or IP addresses to Sentry.
    """
    dsn = Config.SENTRY_DSN
    if not dsn:
        app.logger.info("Sentry DSN not set — error tracking disabled")
        return
    try:
        import sentry_sdk
        from sentry_sdk.integrations.flask import FlaskIntegration

        def _scrub_pii(event, hint):
            if "request" in event:
                event["request"].get("headers", {}).pop("Cookie", None)
                event["request"].get("headers", {}).pop("X-Session-ID", None)
                event["request"].pop("env", None)
            event.pop("user", None)
            return event

        sentry_sdk.init(
            dsn=dsn,
            integrations=[FlaskIntegration()],
            traces_sample_rate=0.1,
            profiles_sample_rate=0.05,
            before_send=_scrub_pii,
            ignore_errors=[KeyError, ValueError],
        )
        app.logger.info("Sentry initialised")
    except ImportError:
        app.logger.warning("sentry-sdk not installed — add sentry-sdk[flask] to requirements.txt")


# ── CORS ──────────────────────────────────────────────────────────────────────

def _configure_cors(app) -> None:
    """
    CORS: allow the Koyeb auto-generated domain.

    After first deploy, set KOYEB_PUBLIC_DOMAIN=your-app-xxx.koyeb.app
    in Koyeb dashboard → Environment. Without it, cross-origin API calls
    are blocked in production (but same-origin page loads work fine).

    To add a custom domain later (Phase 5+), uncomment the arivu.app lines.
    """
    if Config.DEBUG:
        CORS(app,
             origins=["http://localhost:3000", "http://localhost:5000", "http://127.0.0.1:5000"],
             supports_credentials=True)
        return

    origins = []
    koyeb = Config.KOYEB_PUBLIC_DOMAIN.strip().lstrip("https://").lstrip("http://")
    if koyeb:
        origins.append(f"https://{koyeb}")
    # Custom domain (Phase 5+): uncomment when DNS is configured
    # origins += ["https://arivu.app", "https://www.arivu.app"]

    if origins:
        CORS(app,
             origins=origins,
             supports_credentials=True,
             allow_headers=["Content-Type", "X-Session-ID"],
             methods=["GET", "POST", "OPTIONS"])
    else:
        app.logger.warning(
            "CORS: KOYEB_PUBLIC_DOMAIN not set. Cross-origin requests blocked. "
            "Set in Koyeb dashboard → Environment after first deploy."
        )


# ── Security headers ─────────────────────────────────────────────────────────

# Defined at MODULE LEVEL (no @app decorator here) — registered in create_app()
def add_security_headers(response):
    """
    Attach security headers to every response.
    CSP matches what base.html loads (D3, Chart.js, Google Fonts).
    connect-src includes wss: for SSE compatibility under proxies.
    """
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' "
        "https://cdnjs.cloudflare.com https://cdn.jsdelivr.net "
        "https://fonts.googleapis.com; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com; "
        "connect-src 'self' https://api.semantic-scholar.org wss:; "
        "img-src 'self' data: https:; "
        "frame-ancestors 'none';"
    )
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    if not Config.DEBUG:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


# ── NLP health cache ─────────────────────────────────────────────────────────

_NLP_HEALTH: dict = {"ok": False, "checked_at": 0.0}
_NLP_HEALTH_TTL: float = 30.0


def _nlp_worker_reachable() -> bool:
    """Check NLP worker /health. Cached for _NLP_HEALTH_TTL seconds. Never raises."""
    import requests as _req
    now = time.monotonic()
    if now - _NLP_HEALTH["checked_at"] < _NLP_HEALTH_TTL:
        return _NLP_HEALTH["ok"]
    try:
        resp = _req.get(f"{Config.NLP_WORKER_URL}/health", timeout=3)
        result = resp.status_code == 200
    except Exception:
        result = False
    _NLP_HEALTH["ok"] = result
    _NLP_HEALTH["checked_at"] = now
    return result


# ── Application factory ──────────────────────────────────────────────────────

def create_app():
    """
    Application factory. Called by gunicorn: gunicorn "app:create_app()"
    Also called by tests: app = create_app(); client = app.test_client()

    Creates a fresh Flask instance each call (required for test isolation —
    Flask 3.x refuses to add middleware after first request).
    Updates the module-level `app` reference for route registration.
    """
    global app
    app = Flask(__name__)
    app.secret_key = Config.SECRET_KEY

    Config.validate()

    logging.basicConfig(
        level=logging.DEBUG if Config.DEBUG else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s - %(message)s",
    )

    _init_sentry(app)
    _configure_cors(app)

    # Register security headers after_request hook
    app.after_request(add_security_headers)

    # DB pool — sized for 2 gunicorn workers on Neon free tier
    # 2 workers × DB_POOL_MAX(4) = 8 connections + 2 reserved for scripts = 10 total ✅
    from backend.db import init_pool
    init_pool(
        database_url=Config.DATABASE_URL,
        minconn=Config.DB_POOL_MIN,
        maxconn=Config.DB_POOL_MAX,
    )
    app.logger.info("Database pool ready")

    register_error_handlers(app)

    # ── Routes ────────────────────────────────────────────────────────────

    @app.route("/health")
    def health():
        """
        Health check. HTTP 200 if DB reachable, 503 otherwise.
        Koyeb probes this every 30s. NLP and R2 status are informational.

        Response shape — Phase 4 format (checks dict) AND legacy flat keys
        for backward compatibility with test_smoke.py.
        """
        from backend.db import health_check
        db_ok = False
        try:
            db_ok = health_check()
        except Exception:
            pass

        nlp_ok = _nlp_worker_reachable()

        r2_ok = False
        try:
            from backend.r2_client import R2Client
            r2_ok = R2Client()._enabled
        except Exception:
            pass

        overall = "healthy" if db_ok else "degraded"
        return jsonify({
            "status":     overall,
            "db":         db_ok,        # backward compat — test_smoke.py asserts this
            "nlp_worker": nlp_ok,       # backward compat — test_smoke.py asserts this
            "checks": {
                "database":   "ok" if db_ok  else "error",
                "nlp_worker": "ok" if nlp_ok else "unreachable",
                "r2_storage": "ok" if r2_ok  else "error",
            },
            "version":    "1.0.0",
            "timestamp":  time.time(),
        }), 200 if db_ok else 503

    @app.route("/api/search", methods=["POST"])
    @require_session
    def search_papers():
        """
        Search for papers by title, DOI, arXiv ID, or S2 URL.

        Request body:  {"query": "Attention Is All You Need"}
        Response:      {"results": [Paper.to_dict(), ...], "id_type": "search"|"doi"|...}

        Direct-lookup inputs (DOI, arXiv, S2 ID) return a single result.
        Title inputs return up to 8 candidates for the disambiguation UI.
        """
        from backend.api_client import resolver
        from backend.normalizer import normalize_user_input
        from backend.schemas import SearchRequest

        allowed, headers = await_sync(
            rate_limiter.check(g.session_id, "POST /api/search")
        )
        if not allowed:
            return jsonify(rate_limiter.get_429_body(headers)), 429, headers

        try:
            body = SearchRequest(**request.get_json(force=True))
        except Exception as e:
            return jsonify({"error": "VALIDATION_ERROR", "message": str(e)}), 400

        canonical_id, id_type = normalize_user_input(body.query)

        try:
            if id_type in ("doi", "arxiv", "s2", "pubmed", "openalex"):
                # Direct lookup — single result
                paper = await_sync(resolver.resolve(canonical_id, id_type))
                results = [_paper_to_dict(paper)]
            else:
                # Title search — up to 8 candidates
                papers = await_sync(resolver.search_papers(body.query, limit=8))
                results = [_paper_to_dict(p) for p in papers]
        except Exception as e:
            app.logger.error(f"Search failed: {e}", exc_info=True)
            return jsonify({"error": "SEARCH_ERROR", "message": str(e)}), 500

        log_action(g.session_id, "search", {"query": body.query[:200], "id_type": id_type})
        return jsonify({"results": results, "id_type": id_type})

    @app.route("/api/graph/stream")
    @require_session
    def graph_stream():
        """
        Server-Sent Events endpoint. Client connects here; events stream as graph builds.
        Events are persisted to job_events so reconnection works transparently.

        Query params:
            paper_id  — any format accepted by normalize_user_input()
            goal      — "general" | "quick_overview" | "deep_ancestry" (default: "general")

        SSE event shapes:
            {"status": "searching",  "message": "..."}
            {"status": "crawling",   "message": "..."}
            {"status": "analyzing",  "message": "..."}
            {"status": "finalizing", "message": "..."}
            {"status": "done",       "message": "...", "graph": {...}}
            {"status": "error",      "message": "..."}
        """
        from backend.graph_engine import AncestryGraph
        from backend.normalizer import normalize_user_input

        paper_id_raw = request.args.get("paper_id", "").strip()
        user_goal = request.args.get("goal", "general")
        session_id = g.session_id

        if not paper_id_raw:
            return jsonify({"error": "paper_id query parameter is required"}), 400

        if user_goal not in ("general", "quick_overview", "deep_ancestry"):
            user_goal = "general"

        canonical_id, id_type = normalize_user_input(paper_id_raw)
        paper_id = canonical_id if canonical_id else paper_id_raw

        # Rate limiting
        allowed, headers = await_sync(
            rate_limiter.check(session_id, "GET /api/graph/stream")
        )
        if not allowed:
            return jsonify(rate_limiter.get_429_body(headers)), 429, headers

        # Check for recently cached graph (within GRAPH_CACHE_TTL_DAYS)
        cached_graph = db.fetchone(
            """
            SELECT g.graph_id, g.graph_json_url
            FROM graphs g
            JOIN session_graphs sg ON sg.graph_id = g.graph_id
            WHERE sg.session_id = %s
              AND g.seed_paper_id IN (
                SELECT paper_id FROM papers
                WHERE paper_id = %s OR doi = %s
              )
              AND g.computed_at > NOW() - INTERVAL '7 days'
            ORDER BY g.computed_at DESC
            LIMIT 1
            """,
            (session_id, paper_id, paper_id),
        )

        job_id = str(uuid.uuid4())

        db.execute(
            """
            INSERT INTO build_jobs (job_id, paper_id, session_id, status, created_at)
            VALUES (%s, %s, %s, 'pending', NOW())
            """,
            (job_id, paper_id[:200], session_id),
        )

        # If cached, stream it immediately and finish
        if cached_graph:
            from backend.r2_client import R2Client
            r2 = R2Client()
            graph_data = r2.get_json(cached_graph["graph_json_url"])

            if graph_data is None:
                logger.warning(
                    f"Cached graph {cached_graph['graph_id']} missing from R2 — "
                    "falling through to fresh build"
                )
            else:
                def _cached_stream():
                    payload = {"status": "done", "cached": True, "graph": graph_data}
                    yield f"data: {json.dumps(payload)}\n\n"

                return Response(
                    stream_with_context(_cached_stream()),
                    mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
                )

        # Start background build thread
        def _background_build():
            engine = AncestryGraph()
            try:
                await_sync(engine.build_graph(paper_id, user_goal, job_id))
                db.execute(
                    "UPDATE build_jobs SET status = 'done' WHERE job_id = %s",
                    (job_id,),
                )
            except Exception as e:
                app.logger.error(f"Background build failed for job {job_id}: {e}", exc_info=True)
                db.execute(
                    """
                    INSERT INTO job_events (job_id, sequence, event_data, created_at)
                    VALUES (%s, 1, %s::jsonb, NOW())
                    """,
                    (job_id, json.dumps({"status": "error", "message": str(e)[:500]})),
                )
                db.execute(
                    "UPDATE build_jobs SET status = 'error' WHERE job_id = %s",
                    (job_id,),
                )

        thread = Thread(target=_background_build, daemon=True)
        thread.start()

        log_action(session_id, "graph_build_start", {"paper_id": paper_id, "goal": user_goal})

        # Stream events from job_events as background thread writes them
        last_id_header = request.headers.get("Last-Event-ID", "0")

        def _event_stream():
            """
            Poll job_events and yield SSE frames.

            Flask's stream_with_context() raises GeneratorExit when the client
            disconnects; we catch it to log and exit cleanly.
            """
            sequence = int(last_id_header) if last_id_header.isdigit() else 0
            deadline = time.time() + 300   # 5-minute timeout

            try:
                while time.time() < deadline:
                    events = db.fetchall(
                        """
                        SELECT id, event_data
                        FROM job_events
                        WHERE job_id = %s AND id > %s
                        ORDER BY id ASC
                        LIMIT 10
                        """,
                        (job_id, sequence),
                    )

                    for ev in events:
                        sequence = ev["id"]
                        data = ev["event_data"]
                        yield f"id: {sequence}\ndata: {json.dumps(data)}\n\n"
                        if data.get("status") in ("done", "error"):
                            return

                    if not events:
                        yield ": keepalive\n\n"
                        time.sleep(1)
                    else:
                        time.sleep(0.1)

                yield f"data: {json.dumps({'status': 'timeout', 'message': 'Graph build timed out after 5 minutes'})}\n\n"

            except GeneratorExit:
                # Client disconnected — clean up and exit silently
                app.logger.debug(f"SSE client disconnected for job {job_id}")
                return

        return Response(
            stream_with_context(_event_stream()),
            mimetype="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
                "Connection": "keep-alive",
            },
        )

    @app.route("/api/graph/<paper_id>")
    @require_session
    def get_cached_graph(paper_id):
        """
        Return a previously built graph JSON from R2.
        Used by the gallery and for repeat visits.
        """
        row = db.fetchone(
            """
            SELECT graph_json_url FROM graphs
            WHERE seed_paper_id = %s
            AND computed_at > NOW() - INTERVAL '7 days'
            ORDER BY computed_at DESC LIMIT 1
            """,
            (paper_id,),
        )
        if not row:
            return jsonify({
                "error": "Graph not found. Use /api/graph/stream to build it."
            }), 404

        from backend.r2_client import R2Client
        r2 = R2Client()
        graph_data = r2.get_json(row["graph_json_url"])
        if not graph_data:
            return jsonify({"error": "Graph data not available in storage"}), 404

        return jsonify(graph_data)

    # ── Phase 3 helpers ───────────────────────────────────────────────────

    def _load_graph_for_request(paper_id: str, session_id: str):
        """
        Load a cached graph for the given paper_id and session_id.
        Returns (AncestryGraph, graph_row) or (None, None) if not found.
        The session_id check ensures users can only access their own graphs.
        """
        row = db.fetchone(
            """
            SELECT g.graph_id, g.graph_json_url, g.leaderboard_json,
                   g.dna_json, g.diversity_json
            FROM graphs g
            JOIN session_graphs sg ON sg.graph_id = g.graph_id
            WHERE g.seed_paper_id = %s AND sg.session_id = %s
            ORDER BY g.created_at DESC
            LIMIT 1
            """,
            (paper_id, session_id),
        )
        if not row:
            return None, None

        # Load graph JSON from R2
        if row.get("graph_json_url"):
            try:
                from backend.r2_client import R2Client
                r2 = R2Client()
                graph_json_data = r2.get_json(row["graph_json_url"])
            except Exception:
                return None, None
        else:
            return None, None

        if not graph_json_data:
            return None, None

        graph = AncestryGraph.from_json(graph_json_data)
        return graph, row

    # ── Phase 3 API routes ─────────────────────────────────────────────────

    # ─── POST /api/prune ──────────────────────────────────────────────────

    @app.route("/api/prune", methods=["POST"])
    @require_session
    def api_prune():
        """
        Compute pruning result for a list of paper_ids in a graph.
        Body: {"paper_ids": [...], "graph_seed_id": "..."}
        """
        session_id = g.session_id

        allowed, headers = await_sync(
            rate_limiter.check(session_id, "POST /api/prune")
        )
        if not allowed:
            return jsonify(rate_limiter.get_429_body(headers)), 429, headers

        data = request.get_json(silent=True) or {}
        paper_ids = data.get("paper_ids", [])
        graph_seed_id = data.get("graph_seed_id") or data.get("paper_id")

        if not paper_ids or not graph_seed_id:
            return jsonify({"error": "paper_ids and graph_seed_id required"}), 400
        if len(paper_ids) > 10:
            return jsonify({"error": "Maximum 10 papers per prune request"}), 400

        graph, _ = _load_graph_for_request(graph_seed_id, session_id)
        if graph is None:
            return jsonify({"error": "Graph not found. Build the graph first."}), 404

        try:
            result = compute_pruning_result(
                graph.graph, paper_ids, graph.nodes, graph.seed_paper_id
            )
            log_action(session_id, "prune", {
                "pruned_ids": paper_ids, "seed": graph_seed_id,
            })
            return jsonify(result.to_dict())
        except Exception as exc:
            app.logger.error(f"Pruning failed: {exc}", exc_info=True)
            return jsonify({"error": "Pruning computation failed"}), 500

    # ─── GET /api/dna/<paper_id> ──────────────────────────────────────────

    @app.route("/api/dna/<paper_id>")
    @require_session
    def api_dna(paper_id: str):
        """Return DNA profile for a previously built graph."""
        session_id = g.session_id

        _, row = _load_graph_for_request(paper_id, session_id)
        if row is None:
            return jsonify({"error": "Graph not found"}), 404

        # Use precomputed DNA if available
        dna_json = row.get("dna_json")
        if dna_json:
            return jsonify(
                dna_json if isinstance(dna_json, dict)
                else json.loads(dna_json)
            )

        # Compute on demand
        graph, _ = _load_graph_for_request(paper_id, session_id)
        if graph is None:
            return jsonify({"error": "Graph not found"}), 404

        profiler = DNAProfiler()
        paper_ids = list(graph.nodes.keys())
        dna = profiler.compute_profile(paper_ids, paper_id, graph.nodes)
        return jsonify(dna.to_dict())

    # ─── GET /api/diversity/<paper_id> ────────────────────────────────────

    @app.route("/api/diversity/<paper_id>")
    @require_session
    def api_diversity(paper_id: str):
        """Return diversity score for a previously built graph."""
        session_id = g.session_id

        _, row = _load_graph_for_request(paper_id, session_id)
        if row is None:
            return jsonify({"error": "Graph not found"}), 404

        # Use precomputed diversity if available
        diversity_json = row.get("diversity_json")
        if diversity_json:
            return jsonify(
                diversity_json if isinstance(diversity_json, dict)
                else json.loads(diversity_json)
            )

        # Compute on demand
        graph, _ = _load_graph_for_request(paper_id, session_id)
        if graph is None:
            return jsonify({"error": "Graph not found"}), 404

        paper_ids = list(graph.nodes.keys())
        profiler = DNAProfiler()
        dna = profiler.compute_profile(paper_ids, paper_id, graph.nodes)
        scorer = DiversityScorer()
        diversity = scorer.compute_score(paper_ids, graph.nodes, dna_profile=dna)
        return jsonify(diversity.to_dict())

    # ─── GET /api/orphans/<seed_id> ───────────────────────────────────────

    @app.route("/api/orphans/<seed_id>")
    @require_session
    def api_orphans(seed_id: str):
        """Return orphan ideas detected in the graph."""
        session_id = g.session_id

        graph, _ = _load_graph_for_request(seed_id, session_id)
        if graph is None:
            return jsonify({"error": "Graph not found"}), 404

        detector = OrphanDetector()
        paper_ids = list(graph.nodes.keys())
        orphans = detector.detect_orphans(paper_ids, graph.nodes, top_k=5)

        if not orphans:
            return jsonify({
                "orphans": [],
                "message": "No orphan ideas detected in this graph, or insufficient temporal data.",
            })

        return jsonify({"orphans": [o.to_dict() for o in orphans]})

    # ─── GET /api/gaps/<seed_id> ──────────────────────────────────────────

    @app.route("/api/gaps/<seed_id>")
    @require_session
    def api_gaps(seed_id: str):
        """Return research gap suggestions for a graph."""
        session_id = g.session_id

        graph, _ = _load_graph_for_request(seed_id, session_id)
        if graph is None:
            return jsonify({"error": "Graph not found"}), 404

        # Coverage score gating — gaps require rich text coverage
        coverage = getattr(graph, "data_completeness", None)
        coverage_score = (
            getattr(coverage, "coverage_score", 0.0) if coverage else 0.0
        )

        paper_ids = list(graph.nodes.keys())
        finder = GapFinder()
        gaps = finder.find_gaps(paper_ids, graph.nodes,
                                coverage_score=coverage_score)

        if not gaps:
            return jsonify({
                "gaps": [],
                "message": (
                    "Research gap detection requires 70%+ full-text coverage. "
                    f"Current coverage: {coverage_score:.0%}"
                ),
            })

        return jsonify({"gaps": gaps})

    # ─── GET /api/genealogy/<paper_id> ────────────────────────────────────

    @app.route("/api/genealogy/<paper_id>")
    @require_session
    def api_genealogy(paper_id: str):
        """Return LLM-generated genealogy story for a graph."""
        session_id = g.session_id

        graph, _ = _load_graph_for_request(paper_id, session_id)
        if graph is None:
            return jsonify({"error": "Graph not found"}), 404

        llm = get_llm_client()
        if not llm.available:
            return jsonify({"narrative": None, "error": "LLM not configured"})

        graph_json = graph.export_to_json()

        try:
            result = llm.generate_genealogy_story(graph_json)
            return jsonify(result)
        except Exception as exc:
            app.logger.error(f"Genealogy generation failed: {exc}")
            return jsonify({"narrative": None, "error": "Generation failed"}), 500

    # ─── POST /api/chat ──────────────────────────────────────────────────

    @app.route("/api/chat", methods=["POST"])
    @require_session
    def api_chat():
        """AI guide chat endpoint."""
        session_id = g.session_id

        allowed, headers = await_sync(
            rate_limiter.check(session_id, "POST /api/chat")
        )
        if not allowed:
            return jsonify(rate_limiter.get_429_body(headers)), 429, headers

        data = request.get_json(silent=True) or {}
        user_message = data.get("message", "")
        graph_summary = data.get("graph_summary", {})
        current_view = data.get("current_view", "overview")

        guide = ChatGuide()
        try:
            result = guide.respond(user_message, graph_summary,
                                   current_view, session_id)
            return jsonify(result)
        except Exception as exc:
            app.logger.error(f"Chat guide failed: {exc}")
            return jsonify({
                "response": "An error occurred. Please try again.",
                "status": "error",
            }), 500

    # ─── GET /api/insights/<paper_id> ─────────────────────────────────────

    @app.route("/api/insights/<paper_id>")
    @require_session
    def api_insights(paper_id: str):
        """Return insight feed items for a graph."""
        row = db.fetchone(
            "SELECT insights_json FROM insight_cache WHERE paper_id = %s",
            (paper_id,),
        )
        if not row or not row.get("insights_json"):
            return jsonify({"insights": []})

        cached = row["insights_json"]
        items = (
            cached if isinstance(cached, list)
            else json.loads(cached) if isinstance(cached, str)
            else []
        )
        return jsonify({"insights": items[:10]})

    # ─── POST /api/insight-feedback ──────────────────────────────────────

    @app.route("/api/insight-feedback", methods=["POST"])
    @require_session
    def api_insight_feedback():
        """Thumbs up/down on an insight card."""
        session_id = g.session_id
        data = request.get_json(silent=True) or {}
        insight_id = data.get("insight_id")
        vote = data.get("vote")  # "up" or "down"

        if not insight_id or vote not in ("up", "down"):
            return jsonify({"error": "insight_id and vote ('up'/'down') required"}), 400

        feedback_val = "helpful" if vote == "up" else "not_helpful"
        db.execute(
            """
            INSERT INTO insight_feedback (session_id, insight_id, feedback, created_at)
            VALUES (%s, %s, %s, NOW())
            """,
            (session_id, insight_id, feedback_val),
        )
        return jsonify({"status": "ok"})

    # ─── POST /api/flag-edge ─────────────────────────────────────────────

    @app.route("/api/flag-edge", methods=["POST"])
    @require_session
    def api_flag_edge():
        """User flags an incorrect inheritance edge classification."""
        session_id = g.session_id
        data = request.get_json(silent=True) or {}
        citing_id = data.get("citing_paper_id")
        cited_id = data.get("cited_paper_id")

        if not citing_id or not cited_id:
            return jsonify({"error": "citing_paper_id and cited_paper_id required"}), 400

        edge_id = f"{citing_id}:{cited_id}"
        db.execute(
            """
            INSERT INTO edge_feedback (edge_id, session_id, feedback_type, feedback_detail)
            VALUES (%s, %s, 'incorrect_classification', %s)
            """,
            (edge_id, session_id, f"Flagged by user: {citing_id} → {cited_id}"),
        )
        return jsonify({"status": "flagged", "message": "Thank you for the feedback."})

    # ─── GET /api/quality ────────────────────────────────────────────────

    @app.route("/api/quality")
    def api_quality():
        """
        Returns production quality metrics for the most recently built graph
        in this session. Used for internal monitoring.
        """
        session_id = session_manager.get_session_id(request)
        if not session_id:
            return jsonify({"error": "Session required"}), 401

        from backend.db import fetchone
        row = fetchone(
            """
            SELECT g.graph_id, g.graph_json_url
            FROM graphs g
            JOIN session_graphs sg ON sg.graph_id = g.graph_id
            WHERE sg.session_id = %s
            ORDER BY g.created_at DESC
            LIMIT 1
            """,
            (session_id,),
        )
        if not row:
            return jsonify({"quality_score": None, "message": "No graph built yet"}), 200

        try:
            from backend.r2_client import R2Client
            from backend.quality_monitor import ProductionQualityMonitor

            r2 = R2Client()
            graph_json = r2.download_json(row["graph_json_url"])
            if not graph_json:
                return jsonify({"quality_score": None, "message": "Graph data not found in R2"}), 200
            monitor = ProductionQualityMonitor()
            result = monitor.analyze_graph_quality(graph_json)
            result["graph_id"] = row["graph_id"]
            return jsonify(result)
        except Exception as exc:
            app.logger.warning(f"Quality monitor failed: {exc}")
            return jsonify({"quality_score": None, "error": "Quality analysis unavailable"}), 200

    # ── Phase 3+4 page routes ─────────────────────────────────────────────

    @app.route("/")
    def index():
        """Landing page."""
        return render_template("index.html")

    @app.route("/tool")
    def tool():
        """Main tool page — requires paper_id query param."""
        paper_id = request.args.get("paper_id", "")
        return render_template("tool.html", paper_id=paper_id)

    @app.route("/explore")
    def explore():
        """Gallery page showing precomputed graphs."""
        return render_template("explore.html")

    @app.route("/explore/<slug>")
    def explore_slug(slug: str):
        """Gallery entry page — loads precomputed graph directly."""
        VALID_SLUGS = {"attention", "alexnet", "bert", "gans",
                       "word2vec", "resnet", "gpt2"}
        if slug not in VALID_SLUGS:
            return render_template("explore.html"), 404
        return render_template("tool.html", paper_id=slug, is_gallery=True)

    # ── R2 preview proxy routes ────────────────────────────────────────────

    @app.route("/static/previews/<slug>/graph.json")
    def gallery_graph_json(slug: str):
        """Proxy precomputed graph JSON from R2 for gallery entries."""
        VALID_SLUGS = {"attention", "alexnet", "bert", "gans",
                       "word2vec", "resnet", "gpt2"}
        if slug not in VALID_SLUGS:
            return jsonify({"error": "Not found"}), 404
        try:
            from backend.r2_client import R2Client
            r2 = R2Client()
            data = r2.get_json(f"precomputed/{slug}/graph.json")
            if data is None:
                # Fallback: try loading from local precomputed files
                local_data = load_precomputed_graph(slug)
                if local_data:
                    return Response(
                        json.dumps(local_data),
                        mimetype="application/json",
                        headers={"Cache-Control": "public, max-age=3600"},
                    )
                return jsonify({"error": "Preview not yet computed. Run precompute_gallery.py."}), 404
            return Response(
                json.dumps(data) if isinstance(data, dict) else data,
                mimetype="application/json",
                headers={"Cache-Control": "public, max-age=3600"},
            )
        except Exception:
            # Fallback to local files
            local_data = load_precomputed_graph(slug)
            if local_data:
                return Response(
                    json.dumps(local_data),
                    mimetype="application/json",
                    headers={"Cache-Control": "public, max-age=3600"},
                )
            return jsonify({"error": "Preview not yet computed. Run precompute_gallery.py."}), 404

    @app.route("/static/previews/<slug>.svg")
    def gallery_preview_svg(slug: str):
        """Proxy precomputed SVG preview from R2 for gallery cards."""
        VALID_SLUGS = {"attention", "alexnet", "bert", "gans",
                       "word2vec", "resnet", "gpt2"}
        if slug not in VALID_SLUGS:
            return "", 404
        try:
            from backend.r2_client import R2Client
            r2 = R2Client()
            svg_data = r2.get(f"precomputed/{slug}/preview.svg")
            if svg_data is None:
                return "", 404
            return Response(
                svg_data,
                mimetype="image/svg+xml",
                headers={"Cache-Control": "public, max-age=86400"},
            )
        except Exception:
            return "", 404

    # ── Gallery index route (Phase 4) ─────────────────────────────────────

    @app.route("/static/gallery_index.json")
    def gallery_index_json():
        """
        Serve data/gallery_index.json for the explore page stats overlay.
        explore.html fetches this to update hardcoded placeholder numbers
        with real precomputed stats after precompute_gallery.py runs.
        """
        import pathlib
        path = pathlib.Path("data/gallery_index.json")
        if not path.exists():
            return jsonify([]), 404
        return app.response_class(
            response=path.read_text(encoding="utf-8"),
            mimetype="application/json",
            headers={"Cache-Control": "public, max-age=300"},
        )

    # ── Phase 5 routes ───────────────────────────────────────────────────────

    # ─── POST /api/export/<export_type> ──────────────────────────────────────

    @app.route("/api/export/<export_type>", methods=["POST"])
    def api_export(export_type: str):
        """
        Generate a downloadable export of the current graph.
        Body (optional): {"extra": {"svg_data": "..."}}
        Response: {"url": "https://...", "filename": "arivu_graph.json", "expires_in": 3600}
        """
        session_id = session_manager.get_session_id(request)
        if not session_id:
            return jsonify({"error": "Session required"}), 401

        allowed, headers = rate_limiter.check_sync(session_id, "POST /api/export")
        if not allowed:
            return jsonify(rate_limiter.get_429_response(headers)), 429, headers

        if export_type not in ExportGenerator.EXPORT_TYPES:
            return jsonify({
                "error": f"Unknown export type {export_type!r}. "
                         f"Allowed: {ExportGenerator.EXPORT_TYPES}"
            }), 400

        from backend.db import fetchone
        row = fetchone(
            """
            SELECT g.graph_id, g.graph_json_url
            FROM graphs g
            JOIN session_graphs sg ON sg.graph_id = g.graph_id
            WHERE sg.session_id = %s
            ORDER BY g.created_at DESC LIMIT 1
            """,
            (session_id,),
        )
        if not row:
            return jsonify({"error": "No graph built yet in this session"}), 404

        try:
            from backend.r2_client import R2Client
            r2         = R2Client()
            graph_data = r2.download_json(row["graph_json_url"])
            if not graph_data:
                return jsonify({"error": "Graph data not found in R2"}), 404
        except Exception as exc:
            app.logger.warning(f"R2 graph fetch failed: {exc}")
            return jsonify({"error": "Could not load graph data"}), 500

        body       = request.get_json(silent=True) or {}
        extra      = body.get("extra", {})
        llm_client = None
        try:
            from backend.llm_client import ArivuLLMClient
            llm_client = ArivuLLMClient()
        except Exception:
            pass

        try:
            gen = ExportGenerator()
            url = gen.generate(
                export_type=export_type,
                graph_data=graph_data,
                session_id=session_id,
                llm_client=llm_client,
                extra=extra,
            )
            filename = url.split("/")[-1].split("?")[0]
            return jsonify({"url": url, "filename": filename, "expires_in": 3600})
        except RuntimeError as exc:
            return jsonify({"error": str(exc)}), 503
        except Exception as exc:
            app.logger.error(f"Export generation failed: {exc}")
            return jsonify({"error": "Export generation failed"}), 500

    # ─── GET /api/living-score/<paper_id> ────────────────────────────────────

    @app.route("/api/living-score/<paper_id>")
    def api_living_score(paper_id: str):
        """
        Compute living score for a single paper within the session's current graph.
        Response: {"score": 72.3, "trajectory": "rising", "recent_citations": 15, ...}
        """
        session_id = session_manager.get_session_id(request)
        if not session_id:
            return jsonify({"error": "Session required"}), 401

        allowed, headers = rate_limiter.check_sync(session_id, "GET /api/living-score")
        if not allowed:
            return jsonify(rate_limiter.get_429_response(headers)), 429, headers

        from backend.db import fetchone
        from backend.r2_client import R2Client
        row = fetchone(
            """
            SELECT g.graph_json_url FROM graphs g
            JOIN session_graphs sg ON sg.graph_id = g.graph_id
            WHERE sg.session_id = %s ORDER BY g.created_at DESC LIMIT 1
            """,
            (session_id,),
        )
        if not row:
            return jsonify({"error": "No graph built yet"}), 404

        try:
            graph_data = R2Client().download_json(row["graph_json_url"])
        except Exception:
            return jsonify({"error": "Could not load graph"}), 500

        scorer = LivingPaperScorer()
        result = scorer.score_single(paper_id, graph_data)
        if result is None:
            return jsonify({"error": f"Paper {paper_id} not found in current graph"}), 404
        return jsonify(result.to_dict())

    # ─── GET /api/originality/<paper_id> ─────────────────────────────────────

    @app.route("/api/originality/<paper_id>")
    def api_originality(paper_id: str):
        """
        Classify contribution type of a paper within the session's current graph.
        Response: {"contribution_type": "Pioneer", "score": 0.81, "confidence": "high", ...}
        """
        session_id = session_manager.get_session_id(request)
        if not session_id:
            return jsonify({"error": "Session required"}), 401

        allowed, headers = rate_limiter.check_sync(session_id, "GET /api/originality")
        if not allowed:
            return jsonify(rate_limiter.get_429_response(headers)), 429, headers

        from backend.db import fetchone
        from backend.r2_client import R2Client
        row = fetchone(
            """
            SELECT g.graph_json_url FROM graphs g
            JOIN session_graphs sg ON sg.graph_id = g.graph_id
            WHERE sg.session_id = %s ORDER BY g.created_at DESC LIMIT 1
            """,
            (session_id,),
        )
        if not row:
            return jsonify({"error": "No graph built yet"}), 404

        try:
            graph_data = R2Client().download_json(row["graph_json_url"])
        except Exception:
            return jsonify({"error": "Could not load graph"}), 500

        mapper = OriginalityMapper()
        result = mapper.compute_originality(paper_id, graph_data)
        if result is None:
            return jsonify({"error": f"Paper {paper_id} not found in current graph"}), 404
        return jsonify(result.to_dict())

    # ─── GET /api/paradigm/<seed_id> ─────────────────────────────────────────

    @app.route("/api/paradigm/<seed_id>")
    def api_paradigm(seed_id: str):
        """
        Analyse paradigm shift signals for a graph seeded by seed_id.
        Response: {"stability_score": 72.1, "alert": false, "signals": [...], ...}
        """
        session_id = session_manager.get_session_id(request)
        if not session_id:
            return jsonify({"error": "Session required"}), 401

        allowed, headers = rate_limiter.check_sync(session_id, "GET /api/paradigm")
        if not allowed:
            return jsonify(rate_limiter.get_429_response(headers)), 429, headers

        from backend.db import fetchone
        from backend.r2_client import R2Client
        row = fetchone(
            """
            SELECT g.graph_json_url, g.coverage_score FROM graphs g
            JOIN session_graphs sg ON sg.graph_id = g.graph_id
            WHERE sg.session_id = %s AND g.seed_paper_id = %s
            ORDER BY g.created_at DESC LIMIT 1
            """,
            (session_id, seed_id),
        )
        if not row:
            return jsonify({"error": "No graph found for this seed paper"}), 404

        try:
            graph_data = R2Client().download_json(row["graph_json_url"])
        except Exception:
            return jsonify({"error": "Could not load graph"}), 500

        detector = ParadigmShiftDetector()
        result   = detector.detect(
            graph_json=graph_data,
            coverage_score=float(row.get("coverage_score") or 0.0),
        )
        return jsonify(result.to_dict())

    app.logger.info("Arivu Phase 5 app ready")
    return app


def _paper_to_dict(paper) -> dict:
    """Convert a Paper dataclass to a JSON-safe dict for API responses."""
    return {
        "paper_id":       paper.paper_id,
        "title":          paper.title,
        "abstract":       (paper.abstract or "")[:500],
        "year":           paper.year,
        "citation_count": paper.citation_count,
        "authors":        paper.authors[:5],
        "doi":            paper.doi,
        "url":            paper.url,
        "fields_of_study": paper.fields_of_study,
        "text_tier":      paper.text_tier,
    }


if __name__ == "__main__":
    application = create_app()
    application.run(
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 5000)),
        debug=Config.DEBUG,
    )
