# Arivu — Active Context

## Current Phase
Phase 7 — Temporal Intelligence, Workflow Tools & Public API (COMPLETE — post-implementation fixes applied)

## Phases
### Completed
- [x] Phase 1 — skeleton, schema, smoke tests
- [x] Phase 2 — data layer, NLP worker, graph build pipeline
- [x] Phase 3 — full-text pipeline, intelligence layer & frontend
- [x] Phase 4 — deployment, production hardening & gallery launch
- [x] Phase 5 — export system, advanced intelligence & custom domain
- [x] Phase 6 — auth, billing & GDPR
- [x] Phase 7 — temporal intelligence, workflow tools & public API

### Not Started
- Phase 8

## Live Deployment (Phase 4+)
| Service | URL |
|---------|-----|
| Backend (Koyeb) | https://supreme-dorthea-devkrishna-a8d9791a.koyeb.app |
| NLP Worker (HF) | https://dxv-404-arivu-nlp.hf.space |
| Database (Neon) | ep-young-haze-a1qrxgk6-pooler.ap-southeast-1.aws.neon.tech |
| Custom Domain | pending DNS setup (arivu.app) |
| Public API | /v1/ blueprint — API key auth via `api_keys` table |

## Architecture Notes
- DB pool: 2 workers × DB_POOL_MAX=4 = 8 connections (Neon free cap = 10)
- Docker container `arivu-db` (pgvector/pgvector:pg16) on port 5433 (local dev)
- Python venv `.venv` with Python 3.10.11 (conda envs corrupted by Windows Defender)
- Config pattern changed: class-attribute Config with `config = Config` alias (Phase 4 §5)
- Neon URL requires stripping `channel_binding=require` (psycopg2 incompatible)
- R2 bucket: `arivu-graphs` (not `arivu-data` from spec)
- Koyeb free tier scales to zero after 65 min idle — upgrade to eNano ($1.61/mo) for always-on production use
- ENABLE_AUTH=false by default — @require_auth passes through; @require_tier and @check_graph_limit are DORMANT (never applied to routes)
- TIER_ORDER dict exists in decorators.py (dormant) — all features free for authenticated users (ADR-016)
- New users register with tier='researcher'; billing.py kept dormant for portfolio reference
- graph_id is now SHA256(seed_paper_id + "_" + session_id)[:32] — stable across rebuilds (ADR-017)
- shared_graphs has full 12-column schema per PHASE_7.md spec (ADR-018)
- CitationGenerator supports 7 formats: APA, MLA, Chicago, BibTeX, IEEE, Harvard, Vancouver (ADR-019)
- R2Client.upload_bytes() alias added for Phase 8 forward compatibility

## Last Session Summary
Phase 7 post-implementation fixes applied. All spec compliance gaps identified in audit and resolved:

**Post-Implementation Fixes Applied:**
- §A: graph_id changed from random UUID to stable SHA256 hash (ADR-017) — `_compute_graph_id()` added to AncestryGraph, wired into _build(), export, R2 key, and DB upsert
- §B: shared_graphs schema expanded from 5 to 12 columns per PHASE_7.md spec (ADR-018) — LabManager.create_share_link() signature updated, app.py share route joins papers table for seed_title
- §C: R2Client.upload_bytes() alias added for Phase 8 forward-compat (secure_upload.py, live_mode.py)
- §G: Vancouver citation format added as 7th style (ADR-019) — backend SUPPORTED_STYLES and frontend citation-gen.js both updated

**Previously Applied (prior session):**
- Route-to-module interface fixes: CitationAudit, CitationGenerator, ReadingPrioritizer, CounterfactualEngine, AdversarialReviewer
- ADR-016: All features free; billing dormant; @require_tier removed from all routes

**Tests:** 219 total (51 Phase 7 tests), 0 failures across all phases

## Known Issues / Blockers
- Gallery previews not yet generated — run precompute_gallery.py once S2 key arrives
- Koyeb free tier will scale to zero after 65 min idle
- S2_API_KEY pending approval from Semantic Scholar
- Custom domain (arivu.app) DNS not yet configured
- ground_truth_eval.py needs ≥20 pairs before running eval (currently has 5 seed pairs)
- WeasyPrint requires libcairo2 on the system — verify Dockerfile includes it
- ENABLE_AUTH should be set to true in Koyeb only after end-to-end testing
- Phase 7 migration needs to be run against Neon production database

## Environment
- DATABASE_URL: postgresql://arivu:localdev@localhost:5433/arivu?sslmode=disable (local)
- NEON_DATABASE_URL: postgresql://neondb_owner:***@ep-young-haze-a1qrxgk6-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
- NLP_WORKER_URL: http://localhost:7860 (dev) / https://dxv-404-arivu-nlp.hf.space (prod)
- Docker container: arivu-db (pgvector/pgvector:pg16, port 5433)
- Python environment: .venv (Python 3.10.11)
- Deployed to Koyeb: https://supreme-dorthea-devkrishna-a8d9791a.koyeb.app
