# Arivu — Active Context

## Current Phase
Phase 2 — Data Layer, NLP Worker & Graph Build Pipeline

## Phases
### Completed
- [x] Phase 1 — skeleton, schema, smoke tests
- [x] Phase 2 — data layer, NLP worker, graph build pipeline

### In Progress
- [ ] Phase 3 — Full-text pipeline, intelligence layer & frontend

### Not Started
- Phase 4 through Phase 8

## Live Deployment (Phase 4+)
| Service | URL |
|---------|-----|
| Backend (Koyeb) | _not deployed yet_ |
| NLP Worker (HF) | _not deployed yet_ |

## Architecture Notes
- DB pool: 1 worker × DB_POOL_MAX=8 = 8 connections (Neon free cap = 10)
- Docker container `arivu-db` (pgvector/pgvector:pg16) on port 5433
- Conda env `arivu` with Python 3.11.15

## Last Session Summary
Phase 2 completed: implemented 10 real backend modules replacing Phase 1 stubs (nlp_worker/app.py, rate_limiter.py, r2_client.py, session_manager.py, normalizer.py, deduplicator.py, api_client.py, nlp_pipeline.py, graph_engine.py) plus app.py route additions (POST /api/search, GET /api/graph/stream SSE, GET /api/graph/<paper_id>). Created tests/test_phase2.py (32 unit tests), scripts/test_pipeline.py (integration test). Updated conftest.py, pytest.ini, .env.example. All 35 tests pass (3 smoke + 32 phase 2). Logged structlog TimeStamper drift fix to CRITIQUE_LOG.md.

## Known Issues / Blockers
- Integration test (scripts/test_pipeline.py) requires NLP worker running on port 7860 — start with `cd nlp_worker && uvicorn app:app --port 7860`
- R2 not configured in local dev — graphs not cached (expected, graceful degradation)

## Environment
- DATABASE_URL: postgresql://arivu:localdev@localhost:5433/arivu?sslmode=disable
- NLP_WORKER_URL: http://localhost:7860 (dev)
- Docker container: arivu-db (pgvector/pgvector:pg16, port 5433)
- Conda environment: arivu (Python 3.11.15)
- Deployed to Koyeb: no
