# Arivu — Active Context

## Current Phase
Phase 5 — Export System, Advanced Intelligence & Custom Domain

## Phases
### Completed
- [x] Phase 1 — skeleton, schema, smoke tests
- [x] Phase 2 — data layer, NLP worker, graph build pipeline
- [x] Phase 3 — full-text pipeline, intelligence layer & frontend
- [x] Phase 4 — deployment, production hardening & gallery launch

### In Progress
- [ ] Phase 5 — export system, advanced intelligence & custom domain

### Not Started
- Phase 6 through Phase 8

## Live Deployment (Phase 4+)
| Service | URL |
|---------|-----|
| Backend (Koyeb) | https://supreme-dorthea-devkrishna-a8d9791a.koyeb.app |
| NLP Worker (HF) | https://dxv-404-arivu-nlp.hf.space |
| Database (Neon) | ep-young-haze-a1qrxgk6-pooler.ap-southeast-1.aws.neon.tech |

## Architecture Notes
- DB pool: 2 workers × DB_POOL_MAX=4 = 8 connections (Neon free cap = 10)
- Docker container `arivu-db` (pgvector/pgvector:pg16) on port 5433 (local dev)
- Python venv `.venv` with Python 3.10.11 (conda envs corrupted by Windows Defender)
- Config pattern changed: class-attribute Config with `config = Config` alias (Phase 4 §5)
- Neon URL requires stripping `channel_binding=require` (psycopg2 incompatible)
- R2 bucket: `arivu-graphs` (not `arivu-data` from spec)
- Koyeb free tier scales to zero after 65 min idle — upgrade to eNano ($1.61/mo) for always-on production use

## Last Session Summary
Phase 4 deployment complete. Koyeb live and healthy. All critical verify_deployment.py
checks passing. Health endpoint returns database=ok, nlp_worker=ok, r2_storage=ok.
Landing page, tool page, gallery page all return HTTP 200. Gallery index serves 7 entries.

Fixed verify_deployment.py prune test — @require_session auto-creates sessions (never
returns 401). Updated test to verify route exists (returns JSON) instead of checking for
401 which the decorator never produces.

Gallery precompute pending (requires running precompute_gallery.py after S2 API key arrives).
/api/prune route confirmed registered and responding.

Added CRITIQUE_LOG entries for Dockerfile Debian Trixie rename and prune test fix.
Added DECISIONS.md ADR-014 (Neon production DB) and ADR-015 (HF Spaces NLP worker).

## Known Issues / Blockers
- Gallery previews not yet generated — run precompute_gallery.py once S2 key arrives
- Koyeb free tier will scale to zero after 65 min idle
- S2_API_KEY pending approval from Semantic Scholar
- Production routes using @require_session return 500 for first-time visitors (session creation under gunicorn multi-worker — investigating)

## Environment
- DATABASE_URL: postgresql://arivu:localdev@localhost:5433/arivu?sslmode=disable (local)
- NEON_DATABASE_URL: postgresql://neondb_owner:***@ep-young-haze-a1qrxgk6-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
- NLP_WORKER_URL: http://localhost:7860 (dev) / https://dxv-404-arivu-nlp.hf.space (prod)
- Docker container: arivu-db (pgvector/pgvector:pg16, port 5433)
- Python environment: .venv (Python 3.10.11)
- Deployed to Koyeb: https://supreme-dorthea-devkrishna-a8d9791a.koyeb.app
