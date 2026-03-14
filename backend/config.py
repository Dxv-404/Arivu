"""
config.py — Single source of truth for all environment variables.

Load order:
  1. conftest.py (tests) or app.py caller loads .env via python-dotenv BEFORE
     any module is imported.
  2. Config.__init__() reads from os.environ and hard-exits on missing required vars.

Never call os.environ directly outside this module.
Import the singleton: from backend.config import config
"""
import os
import sys
import logging

logger = logging.getLogger(__name__)


def _require(name: str) -> str:
    """Read a required env var. Exits process with an error if not set."""
    val = os.environ.get(name, "").strip()
    if not val:
        print(
            f"FATAL: Required environment variable '{name}' is not set.\n"
            "Copy .env.example to .env and fill it in.",
            file=sys.stderr,
        )
        sys.exit(1)
    return val


def _optional(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _int(name: str, default: int) -> int:
    """Read an integer env var. Returns default on parse failure."""
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except (ValueError, TypeError):
        return default


def _bool(name: str, default: bool = False) -> bool:
    return os.environ.get(name, str(default)).lower() in ("true", "1", "yes")


class Config:
    """
    Application configuration. Instantiated once at module import time.
    Hard-exits immediately on missing required variables.
    """

    def __init__(self):
        # -- Flask ------------------------------------------------------------
        self.SECRET_KEY: str = _require("FLASK_SECRET_KEY")
        self.DEBUG: bool     = _bool("FLASK_DEBUG", False)
        self.ENV: str        = _optional("FLASK_ENV", "production")

        # -- Database ---------------------------------------------------------
        self.DATABASE_URL: str = _require("DATABASE_URL")
        self.DB_POOL_MIN: int  = _int("DB_POOL_MIN", 2)
        # Neon free tier cap = 10 connections total.
        # With --workers 1 in Procfile, pool of 8 is safe (leaves 2 for scripts).
        # If you scale to --workers 2, set DB_POOL_MAX=4 or upgrade Neon plan.
        self.DB_POOL_MAX: int  = _int("DB_POOL_MAX", 8)

        # -- External APIs ----------------------------------------------------
        self.S2_API_KEY:      str = _optional("S2_API_KEY")
        self.OPENALEX_EMAIL:  str = _optional("OPENALEX_EMAIL")
        self.GROQ_API_KEY:    str = _optional("GROQ_API_KEY")
        self.CORE_API_KEY:    str = _optional("CORE_API_KEY")
        self.PUBPEER_API_KEY: str = _optional("PUBPEER_API_KEY")
        self.CROSSREF_MAILTO: str = _optional("CROSSREF_MAILTO")

        # Groq model names (spec §4.4)
        self.GROQ_FAST_MODEL:  str = _optional("GROQ_FAST_MODEL",  "llama-3.1-8b-instant")
        self.GROQ_SMART_MODEL: str = _optional("GROQ_SMART_MODEL", "llama-3.3-70b-versatile")

        # -- Cloudflare R2 ----------------------------------------------------
        self.R2_ACCOUNT_ID:        str = _optional("R2_ACCOUNT_ID")
        self.R2_ACCESS_KEY_ID:     str = _optional("R2_ACCESS_KEY_ID")
        self.R2_SECRET_ACCESS_KEY: str = _optional("R2_SECRET_ACCESS_KEY")
        self.R2_BUCKET_NAME:       str = _optional("R2_BUCKET_NAME", "arivu-graphs")
        self.R2_ENDPOINT_URL:      str = _optional("R2_ENDPOINT_URL")

        # -- NLP Worker -------------------------------------------------------
        # NLP_WORKER_SECRET: shared secret validated by the NLP worker on every
        # request via "Authorization: Bearer {NLP_WORKER_SECRET}" header.
        # Must match the value in HuggingFace Spaces secrets.
        self.NLP_WORKER_URL:    str = _optional("NLP_WORKER_URL", "http://localhost:7860")
        self.NLP_WORKER_SECRET: str = _optional("NLP_WORKER_SECRET")

        # -- Auth -------------------------------------------------------------
        self.HCAPTCHA_SITE_KEY:   str = _optional("HCAPTCHA_SITE_KEY")
        self.HCAPTCHA_SECRET_KEY: str = _optional("HCAPTCHA_SECRET_KEY")

        # -- Email / Payments / Monitoring ------------------------------------
        self.RESEND_API_KEY:        str = _optional("RESEND_API_KEY")
        self.STRIPE_SECRET_KEY:     str = _optional("STRIPE_SECRET_KEY")
        self.STRIPE_WEBHOOK_SECRET: str = _optional("STRIPE_WEBHOOK_SECRET")
        self.SENTRY_DSN:            str = _optional("SENTRY_DSN")

        # -- Translation ------------------------------------------------------
        self.LIBRETRANSLATE_URL: str = _optional(
            "LIBRETRANSLATE_URL", "https://libretranslate.com"
        )
        self.LIBRETRANSLATE_KEY: str = _optional("LIBRETRANSLATE_KEY")

        # -- NLP pipeline tuning ----------------------------------------------
        self.NLP_SIMILARITY_THRESHOLD: float = float(
            _optional("NLP_SIMILARITY_THRESHOLD", "0.25")
        )
        self.NLP_BATCH_SIZE:     int = _int("NLP_BATCH_SIZE", 5)
        self.NLP_WORKER_TIMEOUT: int = _int("NLP_WORKER_TIMEOUT", 30)

        # -- Graph building ---------------------------------------------------
        self.MAX_GRAPH_DEPTH:    int = _int("MAX_GRAPH_DEPTH", 2)
        self.MAX_REFS_PER_PAPER: int = _int("MAX_REFS_PER_PAPER", 50)
        self.MAX_GRAPH_SIZE:     int = _int("MAX_GRAPH_SIZE", 600)
        self.GRAPH_CACHE_TTL_DAYS: int = _int("GRAPH_CACHE_TTL_DAYS", 7)

    # -- Derived feature flags (read-only properties) -------------------------

    @property
    def GROQ_ENABLED(self) -> bool:
        return bool(self.GROQ_API_KEY)

    @property
    def R2_ENABLED(self) -> bool:
        return bool(
            self.R2_ACCOUNT_ID
            and self.R2_ACCESS_KEY_ID
            and self.R2_SECRET_ACCESS_KEY
        )

    @property
    def NLP_WORKER_ENABLED(self) -> bool:
        return bool(self.NLP_WORKER_URL)


# Module-level singleton.
# _require() fires inside __init__, so the process exits immediately at startup
# if required vars are missing.
# conftest.py must call load_dotenv() BEFORE this module is imported in tests.
config = Config()
