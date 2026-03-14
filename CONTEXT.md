# Arivu — Active Context

## Current Phase
Phase 4 — Deployment, Production Hardening & Gallery Launch

## Phases
### Completed
- [x] Phase 1 — skeleton, schema, smoke tests
- [x] Phase 2 — data layer, NLP worker, graph build pipeline
- [x] Phase 3 — full-text pipeline, intelligence layer & frontend
- [x] Phase 4 — deployment, production hardening & gallery launch

### Not Started
- Phase 5 through Phase 8

## Live Deployment (Phase 4+)
| Service | URL |
|---------|-----|
| Backend (Koyeb) | _not deployed yet — code ready, deployment manual (§10-§13)_ |
| NLP Worker (HF) | _not deployed yet — code ready, deployment manual (§11)_ |

## Architecture Notes
- DB pool: 2 workers × DB_POOL_MAX=4 = 8 connections (Neon free cap = 10)
- Docker container `arivu-db` (pgvector/pgvector:pg16) on port 5433
- Python venv `.venv` with Python 3.10.11 (conda envs corrupted by Windows Defender)
- Config pattern changed: class-attribute Config with `config = Config` alias (Phase 4 §5)

## Last Session Summary
Phase 4 code implementation completed across two sessions. All Phase 4 code deliverables implemented:

**Backports (§0.1-§0.11):** Module-level app (§0.1), session_manager/rate_limiter imports (§0.2-§0.3),
get_session_id() (§0.4), check_sync()/get_429_response() (§0.5), R2Client optional config (§0.6),
migrate.py insight fixes (§0.7), precompute_gallery.py crash fixes (§0.8), dual NLP auth (§0.9),
semanticZoom init (§0.10), test_phase3 fixture fix (§0.11).

**Config rewrite (§5):** Class-attribute pattern replaces instance-based singleton. validate() is
called explicitly in create_app(). DB_POOL_MAX default changed from 8 to 4. WORKER_SECRET reads
both env var names. NLP_WORKER_TIMEOUT default 90s. KOYEB_PUBLIC_DOMAIN added.

**app.py overhaul (§6):** Sentry init with PII scrubbing, Koyeb-aware CORS, security headers
(CSP, HSTS, X-Frame-Options), Phase 4 health format with checks dict, /api/quality route,
/static/gallery_index.json route. All Phase 2/3 routes preserved.

**New files:** backend/quality_monitor.py (ProductionQualityMonitor — 5 quality metrics),
static/js/semantic-zoom.js (SemanticZoomRenderer — cluster bubbles on zoom-out),
data/gallery_index.json (7 gallery papers with placeholder stats),
scripts/verify_deployment.py (deployment smoke test), tests/test_phase4.py (24 tests).

**Deployment files:** Procfile (2 workers), Dockerfile updated, nlp_worker/Dockerfile updated,
nlp_worker/requirements.txt updated per Phase 4 spec. CONFLICT-005 resolved.

**Full test suite: 95 passed, 0 failed** (3 smoke + 32 phase2 + 36 phase3 + 24 phase4).

**Remaining for full Phase 4 completion:** Manual deployment steps (§10-§13):
Neon DB setup (§10), NLP worker on HuggingFace Spaces (§11), Koyeb deployment (§12),
gallery precompute (§13). These require external service configuration and cannot be
automated in code. After deployment, re-run verify_deployment.py and update live URLs above.

## Known Issues / Blockers
- Integration test requires NLP worker running on port 7860 — start with `cd nlp_worker && uvicorn app:app --port 7860`
- R2 not configured in local dev — graphs not cached (expected, graceful degradation)
- Conda envs `arivu` and `arivu2` corrupted by Windows Defender blocking python.exe — use `.venv` instead
- No S2 API key configured — rate limited to 1 req/s (sufficient for dev, may slow integration test)
- Gallery stats in data/gallery_index.json are placeholders — will be updated by precompute_gallery.py after R2 is configured
- KOYEB_PUBLIC_DOMAIN not set — CORS not configured for production (set after first deploy)

## Environment
- DATABASE_URL: postgresql://arivu:localdev@localhost:5433/arivu?sslmode=disable
- NLP_WORKER_URL: http://localhost:7860 (dev)
- Docker container: arivu-db (pgvector/pgvector:pg16, port 5433)
- Python environment: .venv (Python 3.10.11, created from C:\Users\xplod\AppData\Local\Programs\Python\Python310\python.exe)
- Deployed to Koyeb: no (code ready, manual deployment pending)
