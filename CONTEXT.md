# Arivu — Active Context

## Current Phase
Phase 4 — Deployment, Production Hardening & Gallery Launch

## Phases
### Completed
- [x] Phase 1 — skeleton, schema, smoke tests
- [x] Phase 2 — data layer, NLP worker, graph build pipeline
- [x] Phase 3 — full-text pipeline, intelligence layer & frontend

### In Progress
- [ ] Phase 4 — deployment, production hardening & gallery launch
  - [x] All backports (§0.1-§0.11) applied
  - [x] Config rewrite (§5) — class-attribute pattern
  - [x] app.py overhaul (§6) — Sentry, CORS, security headers, quality route
  - [x] quality_monitor.py (§7) — ProductionQualityMonitor
  - [x] semantic-zoom.js (§8) — SemanticZoomRenderer
  - [x] gallery_index.json (§9) — 7 gallery papers at data/ root
  - [x] verify_deployment.py (§14) — deployment smoke test
  - [x] test_phase4.py (§15) — 24 tests, 95 total passing
  - [x] Neon DB migration (§10) — 17 tables verified on Neon
  - [x] .env.example updated (§4) — Phase 4 complete env reference
  - [x] nlp_worker/README.md — HF Spaces frontmatter added
  - [x] nlp_worker/Dockerfile — flat COPY paths for HF Spaces
  - [ ] NLP worker deployed on HuggingFace Spaces (§11) — instructions ready
  - [ ] Koyeb deployment (§12) — instructions ready, awaiting execution
  - [ ] Gallery precompute (§13) — blocked on Koyeb deployment
  - [ ] verify_deployment.py against live URL — blocked on Koyeb deployment

### Not Started
- Phase 5 through Phase 8

## Live Deployment (Phase 4+)
| Service | URL |
|---------|-----|
| Backend (Koyeb) | _not deployed yet — instructions ready_ |
| NLP Worker (HF) | https://dxv-404-arivu-nlp.hf.space _(push pending)_ |

## Architecture Notes
- DB pool: 2 workers × DB_POOL_MAX=4 = 8 connections (Neon free cap = 10)
- Docker container `arivu-db` (pgvector/pgvector:pg16) on port 5433 (local dev)
- Python venv `.venv` with Python 3.10.11 (conda envs corrupted by Windows Defender)
- Config pattern changed: class-attribute Config with `config = Config` alias (Phase 4 §5)
- Neon URL requires stripping `channel_binding=require` (psycopg2 incompatible)
- R2 bucket: `arivu-graphs` (not `arivu-data` from spec)

## Last Session Summary
Phase 4 deployment preparation completed. All code deliverables done (95 tests passing).
Neon DB migration successful (17 tables + Phase 3 ALTER TABLE columns verified).
Pre-deployment checks done: .env.example updated, WORKER_SECRET added to .env,
nlp_worker README frontmatter added, Dockerfile fixed for flat HF Spaces context,
health endpoint updated with model_loaded field.

Deployment instructions generated for:
- Task 2: HuggingFace Spaces push (exact git commands + secrets setup)
- Task 3: Complete Koyeb env vars table with actual values
- Task 4: Koyeb deployment step-by-step with error fixes
- Task 5: Post-deployment verification + gallery precompute

Remaining: Execute HF push, Koyeb deployment, verify_deployment.py against live URL,
then gallery precompute. Phase 4 NOT marked complete until live verification passes.

## Known Issues / Blockers
- Neon DATABASE_URL has channel_binding=require — must strip before use
- S2 API key pending — leave blank in Koyeb config
- Gallery previews will be 503 until precompute_gallery.py is run post-deployment
- KOYEB_PUBLIC_DOMAIN must be set after first deploy, then redeploy for CORS
- Conda envs `arivu` and `arivu2` corrupted by Windows Defender — use `.venv`

## Environment
- DATABASE_URL: postgresql://arivu:localdev@localhost:5433/arivu?sslmode=disable (local)
- NEON_DATABASE_URL: postgresql://neondb_owner:***@ep-young-haze-a1qrxgk6-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
- NLP_WORKER_URL: http://localhost:7860 (dev) / https://dxv-404-arivu-nlp.hf.space (prod)
- Docker container: arivu-db (pgvector/pgvector:pg16, port 5433)
- Python environment: .venv (Python 3.10.11)
- Deployed to Koyeb: no (instructions ready, manual deployment pending)
