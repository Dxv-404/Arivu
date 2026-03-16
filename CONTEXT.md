# Arivu — Active Context

## Current Phase
Phase 7 — Temporal Intelligence, Workflow Tools & Public API

## Phases
### Completed
- [x] Phase 1 — skeleton, schema, smoke tests
- [x] Phase 2 — data layer, NLP worker, graph build pipeline
- [x] Phase 3 — full-text pipeline, intelligence layer & frontend
- [x] Phase 4 — deployment, production hardening & gallery launch
- [x] Phase 5 — export system, advanced intelligence & custom domain
- [x] Phase 6 — auth, billing & GDPR

### In Progress
- [ ] Phase 7 — temporal intelligence, workflow tools & public API

### Not Started
- Phase 8

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
- ENABLE_AUTH=false by default — @require_auth passes through; @require_tier and @check_graph_limit are DORMANT (never applied to routes)
- TIER_ORDER dict exists in decorators.py (dormant) — all features free for authenticated users (ADR-016)
- New users register with tier='researcher'; billing.py kept dormant for portfolio reference

## Last Session Summary
Phase 7 implementation complete. Full temporal intelligence, workflow tools, public API, and lab collaboration stack.

**Backend Modules (17 new):**
- backend/time_machine.py: TimeMachineEngine — temporal graph slicing with DB caching (time_machine_cache)
- backend/vocabulary_tracker.py: VocabularyEvolutionTracker — TF-IDF heatmap with vocabulary_snapshots caching
- backend/extinction_detector.py: ExtinctionEventDetector — detects research line endings
- backend/counterfactual_engine.py: CounterfactualEngine — "what if paper X never existed?" with LLM narrative
- backend/adversarial_reviewer.py: AdversarialReviewer — PDF/abstract review with landscape pgvector search
- backend/citation_audit.py: CitationAudit — overcitation, undercitation, self-citation analysis
- backend/citation_generator.py: CitationGenerator — 6 formats (APA, MLA, Chicago, BibTeX, IEEE, Harvard)
- backend/reading_prioritizer.py: ReadingPrioritizer — PageRank-based reading list from graph
- backend/paper_positioning.py: PaperPositioningTool — intellectual landscape positioning via LLM
- backend/rewrite_suggester.py: RewriteSuggester — related work section rewrite suggestions
- backend/persona_engine.py: PersonaEngine — 4 personas (explorer, critic, innovator, historian)
- backend/insight_engine.py: InsightEngine — persona-aware insight feed from graph analysis
- backend/secure_upload.py: SecureFileUploadHandler — PDF validation + SHA-256 hashing
- backend/public_api.py: Flask Blueprint /v1/ — public REST API with API key auth
- backend/webhook_manager.py: WebhookManager — HMAC-signed webhook delivery with retry
- backend/lab_manager.py: LabManager — lab invite/accept/remove + shareable graph links

**Routes (~30 new in app.py):**
- Time Machine, counterfactual, adversarial review, citation audit/generator
- Reading prioritizer, paper positioning, rewrite suggester
- Persona (GET/POST), insights, action-log export, guided discovery
- Share CRUD, lab management (members, invite, accept, remove), supervisor dashboard
- Email change (request + confirm), API docs page
- All routes use @require_auth only (NO @require_tier per ADR-016)

**Frontend (9 JS + 3 HTML):**
- static/js/: time-machine.js, view-switcher.js, constellation.js, geological.js, river-view.js, workflow.js, citation-gen.js, persona.js, insight-feed.js
- templates/: shared_graph.html, supervisor.html, api_docs.html

**Infrastructure:**
- scripts/migrate_phase7.py: 9 new tables (shared_graphs, vocabulary_snapshots, time_machine_cache, counterfactual_cache, adversarial_reviews, lab_invites, webhook_subscriptions, webhook_deliveries, email_change_tokens)
- scripts/weekly_digest.py: Lab activity weekly digest
- backend/rate_limiter.py: 13 internal + 9 public API rate limits added
- backend/mailer.py: 2 new email templates (lab invite, email change verification)

**Route-to-Module Interface Fixes:**
- CitationAudit.audit(): args are (paper_id, graph_json), not (graph_json, paper_id) — route fixed
- CitationGenerator.generate(): takes (paper_ids, styles, all_styles) and does own DB lookup — route simplified
- ReadingPrioritizer.prioritize(): takes (graph_json, max_items) using NetworkX — route updated to pass graph
- CounterfactualEngine.analyze(): returns dict (from .to_dict()), not dataclass — tests fixed
- AdversarialReviewer: httpx imported inside method, mock at method level — tests fixed

**Tests:** 219 total (51 new Phase 7 tests, 0 failures across all phases)

## Known Issues / Blockers
- Gallery previews not yet generated — run precompute_gallery.py once S2 key arrives
- Koyeb free tier will scale to zero after 65 min idle
- S2_API_KEY pending approval from Semantic Scholar
- Custom domain (arivu.app) DNS not yet configured
- ground_truth_eval.py needs ≥20 pairs before running eval (currently has 5 seed pairs)
- WeasyPrint requires libcairo2 on the system — verify Dockerfile includes it
- ENABLE_AUTH should be set to true in Koyeb only after end-to-end testing

## Environment
- DATABASE_URL: postgresql://arivu:localdev@localhost:5433/arivu?sslmode=disable (local)
- NEON_DATABASE_URL: postgresql://neondb_owner:***@ep-young-haze-a1qrxgk6-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
- NLP_WORKER_URL: http://localhost:7860 (dev) / https://dxv-404-arivu-nlp.hf.space (prod)
- Docker container: arivu-db (pgvector/pgvector:pg16, port 5433)
- Python environment: .venv (Python 3.10.11)
- Deployed to Koyeb: https://supreme-dorthea-devkrishna-a8d9791a.koyeb.app
