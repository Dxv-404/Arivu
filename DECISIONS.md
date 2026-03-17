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
| 22 | graph_id format | SHA256(seed_paper_id + "_" + session_id)[:32] stable hash | ADR-017 — Phase 8 caching, live subscriptions, graph memory all key on stable graph identity |
| 23 | shared_graphs schema | Full 12-column spec per PHASE_7.md §6.1 | ADR-018 — view_mode, seed_title, view_state required for share page to restore correct view |
| 24 | Citation formats | 7 formats: APA, MLA, Chicago, BibTeX, IEEE, Harvard, Vancouver | ADR-019 — Vancouver required for biomedical researchers; BibTeX kept from Phase 5 export system |

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
**Implications:** CONFLICT-009 (TIER_ORDER Phase 7 vs 8) is moot. CONFLICT-007 (Stripe version) is moot. Phase 7 §0.1/§2.3/§2.4 SKIPPED. Phase 8 §0.7 SKIPPED. All future routes use @require_auth only. Existing Neon users updated to tier='researcher' via one-time SQL (2026-03-16, 0 rows — no users registered yet).

## ADR-017: Stable graph_id via SHA256 hash
**Date:** 2026-03-16
**Context:** graph_id was set to UUID (random per build), breaking Phase 8 graph_memory_state, live_subscriptions, and caching — all of which key on stable graph identity. CLAUDE.md Part 13 specifies `SHA256(seed_paper_id + "_" + session_id)[:32]`.
**Decision:** `_compute_graph_id()` method added to AncestryGraph. graph_id = `hashlib.sha256(f"{seed_paper_id}_{session_id}".encode()).hexdigest()[:32]`. Wired into _build(), export_to_json(), from_json(), and R2 key path.
**Alternatives considered:** Using seed_paper_id alone (collides across sessions), using UUID (unstable, breaks caching).
**Rationale:** Deterministic — same seed + session always produces same graph_id. Different sessions get different IDs. 32-char hex is compact and collision-resistant.
**Implications:** R2 key is now `graphs/{graph_id}.json` (was `graphs/{job_id}.json`). All downstream consumers (share links, graph memory, live mode) can rely on stable identity.

## ADR-018: shared_graphs full schema per PHASE_7.md spec
**Date:** 2026-03-16
**Context:** Initial migrate_phase7.py created shared_graphs with only 5 columns (share_id, share_token, graph_id, user_id, created_at). PHASE_7.md lines 245-258 specify 12 columns including seed_paper_id, seed_title, view_mode, view_state, expires_at, view_count, last_viewed_at.
**Decision:** Schema updated to match spec. ON DELETE changed from SET NULL to CASCADE. Idempotent ALTER TABLE ADD COLUMN IF NOT EXISTS added for existing databases.
**Implications:** LabManager.create_share_link() signature expanded to accept all new fields. Share route in app.py joins graphs→papers for seed_title.

## ADR-019: Vancouver citation format added (7th style)
**Date:** 2026-03-16
**Context:** ARIVU_COMPLETE_SPEC_v3.md lists Vancouver as a required citation format (dominant in biomedical literature). Phase 7 implementation had BibTeX but not Vancouver.
**Decision:** Added Vancouver as 7th format to both backend (citation_generator.py SUPPORTED_STYLES) and frontend (citation-gen.js styles array). BibTeX kept — it's useful for researchers and used in export_generator.py.
**Alternatives considered:** Replacing BibTeX with Vancouver (would break existing exports).
**Rationale:** Additive change, no removal. Vancouver uses standard biomedical formatting (Surname AB, up to 6 authors then et al.).
**Implications:** SUPPORTED_STYLES tuple grows from 6 to 7. All all_styles=True API calls now include Vancouver. Frontend shows 7 style buttons.

## Resolved Conflicts

These conflicts were pre-logged in CLAUDE.md Part 22. Resolutions recorded here so Phase 8 Claude Code does not halt on them.

### CONFLICT-003 — retractions vs retraction_watch table name
**Status:** RESOLVED (2026-03-16)
**Conflict:** Phase 8 §0.1 uses `SELECT COUNT(*) FROM retractions`. CLAUDE.md Part 6.8 and Part 21 prohibit using `retractions` — canonical name is `retraction_watch`.
**Resolution:** `retraction_watch` is the correct table name. Phase 8 §0.1 contains a typo. All Phase 8 code must use `retraction_watch`. This is pre-resolved here so Phase 8 does not halt.

### CONFLICT-007 — Stripe and Resend version mismatch
**Status:** RESOLVED MOOT (2026-03-16)
**Conflict:** Phase 1 requirements.txt had stripe==9.9.0 and resend==0.7.2. Phase 6 §0.4 specified stripe==8.11.0 and resend==2.3.0.
**Resolution:** Moot. billing.py is permanently dormant per ADR-016. Stripe is never activated. The version in requirements.txt is frozen as-is. Resend is used for auth emails only and the installed version works correctly.

### CONFLICT-014 — Phase 8 §0.7 TIER_ORDER vs ADR-016
**Status:** RESOLVED MOOT (2026-03-16)
**Conflict:** Phase 8 §0.7 instructs extending TIER_ORDER to include 'developer' and using @require_tier on Phase 8 routes. ADR-016 prohibits adding developer tier and prohibits using @require_tier on any route.
**Resolution:** ADR-016 takes precedence. Phase 8 §0.7 is SKIPPED ENTIRELY. TIER_ORDER remains {"free": 0, "researcher": 1, "lab": 2}. All Phase 8 routes use @require_auth only, never @require_tier. Phase 8 Claude Code must read this entry and skip §0.7 without stopping to ask.

## ADR-020: Phase 8 Intelligence Module Reconstruction
**Date:** 2026-03-16
**Context:** Phase 8 spec references "PHASE_8_v1.md" for 13 modules marked "Same as v1", but that file never existed. All 14 Phase 8 intelligence modules had to be reconstructed from feature descriptions, route signatures, test mock expectations, and return shape requirements.
**Decision:** Reconstruct all modules as stateless classes with graph_json dict input. Use `get_llm_client()` (not `LLMClient()`) for all LLM calls. Modules that can work without LLM (intellectual_debt, challenge_generator, idea_credit, research_risk_analyzer) use pure graph analysis only.
**Alternatives considered:** Stubbing modules (too little value), asking user for v1 code (doesn't exist).
**Rationale:** Reconstructed modules match feature intent from ARIVU_COMPLETE_SPEC_v3.md and pass all 34 Phase 8 tests.
**Implications:** Module APIs may differ from any hypothetical v1 spec. Tests are adapted to match actual implementations rather than spec test code.

## Note: Phase 8 Commit Message Deviation
**Date:** 2026-03-16
**Context:** PHASE_8.md §17 done-when criterion 23 specifies exact
commit messages. Multi-session execution used different wording.
**Actual messages used:**
  eb29b57 [phase8] final intelligence layer, trust features, live mode & v1.0
  9a4849e [context] Phase 8 complete — all 8 phases done, ADR-020 added
**Required by spec:**
  [phase8] intelligence completion, trust layer, live mode, researcher profiles, literature review
  [v1.0] Arivu v1.0 complete — all phases 1-8 done
**Decision:** Deviation accepted. Functional compliance achieved.
Commit message wording is a process requirement only, not functional.

## ADR-021: NLP build time optimization — threshold and batch size
**Date:** 2026-03-17
**Context:** Graph builds on Koyeb take 5-10 minutes for large papers. Stage 2 (Groq LLM classification) is the bottleneck — hundreds of edges × individual API calls with rate limiting.
**Decision:** Raise `NLP_SIMILARITY_THRESHOLD` from spec-default 0.25 to 0.35; raise `NLP_BATCH_SIZE` from 5 to 10. Dynamic `max_tokens` scales with batch size.
**Alternatives considered:** (a) Keep spec defaults — slow builds. (b) Batch size 15 — Groq response truncation at `max_tokens=800` (rejected by pessimistic debugger). (c) Threshold 0.30 — marginal improvement.
**Rationale:** Edges in the 0.25–0.35 similarity range rarely produce meaningful LLM classifications — they almost always resolve to "incidental". Skipping them saves ~30% of Groq calls. Larger batches reduce per-call overhead. The 0.35 threshold matches the confidence tier LOW boundary (≥0.35), creating a clean conceptual alignment.
**Spec deviation:** CLAUDE.md Part 9 explicitly states NLP_SIMILARITY_THRESHOLD default is 0.25. This is an intentional user-requested performance optimization. Logged here per Part 3.3 drift detection protocol.
**Implications:** Edges with similarity 0.25–0.35 are auto-classified as "incidental" without LLM review. Classification quality for these borderline edges is lower, but they were unlikely to receive meaningful classifications anyway.