# Arivu — Active Context

## Current Phase
Phase 8 — Final Intelligence Layer, Trust Features, Live Mode & v1.0 (COMPLETE)

## Phases
### Completed
- [x] Phase 1 — skeleton, schema, smoke tests
- [x] Phase 2 — data layer, NLP worker, graph build pipeline
- [x] Phase 3 — full-text pipeline, intelligence layer & frontend
- [x] Phase 4 — deployment, production hardening & gallery launch
- [x] Phase 5 — export system, advanced intelligence & custom domain
- [x] Phase 6 — auth, billing & GDPR
- [x] Phase 7 — temporal intelligence, workflow tools & public API
- [x] Phase 8 — final intelligence layer, trust features, live mode & v1.0

### Not Started
(All phases complete)

## Live Deployment (Phase 4+)
| Service | URL |
|---------|-----|
| Backend (Koyeb) | https://supreme-dorthea-devkrishna-a8d9791a.koyeb.app |
| NLP Worker (HF) | https://dxv-404-arivu-nlp.hf.space |
| Database (Neon) | ep-young-haze-a1qrxgk6-pooler.ap-southeast-1.aws.neon.tech |
| Custom Domain | pending DNS setup (arivu.app) |
| Public API | /v1/ blueprint — API key auth via `api_keys` table |
| /v1/ API Base | https://arivu.app/v1/ |

## Architecture Notes
- DB pool: 2 workers x DB_POOL_MAX=4 = 8 connections (Neon free cap = 10)
- Docker container `arivu-db` (pgvector/pgvector:pg16) on port 5433 (local dev)
- Python venv `.venv` with Python 3.10.11
- Config pattern: class-attribute Config with `config = Config` alias (Phase 4 §5)
- Neon URL requires stripping `channel_binding=require` (psycopg2 incompatible)
- R2 bucket: `arivu-graphs` (not `arivu-data` from spec)
- ENABLE_AUTH=false by default — @require_auth passes through; @require_tier and @check_graph_limit are DORMANT (ADR-016)
- graph_id is SHA256(seed_paper_id + "_" + session_id)[:32] — stable across rebuilds (ADR-017)
- Phase 8 migration adds 7 tables: researcher_profiles, graph_memory_state, live_subscriptions, live_alerts, confidence_overrides, cross_domain_spark_cache, literature_review_jobs
- All 14 Phase 8 intelligence modules implemented (reconstructed — no v1 code existed)
- CitationIntentClassifier: 3-tier strategy (linguistic markers -> mutation_type mapping -> LLM)
- 4 persona framings wired into ChatGuide (explorer, strategist, builder, skeptic)

## Last Session Summary
Phase 8 implementation completed in full:

**§0-§3:** Backports and 14 intelligence modules created:
- cross_domain_spark, error_propagation, reading_between_lines, intellectual_debt
- challenge_generator, idea_credit, researcher_profiles, literature_review_engine
- field_entry_kit, research_risk_analyzer, science_journalism, live_mode
- interdisciplinary_translation, graph_memory
- CitationIntentClassifier added to nlp_pipeline.py

**§5:** 28 Phase 8 routes added to app.py, flag-edge route upgraded with auto-downgrade

**§6:** 19 rate limiter entries added

**§7-§10:** 6 JS files, ~100 CSS lines, 2 templates (researcher.html, journalism.html)

**§11:** 3 scripts replaced (precompute_gallery.py, ground_truth_eval.py, benchmark_nlp.py)

**§12:** Persona framing (`_get_persona_framing()`) wired into chat_guide.py

**§13:** README.md replaced with v1.0 content

**§14:** tests/test_phase8.py — 34 tests, 16 test classes, all passing

**§15:** Self-directed audit — no banned patterns found (no @require_tier usage, no 'retractions' table refs, no LLMClient() direct instantiation in Phase 8 modules, no pymupdf/sqlite3 imports)

**§16:** Phase 8 migration run against Neon — 7 tables verified

**§17:** Security audit passed — parameterized SQL, CSP header present, no f-string SQL injection

**Tests:** 253 total (34 Phase 8), 0 failures across all phases

## Known Issues / Blockers
- Gallery previews not yet generated — run precompute_gallery.py once S2 key arrives
- Koyeb free tier scales to zero after 65 min idle
- S2_API_KEY pending approval from Semantic Scholar
- Custom domain (arivu.app) DNS not yet configured
- ground_truth_eval.py needs built graph in DB before running eval
- ENABLE_AUTH should be set to true in Koyeb only after end-to-end testing

## Environment
- DATABASE_URL: postgresql://arivu:localdev@localhost:5433/arivu?sslmode=disable (local)
- NEON_DATABASE_URL: postgresql://neondb_owner:***@ep-young-haze-a1qrxgk6-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
- NLP_WORKER_URL: http://localhost:7860 (dev) / https://dxv-404-arivu-nlp.hf.space (prod)
- Docker container: arivu-db (pgvector/pgvector:pg16, port 5433)
- Python environment: .venv (Python 3.10.11)
- Deployed to Koyeb: https://supreme-dorthea-devkrishna-a8d9791a.koyeb.app
