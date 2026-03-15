# Arivu — Active Context

## Current Phase
Phase 6 — Auth, Billing & GDPR

## Phases
### Completed
- [x] Phase 1 — skeleton, schema, smoke tests
- [x] Phase 2 — data layer, NLP worker, graph build pipeline
- [x] Phase 3 — full-text pipeline, intelligence layer & frontend
- [x] Phase 4 — deployment, production hardening & gallery launch
- [x] Phase 5 — export system, advanced intelligence & custom domain

### In Progress
- [ ] Phase 6 — auth, billing & GDPR

### Not Started
- Phase 7 through Phase 8

## Live Deployment (Phase 4+)
| Service | URL |
|---------|-----|
| Backend (Koyeb) | https://supreme-dorthea-devkrishna-a8d9791a.koyeb.app |
| NLP Worker (HF) | https://dxv-404-arivu-nlp.hf.space |
| Database (Neon) | ep-young-haze-a1qrxgk6-pooler.ap-southeast-1.aws.neon.tech |
| Custom Domain | pending DNS setup (arivu.app) |

## Architecture Notes
- DB pool: 2 workers × DB_POOL_MAX=4 = 8 connections (Neon free cap = 10)
- Docker container `arivu-db` (pgvector/pgvector:pg16) on port 5433 (local dev)
- Python venv `.venv` with Python 3.10.11 (conda envs corrupted by Windows Defender)
- Config pattern changed: class-attribute Config with `config = Config` alias (Phase 4 §5)
- Neon URL requires stripping `channel_binding=require` (psycopg2 incompatible)
- R2 bucket: `arivu-graphs` (not `arivu-data` from spec)
- Koyeb free tier scales to zero after 65 min idle — upgrade to eNano ($1.61/mo) for always-on production use

## Last Session Summary
Phase 5 implementation complete. All 18 §0 backports verified. Full feature implementation:
- ExportGenerator with 8 export formats (graph-json, graph-csv/ZIP, bibtex, literature-review,
  genealogy-pdf/WeasyPrint, action-log, graph-png/matplotlib, graph-svg)
- LivingPaperScorer: citation velocity and trajectory analysis (rising/stable/declining/extinct)
- OriginalityMapper: Pioneer/Synthesizer/Bridge/Refiner/Contradictor classification
- ParadigmShiftDetector: 4-signal structural analysis (contradiction surge, cross-domain influx,
  vocabulary fragmentation, cluster fragmentation)
- generate_literature_review() added to ArivuLLMClient
- 4 new API routes: POST /api/export/<type>, GET /api/living-score/<id>,
  GET /api/originality/<id>, GET /api/paradigm/<seed_id>
- ExportPanel frontend (export-panel.js, tool.html wiring, CSS)
- load_retraction_watch.py real implementation (targets retraction_watch table)
- ground_truth_eval.py real implementation + data/ground_truth/pairs.json (5 seed pairs)
- generate_og_image.py for branded 1200×630 OG image
- 135 tests passing (40 new Phase 5 tests, 0 failures)

Key backport fixes applied: GALLERY_INDEX_PATH corrected (§0.3), R2Client.presigned_url()
added (§0.4), quality_monitor confidence field fixed to base_confidence (§0.5),
ground_truth_eval.py phase reference fixed (§0.13), data/ground_truth/ directory created (§0.14).

## Known Issues / Blockers
- Gallery previews not yet generated — run precompute_gallery.py once S2 key arrives
- Koyeb free tier will scale to zero after 65 min idle
- S2_API_KEY pending approval from Semantic Scholar
- Custom domain (arivu.app) DNS not yet configured
- ground_truth_eval.py needs ≥20 pairs before running eval (currently has 5 seed pairs)
- WeasyPrint requires libcairo2 on the system — verify Dockerfile includes it

## Environment
- DATABASE_URL: postgresql://arivu:localdev@localhost:5433/arivu?sslmode=disable (local)
- NEON_DATABASE_URL: postgresql://neondb_owner:***@ep-young-haze-a1qrxgk6-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
- NLP_WORKER_URL: http://localhost:7860 (dev) / https://dxv-404-arivu-nlp.hf.space (prod)
- Docker container: arivu-db (pgvector/pgvector:pg16, port 5433)
- Python environment: .venv (Python 3.10.11)
- Deployed to Koyeb: https://supreme-dorthea-devkrishna-a8d9791a.koyeb.app
