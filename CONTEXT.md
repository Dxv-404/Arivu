# Arivu — Active Context

## Current Phase
Phase 3 — Full-Text Pipeline, Intelligence Layer & Frontend

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
- Python venv `.venv` with Python 3.10.11 (conda envs corrupted by Windows Defender)

## Last Session Summary
Phase 2 verification completed. All 6 §17 "Done When" criteria confirmed simultaneously:
1. pytest 35/35 pass (3 smoke + 32 phase 2)
2. scripts/test_pipeline.py 12/12 pass — "All tests passed! Phase 2 complete."
3. NLP worker health confirmed (all-MiniLM-L6-v2, 384 dims)
4. Git commits on main, pushed to origin
5. CONTEXT.md updated (this update)
6. GET /api/graph/<paper_id> returns 404 for non-existent graph

Five bugs fixed during integration testing: computed_at Phase 3 column referenced in Phase 2 code (app.py + graph_engine.py), S2 fieldsOfStudy string-vs-object parsing (api_client.py), S2 rate limiter too aggressive without API key (rate_limiter.py), missing retry logic for S2 429 responses (api_client.py), null guards in get_references (api_client.py). All logged to CRITIQUE_LOG.md.

## Known Issues / Blockers
- Integration test requires NLP worker running on port 7860 — start with `cd nlp_worker && uvicorn app:app --port 7860`
- R2 not configured in local dev — graphs not cached (expected, graceful degradation)
- Conda envs `arivu` and `arivu2` corrupted by Windows Defender blocking python.exe — use `.venv` instead
- No S2 API key configured — rate limited to 1 req/s (sufficient for dev, may slow integration test)

## Environment
- DATABASE_URL: postgresql://arivu:localdev@localhost:5433/arivu?sslmode=disable
- NLP_WORKER_URL: http://localhost:7860 (dev)
- Docker container: arivu-db (pgvector/pgvector:pg16, port 5433)
- Python environment: .venv (Python 3.10.11, created from C:\Users\xplod\AppData\Local\Programs\Python\Python310\python.exe)
- Deployed to Koyeb: no
