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
from pathlib import Path

from dotenv import load_dotenv

# Load .env from project root (parent of backend/) before reading any env vars.
# In production (Koyeb), real env vars are already set; load_dotenv() is a no-op.
_env_path = Path(__file__).parent.parent / ".env"
load_dotenv(_env_path)

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

    # ── Unauthenticated S2 fallback: cap graph size to stay within
    # 1 req/sec rate limit when no API key is configured.
    # Lifts automatically once S2_API_KEY is set in environment.
    if not os.environ.get("S2_API_KEY"):
        MAX_REFS_PER_PAPER = min(MAX_REFS_PER_PAPER, 15)
        MAX_GRAPH_DEPTH    = min(MAX_GRAPH_DEPTH, 1)

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

    # ── Email / Resend (Phase 6+) ─────────────────────────────────
    RESEND_API_KEY      = os.environ.get("RESEND_API_KEY", "")
    EMAIL_FROM          = os.environ.get("EMAIL_FROM", "noreply@arivu.app")
    EMAIL_FROM_NAME     = os.environ.get("EMAIL_FROM_NAME", "Arivu")

    # ── Payments / Stripe (Phase 6+) ──────────────────────────────
    STRIPE_SECRET_KEY           = os.environ.get("STRIPE_SECRET_KEY", "")
    STRIPE_PUBLISHABLE_KEY      = os.environ.get("STRIPE_PUBLISHABLE_KEY", "")
    STRIPE_WEBHOOK_SECRET       = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
    STRIPE_RESEARCHER_PRICE_ID  = os.environ.get("STRIPE_RESEARCHER_PRICE_ID", "")
    STRIPE_LAB_PRICE_ID         = os.environ.get("STRIPE_LAB_PRICE_ID", "")

    # ── Custom Domain (Phase 5+) ──────────────────────────────────
    CUSTOM_DOMAIN       = os.environ.get("CUSTOM_DOMAIN", "arivu.app")

    # ── Translation ───────────────────────────────────────────────
    LIBRETRANSLATE_URL  = os.environ.get("LIBRETRANSLATE_URL", "https://libretranslate.com")
    LIBRETRANSLATE_KEY  = os.environ.get("LIBRETRANSLATE_KEY", "")

    # ── Phase 7 — Webhooks, API, Uploads ─────────────────────────
    WEBHOOK_SIGNING_SECRET = os.environ.get("WEBHOOK_SIGNING_SECRET", "")
    API_BASE_URL           = os.environ.get("API_BASE_URL", "https://arivu.app")
    MAX_UPLOAD_MB          = int(os.environ.get("MAX_UPLOAD_MB", "10"))

    # ── Phase 8 — Retraction Watch, PubPeer, Live Mode ─────────
    RETRACTION_WATCH_CSV_URL = os.environ.get("RETRACTION_WATCH_CSV_URL", "")
    LIVE_MODE_ENABLED        = os.environ.get("LIVE_MODE_ENABLED", "false").lower() == "true"

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
    def stripe_enabled(cls) -> bool:
        """Always call as Config.stripe_enabled() — lowercase to prevent bare truthy bug."""
        return bool(cls.STRIPE_SECRET_KEY and cls.STRIPE_WEBHOOK_SECRET)

    @classmethod
    def email_enabled(cls) -> bool:
        """Always call as Config.email_enabled() — lowercase to prevent bare truthy bug."""
        return bool(cls.RESEND_API_KEY)

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

        if not cls.WEBHOOK_SIGNING_SECRET:
            logger.warning("Config: WEBHOOK_SIGNING_SECRET not set — webhook subscriptions will use random per-subscription secrets only")

        if cls.LIVE_MODE_ENABLED and not cls.RETRACTION_WATCH_CSV_URL:
            logger.warning("LIVE_MODE_ENABLED=true but RETRACTION_WATCH_CSV_URL not set — retraction sync will fail")

        if cls.ENABLE_AUTH:
            # STRIPE_SECRET_KEY warning removed — billing dormant (ADR-016).
            for var, msg in {
                "RESEND_API_KEY":     "Email disabled — auth emails will fail",
                "HCAPTCHA_SITE_KEY":  "hCaptcha disabled",
            }.items():
                if not getattr(cls, var, ""):
                    logger.warning(f"Config: {var} not set — {msg}")


# ── Backward-compatibility alias ──────────────────────────────────────────────
# Phase 1/2/3 code imports: from backend.config import config (lowercase)
# Phase 4 uses:             from backend.config import Config (uppercase class)
# This alias makes both identical — config.SECRET_KEY == Config.SECRET_KEY
config = Config
