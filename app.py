"""
app.py — Arivu Flask application entry point.

Phase 1: app factory + /health route only.
All other routes are added in subsequent phases.

NEVER import sentence_transformers, torch, or any ML library here.
Those belong exclusively in nlp_worker/app.py.
"""
import logging
import os

from flask import Flask, jsonify
from flask_cors import CORS

from backend.config import config
from backend.db import health_check, init_pool
from exceptions import ArivuError, register_error_handlers


def _configure_cors(app: Flask) -> None:
    """Configure CORS per spec §4.5."""
    if config.DEBUG:
        CORS(
            app,
            origins=["http://localhost:3000", "http://localhost:5000"],
            supports_credentials=True,
        )
    else:
        CORS(
            app,
            origins=["https://arivu.app", "https://www.arivu.app"],
            supports_credentials=True,
            allow_headers=["Content-Type", "X-Session-ID"],
            methods=["GET", "POST", "OPTIONS"],
        )


# NLP worker health cached for 30s — prevents the /health route from making
# a 3-second outbound HTTP call on every Koyeb health check probe.
_NLP_HEALTH: dict = {"ok": False, "checked_at": 0.0}
_NLP_HEALTH_TTL: float = 30.0  # seconds


def _nlp_worker_reachable() -> bool:
    """
    Return True if the NLP worker /health responds with 200.
    Result is cached for _NLP_HEALTH_TTL seconds.
    Never raises — catches all exceptions.
    """
    import time
    import requests as req

    now = time.monotonic()
    if now - _NLP_HEALTH["checked_at"] < _NLP_HEALTH_TTL:
        return _NLP_HEALTH["ok"]

    try:
        resp = req.get(f"{config.NLP_WORKER_URL}/health", timeout=3)
        result = resp.status_code == 200
    except Exception:
        result = False

    _NLP_HEALTH["ok"] = result
    _NLP_HEALTH["checked_at"] = now
    return result


def create_app() -> Flask:
    """
    Flask application factory.
    Gunicorn invocation: gunicorn "app:create_app()"
    Test invocation: app = create_app(); client = app.test_client()
    """
    app = Flask(__name__)
    app.secret_key = config.SECRET_KEY

    # Logging is configured INSIDE the factory — never at module level.
    # Module-level logging.basicConfig would run at import time and access
    # config.DEBUG before load_dotenv() has been called.
    logging.basicConfig(
        level=logging.DEBUG if config.DEBUG else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s - %(message)s",
    )
    logger = logging.getLogger(__name__)

    # CORS
    _configure_cors(app)

    # Database pool
    init_pool(
        database_url=config.DATABASE_URL,
        minconn=config.DB_POOL_MIN,
        maxconn=config.DB_POOL_MAX,
    )
    logger.info("Database pool ready")

    # NLP worker startup check (non-fatal — expected to fail in Phase 1)
    if not _nlp_worker_reachable():
        logger.warning(
            f"NLP worker at {config.NLP_WORKER_URL} is not reachable. "
            "Expected in Phase 1 — worker is added in Phase 2."
        )

    # Error handlers
    register_error_handlers(app)

    # ---- Routes -------------------------------------------------------------

    @app.route("/health")
    def health():
        """
        Health check endpoint.
        HTTP 200 if DB is reachable; HTTP 503 if not.
        NLP worker status is informational — does not affect HTTP status code.
        Used by Koyeb health probes and the smoke test.
        """
        db_ok  = health_check()
        nlp_ok = _nlp_worker_reachable()
        status = "ok" if db_ok else "degraded"
        return jsonify({
            "status":     status,
            "db":         db_ok,
            "nlp_worker": nlp_ok,
            "version":    "1.0.0",
        }), 200 if db_ok else 503

    logger.info("Arivu app created successfully")
    return app


if __name__ == "__main__":
    application = create_app()
    application.run(
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 5000)),
        debug=config.DEBUG,
    )
