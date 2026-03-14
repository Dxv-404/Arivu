# PHASE 1 — Project Skeleton, Schema & Health Check
## Version 2 — All 48 gaps resolved

## Before You Start
1. Read `CLAUDE.md` — git rules and architecture non-negotiables apply throughout.
2. Read `CONTEXT.md` — check if any work is already done before starting.
3. This file is the **only** spec you need right now. Do not open `PHASE_2.md` or any other phase file.
4. **Local dev requires Docker for Postgres.** See §30 step 0 before anything else.

---

## What Phase 1 Produces
When this phase is complete:
- Every file and directory in the project structure exists (stubs where noted)
- PostgreSQL is connected, schema applied, all **17** required tables verified
- `GET /health` returns HTTP 200 with `{"status": "ok", "db": true, ...}`
- `python -m pytest tests/test_smoke.py -v` passes all three tests
- Two git commits exist on `main`

Nothing else. Zero business logic beyond the health check.

---

## Complete File Manifest

Every file is listed below. **No file exists unless it appears in this list.**
Create them in the order shown.

### Root files — real implementation
```
app.py
exceptions.py
conftest.py
pytest.ini
requirements.txt
requirements-nlp-worker.txt
requirements-dev.txt
Procfile
runtime.txt
Dockerfile
.dockerignore
.env.example
.gitignore
README.md
CONTEXT.md
DECISIONS.md
```

### backend/ — real implementation
```
backend/__init__.py          <- empty package marker (one comment line only)
backend/config.py
backend/db.py
backend/models.py            <- NEW: Paper + EdgeAnalysis dataclasses + constants
backend/schemas.py
backend/utils.py
```

### backend/ — stubs (see §STUBS for exact template)
```
backend/api_client.py
backend/normalizer.py
backend/deduplicator.py
backend/nlp_pipeline.py
backend/graph_engine.py
backend/pruning.py
backend/dna_profiler.py
backend/diversity_scorer.py
backend/orphan_detector.py
backend/gap_finder.py
backend/living_paper_scorer.py
backend/paradigm_detector.py
backend/originality_mapper.py
backend/llm_client.py
backend/chat_guide.py
backend/prompt_sanitizer.py
backend/r2_client.py
backend/session_manager.py
backend/rate_limiter.py
backend/security.py
backend/quality_monitor.py
backend/export_generator.py
```

### nlp_worker/ — real implementation
```
nlp_worker/__init__.py       <- empty package marker (one comment line only)
nlp_worker/app.py
nlp_worker/requirements.txt
nlp_worker/Dockerfile
nlp_worker/README.md
```

### scripts/
```
scripts/__init__.py          <- empty package marker (one comment line only)
scripts/migrate.py           <- real implementation
scripts/precompute_gallery.py  <- stub
scripts/load_retraction_watch.py  <- stub
scripts/benchmark_nlp.py    <- stub
scripts/test_pipeline.py    <- stub
scripts/ground_truth_eval.py  <- stub
```

### tests/
```
tests/__init__.py            <- empty package marker (one comment line only)
tests/test_smoke.py
```

### static/ — empty stubs (one CSS/JS comment line only)
```
static/css/style.css
static/css/graph.css
static/css/panels.css
static/css/loading.css
static/js/api.js
static/js/graph.js
static/js/pruning.js
static/js/panels.js
static/js/loader.js
static/js/landing-demo.js
static/js/tooltip.js
static/js/semantic-zoom.js
static/js/leaderboard.js
static/js/orphans.js
static/js/chat.js
static/js/insight-feed.js
static/js/accessibility.js
static/js/timeline.js         <- stub — Layer 2 (not Phase 3)
static/js/constellation.js    <- stub — Layer 2 (not Phase 3)
static/assets/favicon.svg
static/assets/og-image.png    <- placeholder 1x1 PNG; real asset added in Phase 5
```

### templates/ — empty stubs (HTML comment only)
```
templates/base.html
templates/index.html
templates/tool.html
templates/explore.html
```

### data/
```
data/precomputed/gallery_index.json
data/.gitkeep
data/retraction_watch.csv    <- empty placeholder; populated by load_retraction_watch.py
```

---

## §STUBS — Stub File Templates

Every backend stub uses **one of two** templates depending on scope:

**In-scope stub** (fill `<FileName>`, `<description>`, `<N>`):
```python
"""
<FileName> — <one-line description from CLAUDE.md>.
Implemented in Phase <N>.
"""
# TODO: Phase <N>
```

**Out-of-scope stub** (gap_finder, living_paper_scorer, paradigm_detector, originality_mapper):
```python
"""
<FileName> — <one-line description from CLAUDE.md>.
OUT OF SCOPE — v1. Stub only.
"""
# OUT OF SCOPE — v1
```

Stub phase mapping:

| File | Description | Phase |
|---|---|---|
| `api_client.py` | SmartPaperResolver: S2 + OpenAlex HTTP calls | 2 |
| `normalizer.py` | Input normalization: DOI/arXiv/URL/title parsing | 2 |
| `deduplicator.py` | PaperDeduplicator: canonical paper record across sources | 2 |
| `nlp_pipeline.py` | InheritanceDetector — calls NLP worker via HTTP, NO model loading | 2 |
| `graph_engine.py` | AncestryGraph: BFS crawl, NetworkX graph, export_to_json | 2 |
| `pruning.py` | Stateless pruning: compute_pruning, compute_all_pruning_impacts | 3 |
| `dna_profiler.py` | DNAProfiler: consensus clustering, donut chart data | 4 |
| `diversity_scorer.py` | DiversityScorer: 4-component score, radar chart data | 4 |
| `orphan_detector.py` | OrphanDetector: peaked-and-faded concept detection | 4 |
| `gap_finder.py` | GapFinder: pgvector semantic search — OUT OF SCOPE v1 | — |
| `living_paper_scorer.py` | LivingPaperScore: quality-weighted influence — OUT OF SCOPE v1 | — |
| `paradigm_detector.py` | ParadigmShiftDetector — OUT OF SCOPE v1 | — |
| `originality_mapper.py` | OriginalityMapper: Pioneer/Synthesizer/Bridge/Refiner — OUT OF SCOPE v1 | — |
| `llm_client.py` | ArivuLLMClient: Groq wrapper + DB cache | 4 |
| `chat_guide.py` | ChatGuide: AI guide context-aware responses | 4 |
| `prompt_sanitizer.py` | PromptSanitizer: injection prevention for LLM calls | 4 |
| `r2_client.py` | Cloudflare R2 wrapper (boto3 S3-compatible) | 2 |
| `session_manager.py` | SessionManager: anonymous sessions, secure cookie | 2 |
| `rate_limiter.py` | CoordinatedRateLimiter: token bucket per API | 2 |
| `security.py` | SecureFileUploadHandler: PDF validation, magic bytes check | 4 |
| `quality_monitor.py` | ProductionQualityMonitor: edge quality metrics, alert thresholds | 6 |
| `export_generator.py` | Export format generators: JSON, CSV, SVG, PDF | 5 |

---

**Special case — `session_manager.py`** must include a pass-through decorator:

```python
"""
session_manager.py — SessionManager: anonymous sessions, secure cookie.
Implemented in Phase 2.
"""
from functools import wraps
from flask import request, g


def require_session(f):
    """
    Phase 2 TODO: validate session cookie, set g.session_id, create anonymous
    session in DB if needed.
    Phase 1 stub: passes through unconditionally — no DB write, no validation.
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        g.session_id = request.cookies.get("arivu_session", "anon")
        return f(*args, **kwargs)
    return decorated


# TODO: Phase 2 — full SessionManager class
```

**Special case — `rate_limiter.py`** must define class names:

```python
"""
rate_limiter.py — CoordinatedRateLimiter: token bucket per API + ArivuRateLimiter.
Implemented in Phase 2.
"""


class CoordinatedRateLimiter:
    """Phase 2 TODO: token bucket limiter per external API source."""
    pass


class ArivuRateLimiter:
    """Phase 2 TODO: per-session/IP request rate limiting for Arivu endpoints."""
    pass


# TODO: Phase 2
```

**Empty package markers** — `backend/__init__.py`, `nlp_worker/__init__.py`,
`scripts/__init__.py`, `tests/__init__.py` — must each contain exactly:

```python
# Arivu package marker — do not add imports here
```

---

## §1 — exceptions.py

Complete exception hierarchy. Every exception Arivu raises is one of these.

```python
"""
exceptions.py — Custom exception hierarchy for Arivu.

All exceptions inherit from ArivuError. Flask's error handler catches
ArivuError and returns the correct HTTP status code and JSON body.
"""
import logging

logger = logging.getLogger(__name__)


# ---- Base -------------------------------------------------------------------

class ArivuError(Exception):
    """Base class for all Arivu errors. Carries HTTP status and error code."""
    def __init__(
        self,
        message: str,
        code: str = "INTERNAL_ERROR",
        status_code: int = 500,
        details: dict = None,
    ):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code
        self.details = details or {}

    def to_dict(self) -> dict:
        return {
            "error": self.code,
            "message": self.message,
            "details": self.details,
        }


# ---- Paper Resolution -------------------------------------------------------

class PaperNotFoundError(ArivuError):
    """Paper could not be found in any data source."""
    def __init__(self, identifier: str):
        super().__init__(
            message=f"Paper not found: {identifier}",
            code="PAPER_NOT_FOUND",
            status_code=404,
            details={"identifier": identifier},
        )


class PaperResolutionError(ArivuError):
    """Paper lookup encountered an error (API down, timeout, etc.)."""
    def __init__(self, identifier: str, reason: str):
        super().__init__(
            message=f"Could not resolve paper '{identifier}': {reason}",
            code="PAPER_RESOLUTION_ERROR",
            status_code=503,
            details={"identifier": identifier, "reason": reason},
        )


class NoAbstractError(ArivuError):
    """Paper exists but has no usable abstract from any source."""
    def __init__(self, paper_id: str):
        super().__init__(
            message=f"Paper {paper_id} has no abstract available from any source",
            code="NO_ABSTRACT",
            status_code=422,
            details={"paper_id": paper_id},
        )


# ---- Graph Building ---------------------------------------------------------

class GraphBuildError(ArivuError):
    """Fatal error during graph construction."""
    def __init__(self, seed_paper_id: str, reason: str):
        super().__init__(
            message=f"Graph build failed for {seed_paper_id}: {reason}",
            code="GRAPH_BUILD_ERROR",
            status_code=500,
            details={"seed_paper_id": seed_paper_id, "reason": reason},
        )


class GraphTooLargeError(ArivuError):
    """Graph would exceed safe rendering limits."""
    def __init__(self, estimated_size: int, limit: int):
        super().__init__(
            message=f"Graph would contain ~{estimated_size} papers, exceeding limit of {limit}",
            code="GRAPH_TOO_LARGE",
            status_code=422,
            details={"estimated_size": estimated_size, "limit": limit},
        )


class EmptyGraphError(ArivuError):
    """Paper has no references — graph cannot be built."""
    def __init__(self, paper_id: str):
        super().__init__(
            message=f"Paper {paper_id} has no references — cannot build ancestry graph",
            code="EMPTY_GRAPH",
            status_code=422,
            details={"paper_id": paper_id},
        )


# ---- NLP Worker -------------------------------------------------------------

class NLPWorkerError(ArivuError):
    """NLP worker service unavailable or returned an error."""
    def __init__(self, operation: str, reason: str):
        super().__init__(
            message=f"NLP operation '{operation}' failed: {reason}",
            code="NLP_WORKER_ERROR",
            status_code=503,
            details={"operation": operation, "reason": reason},
        )


class NLPTimeoutError(NLPWorkerError):
    """NLP worker took too long to respond."""
    def __init__(self, operation: str, timeout_seconds: int):
        super().__init__(operation, f"timed out after {timeout_seconds}s")
        self.code = "NLP_TIMEOUT"


# ---- Auth & Permissions -----------------------------------------------------

class AuthenticationError(ArivuError):
    """User is not authenticated."""
    def __init__(self):
        super().__init__(
            message="Authentication required",
            code="AUTHENTICATION_REQUIRED",
            status_code=401,
        )


class AuthorizationError(ArivuError):
    """User does not have the required tier."""
    def __init__(self, required_tier: str, current_tier: str):
        super().__init__(
            message=f"This feature requires the '{required_tier}' plan",
            code="INSUFFICIENT_TIER",
            status_code=403,
            details={
                "required_tier": required_tier,
                "current_tier": current_tier,
                "upgrade_url": "/pricing",
            },
        )


class GraphLimitReachedError(ArivuError):
    """Free user has reached their monthly graph limit."""
    def __init__(self, limit: int, reset_date: str):
        super().__init__(
            message=f"You've used all {limit} graphs for this month",
            code="GRAPH_LIMIT_REACHED",
            status_code=429,
            details={"limit": limit, "reset_date": reset_date, "upgrade_url": "/pricing"},
        )


# ---- Rate Limiting ----------------------------------------------------------

class RateLimitError(ArivuError):
    """Request rate limit exceeded on Arivu's own endpoints."""
    def __init__(self, endpoint: str, retry_after: int):
        super().__init__(
            message=f"Rate limit exceeded for {endpoint}. Retry after {retry_after} seconds.",
            code="RATE_LIMIT_EXCEEDED",
            status_code=429,
            details={"endpoint": endpoint, "retry_after": retry_after},
        )


# ---- External APIs ----------------------------------------------------------

class ExternalAPIError(ArivuError):
    """An external API (S2, OpenAlex, etc.) returned an error."""
    def __init__(self, api_name: str, upstream_status: int, message: str):
        super().__init__(
            message=f"{api_name} returned {upstream_status}: {message}",
            code="EXTERNAL_API_ERROR",
            status_code=502,
            details={"api": api_name, "upstream_status": upstream_status},
        )


class ExternalAPIRateLimitError(ExternalAPIError):
    """An external API returned 429 Too Many Requests."""
    def __init__(self, api_name: str, retry_after: int = None):
        super().__init__(api_name, 429, "Rate limit exceeded")
        self.code = "UPSTREAM_RATE_LIMITED"
        self.retry_after = retry_after


# ---- Storage ----------------------------------------------------------------

class StorageError(ArivuError):
    """Cloudflare R2 or file storage operation failed."""
    def __init__(self, operation: str, key: str, reason: str):
        super().__init__(
            message=f"Storage {operation} failed for '{key}': {reason}",
            code="STORAGE_ERROR",
            status_code=500,
            details={"operation": operation, "key": key},
        )


# ---- Validation -------------------------------------------------------------

class ValidationError(ArivuError):
    """Request input failed validation."""
    def __init__(self, field: str, message: str):
        super().__init__(
            message=f"Validation error: {message}",
            code="VALIDATION_ERROR",
            status_code=400,
            details={"field": field},
        )


# ---- Flask Error Handler Registration ---------------------------------------

def register_error_handlers(app):
    """Register all Arivu error types with the Flask app."""
    from flask import jsonify

    @app.errorhandler(ArivuError)
    def handle_arivu_error(e: ArivuError):
        return jsonify(e.to_dict()), e.status_code

    @app.errorhandler(404)
    def handle_404(e):
        return jsonify({"error": "NOT_FOUND", "message": "Page not found"}), 404

    @app.errorhandler(500)
    def handle_500(e):
        logger.error(f"Unhandled exception: {e}", exc_info=True)
        return jsonify({"error": "INTERNAL_ERROR", "message": "An unexpected error occurred"}), 500
```

---

## §2 — backend/models.py  ← NEW FILE

This file did not exist in earlier drafts. It provides the canonical Python
data models and constants used by every subsequent phase. Create it now so
Phase 2+ imports resolve without modification.

```python
"""
models.py — Canonical Python data models for Arivu.

These dataclasses mirror the DB schema and are the single source of truth
for data shapes passed between backend modules. Import from here; never
redefine these shapes elsewhere.
"""
from dataclasses import dataclass, field
from typing import Optional


# ---- Constants --------------------------------------------------------------

# All 7 mutation types used in EdgeAnalysis.mutation_type.
# Never use a string not in this tuple.
MUTATION_TYPES = (
    "adoption",        # Direct use of technique/method
    "generalization",  # Extended to broader application
    "specialization",  # Narrowed to specific domain
    "hybridization",   # Combined with another concept
    "contradiction",   # Explicitly challenges the cited work
    "revival",         # Brings back a previously dormant idea
    "incidental",      # Cited in passing; not central to the work
)

# All 7 citation intent types used in EdgeAnalysis.citation_intent.
CITATION_INTENTS = (
    "methodological_adoption",
    "theoretical_foundation",
    "empirical_baseline",
    "conceptual_inspiration",
    "direct_contradiction",
    "incidental_mention",
    "negative_citation",
)

# Confidence tier labels. confidence_tier is ALWAYS a string — never an int.
CONFIDENCE_TIERS = ("HIGH", "MEDIUM", "LOW", "SPECULATIVE")


def get_confidence_tier(confidence: float) -> str:
    """
    Convert a 0.0-1.0 float confidence score to a string tier label.

    Thresholds (spec §8.4):
        HIGH        >= 0.75
        MEDIUM      >= 0.55
        LOW         >= 0.35
        SPECULATIVE  < 0.35

    Returns one of the CONFIDENCE_TIERS strings. Never returns an integer.
    """
    if confidence >= 0.75:
        return "HIGH"
    elif confidence >= 0.55:
        return "MEDIUM"
    elif confidence >= 0.35:
        return "LOW"
    else:
        return "SPECULATIVE"


# ---- Paper ------------------------------------------------------------------

@dataclass
class Paper:
    """
    Canonical paper record. All data sources (S2, OpenAlex, CrossRef, etc.)
    are merged into a single Paper instance before any downstream processing.

    paper_id is the Semantic Scholar corpus ID (40-char lowercase hex).
    This is the canonical primary key used in the DB, graph edges, and cache keys.
    """
    paper_id: str                            # 40-char S2 corpus ID — canonical PK
    title: str
    abstract: Optional[str] = None
    year: Optional[int] = None
    citation_count: int = 0
    fields_of_study: list[str] = field(default_factory=list)
    authors: list[str] = field(default_factory=list)
    doi: Optional[str] = None
    url: str = ""
    text_tier: int = 4          # 1=full text+methods  2=intro  3=abstract  4=title only
    is_retracted: bool = False
    language: str = "en"
    canonical_id: Optional[str] = None       # deduplicated canonical paper_id
    source_ids: dict = field(default_factory=dict)  # {"s2": "...", "openalex": "...", "doi": "..."}
    venue: Optional[str] = None

    @classmethod
    def from_db_row(cls, row: dict) -> "Paper":
        """Construct a Paper from a psycopg2 RealDictCursor row."""
        return cls(
            paper_id=row["paper_id"],
            title=row["title"],
            abstract=row.get("abstract"),
            year=row.get("year"),
            citation_count=row.get("citation_count", 0),
            fields_of_study=row.get("fields_of_study") or [],
            authors=row.get("authors") or [],
            doi=row.get("doi"),
            url=row.get("url") or "",
            text_tier=row.get("text_tier", 4),
            is_retracted=row.get("is_retracted", False),
            language=row.get("language", "en"),
            canonical_id=row.get("canonical_id"),
            source_ids=row.get("source_ids") or {},
            venue=row.get("venue"),
        )


# ---- EdgeAnalysis -----------------------------------------------------------

@dataclass
class EdgeAnalysis:
    """
    NLP pipeline output for one citation edge.
    Persisted to the edge_analysis table after computation.

    edge_id format is ALWAYS: f"{citing_paper_id}:{cited_paper_id}"
    Do not deviate — this format is the DB primary key.
    """
    edge_id: str                 # ALWAYS: f"{citing_paper_id}:{cited_paper_id}"
    citing_paper_id: str
    cited_paper_id: str
    similarity_score: float
    citing_sentence: Optional[str]
    cited_sentence: Optional[str]
    citing_text_source: str      # "methods" | "abstract" | "none"
    cited_text_source: str       # "methods" | "abstract" | "none"
    comparable: bool
    mutation_type: str           # one of MUTATION_TYPES
    mutation_confidence: float   # 0.0-1.0
    mutation_evidence: str
    citation_intent: str         # one of CITATION_INTENTS
    base_confidence: float       # raw confidence before structural validation
    signals_used: list[str]      # which of the 5 confidence signals contributed
    llm_classified: bool         # False if auto-classified incidental (no LLM call)
    flagged_by_users: int = 0
    model_version: str = "1.0.0"

    @property
    def confidence_tier(self) -> str:
        """Derived string tier. Always use this; never expose raw float."""
        return get_confidence_tier(self.mutation_confidence)
```

---

## §3 — backend/config.py

```python
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
```

---

## §4 — backend/db.py

```python
"""
db.py — PostgreSQL connection pool and query helpers.

NEON SSL: Neon.tech requires SSL. _ensure_ssl() appends ?sslmode=require
automatically. psycopg2 silently fails to connect to Neon without it.

POOL SIZING: Neon free tier cap = 10 total connections.
With --workers 1, pool max 8 leaves 2 for scripts. Do not increase
maxconn without first upgrading your Neon plan.

ROLLBACK GUARANTEE: Every helper rolls back on exception and returns the
connection in a clean state. The pool never receives an aborted-transaction
connection.
"""
import logging
from contextlib import contextmanager
from typing import Optional

import psycopg2
import psycopg2.pool
from psycopg2.extras import RealDictCursor

logger = logging.getLogger(__name__)

_pool: Optional[psycopg2.pool.ThreadedConnectionPool] = None


def _ensure_ssl(url: str) -> str:
    """Append sslmode=require if not already present. Required for Neon."""
    if "sslmode" not in url:
        sep = "&" if "?" in url else "?"
        url = f"{url}{sep}sslmode=require"
    return url


def init_pool(database_url: str, minconn: int = 2, maxconn: int = 8) -> None:
    """Initialize the connection pool. Call once inside create_app()."""
    global _pool
    url = _ensure_ssl(database_url)
    _pool = psycopg2.pool.ThreadedConnectionPool(
        minconn,
        maxconn,
        dsn=url,
        cursor_factory=RealDictCursor,
    )
    logger.info(f"DB pool initialized (min={minconn}, max={maxconn})")


def get_pool() -> psycopg2.pool.ThreadedConnectionPool:
    if _pool is None:
        raise RuntimeError("DB pool not initialized. Call db.init_pool() first.")
    return _pool


@contextmanager
def _get_conn():
    """
    Context manager: acquire a connection from the pool, commit on success,
    rollback + re-raise on any exception, always return to pool.
    Guarantees the pool never receives a connection in an aborted-tx state.
    """
    pool = get_pool()
    conn = pool.getconn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        pool.putconn(conn)


def fetchone(sql: str, params: tuple = ()) -> Optional[dict]:
    """Return the first row of a SELECT as a plain dict, or None."""
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            row = cur.fetchone()
            return dict(row) if row else None


def fetchall(sql: str, params: tuple = ()) -> list[dict]:
    """Return all rows of a SELECT as a list of plain dicts."""
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return [dict(r) for r in cur.fetchall()]


def execute(sql: str, params: tuple = ()) -> int:
    """
    Execute INSERT / UPDATE / DELETE.
    Commits on success, rolls back on exception.
    Returns rowcount.
    """
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.rowcount


def execute_returning(sql: str, params: tuple = ()) -> Optional[dict]:
    """Execute INSERT ... RETURNING and return the first row as a dict."""
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            row = cur.fetchone()
            return dict(row) if row else None


def executemany(sql: str, params_list: list[tuple]) -> None:
    """Execute a write query for multiple parameter sets (batch insert/update)."""
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.executemany(sql, params_list)


def paginate(
    sql: str, params: tuple = (), page: int = 1, per_page: int = 20
) -> dict:
    """
    Wrap a bare SELECT (no ORDER BY/LIMIT/OFFSET) with pagination.
    Returns: {items: [...], total: int, page: int, pages: int}
    """
    count_sql = f"SELECT COUNT(*) AS count FROM ({sql}) AS _subq"
    total = fetchone(count_sql, params)["count"]
    items = fetchall(f"{sql} LIMIT %s OFFSET %s", params + (per_page, (page - 1) * per_page))
    return {
        "items": items,
        "total": total,
        "page": page,
        "pages": (total + per_page - 1) // per_page,
    }


def health_check() -> bool:
    """
    Return True if the DB is reachable.
    Called by /health. Must NEVER raise — catches all exceptions.
    """
    try:
        row = fetchone("SELECT 1 AS ok")
        return row is not None and row.get("ok") == 1
    except Exception as exc:
        logger.error(f"DB health check failed: {exc}")
        return False
```

---

## §5 — backend/schemas.py

```python
"""
schemas.py — Pydantic request/response models for all API endpoints.
All input validation lives here — routes stay clean.
"""
import re
from typing import Optional

from pydantic import BaseModel, Field, field_validator


class SearchRequest(BaseModel):
    query: str = Field(..., min_length=3, max_length=500)

    @field_validator("query")
    @classmethod
    def sanitize_query(cls, v: str) -> str:
        return re.sub(r"[<>\"'`]", "", v).strip()


class GraphBuildRequest(BaseModel):
    paper_id: str = Field(..., min_length=5, max_length=200)
    max_depth: int = Field(default=2, ge=1, le=2)
    max_refs: int = Field(default=50, ge=10, le=50)

    @field_validator("paper_id")
    @classmethod
    def validate_paper_id(cls, v: str) -> str:
        patterns = [
            r"^[0-9a-f]{40}$",               # S2 corpus ID
            r"^10\.\d{4,9}/\S+$",             # DOI
            r"^\d{4}\.\d{4,5}(v\d+)?$",      # arXiv bare ID
            r"^https?://.*semanticscholar.*",  # S2 URL
        ]
        v = v.strip()
        if not any(re.match(p, v) for p in patterns):
            raise ValueError(
                "paper_id must be a 40-char S2 ID, DOI (10.xxxx/...), "
                "arXiv ID (YYYY.NNNNN), or Semantic Scholar URL"
            )
        return v


class PruneRequest(BaseModel):
    paper_ids: list[str] = Field(..., min_length=1, max_length=10)
    seed_paper_id: str

    @field_validator("paper_ids")
    @classmethod
    def validate_ids(cls, v: list[str]) -> list[str]:
        for pid in v:
            if not re.match(r"^[0-9a-f]{40}$", pid):
                raise ValueError(f"Invalid paper_id (must be 40-char hex): {pid}")
        return v


class ChatRequest(BaseModel):
    """
    IMPORTANT: client must NOT send message history.
    Server loads history from chat_history table keyed by session_id.
    This prevents client-side history injection attacks.
    """
    message: str = Field(..., min_length=1, max_length=2000)
    seed_paper_id: Optional[str] = None

    @field_validator("message")
    @classmethod
    def sanitize_message(cls, v: str) -> str:
        return re.sub(r"[<>\"'`]", "", v).strip()


class ExportRequest(BaseModel):
    format: str = Field(..., pattern="^(json|csv|pdf|markdown)$")
    seed_paper_id: str


class FlagRequest(BaseModel):
    source_id: str
    target_id: str
    seed_paper_id: str
    reason: str = Field(..., max_length=500)


class HealthResponse(BaseModel):
    """
    Shape of the /health response.
    /health returns jsonify(dict) directly. This model documents the shape
    and is available for typed test assertions.
    """
    status: str        # "ok" | "degraded"
    db: bool
    nlp_worker: bool
    version: str = "1.0.0"
```

---

## §6 — backend/utils.py

```python
"""
utils.py — Shared utility functions used across the backend.
"""
import asyncio
import json
import logging
from pathlib import Path
from typing import Any, Coroutine, Optional, TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")

GALLERY_DIR = Path(__file__).parent.parent / "data" / "precomputed"
GALLERY_INDEX_PATH = GALLERY_DIR / "gallery_index.json"


def await_sync(coro: Coroutine[Any, Any, T]) -> T:
    """
    Run an async coroutine from a synchronous Flask route handler.

    Strategy:
    - If an event loop is already running in this thread (e.g. during async
      tests), schedule on that loop via run_coroutine_threadsafe().
    - Otherwise create a fresh event loop with asyncio.run().

    NOTE: asyncio.run_coroutine_threadsafe() returns a concurrent.futures.Future
    that correctly propagates exceptions raised inside the coroutine. Calling
    .result(timeout=120) on it will re-raise any such exception. Do NOT replace
    this with a manually constructed concurrent.futures.Future — that pattern
    can block indefinitely if the coroutine raises before setting the result.
    """
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        future = asyncio.run_coroutine_threadsafe(coro, loop)
        return future.result(timeout=120)

    return asyncio.run(coro)


def load_gallery_index() -> list[dict]:
    """Load gallery entry list. Returns [] if file doesn't exist yet."""
    if not GALLERY_INDEX_PATH.exists():
        return []
    with open(GALLERY_INDEX_PATH) as f:
        return json.load(f)


def load_precomputed_graph(slug: str) -> Optional[dict]:
    """Load a precomputed graph JSON by slug (e.g. 'attention'). Returns None if missing."""
    path = GALLERY_DIR / f"{slug}.json"
    if not path.exists():
        return None
    with open(path) as f:
        return json.load(f)


def log_action(session_id: str, action_type: str, action_data: dict) -> None:
    """
    Insert a record into action_log.
    Silently swallows all errors — logging failures must never break requests.
    """
    from backend.db import execute
    try:
        execute(
            "INSERT INTO action_log (session_id, action_type, action_data) "
            "VALUES (%s, %s, %s)",
            (session_id, action_type, json.dumps(action_data)),
        )
    except Exception as exc:
        logger.debug(f"log_action silently failed: {exc}")


def update_graph_memory(session_id: str, updates: dict) -> None:
    """Merge updates dict into the session's graph_memory JSONB column."""
    from backend.db import execute
    execute(
        "UPDATE sessions SET graph_memory = graph_memory || %s::jsonb "
        "WHERE session_id = %s",
        (json.dumps(updates), session_id),
    )


def get_graph_summary_for_chat(graph: dict) -> dict:
    """
    Compact LLM-safe graph summary. Never passes raw abstracts to the LLM.
    Keeps output under ~1500 tokens.
    """
    nodes = graph.get("nodes", [])
    edges = graph.get("edges", [])
    meta  = graph.get("metadata", {})

    top_nodes   = sorted(nodes, key=lambda n: n.get("citation_count", 0), reverse=True)[:15]
    bottlenecks = [n for n in nodes if n.get("is_bottleneck")][:5]
    top_edges   = sorted(
        edges,
        key=lambda e: e.get("inherited_idea", {}).get("similarity", 0),
        reverse=True,
    )[:20]

    return {
        "seed_paper_id": meta.get("seed_paper_id"),
        "total_nodes":   meta.get("total_nodes"),
        "total_edges":   meta.get("total_edges"),
        "top_papers": [
            {
                "id":             n["id"],
                "title":          n.get("title", ""),
                "year":           n.get("year"),
                "citations":      n.get("citation_count"),
                "fields":         n.get("fields_of_study", []),
                "pruning_impact": n.get("pruning_impact", 0),
            }
            for n in top_nodes
        ],
        "bottleneck_papers": [
            {"id": n["id"], "title": n.get("title", ""), "pruning_impact": n.get("pruning_impact", 0)}
            for n in bottlenecks
        ],
        "edge_sample": [
            {
                "source":        e["source"],
                "target":        e["target"],
                "similarity":    e.get("inherited_idea", {}).get("similarity", 0),
                "mutation_type": e.get("inherited_idea", {}).get("mutation_type", "unknown"),
            }
            for e in top_edges
        ],
    }
```

---

## §7 — app.py

```python
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
```

---

## §8 — conftest.py

Place at the **project root** (same directory as `app.py`), NOT inside `tests/`.

```python
"""
conftest.py — pytest root configuration.

CRITICAL: load_dotenv() MUST be called here at module level, before any
other imports. This ensures .env is loaded before Config.__init__() runs
when backend.config is first imported. If load_dotenv() runs after
backend.config is imported, _require("FLASK_SECRET_KEY") will call
sys.exit(1) because the var is not yet in os.environ.

pytest always processes conftest.py before importing test files, so the
ordering is guaranteed: load_dotenv() -> Config() -> test imports.
"""
import sys
from pathlib import Path

# Step 1: Load .env FIRST — before any app imports
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env")
except ImportError:
    pass  # python-dotenv not installed; rely on vars already being set in env

# Step 2: Add project root to sys.path so `from app import create_app` works
sys.path.insert(0, str(Path(__file__).parent))
```

---

## §9 — pytest.ini

```ini
[pytest]
testpaths = tests
python_files = test_*.py
python_classes = Test*
python_functions = test_*
```

---

## §10 — tests/test_smoke.py

```python
"""
test_smoke.py — Phase 1 smoke tests.

Verifies:
  1. /health returns HTTP 200
  2. Response has the expected shape
  3. DB is actually connected (not mocked)

Run: python -m pytest tests/test_smoke.py -v
All three must pass before proceeding to Phase 2.
"""
import pytest
from app import create_app


@pytest.fixture(scope="module")
def client():
    """Create the Flask test client once for all tests in this module."""
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


def test_health_returns_200(client):
    resp = client.get("/health")
    assert resp.status_code == 200, (
        f"Expected HTTP 200, got {resp.status_code}. "
        "Check that DATABASE_URL is set and the DB is reachable."
    )


def test_health_response_has_required_fields(client):
    data = client.get("/health").get_json()
    assert "status"     in data, "Response missing 'status' field"
    assert "db"         in data, "Response missing 'db' field"
    assert "nlp_worker" in data, "Response missing 'nlp_worker' field"
    assert "version"    in data, "Response missing 'version' field"


def test_health_db_is_connected(client):
    data = client.get("/health").get_json()
    assert data["db"] is True, (
        "DB health check returned False. "
        "Ensure DATABASE_URL is set in .env with ?sslmode=require "
        "(Neon requires SSL). Run: python scripts/migrate.py"
    )
```

---

## §11 — nlp_worker/app.py

```python
"""
Arivu NLP Worker — FastAPI microservice.
Deployed on HuggingFace Spaces (CPU tier, 16GB RAM).

Phase 1: /health endpoint only. model_loaded = False.
Phase 2: loads SentenceTransformer at startup; adds canonical endpoints.

Authentication (Phase 2+):
  Every request from the Flask app must include:
    Authorization: Bearer {NLP_WORKER_SECRET}
  The worker validates this header and returns HTTP 403 if wrong/missing.
  NLP_WORKER_SECRET must match the value in the Flask app's config.
  Not enforced in Phase 1.

CANONICAL ENDPOINT NAMES — do not change these in Phase 2:
  POST /encode_batch      — encode a batch of texts, returns embeddings list
  POST /similarity_matrix — compute similarity between two sentence sets
  GET  /health            — reachability check, no auth

Do NOT use /embed, /encode, /batch_encode, /similarity, or any other name.
The Flask app's Phase 2 nlp_pipeline.py calls these exact paths.
"""
from fastapi import FastAPI

app = FastAPI(title="Arivu NLP Worker", version="1.0.0")


@app.get("/health")
def health():
    return {
        "status":       "ok",
        "model_loaded": False,  # True after Phase 2 model loading
        "phase":        1,
    }


# TODO: Phase 2 - startup event: load SentenceTransformer("all-MiniLM-L6-v2")
# TODO: Phase 2 - POST /encode_batch      (spec §8.2 for exact request/response shapes)
# TODO: Phase 2 - POST /similarity_matrix (spec §8.2 for exact request/response shapes)
```

---

## §12 — nlp_worker/README.md

````markdown
# Arivu NLP Worker

FastAPI microservice for sentence embedding and similarity computation.
Deployed separately on HuggingFace Spaces (free CPU tier, 16GB RAM).

## Why separate?

The SentenceTransformer model (~200MB) exceeds the 512MB RAM limit on the
main Koyeb server. Separating it also keeps the Flask app free of
torch/CUDA dependencies.

## Local development

```
cd nlp_worker
pip install -r requirements.txt
uvicorn app:app --reload --port 7860
```

Set `NLP_WORKER_URL=http://localhost:7860` in your root `.env`.

## HuggingFace Spaces deployment (Phase 6)

1. Create a new Space at huggingface.co/new-space -> SDK: Docker
2. Upload `nlp_worker/app.py`, `nlp_worker/requirements.txt`,
   `nlp_worker/Dockerfile`
3. Add Space secret: `NLP_WORKER_SECRET` = same value as in your
   production environment
4. Copy the Space URL to `NLP_WORKER_URL` in your production environment

## Endpoints

| Endpoint | Method | Auth required | Phase |
|---|---|---|---|
| `/health` | GET | No | 1 |
| `/encode_batch` | POST | Authorization: Bearer {NLP_WORKER_SECRET} | 2 |
| `/similarity_matrix` | POST | Authorization: Bearer {NLP_WORKER_SECRET} | 2 |
````

---

## §13 — scripts/migrate.py

```python
#!/usr/bin/env python3
"""
migrate.py — Apply the full Arivu PostgreSQL schema.

Usage:
    python scripts/migrate.py

Reads DATABASE_URL from .env (or environment).
Safe to run multiple times — all DDL uses IF NOT EXISTS.
Exits 0 on success, 1 on failure.

TABLE COUNT: Creates exactly 17 tables. The Done When criteria in PHASE_1.md
verifies this. If you add a table, update REQUIRED_TABLES below.

CORRECT TABLE NAMES — three names were wrong in earlier drafts:
  edge_analysis      (NOT edge_analysis_cache)
  edge_feedback      (NOT edge_flags)
  retraction_watch   (NOT retractions)
"""
import os
import sys
from pathlib import Path


def main() -> None:
    sys.path.insert(0, str(Path(__file__).parent.parent))

    try:
        from dotenv import load_dotenv
        load_dotenv(Path(__file__).parent.parent / ".env")
    except ImportError:
        pass

    import psycopg2

    DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
    if not DATABASE_URL:
        print(
            "ERROR: DATABASE_URL is not set.\n"
            "Copy .env.example to .env and fill in DATABASE_URL.",
            file=sys.stderr,
        )
        sys.exit(1)

    if "sslmode" not in DATABASE_URL:
        sep = "&" if "?" in DATABASE_URL else "?"
        DATABASE_URL = f"{DATABASE_URL}{sep}sslmode=require"

    print("Connecting to database...")
    try:
        conn = psycopg2.connect(DATABASE_URL)
        conn.autocommit = True
    except Exception as exc:
        print(f"ERROR: Could not connect: {exc}", file=sys.stderr)
        sys.exit(1)

    print("Applying schema...")
    try:
        with conn.cursor() as cur:
            cur.execute(MIGRATION_SQL)
        print("Schema applied.")
    except Exception as exc:
        print(f"ERROR: Migration failed: {exc}", file=sys.stderr)
        conn.close()
        sys.exit(1)

    print("Verifying tables...")
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema = 'public'"
            )
            existing = {row[0] for row in cur.fetchall()}
    except Exception as exc:
        print(f"ERROR: Verification failed: {exc}", file=sys.stderr)
        conn.close()
        sys.exit(1)

    missing = REQUIRED_TABLES - existing
    if missing:
        print(
            f"ERROR: Missing tables after migration: {sorted(missing)}\n"
            "This should not happen — check MIGRATION_SQL.",
            file=sys.stderr,
        )
        conn.close()
        sys.exit(1)

    conn.close()
    print(f"Verified {len(REQUIRED_TABLES)} required tables exist.")
    print("Migration complete. Ready to run smoke tests.")


# ---------------------------------------------------------------------------
# Correct table names (three names were wrong in earlier spec drafts):
#   edge_analysis      NOT edge_analysis_cache
#   edge_feedback      NOT edge_flags
#   retraction_watch   NOT retractions

REQUIRED_TABLES = {
    "papers",
    "paper_embeddings",
    "edge_analysis",
    "graphs",
    "build_jobs",
    "job_events",
    "sessions",
    "session_graphs",
    "users",
    "action_log",
    "edge_feedback",
    "llm_cache",
    "genealogy_cache",
    "retraction_watch",
    "chat_history",
    "insight_cache",
    "background_jobs",
}

# ---------------------------------------------------------------------------

MIGRATION_SQL = """
CREATE EXTENSION IF NOT EXISTS vector;   -- pgvector: 384-dim (all-MiniLM-L6-v2)
CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- fuzzy title search

-- Papers (canonical record - all sources merged)
CREATE TABLE IF NOT EXISTS papers (
    paper_id                  TEXT      PRIMARY KEY,
    canonical_id              TEXT,
    source_ids                JSONB     DEFAULT '{}',
    title                     TEXT      NOT NULL,
    authors                   JSONB     DEFAULT '[]',
    year                      INTEGER,
    venue                     TEXT,
    doi                       TEXT,
    language                  TEXT      DEFAULT 'en',
    is_retracted              BOOLEAN   DEFAULT FALSE,
    retraction_reason         TEXT,
    pubpeer_flags             JSONB     DEFAULT '[]',
    fields_of_study           JSONB     DEFAULT '[]',
    concepts                  JSONB     DEFAULT '[]',
    funding                   JSONB     DEFAULT '{}',
    citation_count            INTEGER   DEFAULT 0,
    reference_ids             JSONB     DEFAULT '[]',
    abstract                  TEXT,
    abstract_source           TEXT,
    url                       TEXT,
    text_tier                 INTEGER   DEFAULT 4,
    data_completeness         FLOAT     DEFAULT 0.0,
    sources_queried           JSONB     DEFAULT '[]',
    citation_count_updated_at TIMESTAMP,
    abstract_updated_at       TIMESTAMP,
    references_updated_at     TIMESTAMP,
    full_text_updated_at      TIMESTAMP,
    created_at                TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_papers_doi       ON papers(doi);
CREATE INDEX IF NOT EXISTS idx_papers_year      ON papers(year);
CREATE INDEX IF NOT EXISTS idx_papers_citations ON papers(citation_count DESC);
CREATE INDEX IF NOT EXISTS idx_papers_created   ON papers(created_at);
CREATE INDEX IF NOT EXISTS idx_papers_title_gin ON papers
    USING GIN(to_tsvector('english', title));

-- Paper embeddings (pgvector)
-- Dimension 384 = all-MiniLM-L6-v2 output. If model changes to 768-dim,
-- this column must be recreated (DROP + ADD). Update models.py comment too.
CREATE TABLE IF NOT EXISTS paper_embeddings (
    paper_id      TEXT      PRIMARY KEY REFERENCES papers(paper_id),
    embedding     vector(384),
    model_version TEXT      DEFAULT '1.0.0',
    computed_at   TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_paper_embeddings_vec
    ON paper_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Edge analysis - NLP pipeline output cache
-- CORRECT NAME: edge_analysis (NOT edge_analysis_cache)
CREATE TABLE IF NOT EXISTS edge_analysis (
    edge_id             TEXT      PRIMARY KEY,
    citing_paper_id     TEXT      REFERENCES papers(paper_id),
    cited_paper_id      TEXT      REFERENCES papers(paper_id),
    similarity_score    FLOAT,
    citing_sentence     TEXT,
    cited_sentence      TEXT,
    citing_text_source  TEXT,
    cited_text_source   TEXT,
    comparable          BOOLEAN   DEFAULT TRUE,
    mutation_type       TEXT,
    mutation_confidence FLOAT,
    mutation_evidence   TEXT,
    citation_intent     TEXT,
    base_confidence     FLOAT,
    signals_used        JSONB     DEFAULT '[]',
    llm_classified      BOOLEAN   DEFAULT FALSE,
    flagged_by_users    INTEGER   DEFAULT 0,
    model_version       TEXT      DEFAULT '1.0.0',
    computed_at         TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_edge_citing ON edge_analysis(citing_paper_id);
CREATE INDEX IF NOT EXISTS idx_edge_cited  ON edge_analysis(cited_paper_id);

-- Graphs (metadata only - full JSON stored in R2)
-- graph_id is TEXT assigned by the app, not SERIAL.
-- Cache TTL uses last_accessed NOT created_at (see DECISIONS.md #10).
-- No FK on session_id: use session_graphs join table instead (DECISIONS.md #13).
CREATE TABLE IF NOT EXISTS graphs (
    graph_id           TEXT      PRIMARY KEY,
    seed_paper_id      TEXT      REFERENCES papers(paper_id),
    graph_json_url     TEXT,
    node_count         INTEGER,
    edge_count         INTEGER,
    max_depth          INTEGER   DEFAULT 2,
    coverage_score     FLOAT,
    coverage_report    JSONB,
    model_version      TEXT      DEFAULT '1.0.0',
    build_time_seconds FLOAT,
    created_at         TIMESTAMP DEFAULT NOW(),
    last_accessed      TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_graphs_seed     ON graphs(seed_paper_id);
CREATE INDEX IF NOT EXISTS idx_graphs_accessed ON graphs(last_accessed);

-- Build jobs (for SSE progress streaming)
CREATE TABLE IF NOT EXISTS build_jobs (
    job_id       UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
    paper_id     TEXT,
    session_id   TEXT,
    status       TEXT      DEFAULT 'pending',
    created_at   TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);

-- Job events (one row per SSE event emitted)
CREATE TABLE IF NOT EXISTS job_events (
    id         SERIAL    PRIMARY KEY,
    job_id     UUID      REFERENCES build_jobs(job_id),
    sequence   INTEGER,
    event_data JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_job_events_job ON job_events(job_id, id);

-- Sessions (anonymous)
CREATE TABLE IF NOT EXISTS sessions (
    session_id   TEXT      PRIMARY KEY,
    created_at   TIMESTAMP DEFAULT NOW(),
    last_seen    TIMESTAMP DEFAULT NOW(),
    persona      TEXT      DEFAULT 'explorer',
    graph_memory JSONB     DEFAULT '{}'
);

-- Session-to-graph mapping
-- Anonymous sessions can view graphs without a FK on graphs.session_id.
CREATE TABLE IF NOT EXISTS session_graphs (
    session_id TEXT      NOT NULL,
    graph_id   TEXT      NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (session_id, graph_id)
);
CREATE INDEX IF NOT EXISTS idx_session_graphs_session
    ON session_graphs(session_id, created_at DESC);

-- Users (authenticated accounts - future use, created now to avoid future migrations)
CREATE TABLE IF NOT EXISTS users (
    user_id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email                      TEXT        UNIQUE NOT NULL,
    email_verified             BOOLEAN     DEFAULT FALSE,
    password_hash              TEXT        NOT NULL,
    created_at                 TIMESTAMPTZ DEFAULT NOW(),
    last_login_at              TIMESTAMPTZ,
    display_name               TEXT,
    institution                TEXT,
    role                       TEXT,
    tier                       TEXT        DEFAULT 'free',
    tier_expires_at            TIMESTAMPTZ,
    stripe_customer_id         TEXT,
    graphs_this_month          INTEGER     DEFAULT 0,
    usage_reset_at             TIMESTAMPTZ DEFAULT DATE_TRUNC('month', NOW()) + INTERVAL '1 month',
    marketing_consent          BOOLEAN     DEFAULT FALSE,
    data_processing_consent    BOOLEAN     NOT NULL DEFAULT TRUE,
    gdpr_deletion_requested_at TIMESTAMPTZ
);

-- Action log (per-session behaviour tracking)
CREATE TABLE IF NOT EXISTS action_log (
    id          SERIAL    PRIMARY KEY,
    session_id  TEXT,
    action_type TEXT      NOT NULL,
    action_data JSONB     DEFAULT '{}',
    timestamp   TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_action_log_session ON action_log(session_id, timestamp);

-- Edge feedback (user disagreements with NLP classifications)
-- CORRECT NAME: edge_feedback (NOT edge_flags)
CREATE TABLE IF NOT EXISTS edge_feedback (
    id              SERIAL    PRIMARY KEY,
    edge_id         TEXT      NOT NULL,
    session_id      TEXT,
    feedback_type   TEXT,
    feedback_detail TEXT,
    timestamp       TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_edge_feedback_edge ON edge_feedback(edge_id, feedback_type);

-- LLM response cache
-- Key = SHA256(model + ":" + system_prompt + ":" + user_prompt). TTL = 30 days.
CREATE TABLE IF NOT EXISTS llm_cache (
    cache_key   TEXT      PRIMARY KEY,
    prompt_hash TEXT      NOT NULL,
    response    TEXT      NOT NULL,
    model       TEXT      NOT NULL,
    created_at  TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_llm_cache_created ON llm_cache(created_at);

-- Genealogy story cache (per seed paper)
CREATE TABLE IF NOT EXISTS genealogy_cache (
    paper_id    TEXT      PRIMARY KEY,
    story_json  JSONB     NOT NULL,
    computed_at TIMESTAMP DEFAULT NOW()
);

-- Retraction Watch data
-- CORRECT NAME: retraction_watch (NOT retractions)
-- Loaded by scripts/load_retraction_watch.py
CREATE TABLE IF NOT EXISTS retraction_watch (
    doi             TEXT PRIMARY KEY,
    paper_id        TEXT,
    title           TEXT,
    reason          TEXT,
    retraction_date DATE
);

-- AI guide chat history (server-side only - never from client payload)
CREATE TABLE IF NOT EXISTS chat_history (
    id         SERIAL    PRIMARY KEY,
    session_id TEXT      NOT NULL,
    role       TEXT      NOT NULL CHECK (role IN ('user', 'assistant')),
    content    TEXT      NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_history(session_id, id);

-- Per-paper proactive insight cache
CREATE TABLE IF NOT EXISTS insight_cache (
    paper_id   TEXT      PRIMARY KEY,
    insights   JSONB     NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Background jobs (GDPR export, account deletion, etc.)
CREATE TABLE IF NOT EXISTS background_jobs (
    job_id       TEXT      PRIMARY KEY,
    job_type     TEXT      NOT NULL,
    params       JSONB     DEFAULT '{}',
    status       TEXT      DEFAULT 'pending',
    created_at   TIMESTAMP DEFAULT NOW(),
    started_at   TIMESTAMP,
    completed_at TIMESTAMP,
    error        TEXT,
    result_url   TEXT
);
CREATE INDEX IF NOT EXISTS idx_bg_jobs_status  ON background_jobs(status);
CREATE INDEX IF NOT EXISTS idx_bg_jobs_created ON background_jobs(created_at);
"""


if __name__ == "__main__":
    main()
```

---

## §14 — requirements.txt

```
# requirements.txt - main Flask app (all pinned)
# DO NOT add sentence-transformers, torch, or any ML model here.
# Those belong exclusively in nlp_worker/requirements.txt.

# Web framework
flask==3.0.3
flask-cors==4.0.1

# WSGI server
gunicorn==22.0.0

# Database
psycopg2-binary==2.9.9
pgvector==0.2.5

# HTTP clients
requests==2.32.3
httpx==0.27.0
aiohttp==3.9.5

# Graph engine (pure Python - no ML)
networkx==3.3

# Data validation
pydantic[email]==2.7.1

# NLP helpers (no model, no torch)
numpy==1.26.4
scikit-learn==1.4.2

# File processing
PyMuPDF==1.24.3
python-magic==0.4.27
langdetect==1.0.9

# LLM
groq==0.8.0

# Object storage (R2 is S3-compatible)
boto3==1.34.101

# Auth / security
bcrypt==4.1.3

# Document generation (export phase)
python-docx==1.1.2
reportlab==4.2.0

# Monitoring
sentry-sdk[flask]==2.3.1
structlog==24.1.0

# Utilities
python-dotenv==1.0.1
python-dateutil==2.9.0

# Payments / email (stubs until Phase 6)
stripe==9.9.0
resend==0.7.2
```

---

## §15 — requirements-nlp-worker.txt

This file lives at the **project root** and must stay identical to
`nlp_worker/requirements.txt`. If you update one, update both.

```
# requirements-nlp-worker.txt - NLP worker service (all pinned)
# Mirrors nlp_worker/requirements.txt exactly.

fastapi==0.111.0
uvicorn==0.29.0
sentence-transformers==2.7.0
torch==2.2.2
numpy==1.26.4
scikit-learn==1.4.2
groq==0.8.0
httpx==0.27.0
pydantic==2.7.1
python-dotenv==1.0.1
```

**`nlp_worker/requirements.txt`** — identical content:

```
fastapi==0.111.0
uvicorn==0.29.0
sentence-transformers==2.7.0
torch==2.2.2
numpy==1.26.4
scikit-learn==1.4.2
groq==0.8.0
httpx==0.27.0
pydantic==2.7.1
python-dotenv==1.0.1
```

---

## §16 — requirements-dev.txt

```
# requirements-dev.txt - development and testing only
# Never install in production

pytest==8.2.0
pytest-asyncio==0.23.6
black==24.4.2
flake8==7.0.0
mypy==1.9.0
```

---

## §17 — Procfile

```
web: gunicorn "app:create_app()" --workers 1 --worker-class sync --bind 0.0.0.0:$PORT --timeout 120
```

**Why `--workers 1`:** Neon free tier hard cap = 10 PostgreSQL connections total.
`--workers 2` with `DB_POOL_MAX=8` would attempt 16 connections at startup and fail
with `OperationalError` on the 11th. One worker + pool max 8 leaves 2 spare for
`migrate.py` and ad-hoc scripts. To scale workers you must upgrade to Neon Pro.

---

## §18 — runtime.txt

```
python-3.11.8
```

---

## §19 — Dockerfile

```dockerfile
FROM python:3.11-slim

# System libraries required by python-magic (libmagic1) and weasyprint
# (pango/cairo/gdk-pixbuf). Without these, pip install succeeds but
# import python_magic or import weasyprint will raise OSError at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libmagic1 \
    libpango-1.0-0 \
    libpangoft2-1.0-0 \
    libcairo2 \
    libgdk-pixbuf2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["gunicorn", "app:create_app()", "--workers", "1", "--bind", "0.0.0.0:8000", "--timeout", "120"]
```

---

## §20 — .dockerignore

**This file is critical.** Without it, `COPY . .` bakes your `.env` secrets
(database passwords, API keys) into the Docker image layer. Anyone who pulls
the image can read them.

```
# Secrets
.env
.env.*
!.env.example

# Python caches
__pycache__/
*.pyc
*.pyo
*.pyd

# Test / tool artifacts
.pytest_cache/
.mypy_cache/
.coverage
htmlcov/
.tox/

# Version control
.git/
.gitignore

# IDE
.vscode/
.idea/
*.swp
*.swo

# Build artifacts
*.egg-info/
dist/
build/

# Virtual environments
venv/
.venv/
env/

# Large data files - never in Docker image
data/retraction_watch.csv
data/precomputed/
```

---

## §21 — .env.example

```bash
# Flask
FLASK_SECRET_KEY=change-me-random-32-chars
FLASK_ENV=development
FLASK_DEBUG=true

# Database
# Neon connection string - must contain ?sslmode=require
# Example: postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/arivu?sslmode=require
# Local Docker: postgresql://arivu:localdev@localhost:5432/arivu
DATABASE_URL=postgresql://arivu:localdev@localhost:5432/arivu

# External APIs
S2_API_KEY=
OPENALEX_EMAIL=you@university.edu
GROQ_API_KEY=gsk_...
CORE_API_KEY=
PUBPEER_API_KEY=
CROSSREF_MAILTO=you@university.edu

# R2 Storage
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=arivu-graphs
R2_ENDPOINT_URL=https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com

# NLP Worker
NLP_WORKER_URL=http://localhost:7860
# NLP_WORKER_SECRET must match the value set in HuggingFace Spaces secrets
NLP_WORKER_SECRET=change-me-random-32-chars

# Auth
HCAPTCHA_SITE_KEY=10000000-ffff-ffff-ffff-000000000001
HCAPTCHA_SECRET_KEY=0x0000000000000000000000000000000000000000

# Email
RESEND_API_KEY=re_...

# Payments
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Monitoring
SENTRY_DSN=

# Translation
LIBRETRANSLATE_URL=https://libretranslate.com
LIBRETRANSLATE_KEY=
```

---

## §22 — .gitignore

```
# Secrets - NEVER commit
.env
.env.*
!.env.example

# Python
__pycache__/
*.py[cod]
*.pyo
*.pyd
*.so
*.egg
*.egg-info/
dist/
build/
.eggs/
venv/
.venv/
env/

# Tests / tooling
.pytest_cache/
.mypy_cache/
.coverage
htmlcov/
.tox/
.nox/

# IDE
.vscode/
.idea/
*.swp
*.swo

# Data (large files - never in git)
data/retraction_watch.csv
data/precomputed/

# OS
.DS_Store
Thumbs.db
```

---

## §23 — static/assets/favicon.svg

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" fill="#0a0e17"/>
  <text x="16" y="24" font-size="20" font-family="serif"
        text-anchor="middle" fill="#D4A843">அ</text>
</svg>
```

---

## §24 — nlp_worker/Dockerfile

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
EXPOSE 7860
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
```

---

## §25 — Data Files

**`data/precomputed/gallery_index.json`:**
```json
[]
```
Populated by `scripts/precompute_gallery.py` in Phase 5.

**`data/.gitkeep`** — empty file so git tracks the `data/` directory.

**`data/retraction_watch.csv`** — empty placeholder:
```
# Empty placeholder — populated by scripts/load_retraction_watch.py in Phase 2
```

---

## §26 — CONTEXT.md Initial Content

```markdown
# Arivu - Active Context

## Completed
_(nothing yet)_

## In Progress
- Phase 1: create all files, apply schema, pass smoke test

## Next
- Phase 2: API client (S2 + OpenAlex), normalizer, NLP worker endpoints, graph engine Stage 1

## Known Issues
- none

## Environment
- DATABASE_URL: [fill in your Neon connection string]
  NOTE: Do not paste real credentials here. Use only a description like
  "Neon project: arivu-prod" so this file stays safe to commit.
- NLP_WORKER_URL: http://localhost:7860 (dev) | [HuggingFace URL when deployed]
- Deployed to Koyeb: no

## Session Notes
[Add a one-line note at the end of each Claude Code session describing what changed]
```

---

## §27 — DECISIONS.md Initial Content

```markdown
# Arivu - Architecture Decisions Log

Consult this before making any architectural decision not covered in CLAUDE.md.
If you are about to decide something not recorded here, add it first.

## Settled Decisions

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Deployment | Koyeb + HuggingFace Spaces + Neon + Cloudflare R2 | See CLAUDE.md §4 |
| 2 | Database | PostgreSQL on Neon.tech - NOT SQLite | Does not pause on free tier; pgvector support |
| 3 | NLP model location | HuggingFace Spaces only - NEVER in Flask app | ~200MB exceeds Koyeb 512MB RAM |
| 4 | Service boundary | Flask owns routes + DB; FastAPI owns NLP model | Clean separation, independent scaling |
| 5 | Graph format | NetworkX DiGraph + export JSON to R2 | Sufficient for n<=600 nodes; no graph DB needed |
| 6 | Frontend | Vanilla JS + D3.js v7 + Chart.js | No build step; CDN-served |
| 7 | LLM | Groq (llama-3.1-8b-instant + llama-3.3-70b-versatile) | Fast inference; free tier |
| 8 | Object storage | Cloudflare R2 | 10GB free; S3-compatible; no egress fees |
| 9 | Sessions | Anonymous sessions (cookie) + optional user account | No login required for core features |
| 10 | Cache TTL | last_accessed NOT created_at on graphs table | A graph used daily stays fresh; idle ones expire |
| 11 | Workers | --workers 1 in Procfile | Neon free cap: 10 connections. 2 workers x pool=8 = 16 connections -> fails |
| 12 | edge_analysis FKs | citing_paper_id + cited_paper_id reference papers(paper_id) | Integrity; orphaned edges not allowed |
| 13 | session_graphs | Separate join table; no FK on graphs.session_id | Anonymous users (no DB row) can view graphs without FK violation |

## Open Questions
[Add questions here as they arise - resolve and move to Settled before implementing]
```

---

## §28 — README.md

````markdown
# Arivu - Research Paper Intellectual Ancestry Engine

> "What if this paper never existed?"

Arivu (அறிவு - Tamil for "knowledge/wisdom") traces the intellectual DNA of any
research paper: which ideas it inherited, how they mutated across generations,
and what research would collapse if foundational papers were removed from history.

**Status:** Phase 1 - skeleton and schema only. Not yet functional.

## System Prerequisites

These system libraries are required by `python-magic` and `weasyprint`.
Install them before `pip install`:

**Ubuntu/Debian:**
```
sudo apt-get install libmagic1 libpango-1.0-0 libpangoft2-1.0-0 libcairo2 libgdk-pixbuf2.0-0
```

**macOS:**
```
brew install libmagic pango cairo gdk-pixbuf
```

**Windows:** Use the Docker image.

## Quick Start

```
git clone https://github.com/YOUR_USERNAME/arivu.git
cd arivu

# Create virtual environment
python -m venv venv && source venv/bin/activate

# Install dependencies
pip install -r requirements.txt -r requirements-dev.txt

# Start local PostgreSQL with pgvector
docker run -d --name arivu-db \
  -e POSTGRES_DB=arivu \
  -e POSTGRES_USER=arivu \
  -e POSTGRES_PASSWORD=localdev \
  -p 5432:5432 \
  pgvector/pgvector:pg16

# Configure environment
cp .env.example .env
# Edit .env: set FLASK_SECRET_KEY, DATABASE_URL, NLP_WORKER_SECRET

# Apply schema
python scripts/migrate.py

# Run smoke tests (must all pass)
python -m pytest tests/ -v

# Start development server
flask --app "app:create_app()" run --port 5000
```

## Stack

| Component | Technology | Host |
|---|---|---|
| Backend | Flask 3 + Python 3.11 | Koyeb |
| Database | PostgreSQL + pgvector | Neon.tech |
| NLP service | FastAPI + sentence-transformers | HuggingFace Spaces |
| Graph engine | NetworkX | in-process |
| Frontend | Vanilla JS + D3.js v7 + Chart.js | Vercel |
| LLM | Groq (llama-3.1-8b-instant) | Groq Cloud |
| Object storage | Cloudflare R2 | Cloudflare |

## Architecture

```
Browser -------------- Flask (Koyeb)
                            |
                            +-- PostgreSQL (Neon)
                            +-- Cloudflare R2 (graph JSON)
                            +-- NLP Worker (HuggingFace Spaces)
                                    +-- SentenceTransformer
```
````

---

## §29 — Script Stubs

```python
# scripts/precompute_gallery.py
"""
precompute_gallery.py - Pre-build graphs for all 7 gallery papers and upload to R2.
Implemented in Phase 5.
"""
# TODO: Phase 5
```

```python
# scripts/load_retraction_watch.py
"""
load_retraction_watch.py - Import retraction_watch.csv into the retraction_watch table.
Implemented in Phase 2.
"""
# TODO: Phase 2
```

```python
# scripts/benchmark_nlp.py
"""
benchmark_nlp.py - Benchmark NLP pipeline throughput (target: 100 edges per minute).
Implemented in Phase 2.
"""
# TODO: Phase 2
```

```python
# scripts/test_pipeline.py
"""
test_pipeline.py - End-to-end NLP pipeline smoke test against real papers.
Implemented in Phase 2.
"""
# TODO: Phase 2
```

```python
# scripts/ground_truth_eval.py
"""
ground_truth_eval.py - Run NLP pipeline against 50 known inheritance pairs.
Implemented in Phase 4.
"""
# TODO: Phase 4
```

---

## §30 — Exact Build Sequence

Execute every step in order. Do not skip. Do not reorder.

```bash
# ============================================================
# PREREQUISITES
# ============================================================

# 0a. Install system libraries (required by python-magic + weasyprint)
# Ubuntu/Debian:
sudo apt-get install libmagic1 libpango-1.0-0 libpangoft2-1.0-0 libcairo2 libgdk-pixbuf2.0-0
# macOS:
# brew install libmagic pango cairo gdk-pixbuf

# 0b. Create and activate virtual environment
python -m venv venv
source venv/bin/activate     # Windows: venv\Scripts\activate

# 0c. Start local PostgreSQL with pgvector support
docker run -d --name arivu-db \
  -e POSTGRES_DB=arivu \
  -e POSTGRES_USER=arivu \
  -e POSTGRES_PASSWORD=localdev \
  -p 5432:5432 \
  pgvector/pgvector:pg16
# Verify: docker ps | grep arivu-db

# ============================================================
# GIT INIT
# ============================================================

# 1. CLAUDE.md must already exist on disk before this step.
git init
git branch -M main       # ensure branch is named 'main', not 'master'
git add CLAUDE.md
git commit -m "[init] add Claude Code rulebook"

# ============================================================
# CREATE DIRECTORIES
# ============================================================

# 2. Create all directories
mkdir -p backend nlp_worker
mkdir -p static/css static/js static/assets
mkdir -p templates
mkdir -p data/precomputed
mkdir -p scripts tests

# ============================================================
# CREATE ALL FILES
# ============================================================

# 3. Create every file in the manifest using exact content from §1-§29.
#    Follow the manifest order.
#    Create empty package markers first:
touch backend/__init__.py nlp_worker/__init__.py scripts/__init__.py tests/__init__.py
# Add this single line to each:  # Arivu package marker - do not add imports here

# ============================================================
# CONFIGURE ENVIRONMENT
# ============================================================

# 4. Set up .env
cp .env.example .env
# Open .env and set:
#   FLASK_SECRET_KEY  -> python -c "import secrets; print(secrets.token_hex(32))"
#   DATABASE_URL      -> postgresql://arivu:localdev@localhost:5432/arivu
#   NLP_WORKER_SECRET -> python -c "import secrets; print(secrets.token_hex(32))"

# ============================================================
# INSTALL DEPENDENCIES
# ============================================================

# 5. Install
pip install -r requirements.txt -r requirements-dev.txt

# ============================================================
# APPLY SCHEMA
# ============================================================

# 6. Run migration
python scripts/migrate.py
# Expected final lines:
#   Verified 17 required tables exist.
#   Migration complete. Ready to run smoke tests.
#
# Troubleshooting:
#   "connection refused"     -> Docker not running or DATABASE_URL wrong
#   "SSL required"           -> add ?sslmode=require to Neon DATABASE_URL
#   "extension vector..."    -> use pgvector/pgvector:pg16 Docker image
#   "table already exists"   -> safe to ignore; all DDL uses IF NOT EXISTS

# ============================================================
# RUN SMOKE TESTS
# ============================================================

# 7. Smoke tests
python -m pytest tests/test_smoke.py -v
# Expected:
#   tests/test_smoke.py::test_health_returns_200                   PASSED
#   tests/test_smoke.py::test_health_response_has_required_fields  PASSED
#   tests/test_smoke.py::test_health_db_is_connected               PASSED
#   3 passed
#
# If test_health_db_is_connected fails:
#   - Check DATABASE_URL in .env (must have ?sslmode=require for Neon)
#   - Re-run: python scripts/migrate.py

# ============================================================
# COMMIT
# ============================================================

# 8. Commit skeleton
git add -A
git commit -m "[init] project skeleton - health check passing"

# 9. Update CONTEXT.md: Phase 1 -> Completed, Phase 2 -> In Progress
git add CONTEXT.md
git commit -m "[context] Phase 1 complete"
```

---

## §31 — Done When

Phase 1 is complete when **all four are simultaneously true:**

1. `python -m pytest tests/test_smoke.py -v` → **3 passed, 0 failed**
2. `python scripts/migrate.py` → **"Verified 17 required tables exist"**
3. `git log --oneline` shows the two commits from §30 steps 8 and 9, both on branch `main`
4. `CONTEXT.md` shows Phase 1 under "Completed", Phase 2 under "In Progress"

Do not proceed to Phase 2 until all four are true.

---

## §32 — What NOT To Do In This Phase

- Do not implement any route other than `/health`
- Do not import `sentence_transformers`, `torch`, or any ML library in `app.py` or any `backend/` file — those belong only in `nlp_worker/`
- Do not call Semantic Scholar, OpenAlex, Groq, or any external API
- Do not write any frontend HTML, CSS, or JavaScript beyond the stub one-liners
- Do not implement graph building, NLP, pruning, DNA profiler, or any analytical feature
- Do not implement auth, login, registration, or payments
- Do not run `scripts/precompute_gallery.py`
- Do not use `--workers 2` in Procfile — Neon free tier will hit the connection cap
- Do not worry that `/health` shows `"nlp_worker": false` — correct for Phase 1
