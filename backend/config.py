"""
backend/config.py

Application configuration. All values from environment variables.
Required vars raise RuntimeError at startup. Optional vars degrade gracefully.

Usage (Phase 4 style):    from backend.config import Config; Config.S2_API_KEY
Usage (Phase 1/2/3 style): from backend.config import config; config.S2_API_KEY
Both work — config = Config alias at bottom makes them identical.
"""
import os
import logging

logger = logging.getLogger(__name__)


class Config:
    # ── Flask ─────────────────────────────────────────────────────
    SECRET_KEY          = os.environ.get("FLASK_SECRET_KEY", "dev-insecure-change-in-prod")
    DEBUG               = os.environ.get("FLASK_DEBUG", "false").lower() == "true"

    # ── Database ──────────────────────────────────────────────────
    DATABASE_URL        = os.environ.get("DATABASE_URL", "")

    # ── DB Pool (sized for --workers 2 on Neon free tier) ─────────
    # Neon free cap = 10 connections.
    # With --workers 2: DB_POOL_MAX=4 → 2×4=8 active + 2 for scripts = 10 ✅
    # If you change --workers, adjust DB_POOL_MAX accordingly.
    DB_POOL_MIN         = int(os.environ.get("DB_POOL_MIN", "1"))
    DB_POOL_MAX         = int(os.environ.get("DB_POOL_MAX", "4"))

    # ── External APIs ─────────────────────────────────────────────
    S2_API_KEY          = os.environ.get("S2_API_KEY", "")
    OPENALEX_EMAIL      = os.environ.get("OPENALEX_EMAIL", "")
    CROSSREF_MAILTO     = os.environ.get("CROSSREF_MAILTO", "")
    GROQ_API_KEY        = os.environ.get("GROQ_API_KEY", "")
    CORE_API_KEY        = os.environ.get("CORE_API_KEY", "")
    PUBPEER_API_KEY     = os.environ.get("PUBPEER_API_KEY", "")

    # Groq model names
    GROQ_FAST_MODEL     = os.environ.get("GROQ_FAST_MODEL",  "llama-3.1-8b-instant")
    GROQ_SMART_MODEL    = os.environ.get("GROQ_SMART_MODEL", "llama-3.3-70b-versatile")

    # ── Cloudflare R2 ─────────────────────────────────────────────
    # Phase 4 canonical name: "arivu-data"
    # Phase 1 defaulted to "arivu-graphs" — set R2_BUCKET_NAME in env if already created.
    R2_ACCOUNT_ID       = os.environ.get("R2_ACCOUNT_ID", "")
    R2_ACCESS_KEY_ID    = os.environ.get("R2_ACCESS_KEY_ID", "")
    R2_SECRET_ACCESS_KEY = os.environ.get("R2_SECRET_ACCESS_KEY", "")
    R2_BUCKET_NAME      = os.environ.get("R2_BUCKET_NAME", "arivu-data")
    R2_ENDPOINT_URL     = os.environ.get("R2_ENDPOINT_URL", "")

    # ── NLP Worker ────────────────────────────────────────────────
    NLP_WORKER_URL      = os.environ.get("NLP_WORKER_URL", "http://localhost:7860")
    # Renamed from NLP_WORKER_SECRET in Phase 4. nlp_worker/app.py supports both names.
    WORKER_SECRET       = (os.environ.get("WORKER_SECRET", "")
                           or os.environ.get("NLP_WORKER_SECRET", ""))
    # Backward compat alias for Phase 1/2/3 code that uses config.NLP_WORKER_SECRET
    NLP_WORKER_SECRET   = WORKER_SECRET
    # Increased from Phase 1's 30s — HF Spaces cold starts can take 60-90s.
    NLP_WORKER_TIMEOUT  = int(os.environ.get("NLP_WORKER_TIMEOUT", "90"))

    # ── NLP Pipeline Tuning ───────────────────────────────────────
    NLP_SIMILARITY_THRESHOLD = float(os.environ.get("NLP_SIMILARITY_THRESHOLD", "0.25"))
    NLP_BATCH_SIZE      = int(os.environ.get("NLP_BATCH_SIZE", "5"))

    # ── Graph Building ────────────────────────────────────────────
    MAX_GRAPH_DEPTH     = int(os.environ.get("MAX_GRAPH_DEPTH", "2"))
    MAX_REFS_PER_PAPER  = int(os.environ.get("MAX_REFS_PER_PAPER", "50"))
    MAX_GRAPH_SIZE      = int(os.environ.get("MAX_GRAPH_SIZE", "600"))
    GRAPH_CACHE_TTL_DAYS = int(os.environ.get("GRAPH_CACHE_TTL_DAYS", "7"))

    # ── Deployment ────────────────────────────────────────────────
    # Set AFTER first Koyeb deploy — used for CORS allow-list.
    # Value: hostname only, no https://. Example: my-app-abc123.koyeb.app
    KOYEB_PUBLIC_DOMAIN = os.environ.get("KOYEB_PUBLIC_DOMAIN", "")

    # ── Error Tracking ────────────────────────────────────────────
    SENTRY_DSN          = os.environ.get("SENTRY_DSN", "")

    # ── Feature Flags ─────────────────────────────────────────────
    # Auth is NOT implemented in Phase 4. Leave this false.
    ENABLE_AUTH         = os.environ.get("ENABLE_AUTH", "false").lower() == "true"

    # ── Auth / hCaptcha (Phase 6+) ────────────────────────────────
    HCAPTCHA_SITE_KEY   = os.environ.get("HCAPTCHA_SITE_KEY", "")
    HCAPTCHA_SECRET_KEY = os.environ.get("HCAPTCHA_SECRET_KEY", "")

    # ── Email / Payments / Monitoring (Phase 6+) ──────────────────
    RESEND_API_KEY      = os.environ.get("RESEND_API_KEY", "")
    STRIPE_SECRET_KEY   = os.environ.get("STRIPE_SECRET_KEY", "")
    STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")

    # ── Translation ───────────────────────────────────────────────
    LIBRETRANSLATE_URL  = os.environ.get("LIBRETRANSLATE_URL", "https://libretranslate.com")
    LIBRETRANSLATE_KEY  = os.environ.get("LIBRETRANSLATE_KEY", "")

    # ── Derived properties ────────────────────────────────────────
    @classmethod
    def R2_ENABLED(cls) -> bool:
        return bool(cls.R2_ACCOUNT_ID and cls.R2_ACCESS_KEY_ID and cls.R2_SECRET_ACCESS_KEY)

    @classmethod
    def GROQ_ENABLED(cls) -> bool:
        return bool(cls.GROQ_API_KEY)

    @property
    def NLP_WORKER_ENABLED(self) -> bool:
        return bool(self.NLP_WORKER_URL)

    @classmethod
    def validate(cls) -> None:
        """Called at app startup. Raises if DATABASE_URL missing. Logs warnings for others."""
        if not cls.DATABASE_URL:
            raise RuntimeError(
                "DATABASE_URL is required.\n"
                "For Neon: postgresql://user:pass@host.neon.tech/arivu?sslmode=require"
            )
        recommended = {
            "NLP_WORKER_URL":     "NLP features disabled — graph builds use abstract-only analysis",
            "GROQ_API_KEY":       "LLM disabled — genealogy and cluster labels use templates",
            "R2_ENDPOINT_URL":    "R2 disabled — graphs stored in DB only (limited capacity)",
            "SENTRY_DSN":         "Error tracking disabled",
            "S2_API_KEY":         "Using unauthenticated S2 API — lower rate limits",
            "WORKER_SECRET":      "NLP worker unauthenticated — OK locally, insecure in prod",
            "KOYEB_PUBLIC_DOMAIN": "CORS not configured for production domain — set after first deploy",
        }
        for var, msg in recommended.items():
            if not getattr(cls, var, ""):
                logger.warning(f"Config: {var} not set — {msg}")


# ── Backward-compatibility alias ──────────────────────────────────────────────
# Phase 1/2/3 code imports: from backend.config import config (lowercase)
# Phase 4 uses:             from backend.config import Config (uppercase class)
# This alias makes both identical — config.SECRET_KEY == Config.SECRET_KEY
config = Config
