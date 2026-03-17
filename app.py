"""
app.py — Arivu Flask application factory and routes.
"""
import json
import logging
import os
import time
import uuid
import threading
from threading import Thread
from typing import Optional

from flask import Flask, Response, g, jsonify, make_response, render_template, request, stream_with_context
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

# Phase 6 imports
from backend.auth import auth_bp
# billing.py DORMANT — import removed. See DECISIONS.md ADR-016.
from backend.decorators import (require_auth, get_current_user)
from backend.gdpr import generate_user_data_export, delete_user_account
from backend.independent_discovery import IndependentDiscoveryTracker
from backend.citation_shadow import CitationShadowDetector
from backend.field_fingerprint import FieldFingerprintAnalyzer
from backend.serendipity_engine import SerendipityEngine

# Phase 7 imports
from backend.public_api import public_api as api_v1
from backend.time_machine import TimeMachineEngine
from backend.counterfactual_engine import CounterfactualEngine
from backend.adversarial_reviewer import AdversarialReviewer
from backend.citation_audit import CitationAudit
from backend.citation_generator import CitationGenerator
from backend.reading_prioritizer import ReadingPrioritizer
from backend.paper_positioning import PaperPositioningTool
from backend.rewrite_suggester import RewriteSuggester
from backend.persona_engine import PersonaEngine
from backend.insight_engine import InsightEngine
from backend.lab_manager import LabManager
from backend.secure_upload import SecureFileUploadHandler
from backend.webhook_manager import WebhookManager

# Phase 8 imports
from backend.cross_domain_spark import CrossDomainSparkDetector
from backend.error_propagation import ErrorPropagationTracker
from backend.reading_between_lines import ReadingBetweenLines
from backend.intellectual_debt import IntellectualDebtTracker
from backend.challenge_generator import ChallengeGenerator
from backend.idea_credit import IdeaCreditSystem
from backend.researcher_profiles import ResearcherProfileBuilder
from backend.literature_review_engine import LiteratureReviewEngine
from backend.field_entry_kit import FieldEntryKit
from backend.research_risk_analyzer import ResearchRiskAnalyzer
from backend.science_journalism import ScienceJournalismLayer
from backend.live_mode import LiveModeManager
from backend.interdisciplinary_translation import InterdisciplinaryTranslator
from backend.graph_memory import GraphMemoryManager

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
_NLP_HEALTH_LOCK = threading.Lock()


def _nlp_worker_reachable() -> bool:
    """Check NLP worker /health. Cached for _NLP_HEALTH_TTL seconds. Never raises."""
    import requests as _req
    now = time.monotonic()
    with _NLP_HEALTH_LOCK:
        if now - _NLP_HEALTH["checked_at"] < _NLP_HEALTH_TTL:
            return _NLP_HEALTH["ok"]
        # Optimistically claim the slot so other threads see fresh checked_at
        _NLP_HEALTH["checked_at"] = now
    try:
        resp = _req.get(f"{Config.NLP_WORKER_URL}/health", timeout=3)
        result = resp.status_code == 200
    except Exception:
        result = False
    with _NLP_HEALTH_LOCK:
        _NLP_HEALTH["ok"] = result
        _NLP_HEALTH["checked_at"] = time.monotonic()
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

    # ── Ensure partial unique index for build dedup ──────────────────────
    # Prevents duplicate pending builds for the same paper.  Safe to run
    # repeatedly because of IF NOT EXISTS.
    try:
        db.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS build_jobs_paper_pending_uniq
            ON build_jobs (paper_id)
            WHERE status = 'pending'
            """,
            (),
        )
    except Exception as e:
        app.logger.warning(f"Build dedup index creation failed (non-fatal): {e}")

    # ── Zombie build job cleanup ─────────────────────────────────────────
    # On serverless platforms (Koyeb free tier), instance recycling kills
    # background build threads but leaves build_jobs rows as 'pending'
    # forever in the DB.  New requests for the same paper then latch onto
    # the dead job via the reconnection guard and poll job_events forever.
    # Fix: on startup, mark all stale pending jobs as 'timed_out'.
    #
    # Threshold is 12 minutes (not 10) to avoid killing live builds from
    # the OLD instance during a rolling deploy — the SSE deadline is
    # 10 minutes, so any build that is 12+ minutes old has either finished
    # or been timed out by the SSE handler already.
    try:
        cleaned = db.execute(
            """
            UPDATE build_jobs
            SET status = 'timed_out'
            WHERE status = 'pending'
              AND created_at < NOW() - INTERVAL '12 minutes'
            """,
            (),
        )
        if cleaned:
            app.logger.info(
                f"Cleaned up {cleaned} zombie pending build jobs on startup"
            )
    except Exception as e:
        app.logger.warning(f"Zombie job cleanup failed (non-fatal): {e}")

    # Phase 6: Register auth blueprint
    app.register_blueprint(auth_bp)

    # Phase 7: Register public API v1 blueprint
    app.register_blueprint(api_v1)

    # Phase 6: Initialize Resend once at startup
    from backend.mailer import _init_resend
    _init_resend()

    # Phase 6: Inject current user into all templates
    @app.before_request
    def _inject_user():
        from backend.decorators import get_current_user
        g.user = get_current_user() if Config.ENABLE_AUTH else None

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

        allowed, headers = rate_limiter.check_sync(g.session_id, "POST /api/search")
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

        # NOTE: Rate limiting is applied AFTER cache check (below) to avoid
        # consuming build quota (3/hour) on cached graph hits. The rate limit
        # is only enforced before starting a fresh build.

        # Check for recently cached graph (within GRAPH_CACHE_TTL_DAYS)
        # SESSION-INDEPENDENT: looks up by seed_paper_id directly, without
        # requiring the graph to be linked to the current session. This means
        # a graph built in session A is visible to session B.
        # We link the current session afterward so history tracking still works.
        #
        # DOI matching is only used when the input looks like a DOI/arXiv ID,
        # to avoid false matches when paper_id is a title string.
        from backend.normalizer import ID_TYPE_DOI, ID_TYPE_ARXIV
        cache_ttl_days = Config.GRAPH_CACHE_TTL_DAYS  # default 7, configurable via env
        if id_type in (ID_TYPE_DOI, ID_TYPE_ARXIV):
            # Input is a DOI-like identifier — match by paper_id OR doi
            cached_graph = db.fetchone(
                """
                SELECT g.graph_id, g.graph_json_url
                FROM graphs g
                WHERE g.seed_paper_id IN (
                    SELECT paper_id FROM papers
                    WHERE paper_id = %s OR doi = %s
                  )
                  AND g.computed_at > NOW() - make_interval(days => %s)
                ORDER BY g.computed_at DESC
                LIMIT 1
                """,
                (paper_id, paper_id, cache_ttl_days),
            )
        else:
            # Input is an S2 ID, title, or other — match by paper_id only
            cached_graph = db.fetchone(
                """
                SELECT g.graph_id, g.graph_json_url
                FROM graphs g
                WHERE g.seed_paper_id = %s
                  AND g.computed_at > NOW() - make_interval(days => %s)
                ORDER BY g.computed_at DESC
                LIMIT 1
                """,
                (paper_id, cache_ttl_days),
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
                # Link this session to the cached graph (for history tracking)
                try:
                    db.execute(
                        """
                        INSERT INTO session_graphs (session_id, graph_id, created_at)
                        VALUES (%s, %s, NOW())
                        ON CONFLICT (session_id, graph_id) DO NOTHING
                        """,
                        (session_id, cached_graph["graph_id"]),
                    )
                except Exception:
                    pass  # Non-fatal: graph still loads even if session link fails

                # Attach panel data (DNA, diversity, leaderboard) from DB.
                # R2 stores the raw graph JSON before panel data is computed,
                # so cached graphs need this enrichment step.
                try:
                    panel_row = db.fetchone(
                        "SELECT leaderboard_json, dna_json, diversity_json FROM graphs WHERE graph_id = %s",
                        (cached_graph["graph_id"],),
                    )
                    if panel_row:
                        if panel_row.get("leaderboard_json"):
                            lb = panel_row["leaderboard_json"]
                            graph_data["leaderboard"] = lb if isinstance(lb, list) else json.loads(lb)
                        if panel_row.get("dna_json"):
                            dna = panel_row["dna_json"]
                            graph_data["dna_profile"] = dna if isinstance(dna, dict) else json.loads(dna)
                        if panel_row.get("diversity_json"):
                            div = panel_row["diversity_json"]
                            graph_data["diversity_score"] = div if isinstance(div, dict) else json.loads(div)
                except Exception as exc:
                    logger.warning(f"Failed to attach panel data to cached graph: {exc}")

                # Update last_accessed for TTL tracking
                try:
                    db.execute(
                        "UPDATE graphs SET last_accessed = NOW() WHERE graph_id = %s",
                        (cached_graph["graph_id"],),
                    )
                except Exception:
                    pass

                def _cached_stream():
                    payload = {"status": "done", "cached": True, "graph": graph_data}
                    yield f"data: {json.dumps(payload)}\n\n"

                return Response(
                    stream_with_context(_cached_stream()),
                    mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
                )

        # ── Reconnection guard: reuse existing in-progress build ──────────
        # When EventSource reconnects (Koyeb timeout, network blip, page reload),
        # reuse the existing build thread instead of spawning a duplicate.
        # SESSION-INDEPENDENT: match by paper_id across ALL sessions — a build
        # started by session A can be reused by session B for the same paper.
        #
        # LIVENESS CHECK: A pending job is only "alive" if it has produced a
        # job_event within the last 600 seconds.  On Koyeb free tier, instance
        # recycling kills daemon build threads silently — without a liveness
        # check, new requests latch onto the dead job and poll forever.
        #
        # 1200s window: On Koyeb's 0.1 vCPU free tier, full builds take 12-15
        # minutes.  The NLP pipeline can go 3-5 minutes between progress events.
        # Combined with Koyeb's ~300s proxy timeout, we need a wide window.
        #
        # DOI-AWARE: build_jobs.paper_id may store either a raw DOI or an
        # S2 paper ID (depending on what the user submitted).  We check both
        # the raw paper_id AND any DOI → S2 mapping from the papers table
        # to avoid duplicate builds for the same paper with different IDs.
        existing_job = db.fetchone(
            """
            SELECT bj.job_id
            FROM build_jobs bj
            WHERE (bj.paper_id = %s OR bj.paper_id IN (
                      SELECT paper_id FROM papers WHERE doi = %s LIMIT 1
                  ))
              AND bj.status = 'pending'
              AND bj.created_at > NOW() - INTERVAL '12 minutes'
              AND EXISTS (
                  SELECT 1 FROM job_events je
                  WHERE je.job_id = bj.job_id
                    AND je.created_at > NOW() - INTERVAL '2400 seconds'
              )
            ORDER BY bj.created_at DESC
            LIMIT 1
            """,
            (paper_id[:200], paper_id[:200]),
        )

        # Fallback: any pending job < 12 min old for this paper — the build
        # thread is likely still running even if events are sparse.  On Koyeb
        # free tier, depth-2 BFS takes 4+ min and NLP takes another 3-5 min,
        # so builds regularly exceed 5 minutes total.
        if not existing_job:
            existing_job = db.fetchone(
                """
                SELECT job_id FROM build_jobs
                WHERE (paper_id = %s OR paper_id IN (
                          SELECT paper_id FROM papers WHERE doi = %s LIMIT 1
                      ))
                  AND status = 'pending'
                  AND created_at > NOW() - INTERVAL '12 minutes'
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (paper_id[:200], paper_id[:200]),
            )

        _start_thread = False  # Only True if WE create a new build job below
        _resurrect_thread = False  # True if we need to restart a dead build thread

        if existing_job:
            # Existing build is alive — just poll its events (no rate limit consumed)
            job_id = existing_job["job_id"]
            # Check if the build thread is actually alive by looking at recent events.
            # If the gunicorn worker was killed (SIGKILL), daemon threads die with it.
            # The job stays 'pending' but no thread is producing events.
            last_event = db.fetchone(
                "SELECT created_at FROM job_events WHERE job_id = %s ORDER BY id DESC LIMIT 1",
                (job_id,),
            )
            if last_event:
                import datetime
                event_age = (datetime.datetime.now(datetime.timezone.utc) - last_event["created_at"].replace(tzinfo=datetime.timezone.utc)).total_seconds()
                if event_age > 90:
                    # No events in 90s — build thread is likely dead, resurrect it
                    logger.warning(f"SSE reconnect: build job {job_id} has stale events ({event_age:.0f}s old) — resurrecting build thread")
                    _resurrect_thread = True
                else:
                    logger.info(f"SSE reconnect: reusing LIVE build job {job_id} for {paper_id[:20]}… (last event {event_age:.0f}s ago)")
            else:
                # No events at all — very fresh job or thread died before first event
                logger.info(f"SSE reconnect: reusing build job {job_id} for {paper_id[:20]}… (no events yet)")
        else:
            # Fresh build required — apply rate limit NOW (not for cache hits or reconnects)
            allowed, headers = rate_limiter.check_sync(session_id, "GET /api/graph/stream")
            if not allowed:
                # Return rate limit as SSE event — EventSource rejects non-SSE
                # responses (JSON 429) with immediate CLOSED, causing silent retry loops.
                def _rate_limit_stream():
                    yield f"data: {json.dumps({'status': 'error', 'message': 'Too many graph builds. Please wait a minute before trying again.', 'retry': False})}\n\n"
                return Response(
                    stream_with_context(_rate_limit_stream()),
                    mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
                )

            # No existing build — create new job and start background thread.
            # Dedup: use INSERT...SELECT WHERE NOT EXISTS to avoid duplicates
            # when two requests arrive within milliseconds.  This runs as a
            # single SQL statement (atomic within its transaction).
            job_id = str(uuid.uuid4())
            _start_thread = True  # Only start a build thread if WE created the job

            try:
                created = db.execute(
                    """
                    INSERT INTO build_jobs (job_id, paper_id, session_id, status, created_at)
                    SELECT %s, %s, %s, 'pending', NOW()
                    WHERE NOT EXISTS (
                        SELECT 1 FROM build_jobs
                        WHERE (paper_id = %s OR paper_id IN (
                                  SELECT paper_id FROM papers WHERE doi = %s LIMIT 1
                              ))
                          AND status = 'pending'
                          AND created_at > NOW() - INTERVAL '12 minutes'
                    )
                    """,
                    (job_id, paper_id[:200], session_id, paper_id[:200], paper_id[:200]),
                )
            except Exception as e:
                logger.warning(f"build_jobs INSERT failed (treating as dedup): {e}")
                created = 0  # Treat DB error as if another request won the race

            if created != 1:
                # Another request already created a job — find and reuse it
                _start_thread = False
                recheck = db.fetchone(
                    """
                    SELECT job_id FROM build_jobs
                    WHERE (paper_id = %s OR paper_id IN (
                              SELECT paper_id FROM papers WHERE doi = %s LIMIT 1
                          ))
                      AND status = 'pending'
                      AND created_at > NOW() - INTERVAL '12 minutes'
                    ORDER BY created_at DESC LIMIT 1
                    """,
                    (paper_id[:200], paper_id[:200]),
                )
                if recheck:
                    job_id = recheck["job_id"]
                    logger.info(f"SSE dedup: reusing existing job {job_id}")
                else:
                    # Edge case: the other job finished/errored between our
                    # INSERT check and this SELECT.  Create our own.
                    # Use ON CONFLICT to handle the race condition where a
                    # pending job exists but our time-window queries missed it
                    # (e.g. created_at is just outside the 12-minute window).
                    _start_thread = True
                    try:
                        db.execute(
                            """
                            INSERT INTO build_jobs (job_id, paper_id, session_id, status, created_at)
                            VALUES (%s, %s, %s, 'pending', NOW())
                            """,
                            (job_id, paper_id[:200], session_id),
                        )
                    except Exception as insert_err:
                        # UniqueViolation means a pending job exists — find and reuse it.
                        # Time-window: 12 min matches all other queries. Without this,
                        # ancient stuck 'pending' jobs cause infinite stall loops.
                        logger.warning(f"build_jobs fallback INSERT failed (reusing existing): {insert_err}")
                        _start_thread = False
                        fallback_job = db.fetchone(
                            """
                            SELECT job_id FROM build_jobs
                            WHERE (paper_id = %s OR paper_id IN (
                                      SELECT paper_id FROM papers WHERE doi = %s LIMIT 1
                                  ))
                              AND status = 'pending'
                              AND created_at > NOW() - INTERVAL '12 minutes'
                            ORDER BY created_at DESC LIMIT 1
                            """,
                            (paper_id[:200], paper_id[:200]),
                        )
                        if fallback_job:
                            job_id = fallback_job["job_id"]
                            logger.info(f"SSE fallback dedup: reusing job {job_id}")
                        else:
                            # No valid pending job found — emit error to client
                            logger.error(f"No reusable build job found for {paper_id[:20]}; unique constraint blocked INSERT but no pending job exists")
                            def _no_job_stream():
                                yield f"data: {json.dumps({'status': 'error', 'message': 'Build conflict — please try again.', 'retry': True})}\n\n"
                            return Response(
                                stream_with_context(_no_job_stream()),
                                mimetype="text/event-stream",
                                headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
                            )

            # Extract user info BEFORE spawning background thread
            # (Flask request context is unavailable in background threads)
            _pre_user = get_current_user() if Config.ENABLE_AUTH else None

            def _background_build():
                engine = AncestryGraph()
                try:
                    await_sync(engine.build_graph(paper_id, user_goal, job_id))
                    db.execute(
                        "UPDATE build_jobs SET status = 'done' WHERE job_id = %s",
                        (job_id,),
                    )
                    # Link graph to authenticated user (enables persistent history)
                    if _pre_user:
                        try:
                            _built_graph = db.fetchone(
                                "SELECT graph_id FROM graphs WHERE seed_paper_id = %s "
                                "ORDER BY created_at DESC LIMIT 1",
                                (paper_id,),
                            )
                            if _built_graph:
                                db.execute(
                                    "UPDATE graphs SET user_id = %s::uuid WHERE graph_id = %s",
                                    (str(_pre_user["user_id"]), _built_graph["graph_id"]),
                                )
                        except Exception as ue:
                            logger.warning(f"Failed to link graph to user: {ue}")
                except Exception as e:
                    logger.error(f"Background build failed for job {job_id}: {e}", exc_info=True)
                    db.execute(
                        """
                        INSERT INTO job_events (job_id, sequence, event_data, created_at)
                        VALUES (%s,
                                COALESCE((SELECT MAX(sequence) FROM job_events WHERE job_id = %s), 0) + 1,
                                %s::jsonb, NOW())
                        """,
                        (job_id, job_id, json.dumps({"status": "error", "message": str(e)[:500]})),
                    )
                    db.execute(
                        "UPDATE build_jobs SET status = 'error' WHERE job_id = %s",
                        (job_id,),
                    )

            # Only start a build thread if WE created the job (not reused from lock race)
            # OR if we detected the original thread died (worker killed by gunicorn)
            if _start_thread or _resurrect_thread:
                thread = Thread(target=_background_build, daemon=True)
                thread.start()
                if _resurrect_thread:
                    logger.info(f"Resurrected build thread for job {job_id}")
                    log_action(session_id, "graph_build_resurrect", {"paper_id": paper_id, "job_id": job_id})
                else:
                    log_action(session_id, "graph_build_start", {"paper_id": paper_id, "goal": user_goal})

        # Stream events from job_events as background thread writes them
        last_id_header = request.headers.get("Last-Event-ID", "0")

        def _event_stream():
            """
            Poll job_events and yield SSE frames.

            Flask's stream_with_context() raises GeneratorExit when the client
            disconnects; we catch it to log and exit cleanly.

            STALL DETECTION: If no new events appear for 1100 seconds while
            the build_job is still 'pending', the background thread is dead
            (Koyeb instance recycled).  We mark it timed_out and tell the
            client to retry.

            Why 1100s stall limit: The reconnection guard uses a 1200s liveness
            window. The stall limit MUST be >= the liveness window minus some
            buffer. On Koyeb 0.1 vCPU, builds take 12-15 minutes total.
            """
            sequence = int(last_id_header) if last_id_header.isdigit() else 0
            deadline = time.time() + 2400   # 40-minute overall timeout (Koyeb 0.1 vCPU builds take 20-25 min with 500+ LLM batches)
            last_event_time = time.time()   # Track when we last got a real event
            stall_limit = 2200              # 36+ minutes without events = dead thread
            last_job_check_time = 0.0       # Rate-limit missed-done DB queries to every 15s

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
                        last_event_time = time.time()  # Reset stall timer
                        data = ev["event_data"]
                        # Guard: psycopg2 may return JSONB as string or dict
                        if isinstance(data, str):
                            try:
                                data = json.loads(data)
                            except (json.JSONDecodeError, TypeError):
                                data = {"status": "error", "message": "Malformed event data"}
                        yield f"id: {sequence}\ndata: {json.dumps(data)}\n\n"
                        if isinstance(data, dict) and data.get("status") in ("done", "error"):
                            return

                    if not events:
                        # ── Stall detection ──────────────────────────────────
                        # Check build job status to detect both stalls AND
                        # completed builds where the 'done' event was missed
                        # (e.g. _emit DB write failed silently).
                        if time.time() - last_event_time > stall_limit:
                            job_status = db.fetchone(
                                "SELECT status FROM build_jobs WHERE job_id = %s",
                                (job_id,),
                            )
                            if job_status and job_status["status"] == "pending":
                                logger.warning(
                                    f"Build job {job_id} stalled — no events for "
                                    f"{stall_limit}s.  Marking as timed_out."
                                )
                                try:
                                    db.execute(
                                        "UPDATE build_jobs SET status = 'timed_out' WHERE job_id = %s",
                                        (job_id,),
                                    )
                                except Exception:
                                    pass  # Best-effort — still tell client to retry
                                yield f"data: {json.dumps({'status': 'error', 'message': 'Build thread died (server restarted). Please try again.', 'retry': True})}\n\n"
                                return

                        # ── Missed-done detection ────────────────────────────
                        # If the build completed but _emit("done") failed
                        # (e.g. pool exhaustion), the SSE stream would loop
                        # forever.  Periodically check if build_jobs is 'done'
                        # and synthesize a done event from the cached graph.
                        # Rate-limited to once per 15s to avoid DB hammering
                        # (without this, the query fires every 2s = 315 times
                        # over a 660s stall window).
                        now_check = time.time()
                        if now_check - last_event_time > 30 and now_check - last_job_check_time > 15:
                            last_job_check_time = now_check
                            job_check = db.fetchone(
                                "SELECT status FROM build_jobs WHERE job_id = %s",
                                (job_id,),
                            )
                            if job_check and job_check["status"] == "done":
                                logger.info(f"Build job {job_id} done but SSE missed done event — synthesizing")
                                # Try to load the cached graph
                                try:
                                    cached = db.fetchone(
                                        """
                                        SELECT graph_json FROM graphs
                                        WHERE seed_paper_id = (
                                            SELECT paper_id FROM build_jobs WHERE job_id = %s
                                        )
                                        ORDER BY created_at DESC LIMIT 1
                                        """,
                                        (job_id,),
                                    )
                                    if cached and cached.get("graph_json"):
                                        gdata = cached["graph_json"]
                                        if isinstance(gdata, str):
                                            gdata = json.loads(gdata)
                                        yield f"data: {json.dumps({'status': 'done', 'graph': gdata})}\n\n"
                                        return
                                except Exception as synth_err:
                                    logger.warning(f"Failed to synthesize done event: {synth_err}")
                                # Even without graph data, tell client it's done
                                yield f"data: {json.dumps({'status': 'done', 'message': 'Build completed. Refresh to load graph.'})}\n\n"
                                return
                            elif job_check and job_check["status"] == "error":
                                yield f"data: {json.dumps({'status': 'error', 'message': 'Build failed. Please try again.', 'retry': True})}\n\n"
                                return

                        # Send keepalive every 2s to prevent Koyeb/proxy timeout.
                        # Must be a real data: frame (not a comment) so the client
                        # EventSource.onmessage fires and resets the stall timer.
                        yield f"data: {json.dumps({'status': 'keepalive'})}\n\n"
                        time.sleep(2)
                    else:
                        time.sleep(0.3)

                # Overall 10-minute timeout hit — mark the job so it's not reused
                logger.warning(f"Build job {job_id} hit 10-minute SSE timeout — marking timed_out")
                try:
                    db.execute(
                        "UPDATE build_jobs SET status = 'timed_out' WHERE job_id = %s AND status = 'pending'",
                        (job_id,),
                    )
                except Exception:
                    pass
                yield f"data: {json.dumps({'status': 'timeout', 'message': 'Graph build timed out after 40 minutes. This paper may have too many references — try a more specific paper.'})}\n\n"

            except GeneratorExit:
                # Client disconnected — clean up and exit silently
                logger.debug(f"SSE client disconnected for job {job_id}")
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
            AND computed_at > NOW() - make_interval(days => %s)
            ORDER BY computed_at DESC LIMIT 1
            """,
            (paper_id, Config.GRAPH_CACHE_TTL_DAYS),
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
        Load a cached graph for the given paper_id.
        Returns (AncestryGraph, graph_row) or (None, None) if not found.

        SESSION-INDEPENDENT: First tries session-scoped lookup (for history
        consistency), then falls back to any recent graph for this paper_id.
        This ensures prune/DNA/diversity work even when the graph was built
        in a different session (cross-session cache sharing).

        DOI-AWARE: The paper_id may be a raw DOI (from the URL), but
        graphs.seed_paper_id stores the resolved S2 paper ID. We handle
        this by also checking the papers table's doi column.
        """
        # Resolve DOI → canonical paper_id if the input looks like a DOI.
        # The user may pass a raw DOI but seed_paper_id is always the S2 ID.
        resolved_id = paper_id
        if "/" in paper_id or paper_id.lower().startswith("10."):
            try:
                id_row = db.fetchone(
                    "SELECT paper_id FROM papers WHERE doi = %s LIMIT 1",
                    (paper_id,),
                )
                if id_row:
                    resolved_id = id_row["paper_id"]
            except Exception:
                pass  # Fall through with original paper_id

        # Try 1: Session-scoped lookup (preferred — maintains history link)
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
            (resolved_id, session_id),
        )

        # Try 2: Session-independent fallback — find any recent graph for this paper
        if not row:
            row = db.fetchone(
                """
                SELECT g.graph_id, g.graph_json_url, g.leaderboard_json,
                       g.dna_json, g.diversity_json
                FROM graphs g
                WHERE g.seed_paper_id = %s
                  AND g.computed_at > NOW() - make_interval(days => %s)
                ORDER BY g.computed_at DESC
                LIMIT 1
                """,
                (resolved_id, Config.GRAPH_CACHE_TTL_DAYS),
            )
            # If found, create session link for future calls
            if row:
                try:
                    db.execute(
                        """
                        INSERT INTO session_graphs (session_id, graph_id, created_at)
                        VALUES (%s, %s, NOW())
                        ON CONFLICT (session_id, graph_id) DO NOTHING
                        """,
                        (session_id, row["graph_id"]),
                    )
                except Exception:
                    pass  # Non-fatal

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

        allowed, headers = rate_limiter.check_sync(session_id, "POST /api/prune")
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

    @app.route("/api/dna/<path:paper_id>")
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

    @app.route("/api/diversity/<path:paper_id>")
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

    @app.route("/api/orphans/<path:seed_id>")
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

    @app.route("/api/gaps/<path:seed_id>")
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

    @app.route("/api/genealogy/<path:paper_id>")
    @require_session
    def api_genealogy(paper_id: str):
        """Return LLM-generated genealogy story for a graph."""
        session_id = g.session_id

        try:
            graph, _ = _load_graph_for_request(paper_id, session_id)
        except Exception as exc:
            app.logger.error(f"Genealogy graph load failed: {exc}")
            return jsonify({"narrative": None, "error": "Could not load graph data"}), 500

        if graph is None:
            return jsonify({"narrative": None, "error": "Graph not found. Try building the graph again."}), 404

        llm = get_llm_client()
        if not llm.available:
            return jsonify({"narrative": None, "error": "LLM not configured"})

        try:
            graph_json = graph.export_to_json()
            result = llm.generate_genealogy_story(graph_json)
            return jsonify(result)
        except Exception as exc:
            app.logger.error(f"Genealogy generation failed: {exc}")
            return jsonify({"narrative": None, "error": "Generation failed. The AI model may be unavailable."}), 500

    # ─── POST /api/chat ──────────────────────────────────────────────────

    @app.route("/api/chat", methods=["POST"])
    @require_session
    def api_chat():
        """AI guide chat endpoint."""
        session_id = g.session_id

        allowed, headers = rate_limiter.check_sync(session_id, "POST /api/chat")
        if not allowed:
            return jsonify(rate_limiter.get_429_body(headers)), 429, headers

        data = request.get_json(silent=True) or {}
        user_message = data.get("message", "")
        graph_summary = data.get("graph_summary", {})
        current_view = data.get("current_view", "overview")
        # Frontend sends current_view as dict {"type": "overview"} — extract string
        if isinstance(current_view, dict):
            current_view = current_view.get("type", "overview")

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

    # Phase 3 insight_cache route superseded by Phase 7 InsightEngine (below)

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

    # ─── POST /api/flag-edge (Phase 8: auto-downgrade) ──────────────────

    @app.route("/api/flag-edge", methods=["POST"])
    @require_session
    def api_flag_edge():
        """
        Flag an edge classification as incorrect.
        Auto-downgrades confidence tier when 3+ DISTINCT users flag the same edge.
        """
        data          = request.get_json(silent=True) or {}
        edge_id       = (data.get("edge_id") or "").strip()
        reason        = (data.get("reason") or "")[:200]
        feedback_type = data.get("feedback_type", "disagreement")

        # Backward compat: accept citing_paper_id + cited_paper_id
        if not edge_id:
            citing_id = data.get("citing_paper_id")
            cited_id  = data.get("cited_paper_id")
            if citing_id and cited_id:
                edge_id = f"{citing_id}:{cited_id}"
        if not edge_id:
            return jsonify({"error": "edge_id required"}), 400

        user_id = g.get("user_id") or g.session_id

        db.execute(
            "INSERT INTO edge_feedback (edge_id, session_id, feedback_type, feedback_detail) "
            "VALUES (%s, %s, %s, %s)",
            (edge_id, g.session_id, feedback_type, reason),
        )

        # Auto-downgrade via confidence_overrides
        current = db.fetchone(
            "SELECT flag_count, flagged_by_users, original_tier FROM confidence_overrides WHERE edge_id=%s",
            (edge_id,),
        )
        flag_count = 1
        if current:
            flagged_users = list(current.get("flagged_by_users") or [])
            if user_id not in flagged_users:
                flagged_users.append(user_id)
            flag_count    = len(flagged_users)
            review_needed = flag_count >= 5
            new_tier      = _downgrade_tier(current.get("original_tier") or "medium", flag_count)
            db.execute(
                "UPDATE confidence_overrides SET flag_count=%s, flagged_by_users=%s, "
                "override_tier=%s, review_required=%s, last_flagged_at=NOW() WHERE edge_id=%s",
                (flag_count, flagged_users, new_tier, review_needed, edge_id),
            )
        else:
            orig_row  = db.fetchone(
                "SELECT base_confidence FROM edge_analysis WHERE edge_id=%s", (edge_id,),
            )
            from backend.models import get_confidence_tier
            orig_tier = get_confidence_tier(float(orig_row["base_confidence"])) if orig_row else "MEDIUM"
            db.execute(
                "INSERT INTO confidence_overrides (edge_id, original_tier, override_tier, "
                "flag_count, flagged_by_users) VALUES (%s, %s, %s, 1, %s) ON CONFLICT (edge_id) DO NOTHING",
                (edge_id, orig_tier.lower(), orig_tier.lower(), [user_id]),
            )

        db.execute(
            "UPDATE edge_analysis SET flagged_by_users = flagged_by_users + 1 WHERE edge_id=%s",
            (edge_id,),
        )

        if g.get("user_id"):
            graph_id = data.get("graph_id", "")
            if graph_id:
                GraphMemoryManager().mark_edge_flagged(g.user_id, graph_id, edge_id)

        return jsonify({"success": True, "total_flags": flag_count})

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
            from backend.llm_client import get_llm_client
            llm_client = get_llm_client()
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

    # ── Phase 6: Helper ──────────────────────────────────────────────────

    def _get_latest_graph_json(session_id: str, user_id: str | None = None) -> dict | None:
        """
        Fetch the latest graph JSON for a request.
        Priority: session_id → user_id fallback.
        Returns parsed graph dict, or None if not found.
        Raises RuntimeError if R2 download fails.
        """
        from backend.r2_client import R2Client

        row = None
        if session_id:
            row = db.fetchone(
                """
                SELECT g.graph_json_url FROM graphs g
                JOIN session_graphs sg ON sg.graph_id = g.graph_id
                WHERE sg.session_id = %s ORDER BY g.created_at DESC LIMIT 1
                """,
                (session_id,),
            )
        if not row and user_id:
            row = db.fetchone(
                "SELECT graph_json_url FROM graphs WHERE user_id = %s::uuid "
                "ORDER BY created_at DESC LIMIT 1",
                (user_id,),
            )
        if not row:
            return None
        try:
            return R2Client().download_json(row["graph_json_url"])
        except Exception as exc:
            raise RuntimeError(f"R2 download failed: {exc}") from exc

    # ── Phase 6: Page Routes ─────────────────────────────────────────────

    # /pricing route removed — all features free (ADR-016). pricing.html deleted.

    @app.route("/account")
    @require_auth
    def account_page():
        return render_template("account.html", user=g.user)

    @app.route("/privacy")
    def privacy_page():
        return render_template("privacy.html")

    # ── Phase 6: Account API Routes ──────────────────────────────────────

    @app.route("/api/account/profile", methods=["POST"])
    @require_auth
    def api_update_profile():
        data = request.get_json(silent=True) or {}
        if "email" in data:
            return jsonify({"error": "email_change_not_supported",
                            "message": "Email change is not available. Contact privacy@arivu.app."}), 400
        display_name = (data.get("display_name") or "").strip()[:100]
        institution  = (data.get("institution") or "").strip()[:200]
        role         = (data.get("role") or "").strip()[:50]
        db.execute(
            "UPDATE users SET display_name = %s, institution = %s, role = %s WHERE user_id = %s::uuid",
            (display_name or None, institution or None, role or None, g.user_id),
        )
        return jsonify({"success": True})

    @app.route("/api/account/password", methods=["POST"])
    @require_auth
    def api_change_password():
        import bcrypt as _bcrypt
        data       = request.get_json(silent=True) or {}
        current_pw = data.get("current_password", "")
        new_pw     = data.get("new_password", "")
        if len(new_pw) < 8:
            return jsonify({"error": "password_too_short"}), 400
        user = db.fetchone("SELECT password_hash FROM users WHERE user_id = %s::uuid", (g.user_id,))
        if not _bcrypt.checkpw(current_pw.encode(), (user or {}).get("password_hash", "").encode()):
            return jsonify({"error": "wrong_current_password"}), 403
        new_hash = _bcrypt.hashpw(new_pw.encode(), _bcrypt.gensalt(rounds=12)).decode()
        db.execute("UPDATE users SET password_hash = %s WHERE user_id = %s::uuid", (new_hash, g.user_id))
        return jsonify({"success": True})

    @app.route("/api/usage")
    @require_auth
    def api_usage():
        user = g.user
        return jsonify({
            "tier":              user.get("tier", "researcher"),
            "graphs_this_month": user.get("graphs_this_month", 0),
            "limit":             None,  # All features free — no graph limits (ADR-016)
            "reset_at":          None,
        })

    # Billing routes removed — all features free (ADR-016).
    # billing.py kept DORMANT for portfolio reference.

    # ── Phase 6: API Key Routes ──────────────────────────────────────────

    @app.route("/api/account/api-keys", methods=["GET"])
    @require_auth
    def api_list_api_keys():
        rows = db.fetchall(
            """
            SELECT key_id::text, key_prefix, label, scopes, created_at, last_used_at
            FROM api_keys WHERE user_id = %s::uuid AND revoked_at IS NULL
            ORDER BY created_at DESC
            """,
            (g.user_id,),
        )
        return jsonify({"keys": [dict(r) for r in rows]})

    @app.route("/api/account/api-keys", methods=["POST"])
    @require_auth
    def api_create_api_key():
        import hashlib, secrets as _secrets
        data      = request.get_json(silent=True) or {}
        label     = (data.get("label") or "").strip()[:100]
        raw_key   = "ak_" + _secrets.token_hex(32)
        key_hash  = hashlib.sha256(raw_key.encode()).hexdigest()
        key_prefix = raw_key[:8]    # 8 chars as documented in schema
        db.execute(
            "INSERT INTO api_keys (user_id, key_hash, key_prefix, label) VALUES (%s::uuid, %s, %s, %s)",
            (g.user_id, key_hash, key_prefix, label or None),
        )
        return jsonify({"key": raw_key, "prefix": key_prefix, "label": label,
                        "note": "Copy this key — it will never be shown again."})

    @app.route("/api/account/api-keys/<key_id>", methods=["DELETE"])
    @require_auth
    def api_revoke_api_key(key_id: str):
        db.execute(
            "UPDATE api_keys SET revoked_at = NOW() WHERE key_id = %s::uuid AND user_id = %s::uuid",
            (key_id, g.user_id),
        )
        return jsonify({"success": True})

    # ── Phase 6: GDPR Routes ────────────────────────────────────────────

    @app.route("/api/account/export-data", methods=["POST"])
    @require_auth
    def api_request_data_export():
        from backend.mailer import send_data_export_ready
        try:
            url = generate_user_data_export(g.user_id)
            send_data_export_ready(g.user.get("email", ""), g.user.get("display_name", ""), url)
            return jsonify({"success": True,
                            "message": "Your data export is ready. Check your email for the download link."})
        except Exception as exc:
            app.logger.error(f"Data export failed: {exc}")
            return jsonify({"error": "Export generation failed"}), 500

    @app.route("/api/account/delete", methods=["POST"])
    @require_auth
    def api_delete_account():
        import bcrypt as _bcrypt
        data         = request.get_json(silent=True) or {}
        confirmation = data.get("confirmation", "")
        password     = data.get("password", "")

        if confirmation != "DELETE MY ACCOUNT":
            return jsonify({"error": "confirmation_mismatch",
                            "message": "Type 'DELETE MY ACCOUNT' to confirm."}), 400

        user = db.fetchone("SELECT password_hash FROM users WHERE user_id = %s::uuid", (g.user_id,))
        if not _bcrypt.checkpw(password.encode(), (user or {}).get("password_hash", "").encode()):
            return jsonify({"error": "wrong_password"}), 403

        from backend.mailer import send_account_deletion_confirmation
        email = g.user.get("email", "")
        name  = g.user.get("display_name", "")

        success = delete_user_account(g.user_id)
        if success:
            if email and not email.startswith("deleted_"):
                send_account_deletion_confirmation(email, name)
            resp = make_response(jsonify({"success": True, "redirect": "/"}))
            resp.delete_cookie("arivu_session")
            return resp
        return jsonify({"error": "Account deletion failed — try again or contact support."}), 500

    # ── Phase 6: Consent Route ───────────────────────────────────────────

    @app.route("/api/consent", methods=["POST"])
    def api_consent():
        data         = request.get_json(silent=True) or {}
        consent_type = data.get("consent_type", "necessary")
        if consent_type not in ("all", "necessary"):
            return jsonify({"error": "Invalid consent_type"}), 400
        ip         = request.headers.get("X-Forwarded-For", request.remote_addr or "")
        session_id = request.cookies.get("arivu_session", "")
        user       = get_current_user()
        user_id    = str(user["user_id"]) if user else None
        db.execute(
            "INSERT INTO consent_log (user_id, session_id, consent_type, ip_address) "
            "VALUES (%s::uuid, %s, %s, %s::inet)",
            (user_id, session_id or None, consent_type, ip or None),
        )
        if user_id:
            db.execute(
                "UPDATE users SET marketing_consent = %s WHERE user_id = %s::uuid",
                (consent_type == "all", user_id),
            )
        return jsonify({"success": True})

    # ── Phase 6: Intelligence Routes ─────────────────────────────────────

    @app.route("/api/independent-discovery")
    @require_auth
    def api_independent_discovery():
        session_id = session_manager.get_session_id(request)
        allowed, headers = rate_limiter.check_sync(
            session_id or getattr(g, "user_id", "anon"), "GET /api/independent-discovery"
        )
        if not allowed:
            return jsonify(rate_limiter.get_429_response(headers)), 429, headers
        try:
            graph_data = _get_latest_graph_json(session_id, getattr(g, "user_id", None))
        except RuntimeError:
            return jsonify({"error": "Could not load graph"}), 500
        if graph_data is None:
            return jsonify({"error": "No graph built yet. Build a graph first."}), 404
        tracker = IndependentDiscoveryTracker()
        pairs   = tracker.find_independent_discoveries(graph_data)
        return jsonify({"pairs": [p.to_dict() for p in pairs]})

    @app.route("/api/citation-shadow")
    @require_auth
    def api_citation_shadow():
        session_id = session_manager.get_session_id(request)
        allowed, headers = rate_limiter.check_sync(
            session_id or getattr(g, "user_id", "anon"), "GET /api/citation-shadow"
        )
        if not allowed:
            return jsonify(rate_limiter.get_429_response(headers)), 429, headers
        try:
            graph_data = _get_latest_graph_json(session_id, getattr(g, "user_id", None))
        except RuntimeError:
            return jsonify({"error": "Could not load graph"}), 500
        if graph_data is None:
            return jsonify({"error": "No graph built yet."}), 404
        detector = CitationShadowDetector()
        shadows  = detector.detect_shadows(graph_data)
        return jsonify({"shadows": [s.to_dict() for s in shadows]})

    @app.route("/api/field-fingerprint/<seed_id>")
    @require_auth
    def api_field_fingerprint(seed_id: str):
        session_id = session_manager.get_session_id(request)
        allowed, headers = rate_limiter.check_sync(
            session_id or getattr(g, "user_id", "anon"), "GET /api/field-fingerprint"
        )
        if not allowed:
            return jsonify(rate_limiter.get_429_response(headers)), 429, headers
        row = db.fetchone(
            """
            SELECT g.graph_json_url FROM graphs g
            JOIN session_graphs sg ON sg.graph_id = g.graph_id
            WHERE sg.session_id = %s AND g.seed_paper_id = %s
            ORDER BY g.created_at DESC LIMIT 1
            """,
            (session_id, seed_id),
        )
        if not row and getattr(g, "user_id", None):
            row = db.fetchone(
                "SELECT graph_json_url FROM graphs WHERE user_id = %s::uuid AND seed_paper_id = %s "
                "ORDER BY created_at DESC LIMIT 1",
                (g.user_id, seed_id),
            )
        if not row:
            return jsonify({"error": "No graph found for this seed paper"}), 404
        try:
            from backend.r2_client import R2Client
            graph_data = R2Client().download_json(row["graph_json_url"])
        except Exception:
            return jsonify({"error": "Could not load graph"}), 500
        analyzer    = FieldFingerprintAnalyzer()
        fingerprint = analyzer.analyze(graph_data)
        return jsonify(fingerprint.to_dict())

    @app.route("/api/serendipity/<paper_id>")
    @require_auth
    def api_serendipity(paper_id: str):
        session_id = session_manager.get_session_id(request)
        allowed, headers = rate_limiter.check_sync(
            session_id or getattr(g, "user_id", "anon"), "GET /api/serendipity"
        )
        if not allowed:
            return jsonify(rate_limiter.get_429_response(headers)), 429, headers
        try:
            graph_data = _get_latest_graph_json(session_id, getattr(g, "user_id", None))
        except RuntimeError:
            return jsonify({"error": "Could not load graph"}), 500
        if graph_data is None:
            return jsonify({"error": "No graph built yet."}), 404
        engine  = SerendipityEngine()
        analogs = engine.find_analogs(graph_data)
        return jsonify({"analogs": [a.to_dict() for a in analogs]})

    # ── Phase 6: Graph History + Memory Routes ───────────────────────────

    @app.route("/api/graphs/history")
    @require_auth
    def api_graph_history():
        rows = db.fetchall(
            """
            SELECT graph_id, seed_paper_id, node_count, edge_count, coverage_score, created_at
            FROM graphs WHERE user_id = %s::uuid ORDER BY created_at DESC LIMIT 50
            """,
            (g.user_id,),
        )
        return jsonify({"graphs": [dict(r) for r in rows]})

    @app.route("/api/graph-memory")
    @require_auth
    def api_get_graph_memory():
        graph_id = request.args.get("graph_id", "").strip()
        if not graph_id:
            return jsonify({"error": "graph_id is required"}), 400
        row = db.fetchone(
            "SELECT memory_json FROM graph_memory WHERE user_id = %s::uuid AND graph_id = %s",
            (g.user_id, graph_id),
        )
        return jsonify({"memory": row["memory_json"] if row else {}})

    @app.route("/api/graph-memory", methods=["POST"])
    @require_auth
    def api_save_graph_memory():
        import json as _json
        data     = request.get_json(silent=True) or {}
        graph_id = data.get("graph_id", "").strip()
        memory   = data.get("memory", {})
        if not graph_id:
            return jsonify({"error": "graph_id is required"}), 400
        if not isinstance(memory, dict):
            return jsonify({"error": "memory must be a JSON object"}), 400
        memory_str = _json.dumps(memory)
        if len(memory_str) > 65536:
            return jsonify({"error": "memory state too large (max 64KB)"}), 413
        db.execute(
            """
            INSERT INTO graph_memory (user_id, graph_id, memory_json, updated_at)
            VALUES (%s::uuid, %s, %s::jsonb, NOW())
            ON CONFLICT (user_id, graph_id)
            DO UPDATE SET memory_json = EXCLUDED.memory_json, updated_at = NOW()
            """,
            (g.user_id, graph_id, memory_str),
        )
        return jsonify({"success": True})

    # ── Phase 7: Time Machine Routes ───────────────────────────────────

    @app.route("/api/time-machine/<seed_paper_id>")
    @require_auth
    def api_time_machine(seed_paper_id: str):
        """Build temporal dataset for the Time Machine visualization."""
        session_id = session_manager.get_session_id(request)
        allowed, headers = rate_limiter.check_sync(
            session_id or g.user_id, "GET /api/time-machine"
        )
        if not allowed:
            return jsonify(rate_limiter.get_429_response(headers)), 429, headers

        graph_data = None
        if seed_paper_id and seed_paper_id != "current":
            from backend.r2_client import R2Client
            row = db.fetchone(
                "SELECT graph_json_url FROM graphs WHERE seed_paper_id = %s "
                "AND user_id = %s::uuid ORDER BY created_at DESC LIMIT 1",
                (seed_paper_id, g.user_id),
            )
            if row:
                try:
                    graph_data = R2Client().download_json(row["graph_json_url"])
                except Exception:
                    graph_data = None

        if not graph_data:
            try:
                graph_data = _get_latest_graph_json(session_id, g.user_id)
            except RuntimeError:
                return jsonify({"error": "Could not load graph"}), 500

        if not graph_data:
            return jsonify({"error": "No graph built yet."}), 404

        engine = TimeMachineEngine()
        result = engine.build_timeline(graph_data)
        return jsonify(result)

    @app.route("/api/counterfactual/<paper_id>")
    @require_auth
    def api_counterfactual(paper_id: str):
        """Run counterfactual analysis: what if this paper never existed?"""
        session_id = session_manager.get_session_id(request)
        allowed, headers = rate_limiter.check_sync(
            session_id or g.user_id, "GET /api/counterfactual"
        )
        if not allowed:
            return jsonify(rate_limiter.get_429_response(headers)), 429, headers

        try:
            graph_data = _get_latest_graph_json(session_id, g.user_id)
        except RuntimeError:
            return jsonify({"error": "Could not load graph"}), 500
        if not graph_data:
            return jsonify({"error": "No graph built yet."}), 404

        graph_id = graph_data.get("metadata", {}).get("graph_id", "")
        cached = db.fetchone(
            "SELECT result_json FROM counterfactual_cache WHERE graph_id = %s AND paper_id = %s "
            "AND computed_at > NOW() - INTERVAL '7 days'",
            (graph_id, paper_id),
        )
        if cached:
            return jsonify(cached["result_json"])

        engine = CounterfactualEngine()
        result = engine.analyze(graph_data, paper_id)
        result_dict = result.to_dict()

        if graph_id:
            try:
                db.execute(
                    """
                    INSERT INTO counterfactual_cache (graph_id, paper_id, result_json)
                    VALUES (%s, %s, %s::jsonb)
                    ON CONFLICT (graph_id, paper_id) DO UPDATE
                    SET result_json=EXCLUDED.result_json, computed_at=NOW()
                    """,
                    (graph_id, paper_id, json.dumps(result_dict, default=str)),
                )
            except Exception:
                pass
        return jsonify(result_dict)

    # ── Phase 7: Graph Public Access ────────────────────────────────────

    @app.route("/api/graph/<graph_id>")
    def api_graph_by_id(graph_id: str):
        """
        Public graph retrieval by graph_id.
        Serves graphs that have a valid shared_graphs entry
        OR are owned by the authenticated user.
        """
        from backend.r2_client import R2Client

        user_id = getattr(g, "user_id", None)
        if user_id:
            row = db.fetchone(
                "SELECT graph_json_url FROM graphs WHERE graph_id = %s AND user_id = %s::uuid",
                (graph_id, user_id),
            )
            if row:
                try:
                    return jsonify(R2Client().download_json(row["graph_json_url"]))
                except Exception:
                    return jsonify({"error": "Could not load graph data"}), 500

        share = db.fetchone(
            "SELECT graph_id FROM shared_graphs WHERE graph_id = %s "
            "AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1",
            (graph_id,),
        )
        if share:
            row = db.fetchone(
                "SELECT graph_json_url FROM graphs WHERE graph_id = %s", (graph_id,)
            )
            if row:
                try:
                    return jsonify(R2Client().download_json(row["graph_json_url"]))
                except Exception:
                    return jsonify({"error": "Could not load graph data"}), 500

        return jsonify({"error": "Graph not found or not publicly shared"}), 404

    # ── Phase 7: Adversarial Review ─────────────────────────────────────

    @app.route("/api/adversarial-review", methods=["POST"])
    @require_auth
    def api_adversarial_review():
        """Review a paper (PDF upload or abstract-only)."""
        allowed, headers = rate_limiter.check_sync(
            g.user_id, "POST /api/adversarial-review"
        )
        if not allowed:
            return jsonify(rate_limiter.get_429_response(headers)), 429, headers

        reviewer = AdversarialReviewer()
        handler = SecureFileUploadHandler()

        if request.content_type and "multipart" in request.content_type:
            file = request.files.get("pdf")
            if not file:
                return jsonify({"error": "No PDF file uploaded", "code": "missing_file"}), 400

            pdf_bytes = file.read()
            result = handler.validate_and_hash(pdf_bytes, file.filename or "upload.pdf")
            if not result["valid"]:
                return jsonify({"error": result.get("error", "Invalid file"), "code": "invalid_file"}), 400

            file_hash = result["file_hash"]

            count = db.fetchone(
                "SELECT COUNT(*) AS cnt FROM adversarial_reviews "
                "WHERE user_id = %s::uuid AND created_at > NOW() - INTERVAL '30 days'",
                (g.user_id,),
            )["cnt"]
            if count >= 10:
                return jsonify({"error": "Monthly review limit reached (10/month)", "code": "limit_reached"}), 429

            existing = db.fetchone(
                "SELECT review_id::text, result_json FROM adversarial_reviews "
                "WHERE file_hash = %s AND user_id = %s::uuid AND status = 'done'",
                (file_hash, g.user_id),
            )
            if existing and existing.get("result_json"):
                return jsonify({"review_id": existing["review_id"], "cached": True,
                                "result": existing["result_json"]})

            row = db.execute_returning(
                "INSERT INTO adversarial_reviews (user_id, file_hash, file_name, status) "
                "VALUES (%s::uuid, %s, %s, 'processing') RETURNING review_id::text",
                (g.user_id, file_hash, (file.filename or "upload.pdf")[:200]),
            )
            review_id = row["review_id"]

            try:
                result = reviewer.review_from_pdf(
                    pdf_bytes, file.filename or "upload.pdf",
                    g.user_id, review_id=review_id
                )
                result_json = json.dumps(result.to_dict(), default=str)
                db.execute(
                    "UPDATE adversarial_reviews SET status='done', result_json=%s::jsonb, "
                    "completed_at=NOW() WHERE review_id=%s::uuid",
                    (result_json, review_id),
                )
                return jsonify({"review_id": review_id, "result": result.to_dict()})
            except Exception as exc:
                db.execute(
                    "UPDATE adversarial_reviews SET status='failed' WHERE review_id=%s::uuid",
                    (review_id,),
                )
                app.logger.error(f"Adversarial review failed: {exc}")
                return jsonify({"error": "Review processing failed", "code": "processing_error"}), 500
        else:
            data = request.get_json(silent=True) or {}
            title = data.get("title", "")
            abstract = data.get("abstract", "")
            if not abstract:
                return jsonify({"error": "abstract required", "code": "missing_param"}), 400
            result = reviewer.review_from_abstract(title, abstract)
            return jsonify(result.to_dict())

    # ── Phase 7: Workflow Routes ────────────────────────────────────────

    @app.route("/api/citation-audit/<paper_id>")
    @require_auth
    def api_citation_audit(paper_id: str):
        """Audit citation practices for a paper."""
        allowed, headers = rate_limiter.check_sync(
            g.user_id, "GET /api/citation-audit"
        )
        if not allowed:
            return jsonify(rate_limiter.get_429_response(headers)), 429, headers
        session_id = session_manager.get_session_id(request)
        try:
            graph_data = _get_latest_graph_json(session_id, g.user_id)
        except RuntimeError:
            return jsonify({"error": "Could not load graph"}), 500
        if not graph_data:
            return jsonify({"error": "No graph built yet."}), 404
        result = CitationAudit().audit(paper_id, graph_data)
        return jsonify(result.to_dict())

    @app.route("/api/citation-generator", methods=["POST"])
    @require_auth
    def api_citation_generator():
        """Generate citations in multiple styles."""
        data = request.get_json(silent=True) or {}
        paper_ids = data.get("paper_ids", [])
        style = data.get("style", "apa")
        all_styles = data.get("all_styles", False)
        if not paper_ids:
            return jsonify({"error": "paper_ids required"}), 400
        if len(paper_ids) > 50:
            return jsonify({"error": "Maximum 50 papers per batch"}), 400
        gen = CitationGenerator()
        styles = [style] if style else ["apa"]
        result = gen.generate(paper_ids, styles=styles, all_styles=all_styles)
        return jsonify(result)

    @app.route("/api/reading-prioritizer", methods=["POST"])
    @require_auth
    def api_reading_prioritizer():
        """Prioritize a reading list from the current graph."""
        allowed, headers = rate_limiter.check_sync(
            g.user_id, "POST /api/reading-prioritizer"
        )
        if not allowed:
            return jsonify(rate_limiter.get_429_response(headers)), 429, headers
        data = request.get_json(silent=True) or {}
        max_items = data.get("max_items", 20)
        session_id = session_manager.get_session_id(request)
        try:
            graph_data = _get_latest_graph_json(session_id, g.user_id)
        except RuntimeError:
            return jsonify({"error": "Could not load graph"}), 500
        if not graph_data:
            return jsonify({"error": "No graph built yet."}), 404
        result = ReadingPrioritizer().prioritize(graph_data, max_items=max_items)
        return jsonify({"ranked": result, "total": len(result)})

    @app.route("/api/paper-positioning", methods=["POST"])
    @require_auth
    def api_paper_positioning():
        """Position a paper in the intellectual landscape."""
        allowed, headers = rate_limiter.check_sync(
            g.user_id, "POST /api/paper-positioning"
        )
        if not allowed:
            return jsonify(rate_limiter.get_429_response(headers)), 429, headers
        data = request.get_json(silent=True) or {}
        paper_id = data.get("paper_id", "")
        title = data.get("title", "")
        abstract = data.get("abstract", "")
        tool = PaperPositioningTool()

        if paper_id:
            session_id = session_manager.get_session_id(request)
            try:
                graph_data = _get_latest_graph_json(session_id, g.user_id)
            except RuntimeError:
                return jsonify({"error": "Could not load graph"}), 500
            result = tool.position_by_paper_id(paper_id, graph_data or {"nodes": [], "edges": []})
        elif abstract:
            result = tool.position_by_abstract(title, abstract)
        else:
            return jsonify({"error": "paper_id or abstract required"}), 400

        return jsonify(result.to_dict())

    @app.route("/api/rewrite-suggester", methods=["POST"])
    @require_auth
    def api_rewrite_suggester():
        """Suggest a rewrite for a related-work section."""
        allowed, headers = rate_limiter.check_sync(
            g.user_id, "POST /api/rewrite-suggester"
        )
        if not allowed:
            return jsonify(rate_limiter.get_429_response(headers)), 429, headers
        data = request.get_json(silent=True) or {}
        related_work = data.get("related_work_text", "")
        paper_title = data.get("paper_title", "")
        if not related_work or not related_work.strip():
            return jsonify({"error": "related_work_text required"}), 400
        if len(related_work) > 10000:
            return jsonify({"error": "Text too long — maximum 10,000 characters"}), 400
        result = RewriteSuggester().suggest(related_work, paper_title)
        return jsonify(result.to_dict())

    # ── Phase 7: Persona Routes ─────────────────────────────────────────

    @app.route("/api/persona", methods=["POST"])
    @require_auth
    def api_set_persona():
        """Set the active persona mode."""
        data = request.get_json(silent=True) or {}
        mode = data.get("mode", "explorer")
        if mode not in ("explorer", "critic", "innovator", "historian"):
            return jsonify({"error": "Invalid mode"}), 400
        session_id = session_manager.get_session_id(request)
        if session_id:
            db.execute(
                "UPDATE sessions SET persona_mode = %s WHERE session_id = %s",
                (mode, session_id),
            )
        if hasattr(g, "user_id") and g.user_id:
            db.execute(
                "UPDATE users SET default_persona = %s WHERE user_id = %s::uuid",
                (mode, g.user_id),
            )
        return jsonify({"mode": mode, "config": PersonaEngine().get_config(mode).to_dict()})

    @app.route("/api/persona")
    def api_get_persona():
        """Get the current persona mode."""
        session_id = session_manager.get_session_id(request)
        mode = "explorer"
        if session_id:
            row = db.fetchone(
                "SELECT persona_mode FROM sessions WHERE session_id = %s", (session_id,)
            )
            if row:
                mode = row.get("persona_mode") or "explorer"
        return jsonify(PersonaEngine().get_config(mode).to_dict())

    # ── Phase 7: Insight Feed ───────────────────────────────────────────

    @app.route("/api/insights/<seed_paper_id>")
    @require_session
    def api_insights(seed_paper_id: str):
        """Generate insight feed for a graph."""
        session_id = g.session_id
        try:
            from backend.r2_client import R2Client
            row = db.fetchone(
                "SELECT g.graph_json_url FROM graphs g "
                "JOIN session_graphs sg ON sg.graph_id = g.graph_id "
                "WHERE sg.session_id = %s ORDER BY g.created_at DESC LIMIT 1",
                (session_id,),
            )
            if not row:
                return jsonify({"insights": []})
            graph_data = R2Client().download_json(row["graph_json_url"])
        except Exception:
            return jsonify({"insights": []})

        row_s = db.fetchone(
            "SELECT persona_mode FROM sessions WHERE session_id = %s", (session_id,)
        )
        mode = (row_s.get("persona_mode") or "explorer") if row_s else "explorer"
        insights = InsightEngine().generate_feed(graph_data, persona_mode=mode)
        return jsonify({"insights": insights, "persona_mode": mode})

    # ── Phase 7: Research Journal Export ─────────────────────────────────

    @app.route("/api/action-log/<seed_paper_id>/export")
    @require_auth
    def api_export_research_journal(seed_paper_id: str):
        """Export the action log as a downloadable text report."""
        session_id = session_manager.get_session_id(request)
        rows = db.fetchall(
            "SELECT action_type, action_data, timestamp FROM action_log "
            "WHERE session_id = %s ORDER BY timestamp ASC",
            (session_id,),
        )
        if not rows:
            return jsonify({"error": "No action log entries found for this session"}), 404

        paper = db.fetchone(
            "SELECT title FROM papers WHERE paper_id = %s", (seed_paper_id,)
        )
        title = (paper.get("title") if paper else None) or "Research Session"

        # Generate plain-text journal (no ExportGenerator.generate_pdf dependency)
        lines = [f"Research Journal: {title}", "=" * 60, ""]
        for r in rows:
            ts = str(r["timestamp"])
            action = r["action_type"]
            detail = (r["action_data"] or {}).get("description", "") if isinstance(r.get("action_data"), dict) else ""
            lines.append(f"[{ts}] {action}: {detail}")
        text_content = "\n".join(lines)

        return Response(
            text_content.encode("utf-8"),
            mimetype="text/plain",
            headers={
                "Content-Disposition": f'attachment; filename="arivu-journal-{seed_paper_id[:8]}.txt"'
            },
        )

    # ── Phase 7: Shareable Graph Links ──────────────────────────────────

    @app.route("/api/share", methods=["POST"])
    @require_auth
    def api_create_share():
        """Create a shareable link for the current graph."""
        allowed, headers = rate_limiter.check_sync(
            g.user_id, "POST /api/share"
        )
        if not allowed:
            return jsonify(rate_limiter.get_429_response(headers)), 429, headers

        data = request.get_json(silent=True) or {}
        session_id = session_manager.get_session_id(request)
        row = None
        if session_id:
            row = db.fetchone(
                """
                SELECT g.graph_id, g.seed_paper_id, p.title AS seed_title
                FROM graphs g
                JOIN session_graphs sg ON sg.graph_id = g.graph_id
                LEFT JOIN papers p ON p.paper_id = g.seed_paper_id
                WHERE sg.session_id = %s ORDER BY g.created_at DESC LIMIT 1
                """,
                (session_id,),
            )
        if not row:
            row = db.fetchone(
                """
                SELECT g.graph_id, g.seed_paper_id, p.title AS seed_title
                FROM graphs g
                LEFT JOIN papers p ON p.paper_id = g.seed_paper_id
                ORDER BY g.created_at DESC LIMIT 1
                """,
            )

        if not row:
            return jsonify({"error": "No graph to share. Build a graph first."}), 404

        manager = LabManager()
        token = manager.create_share_link(
            graph_id=str(row["graph_id"]),
            user_id=g.user_id,
            seed_paper_id=row.get("seed_paper_id", ""),
            seed_title=row.get("seed_title", ""),
            view_mode=data.get("view_mode", "force"),
            view_state=data.get("view_state"),
        )
        base_url = Config.API_BASE_URL or f"https://{Config.CUSTOM_DOMAIN}"
        return jsonify({"token": token, "url": f"{base_url}/share/{token}"})

    @app.route("/share/<token>")
    def view_shared_graph(token: str):
        """Render the shared graph page."""
        share = LabManager().get_share(token)
        if not share:
            return "Shared graph not found or has expired.", 404
        base_url = Config.API_BASE_URL or f"https://{Config.CUSTOM_DOMAIN}"
        return render_template(
            "shared_graph.html",
            share=share,
            share_url=f"{base_url}/share/{token}",
        )

    @app.route("/api/shares")
    @require_auth
    def api_list_shares():
        """List all shared graph links for the authenticated user."""
        return jsonify({"shares": LabManager().list_shares(g.user_id)})

    @app.route("/api/shares/<token>", methods=["DELETE"])
    @require_auth
    def api_delete_share(token: str):
        """Delete a shared graph link."""
        return jsonify({"success": LabManager().delete_share(token, g.user_id)})

    # ── Phase 7: Lab Management ─────────────────────────────────────────

    @app.route("/api/lab/members", methods=["GET"])
    @require_auth
    def api_lab_members():
        """List lab members."""
        return jsonify({"members": LabManager().list_members(g.user_id)})

    @app.route("/api/lab/invite", methods=["POST"])
    @require_auth
    def api_lab_invite():
        """Send a lab invitation."""
        allowed, headers = rate_limiter.check_sync(
            g.user_id, "POST /api/lab/invite"
        )
        if not allowed:
            return jsonify(rate_limiter.get_429_response(headers)), 429, headers
        data = request.get_json(silent=True) or {}
        email = (data.get("email") or "").lower().strip()
        if not email:
            return jsonify({"error": "email required"}), 400

        manager = LabManager()
        result = manager.invite_member(g.user_id, email)
        if not result.get("success"):
            return jsonify({"error": result.get("error", "Invite failed")}), 400
        return jsonify({"success": True, "message": f"Invite sent to {email}."})

    @app.route("/lab/accept")
    def lab_accept_invite():
        """Redirect invite link to login with invite token."""
        from flask import redirect
        token = request.args.get("token", "")
        if not token:
            return redirect("/login")
        return redirect(f"/login?invite={token}")

    @app.route("/api/lab/accept", methods=["POST"])
    @require_auth
    def api_lab_accept_invite():
        """Accept a lab invitation."""
        data = request.get_json(silent=True) or {}
        token = data.get("token", "")
        if not token:
            return jsonify({"error": "token required"}), 400
        result = LabManager().accept_invite(token, g.user_id)
        return jsonify(result)

    @app.route("/api/lab/members/<member_id>", methods=["DELETE"])
    @require_auth
    def api_lab_remove_member(member_id: str):
        """Remove a member from the lab."""
        result = LabManager().remove_member(g.user_id, member_id)
        return jsonify(result)

    # ── Phase 7: Supervisor Dashboard ───────────────────────────────────

    @app.route("/supervisor")
    @require_auth
    def supervisor_dashboard():
        """Supervisor Dashboard page."""
        data = LabManager().get_supervisor_data(g.user_id)
        return render_template("supervisor.html", data=data)

    @app.route("/api-docs")
    def api_docs():
        """Public API documentation page."""
        return render_template("api_docs.html")

    # ── Phase 7: Guided Discovery ───────────────────────────────────────

    @app.route("/api/guided-discovery", methods=["POST"])
    @require_session
    def api_guided_discovery():
        """Process onboarding answers and return a feature pathway."""
        allowed, headers = rate_limiter.check_sync(
            g.session_id, "POST /api/guided-discovery"
        )
        if not allowed:
            return jsonify(rate_limiter.get_429_response(headers)), 429, headers

        data = request.get_json(silent=True) or {}
        relationship = data.get("relationship", "")
        context = data.get("context", "")

        pathway = _build_discovery_pathway(relationship, context)
        session_id = g.session_id
        db.execute(
            "UPDATE sessions SET persona_mode = %s WHERE session_id = %s",
            (pathway["suggested_persona"], session_id),
        )
        return jsonify(pathway)

    # ── Phase 7: Email Change ───────────────────────────────────────────

    @app.route("/api/account/request-email-change", methods=["POST"])
    @require_auth
    def api_request_email_change():
        """Request an email change — sends verification to new email."""
        data = request.get_json(silent=True) or {}
        new_email = (data.get("new_email") or "").strip().lower()
        password = data.get("password", "")

        if not new_email or "@" not in new_email:
            return jsonify({"error": "Valid email required"}), 400

        # Verify password
        import bcrypt as _bcrypt
        user = db.fetchone(
            "SELECT password_hash, email FROM users WHERE user_id = %s::uuid",
            (g.user_id,),
        )
        if not user or not _bcrypt.checkpw(
            password.encode(), (user.get("password_hash") or "").encode()
        ):
            return jsonify({"error": "wrong_password"}), 403

        if user.get("email", "").lower() == new_email:
            return jsonify({"error": "New email is the same as current"}), 400

        # Check if email is taken
        existing = db.fetchone(
            "SELECT user_id FROM users WHERE email = %s", (new_email,)
        )
        if existing:
            return jsonify({"error": "Email already in use"}), 409

        # Create token
        import secrets as _secrets
        token = _secrets.token_urlsafe(32)
        db.execute(
            """
            INSERT INTO email_change_tokens (user_id, new_email, token)
            VALUES (%s::uuid, %s, %s)
            """,
            (g.user_id, new_email, token),
        )

        # Send verification email
        try:
            from backend.mailer import send_email_change_verification
            base_url = Config.API_BASE_URL or f"https://{Config.CUSTOM_DOMAIN}"
            send_email_change_verification(
                new_email, token, f"{base_url}/api/account/confirm-email-change?token={token}"
            )
        except Exception as exc:
            app.logger.warning(f"Email change verification send failed: {exc}")

        return jsonify({"success": True, "message": "Verification email sent to new address."})

    @app.route("/api/account/confirm-email-change")
    def api_confirm_email_change():
        """Confirm email change via token (GET link from email)."""
        token = request.args.get("token", "")
        if not token:
            return "Missing token.", 400

        row = db.fetchone(
            """
            SELECT user_id, new_email FROM email_change_tokens
            WHERE token = %s AND used_at IS NULL AND expires_at > NOW()
            """,
            (token,),
        )
        if not row:
            return "Invalid or expired token.", 400

        db.execute(
            "UPDATE users SET email = %s WHERE user_id = %s::uuid",
            (row["new_email"], str(row["user_id"])),
        )
        db.execute(
            "UPDATE email_change_tokens SET used_at = NOW() WHERE token = %s",
            (token,),
        )
        return "Email updated successfully. You can close this page."

    # ══════════════════════════════════════════════════════════════════════
    # Phase 8 routes
    # ══════════════════════════════════════════════════════════════════════

    # ── Cross-Domain Spark Detector ───────────────────────────────────────
    @app.route("/api/cross-domain-sparks/<seed_paper_id>")
    @require_auth
    def api_cross_domain_sparks(seed_paper_id: str):
        session_id = session_manager.get_session_id(request)
        try:
            graph_data = _get_latest_graph_json(session_id, g.user_id)
        except RuntimeError:
            return jsonify({"error": "Could not load graph"}), 500
        if not graph_data:
            return jsonify({"error": "No graph built yet."}), 404

        graph_id = graph_data.get("metadata", {}).get("graph_id", "")
        if graph_id:
            cached = db.fetchone(
                "SELECT result_json FROM cross_domain_spark_cache WHERE graph_id=%s",
                (graph_id,),
            )
            if cached:
                return jsonify(cached["result_json"])

        result = CrossDomainSparkDetector().detect(graph_data)
        if graph_id:
            db.execute(
                "INSERT INTO cross_domain_spark_cache (graph_id, result_json) VALUES (%s,%s::jsonb) "
                "ON CONFLICT (graph_id) DO UPDATE SET result_json=EXCLUDED.result_json, computed_at=NOW()",
                (graph_id, json.dumps(result)),
            )
        log_action(session_id, "cross_domain_sparks", {"seed_paper_id": seed_paper_id, "graph_id": graph_id})
        return jsonify(result)

    # ── Error Propagation Tracker ─────────────────────────────────────────
    @app.route("/api/error-propagation/<seed_paper_id>")
    @require_auth
    def api_error_propagation(seed_paper_id: str):
        session_id = session_manager.get_session_id(request)
        try:
            graph_data = _get_latest_graph_json(session_id, g.user_id)
        except RuntimeError:
            return jsonify({"error": "Could not load graph"}), 500
        if not graph_data:
            return jsonify({"error": "No graph built yet."}), 404
        result = ErrorPropagationTracker().analyze(graph_data)
        log_action(session_id, "error_propagation", {"seed_paper_id": seed_paper_id})
        return jsonify(result)

    # ── Reading Between the Lines ─────────────────────────────────────────
    @app.route("/api/reading-between-lines/<paper_id>")
    @require_auth
    def api_reading_between_lines(paper_id: str):
        session_id = session_manager.get_session_id(request)
        try:
            graph_data = _get_latest_graph_json(session_id, g.user_id)
        except RuntimeError:
            return jsonify({"error": "Could not load graph"}), 500
        if not graph_data:
            return jsonify({"error": "No graph built yet."}), 404
        result = ReadingBetweenLines().analyze(graph_data, paper_id)
        log_action(session_id, "reading_between_lines", {"paper_id": paper_id})
        return jsonify(result.to_dict())

    # ── Intellectual Debt Tracker ─────────────────────────────────────────
    @app.route("/api/intellectual-debt/<seed_paper_id>")
    @require_auth
    def api_intellectual_debt(seed_paper_id: str):
        session_id = session_manager.get_session_id(request)
        try:
            graph_data = _get_latest_graph_json(session_id, g.user_id)
        except RuntimeError:
            return jsonify({"error": "Could not load graph"}), 500
        if not graph_data:
            return jsonify({"error": "No graph built yet."}), 404
        result = IntellectualDebtTracker().analyze(graph_data)
        log_action(session_id, "intellectual_debt", {"seed_paper_id": seed_paper_id})
        return jsonify(result)

    # ── Challenge Generator ───────────────────────────────────────────────
    @app.route("/api/challenge/<paper_id>")
    @require_auth
    def api_challenge_generator(paper_id: str):
        session_id = session_manager.get_session_id(request)
        try:
            graph_data = _get_latest_graph_json(session_id, g.user_id)
        except RuntimeError:
            return jsonify({"error": "Could not load graph"}), 500
        if not graph_data:
            return jsonify({"error": "No graph built yet."}), 404
        result = ChallengeGenerator().generate(graph_data, paper_id)
        log_action(session_id, "challenge_generator", {"paper_id": paper_id})
        return jsonify(result)

    # ── Idea Credit System ────────────────────────────────────────────────
    @app.route("/api/credits/<seed_paper_id>")
    @require_auth
    def api_idea_credits(seed_paper_id: str):
        session_id = session_manager.get_session_id(request)
        try:
            graph_data = _get_latest_graph_json(session_id, g.user_id)
        except RuntimeError:
            return jsonify({"error": "Could not load graph"}), 500
        if not graph_data:
            return jsonify({"error": "No graph built yet."}), 404
        profiles = IdeaCreditSystem().compute_graph_credits(graph_data)
        return jsonify({"credit_profiles": profiles, "total": len(profiles)})

    # ── Researcher Profiles ───────────────────────────────────────────────
    @app.route("/api/researcher/<author_id>")
    @require_auth
    def api_researcher_profile(author_id: str):
        cached = db.fetchone(
            "SELECT profile_json FROM researcher_profiles WHERE author_id=%s "
            "AND computed_at > NOW() - INTERVAL '30 days'",
            (author_id,),
        )
        if cached and cached.get("profile_json"):
            return jsonify(cached["profile_json"])

        session_id = session_manager.get_session_id(request)
        try:
            graph_data = _get_latest_graph_json(session_id, g.user_id)
        except RuntimeError:
            return jsonify({"error": "Could not load graph"}), 500
        if not graph_data:
            return jsonify({"error": "No graph built yet."}), 404

        profile = ResearcherProfileBuilder().build_for_author(author_id, graph_data)
        if not profile or profile.get("error"):
            return jsonify({"error": "Researcher not found in current graph"}), 404

        db.execute(
            "INSERT INTO researcher_profiles (author_id, display_name, profile_json) "
            "VALUES (%s, %s, %s::jsonb) "
            "ON CONFLICT (author_id) DO UPDATE SET profile_json=EXCLUDED.profile_json, "
            "display_name=EXCLUDED.display_name, computed_at=NOW()",
            (author_id, profile.get("display_name", ""), json.dumps(profile)),
        )
        return jsonify(profile)

    # ── Literature Review Engine ──────────────────────────────────────────
    @app.route("/api/literature-review", methods=["POST"])
    @require_auth
    def api_literature_review():
        data              = request.get_json(silent=True) or {}
        research_question = (data.get("research_question") or "").strip()
        if not research_question:
            return jsonify({"error": "research_question required"}), 400
        if len(research_question) > 500:
            return jsonify({"error": "research_question too long (max 500 chars)"}), 400

        session_id = session_manager.get_session_id(request)
        try:
            graph_data = _get_latest_graph_json(session_id, g.user_id)
        except RuntimeError:
            graph_data = None

        seed_ids = [n["id"] for n in (graph_data or {}).get("nodes", [])][:10]
        row = db.execute_returning(
            "INSERT INTO literature_review_jobs (user_id, research_question, seed_paper_ids, status) "
            "VALUES (%s::uuid, %s, %s, 'processing') RETURNING job_id::text",
            (g.user_id, research_question, seed_ids),
        )
        job_id = row["job_id"]

        try:
            engine = LiteratureReviewEngine()
            result = engine.generate(research_question, g.user_id,
                                     graph_json=graph_data, seed_paper_ids=seed_ids)
            result_dict = result.to_dict()
            db.execute(
                "UPDATE literature_review_jobs SET status='done', result_json=%s::jsonb, "
                "result_docx_r2=%s, completed_at=NOW() WHERE job_id=%s::uuid",
                (json.dumps(result_dict), result.docx_r2_key, job_id),
            )
            log_action(session_id, "literature_review",
                        {"job_id": job_id, "research_question": research_question[:100]})
            return jsonify({"job_id": job_id, "result": result_dict})
        except Exception as exc:
            db.execute(
                "UPDATE literature_review_jobs SET status='failed', error_message=%s WHERE job_id=%s::uuid",
                (str(exc)[:500], job_id),
            )
            app.logger.error(f"Literature review failed: {exc}")
            return jsonify({"error": "Literature review generation failed"}), 500

    # ── Field Entry Kit ───────────────────────────────────────────────────
    @app.route("/api/field-entry-kit", methods=["POST"])
    @require_auth
    def api_field_entry_kit():
        data              = request.get_json(silent=True) or {}
        research_question = (data.get("research_question") or "").strip()
        if not research_question:
            return jsonify({"error": "research_question required"}), 400

        session_id = session_manager.get_session_id(request)
        try:
            graph_data = _get_latest_graph_json(session_id, g.user_id)
        except RuntimeError:
            return jsonify({"error": "Could not load graph"}), 500
        if not graph_data:
            return jsonify({"error": "No graph built yet."}), 404

        result = FieldEntryKit().generate(graph_data, research_question, g.user_id)
        log_action(session_id, "field_entry_kit", {"research_question": research_question[:100]})
        return jsonify(result)

    # ── Research Risk Analyzer ────────────────────────────────────────────
    @app.route("/api/research-risk", methods=["POST"])
    @require_auth
    def api_research_risk():
        data               = request.get_json(silent=True) or {}
        research_direction = (data.get("research_direction") or "").strip()
        if not research_direction:
            return jsonify({"error": "research_direction required"}), 400

        session_id = session_manager.get_session_id(request)
        try:
            graph_data = _get_latest_graph_json(session_id, g.user_id)
        except RuntimeError:
            return jsonify({"error": "Could not load graph"}), 500
        if not graph_data:
            return jsonify({"error": "No graph built yet."}), 404

        result = ResearchRiskAnalyzer().analyze(graph_data, research_direction)
        log_action(session_id, "research_risk", {"research_direction": research_direction[:100]})
        return jsonify(result)

    # ── Science Journalism Layer (public, no auth) ────────────────────────
    @app.route("/api/journalism/<paper_id>")
    @require_session
    def api_journalism(paper_id: str):
        session_id = g.session_id
        try:
            graph_data = _get_latest_graph_json(session_id, None)
        except RuntimeError:
            graph_data = None

        if not graph_data:
            row = db.fetchone(
                "SELECT graph_json_url FROM graphs WHERE seed_paper_id=%s "
                "ORDER BY created_at DESC LIMIT 1",
                (paper_id,),
            )
            if row:
                try:
                    from backend.r2_client import R2Client
                    graph_data = R2Client().download_json(row["graph_json_url"])
                except Exception:
                    pass

        if not graph_data:
            return jsonify({"error": "No graph available for this paper."}), 404

        result = ScienceJournalismLayer().analyze(graph_data, paper_id)
        return jsonify(result.to_dict())

    # ── Interdisciplinary Translation ─────────────────────────────────────
    @app.route("/api/translation/<seed_paper_id>")
    @require_auth
    def api_interdisciplinary_translation(seed_paper_id: str):
        session_id = session_manager.get_session_id(request)
        try:
            graph_data = _get_latest_graph_json(session_id, g.user_id)
        except RuntimeError:
            return jsonify({"error": "Could not load graph"}), 500
        if not graph_data:
            return jsonify({"error": "No graph built yet."}), 404
        return jsonify(InterdisciplinaryTranslator().translate(graph_data))

    # ── Coverage Report (F7.4) ────────────────────────────────────────────
    @app.route("/api/coverage-report/<path:seed_paper_id>")
    @require_session
    def api_coverage_report(seed_paper_id: str):
        session_id = session_manager.get_session_id(request)
        try:
            graph_data = _get_latest_graph_json(session_id, g.get("user_id"))
        except RuntimeError:
            return jsonify({"error": "Could not load graph"}), 500
        if not graph_data:
            return jsonify({"error": "No graph built yet."}), 404

        metadata = graph_data.get("metadata", {})
        nodes    = graph_data.get("nodes", [])
        total    = len(nodes)
        # Graph JSON stores "abstract_preview" (first 200 chars), not "abstract".
        # Check both keys for robustness — abstract_preview is the primary field.
        with_abstract  = sum(
            1 for n in nodes
            if n.get("abstract_preview") or n.get("abstract")
        )
        coverage_score = metadata.get("coverage_score", with_abstract / max(total, 1))

        return jsonify({
            "total_papers":      total,
            "abstract_coverage": {
                "count": with_abstract, "total": total,
                "pct":   round(with_abstract / max(total, 1) * 100, 1),
            },
            "coverage_score":    round(coverage_score, 3),
            "reliability_label": (
                "HIGH" if coverage_score >= 0.80 else
                "MEDIUM" if coverage_score >= 0.55 else "LOW"
            ),
        })

    # ── Graph Memory routes ───────────────────────────────────────────────
    @app.route("/api/memory/<graph_id>")
    @require_auth
    def api_get_memory(graph_id: str):
        return jsonify(GraphMemoryManager().get_memory(g.user_id, graph_id))

    @app.route("/api/memory/<graph_id>/seen", methods=["POST"])
    @require_auth
    def api_mark_seen(graph_id: str):
        data      = request.get_json(silent=True) or {}
        paper_ids = data.get("paper_ids", [])
        if paper_ids:
            GraphMemoryManager().mark_papers_seen(g.user_id, graph_id, paper_ids)
        return jsonify({"success": True})

    @app.route("/api/memory/<graph_id>/edge-expand", methods=["POST"])
    @require_auth
    def api_expand_edge(graph_id: str):
        data    = request.get_json(silent=True) or {}
        edge_id = data.get("edge_id", "")
        if edge_id:
            GraphMemoryManager().record_edge_expansion(g.user_id, graph_id, edge_id)
        return jsonify({"success": True})

    @app.route("/api/memory/<graph_id>/time-machine", methods=["POST"])
    @require_auth
    def api_update_time_machine(graph_id: str):
        data = request.get_json(silent=True) or {}
        year = data.get("year")
        if year and isinstance(year, int):
            GraphMemoryManager().update_time_machine_position(g.user_id, graph_id, year)
        return jsonify({"success": True})

    @app.route("/api/memory/<graph_id>/pruning", methods=["POST"])
    @require_auth
    def api_record_pruning(graph_id: str):
        data           = request.get_json(silent=True) or {}
        pruned_ids     = data.get("pruned_ids", [])
        result_summary = data.get("result_summary", {})
        if pruned_ids:
            GraphMemoryManager().record_pruning(g.user_id, graph_id, pruned_ids, result_summary)
        return jsonify({"success": True})

    @app.route("/api/memory/<graph_id>/navigation", methods=["POST"])
    @require_auth
    def api_update_navigation(graph_id: str):
        data     = request.get_json(silent=True) or {}
        paper_id = data.get("paper_id", "")
        if paper_id:
            GraphMemoryManager().update_navigation(g.user_id, graph_id, paper_id)
        return jsonify({"success": True})

    # ── Live Mode routes ──────────────────────────────────────────────────
    @app.route("/api/live/subscribe", methods=["POST"])
    @require_auth
    def api_live_subscribe():
        data          = request.get_json(silent=True) or {}
        graph_id      = data.get("graph_id", "")
        seed_paper_id = data.get("seed_paper_id", "")
        alert_events  = data.get("alert_events",
                                  ["new_citation", "paradigm_shift", "gap_filled", "retraction_alert"])
        digest_email  = data.get("digest_email", True)
        if not graph_id or not seed_paper_id:
            return jsonify({"error": "graph_id and seed_paper_id required"}), 400
        sub_id = LiveModeManager().create_subscription(
            g.user_id, graph_id, seed_paper_id, alert_events, digest_email
        )
        return jsonify({"subscription_id": sub_id, "active": True})

    @app.route("/api/live/subscriptions")
    @require_auth
    def api_live_subscriptions():
        return jsonify({"subscriptions": LiveModeManager().get_subscriptions(g.user_id)})

    @app.route("/api/live/cancel", methods=["POST"])
    @require_auth
    def api_live_cancel():
        data     = request.get_json(silent=True) or {}
        graph_id = data.get("graph_id", "")
        success  = LiveModeManager().cancel_subscription(g.user_id, graph_id)
        if not success:
            return jsonify({"error": "No active subscription found for this graph."}), 404
        return jsonify({"success": True})

    @app.route("/api/live/alerts")
    @require_auth
    def api_live_alerts():
        alerts = LiveModeManager().get_unread_alerts(g.user_id)
        return jsonify({"alerts": alerts, "count": len(alerts)})

    @app.route("/api/live/alerts/read", methods=["POST"])
    @require_auth
    def api_live_alerts_read():
        data      = request.get_json(silent=True) or {}
        alert_ids = data.get("alert_ids", [])
        n = LiveModeManager().mark_alerts_read(g.user_id, alert_ids)
        return jsonify({"marked": n})

    # ── Disagreement Flag — Insight ───────────────────────────────────────
    @app.route("/api/flag-insight", methods=["POST"])
    @require_session
    def api_flag_insight():
        data       = request.get_json(silent=True) or {}
        insight_id = data.get("insight_id", "")
        if not insight_id:
            return jsonify({"error": "insight_id required"}), 400

        user_id = g.get("user_id")
        try:
            db.execute(
                "INSERT INTO insight_feedback (insight_id, session_id, user_id, feedback) "
                "VALUES (%s, %s, %s, 'not_helpful') ON CONFLICT DO NOTHING",
                (insight_id, g.session_id, user_id),
            )
        except Exception:
            pass

        count_row = db.fetchone(
            "SELECT COUNT(*) AS n FROM insight_feedback WHERE insight_id=%s AND feedback='not_helpful'",
            (insight_id,),
        )
        flag_count = int(count_row["n"]) if count_row else 0
        return jsonify({"success": True, "total_flags": flag_count, "auto_downgraded": flag_count >= 3})

    # ── Researcher Profile Page ───────────────────────────────────────────
    @app.route("/researcher/<author_id>")
    def researcher_page(author_id: str):
        exists = db.fetchone(
            "SELECT author_id FROM researcher_profiles WHERE author_id=%s", (author_id,)
        )
        return render_template("researcher.html", author_id=author_id,
                               not_found=not exists)

    # ── Science Journalism Page (public) ──────────────────────────────────
    @app.route("/explain/<paper_id>")
    def journalism_page(paper_id: str):
        paper = db.fetchone(
            "SELECT paper_id, title, year, abstract FROM papers WHERE paper_id=%s",
            (paper_id,),
        )
        return render_template("journalism.html", paper=dict(paper) if paper else {})

    app.logger.info("Arivu Phase 8 app ready")
    return app


def _downgrade_tier(original_tier: str, flag_count: int) -> str:
    """Auto-downgrade confidence tier when multiple distinct users flag."""
    tier_order = ["high", "medium", "low", "speculative"]
    if flag_count < 3:
        return original_tier
    idx = tier_order.index(original_tier) if original_tier in tier_order else 1
    new_idx = min(idx + 1, len(tier_order) - 1)
    return tier_order[new_idx]


def _coverage_gate(score: float) -> dict:
    """Determine which features are reliable given the coverage score."""
    return {
        "cross_domain_spark":    True,   # works at any coverage
        "error_propagation":     True,
        "reading_between_lines": score >= 0.40,
        "challenge_generator":   score >= 0.50,
        "idea_credits":          score >= 0.55,
        "researcher_profiles":   score >= 0.55,
        "intellectual_debt":     score >= 0.70,
        "field_entry_kit":       score >= 0.70,
        "literature_review":     score >= 0.80,
    }


def _build_discovery_pathway(relationship: str, context: str) -> dict:
    """Build a guided discovery pathway based on user's relationship to the field."""
    PATHWAYS = {
        "new_field": {
            "suggested_persona": "explorer",
            "primary_feature": {"label": "Intellectual Genealogy Story", "route": "/api/genealogy"},
            "secondary_feature": {"label": "Research DNA Profile", "route": "/api/dna"},
            "tertiary_feature": {"label": "Reading Prioritizer", "route": "/api/reading-prioritizer"},
            "guide_message": "Let me show you how this field evolved. Start with the genealogy story.",
        },
        "writing": {
            "suggested_persona": "innovator",
            "primary_feature": {"label": "Research DNA Profile", "route": "/api/dna"},
            "secondary_feature": {"label": "Citation Audit", "route": "/api/citation-audit"},
            "tertiary_feature": {"label": "Paper Positioning", "route": "/api/paper-positioning"},
            "guide_message": "I'll help you position your contribution. Start with the DNA profile.",
        },
        "reviewing": {
            "suggested_persona": "critic",
            "primary_feature": {"label": "Originality Mapper", "route": "/api/originality"},
            "secondary_feature": {"label": "Citation Audit", "route": "/api/citation-audit"},
            "tertiary_feature": {"label": "Adversarial Reviewer", "route": "/api/adversarial-review"},
            "guide_message": "I'll surface what reviewers look for. Start with originality mapping.",
        },
        "curious": {
            "suggested_persona": "historian",
            "primary_feature": {"label": "Interactive Pruning", "route": "/api/prune"},
            "secondary_feature": {"label": "Time Machine", "route": "/api/time-machine"},
            "tertiary_feature": {"label": "Extinction Events", "route": "/api/time-machine"},
            "guide_message": "Start by removing a foundational paper and watching the field collapse.",
        },
    }
    return PATHWAYS.get(relationship, PATHWAYS["curious"])


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
