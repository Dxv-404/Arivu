# PHASE 4 — Deployment, Production Hardening & Gallery Launch
## Version 2 — All 48 gaps resolved

## Before You Start
1. Read `CLAUDE.md` — architecture non-negotiables apply throughout.
2. Read `CONTEXT.md` — verify Phase 3 is marked **Completed** before continuing.
3. This file is the **only** spec you need right now. Do not open any other phase file.
4. **Phase 3 must be complete.** Run `python -m pytest tests/ -v` — all must pass.
5. **Apply all backports in §0 before writing any Phase 4 code.**
6. **You need real credentials before you can run precompute.** See §3 before §13.

---

## What Phase 4 Produces

When complete:
- Arivu is **live on the internet** at a real URL
- **NLP worker** deployed on HuggingFace Spaces
- **Backend API** deployed on Koyeb, connected to Neon and R2
- **Gallery is live** — 7 precomputed papers at `/explore`
- **Sentry** capturing production errors
- **Health check** returning `200 OK` with all services green
- `backend/quality_monitor.py` — wired to `/api/quality`
- `static/js/semantic-zoom.js` — `SemanticZoomRenderer`
- `data/gallery_index.json` — authoritative gallery metadata
- `scripts/verify_deployment.py` — production smoke test
- `tests/test_phase4.py` — deployment validation suite
- `CONTEXT.md` updated — Phase 4 under "Completed"

Nothing else. No auth, no Stripe, no user accounts, no Time Machine.

---

## Files Changed / Created

### New files
```
backend/quality_monitor.py
static/js/semantic-zoom.js
data/gallery_index.json
scripts/verify_deployment.py
scripts/load_retraction_watch.py
tests/test_phase4.py
```

### Modified
```
app.py                  ← module-level app, health route, CORS, security headers,
                          /api/quality, /static/gallery_index.json, all backports
backend/config.py       ← Phase 4 canonical Config class + backward-compat alias
backend/session_manager.py  ← add get_session_id() (backport)
backend/rate_limiter.py     ← add check_sync(), get_429_response() (backport)
backend/r2_client.py        ← optional config arg, method aliases (backport)
scripts/migrate.py          ← add insight_cache, fix insight_feedback (backport)
scripts/precompute_gallery.py ← fix imports and async calls (backport)
nlp_worker/app.py           ← dual auth header support (backport)
static/js/graph.js          ← add this._semanticZoom = null (backport)
tests/test_phase3.py        ← fix TestAPIRoutes fixture (backport)
templates/tool.html         ← add semantic-zoom.js script tag
.env.example                ← complete production env vars
CONTEXT.md                  ← Phase 4 → Completed
```

### Infrastructure (verify only)
```
Procfile       ← already exists; verify exact content in §1
Dockerfile     ← already exists; verify exact content in §1
runtime.txt    ← already exists; verify exact content in §1
nlp_worker/Dockerfile ← already exists; verify exact content in §1
```

---

## Architecture Reminder

```
┌──────────────────────┬──────────────────────────────────────────┐
│ Backend API          │ Koyeb eco (always-on, free)              │
│                      │ Flask + gunicorn, 2 workers, port 8000   │
│                      │ DB pool: 4 max (2 workers × 4 = 8 ≤ 10) │
├──────────────────────┼──────────────────────────────────────────┤
│ NLP Worker           │ HuggingFace Spaces CPU (free)            │
│                      │ FastAPI + sentence-transformers, 7860    │
├──────────────────────┼──────────────────────────────────────────┤
│ Database             │ Neon PostgreSQL + pgvector, 512MB        │
├──────────────────────┼──────────────────────────────────────────┤
│ Object Storage       │ Cloudflare R2 (10GB / 10M reqs free)    │
├──────────────────────┼──────────────────────────────────────────┤
│ LLM                  │ Groq (llama-3.1-8b-instant + 70b)       │
├──────────────────────┼──────────────────────────────────────────┤
│ Error Tracking       │ Sentry (5000 errors/month free)          │
└──────────────────────┴──────────────────────────────────────────┘
```

The main Koyeb server **may never import** `sentence_transformers`, `torch`, or any ML library.

---

## §0 — Backports (Apply Before Writing Any Phase 4 Code)

These fix bugs in Phase 1/2/3 code that Phase 4 depends on. Apply all 15 before proceeding.

### §0.1 — app.py: Move `app` to module level

Phase 2/3 routes use `@app.route` and `app.logger` at module level. Phase 1 creates `app` inside `create_app()` as a local variable — these decorators NameError at import time.

Find the `create_app()` definition in `app.py` and move the Flask instantiation to module level:

```python
# ── Add near the top of app.py, after imports, before route definitions ──────
from flask import Flask, jsonify, render_template, request, Response, stream_with_context, g
from backend.config import Config

app = Flask(__name__)
app.secret_key = Config.SECRET_KEY
```

The `create_app()` function should now configure (not create) the app — see §6.6 for the updated factory body.

### §0.2 — app.py: Add `render_template` to Flask imports

Phase 3 page routes call `render_template()` but it was never added to the Flask import.
Ensure the import line from §0.1 includes `render_template` (already shown above). ✅

### §0.3 — app.py: Add `session_manager` module import

```python
# Add alongside other backend imports in app.py:
import backend.session_manager as session_manager
from backend.rate_limiter import arivu_rate_limiter as rate_limiter
```

### §0.4 — backend/session_manager.py: Add `get_session_id()` function

Phase 3 routes and Phase 4's quality route call `session_manager.get_session_id(request)` — this method does not exist. Add at the bottom of `backend/session_manager.py`:

```python
from typing import Optional

def get_session_id(request) -> Optional[str]:
    """
    Read and validate session cookie. Returns session_id if valid, None otherwise.
    Does NOT create a new session — use the @require_session decorator for that.
    Used by routes that return 401 when no session is present.
    """
    existing = request.cookies.get(SESSION_COOKIE_NAME)
    if not existing:
        return None
    return existing if _manager.get_session(existing) else None
```

### §0.5 — backend/rate_limiter.py: Add sync wrapper and method alias

Phase 3 routes call `rate_limiter.check_sync()` and `rate_limiter.get_429_response()`. The existing class only has async `check()` and `get_429_body()`. Add these methods inside `ArivuRateLimiter`:

```python
def check_sync(self, session_id: str, endpoint: str) -> tuple[bool, dict]:
    """Synchronous wrapper around async check() for Flask route handlers."""
    import asyncio
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                return pool.submit(asyncio.run, self.check(session_id, endpoint)).result()
        return loop.run_until_complete(self.check(session_id, endpoint))
    except Exception:
        return True, {}  # fail-open on errors

def get_429_response(self, headers: dict) -> dict:
    """Alias for get_429_body() — used by Phase 3 routes."""
    return self.get_429_body(headers)
```

Also update all Phase 3 route calls from `rate_limiter.check(` to `rate_limiter.check_sync(`.

### §0.6 — backend/r2_client.py: Optional constructor arg + method aliases

Phase 3/4 call `R2Client()` (no arg) and methods that don't exist. Update `r2_client.py`:

```python
# Replace __init__ signature (make config optional):
def __init__(self, config=None):
    from backend.config import Config as _Config
    _cfg = config or _Config
    self._bucket  = _cfg.R2_BUCKET_NAME
    self._enabled = bool(
        getattr(_cfg, 'R2_ACCOUNT_ID', '') and
        getattr(_cfg, 'R2_ACCESS_KEY_ID', '') and
        getattr(_cfg, 'R2_SECRET_ACCESS_KEY', '')
    )
    if not self._enabled:
        self._client = None
        return
    self._client = boto3.client(
        "s3",
        endpoint_url=(getattr(_cfg, 'R2_ENDPOINT_URL', '')
                      or f"https://{_cfg.R2_ACCOUNT_ID}.r2.cloudflarestorage.com"),
        aws_access_key_id=_cfg.R2_ACCESS_KEY_ID,
        aws_secret_access_key=_cfg.R2_SECRET_ACCESS_KEY,
        region_name="auto",
    )

# Add at the bottom of the R2Client class:
def download_json(self, key: str): return self.get_json(key)
def upload_json(self, key: str, data: dict): self.put_json(key, data)
def download(self, key: str): return self.get(key)
def upload(self, key: str, data: bytes, content_type: str = "application/octet-stream"):
    self.put(key, data, content_type)
```

### §0.7 — scripts/migrate.py: Add `insight_cache` table; fix `insight_feedback` schema

Append to `scripts/migrate.py`:

```python
# Phase 4 additions — run these via the migration (safe to re-run, uses IF NOT EXISTS)
PHASE_4_SQL = """
-- insight_cache: canonical table name used by /api/insights route
CREATE TABLE IF NOT EXISTS insight_cache (
    id            SERIAL      PRIMARY KEY,
    paper_id      TEXT        NOT NULL UNIQUE,
    insights_json JSONB       NOT NULL DEFAULT '[]',
    created_at    TIMESTAMP   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_insight_cache_paper ON insight_cache(paper_id);

-- insight_feedback: TEXT insight_id (no FK — client supplies arbitrary string IDs)
-- Drop old version if it exists with wrong schema (INT FK to insights table)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='insight_feedback' AND column_name='insight_id'
        AND data_type='integer'
    ) THEN
        DROP TABLE IF EXISTS insight_feedback CASCADE;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS insight_feedback (
    id           SERIAL      PRIMARY KEY,
    session_id   TEXT,
    insight_id   TEXT        NOT NULL,
    feedback     TEXT        NOT NULL CHECK(feedback IN ('helpful','not_helpful')),
    timestamp    TIMESTAMP   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_insight_fb_insight ON insight_feedback(insight_id);

-- genealogy_cache (should exist from Phase 1; ensure it does)
CREATE TABLE IF NOT EXISTS genealogy_cache (
    paper_id    TEXT        PRIMARY KEY,
    story_json  JSONB,
    computed_at TIMESTAMP   DEFAULT NOW()
);

-- session_graphs (should exist from Phase 1; ensure it does)
CREATE TABLE IF NOT EXISTS session_graphs (
    session_id  TEXT        NOT NULL,
    graph_id    TEXT        NOT NULL,
    created_at  TIMESTAMP   NOT NULL DEFAULT NOW(),
    PRIMARY KEY (session_id, graph_id)
);
CREATE INDEX IF NOT EXISTS idx_sgs_session
    ON session_graphs(session_id, created_at DESC);

-- computed_at on graphs (should exist from Phase 3 ALTER TABLE; ensure it does)
ALTER TABLE graphs ADD COLUMN IF NOT EXISTS computed_at TIMESTAMP DEFAULT NOW();
"""
```

### §0.8 — scripts/precompute_gallery.py: Fix 5 crash points

In `scripts/precompute_gallery.py`, make these changes:

```python
# 1. Fix module name (line ~6447):
# Replace: from backend.database import init_pool
# With:
from backend.db import init_pool

# 2. Remove unused broken imports entirely:
# DELETE: from backend.api_client import SemanticScholarClient
# DELETE: from backend.nlp_pipeline import IdeaExtractor

# 3. Fix init_pool() call in main() — requires database_url arg:
# Replace: init_pool()
# With:
import os
init_pool(database_url=os.environ.get("DATABASE_URL", ""))

# 4. Fix build_graph() call in precompute_paper() — async, wrong kwargs:
# Replace: graph.build_graph(paper_id, max_depth=2, max_refs_per_paper=50)
# With:
import asyncio
asyncio.run(graph.build_graph(paper_id))

# 5. Add gallery_index.json stats write-back at end of precompute_paper():
import json, pathlib
_gallery_path = pathlib.Path("data/gallery_index.json")
if _gallery_path.exists():
    _gallery = json.loads(_gallery_path.read_text())
    for _entry in _gallery:
        if _entry["slug"] == slug:
            _entry["stats"].update({"papers": stats["papers"], "edges": stats["edges"]})
    _gallery_path.write_text(json.dumps(_gallery, indent=2))
    logger.info(f"  gallery_index.json updated for {slug}")
```

### §0.9 — nlp_worker/app.py: Dual auth + WORKER_SECRET name

```python
# Replace:
NLP_WORKER_SECRET = os.environ.get("NLP_WORKER_SECRET", "")

# With (supports both env var names and both header formats):
WORKER_SECRET = (
    os.environ.get("WORKER_SECRET", "")
    or os.environ.get("NLP_WORKER_SECRET", "")
)

# Replace _auth_dependency:
async def _auth_dependency(request: Request) -> None:
    """Accept X-API-Key (Phase 4 canonical) or Authorization: Bearer (Phase 2 legacy)."""
    if not WORKER_SECRET:
        return
    token = request.headers.get("X-API-Key", "")
    if not token:
        auth = request.headers.get("Authorization", "")
        token = auth.removeprefix("Bearer ").strip()
    if token != WORKER_SECRET:
        raise HTTPException(status_code=401, detail="Invalid worker secret")

# Replace all NLP_WORKER_SECRET references with WORKER_SECRET throughout the file
```

### §0.10 — static/js/graph.js: Initialise `_semanticZoom` in constructor

In `ArivuGraph` constructor in `static/js/graph.js`:
```javascript
constructor(container, graphData) {
    this._semanticZoom = null;  // ← add as first line of constructor
    // ... rest of constructor unchanged ...
}
```

### §0.11 — tests/test_phase3.py: Fix `TestAPIRoutes` fixture

```python
# Replace the broken fixture:
# @pytest.fixture
# def client(self):
#     from app import app   ← WRONG: no module-level app export

# With:
@pytest.fixture
def client(self):
    from app import create_app
    application = create_app()
    application.config['TESTING'] = True
    with application.test_client() as c:
        yield c
```

---

## §1 — Verify Existing Deployment Files

Before anything else, verify these files contain exactly the content below. Only correct them if they differ.

### §1.1 — Procfile

```
web: gunicorn "app:create_app()" --workers 2 --worker-class sync --bind 0.0.0.0:$PORT --timeout 120
```

**Note on workers:** Phase 4 uses 2 workers. This is safe **only** with `DB_POOL_MAX=4`
(§6.6 enforces this with `maxconn=4`). Do not add `--workers 3` or higher without
upgrading your Neon plan. Neon free tier: 10 connections. Math: `2 × 4 = 8` active
`+ 2` reserved for scripts `= 10`. ✅

### §1.2 — runtime.txt

```
python-3.11.8
```

### §1.3 — Dockerfile (main backend)

```dockerfile
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libmagic1 libpango-1.0-0 libpangoft2-1.0-0 libcairo2 libgdk-pixbuf2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

EXPOSE 8000
CMD ["gunicorn", "app:create_app()", "--workers", "2", "--bind", "0.0.0.0:8000", "--timeout", "120"]
```

### §1.4 — nlp_worker/Dockerfile

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY nlp_worker/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY nlp_worker/app.py ./app.py
ENV PORT=7860
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
```

### §1.5 — nlp_worker/requirements.txt

```
fastapi==0.110.0
uvicorn==0.27.1
sentence-transformers==2.7.0
torch==2.2.1
numpy==1.26.4
scikit-learn==1.4.1
pydantic==2.6.3
```

### §1.6 — Verify `precompute_gallery.py` is real implementation

```bash
# Must be >100 lines (not the Phase 1 one-line stub):
wc -l scripts/precompute_gallery.py
grep -c "def precompute_paper" scripts/precompute_gallery.py  # must output: 1
```

If it shows a stub (`# TODO: Phase 5`), Phase 3 is incomplete. Complete Phase 3 first.

---

## §2 — requirements.txt Additions

Add to the existing `requirements.txt` (do not remove existing entries):

```
sentry-sdk[flask]==2.3.1
httpx==0.27.0
```

Note: `flask-cors==4.0.1` is already present from Phase 1. Do not add a duplicate.

---

## §3 — Account Setup (Human Steps)

### §3.1 — Required Accounts

| Service | URL | Purpose |
|---------|-----|---------|
| Neon | neon.tech | PostgreSQL database |
| Koyeb | koyeb.com | Backend API hosting |
| HuggingFace | huggingface.co | NLP worker hosting |
| Cloudflare R2 | cloudflare.com | Object storage |
| Groq | console.groq.com | LLM API |
| Sentry | sentry.io | Error tracking |
| Semantic Scholar | semanticscholar.org/product/api | S2 API key (optional) |

### §3.2 — Credentials to Gather

```bash
DATABASE_URL=postgresql://user:pass@ep-xxx.neon.tech/arivu?sslmode=require
R2_ACCOUNT_ID=your_cloudflare_account_id
R2_ACCESS_KEY_ID=your_r2_access_key
R2_SECRET_ACCESS_KEY=your_r2_secret_key
R2_ENDPOINT_URL=https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com
R2_BUCKET_NAME=arivu-data
GROQ_API_KEY=gsk_...
SENTRY_DSN=https://xxx@oXXX.ingest.sentry.io/XXXXX
# Generate locally:
FLASK_SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_hex(32))")
WORKER_SECRET=$(python3 -c "import secrets; print(secrets.token_hex(24))")
```

**Note on `R2_BUCKET_NAME`:** If you created your bucket as `arivu-graphs` during earlier
testing, set `R2_BUCKET_NAME=arivu-graphs` — do NOT rename a bucket that already has data.
The canonical Phase 4 name is `arivu-data` for fresh installs.

### §3.3 — R2 Bucket Configuration

In Cloudflare R2 dashboard:
1. Create bucket `arivu-data` (or confirm existing `arivu-graphs` matches your env var)
2. Location: **automatic**
3. Public access: **disabled** (private — accessed via proxy routes)
4. CORS policy:

```json
[{
  "AllowedOrigins": ["https://your-koyeb-app.koyeb.app", "http://localhost:5000"],
  "AllowedMethods": ["GET"],
  "AllowedHeaders": ["*"],
  "MaxAgeSeconds": 3600
}]
```

### §3.4 — Generate `og-image.png` Before Deploy

Replace the 1×1 placeholder from Phase 1:

```bash
pip install Pillow --break-system-packages
python -c "
from PIL import Image, ImageDraw
img = Image.new('RGB', (1200,630), '#0a0e17')
d = ImageDraw.Draw(img)
try:
    from PIL import ImageFont
    fnt = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 80)
    fnt_sm = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 36)
    d.text((80, 200), 'Arivu', fill='#D4A843', font=fnt)
    d.text((80, 330), 'Trace the intellectual ancestry', fill='#E2E8F0', font=fnt_sm)
    d.text((80, 380), 'of any research paper.', fill='#E2E8F0', font=fnt_sm)
except Exception:
    d.text((80, 250), 'Arivu', fill='#D4A843')
img.save('static/assets/og-image.png', optimize=True)
print('Generated static/assets/og-image.png')
"
git add static/assets/og-image.png
git commit -m '[phase4] generate og-image for social sharing'
```

---

## §4 — Update .env.example

Replace `.env.example` with:

```bash
# ─────────────────────────────────────────────────────────────────
# ARIVU — Environment Variable Reference (Phase 4 complete)
# Copy to .env for local dev. Never commit .env to git.
# ─────────────────────────────────────────────────────────────────

# Flask
FLASK_SECRET_KEY=change-me-64-random-hex-chars
FLASK_DEBUG=false

# Database — Neon.tech PostgreSQL (must include ?sslmode=require)
DATABASE_URL=postgresql://user:pass@ep-xxx.neon.tech/arivu?sslmode=require

# DB pool — CRITICAL with --workers 2
# Formula: workers × DB_POOL_MAX ≤ 8 (leaves 2 of Neon's 10 for scripts)
DB_POOL_MAX=4
DB_POOL_MIN=1

# NLP Worker
NLP_WORKER_URL=https://your-username-arivu-nlp.hf.space
# Shared secret — must match EXACTLY on Koyeb and HuggingFace Spaces
WORKER_SECRET=change-me-random-32-chars

# Cloudflare R2
R2_ACCOUNT_ID=your_cloudflare_account_id
R2_ACCESS_KEY_ID=your_r2_access_key_id
R2_SECRET_ACCESS_KEY=your_r2_secret_access_key
# Phase 4 canonical bucket name. If bucket was created as 'arivu-graphs', use that.
R2_BUCKET_NAME=arivu-data
R2_ENDPOINT_URL=https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com

# Koyeb — set AFTER first deploy (hostname only, no https://)
# Example: my-arivu-app-abc123.koyeb.app
# KOYEB_PUBLIC_DOMAIN=

# Semantic Scholar API (optional — increases rate limits)
# S2_API_KEY=your_s2_api_key

# Groq API (optional — enables LLM features; degrades to templates without)
# GROQ_API_KEY=gsk_...

# CORE API (optional — full-text PDF access)
# CORE_API_KEY=your_core_api_key

# Crossref polite pool
# CROSSREF_MAILTO=dev@yourdomain.com

# OpenAlex (optional — increases rate limits)
# OPENALEX_EMAIL=dev@yourdomain.com

# Sentry (optional — production error tracking)
# SENTRY_DSN=https://xxx@oXXX.ingest.sentry.io/XXXXX

# NLP worker timeout (default 90s — HF Spaces cold starts can take 60-90s)
NLP_WORKER_TIMEOUT=90

# PubPeer (optional — future use)
# PUBPEER_API_KEY=your_pubpeer_api_key
```

---

## §5 — Update backend/config.py

Replace `backend/config.py` entirely:

```python
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
    # Increased from Phase 1's 30s — HF Spaces cold starts can take 60-90s.
    NLP_WORKER_TIMEOUT  = int(os.environ.get("NLP_WORKER_TIMEOUT", "90"))

    # ── Deployment ────────────────────────────────────────────────
    # Set AFTER first Koyeb deploy — used for CORS allow-list.
    # Value: hostname only, no https://. Example: my-app-abc123.koyeb.app
    KOYEB_PUBLIC_DOMAIN = os.environ.get("KOYEB_PUBLIC_DOMAIN", "")

    # ── Error Tracking ────────────────────────────────────────────
    SENTRY_DSN          = os.environ.get("SENTRY_DSN", "")

    # ── Feature Flags ─────────────────────────────────────────────
    # Auth is NOT implemented in Phase 4. Leave this false.
    ENABLE_AUTH         = os.environ.get("ENABLE_AUTH", "false").lower() == "true"

    # ── Derived properties ────────────────────────────────────────
    @classmethod
    def R2_ENABLED(cls) -> bool:
        return bool(cls.R2_ACCOUNT_ID and cls.R2_ACCESS_KEY_ID and cls.R2_SECRET_ACCESS_KEY)

    @classmethod
    def GROQ_ENABLED(cls) -> bool:
        return bool(cls.GROQ_API_KEY)

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
```

---

## §6 — Update app.py

This section describes all changes to `app.py`. Integrate carefully — do not remove existing Phase 2/3 routes.

### §6.1 — Updated imports

Ensure these exist at the top of `app.py` (consolidate with existing imports):

```python
import logging
import os
import time
import uuid
import json
from threading import Thread
from typing import Optional

from flask import Flask, jsonify, render_template, request, Response, stream_with_context, g
from flask_cors import CORS

from backend.config import Config, config
import backend.session_manager as session_manager
from backend.rate_limiter import arivu_rate_limiter as rate_limiter
from backend.utils import await_sync, log_action
import backend.db as db
from exceptions import ArivuError, register_error_handlers
```

### §6.2 — Module-level app instance (backport B1)

Immediately after imports, before any route definitions:

```python
# Module-level Flask app — required for @app.route decorators and app.logger
app = Flask(__name__)
app.secret_key = Config.SECRET_KEY
```

### §6.3 — Sentry initialisation

```python
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
```

### §6.4 — CORS configuration

```python
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
```

### §6.5 — Security headers

```python
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
```

### §6.6 — Updated `create_app()` factory

Replace the existing `create_app()` function:

```python
def create_app():
    """
    Application factory. Called by gunicorn: gunicorn "app:create_app()"
    Also called by tests: app = create_app(); client = app.test_client()

    The Flask `app` object is a module-level global (defined above).
    create_app() configures it and returns it — it does NOT create it.
    """
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
    app.logger.info("Arivu Phase 4 app ready")
    return app
```

### §6.7 — Updated `/health` route

Replace the existing `/health` route (from Phase 1) with this Phase 4 version.
It emits the new `checks` dict **and** the legacy flat keys so `test_smoke.py` continues to pass:

```python
# ── NLP health cache (30s TTL — prevents 3s outbound call on every Koyeb probe) ─
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


@app.route("/health")
def health():
    """
    Health check. HTTP 200 if DB reachable, 503 otherwise.
    Koyeb probes this every 30s. NLP and R2 status are informational.

    Response shape — Phase 4 format (checks dict) AND legacy flat keys
    for backward compatibility with test_smoke.py:
        {
            "status":     "healthy" | "degraded",
            "db":         true,          ← legacy key for test_smoke.py
            "nlp_worker": true,          ← legacy key for test_smoke.py
            "checks": {
                "database":   "ok" | "error",
                "nlp_worker": "ok" | "unreachable",
                "r2_storage": "ok" | "error",
            },
            "version": "1.0.0",
            "timestamp": <unix float>
        }
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
```

### §6.8 — Gallery index route (new)

Add alongside the other R2 proxy routes:

```python
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
```

Also add this inline script to `templates/explore.html` inside `{% block scripts %}`:

```html
<script>
// Load real precomputed stats into gallery cards, replacing placeholder values
fetch('/static/gallery_index.json')
  .then(r => r.json())
  .then(entries => {
    entries.forEach(entry => {
      const card = document.querySelector(`.gallery-entry[data-slug="${entry.slug}"]`);
      if (!card || !entry.stats) return;
      const p = card.querySelector('p');
      if (p) {
        const authors = (entry.authors || []).join(', ');
        p.textContent = `${authors}, ${entry.year} · ${entry.stats.papers} papers`;
      }
    });
  })
  .catch(() => {}); // silently fall back to hardcoded placeholder values
</script>
```

### §6.9 — Quality API route

Add to the routes section:

```python
# ─── GET /api/quality ────────────────────────────────────────────────────────

@app.route("/api/quality")
def api_quality():
    """
    Returns production quality metrics for the most recently built graph
    in this session. Used for internal monitoring.

    Response:
        {
            "quality_score": 0.8,          # 0.0–1.0
            "metrics": { ... },
            "issues": [],
            "graph_id": "..."
        }
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
```

---

## §7 — backend/quality_monitor.py

Create this new file:

```python
"""
backend/quality_monitor.py

ProductionQualityMonitor: Computes proxy quality metrics for any graph JSON.
Does NOT require ground truth. Uses structural signals to detect common failures.

Used by:
  - GET /api/quality (per-session quality check)
  - scripts/verify_deployment.py (post-deploy smoke test)
"""
import logging
import math
import time
from collections import Counter

logger = logging.getLogger(__name__)


class ProductionQualityMonitor:
    """Stateless quality analysis — pass graph_json directly to each method."""

    def analyze_graph_quality(self, graph_json: dict) -> dict:
        """
        Compute quality metrics for a graph.

        Returns:
            {
                "quality_score": float,   # 0.0–1.0
                "metrics": dict,
                "issues": list[str],
                "timestamp": float,
            }
        """
        edges = graph_json.get("edges", [])
        nodes = graph_json.get("nodes", [])

        if not edges:
            return {
                "quality_score": 0.0,
                "metrics": {},
                "issues": ["No edges in graph — graph may be empty or failed to build"],
                "timestamp": time.time(),
            }

        issues = []
        metrics = {}

        # ── 1. Similarity score distribution ──────────────────────
        similarities = [e["similarity_score"] for e in edges
                        if e.get("similarity_score") is not None]
        if similarities:
            metrics["similarity_mean"] = round(sum(similarities) / len(similarities), 3)
            variance = sum((x - metrics["similarity_mean"]) ** 2
                          for x in similarities) / len(similarities)
            metrics["similarity_std"] = round(math.sqrt(variance), 3)

            if metrics["similarity_std"] < 0.05:
                issues.append(
                    f"SIMILARITY_LOW_VARIANCE: std={metrics['similarity_std']:.3f} "
                    "— possible model or pipeline issue"
                )
            metrics["similarity_bimodal"] = self._is_bimodal(similarities)

        # ── 2. Mutation type variety ───────────────────────────────
        mutation_types = [e.get("mutation_type", "unknown") for e in edges]
        type_counts = Counter(mutation_types)
        n_types = sum(1 for t, c in type_counts.items() if c > 0 and t != "unknown")
        metrics["mutation_type_variety"] = n_types
        metrics["mutation_type_entropy"] = round(self._entropy(list(type_counts.values())), 3)

        if metrics["mutation_type_entropy"] < 0.8:
            issues.append(
                f"LOW_MUTATION_VARIETY: {n_types} types, "
                f"entropy={metrics['mutation_type_entropy']:.2f}"
            )

        incidental_rate = type_counts.get("incidental", 0) / max(len(mutation_types), 1)
        metrics["incidental_rate"] = round(incidental_rate, 3)
        if incidental_rate > 0.8:
            issues.append(
                f"HIGH_INCIDENTAL_RATE: {incidental_rate:.0%} edges are 'incidental'"
            )

        # ── 3. Confidence score distribution ──────────────────────
        confidences = [e.get("final_confidence") or e.get("mutation_confidence", 0)
                      for e in edges]
        if confidences:
            low_conf = [c for c in confidences if c < 0.4]
            metrics["low_confidence_rate"] = round(len(low_conf) / len(confidences), 3)
            if metrics["low_confidence_rate"] > 0.6:
                issues.append(
                    f"HIGH_LOW_CONFIDENCE: {metrics['low_confidence_rate']:.0%} "
                    "edges have confidence < 0.4"
                )

        # ── 4. Graph structure sanity ──────────────────────────────
        metrics["node_count"] = len(nodes)
        metrics["edge_count"] = len(edges)
        if nodes:
            edge_density = len(edges) / len(nodes)
            metrics["edge_density"] = round(edge_density, 2)
            if edge_density < 0.5:
                issues.append(f"LOW_EDGE_DENSITY: {edge_density:.1f} edges/node")

        # ── 5. Abstract coverage ───────────────────────────────────
        nodes_with_abstract = sum(
            1 for n in nodes if n.get("abstract") or n.get("text_tier", 4) < 4
        )
        if nodes:
            metrics["abstract_coverage"] = round(nodes_with_abstract / len(nodes), 3)
            if metrics["abstract_coverage"] < 0.6:
                issues.append(
                    f"LOW_ABSTRACT_COVERAGE: {metrics['abstract_coverage']:.0%} "
                    "nodes have abstracts"
                )

        quality_score = max(0.0, 1.0 - len(issues) * 0.2)
        return {
            "quality_score": round(quality_score, 2),
            "metrics":       metrics,
            "issues":        issues,
            "timestamp":     time.time(),
        }

    def check_thresholds(self, result: dict) -> list[str]:
        """Return alertable threshold violations. Empty list = healthy."""
        alerts = []
        m = result.get("metrics", {})
        if m.get("abstract_coverage", 1.0) < 0.5:
            alerts.append(f"abstract_coverage={m['abstract_coverage']:.0%} below 50%")
        if m.get("low_confidence_rate", 0) > 0.7:
            alerts.append(f"low_confidence_rate={m['low_confidence_rate']:.0%} above 70%")
        if m.get("incidental_rate", 0) > 0.85:
            alerts.append(f"incidental_rate={m['incidental_rate']:.0%} above 85%")
        if result.get("quality_score", 1.0) < 0.4:
            alerts.append(f"quality_score={result['quality_score']} below 0.4")
        return alerts

    def _is_bimodal(self, values: list) -> bool:
        if len(values) < 10:
            return False
        low  = sum(v < 0.35 for v in values)
        high = sum(v > 0.65 for v in values)
        mid  = len(values) - low - high
        return (low + high) > mid and low >= 3 and high >= 3

    def _entropy(self, counts: list) -> float:
        total = sum(counts)
        if total == 0:
            return 0.0
        result = 0.0
        for c in counts:
            if c > 0:
                p = c / total
                result -= p * math.log2(p)
        return result
```

---

## §8 — static/js/semantic-zoom.js

Create this file. The `ArivuGraph` constructor now initialises `this._semanticZoom = null`
(backport §0.10), and `loader.js._initGraph()` assigns a `SemanticZoomRenderer` instance
after the graph renders (§8.2 below).

```javascript
/**
 * static/js/semantic-zoom.js
 *
 * SemanticZoomRenderer: when the user zooms out below k=0.4,
 * switch to concept cluster bubbles instead of individual nodes.
 *
 * Wired up in loader.js._initGraph() after graph renders (not panels.js).
 * graph.js zoom handler calls renderClusters()/removeClusterOverlay()
 * via the null-guarded: if (k < 0.4 && this._semanticZoom) ...
 *
 * Dependencies: D3.js (loaded globally in base.html)
 */

class SemanticZoomRenderer {
  constructor(graph, dnaProfile) {
    this.graph = graph;
    this._clusterOverlay = null;
    this.clusters = this._buildClusters(dnaProfile);
  }

  _buildClusters(dnaProfile) {
    const clusters = {};
    const list = (dnaProfile && dnaProfile.clusters) ? dnaProfile.clusters : [];
    for (const c of list) {
      clusters[c.name] = {
        name:       c.name,
        color:      c.color || '#3B82F6',
        percentage: c.percentage || 0,
        paperIds:   c.papers || [],
        cx: 0, cy: 0, radius: 40,
        topAuthors: [],
      };
    }
    return clusters;
  }

  updateClusterPositions() {
    for (const [name, cluster] of Object.entries(this.clusters)) {
      const paperNodes = (this.graph.allNodes || [])
        .filter(n => cluster.paperIds.includes(n.id) && n.x !== undefined);
      if (!paperNodes.length) continue;

      cluster.cx = paperNodes.reduce((s, n) => s + n.x, 0) / paperNodes.length;
      cluster.cy = paperNodes.reduce((s, n) => s + n.y, 0) / paperNodes.length;

      const devX = Math.sqrt(
        paperNodes.reduce((s, n) => s + (n.x - cluster.cx) ** 2, 0) / paperNodes.length
      );
      const devY = Math.sqrt(
        paperNodes.reduce((s, n) => s + (n.y - cluster.cy) ** 2, 0) / paperNodes.length
      );
      cluster.radius = Math.max(40, devX, devY);

      cluster.topAuthors = paperNodes
        .slice().sort((a, b) => (b.citation_count || 0) - (a.citation_count || 0))
        .slice(0, 3)
        .map(n => {
          const authors = n.authors || [];
          const first = typeof authors[0] === 'string' ? authors[0] : '';
          return first.split(' ').pop() || 'Unknown';
        });
    }
  }

  renderClusters() {
    this.updateClusterPositions();
    this.removeClusterOverlay();

    const zoomGroup = this.graph.zoomGroup;
    if (!zoomGroup) return;

    if (this.graph.nodeGroup) this.graph.nodeGroup.style('opacity', '0.15');
    if (this.graph.edgeGroup) this.graph.edgeGroup.style('opacity', '0.05');

    const clusterGroup = zoomGroup.append('g')
      .attr('class', 'cluster-overlay')
      .style('pointer-events', 'all');

    for (const [name, cluster] of Object.entries(this.clusters)) {
      if (!cluster.paperIds.length) continue;

      const g = clusterGroup.append('g')
        .attr('transform', `translate(${cluster.cx.toFixed(1)},${cluster.cy.toFixed(1)})`)
        .attr('cursor', 'pointer')
        .on('click', () => this._zoomToCluster(cluster));

      g.append('circle')
        .attr('r', cluster.radius)
        .attr('fill', cluster.color)
        .attr('fill-opacity', 0.12)
        .attr('stroke', cluster.color)
        .attr('stroke-opacity', 0.45)
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '6,3');

      g.append('text').attr('text-anchor', 'middle').attr('dy', '-0.6em')
        .attr('fill', cluster.color).attr('font-size', '13px').attr('font-weight', '600')
        .attr('font-family', 'Inter, sans-serif').text(cluster.name);

      g.append('text').attr('text-anchor', 'middle').attr('dy', '0.9em')
        .attr('fill', '#94A3B8').attr('font-size', '11px')
        .attr('font-family', 'Inter, sans-serif')
        .text(`${cluster.paperIds.length} papers · ${cluster.percentage}%`);

      if (cluster.topAuthors.length) {
        g.append('text').attr('text-anchor', 'middle').attr('dy', '2.2em')
          .attr('fill', '#64748B').attr('font-size', '10px')
          .attr('font-family', 'Inter, sans-serif')
          .text(cluster.topAuthors.join(' · '));
      }

      g.on('mouseenter', function() {
        d3.select(this).select('circle')
          .attr('fill-opacity', 0.22).attr('stroke-opacity', 0.75);
      }).on('mouseleave', function() {
        d3.select(this).select('circle')
          .attr('fill-opacity', 0.12).attr('stroke-opacity', 0.45);
      });
    }

    this._clusterOverlay = clusterGroup;
  }

  removeClusterOverlay() {
    if (this._clusterOverlay) {
      this._clusterOverlay.remove();
      this._clusterOverlay = null;
    }
    if (this.graph.nodeGroup) this.graph.nodeGroup.style('opacity', null);
    if (this.graph.edgeGroup) this.graph.edgeGroup.style('opacity', null);
  }

  _zoomToCluster(cluster) {
    const svg  = this.graph.svg;
    const zoom = this.graph.zoom;
    if (!svg || !zoom) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    svg.transition().duration(750).call(
      zoom.transform,
      d3.zoomIdentity.translate(w / 2, h / 2).scale(1.4)
        .translate(-cluster.cx, -cluster.cy)
    );
  }
}
```

### §8.1 — Wire into tool.html

In `templates/tool.html`, add **before** the existing `graph.js` script tag:

```html
<script src="{{ url_for('static', filename='js/semantic-zoom.js') }}" defer></script>
```

### §8.2 — Wire SemanticZoomRenderer into loader.js

In `static/js/loader.js`, at the **END** of `GraphLoader._initGraph()`, after all panel renders
and after `window._arivuGraph = this._graph;`:

```javascript
// Initialise semantic zoom AFTER graph renders and node positions settle
if (window.SemanticZoomRenderer && window._arivuGraph && graphData.dna_profile?.clusters) {
  window._arivuGraph._semanticZoom = new SemanticZoomRenderer(
    window._arivuGraph,
    graphData.dna_profile
  );
}
```

**Note:** Do NOT initialise inside `panels.js.renderDNAProfile()` — node positions must be
stable first. `_initGraph()` completion provides this guarantee.

---

## §9 — data/gallery_index.json

Create `data/gallery_index.json`. Placeholder stats will be overwritten by `precompute_gallery.py` in §13.

```json
[
  {
    "slug": "attention",
    "title": "Attention Is All You Need",
    "authors": ["Vaswani", "Shazeer", "Parmar"],
    "year": 2017,
    "field": "Computer Science",
    "paper_id": "204e3073870fae3d05bcbc2f6a8e263d9b72e776",
    "hook": "Remove this paper and 31% of transformer research collapses.",
    "stats": { "papers": 152, "edges": 487, "fields": 2, "depth": 2 }
  },
  {
    "slug": "alexnet",
    "title": "ImageNet Classification with Deep CNNs",
    "authors": ["Krizhevsky", "Sutskever", "Hinton"],
    "year": 2012,
    "field": "Computer Science",
    "paper_id": "abd1c342495432171beb7ca8fd9551ef13cbd0ff",
    "hook": "The paper that reignited deep learning — see its 10-year intellectual shadow.",
    "stats": { "papers": 247, "edges": 612, "fields": 3, "depth": 2 }
  },
  {
    "slug": "bert",
    "title": "BERT: Pre-training of Deep Bidirectional Transformers",
    "authors": ["Devlin", "Chang", "Lee", "Toutanova"],
    "year": 2018,
    "field": "Computer Science",
    "paper_id": "df2b0e26d0599ce3e70df8a9da02e51594e0e992",
    "hook": "Where transformers, pre-training, and bidirectionality converged.",
    "stats": { "papers": 312, "edges": 891, "fields": 4, "depth": 2 }
  },
  {
    "slug": "gans",
    "title": "Generative Adversarial Nets",
    "authors": ["Goodfellow", "Pouget-Abadie"],
    "year": 2014,
    "field": "Computer Science",
    "paper_id": "54e325aee6b2d476bbbb88615ac15e251c6e8214",
    "hook": "Born from a bar argument. Became a research explosion.",
    "stats": { "papers": 198, "edges": 534, "fields": 3, "depth": 2 }
  },
  {
    "slug": "word2vec",
    "title": "Efficient Estimation of Word Representations",
    "authors": ["Mikolov", "Chen", "Corrado", "Dean"],
    "year": 2013,
    "field": "Computer Science",
    "paper_id": "330da625c15427c6e42ccfa3b747fb29e5835bf0",
    "hook": "The paper that made word vectors practical — and what it quietly revived.",
    "stats": { "papers": 178, "edges": 467, "fields": 3, "depth": 2 }
  },
  {
    "slug": "resnet",
    "title": "Deep Residual Learning for Image Recognition",
    "authors": ["He", "Zhang", "Ren", "Sun"],
    "year": 2016,
    "field": "Computer Science",
    "paper_id": "2c03df8b48bf3fa39054345bafabfeff15bfd11d",
    "hook": "Residual connections solved a 20-year problem. Trace the ancestry.",
    "stats": { "papers": 289, "edges": 743, "fields": 2, "depth": 2 }
  },
  {
    "slug": "gpt2",
    "title": "Language Models are Unsupervised Multitask Learners",
    "authors": ["Radford", "Wu", "Child"],
    "year": 2019,
    "field": "Computer Science",
    "paper_id": "9405cc0d6169988371b2755e573cc28650d14dfe",
    "hook": "The paper OpenAI almost didn't release. See what it was built on.",
    "stats": { "papers": 267, "edges": 698, "fields": 3, "depth": 2 }
  }
]
```

**Note:** `data/gallery_index.json` is committed to git. Verify `.gitignore` doesn't
swallow it (Phase 1 ignores `data/precomputed/` — this file is at `data/`, not inside
`precomputed/`):

```bash
git check-ignore -v data/gallery_index.json
# No output = tracked correctly ✅
# If ignored: update .gitignore to use data/precomputed/*.json instead of data/precomputed/
git add data/gallery_index.json
```

---

## §10 — Neon Database Setup

Run these steps **once**. After `scripts/migrate.py` runs successfully, do not re-run it
except to add missing tables.

### §10.0 — Verify `computed_at` column exists (Phase 3 ALTER TABLE)

```bash
psql $DATABASE_URL -c "SELECT computed_at FROM graphs LIMIT 0;"
```

If this fails with "column does not exist":
```bash
psql $DATABASE_URL -c "ALTER TABLE graphs ADD COLUMN IF NOT EXISTS computed_at TIMESTAMP DEFAULT NOW();"
```

### §10.1 — Verify pgvector is enabled

```bash
psql $DATABASE_URL -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

### §10.2 — Run Phase 4 migration additions

```bash
python scripts/migrate.py
```

The Phase 4 backport (§0.7) added `insight_cache`, fixed `insight_feedback`, and ensures
`genealogy_cache` and `session_graphs` exist. This must complete without error.

### §10.3 — Verify all required tables exist

```bash
psql $DATABASE_URL -c "
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' ORDER BY table_name;"
```

Expected tables:

```
action_log
background_jobs
build_jobs
chat_history
edge_analysis
edge_feedback
genealogy_cache
graphs
insight_cache
insight_feedback
job_events
llm_cache
paper_embeddings
papers
retraction_watch
session_graphs
sessions
```

**Note on table names:**
- `edge_analysis` is correct (Phase 1 DDL). The complete spec §61 variant `edge_analysis_cache` was never executed.
- `paper_embeddings` is correct (Phase 1 DDL). The §61 variant `embedding_cache` was never executed.
- `retraction_watch` is correct (Phase 1 DDL). The §61 variant `retractions` was never executed.
- `insight_cache` is the Phase 4 canonical name. The `insights` table from Phase 3's earlier DDL may also exist — that's fine, it's unused by routes.

**Recovery SQL for missing tables:**

```bash
# If insight_cache missing:
psql $DATABASE_URL -c "
CREATE TABLE IF NOT EXISTS insight_cache (
    id SERIAL PRIMARY KEY, paper_id TEXT NOT NULL UNIQUE,
    insights_json JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMP NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS idx_insight_cache_paper ON insight_cache(paper_id);"

# If genealogy_cache missing:
psql $DATABASE_URL -c "
CREATE TABLE IF NOT EXISTS genealogy_cache (
    paper_id TEXT PRIMARY KEY, story_json JSONB,
    computed_at TIMESTAMP DEFAULT NOW());"

# If session_graphs missing:
psql $DATABASE_URL -c "
CREATE TABLE IF NOT EXISTS session_graphs (
    session_id TEXT, graph_id TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (session_id, graph_id));
CREATE INDEX IF NOT EXISTS idx_sgs ON session_graphs(session_id, created_at DESC);"

# If background_jobs, llm_cache missing (added by Phase 3):
python scripts/migrate.py  # safe to re-run — all DDL uses IF NOT EXISTS
```

### §10.4 — Verify ALTER TABLE columns on `graphs`

```bash
psql $DATABASE_URL -c "
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'graphs' ORDER BY column_name;"
```

Must include: `computed_at`, `dna_json`, `diversity_json`, `leaderboard_json`.

If any missing:
```bash
psql $DATABASE_URL -c "
ALTER TABLE graphs ADD COLUMN IF NOT EXISTS leaderboard_json JSONB;
ALTER TABLE graphs ADD COLUMN IF NOT EXISTS dna_json JSONB;
ALTER TABLE graphs ADD COLUMN IF NOT EXISTS diversity_json JSONB;
ALTER TABLE graphs ADD COLUMN IF NOT EXISTS computed_at TIMESTAMP DEFAULT NOW();"
```

---

## §11 — NLP Worker: Deploy on HuggingFace Spaces

### §11.1 — Create the Space

1. huggingface.co → Spaces → Create new Space
2. Name: `arivu-nlp`
3. SDK: **Docker**
4. Hardware: **CPU Basic** (free)
5. Visibility: **Public** (the `WORKER_SECRET` protects it)

### §11.2 — Upload files to the Space

```
nlp_worker/app.py        → upload as app.py      (includes §0.9 auth fix)
nlp_worker/Dockerfile    → upload as Dockerfile
nlp_worker/requirements.txt → upload as requirements.txt
```

Or link to a GitHub repo containing these files.

### §11.3 — Set Space secrets

In Space settings → "Repository secrets":

```
WORKER_SECRET=<same value as your Koyeb WORKER_SECRET>
```

This must be **identical** to `WORKER_SECRET` in Koyeb. A trailing newline causes silent 401s.

The updated `nlp_worker/app.py` (backport §0.9) also reads `NLP_WORKER_SECRET` as fallback
during transition — you may keep the old secret set while verifying the new one works.

### §11.4 — Verify NLP worker health

After Space builds (3–5 min for model download):

```bash
curl https://your-username-arivu-nlp.hf.space/health
# Expected: {"status": "ok", "model_loaded": true}
```

### §11.5 — Test encode endpoint

The worker now accepts both `X-API-Key` (Phase 4 canonical) and `Authorization: Bearer`:

```bash
# Phase 4 canonical format (X-API-Key):
curl -X POST https://your-username-arivu-nlp.hf.space/encode_batch \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $WORKER_SECRET" \
  -d '{"texts": ["Attention mechanisms allow direct access to any position."]}'
# Expected: {"embeddings": [[...384 floats...]]}
```

---

## §12 — Koyeb Deployment

### §12.1 — Create Koyeb service

1. koyeb.com → Create App → Deploy from GitHub
2. Build: **Dockerfile**
3. Port: `8000`
4. Health check path: `/health`
5. Health check interval: `30s`
6. Instance type: **Eco** (free, always-on, 512MB RAM)

### §12.2 — Set all environment variables

```bash
# Required
FLASK_SECRET_KEY=<64-char random hex>
DATABASE_URL=postgresql://user:pass@ep-xxx.neon.tech/arivu?sslmode=require
NLP_WORKER_URL=https://your-username-arivu-nlp.hf.space
WORKER_SECRET=<same as HF Spaces>
R2_ACCOUNT_ID=<cloudflare account id>
R2_ACCESS_KEY_ID=<r2 access key>
R2_SECRET_ACCESS_KEY=<r2 secret key>
R2_ENDPOINT_URL=https://ACCOUNT_ID.r2.cloudflarestorage.com
R2_BUCKET_NAME=arivu-data

# DB pool — critical for 2-worker setup
DB_POOL_MAX=4
DB_POOL_MIN=1

# Set AFTER first deploy (copy hostname from Koyeb dashboard, no https://)
# KOYEB_PUBLIC_DOMAIN=your-app-xxx.koyeb.app

# Recommended
S2_API_KEY=<semantic scholar api key>
GROQ_API_KEY=<groq api key>
SENTRY_DSN=<sentry dsn>
OPENALEX_EMAIL=<your email>

# Optional
CORE_API_KEY=<core api key>
CROSSREF_MAILTO=<your email>
FLASK_DEBUG=false
NLP_WORKER_TIMEOUT=90
```

**After first deploy:** Copy the Koyeb-assigned hostname (e.g. `my-app-abc123.koyeb.app`)
and add it as `KOYEB_PUBLIC_DOMAIN` — then redeploy. Without it, CORS blocks
cross-origin API requests (page loads still work).

### §12.3 — Initial deploy

Trigger deploy. Watch logs for:
```
Sentry initialised
Database pool ready
Arivu Phase 4 app ready
```

### §12.4 — Verify deployment health

```bash
KOYEB_URL=https://your-app-xxx.koyeb.app
curl $KOYEB_URL/health
```

Expected:
```json
{
  "status": "healthy",
  "checks": {
    "database": "ok",
    "nlp_worker": "ok",
    "r2_storage": "ok"
  }
}
```

If `nlp_worker` shows `"unreachable"`: HF Space URL wrong or still building.
If `r2_storage` shows `"error"`: R2 credentials wrong or `R2_ENDPOINT_URL` missing account ID.
If `database` shows `"error"`: `DATABASE_URL` missing or lacks `?sslmode=require`.

### §12.5 — Rollback procedure

If deploy fails, check logs (Koyeb dashboard → service → Logs tab):

| Error | Fix |
|-------|-----|
| `RuntimeError: DATABASE_URL is required` | Set `DATABASE_URL` in Koyeb env |
| `ModuleNotFoundError: sentry_sdk` | Must be `sentry-sdk[flask]` in requirements.txt (with brackets) |
| `Error: create_app not found` | Procfile must be `app:create_app()` with parentheses |
| `connection refused` on health check | Check `--bind 0.0.0.0:$PORT` in Procfile |

To revert: Koyeb dashboard → service → Deployments tab → last working deploy → Re-deploy.
Neon data and R2 objects are unaffected by Koyeb rollbacks.

---

## §13 — Run Gallery Precompute

This builds graphs for all 7 gallery papers and uploads to R2.
**Slow: 20–60 minutes total. Makes real API calls.**

### §13.1 — Prerequisites

Verify all before running:

```bash
# 1. Migration complete
python scripts/migrate.py
# Must print "complete" with no errors

# 2. NLP worker healthy
curl $NLP_WORKER_URL/health
# Must return: {"status":"ok","model_loaded":true}

# 3. R2 credentials work
python -c "from backend.r2_client import R2Client; r2=R2Client(); print('R2 enabled:', r2._enabled)"
# Must print: R2 enabled: True

# 4. Validate gallery paper IDs are live on S2 (takes ~30s):
python -c "
import json, requests
for e in json.load(open('data/gallery_index.json')):
    r = requests.get(
        f'https://api.semanticscholar.org/graph/v1/paper/{e[\"paper_id\"]}?fields=title',
        timeout=5
    )
    print(f'{\"✓\" if r.ok else \"✗\"} {e[\"slug\"]:12s}  HTTP {r.status_code}')
"
# Fix any ✗ before running full precompute
```

### §13.2 — Load environment and run

```bash
export $(cat .env | grep -v '^#' | xargs)
python scripts/precompute_gallery.py
```

Expected output per paper:
```
INFO  Processing attention (204e3073...)...
INFO    Graph built in 47.3s: 152 nodes, 487 edges
INFO    Full graph uploaded to R2
INFO    Preview graph uploaded
INFO    Mini SVG uploaded
INFO    Genealogy text uploaded  (only if GROQ_API_KEY set)
INFO    gallery_index.json updated for attention
INFO    attention complete: {'papers': 152, 'edges': 487, ...}
```

### §13.3 — Test run (one paper first)

```bash
python scripts/precompute_gallery.py --slug attention
```

### §13.4 — Force recompute

```bash
python scripts/precompute_gallery.py --slug bert --force
```

### §13.5 — Verify gallery loading in production

```bash
# Must return 200:
curl -I $KOYEB_URL/static/previews/attention/graph.json
curl -I $KOYEB_URL/explore
```

### §13.6 — Verify `gallery_index.json` stats were updated

```bash
python -c "
import json
data = json.load(open('data/gallery_index.json'))
attn = next(e for e in data if e['slug']=='attention')
print(f'papers={attn[\"stats\"][\"papers\"]}  edges={attn[\"stats\"][\"edges\"]}')
print('(§9 placeholders were papers:152, edges:487 — confirm these reflect real data)')
"
```

If stats still show placeholder values, the `precompute_gallery.py` write-back code
(backport §0.8 step 5) was not applied. Apply it and re-run.

---

## §14 — scripts/verify_deployment.py

```python
#!/usr/bin/env python3
"""
scripts/verify_deployment.py

End-to-end smoke test for a deployed Arivu instance.

Usage:
    python scripts/verify_deployment.py                         # uses KOYEB_URL env var
    python scripts/verify_deployment.py https://app.koyeb.app
    python scripts/verify_deployment.py http://localhost:5000   # local dev

Exit: 0 = all passed, 1 = one or more failed.
"""
import sys
import os
import json
import time

try:
    import httpx
except ImportError:
    print("ERROR: httpx not installed.")
    print("Run: pip install httpx  OR  activate your venv: source venv/bin/activate")
    sys.exit(1)

BASE_URL = (sys.argv[1] if len(sys.argv) > 1
            else os.environ.get("KOYEB_URL", "http://localhost:5000")).rstrip("/")

GALLERY_SLUGS = ["attention", "alexnet", "bert", "gans", "word2vec", "resnet", "gpt2"]

PASS = "✓"
FAIL = "✗"
SKIP = "⊘"
results = []


def check(name: str, fn):
    try:
        status, detail = fn()
        symbol = PASS if status else FAIL
        results.append((status, name, detail))
        print(f"  {symbol} {name}: {detail}")
        return status
    except Exception as e:
        results.append((False, name, f"ERROR: {e}"))
        print(f"  {FAIL} {name}: ERROR — {e}")
        return False


def main():
    print(f"\nArivu deployment verification")
    print(f"Target: {BASE_URL}")
    print(f"Time:   {time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())}\n")

    client = httpx.Client(timeout=30.0, follow_redirects=True)

    # ── 1. Health Check ───────────────────────────────────────────
    print("1. Health Check")

    def check_health():
        r = client.get(f"{BASE_URL}/health")
        if r.status_code != 200:
            return False, f"HTTP {r.status_code}"
        data = r.json()
        overall = data.get("status", "unknown")
        checks  = data.get("checks", {})
        detail  = f"status={overall} | " + " | ".join(f"{k}={v}" for k, v in checks.items())
        return overall in ("healthy", "degraded"), detail

    check("GET /health", check_health)

    # ── 2. Page Routes ────────────────────────────────────────────
    print("\n2. Page Routes")

    for path, name in [("/", "Landing page"), ("/tool", "Tool page"), ("/explore", "Gallery page")]:
        def _page_check(p=path):
            r = client.get(f"{BASE_URL}{p}")
            return r.status_code == 200, f"HTTP {r.status_code}, {len(r.text)} bytes"
        check(f"GET {path} — {name}", _page_check)

    # ── 3. API Endpoints ──────────────────────────────────────────
    print("\n3. API Endpoints")

    def check_search():
        r = client.post(f"{BASE_URL}/api/search",
                        json={"query": "attention is all you need"},
                        headers={"Content-Type": "application/json"})
        return r.status_code in (200, 401, 429), f"HTTP {r.status_code}"

    check("POST /api/search", check_search)

    def check_prune_no_session():
        r = client.post(f"{BASE_URL}/api/prune",
                        json={"paper_ids": ["test"], "graph_seed_id": "test"})
        return r.status_code == 401, f"HTTP {r.status_code} (expected 401)"

    check("POST /api/prune requires session", check_prune_no_session)

    def check_quality_no_session():
        r = client.get(f"{BASE_URL}/api/quality")
        if r.status_code == 401:
            return True, "HTTP 401 (correct — session required)"
        if r.status_code == 200:
            try:
                data = r.json()
                has = "quality_score" in data
                return has, f"HTTP 200, quality_score={'present' if has else 'MISSING'}"
            except Exception:
                return False, "HTTP 200 but invalid JSON"
        return False, f"Unexpected HTTP {r.status_code}"

    check("GET /api/quality (auth check)", check_quality_no_session)

    # ── 4. Gallery Previews ───────────────────────────────────────
    print("\n4. Gallery Previews (R2 proxy routes)")

    for slug in GALLERY_SLUGS:
        def _gallery_check(s=slug):
            r = client.get(f"{BASE_URL}/static/previews/{s}/graph.json", timeout=15.0)
            if r.status_code == 200:
                try:
                    data  = r.json()
                    nodes = len(data.get("nodes", []))
                    return True, f"HTTP 200, {nodes} nodes"
                except Exception:
                    return False, "HTTP 200 but invalid JSON"
            elif r.status_code == 503:
                return False, "HTTP 503 — R2 not configured or precompute not run"
            else:
                return False, f"HTTP {r.status_code}"
        check(f"GET /static/previews/{slug}/graph.json", _gallery_check)

    # ── 5. Gallery SVG Previews ───────────────────────────────────
    print("\n5. Gallery SVG Previews")

    for slug in ["attention", "bert", "resnet"]:
        def _svg_check(s=slug):
            r = client.get(f"{BASE_URL}/static/previews/{s}.svg")
            if r.status_code == 200 and r.headers.get("content-type","").startswith("image/svg"):
                return True, f"HTTP 200, {len(r.text)} bytes SVG"
            elif r.status_code == 200:
                return r.text.strip().startswith("<svg"), (
                    f"HTTP 200, content-type={r.headers.get('content-type')}")
            return False, f"HTTP {r.status_code}"
        check(f"GET /static/previews/{s}.svg", _svg_check)  # use captured s, not slug

    # ── 6. Gallery Index JSON ─────────────────────────────────────
    print("\n6. Gallery Index")

    def check_gallery_index():
        r = client.get(f"{BASE_URL}/static/gallery_index.json")
        if r.status_code != 200:
            return False, f"HTTP {r.status_code}"
        try:
            data = r.json()
            return isinstance(data, list) and len(data) == 7, f"HTTP 200, {len(data)} entries"
        except Exception:
            return False, "HTTP 200 but invalid JSON"

    check("GET /static/gallery_index.json", check_gallery_index)

    # ── 7. NLP Worker ─────────────────────────────────────────────
    print("\n7. NLP Worker")

    nlp_url = os.environ.get("NLP_WORKER_URL", "")
    if nlp_url:
        def check_nlp():
            r = httpx.get(f"{nlp_url}/health", timeout=10.0)
            data   = r.json()
            loaded = data.get("model_loaded", False)
            return r.status_code == 200 and loaded, f"HTTP {r.status_code}, model_loaded={loaded}"
        check(f"GET {nlp_url}/health", check_nlp)
    else:
        print(f"  {SKIP} NLP worker check skipped (NLP_WORKER_URL not set)")

    # ── 8. Summary ────────────────────────────────────────────────
    print()
    passed = sum(1 for ok, _, _ in results if ok)
    failed = sum(1 for ok, _, _ in results if not ok)
    total  = len(results)

    print(f"Results: {passed}/{total} passed, {failed} failed")

    if failed:
        print("\nFailed checks:")
        for ok, name, detail in results:
            if not ok:
                print(f"  {FAIL} {name}: {detail}")
        sys.exit(1)
    else:
        print(f"\n{PASS} All checks passed. Arivu is healthy.")
        sys.exit(0)


if __name__ == "__main__":
    main()
```

---

## §15 — tests/test_phase4.py

```python
"""
tests/test_phase4.py

Phase 4 deployment validation tests. All tests are offline — no live
Neon, R2, or NLP worker required.

Run: pytest tests/test_phase4.py -v
"""
import json
import os
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock


# ─── ProductionQualityMonitor ─────────────────────────────────────────────────

class TestProductionQualityMonitor:

    def _make_graph(self, n_edges=20, similarity_std=0.15,
                    incidental_rate=0.2, with_abstracts=0.9) -> dict:
        import math, random
        rng = random.Random(42)
        nodes = [{"id": f"p{i}", "title": f"Paper {i}",
                  "citation_count": rng.randint(10, 1000),
                  "abstract": "Test abstract" if rng.random() < with_abstracts else None,
                  "year": 2010 + i}
                 for i in range(max(n_edges // 2, 5))]
        mutation_types = ["adoption", "generalization", "specialization",
                          "hybridization", "contradiction", "incidental"]
        edges = []
        for i in range(n_edges):
            mtype = "incidental" if rng.random() < incidental_rate else rng.choice(mutation_types[:5])
            sim   = min(1.0, max(0.0, 0.5 + rng.gauss(0, similarity_std)))
            edges.append({"source": f"p{i % max(len(nodes), 1)}",
                          "target": f"p{(i+1) % max(len(nodes), 1)}",
                          "similarity_score": round(sim, 3),
                          "mutation_type": mtype,
                          "final_confidence": round(rng.uniform(0.3, 1.0), 3)})
        return {"nodes": nodes, "edges": edges}

    def test_healthy_graph_high_score(self):
        from backend.quality_monitor import ProductionQualityMonitor
        monitor = ProductionQualityMonitor()
        result  = monitor.analyze_graph_quality(
            self._make_graph(n_edges=30, similarity_std=0.2, incidental_rate=0.1))
        assert 0.0 <= result["quality_score"] <= 1.0
        assert isinstance(result["metrics"], dict)
        assert isinstance(result["issues"], list)
        assert "timestamp" in result

    def test_empty_graph_zero_score(self):
        from backend.quality_monitor import ProductionQualityMonitor
        monitor = ProductionQualityMonitor()
        result  = monitor.analyze_graph_quality({"nodes": [], "edges": []})
        assert result["quality_score"] == 0.0
        assert len(result["issues"]) >= 1

    def test_low_variance_similarity_flagged(self):
        from backend.quality_monitor import ProductionQualityMonitor
        monitor = ProductionQualityMonitor()
        graph = {"nodes": [{"id": f"p{i}", "abstract": "x"} for i in range(10)],
                 "edges": [{"source": "p0", "target": f"p{i}",
                            "similarity_score": 0.5,
                            "mutation_type": "adoption",
                            "final_confidence": 0.8} for i in range(1, 20)]}
        result = monitor.analyze_graph_quality(graph)
        assert any("VARIANCE" in i for i in result["issues"])

    def test_high_incidental_rate_flagged(self):
        from backend.quality_monitor import ProductionQualityMonitor
        monitor = ProductionQualityMonitor()
        result  = monitor.analyze_graph_quality(self._make_graph(n_edges=20, incidental_rate=0.95))
        assert any("INCIDENTAL" in i for i in result["issues"])

    def test_check_thresholds_returns_list(self):
        from backend.quality_monitor import ProductionQualityMonitor
        monitor = ProductionQualityMonitor()
        result  = {"quality_score": 0.2,
                   "metrics": {"abstract_coverage": 0.3, "low_confidence_rate": 0.8}}
        alerts  = monitor.check_thresholds(result)
        assert isinstance(alerts, list)
        assert len(alerts) >= 2

    def test_check_thresholds_healthy_returns_empty(self):
        from backend.quality_monitor import ProductionQualityMonitor
        monitor = ProductionQualityMonitor()
        result  = {"quality_score": 0.9,
                   "metrics": {"abstract_coverage": 0.9, "low_confidence_rate": 0.1}}
        assert monitor.check_thresholds(result) == []

    def test_is_bimodal_with_clear_bimodal(self):
        from backend.quality_monitor import ProductionQualityMonitor
        values = [0.05, 0.1, 0.08, 0.12, 0.06, 0.85, 0.9, 0.88, 0.92, 0.87, 0.91]
        assert ProductionQualityMonitor()._is_bimodal(values) is True

    def test_is_bimodal_uniform_not_bimodal(self):
        from backend.quality_monitor import ProductionQualityMonitor
        values = [i / 10 for i in range(10)]
        assert ProductionQualityMonitor()._is_bimodal(values) is False


# ─── Config ───────────────────────────────────────────────────────────────────

class TestConfig:

    def test_validate_raises_without_database_url(self):
        import backend.config as cfg_mod
        original = cfg_mod.Config.DATABASE_URL
        cfg_mod.Config.DATABASE_URL = ""
        try:
            with pytest.raises(RuntimeError, match="DATABASE_URL"):
                cfg_mod.Config.validate()
        finally:
            cfg_mod.Config.DATABASE_URL = original

    def test_validate_passes_with_database_url(self):
        import backend.config as cfg_mod
        cfg_mod.Config.DATABASE_URL = "postgresql://localhost/test"
        cfg_mod.Config.validate()  # must not raise

    def test_config_has_required_attributes(self):
        from backend.config import Config
        required = [
            "SECRET_KEY", "DEBUG", "DATABASE_URL",
            "S2_API_KEY", "GROQ_API_KEY", "CORE_API_KEY",
            "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY",
            "R2_BUCKET_NAME", "R2_ENDPOINT_URL",
            "NLP_WORKER_URL", "WORKER_SECRET",
            "SENTRY_DSN", "KOYEB_PUBLIC_DOMAIN",
            "DB_POOL_MAX", "DB_POOL_MIN",
        ]
        for attr in required:
            assert hasattr(Config, attr), f"Config missing: {attr}"

    def test_backward_compat_alias(self):
        """config = Config alias must work for Phase 1/2/3 imports."""
        from backend.config import config, Config
        assert config is Config


# ─── gallery_index.json ───────────────────────────────────────────────────────

class TestGalleryIndex:
    GALLERY_PATH = Path(__file__).parent.parent / "data" / "gallery_index.json"

    def test_file_exists(self):
        assert self.GALLERY_PATH.exists(), (
            f"data/gallery_index.json not found at {self.GALLERY_PATH}. Create it per §9.")

    def test_has_seven_entries(self):
        with open(self.GALLERY_PATH) as f:
            data = json.load(f)
        assert len(data) == 7, f"Expected 7 entries, got {len(data)}"

    def test_required_fields_present(self):
        with open(self.GALLERY_PATH) as f:
            data = json.load(f)
        required = ["slug", "title", "authors", "year", "field", "paper_id", "hook", "stats"]
        for entry in data:
            for field in required:
                assert field in entry, f"Entry '{entry.get('slug')}' missing: {field}"

    def test_slugs_match_expected(self):
        with open(self.GALLERY_PATH) as f:
            data = json.load(f)
        expected = {"attention", "alexnet", "bert", "gans", "word2vec", "resnet", "gpt2"}
        actual   = {e["slug"] for e in data}
        assert actual == expected, f"Missing: {expected-actual}. Extra: {actual-expected}"

    def test_paper_ids_are_nonempty_hex_strings(self):
        with open(self.GALLERY_PATH) as f:
            data = json.load(f)
        for entry in data:
            pid = entry["paper_id"]
            assert isinstance(pid, str) and len(pid) > 10, (
                f"Entry '{entry['slug']}' has invalid paper_id: {pid!r}")

    def test_stats_shape(self):
        with open(self.GALLERY_PATH) as f:
            data = json.load(f)
        for entry in data:
            stats = entry.get("stats", {})
            assert "papers" in stats and "edges" in stats, (
                f"Entry '{entry['slug']}' stats missing 'papers' or 'edges'")


# ─── semantic-zoom.js ─────────────────────────────────────────────────────────

class TestSemanticZoomJS:
    JS_PATH = Path(__file__).parent.parent / "static" / "js" / "semantic-zoom.js"

    def test_file_exists(self):
        assert self.JS_PATH.exists(), "static/js/semantic-zoom.js not found. Create it per §8."

    def test_contains_class_definition(self):
        assert "class SemanticZoomRenderer" in self.JS_PATH.read_text()

    def test_has_required_methods(self):
        content = self.JS_PATH.read_text()
        for method in ["renderClusters", "removeClusterOverlay", "updateClusterPositions"]:
            assert method in content, f"SemanticZoomRenderer missing method: {method}"


# ─── Sentry init ──────────────────────────────────────────────────────────────

class TestSentryInit:

    def test_sentry_init_no_dsn_does_not_raise(self):
        """_init_sentry must not raise if SENTRY_DSN is not set."""
        import backend.config as cfg_mod
        original = cfg_mod.Config.SENTRY_DSN
        cfg_mod.Config.SENTRY_DSN = ""
        try:
            from flask import Flask
            test_app = Flask(__name__)
            import app as app_mod
            if hasattr(app_mod, "_init_sentry"):
                app_mod._init_sentry(test_app)
        finally:
            cfg_mod.Config.SENTRY_DSN = original

    def test_add_security_headers_present(self):
        """add_security_headers must be a module-level function in app.py."""
        import app as app_mod
        assert hasattr(app_mod, "add_security_headers"), (
            "app.py must define add_security_headers() at module level (not inside create_app)")

    def test_security_headers_contain_csp(self):
        """add_security_headers must attach Content-Security-Policy."""
        import app as app_mod
        from flask import Flask
        test_app = Flask(__name__)
        with test_app.test_request_context("/"):
            from flask import Response
            resp = app_mod.add_security_headers(Response())
            assert "Content-Security-Policy" in resp.headers
```

---

## §16 — Update CONTEXT.md

**Commit 1:** All Phase 4 implementation files.
```
[phase4] deployment, monitoring, gallery launch, semantic zoom, all gap fixes
```

**Commit 2:** CONTEXT.md update.
```
[context] Phase 4 complete — Arivu is live
```

In `CONTEXT.md`:
- Move "Phase 4" from "In Progress" to "Completed"
- Add "Live Deployment" section with Koyeb URL, HuggingFace URL, Neon project, R2 bucket

---

## §17 — Common Failure Modes

### Koyeb cold start / 502
Eco instances restart occasionally. Wait 10 seconds, retry. The `/health` endpoint handles graceful restarts.

### R2 credentials wrong
`R2_ENDPOINT_URL` must include account ID: `https://ACCOUNT_ID.r2.cloudflarestorage.com`.
Find account ID: Cloudflare dashboard → R2 → Overview (top right).

### NLP worker 401 on encode
`WORKER_SECRET` on HuggingFace must exactly match Koyeb's `WORKER_SECRET`. A trailing
newline in the HF secret causes silent auth failures. The updated worker (backport §0.9)
accepts both `X-API-Key` and `Authorization: Bearer` headers.

### precompute_gallery.py hangs
S2 API: 100 req/min unauthenticated, 1000/min with `S2_API_KEY`. If slow (>5 min/paper), confirm key is set.

### `sentry_sdk` ImportError on Koyeb
Must be `sentry-sdk[flask]` (with `[flask]` extra) in `requirements.txt`.

### DATABASE_URL missing sslmode
Neon requires `?sslmode=require`. Copy the exact string from Neon dashboard → Connection Details.

### `gunicorn create_app not found`
Procfile must say `app:create_app()` with parentheses.

### CORS blocking API calls
After first deploy, set `KOYEB_PUBLIC_DOMAIN=your-app-xxx.koyeb.app` in Koyeb env vars, then redeploy.

### Gallery shows placeholder stats
Run `precompute_gallery.py` and verify backport §0.8 step 5 is applied (write-back to `gallery_index.json`).

---

## Done When

Phase 4 is complete when ALL of the following are true:

1. **All tests pass:**
   ```bash
   python -m pytest tests/ -v
   ```
   All pass. 0 failed. (smoke + phase2 + phase3 + phase4)

2. **Health check is green:**
   ```bash
   curl https://your-koyeb-url/health
   ```
   Returns `{"status":"healthy","checks":{"database":"ok","nlp_worker":"ok","r2_storage":"ok"}}`

3. **All 7 gallery entries load:**
   Visit each: `/explore/attention`, `/explore/bert`, `/explore/alexnet`, `/explore/gans`,
   `/explore/word2vec`, `/explore/resnet`, `/explore/gpt2` — each loads precomputed graph.

4. **Landing page demo works:**
   Visit `/` → click "Show me" → graph animates from R2 data.

5. **Tool page works end-to-end:**
   Search for "attention is all you need", select paper, observe graph via SSE, prune a node.

6. **Quality endpoint responds:**
   After building a graph: `curl https://your-koyeb-url/api/quality`
   Returns JSON with `quality_score` field.

7. **Sentry captures errors** (if SENTRY_DSN set):
   `GET /nonexistent` → verify 404 appears in Sentry project.

8. **Deployment verification script passes:**
   ```bash
   python scripts/verify_deployment.py https://your-koyeb-url
   ```
   Prints "All checks passed."

9. **Semantic zoom activates:**
   Tool page with graph loaded → scroll down until zoom scale < 0.4 → cluster bubbles appear.

10. **Gallery stats show real data:**
    `data/gallery_index.json` shows real node/edge counts (not §9 placeholders).

11. **CONTEXT.md updated**, live URL recorded.

12. **Two git commits on `main`:**
    - `[phase4] deployment, monitoring, gallery launch, semantic zoom, all gap fixes`
    - `[context] Phase 4 complete — Arivu is live`

---

## What NOT To Do in Phase 4

- Do NOT implement user accounts, auth, or Stripe billing
- Do NOT implement the Time Machine, Vocabulary Evolution, or Extinction Event features
- Do NOT implement `paradigm_detector.py`, `originality_mapper.py`, or `living_paper_scorer.py`
- Do NOT implement the export system (docx/PDF/SVG)
- Do NOT set `ENABLE_AUTH=true` — auth is not implemented in Phase 4
- Do NOT run `scripts/load_retraction_watch.py` unless you have the CSV downloaded
- Do NOT add `--reload` to gunicorn in Procfile — it breaks SSE streams
- Do NOT use `flask run` in production — always gunicorn via Procfile
- Do NOT set `FLASK_DEBUG=true` in Koyeb — disables security headers and exposes debugger
- Do NOT add `--workers 3` or higher without reducing `DB_POOL_MAX` or upgrading Neon
- Do NOT re-run the original `scripts/migrate.py` if the DB already has data —
  it is safe to re-run (uses IF NOT EXISTS) but unnecessary after Phase 3
