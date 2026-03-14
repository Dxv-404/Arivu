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

### Not Started
- Phase 5 through Phase 8

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
Phase 3 completed across multiple sessions. All Phase 3 deliverables implemented:

**Backend modules (§1-§11):** full_text_fetcher, section_parser, dna_profiler (consensus clustering),
diversity_scorer (4-component radar), orphan_detector (citation trajectory), gap_finder (pgvector),
pruning (cascading BFS), llm_client (Groq + DB cache), chat_guide (context-aware AI),
prompt_sanitizer (injection prevention).

**Graph engine upgrade (§12):** Integrated pruning, DNA, diversity, and orphan detection into
AncestryGraph. Added `compute_pruning()` and enriched `export_to_json()` with precomputed_pruning.

**App routes (§13):** All Phase 3 API endpoints — prune, flag-edge, chat, genealogy, DNA,
diversity, orphans, gaps. SSE streaming, session management, gallery loading.

**Templates (§14):** base.html (CSP headers, fonts), index.html (landing + demo),
tool.html (3-panel layout), explore.html (gallery cards). CONFLICT-001 resolved: use style.css.
CONFLICT-002 resolved: use landing-demo.js.

**CSS (§15):** Full dark theme — style.css (variables + base), graph.css (D3 + tooltips),
panels.css (right panel + bottom bar), loading.css (skeleton + progress).

**JS files (§16-§22):** graph.js (ArivuGraph D3 class + TooltipSystem), pruning.js (PruningSystem
cascade animation), panels.js (RightPanel + DNAChart + orphan cards + sparklines),
loader.js (GraphLoader SSE client), landing-demo.js (scripted demo state machine),
api.js (PaperSearch with debounce), accessibility.js (keyboard shortcuts).
Thin shims: tooltip.js, leaderboard.js, orphans.js, chat.js. Stub: insight-feed.js (Phase 7).

**Scripts (§25-§26):** precompute_gallery.py (adapted to actual R2Client/db APIs),
benchmark_nlp.py (encode + similarity matrix benchmarks).

**Tests (§23):** test_phase3.py — 36 tests across 8 test classes. All passing.
Fixed section_parser regex patterns (plural headings: Methods, Results, Conclusions).

**Schema (§24):** ALTER TABLE graphs ADD leaderboard_json, dna_json, diversity_json, computed_at.

**Full test suite: 71 passed, 0 failed** (3 smoke + 32 phase2 + 36 phase3).

## Known Issues / Blockers
- Integration test requires NLP worker running on port 7860 — start with `cd nlp_worker && uvicorn app:app --port 7860`
- R2 not configured in local dev — graphs not cached (expected, graceful degradation)
- Conda envs `arivu` and `arivu2` corrupted by Windows Defender blocking python.exe — use `.venv` instead
- No S2 API key configured — rate limited to 1 req/s (sufficient for dev, may slow integration test)
- Pruning algorithm: removing a node in a DAG makes orphaned children new roots, so collapse_count is 0 for simple DAGs. Cascading collapses only occur in graphs with redundant parent paths. This matches the implemented BFS-from-roots algorithm.

## Environment
- DATABASE_URL: postgresql://arivu:localdev@localhost:5433/arivu?sslmode=disable
- NLP_WORKER_URL: http://localhost:7860 (dev)
- Docker container: arivu-db (pgvector/pgvector:pg16, port 5433)
- Python environment: .venv (Python 3.10.11, created from C:\Users\xplod\AppData\Local\Programs\Python\Python310\python.exe)
- Deployed to Koyeb: no
