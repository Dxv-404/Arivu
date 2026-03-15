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
Billing removal implementation complete (ADR-016). All features now free for authenticated users. Changes across 14 files: auth.py (new users register as tier='researcher'), decorators.py (usage-reset removed, require_tier/check_graph_limit marked DORMANT), app.py (8 @require_tier removed, 3 billing routes removed, free-tier counter removed, /pricing route removed, /api/usage updated), exceptions.py (GraphLimitReachedError marked DORMANT), rate_limiter.py (billing rate limit removed), config.py (Stripe warning removed), pricing.html (DELETED), account.html (simplified — no tier badge/usage/billing), base.html (no pricing nav/tier badge/upgrade nudge), account.js (billing portal handler removed), auth.css (dead billing CSS removed), nightly_maintenance.py (usage-reset/tier-downgrade removed), test_phase6.py (TestBillingWebhook deleted, tier tests simplified), mailer.py (welcome email updated). Tests: 168 passed, 0 failed. billing.py stays DORMANT (never imported by app.py). DB columns untouched. CONFLICT-009 and CONFLICT-007 now moot. Phase 7 §0.1/§2.3/§2.4 will be SKIPPED. Phase 8 §0.7 will be SKIPPED.

### Previous Session Summary (Phase 6)
Phase 6 implementation complete. Full auth, billing, GDPR, and intelligence module stack:

**Core Auth Stack:**
- backend/auth.py: Flask Blueprint with register, login, verify-email, forgot/reset-password, logout, resend-verification
- backend/billing.py: Stripe Checkout, portal, webhooks (subscription created/updated/deleted, payment failed)
- backend/gdpr.py: GDPR data export ZIP + account deletion (right to erasure)
- backend/decorators.py: @require_auth, @require_tier(), @check_graph_limit with ENABLE_AUTH passthrough
- backend/captcha.py: hCaptcha verification with dev bypass
- backend/mailer.py: 6 transactional emails via Resend (verification, password reset, welcome, payment failed, deletion confirmation, data export ready)

**Intelligence Modules (4 new):**
- backend/independent_discovery.py: IndependentDiscoveryTracker — detects parallel discoveries via embedding similarity
- backend/citation_shadow.py: CitationShadowDetector — finds foundational-but-underrecognized papers (fixed: nx.ancestors not nx.descendants, MIN_DIRECT_CITATIONS=1)
- backend/field_fingerprint.py: FieldFingerprintAnalyzer — 5-dimension field profile for radar chart
- backend/serendipity_engine.py: SerendipityEngine — cross-domain structural analog finder via pgvector

**Infrastructure:**
- scripts/migrate_phase6.py: 7 new tables (email_verification_tokens, password_reset_tokens, lab_memberships, api_keys, graph_memory, consent_log, background_jobs columns added to users)
- scripts/nightly_maintenance.py: expired session cleanup, GDPR processing, free-tier reset, tier downgrade
- backend/rate_limiter.py: 11 new endpoint rate limits for Phase 6 routes
- backend/decorators.py: g.user_id set to zero UUID when ENABLE_AUTH=false (prevents AttributeError in routes)

**Frontend:**
- 8 auth/account templates (login, register, verify_email, forgot_password, reset_password, pricing, account, privacy)
- static/css/auth.css: complete styles for nav, buttons, auth, pricing, account, legal, cookie banner
- static/js/account.js: profile save, password change, billing portal, API key CRUD, GDPR export/delete
- templates/base.html: auth-aware nav, tier badge, upgrade nudge, cookie consent, CSP for hCaptcha

**Stream Route Modifications (§12.2):**
- Free-tier graph counter increment on cache miss (before build thread)
- User linkage to graphs after successful build

**Tests:** 170 total (35 new Phase 6 tests, 0 failures)

**Spec Bug Fixes:**
- independent_discovery.py: spec used non-existent LLMClient/call_llm() → adapted to get_llm_client()/generate_chat_response()
- citation_shadow.py: nx.descendants→nx.ancestors (wrong direction in directed citation graph), MIN_DIRECT_CITATIONS 2→1
- gdpr.py: edge_flags→edge_feedback (canonical table name per CLAUDE.md Part 6.8)
- Rate limiter: spec 3-tuples adapted to existing 2-tuple format

## Known Issues / Blockers
- Gallery previews not yet generated — run precompute_gallery.py once S2 key arrives
- Koyeb free tier will scale to zero after 65 min idle
- S2_API_KEY pending approval from Semantic Scholar
- Custom domain (arivu.app) DNS not yet configured
- ground_truth_eval.py needs ≥20 pairs before running eval (currently has 5 seed pairs)
- WeasyPrint requires libcairo2 on the system — verify Dockerfile includes it
- Phase 6 migration not yet run against Neon (run scripts/migrate_phase6.py before deploying)
- One-time Neon SQL needed: `UPDATE users SET tier = 'researcher' WHERE tier = 'free';` (existing users)
- ENABLE_AUTH should be set to true in Koyeb only after end-to-end testing

## Environment
- DATABASE_URL: postgresql://arivu:localdev@localhost:5433/arivu?sslmode=disable (local)
- NEON_DATABASE_URL: postgresql://neondb_owner:***@ep-young-haze-a1qrxgk6-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
- NLP_WORKER_URL: http://localhost:7860 (dev) / https://dxv-404-arivu-nlp.hf.space (prod)
- Docker container: arivu-db (pgvector/pgvector:pg16, port 5433)
- Python environment: .venv (Python 3.10.11)
- Deployed to Koyeb: https://supreme-dorthea-devkrishna-a8d9791a.koyeb.app
