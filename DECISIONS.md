# Arivu - Architecture Decisions Log

Consult this before making any architectural decision not covered in CLAUDE.md.
If you are about to decide something not recorded here, add it first.

## Settled Decisions

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Deployment | Koyeb + HuggingFace Spaces + Neon + Cloudflare R2 | See CLAUDE.md §4 |
| 2 | Database | PostgreSQL on Neon.tech - NOT SQLite | Does not pause on free tier; pgvector support |
| 3 | NLP model location | HuggingFace Spaces only - NEVER in Flask app | ~200MB exceeds Koyeb 512MB RAM |
| 4 | Service boundary | Flask owns routes + DB; FastAPI owns NLP model | Clean separation, independent scaling |
| 5 | Graph format | NetworkX DiGraph + export JSON to R2 | Sufficient for n<=600 nodes; no graph DB needed |
| 6 | Frontend | Vanilla JS + D3.js v7 + Chart.js | No build step; CDN-served |
| 7 | LLM | Groq (llama-3.1-8b-instant + llama-3.3-70b-versatile) | Fast inference; free tier |
| 8 | Object storage | Cloudflare R2 | 10GB free; S3-compatible; no egress fees |
| 9 | Sessions | Anonymous sessions (cookie) + optional user account | No login required for core features |
| 10 | Cache TTL | last_accessed NOT created_at on graphs table | A graph used daily stays fresh; idle ones expire |
| 11 | Workers | --workers 2 + DB_POOL_MAX=4 in Phase 4 | 2 workers × 4 = 8 connections ≤ Neon cap 10. Changed atomically in Phase 4 §1.1 |
| 12 | edge_analysis FKs | citing_paper_id + cited_paper_id reference papers(paper_id) | Integrity; orphaned edges not allowed |
| 13 | session_graphs | Separate join table; no FK on graphs.session_id | Anonymous users (no DB row) can view graphs without FK violation |

| 14 | Config pattern | Class-attribute Config (not instance singleton) | Phase 4 §5 — class attributes evaluated at import time; `config = Config` alias for backward compat |
| 15 | NLP worker auth | Dual header: X-API-Key (canonical) + Bearer (legacy) | Phase 4 §0.9 — both WORKER_SECRET and NLP_WORKER_SECRET env vars read |
| 16 | R2 bucket name | arivu-graphs (NOT arivu-data from spec) | User's actual bucket name differs from spec default; spec says arivu-data but user created arivu-graphs |
| 17 | Neon channel_binding | Strip channel_binding=require from URL | psycopg2 doesn't support channel_binding; Neon URL must only have sslmode=require |
| 18 | NLP worker Dockerfile | Flat COPY paths (no nlp_worker/ prefix) | HF Spaces builds from flat repo root; Dockerfile must COPY from . not nlp_worker/ |
| 19 | gallery_index.json path | data/gallery_index.json (root of data/) | Moved from data/precomputed/ in Phase 4 per CLAUDE.md Part 6.4 |

| 20 | Dockerfile Debian Trixie | libgdk-pixbuf-xlib-2.0-0 (NOT libgdk-pixbuf2.0-0) | Package renamed in Debian Trixie; old name causes Koyeb build failure |
| 21 | Billing model | All features free; billing.py dormant | ADR-016 — all features accessible to authenticated users; Stripe code retained for portfolio |

## ADR-014: Production database
**Date:** 2026-03-15
**Context:** Needed a hosted PostgreSQL with pgvector support, free tier, no sleep on inactivity.
**Decision:** Neon.tech PostgreSQL 16, AWS ap-southeast-1 Singapore.
**Alternatives considered:** Supabase (more complex free tier), Railway (limited free hours).
**Rationale:** Closest AWS region to India on Neon free tier. 10 connection cap fits 2-worker Koyeb setup (2×4+2=10).
**Implications:** `channel_binding=require` must be stripped from connection string. Locks to 10 connections max on free tier.

## ADR-015: NLP worker hosting
**Date:** 2026-03-15
**Context:** sentence-transformers model is ~200MB — exceeds Koyeb free tier 512MB RAM.
**Decision:** HuggingFace Spaces CPU Basic free tier.
**Alternatives considered:** Koyeb paid tier, Railway.
**Rationale:** Free, always-on CPU with 16GB RAM. Model stays warm after first load. No cost.
**Implications:** 10-15 min cold start on first push. NLP_WORKER_TIMEOUT must be 90s minimum.

## Open Questions

### OQ-001: Billing/Tier Removal — All Features Free (2026-03-16)

**Context:** User has decided all Arivu features should be free for all authenticated users. No Stripe billing, no tier-gated features, no graph limits. This overrides CLAUDE.md Part 6.9 (TIER_ORDER as "inviolable") and skips Phase 7 §0.1/§2.3–2.4 and Phase 8 §0.7.

**Three strategies evaluated:**

| Strategy | Code Changes | Risk | Reversibility |
|----------|-------------|------|---------------|
| Full Deletion | Remove billing.py, all decorators, Stripe config, DB columns | LOW code risk, MEDIUM migration risk | Must rebuild from scratch |
| Dormant (Config-Gated) | Change nothing; never configure Stripe | NONE | Fully reversible |
| **Hybrid (Recommended)** | Delete billing.py, remove @require_tier, remove billing UI; **keep DB columns** | LOW | DB-level reversible |

**Score table (Complexity / Risk / Test / Spec Divergence / Effort — each 1-5):**

| Item | C | R | T | S | E | Total |
|------|---|---|---|---|---|-------|
| billing.py (delete) | 1 | 1 | 2 | 4 | 1 | 9 |
| require_tier() decorator | 2 | 1 | 1 | 4 | 1 | 9 |
| check_graph_limit() | 1 | 1 | 1 | 3 | 1 | 7 |
| config.py Stripe vars | 2 | 1 | 1 | 3 | 1 | 8 |
| mailer.py payment email | 1 | 1 | 1 | 2 | 1 | 6 |
| stream route counter | 1 | 1 | 1 | 2 | 1 | 6 |
| 3 billing routes | 1 | 1 | 1 | 3 | 1 | 7 |
| 8 @require_tier decorators | 1 | 1 | 1 | 3 | 1 | 7 |
| pricing.html | 1 | 1 | 1 | 3 | 1 | 7 |
| account.html billing | 2 | 1 | 1 | 2 | 1 | 7 |
| base.html tier UI | 2 | 1 | 1 | 2 | 1 | 7 |
| nightly_maintenance.py | 2 | 3 | 1 | 2 | 2 | 10 |
| test_phase6.py (4 tests) | 1 | 1 | 3 | 1 | 1 | 7 |
| Phase 7 tier sections | 1 | 1 | 1 | 4 | 1 | 8 |
| Phase 8 tier sections | 1 | 1 | 1 | 3 | 1 | 7 |
| **Average** | | | | | | **7.1** |

**Recommendation:** Hybrid strategy. Delete billing.py + remove @require_tier decorators + remove billing UI. Keep DB columns untouched. Estimated effort: ~2 hours.

**Side effects:**
- CONFLICT-009 (Phase 7 vs Phase 8 TIER_ORDER) → automatically resolved (moot)
- CONFLICT-007 (Stripe version mismatch) → partially resolved (Stripe not needed)
- 22 routes across Phases 7–8 use @require_auth only (no tier gate)
- pricing.html deleted; account.html simplified; base.html cleaned

**Status:** RESOLVED (2026-03-16). User chose modified hybrid: billing.py kept DORMANT (not deleted), @require_tier removed from all routes, billing UI removed, DB columns untouched, new users register as tier='researcher'. Implemented in ADR-016.

## ADR-016: All Features Free — Billing Removal Implementation
**Date:** 2026-03-16
**Context:** User decided all Arivu features should be free for authenticated users. No paid tiers, no graph limits, no Stripe billing.
**Decision:** Modified hybrid strategy — remove all billing touchpoints from active code while keeping billing.py dormant for portfolio reference.
**Changes applied:**
1. auth.py: New users register with tier='researcher' (not 'free')
2. decorators.py: Usage-reset block removed from get_current_user(); require_tier() and check_graph_limit() marked DORMANT
3. app.py: All 8 @require_tier decorators removed; 3 billing routes removed; free-tier counter removed; /pricing route removed; /api/usage updated (limit=None)
4. exceptions.py: GraphLimitReachedError marked DORMANT
5. rate_limiter.py: POST /api/billing/checkout rate limit removed
6. config.py: STRIPE_SECRET_KEY startup warning removed
7. templates/pricing.html: Deleted
8. templates/account.html: Tier badge, usage meter, and billing section removed; API keys visible to all users
9. templates/base.html: Pricing nav link, tier badge, and upgrade nudge removed
10. static/js/account.js: Billing portal handler removed
11. static/css/auth.css: Tier badge, upgrade nudge, pricing, and usage meter styles removed
12. scripts/nightly_maintenance.py: Usage-reset and tier-downgrade blocks removed
13. tests/test_phase6.py: TestBillingWebhook deleted (2 tests); tier/limit tests simplified
14. backend/mailer.py: Welcome email updated (no "10 graphs/month" text)
**Alternatives considered:** Full deletion (risky, irreversible), Config-gated dormant (no cleanup).
**Rationale:** Removes user-facing billing friction while preserving Stripe integration code for portfolio demonstration.
**Implications:** CONFLICT-009 (TIER_ORDER Phase 7 vs 8) is moot. CONFLICT-007 (Stripe version) is moot. Phase 7 §0.1/§2.3/§2.4 SKIPPED. Phase 8 §0.7 SKIPPED. All future routes use @require_auth only. Existing Neon users updated to tier='researcher' via one-time SQL (2026-03-16, 0 rows — no users registered yet)..
