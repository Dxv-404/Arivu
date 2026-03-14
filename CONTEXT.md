# Arivu — Active Context

## Current Phase
Phase 2 — Data Layer, NLP Worker & Graph Build Pipeline

## Phases
### Completed
- [x] Phase 1 — skeleton, schema, smoke tests

### In Progress
- [ ] Phase 2 — Data layer, NLP worker, graph build pipeline

### Not Started
- Phase 3 through Phase 8

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
Phase 1 completed: created 60+ files (5 real backend modules, 20+ stubs, NLP worker skeleton, migration script, tests, templates, static assets). Set up Docker pgvector on port 5433, conda env with Python 3.11. Migration creates 17 tables, 3 smoke tests pass. Logged 5 entries to CRITIQUE_LOG.md (bcrypt version, stub attributions, gallery path, resend version — all resolved or deferred). Created DECISIONS.md with 13 architecture decisions from Phase 1 §27.

## Known Issues / Blockers
- [DEFERRED] llm_client.py, chat_guide.py, prompt_sanitizer.py phase attribution unclear (Phase 3 vs Phase 4) — will resolve when reaching Phase 3

## Environment
- DATABASE_URL: postgresql://arivu:localdev@localhost:5433/arivu?sslmode=disable
- NLP_WORKER_URL: http://localhost:7860 (dev)
- Docker container: arivu-db (pgvector/pgvector:pg16, port 5433)
- Conda environment: arivu (Python 3.11.15)
- Deployed to Koyeb: no
