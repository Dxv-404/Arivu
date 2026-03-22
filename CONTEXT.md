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
- 4 persona framings wired into ChatGuide (explorer, critic, innovator, historian)

## v1.0 Release Notes
- Tagged: v1.0
- Feature count: ~62 features built across phases 1–8
- Deferred to post-v1: F2.4 Prediction Market, F3.2 Collaboration
  Finder, F3.3 Mental Model Mapper, F3.4 Lab Genealogy, F8.2
  Collaborative Annotation, F8.4 Collaboration Finder Community,
  F11.8 Policy Brief Generator, F11.10 Conference Intelligence Layer
- Gallery: 7 precomputed papers (requires S2_API_KEY — pending approval)
- Live Mode: polling-based (WebSocket is Phase 9+)
- Researcher Profiles: single-graph version only. Name-hash surrogate
  IDs stored — /researcher/<author_id> returns not_found for real S2
  author IDs until proper ID resolution is built (post-v1)
- Scheduled crons: nightly_maintenance 0 2 * * *, live_monitor
  0 3 * * *, load_retraction_watch 0 4 * * 0, weekly_digest 0 8 * * 1
- Known v1 limitation: live mode checks only first 10 nodes per
  subscription (S2 API rate limit)
- ADR-016: All features free for authenticated users; billing.py dormant

## Post-v1 Roadmap
- F2.4  Prediction Market (community scale needed)
- F3.2  Collaboration Finder (researcher profile index needed)
- F3.3  Mental Model Mapper (multi-author aggregation)
- F3.4  Lab Genealogy System (Math Genealogy Project API)
- F8.2  Collaborative Annotation (moderation system)
- F8.4  Collaboration Finder Community
- F11.8 Science Policy Brief Generator
- F11.10 Conference Intelligence Layer
- Phase 9: WebSocket live mode, async job queue, full-graph live monitoring, mobile app, real S2 author ID resolution for profiles

## Last Session Summary
Post-v1.0 production hardening session (2026-03-17):

**Bug Fixes (6 total):**
1. Pruning reset: `_pillMutated` flag prevents unnecessary DOM destruction on reset
2. DNA donut: fixed innerHTML override breaking Chart.js canvas
3. Node URLs: `window.open()` corrected for external paper links
4. Coverage stat: `Number.isFinite()` guard for NaN/Infinity pruning_impact
5. Impact table: `Number.isFinite()` guard for pruning_impact display
6. **CRITICAL — pruning_impact always 0:** R2 cache was written BEFORE `compute_all_pruning_impacts()` in graph_engine.py. Moved R2 write to AFTER pruning computation. Added leaderboard-based enrichment for old cached graphs in app.py.

**Build Time Optimization:**
- `NLP_SIMILARITY_THRESHOLD` raised from 0.25 → 0.35 (edges 0.25–0.35 auto-classified as incidental — saves ~30% Groq calls)
- `NLP_BATCH_SIZE` raised from 5 → 10 (cuts Groq call count by ~2×)
- Dynamic `max_tokens = min(200 + len(batch) * 100, 2000)` prevents JSON truncation on larger batches
- ADR-021 added documenting spec deviation

**Verification (Stochastic Parrots graph — 601 nodes):**
- 20 non-zero pruning impacts confirmed via SSE stream
- 5 bottleneck nodes with gold/orange strokes visible in browser
- Seed paper shows `600▸` impact badge
- 73% abstract coverage, leaderboard populated
- Health check: database OK, NLP worker OK, R2 storage OK

**Commits:**
- `4717979` — [fix] Fix pruning_impact always 0 in cached graphs
- `b73899b` — [perf] Optimize build time: NLP_BATCH_SIZE 5→15, NLP_SIMILARITY_THRESHOLD 0.25→0.35
- `e1256eb` — [fix] Address pessimistic debugger findings on build time optimization
- `cde4381` — [fix] Active oversight fixes: remove [:50] slice in all_zero check, add ADR-021

## Post-v1.0 Audit Summary
Post-implementation audit identified and fixed 7 issues:
- FIX 1: chat_guide.py persona names corrected (strategist/builder/skeptic → critic/innovator/historian)
- FIX 2: researcher_profiles.py hashlib import moved to module level (was inside for-loop)
- FIX 3: scripts/live_monitor_cron.py created (missing from Phase 8 implementation)
- FIX 4: public_api.py extended with 3 Phase 8 endpoints (researchers, literature-review, journalism)
- FIX 5: CONTEXT.md updated with v1.0 Release Notes, Post-v1 Roadmap, corrected persona names
- FIX 6: CRITIQUE_LOG.md extended with Phase 8 entries
- 13 of 20 audit checks passed on first run; all 7 failures resolved

## Known Issues / Blockers
- Gallery previews not yet generated — run precompute_gallery.py once S2 key arrives
- Koyeb free tier scales to zero after 65 min idle
- S2_API_KEY pending approval from Semantic Scholar
- Custom domain (arivu.app) DNS not yet configured
- ground_truth_eval.py needs built graph in DB before running eval
- ENABLE_AUTH should be set to true in Koyeb only after end-to-end testing
- researcher_profiles: name-hash surrogate IDs mean /researcher/<id>
  returns not_found for any real S2 author ID until proper S2 author
  ID resolution is implemented (post-v1.0 work)
## Environment
- DATABASE_URL: postgresql://arivu:localdev@localhost:5433/arivu?sslmode=disable (local)
- NEON_DATABASE_URL: postgresql://neondb_owner:***@ep-young-haze-a1qrxgk6-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
- NLP_WORKER_URL: http://localhost:7860 (dev) / https://dxv-404-arivu-nlp.hf.space (prod)
- Docker container: arivu-db (pgvector/pgvector:pg16, port 5433)
- Python environment: .venv (Python 3.10.11)
- Deployed to Koyeb: https://supreme-dorthea-devkrishna-a8d9791a.koyeb.app
