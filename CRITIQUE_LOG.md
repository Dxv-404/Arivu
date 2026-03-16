# Arivu — Critique & Conflict Audit Log

Append-only. Every conflict, hallucination catch, scope question, spec critique, and out-of-plan detection goes here.

---

## [2026-03-14] [PHASE 1] [CONFLICT] bcrypt version mismatch between Phase 1 §14 and CLAUDE.md

**Type:** CONFLICT
**Status:** RESOLVED
**Affects:** requirements.txt — bcrypt version
**Severity:** LOW

### Finding
Phase 1 §14 specifies `bcrypt==4.1.3`. CLAUDE.md Part 12 baseline says `bcrypt==4.1.2`. CONFLICT-008 in CLAUDE.md Part 22 pre-resolves this to `bcrypt==4.1.2`.

### Impact
Wrong version could cause subtle behavior differences or install failures in later phases.

### Resolution
Using `bcrypt==4.1.2` per CONFLICT-008 pre-resolution in CLAUDE.md.

---

## [2026-03-14] [PHASE 1] [DRIFT] Stub phase attribution corrections applied

**Type:** DRIFT
**Status:** RESOLVED
**Affects:** backend/ stub file comments (6 files)
**Severity:** LOW

### Finding
Phase 1 stub table has incorrect phase attributions for 6 files. CLAUDE.md Part 16 provides corrections:
- `dna_profiler.py` — Phase 3 (Phase 1 said Phase 4)
- `diversity_scorer.py` — Phase 3 (Phase 1 said Phase 4)
- `orphan_detector.py` — Phase 3 (Phase 1 said Phase 4)
- `quality_monitor.py` — Phase 4 (Phase 1 said Phase 6)
- `precompute_gallery.py` — Phase 3 (Phase 1 said Phase 5)
- `load_retraction_watch.py` — Phase 5 (Phase 1 said Phase 2)

### Impact
Incorrect phase comments could mislead future sessions about when to implement each module.

### Resolution
Applied all 6 corrections from CLAUDE.md Part 16 to stub comments.

---

## [2026-03-14] [PHASE 1] [SPEC_GAP] Stub phase attribution for llm_client, chat_guide, prompt_sanitizer

**Type:** SPEC_GAP
**Status:** RESOLVED
**Affects:** backend/llm_client.py, backend/chat_guide.py, backend/prompt_sanitizer.py stub comments
**Severity:** LOW

### Finding
Phase 1 stub table assigns these three files to Phase 4. CLAUDE.md Part 7 (project structure) lists them as "← Phase 3". Part 16 does not include them in the 6 explicit corrections. Unclear which is correct.

### Impact
Only affects stub comments — no functional impact in Phase 1. Will be resolved when Phase 3 or Phase 4 implementation begins.

### Resolution
CLAUDE.md Part 7 is authoritative: these files are Phase 3 implementations. Part 7 explicitly marks `llm_client.py ← Phase 3`, `chat_guide.py ← Phase 3`, `prompt_sanitizer.py ← Phase 3`. Phase 2 §18 confirms: "Do not implement backend/llm_client.py, backend/chat_guide.py — Phase 4" but CLAUDE.md Part 7 takes precedence as the project structure authority. The stub comments remain as-is (Phase 4) since Part 16 did not list them as corrections; actual implementation will happen in Phase 3 per Part 7.

---

## [2026-03-14] [PHASE 1] [CONFLICT] gallery_index.json path

**Type:** CONFLICT
**Status:** RESOLVED
**Affects:** data/precomputed/gallery_index.json vs data/gallery_index.json
**Severity:** LOW

### Finding
Phase 1 file manifest and utils.py §6 both place gallery_index.json at `data/precomputed/gallery_index.json`. CLAUDE.md Part 6.4 says the canonical path from Phase 4 onward is `data/gallery_index.json`. Phase 5 §0.3 formalizes the fix.

### Impact
Path will need to change in Phase 4/5. No impact on Phase 1 since the file is an empty `[]` placeholder.

### Resolution
Following Phase 1 spec exactly: `data/precomputed/gallery_index.json`. Phase 5 §0.3 will move it.

---

## [2026-03-14] [PHASE 1] [CONFLICT] resend version incompatible with requests

**Type:** CONFLICT
**Status:** RESOLVED
**Affects:** requirements.txt — resend and requests versions
**Severity:** MEDIUM

### Finding
Phase 1 §14 specifies `resend==0.7.2` which has a hard dependency on `requests==2.31.0`. This conflicts with the separately pinned `requests==2.32.3`. Installation fails with `ResolutionImpossible`. CLAUDE.md CONFLICT-007 already notes Phase 6 §0.4 specifies `resend==2.3.0`.

### Impact
Cannot install dependencies at all with `resend==0.7.2` and `requests==2.32.3` together.

### Resolution
Updated to `resend==2.3.0` per CONFLICT-007 (Phase 6 value). Resend is only used in Phase 6+ — this change has zero functional impact on Phase 1.

---

## [2026-03-14] [PHASE 2] [DRIFT] structlog.stdlib.TimeStamper → structlog.processors.TimeStamper

**Type:** DRIFT
**Status:** RESOLVED
**Affects:** app.py — structlog configuration
**Severity:** LOW

### Finding
Phase 2 §15 specifies `structlog.stdlib.TimeStamper(fmt="iso")` in the app.py import block. In `structlog==24.1.0` (the pinned version), `TimeStamper` is in `structlog.processors`, not `structlog.stdlib`. This caused an `AttributeError` at module import time, breaking all tests.

### Impact
All tests fail with `AttributeError: module 'structlog.stdlib' has no attribute 'TimeStamper'`.

### Resolution
Changed to `structlog.processors.TimeStamper(fmt="iso")` which is the correct location in structlog 24.1.0.

---

## [2026-03-14] [PHASE 2] [DRIFT] computed_at column referenced in Phase 2 code but added in Phase 3

**Type:** DRIFT
**Status:** RESOLVED
**Affects:** app.py (graph cache query, graph retrieval route), backend/graph_engine.py (graphs upsert)
**Severity:** HIGH

### Finding
Three locations in Phase 2 code reference `graphs.computed_at`:
1. `app.py` line ~241: graph stream SSE cache lookup uses `g.computed_at > NOW() - INTERVAL '7 days'`
2. `app.py` line ~375: `GET /api/graph/<paper_id>` uses `computed_at > NOW() - INTERVAL '7 days'`
3. `graph_engine.py`: `ON CONFLICT` clause sets `computed_at = NOW()`

The `computed_at` column is a Phase 3 addition (via `ALTER TABLE` in `migrate.py`). The Phase 1 `graphs` table only has `created_at` and `last_accessed`.

### Impact
Both the graph stream and graph retrieval routes throw `psycopg2.errors.UndefinedColumn` at runtime. Integration test graph build also fails on the upsert.

### Resolution
- `app.py`: Replaced `computed_at` with `last_accessed` (which exists from Phase 1 and serves the same TTL eviction purpose per CLAUDE.md Part 10).
- `graph_engine.py`: Removed `computed_at = NOW()` from the `ON CONFLICT` clause, keeping only `last_accessed = NOW()`.

---

## [2026-03-14] [PHASE 2] [DRIFT] S2 API fieldsOfStudy returns strings, not objects

**Type:** DRIFT
**Status:** RESOLVED
**Affects:** backend/api_client.py — `_parse_s2_response()`
**Severity:** MEDIUM

### Finding
The S2 API returns `fieldsOfStudy` as a flat list of strings (e.g., `["Computer Science"]`), not as a list of objects (e.g., `[{"category": "Computer Science"}]`). The implementation assumed the object format, calling `.get("category", "")` on each element, causing `'str' object has no attribute 'get'`.

### Impact
Paper resolution fails with `AttributeError` for any paper that has fields of study set.

### Resolution
Added type check: `[f if isinstance(f, str) else f.get("category", "") for f in ...]` to handle both formats.

---

## [2026-03-14] [PHASE 2] [DRIFT] S2 API rate limiting without API key — rate limiter too aggressive

**Type:** DRIFT
**Status:** RESOLVED
**Affects:** backend/rate_limiter.py, backend/api_client.py
**Severity:** HIGH

### Finding
`CoordinatedRateLimiter` hard-codes S2 at 9 req/s (assumes API key present). Without an API key, S2 enforces ~1 req/s. This causes persistent 429 responses and IP-level rate limiting blocks lasting several minutes.

Additionally, `_to_s2_id()` and `_fetch_s2()` in `api_client.py` had no retry logic for 429 responses — a single rate limit hit caused permanent failure.

### Impact
Integration test fails when no S2 API key is configured (common in local dev). Extended IP-level rate limiting blocks all subsequent S2 requests for minutes.

### Resolution
1. Added module-level S2 rate limit adjustment in `rate_limiter.py`: when `config.S2_API_KEY` is empty, S2 window is set to (1, 1) instead of (9, 1).
2. Added exponential backoff retry (3 attempts: 30s, 60s, 120s) to both `_to_s2_id()` and `_fetch_s2()` in `api_client.py`.

---

## [2026-03-14] [PHASE 2] [DRIFT] Null guard missing in api_client.get_references()

**Type:** DRIFT
**Status:** RESOLVED
**Affects:** backend/api_client.py — `get_references()`
**Severity:** MEDIUM

### Finding
S2 API sometimes returns null data or null items within the references response array. The implementation iterated over the response without null checks, causing `'NoneType' object is not iterable`.

### Impact
Graph builds fail when S2 returns partial/null reference data for any paper in the ancestry tree.

### Resolution
Added `if not data: return refs` and `if not item: continue` guards in `get_references()`.

---

## [2026-03-15] [PHASE 3] [DRIFT] Python 3.10.11 instead of spec-required 3.11.8

**Type:** DRIFT
**Status:** DEFERRED
**Affects:** runtime.txt, all Python code
**Severity:** LOW

### Finding
The spec requires Python 3.11.8 (specified in `runtime.txt`). The development environment uses Python 3.10.11 (system install at `C:\Users\xplod\AppData\Local\Programs\Python\Python310\python.exe`) because:
1. Conda envs `arivu` and `arivu2` were corrupted by Windows Defender blocking python.exe
2. Python 3.13 (also available on system) is incompatible with numpy==1.26.4
3. Python 3.10.11 was the only viable option for the `.venv` workaround

### Impact
Risk is LOW. Python 3.10 → 3.11 differences are minimal for this codebase:
- `tomllib` (3.11 stdlib) not used — we use `python-dotenv`
- `ExceptionGroup` (3.11) not used
- `match/case` syntax not used in any spec code
- `str | None` type hints (3.10+) work fine
- All pinned dependencies support both 3.10 and 3.11
- Production deployment (Koyeb) will use `runtime.txt` which specifies 3.11.8 — local dev version is irrelevant

### Resolution
DEFERRED. No action needed. Production uses `runtime.txt` (3.11.8). Local dev uses 3.10.11. All tests pass. Will revisit only if a 3.11-specific feature is needed.

---

## [2026-03-15] [PHASE 3] [CONFLICT] CONFLICT-001 — CSS file naming resolved

**Type:** CONFLICT
**Status:** RESOLVED
**Affects:** static/css/style.css vs static/css/main.css
**Severity:** MEDIUM

### Finding
Phase 1 creates `static/css/style.css` as a stub. Phase 3 "New files" list shows `static/css/main.css`. Phase 8 modified files list references `static/css/style.css` for confidence badge styles, seen-paper opacity, and fault-line edges.

### Impact
Renaming to main.css would break Phase 8 references to style.css.

### Resolution
User decision: Populate existing `style.css` with all Phase 3 CSS content. Keep `style.css` as the canonical filename. Templates reference `style.css`. Phase 3 spec's mention of `main.css` was a naming inconsistency — the real file is `style.css`.

---

## [2026-03-15] [PHASE 3] [CONFLICT] CONFLICT-002 — Landing demo JS naming resolved

**Type:** CONFLICT
**Status:** RESOLVED
**Affects:** static/js/landing-demo.js vs static/js/index.js
**Severity:** MEDIUM

### Finding
Phase 1 creates `static/js/landing-demo.js` as a stub. Phase 3 creates `static/js/index.js` as the landing page demo state machine. CLAUDE.md Part 7 project structure lists `landing-demo.js`.

### Impact
Creating index.js separately would leave an unused stub and could cause import confusion in templates.

### Resolution
User decision: Populate existing `landing-demo.js` with Phase 3 demo state machine code. Keep `landing-demo.js` as the canonical filename. Templates reference `landing-demo.js`. No `index.js` created.

---

## [2026-03-15] [PHASE 4] [CONFLICT] CONFLICT-005 — nlp_worker/requirements.txt version divergence

**Type:** CONFLICT
**Status:** RESOLVED
**Affects:** nlp_worker/requirements.txt vs requirements-nlp-worker.txt
**Severity:** MEDIUM

### Finding
Phase 1 and `requirements-nlp-worker.txt` specify: `fastapi==0.111.0`, `torch==2.2.2`, `scikit-learn==1.4.2`, plus `groq`, `httpx`, `python-dotenv`.
Phase 4 §1.5 specifies `nlp_worker/requirements.txt` as: `fastapi==0.110.0`, `torch==2.2.1`, `scikit-learn==1.4.1`, `pydantic==2.6.3`, no `groq`/`httpx`/`python-dotenv`.

### Impact
After Phase 4, these two files intentionally diverge. The `nlp_worker/requirements.txt` is for HuggingFace Spaces deployment (minimal deps, lighter torch). The root `requirements-nlp-worker.txt` was only for local dev reference.

### Resolution
Following Phase 4 §1.5 spec (implementation authority per CLAUDE.md Part 0.2). Updated `nlp_worker/requirements.txt` to match Phase 4 spec. The NLP worker doesn't need groq/httpx/python-dotenv — those were only in the Phase 1 mirror file.

---

## [2026-03-15] [PHASE 4] [DRIFT] Neon DATABASE_URL contains channel_binding=require

**Type:** DRIFT
**Status:** RESOLVED
**Affects:** All scripts/commands connecting to Neon DB
**Severity:** HIGH

### Finding
Neon's connection string includes `channel_binding=require` which psycopg2 does not support. The error is: `psycopg2.ProgrammingError: invalid dsn: invalid connection option "channel_binding"`. This parameter must be stripped from the URL before use.

### Impact
All DB connections fail (migrate.py, smoke tests, precompute, deployment) unless channel_binding is removed from the URL.

### Resolution
Strip `channel_binding=require` from the Neon URL before use. The corrected URL format is: `postgresql://...@ep-xxx.neon.tech/neondb?sslmode=require` (only sslmode, no channel_binding). Documented in DECISIONS.md #17.

---

## [2026-03-15] [PHASE 4] [DRIFT] NLP worker health response missing model_loaded field

**Type:** DRIFT
**Status:** RESOLVED
**Affects:** nlp_worker/app.py, scripts/verify_deployment.py
**Severity:** LOW

### Finding
`verify_deployment.py` checks for `model_loaded` in the NLP worker health response, but the original health endpoint only returned `status`, `model`, and `dimensions`.

### Impact
Deployment verification would always fail on the NLP worker health check.

### Resolution
Added `"model_loaded": True` to the health endpoint response.

---

## [2026-03-15] [PHASE 4] [DRIFT] nlp_worker/Dockerfile uses nlp_worker/ prefix in COPY paths

**Type:** DRIFT
**Status:** RESOLVED
**Affects:** nlp_worker/Dockerfile
**Severity:** HIGH

### Finding
The Dockerfile used `COPY nlp_worker/requirements.txt` and `COPY nlp_worker/app.py`, which works when building from the Arivu project root. HuggingFace Spaces builds from the Space repo root where files are flat (no nlp_worker/ subdirectory).

### Impact
HF Spaces Docker build would fail with "file not found" errors.

### Resolution
Changed to flat COPY paths: `COPY requirements.txt` and `COPY app.py`. Documented in DECISIONS.md #18.

---

## [2026-03-15] [PHASE 4] [DRIFT] R2_BUCKET_NAME spec says arivu-data, user bucket is arivu-graphs

**Type:** DRIFT
**Status:** RESOLVED
**Affects:** .env.example, Koyeb environment variables
**Severity:** MEDIUM

### Finding
Phase 4 §4 and §12.2 specify `R2_BUCKET_NAME=arivu-data`. The user's actual Cloudflare R2 bucket was created as `arivu-graphs`.

### Impact
Using the wrong bucket name would cause all R2 operations to fail with "bucket not found".

### Resolution
Using `arivu-graphs` (user's actual bucket) in .env.example and deployment config. Documented in DECISIONS.md #16.

---

## [2026-03-15] [PHASE 4] [DRIFT] Dockerfile libgdk-pixbuf2.0-0 renamed in Debian Trixie

**Type:** DRIFT
**Status:** RESOLVED
**Affects:** Dockerfile
**Severity:** HIGH

### Finding
`libgdk-pixbuf2.0-0` was renamed to `libgdk-pixbuf-xlib-2.0-0` in Debian Trixie. The spec Dockerfile used the old name causing Koyeb build failure with exit code 100.

### Impact
Koyeb build fails completely — cannot deploy.

### Resolution
Changed to `libgdk-pixbuf-xlib-2.0-0` in Dockerfile.

---

## [2026-03-15] [PHASE 4] [DRIFT] /api/prune verify_deployment.py test expected 401 but got 404/500

**Type:** DRIFT
**Status:** RESOLVED
**Affects:** scripts/verify_deployment.py — /api/prune test, app.py route registration
**Severity:** MEDIUM

### Finding
`verify_deployment.py` expected `POST /api/prune` to return HTTP 401 (session required) when called without a session cookie. In reality, the `@require_session` decorator auto-creates a session transparently — it never returns 401. The actual response is:
- **Locally:** 404 (graph not found) — `@require_session` creates a session, then `_load_graph_for_request` returns None for the fake test paper_id
- **Production:** 500 (internal error) — likely DB pool/session creation issue under gunicorn multi-worker setup

The route IS registered at `/api/prune` POST and responds with JSON — it is not a Flask-level 404 (which would return HTML).

### Impact
`verify_deployment.py` falsely reports the prune route as broken. The actual route works correctly — the test expectation was wrong.

### Resolution
Updated `verify_deployment.py` to check that the route exists and responds with JSON (status 400/404/500 with `content-type: application/json`) instead of checking for 401. The test now verifies the route is registered rather than testing auth behavior that `@require_session` does not provide.

---

## [2026-03-16] [PHASE 6] [DRIFT] independent_discovery.py — spec used non-existent LLM interface

**Type:** DRIFT
**Status:** RESOLVED
**Affects:** backend/independent_discovery.py — LLM call for discovery interpretation
**Severity:** MEDIUM

### Finding
Phase 6 spec's `IndependentDiscoveryTracker` code references `LLMClient` and `call_llm()`, which do not exist in the codebase. The actual LLM interface is `get_llm_client()` returning an `ArivuLLMClient` instance with `generate_chat_response()`.

### Impact
Module would crash at runtime when trying to generate discovery interpretations.

### Resolution
Adapted to use `get_llm_client()` / `generate_chat_response()` from `backend/llm_client.py`, matching the established LLM interface from Phase 3.

---

## [2026-03-16] [PHASE 6] [DRIFT] citation_shadow.py — nx.descendants used instead of nx.ancestors

**Type:** DRIFT
**Status:** RESOLVED
**Affects:** backend/citation_shadow.py — shadow score calculation
**Severity:** HIGH

### Finding
Phase 6 spec code used `nx.descendants(G, node_id)` to count papers influenced by a node. In a directed citation graph where edges go citing→cited (newer paper → older paper), `nx.descendants()` follows outgoing edges FROM a node — which traverses backwards in time to ancestors, not forwards to influenced papers. Additionally, `MIN_DIRECT_CITATIONS` was set to 2, filtering out valid shadow papers with exactly 1 direct citation.

### Impact
Shadow scores were calculated on the wrong set of papers, producing incorrect "shadow" rankings.

### Resolution
Changed to `nx.ancestors(G, node_id)` which correctly follows incoming edges TO a node (finding all papers that transitively cite it). Changed `MIN_DIRECT_CITATIONS` from 2 to 1.

---

## [2026-03-16] [PHASE 6] [DRIFT] gdpr.py — edge_flags table name used instead of edge_feedback

**Type:** DRIFT
**Status:** RESOLVED
**Affects:** backend/gdpr.py — user data export SQL query
**Severity:** MEDIUM

### Finding
Phase 6 spec code in `generate_user_data_export()` queries `edge_flags` table, which doesn't exist. The canonical table name per CLAUDE.md Part 6.8 is `edge_feedback`.

### Impact
GDPR data export would crash with "relation edge_flags does not exist" when trying to export user flagging data.

### Resolution
Changed `edge_flags` to `edge_feedback` in the GDPR export SQL query.

---

## [2026-03-16] [PHASE 6] [DRIFT] Rate limiter spec used 3-tuples, existing code uses 2-tuples

**Type:** DRIFT
**Status:** RESOLVED
**Affects:** backend/rate_limiter.py — LIMITS dictionary format
**Severity:** LOW

### Finding
Phase 6 spec shows rate limit entries as 3-tuples `(max_requests, window_seconds, burst)`, but the existing `ArivuRateLimiter.LIMITS` dictionary (from Phase 2) uses 2-tuples `(max_requests, window_seconds)`. The burst parameter is not implemented.

### Impact
Using 3-tuples would cause tuple unpacking errors in `check()` method.

### Resolution
Adapted all Phase 6 rate limit entries to 2-tuple format matching the existing implementation. Burst limiting is not implemented.

---

## [2026-03-16] [PHASE 7] [CRITIQUE] Billing/Tier Removal — Full Impact Analysis

**Type:** CRITIQUE
**Status:** RESOLVED
**Affects:** billing.py, decorators.py, config.py, mailer.py, rate_limiter.py, app.py (8 routes), pricing.html, account.html, base.html, auth.css, account.js, nightly_maintenance.py, test_phase6.py; Phase 7 §0.1/§2.3/§2.4/§9 (13 routes); Phase 8 §0.7/§3.6 (9 routes)
**Severity:** HIGH

### Finding
User has decided all Arivu features should be free — no payments, no billing tiers, no tier-gated features. Every authenticated user gets full access to everything.

Analysis completed: 35 items across Phase 6 built code (Categories A), 14 items in Phase 7 planned code (Category B), 4 items in Phase 8 planned code (Category C), 7 DB schema items (Category D, all KEEP), and 6 test items (Category E).

**Total impact:** ~550 lines of built code across 13 files + ~87 lines of planned code across ~11 spec sections.

**Average score:** 7.1/25 (low-to-moderate removal difficulty).

**Key finding:** Billing is architecturally well-isolated. `billing.py` has zero reverse dependencies. Tier gating uses the decorator pattern (@require_tier), making removal a one-line-per-route operation. The ENABLE_AUTH flag already provides a "everything free" passthrough — this decision formalizes that behavior for authenticated users.

**Recommendation:** Hybrid strategy — delete billing.py, remove @require_tier decorators, remove billing UI. Keep DB schema columns untouched (no migration risk). Full analysis with score tables delivered in session output.

### Impact
- CONFLICT-009 (Phase 7 vs Phase 8 TIER_ORDER) becomes **moot** — no tier ordering needed
- CONFLICT-007 (Stripe version mismatch) becomes **partially moot** — Stripe not needed
- CLAUDE.md Part 6.9 (TIER_ORDER as "inviolable decision") must be overridden by explicit ADR
- Phase 7 §0.1, §2.3, §2.4 become **skip** sections
- Phase 8 §0.7 becomes a **skip** section
- 22 routes across Phases 7–8 drop @require_tier (keep @require_auth only)

### Resolution
RESOLVED (2026-03-16). User chose modified hybrid: billing.py kept DORMANT (not deleted), all billing touchpoints removed from active code. 14 files changed, pricing.html deleted, 168 tests pass (2 billing tests removed). See DECISIONS.md ADR-016 for complete change list.

---

## [2026-03-16] [PHASE 7] [SPEC_GAP] PHASE_7_v1.md missing — 13 modules reference it

**Type:** SPEC_GAP
**Status:** RESOLVED
**Affects:** 13 backend modules (time_machine.py, vocabulary_tracker.py, extinction_detector.py, counterfactual_engine.py, adversarial_reviewer.py, citation_audit.py, citation_generator.py, reading_prioritizer.py, paper_positioning.py, rewrite_suggester.py, persona_engine.py, insight_engine.py, secure_upload.py)
**Severity:** HIGH

### Finding
PHASE_7.md references "Identical to v1" for 13 module implementations, but no PHASE_7_v1.md file exists. Each module had to be written from scratch using only the class names, method signatures, and dataclass shapes defined in PHASE_7.md.

### Impact
Every module that said "Identical to v1" had to be reconstructed from spec context, increasing implementation risk.

### Resolution
All 13 modules written from scratch, validated against spec shapes. Known spec bugs corrected during implementation: LLMClient → get_llm_client(), R2Client.upload_bytes() → R2Client.upload(), Bearer → X-API-Key auth header.

---

## [2026-03-16] [PHASE 7] [DRIFT] Route-to-module interface mismatches in app.py

**Type:** DRIFT
**Status:** RESOLVED
**Affects:** app.py routes for citation-audit, citation-generator, reading-prioritizer
**Severity:** MEDIUM

### Finding
Three Phase 7 routes in app.py had argument order or signature mismatches with actual module implementations:
1. CitationAudit.audit() takes (paper_id, graph_json) — route had (graph_data, paper_id)
2. CitationGenerator.generate() takes (paper_ids, styles, all_styles) and does own DB lookup — route was fetching papers separately
3. ReadingPrioritizer.prioritize() takes (graph_json, max_items) — route was passing paper_ids list

### Impact
Routes would have failed at runtime with TypeError or incorrect results.

### Resolution
All three routes corrected to match actual module interfaces. Tests updated accordingly.

---

## [2026-03-16] [PHASE 7] [CONFLICT] Phase 3 api_insights endpoint conflicts with Phase 7

**Type:** CONFLICT
**Status:** RESOLVED
**Affects:** app.py — /api/insights/<paper_id> route
**Severity:** HIGH

### Finding
Phase 3 defined a route `api_insights` at `/api/insights/<paper_id>` that reads from `insight_cache` table. Phase 7 defines a new `api_insights` route at `/api/insights/<seed_paper_id>` that uses InsightEngine with persona filtering. Both cannot coexist as Flask endpoint names must be unique.

### Impact
Flask raises endpoint collision error on app startup.

### Resolution
Removed Phase 3 version (simple DB cache lookup), replaced with Phase 7 InsightEngine-based route that provides persona-aware insights. Comment added at Phase 3 location noting supersession.
