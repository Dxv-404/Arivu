# ARIVU — Claude Code Rulebook v3
### The Authoritative Operating Manual for Every Claude Code Session

Read this entire file before doing anything. Every session. Without exception.
This file was audited against all 8 phase files and the master spec. Every claim is verified.

---

## PART 0 — HOW TO USE THIS RULEBOOK

### 0.1 What This File Is

You are a senior engineer being brought onto a carefully specified project. You are not improvising. You are executing a plan built from an exhaustive specification and eight phased implementation guides. Your job is to build precisely what is specified — no more, no less — and to stop and discuss any time the plan is unclear, contradictory, or when you catch yourself about to invent something.

This file is the operating manual. It tells you who you are, what you are building, how the documentation system works, what rules are inviolable, and what protocols to follow when things go wrong. It does not replace the phase files or the master spec. It tells you how to use them.

### 0.2 The Three-Document Hierarchy

| Document | What it is | Authority |
|---|---|---|
| `ARIVU_COMPLETE_SPEC_v3.md` | Master spec — canonical description of what Arivu is, full feature set, architecture philosophy, all resolved design decisions | Vision & feature authority |
| `PHASE_N.md` (1 through 8) | Implementation specs — authoritative step-by-step build instructions with exact code, SQL, tests, and "done when" criteria | Implementation authority |
| `CLAUDE.md` (this file) | Operating manual — how to use the above, inviolable rules, protocols for uncertainty | Session governance |

**Document Authority Rules — read carefully:**

- The **phase files** are more implementation-correct than the master spec. They were written after the spec with gap-resolution passes applied. When implementation details differ, the phase file wins for code.
- The **master spec** is authoritative for *what* Arivu is supposed to be, its philosophy, and feature intent. When in doubt about what a feature should accomplish, the master spec wins.
- **When any two documents contradict each other:** do NOT pick a winner. Stop. Log the conflict to `CRITIQUE_LOG.md`. Ask the user. Wait for a response. Do not proceed.
- **When a phase file contains something not in the master spec:** stop, log it, ask.
- **When the master spec describes something no phase file covers:** stop, log it, ask.
- **When you are uncertain about anything, no matter how small:** stop. Ask. Do not guess.

This rule exists because known contradictions exist between documents. You cannot know which is right without asking.

### 0.3 Session Startup Ritual — Execute Every Session Before Any Code

1. **Read `CONTEXT.md`** — understand completed work, what is in progress, what is blocked, last session summary.
2. **Read `DECISIONS.md`** — review all locked architectural decisions before making any decision touching architecture, data models, or API contracts.
3. **Read `CRITIQUE_LOG.md`** — review open critiques from previous sessions. Do not repeat logged work. Confirm no open blockers.
4. **Identify your phase** — from `CONTEXT.md`, confirm which phase you are in. Open that phase file as your primary reference. Keep the master spec available for context.
5. **State your session plan** — before writing any code, output this block:

```
SESSION PLAN
─────────────────────────────────────────────
Current phase:     N — [Phase Title]
Phase section:     §X — [Section name]
Specific task:     [What exactly is being implemented]
Expected outputs:  [Which files change or are created]
Open critiques:    [Any unresolved items from CRITIQUE_LOG.md]
Forward-compat check: [Any decision that could break a later phase?]
─────────────────────────────────────────────
```

This is your anchor against drift. If at any point you realize you've deviated from this plan, stop and re-evaluate.

If `CONTEXT.md` does not exist, you are at the beginning. Go to Part 23.

### 0.4 Session End Protocol — Execute Before Every Session Ends

1. Run `python -m pytest tests/ -v` — zero failures before any commit.
2. Commit all completed work: `git add -A && git commit -m "[scope] description"`
3. If work is mid-stream, stub cleanly with `# TODO: Phase N — [description]` before committing.
4. Update `CONTEXT.md`: move completed items, note exactly what is in-progress with the specific subpart.
5. If any architectural decisions were made, add them to `DECISIONS.md` before closing.
6. If any critiques were raised, confirm their status in `CRITIQUE_LOG.md` (OPEN / RESOLVED / ASKED_USER).
7. Never leave a session with uncommitted changes or a failing test suite.

---

## PART 1 — WHAT YOU ARE BUILDING

### 1.1 Arivu's Identity

**Arivu** (அறிவு — Tamil for "knowledge/wisdom") is a web-based research intelligence platform. It takes any academic paper as input and reveals its complete intellectual ancestry — not just which papers it cites, but:

- What **specific ideas** it inherited from each ancestor
- How those ideas **mutated** across generations (adoption, generalization, specialization, hybridization, contradiction, revival, incidental)
- How **critical** each ancestor is to the field's survival
- What the field would look like if **foundational papers never existed** (the cascading pruning animation)
- Where the **white space** lies for future research

Arivu is a **comprehension tool**, not a discovery tool. It serves researchers who already know their field and want to understand its intellectual structure deeply.

### 1.2 The Core Differentiator

Every existing tool — Connected Papers, Litmaps, ResearchRabbit, Scite.ai — treats citations as binary relationships: A cites B. That is all they know.

Arivu knows that Paper A *generalized* Paper B's core technique, extended it from single-domain to multi-domain application, and in doing so created the foundational method that 47 subsequent papers depend on. Remove Paper B from history and 31% of this research lineage collapses.

That is the difference between a database and a knowledge system.

### 1.3 The Flagship Feature

The **cascading pruning animation** is the product's heart. When a user clicks a node to "remove it from history," dependent papers collapse in BFS-level waves. Collapsed papers turn red and fade. Survival paths glow green. A stats counter runs in real time. This is the aha moment the entire product delivers in the first 90 seconds.

Every engineering decision that affects this feature is a critical decision.

### 1.4 The North Star

> **Does a researcher who uses Arivu produce better research?**

Not "do they use it more." Not "do they find it beautiful." Does it improve their work. Every feature decision is evaluated against this question.

### 1.5 What Arivu Is Not

Not a search engine. Not a recommendation system. Not a citation manager. Not a writing assistant (though it has writing tools in later phases). Not a social platform (though it has collaboration features in Phases 6–7).

---

## PART 2 — THE PHASE SYSTEM

### 2.1 Phase Overview

| Phase | Title | Key Deliverable |
|---|---|---|
| 1 | Project Skeleton, Schema & Health Check | All files exist, 17 DB tables, smoke tests pass |
| 2 | Data Layer, NLP Worker & Graph Build Pipeline | Real graph builds from a paper DOI |
| 3 | Full-Text Pipeline, Intelligence Layer & Frontend | Complete working tool with all core features |
| 4 | Deployment, Production Hardening & Gallery Launch | Arivu live on internet |
| 5 | Export System, Advanced Intelligence & Custom Domain | 8 export formats, arivu.app live |
| 6 | Auth, Billing & GDPR | User accounts, Stripe, GDPR compliance |
| 7 | Temporal Intelligence, Workflow Tools & Public API | Time Machine, REST API, visualization modes |
| 8 | Final Intelligence Layer, Trust Features & v1.0 | All remaining spec features, v1.0 tag |

### 2.2 Phase Progression Rules

- **Never begin a phase until the previous is marked "Completed" in `CONTEXT.md`.**
- **Always run the full test suite before marking a phase complete.** `python -m pytest tests/ -v` → zero failures.
- **Every phase has a "Done When" section.** All conditions must be simultaneously true.
- **Phases 3 through 8 modify `migrate.py` or have their own `migrate_phaseN.py`.** See §2.5 for migration file rules.
- **Phases 4 through 8 have a `§0 Backports` section.** These fix bugs in previous-phase code that the current phase depends on. Apply ALL backports before writing any new phase code. The backport count in Phase 4's header says 15 — the actual count is 11 (§0.1 through §0.11). Do not look for §0.12–§0.15 in Phase 4; they don't exist. Phase 5 supplies the remaining fixes.
- **Never skip ahead.** Phases are sequenced for dependency reasons.
- **Never implement a feature from a future phase**, even if it seems trivial.

### 2.3 Which Documents to Have Open

During any phase, keep open:
- The **current phase file** — your primary build reference
- **`ARIVU_COMPLETE_SPEC_v3.md`** — for feature intent and context
- All **previous phase files** — readable for context, do not re-implement their content
- **This rulebook** — for protocols and rules

Do not implement anything from a future phase file, even if you've read ahead.

### 2.4 Forward Compatibility — The Three Danger Zones

Before making any architectural decision, ask: "Will this force a breaking change in a later phase?" The three highest-risk areas are:

1. **Schema decisions** — adding NOT NULL columns without defaults breaks existing data in later migrations. Every column added to an existing table must use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` with a safe default.
2. **Shared module function signatures** — `Paper.from_db_row()`, `normalize_user_input()`, `await_sync()`, `select_references()`, `get_confidence_tier()` are used across every phase. Changing their signatures breaks everything downstream.
3. **Graph JSON shape** — the graph JSON format from `AncestryGraph.export_to_json()` is consumed by the D3 frontend (Phase 3), precompute scripts (Phase 5), live mode (Phase 8), and the landing page demo. Every key name in the JSON output is load-bearing.

Flag any decision touching these three areas in `DECISIONS.md` before implementing.

### 2.5 Migration File Rules

Schema changes follow this pattern:
- **Phase 1:** `scripts/migrate.py` — creates all 17 baseline tables
- **Phase 3:** Modifies `scripts/migrate.py` directly via `ALTER TABLE` (adds `leaderboard_json`, `dna_json`, `diversity_json`, `computed_at` to `graphs`; creates `insight_cache`, `insight_feedback`)
- **Phase 6:** `scripts/migrate_phase6.py` — new tables for auth, billing, GDPR
- **Phase 7:** `scripts/migrate_phase7.py` — Time Machine, webhooks, shared graphs, etc.
- **Phase 8:** `scripts/migrate_phase8.py` — confidence overrides, graph memory state, live subscriptions, researcher profiles

There is no `migrate_phase2.py`, `migrate_phase4.py`, or `migrate_phase5.py`. Do not invent them.

Never alter the schema by hand in production. Every schema change goes through a migration script.

---

## PART 3 — HALLUCINATION & DRIFT GUARD

This is one of the most important sections. Read it carefully.

### 3.1 What Hallucination Means Here

You are an LLM. Without specific guards, you will tend to:
- Invent API endpoint names that aren't in the spec
- Add DB columns that seemed logical but weren't specified
- Implement features from a future phase because they "felt natural"
- Assume a library is available without checking `requirements.txt`
- Fill implementation details by pattern-matching to common patterns rather than reading the spec
- Use the wrong function name because it "sounded right" (e.g. `import pymupdf` instead of `import fitz`)

All of these are hallucinations in this project. The phase files are the truth. Your intuition is not.

### 3.2 The Five Pre-Code Checks

Run these before writing any code block:

**Check 1 — Feature Exists?**
Is what I'm implementing explicitly described in the current phase file? If I only "think" it should exist, that is a hallucination risk. Look it up. If it isn't in the phase file or master spec, log it and ask.

**Check 2 — Endpoint/Function Name Verified?**
Every API route, function name, class name, and method name must appear verbatim in the phase file. Do not rename them. Do not add suffixes. The spec is exact.

**Check 3 — Schema Field Verified?**
Every DB column I reference must appear in the migration SQL for the current or previous phase. If I need a field that isn't there, stop and ask before adding it.

**Check 4 — Phase Boundary?**
Is this feature explicitly in scope for the current phase? If it's in Phase 5 and I'm in Phase 2, it does not get built. Log the temptation and move on.

**Check 5 — Library in Stack?**
Every import must reference a library in `requirements.txt` or `requirements-nlp-worker.txt` for the current phase. Do not assume availability. Flag before using.

### 3.3 Drift Detection

Drift is gradual deviation from the spec. A slightly different function signature. An extra helper parameter. A different variable name. Drift compounds — a small deviation in Phase 1 causes a breaking mismatch in Phase 6.

After implementing any function:
- Compare its signature against the spec. Exact match.
- Confirm all table and column names against the migration SQL. Exact match.
- Confirm all JSON response keys against the spec's response shape. Exact match.

If drift is detected: stop, log to `CRITIQUE_LOG.md`, correct before continuing.

### 3.4 Proactive Out-of-Plan Detection

At every decision point, ask: "Am I still following the phase file?" If you realize you've gone beyond the session plan, stop. Do not proceed. Reassess. Log to `CRITIQUE_LOG.md` if needed.

---

## PART 4 — CRITIQUE & LOGGING PROTOCOL

### 4.1 The `CRITIQUE_LOG.md` File

Lives at project root. Append-only — never delete entries. Every conflict, hallucination catch, scope question, spec critique, and out-of-plan detection goes here. This is the audit trail.

**Format:**

```markdown
## [YYYY-MM-DD] [PHASE N] [TYPE] Short title

**Type:** CONFLICT | HALLUCINATION_RISK | SPEC_GAP | SCOPE_QUESTION | CRITIQUE | DRIFT
**Status:** OPEN | RESOLVED | ASKED_USER | DEFERRED
**Affects:** [file / feature / schema / decision]
**Severity:** CRITICAL | HIGH | MEDIUM | LOW

### Finding
Exact description of what was found. Quote conflicting passages verbatim.

### Impact
What breaks or becomes inconsistent if unresolved.

### Resolution
(Fill in after resolution) What was decided and why.
```

### 4.2 What Gets Logged

Log when:
- Any two documents contradict each other (any type)
- You catch yourself about to invent something not in the spec
- A phase file mentions something the master spec doesn't (or vice versa)
- You have a genuine architectural critique of a spec decision
- You spot a potential bug in spec-provided code
- You've drifted from the spec and caught it
- You're uncertain enough that you need to stop

**Do not** log routine implementation decisions or things that are clearly and unambiguously specified. The log is for genuine concerns, not noise.

### 4.3 Resolution Flow

1. Log the entry with status `OPEN`
2. Raise the question to the user clearly
3. Wait for a response — **do not proceed** on any of these without a response
4. Once resolved, update the entry: change status to `RESOLVED` or `ASKED_USER`, fill in the Resolution field
5. If the resolution is an architectural decision, add it to `DECISIONS.md` as well

### 4.4 Raising a Critique of the Spec

You are encouraged to critique the spec, phase files, and this rulebook. If you spot a wrong design decision, brittle implementation, logic error, or performance problem, say so. Log it and raise it. A senior engineer raises concerns — they don't silently implement something they believe is wrong.

Format for a critique:

```
Type: CRITIQUE
Affects: [file/feature/decision]
Severity: [HIGH/MEDIUM/LOW]

I believe [X] may be a problem because [Y].
Specifically: [quote the relevant spec passage]
A possible alternative: [Z]
Should we proceed as specified or discuss this first?
```

Implement as specified while waiting for a response, unless the critique is CRITICAL severity — in which case, stop and wait.

---

## PART 5 — GIT RULES — INVIOLABLE

- **Never create a git worktree.** Work directly in the project directory on `main`. 
  If a worktree has been created, discard it immediately and return to the main 
  working directory before writing any code.
  **Never add Claude as the co-author**Only keep one contributor do not add claude as a contributor
- **Always work on the `main` branch.** Never create feature branches. Never switch 
  branches. Run `git branch` at session start to confirm you are on `main`.
- **After every commit, push immediately:**

  git add -A
  git commit -m "[scope] description"
  git push origin main
```
  Never let commits accumulate unpushed. Push is part of the commit ritual.
- **Commit after every meaningful unit of work.** One file fully implemented, one 
  feature working, one bug fixed, or one set of related files created together.
- **Commit message format:** `[scope] short description`
- **Two commits per phase minimum:** one for implementation, one for CONTEXT.md update.
- **Never commit broken code.** Stub cleanly with `# TODO: Phase N — description`.
- **Never commit `.env`.** Only `.env.example` is ever committed.
- **Tests must pass before committing.** `python -m pytest tests/ -v` — zero failures.
- **First three git commands ever run:**
  git init
  git branch -M main
  git add CLAUDE.md && git commit -m "[init] add Claude Code rulebook"
  git push -u origin main
```
```

The key additions are: explicit worktree prohibition at the top, the push step as mandatory after every commit, and `git branch` check at session start.

---

## Question 2 — Spec files at root vs `docs/`

**Short answer: put everything at `arivu/` root.**

Here is the tradeoff:

| | `arivu/docs/` subfolder | `arivu/` root |
|---|---|---|
| Claude Code file discovery | Must be told paths explicitly every session | Reads CLAUDE.md automatically; finds other .md files naturally |
| Your repo cleanliness | Cleaner root | More .md files at root |
| Prompt complexity | Every prompt needs path references | Can refer to files by name only |
| Risk of Claude Code missing files | Higher — if you forget to mention `docs/`, it won't look | Lower — it can see everything at root |

For a Claude Code workflow, **root is the right call.** Claude Code's context window is bounded and its file discovery is path-sensitive. Every time you start a new session and forget to say `docs/PHASE_3.md`, Claude Code will either hallucinate content or ask you. Over 8 phases with multiple sessions each, that friction compounds.

**Final structure:**
```
arivu/
├── CLAUDE.md
├── DECISIONS.md
├── CRITIQUE_LOG.md
├── CONTEXT.md
├── ARIVU_COMPLETE_SPEC_v3.md
├── PHASE_1.md
├── PHASE_2.md
├── PHASE_3.md
├── PHASE_4.md
├── PHASE_5.md
├── PHASE_6.md
├── PHASE_7.md
├── PHASE_8.md
├── app.py
├── exceptions.py
... (all other project files)
```

Then update your first prompt to remove the `docs/` path references:
```
Key file locations:
- Rulebook: CLAUDE.md (project root)
- Master spec: ARIVU_COMPLETE_SPEC_v3.md
- Phase files: PHASE_1.md through PHASE_8.md

---

## PART 6 — ARCHITECTURE — INVIOLABLE DECISIONS

These decisions are locked. Do not deviate during implementation. If you believe one is wrong, log a critique and implement as specified while waiting for a response.

### 6.1 Two-Service Architecture

**Main Flask App** (`app.py` + `backend/`)
- Serves all HTTP routes (pages + API endpoints)
- Owns all PostgreSQL database access
- Runs graph engine (NetworkX — pure Python, no ML)
- Calls NLP worker via HTTP for embeddings and classifications
- **NEVER imports `sentence_transformers`, `torch`, or any ML model loading library**
- Violating this causes Koyeb OOM on startup — the free tier has 512MB RAM

**FastAPI NLP Worker** (`nlp_worker/app.py`)
- Stateless HTTP microservice: receives text, returns vectors or classifications
- Loads `all-MiniLM-L6-v2` once at startup (22M params, 384-dim output)
- Zero database access. Zero session awareness.
- Deployed separately on HuggingFace Spaces (free CPU tier)
- Auth validated on every request (see §6.6)

**Canonical NLP worker endpoints — exact names, no variations:**
```
POST {NLP_WORKER_URL}/encode_batch       → embeddings list
POST {NLP_WORKER_URL}/similarity_matrix  → matrix + max pair
GET  {NLP_WORKER_URL}/health             → {"status": "ok", "model": "all-MiniLM-L6-v2", "dimensions": 384}
```
Never use `/embed`, `/embeddings`, `/encode`. The canonical name is `/encode_batch`.

`/encode_batch` hard limit: **512 texts per call** (enforced server-side, returns HTTP 400 if exceeded).

### 6.2 Flask App Factory — Phase-Dependent Pattern

**Phase 1–3:** `create_app()` is a true factory — `app = Flask(__name__)` lives inside `create_app()`. Routes are defined inside the factory body using `@app.route`.

**Phase 4 backport (§0.1):** `app = Flask(__name__)` is moved to module level. `create_app()` becomes a configuration function, not a creation function. This is required because Phase 2/3 route decorators use `@app.route` at module level, which NameErrors if `app` is a local variable. After Phase 4, `app` is always module-level.

Do not fight this pattern change. It is intentional and documented.

### 6.3 Database

- **PostgreSQL only.** Driver: `psycopg2-binary`. Extension: `pgvector` (384-dim) + `pg_trgm` (fuzzy title search). Both extensions are created in the Phase 1 migration.
- **Never use `sqlite3`** — not for tests, not for caching, not for anything.
- Local dev: Docker `pgvector/pgvector:pg16`
- Production: Neon.tech (free tier, 10 connection hard cap)
- **Connection pool sizing is phase-dependent:**
  - Phase 1–3: `--workers 1` in Procfile, `DB_POOL_MAX=8` (1 × 8 = 8 connections, leaves 2 for scripts)
  - Phase 4+: `--workers 2`, `DB_POOL_MAX=4` (2 × 4 = 8 connections, leaves 2 for scripts)
  - These two changes must happen together atomically in Phase 4 §1.1
  - **Never use `--workers 2` without also setting `DB_POOL_MAX=4`** — it will exceed Neon's cap

Local DB startup:
```bash
docker run -d --name arivu-db \
  -e POSTGRES_DB=arivu \
  -e POSTGRES_USER=arivu \
  -e POSTGRES_PASSWORD=localdev \
  -p 5432:5432 \
  pgvector/pgvector:pg16
```

SSL: Neon requires `sslmode=require`. The `db.py` helper appends it automatically if missing. Never manually add `?sslmode=require` — it will be duplicated.

### 6.4 Object Storage — Cloudflare R2

R2 via `boto3` S3-compatible API. Lives in `backend/r2_client.py`. Operates in no-op mode when credentials aren't set (safe for local dev).

**Canonical R2 key formats — use these exactly:**
```
graphs/{graph_id}.json          — full graph JSON for D3
full_text/{paper_id}.txt        — extracted full text (section-structured)
exports/{session_id}/{ts}_{fn}  — generated export files
precomputed/{slug}.json         — pre-built gallery graphs
previews/{slug}/graph.json      — gallery mini-graph previews
previews/{slug}.svg             — gallery SVG thumbnails
```

**`gallery_index.json` canonical path:** `data/gallery_index.json` (root of `data/`, NOT `data/precomputed/`). This changed between Phase 1 (`data/precomputed/`) and Phase 4 (moved to `data/`). Phase 5 §0.3 formalizes the fix. The correct path from Phase 4 onward is `data/gallery_index.json`. Individual precomputed graph JSONs remain in `data/precomputed/<slug>.json`.

`backend/utils.py` constants (corrected in Phase 5 §0.3):
```python
GALLERY_DIR        = Path(__file__).parent.parent / "data" / "precomputed"
GALLERY_INDEX_PATH = Path(__file__).parent.parent / "data" / "gallery_index.json"
```

### 6.5 LLM — Two Groq Models

| Config Attribute | Model | When to Use |
|---|---|---|
| `config.GROQ_FAST_MODEL` | `llama-3.1-8b-instant` | Stage 2 NLP edge classification, cluster labeling, chat (default: env or this value) |
| `config.GROQ_SMART_MODEL` | `llama-3.3-70b-versatile` | Genealogy storytelling, complex multi-paper reasoning |

**LLM caching is mandatory.** Cache key = `SHA256(model + ":" + system_prompt + ":" + user_prompt)`. TTL = 30 days. Always check `llm_cache` before calling Groq. Always store immediately after success. This is not optional.

Rate limiter key for Groq: `"groq"` — never `"groq_llm"`. This is a known spec divergence documented in Phase 2 §20.

### 6.6 NLP Worker Authentication — Phase-Dependent

**Phase 2–3:** `Authorization: Bearer {NLP_WORKER_SECRET}` header only.

**Phase 4+ (backport §0.9):** The NLP worker accepts both:
- `X-API-Key: {WORKER_SECRET}` (canonical from Phase 4)
- `Authorization: Bearer {NLP_WORKER_SECRET}` (legacy fallback)

The env var is also read from both `WORKER_SECRET` and `NLP_WORKER_SECRET` (fallback). When sending from the Flask app in Phase 4+, use `X-API-Key`. Both headers are accepted by the worker.

### 6.7 Deployment Stack

| Service | Platform | Notes |
|---|---|---|
| Main Flask backend | Koyeb (free eco plan, always-on) | Phase 4 |
| NLP worker | HuggingFace Spaces (free CPU) | Phase 2 (local) / Phase 4 (deployed) |
| Database | Neon.tech PostgreSQL + pgvector | Phase 1 |
| Object storage | Cloudflare R2 | Phase 2 |
| Custom domain | Cloudflare → Koyeb | Phase 5 |

Do not reference Render.com, PythonAnywhere, Streamlit Cloud, Heroku, or Railway anywhere.

### 6.8 Canonical Table Names — Drift Reference

Three names have been wrong in earlier spec drafts. These are the canonical names:

| Correct | Never Use |
|---|---|
| `edge_analysis` | `edge_analysis_cache` |
| `edge_feedback` | `edge_flags` |
| `retraction_watch` | `retractions` |

**Special note for Phase 8:** Phase 8 §0.1 references `retractions` in a bash verification command. This is an error in the Phase 8 spec. The correct table name is `retraction_watch`. This conflict is pre-logged in Part 22.

### 6.9 Tier Hierarchy — Phase-Dependent

**Phase 6:**
```python
TIER_ORDER = {"free": 0, "researcher": 1, "lab": 2}
```

**Phase 7 (extends):**
```python
TIER_ORDER = {"free": 0, "researcher": 1, "developer": 2, "lab": 3}
```

**Phase 8 (diverges — pre-logged conflict):**
Phase 8 §0.7 shows `TIER_ORDER = {"free": 0, "researcher": 1, "lab": 2, "developer": 2}` — different ordering. This contradicts Phase 7. This conflict is pre-logged in Part 22 (CONFLICT-009). Do not implement Phase 8's tier order without first asking the user.

---

## PART 7 — PROJECT STRUCTURE

The complete structure across all 8 phases. Files are tagged with `← Phase N` when they first appear as real implementations. Files without a tag appear in Phase 1.

```
arivu/
├── app.py                              # Flask entry point + all routes (grows each phase)
├── exceptions.py                       # Full exception hierarchy (16 classes)
├── conftest.py                         # Pytest fixtures — lives at PROJECT ROOT, not inside tests/
├── pytest.ini                          # asyncio_mode = auto (required for Phase 2 async tests)
├── requirements.txt                    # Main Flask app (pinned, grows each phase)
├── requirements-nlp-worker.txt         # NLP worker (mirrors nlp_worker/requirements.txt through Phase 3)
├── requirements-dev.txt                # Dev-only: pytest, black, flake8, mypy
├── Procfile                            # gunicorn factory invocation
├── runtime.txt                         # python-3.11.8
├── Dockerfile                          # Main app Docker build
├── .dockerignore                       # CRITICAL: prevents .env being baked into image
├── .env                                # Never committed
├── .env.example                        # Always committed — complete reference, grows each phase
├── .gitignore
├── README.md                           # Minimal stub until Phase 8 completes it
├── CLAUDE.md                           # This file
├── CONTEXT.md                          # Build progress log — updated every session
├── DECISIONS.md                        # Architecture decision log — created in Phase 1
├── CRITIQUE_LOG.md                     # Critique and conflict audit log — created in Phase 1
│
├── backend/
│   ├── __init__.py                     # Package marker only: # Arivu package marker
│   ├── config.py                       # Config class — all env vars, feature flags
│   ├── db.py                           # PostgreSQL pool + fetchone/fetchall/execute/execute_returning/executemany/paginate/health_check
│   ├── models.py                       # Paper + EdgeAnalysis dataclasses + all constants
│   ├── schemas.py                      # Pydantic request/response models
│   ├── utils.py                        # await_sync, load_gallery_index, load_precomputed_graph, log_action, update_graph_memory, get_graph_summary_for_chat
│   ├── api_client.py                   # SmartPaperResolver: S2 + OpenAlex ← Phase 2
│   ├── normalizer.py                   # normalize_user_input + split_into_sentences ← Phase 2
│   ├── deduplicator.py                 # PaperDeduplicator ← Phase 2
│   ├── nlp_pipeline.py                 # InheritanceDetector (3-stage) ← Phase 2, upgraded Phase 3, Phase 8
│   ├── graph_engine.py                 # AncestryGraph: BFS, NLP, export_to_json ← Phase 2, upgraded Phase 3, Phase 8
│   ├── pruning.py                      # compute_pruning_result + compute_all_pruning_impacts ← Phase 3
│   ├── full_text_fetcher.py            # arXiv PDF, Europe PMC, CORE, Unpaywall ← Phase 3
│   ├── section_parser.py               # PDF section extractor: PyMuPDF (import fitz) ← Phase 3
│   ├── dna_profiler.py                 # DNAProfiler: consensus clustering ← Phase 3
│   ├── diversity_scorer.py             # DiversityScorer: 4-component radar ← Phase 3
│   ├── orphan_detector.py              # OrphanDetector: trajectory analysis ← Phase 3
│   ├── gap_finder.py                   # GapFinder: pgvector research gap search ← Phase 3
│   ├── llm_client.py                   # ArivuLLMClient: Groq + DB cache ← Phase 3, Phase 5 adds generate_literature_review()
│   ├── chat_guide.py                   # ChatGuide: context-aware AI guide ← Phase 3
│   ├── prompt_sanitizer.py             # PromptSanitizer: injection prevention ← Phase 3
│   ├── r2_client.py                    # R2Client: boto3 S3-compatible ← Phase 2, Phase 5 adds presigned_url()
│   ├── session_manager.py              # SessionManager: DB-backed anonymous sessions ← Phase 2
│   ├── rate_limiter.py                 # CoordinatedRateLimiter + ArivuRateLimiter ← Phase 2
│   ├── security.py                     # STUB in Phase 1 — SecureFileUploadHandler spec conflicts with Phase 7's secure_upload.py. See Part 22 CONFLICT-010.
│   ├── quality_monitor.py              # ProductionQualityMonitor ← Phase 4
│   ├── export_generator.py             # ExportGenerator: 8 formats ← Phase 5
│   ├── living_paper_scorer.py          # LivingPaperScorer: citation velocity ← Phase 5
│   ├── originality_mapper.py           # OriginalityMapper: Pioneer/Synth/Bridge/Refiner ← Phase 5
│   ├── paradigm_detector.py            # ParadigmShiftDetector: 4-signal structural analysis ← Phase 5
│   ├── auth.py                         # Auth Blueprint: register/login/verify/reset ← Phase 6
│   ├── billing.py                      # Stripe Checkout + webhooks ← Phase 6
│   ├── gdpr.py                         # Data export + account deletion ← Phase 6
│   ├── decorators.py                   # @require_auth, @require_tier, @check_graph_limit ← Phase 6
│   ├── captcha.py                      # hCaptcha wrapper ← Phase 6
│   ├── mailer.py                       # Resend wrapper + 5 email templates ← Phase 6
│   ├── independent_discovery.py        # IndependentDiscoveryTracker (F1.7) ← Phase 6
│   ├── citation_shadow.py              # CitationShadowDetector (F1.5) ← Phase 6
│   ├── field_fingerprint.py            # FieldFingerprintAnalyzer (F1.12) ← Phase 6
│   ├── serendipity_engine.py           # SerendipityEngine (F11.2) ← Phase 6
│   ├── time_machine.py                 # TimeMachineEngine (F2.1) ← Phase 7
│   ├── vocabulary_tracker.py           # VocabularyEvolutionTracker (F1.8) ← Phase 7
│   ├── extinction_detector.py          # ExtinctionEventDetector (F1.6) ← Phase 7
│   ├── counterfactual_engine.py        # CounterfactualEngine (F2.2/F2.3) ← Phase 7
│   ├── adversarial_reviewer.py         # AdversarialReviewer (F4.1) ← Phase 7
│   ├── paper_positioning.py            # PaperPositioningTool (F4.2) ← Phase 7
│   ├── rewrite_suggester.py            # RewriteSuggester (F4.3) ← Phase 7
│   ├── citation_audit.py               # CitationAudit (F4.4) ← Phase 7
│   ├── reading_prioritizer.py          # ReadingPrioritizer (F4.6) ← Phase 7
│   ├── citation_generator.py           # CitationGenerator: 6 formats (F4.9) ← Phase 7
│   ├── persona_engine.py               # PersonaEngine (F5.2) ← Phase 7
│   ├── insight_engine.py               # InsightEngine (F5.4) ← Phase 7
│   ├── secure_upload.py                # SecureFileUploadHandler for PDF uploads ← Phase 7 (see CONFLICT-010)
│   ├── public_api.py                   # Public REST API Blueprint /v1/ ← Phase 7
│   ├── webhook_manager.py              # WebhookManager (F9.2) ← Phase 7
│   ├── lab_manager.py                  # LabManager ← Phase 7
│   ├── cross_domain_spark.py           # CrossDomainSparkDetector (F1.14) ← Phase 8
│   ├── error_propagation.py            # ErrorPropagationTracker (F1.15) ← Phase 8
│   ├── reading_between_lines.py        # ReadingBetweenLines (F11.3) ← Phase 8
│   ├── intellectual_debt.py            # IntellectualDebtTracker (F11.4) ← Phase 8
│   ├── challenge_generator.py          # ChallengeGenerator (F11.5) ← Phase 8
│   ├── idea_credit.py                  # IdeaCreditSystem (F11.7) ← Phase 8
│   ├── researcher_profiles.py          # ResearcherProfileBuilder (F3.1) ← Phase 8
│   ├── literature_review_engine.py     # LiteratureReviewEngine (F4.5) ← Phase 8
│   ├── field_entry_kit.py              # FieldEntryKit (F4.7) ← Phase 8
│   ├── research_risk_analyzer.py       # ResearchRiskAnalyzer (F4.8) ← Phase 8
│   ├── science_journalism.py           # ScienceJournalismLayer (F6.4) ← Phase 8
│   ├── live_mode.py                    # LiveModeManager (F8.1) ← Phase 8
│   ├── interdisciplinary_translation.py # InterdisciplinaryTranslator (F8.3) ← Phase 8
│   └── graph_memory.py                 # GraphMemoryManager (F5.5) ← Phase 8
│
├── nlp_worker/
│   ├── __init__.py                     # Package marker
│   ├── app.py                          # FastAPI NLP microservice
│   ├── requirements.txt                # NLP worker deps (note: diverges from requirements-nlp-worker.txt in Phase 4)
│   ├── Dockerfile                      # NLP worker Docker build
│   └── README.md                       # HuggingFace Spaces deployment guide
│
├── static/
│   ├── css/
│   │   ├── style.css                   # Stub Phase 1; real implementation Phase 3 (see CONFLICT-001)
│   │   ├── graph.css                   # Graph container, tooltip, node/edge styles ← Phase 3
│   │   ├── panels.css                  # Right panel, bottom bar, leaderboard ← Phase 3
│   │   ├── loading.css                 # Loading screen, progress bar, skeleton ← Phase 3
│   │   └── auth.css                    # Auth page styles ← Phase 6
│   ├── js/
│   │   ├── api.js                      # PaperSearch with debounce + disambiguation ← Phase 3
│   │   ├── graph.js                    # ArivuGraph D3.js class ← Phase 3, Phase 4/5/7/8 upgrades
│   │   ├── pruning.js                  # PruningSystem: cascading BFS animation ← Phase 3
│   │   ├── panels.js                   # RightPanel: DNA donut, diversity radar ← Phase 3
│   │   ├── loader.js                   # GraphLoader: SSE client ← Phase 3
│   │   ├── landing-demo.js             # Stub Phase 1 (see CONFLICT-002 for naming vs index.js)
│   │   ├── tooltip.js                  # TooltipSystem: edge hover ← Phase 3
│   │   ├── semantic-zoom.js            # SemanticZoomRenderer: cluster bubbles ← Phase 4
│   │   ├── leaderboard.js              # Impact Leaderboard sidebar ← Phase 3
│   │   ├── orphans.js                  # Orphan ideas sidebar + sparklines ← Phase 3
│   │   ├── chat.js                     # ChatGuide panel ← Phase 3
│   │   ├── insight-feed.js             # Insight Feed (stub Phase 3, real Phase 7) ← Phase 7
│   │   ├── accessibility.js            # Table view, keyboard nav ← Phase 3
│   │   ├── export-panel.js             # ExportPanel client ← Phase 5
│   │   ├── account.js                  # Account settings page ← Phase 6
│   │   ├── time-machine.js             # TimeMachineController (replaces timeline.js stub) ← Phase 7
│   │   ├── constellation.js            # ConstellationView (replaces stub) ← Phase 7
│   │   ├── geological.js               # GeologicalView ← Phase 7
│   │   ├── river-view.js               # RiverView ← Phase 7
│   │   ├── view-switcher.js            # ViewSwitcher ← Phase 7
│   │   ├── persona.js                  # PersonaPanel ← Phase 7
│   │   ├── workflow.js                 # WorkflowPanel ← Phase 7
│   │   ├── citation-gen.js             # CitationGenerator frontend ← Phase 7
│   │   ├── confidence-layer.js         # ConfidenceLayer: badges + evidence trail ← Phase 8
│   │   ├── disagreement-flag.js        # DisagreementFlag: per-edge/insight UI ← Phase 8
│   │   ├── graph-memory.js             # GraphMemory: seen/unseen state ← Phase 8
│   │   ├── live-mode.js                # LiveModePanel ← Phase 8
│   │   ├── researcher-profile.js       # ResearcherProfileView thin shim ← Phase 8
│   │   └── journalism.js               # JournalismLayerPanel thin shim ← Phase 8
│   └── assets/
│       ├── favicon.svg
│       └── og-image.png               # 1×1 placeholder until Phase 5 (1200×630 polished)
│
├── templates/
│   ├── base.html                       # Base template: fonts, CSP, shared CSS/JS ← Phase 3
│   ├── index.html                      # Landing page: demo graph + search ← Phase 3
│   ├── tool.html                       # Main tool: 3-panel layout ← Phase 3
│   ├── explore.html                    # Gallery: 7 precomputed paper cards ← Phase 3
│   ├── shared_graph.html               # Read-only shared graph view ← Phase 7
│   ├── supervisor.html                 # Supervisor dashboard ← Phase 7
│   ├── api_docs.html                   # Public API documentation ← Phase 7
│   ├── researcher.html                 # Researcher profile page ← Phase 8
│   ├── journalism.html                 # Science journalism layer ← Phase 8
│   └── auth/                          # Auth templates subdirectory ← Phase 6
│       ├── login.html
│       ├── register.html
│       ├── verify_email.html
│       ├── forgot_password.html
│       └── reset_password.html
│   (Phase 6 also adds: templates/pricing.html, templates/account.html, templates/privacy.html)
│
├── scripts/
│   ├── __init__.py                     # Package marker
│   ├── migrate.py                      # Phase 1 baseline migration — 17 tables; Phase 3 adds ALTER TABLE additions
│   ├── migrate_phase6.py               # Phase 6 DB additions ← Phase 6
│   ├── migrate_phase7.py               # Phase 7 DB additions ← Phase 7
│   ├── migrate_phase8.py               # Phase 8 DB additions ← Phase 8
│   ├── precompute_gallery.py           # Build 7 gallery graphs + R2 upload (stub Phase 1, real Phase 3, replaced Phase 8)
│   ├── load_retraction_watch.py        # Import retraction CSV (stub Phase 1, real Phase 5, replaced Phase 8)
│   ├── benchmark_nlp.py                # NLP throughput benchmark (stub Phase 1, real Phase 8)
│   ├── test_pipeline.py                # End-to-end integration test ← Phase 2
│   ├── ground_truth_eval.py            # NLP eval against labeled pairs (stub Phase 1, real Phase 5, replaced Phase 8)
│   ├── verify_deployment.py            # Production smoke test ← Phase 4
│   ├── nightly_maintenance.py          # Koyeb cron: session cleanup, tier resets ← Phase 6
│   ├── weekly_digest.py                # Supervisor dashboard weekly digest ← Phase 7
│   ├── live_monitor_cron.py            # Nightly new-paper polling for live mode ← Phase 8
│   └── generate_og_image.py            # Run-once OG image generator ← Phase 5
│
├── data/
│   ├── gallery_index.json              # Gallery manifest — at data/ root (NOT data/precomputed/)
│   ├── precomputed/                    # Individual precomputed graph JSONs
│   │   └── (slug).json per gallery paper
│   ├── ground_truth/                   # ← Phase 5
│   │   ├── pairs.json                  # Labeled paper pairs for NLP eval
│   │   └── .gitkeep
│   ├── .gitkeep
│   └── retraction_watch.csv            # Empty placeholder; large file, gitignored; populated by load script
│
└── tests/
    ├── __init__.py
    ├── test_smoke.py                   # Phase 1: /health + DB connectivity (3 tests)
    ├── test_phase2.py                  # Phase 2: normalizer, deduplicator, rate limiter, R2 no-op
    ├── test_phase3.py                  # Phase 3: full-text, DNA, diversity, pruning, LLM
    ├── test_phase4.py                  # Phase 4: deployment validation, semantic zoom
    ├── test_phase5.py                  # Phase 5: exports, living paper, originality, paradigm
    ├── test_phase6.py                  # Phase 6: auth, billing, GDPR, feature gating
    ├── test_phase7.py                  # Phase 7: Time Machine, API, webhooks
    └── test_phase8.py                  # Phase 8: confidence layer, live mode, researcher profiles
```

### 7.1 Pre-logged File Naming Conflicts — Ask Before Resolving

**CONFLICT-001 — CSS main file:**
Phase 1 creates `static/css/style.css` as a stub. Phase 3 references both `style.css` (in Phase 8 modified list) and `main.css` (in Phase 3 new files list). It is unclear if Phase 3 creates a separate `main.css` or populates `style.css`. Log to CRITIQUE_LOG on Phase 3 start and ask the user.

**CONFLICT-002 — Landing demo JS:**
Phase 1 creates `static/js/landing-demo.js` as a stub. Phase 3 creates `static/js/index.js` as the demo state machine. Unclear if `landing-demo.js` is renamed to `index.js` or both coexist. Log to CRITIQUE_LOG on Phase 3 start and ask.

**CONFLICT-010 — security.py vs secure_upload.py:**
Phase 1 creates `backend/security.py` (stub, SecureFileUploadHandler). Phase 7 creates `backend/secure_upload.py` (also SecureFileUploadHandler, real implementation). Both have the same class name. This needs resolution in Phase 7 before implementing either. Log and ask.

---

## PART 8 — DATA MODELS

All models live in `backend/models.py`. Never redefine them elsewhere. Never duplicate them in `app.py` or route handlers.

### 8.1 Paper Dataclass

```python
from dataclasses import dataclass, field
from typing import Optional

@dataclass
class Paper:
    paper_id: str                # 40-char S2 corpus ID — canonical PK everywhere
    title: str
    abstract: Optional[str] = None
    year: Optional[int] = None
    citation_count: int = 0
    fields_of_study: list[str] = field(default_factory=list)
    authors: list[str] = field(default_factory=list)
    doi: Optional[str] = None
    url: str = ""
    text_tier: int = 4           # 1=full text+methods, 2=intro, 3=abstract, 4=title only
    is_retracted: bool = False
    language: str = "en"
    canonical_id: Optional[str] = None
    source_ids: dict = field(default_factory=dict)
    venue: Optional[str] = None

    @classmethod
    def from_db_row(cls, row: dict) -> "Paper":
        return cls(
            paper_id=row["paper_id"],
            title=row["title"],
            abstract=row.get("abstract"),
            year=row.get("year"),
            citation_count=row.get("citation_count", 0),
            fields_of_study=row.get("fields_of_study") or [],
            authors=row.get("authors") or [],
            doi=row.get("doi"),
            url=row.get("url") or "",
            text_tier=row.get("text_tier", 4),
            is_retracted=row.get("is_retracted", False),
            language=row.get("language", "en"),
            canonical_id=row.get("canonical_id"),
            source_ids=row.get("source_ids") or {},
            venue=row.get("venue"),
        )
```

### 8.2 EdgeAnalysis Dataclass

```python
@dataclass
class EdgeAnalysis:
    edge_id: str                 # ALWAYS: f"{citing_paper_id}:{cited_paper_id}"
    citing_paper_id: str
    cited_paper_id: str
    similarity_score: float
    citing_sentence: Optional[str]
    cited_sentence: Optional[str]
    citing_text_source: str      # "methods" | "abstract" | "none"
    cited_text_source: str
    comparable: bool
    mutation_type: str           # one of MUTATION_TYPES
    mutation_confidence: float   # 0.0–1.0
    mutation_evidence: str
    citation_intent: str         # one of CITATION_INTENTS
    base_confidence: float       # raw confidence before structural validation
    signals_used: list[str]
    llm_classified: bool
    flagged_by_users: int = 0
    model_version: str = "1.0.0"

    @property
    def confidence_tier(self) -> str:
        """Always use this derived property — never expose raw float."""
        return get_confidence_tier(self.mutation_confidence)
```

### 8.3 Constants

```python
MUTATION_TYPES = (
    "adoption", "generalization", "specialization", "hybridization",
    "contradiction", "revival", "incidental",
)

CITATION_INTENTS = (
    "methodological_adoption", "theoretical_foundation", "empirical_baseline",
    "conceptual_inspiration", "direct_contradiction", "incidental_mention", "negative_citation",
)

CONFIDENCE_TIERS = ("HIGH", "MEDIUM", "LOW", "SPECULATIVE")

def get_confidence_tier(confidence: float) -> str:
    """confidence_tier is ALWAYS a string. Never an integer."""
    if confidence >= 0.75: return "HIGH"
    elif confidence >= 0.55: return "MEDIUM"
    elif confidence >= 0.35: return "LOW"
    else: return "SPECULATIVE"
```

---

## PART 9 — CONFIG CLASS

The complete `Config` class interface. All attributes are set in `__init__`. Import as `from backend.config import config` (module-level singleton). Never call `os.environ` directly outside this module.

```python
class Config:
    # Flask
    SECRET_KEY: str          # required — FLASK_SECRET_KEY
    DEBUG: bool              # FLASK_DEBUG, default False
    ENV: str                 # FLASK_ENV, default "production"

    # Database
    DATABASE_URL: str        # required — DATABASE_URL
    DB_POOL_MIN: int         # DB_POOL_MIN, default 2
    DB_POOL_MAX: int         # DB_POOL_MAX, default 8 (Phase 1-3) → set to 4 in Phase 4

    # External APIs
    S2_API_KEY: str          # optional
    OPENALEX_EMAIL: str      # optional — enables polite pool (10 req/s)
    GROQ_API_KEY: str        # optional — if unset, Stage 2 LLM skipped
    CORE_API_KEY: str        # optional
    PUBPEER_API_KEY: str     # optional
    CROSSREF_MAILTO: str     # optional

    # Groq models
    GROQ_FAST_MODEL: str     # default "llama-3.1-8b-instant"
    GROQ_SMART_MODEL: str    # default "llama-3.3-70b-versatile"

    # Cloudflare R2
    R2_ACCOUNT_ID: str       # optional — R2 disabled if missing
    R2_ACCESS_KEY_ID: str
    R2_SECRET_ACCESS_KEY: str
    R2_BUCKET_NAME: str      # default "arivu-graphs"
    R2_ENDPOINT_URL: str     # optional

    # NLP Worker
    NLP_WORKER_URL: str      # default "http://localhost:7860"
    NLP_WORKER_SECRET: str   # optional — auth disabled if empty
    NLP_WORKER_TIMEOUT: int  # default 30 — SET TO 90 IN .env (CPU inference takes 60-90s)

    # NLP Pipeline Tuning
    NLP_SIMILARITY_THRESHOLD: float  # default 0.25 — edges below this → auto "incidental"
    NLP_BATCH_SIZE: int              # default 5 — edges per Groq call in Stage 2
    
    # Graph Building
    MAX_GRAPH_DEPTH: int     # default 2 (adaptive: 3 for pre-2000 papers or deep_ancestry goal)
    MAX_REFS_PER_PAPER: int  # default 50 — top N refs by relevance score
    MAX_GRAPH_SIZE: int      # default 600 — hard node cap
    GRAPH_CACHE_TTL_DAYS: int # default 7

    # Auth (Phase 6+)
    HCAPTCHA_SITE_KEY: str
    HCAPTCHA_SECRET_KEY: str
    ENABLE_AUTH: bool        # default False — when False, all auth decorators pass through

    # Email (Phase 6+)
    RESEND_API_KEY: str
    EMAIL_FROM: str          # e.g. "noreply@arivu.app"
    EMAIL_FROM_NAME: str     # e.g. "Arivu"

    # Payments (Phase 6+)
    STRIPE_SECRET_KEY: str
    STRIPE_PUBLISHABLE_KEY: str
    STRIPE_WEBHOOK_SECRET: str
    STRIPE_RESEARCHER_PRICE_ID: str
    STRIPE_LAB_PRICE_ID: str

    # Monitoring (Phase 4+)
    SENTRY_DSN: str

    # Translation
    LIBRETRANSLATE_URL: str  # default "https://libretranslate.com"
    LIBRETRANSLATE_KEY: str

    # Custom domain (Phase 5+)
    CUSTOM_DOMAIN: str       # e.g. "arivu.app"

    # Phase 7+
    STRIPE_DEVELOPER_PRICE_ID: str
    WEBHOOK_SIGNING_SECRET: str  # Global fallback HMAC secret for webhook subscriptions
    API_BASE_URL: str            # e.g. "https://arivu.app"
    MAX_UPLOAD_MB: int           # default 10 — PDF upload size limit

    # Phase 8+
    RETRACTION_WATCH_CSV_URL: str  # URL to download Retraction Watch CSV
    LIVE_MODE_ENABLED: bool        # default False

    # Derived feature flags (read-only properties)
    @property
    def GROQ_ENABLED(self) -> bool: ...
    @property
    def R2_ENABLED(self) -> bool: ...
    @property
    def NLP_WORKER_ENABLED(self) -> bool: ...
    # Phase 6+:
    @classmethod
    def stripe_enabled(cls) -> bool: ...
    @classmethod
    def email_enabled(cls) -> bool: ...
```

**Critical config notes:**
- `NLP_SIMILARITY_THRESHOLD` default is **0.25** (not 0.35). The 0.35 figure in implementation rules refers to the confidence tier boundary, not the threshold.
- `NLP_WORKER_TIMEOUT` default is 30s but must be set to **90** in `.env` — CPU inference on HuggingFace free tier takes 60–90s.
- `ENABLE_AUTH=false` in `.env` makes all `@require_auth`, `@require_tier`, `@check_graph_limit` decorators pass through unconditionally — essential for local dev without a full auth stack.
- `STRIPE_ENABLED` and `EMAIL_ENABLED` are **lowercase classmethods** called as `Config.stripe_enabled()` — not class attributes. This avoids the truthy-method bug (method objects are always truthy without `()`).

---

## PART 10 — DATABASE SCHEMA REFERENCE

Phase 1 creates the 17 baseline tables. Later phases add tables and columns via migration scripts. Never modify schema by hand.

**Baseline tables (Phase 1 `migrate.py`):**

| Table | Purpose | Key notes |
|---|---|---|
| `papers` | Canonical paper record | Has `pubpeer_flags JSONB` from Phase 1 |
| `paper_embeddings` | pgvector 384-dim | IVFFlat index, cosine ops |
| `edge_analysis` | NLP pipeline cache | NOT `edge_analysis_cache`; has `citation_intent TEXT` column |
| `graphs` | Graph metadata | `last_accessed` for TTL (not `created_at`); `computed_at` for recency queries |
| `build_jobs` | SSE job tracking | |
| `job_events` | One row per SSE event | `id` = PK, `sequence` = ordering. Both columns exist and both matter. |
| `sessions` | Anonymous + auth sessions | Has `persona TEXT DEFAULT 'explorer'`, `graph_memory JSONB` |
| `session_graphs` | Session-to-graph map | |
| `users` | Auth accounts (stub in P1, active P6) | Phase 6 adds `failed_login_count`, `locked_until` via `ADD COLUMN IF NOT EXISTS` |
| `action_log` | Per-session behavior | |
| `edge_feedback` | User disagreements | NOT `edge_flags` |
| `llm_cache` | Groq response cache | SHA256 key, 30-day TTL |
| `genealogy_cache` | Genealogy story cache | |
| `retraction_watch` | Retraction Watch data | NOT `retractions` |
| `chat_history` | AI guide conversation | Server-side only — never from client payload |
| `insight_cache` | Per-paper insights | |
| `background_jobs` | Async GDPR tasks | |

**Phase 3 schema additions (via ALTER on `migrate.py`):**
Adds `leaderboard_json`, `dna_json`, `diversity_json`, `computed_at` to `graphs`. Creates `insight_feedback` table.

**Phase 6 adds (via `migrate_phase6.py`):**
`email_verification_tokens`, `password_reset_tokens`, `lab_memberships`, `api_keys`, `graph_memory`, `consent_log` (verify this table is actually in the DDL — see CONFLICT-011 in Part 22).

**Phase 7 adds (via `migrate_phase7.py`):**
`shared_graphs`, `vocabulary_snapshots`, `time_machine_cache`, `counterfactual_cache`, `adversarial_reviews`, `lab_invites`. Column additions to `sessions` (`persona_mode`) and `users` (`default_persona`). Also adds `publication_date DATE` to `papers`.

**Phase 8 adds (via `migrate_phase8.py`):**
`graph_memory_state` (replaces `graph_memory` → renamed to `graph_memory_legacy`), `live_subscriptions`, `researcher_profiles`, `confidence_overrides`, `literature_review_jobs`. Adds `graph_id TEXT` to `graphs`, `pubpeer_url TEXT` to `papers`, `error_message` to relevant tables.

**Schema rules:**
- `confidence_tier` is always a `TEXT` string — never an integer
- `edge_id` is always `f"{citing_paper_id}:{cited_paper_id}"` — no exceptions
- Use `graphs.last_accessed` for TTL eviction, `graphs.computed_at` for recency queries
- `graph_memory` table (Phase 6) is renamed to `graph_memory_legacy` in Phase 8. All Phase 8 code uses `graph_memory_state` only.

---

## PART 11 — ENVIRONMENT VARIABLES

Complete `.env.example` across all phases. Each phase appends its additions. Earlier phase variables are not removed.

```bash
# ── Flask ─────────────────────────────────────────────────────────────────────
FLASK_SECRET_KEY=change-me-random-32-chars
FLASK_ENV=development
FLASK_DEBUG=true

# ── Database ──────────────────────────────────────────────────────────────────
DATABASE_URL=postgresql://arivu:localdev@localhost:5432/arivu
DB_POOL_MIN=2
DB_POOL_MAX=8   # Phase 1-3: 8. Phase 4+: set to 4 (2 workers × 4 = 8 ≤ Neon cap)

# ── External APIs ──────────────────────────────────────────────────────────────
S2_API_KEY=              # free at semanticscholar.org — without it: 1 req/s limit
OPENALEX_EMAIL=you@university.edu
GROQ_API_KEY=gsk_...    # free at console.groq.com — without it: Stage 2 skipped
CORE_API_KEY=
PUBPEER_API_KEY=
CROSSREF_MAILTO=you@university.edu

# ── Graph Building ─────────────────────────────────────────────────────────────
MAX_GRAPH_DEPTH=2
MAX_REFS_PER_PAPER=50
MAX_GRAPH_SIZE=600
GRAPH_CACHE_TTL_DAYS=7

# ── NLP Pipeline ──────────────────────────────────────────────────────────────
NLP_SIMILARITY_THRESHOLD=0.25  # edges below this → auto "incidental", no Groq call
NLP_BATCH_SIZE=5               # edges per Groq call in Stage 2
NLP_WORKER_URL=http://localhost:7860
NLP_WORKER_SECRET=change-me-random-32-chars
NLP_WORKER_TIMEOUT=90          # MUST be 90+ — CPU inference takes 60-90s on HF free tier

# ── Cloudflare R2 ─────────────────────────────────────────────────────────────
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=arivu-graphs
R2_ENDPOINT_URL=https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com

# ── Auth / hCaptcha (Phase 6+) ────────────────────────────────────────────────
ENABLE_AUTH=false
HCAPTCHA_SITE_KEY=10000000-ffff-ffff-ffff-000000000001
HCAPTCHA_SECRET_KEY=0x0000000000000000000000000000000000000000

# ── Email / Resend (Phase 6+) ─────────────────────────────────────────────────
RESEND_API_KEY=re_...
EMAIL_FROM=noreply@arivu.app
EMAIL_FROM_NAME=Arivu

# ── Payments / Stripe (Phase 6+) ──────────────────────────────────────────────
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_RESEARCHER_PRICE_ID=price_...
STRIPE_LAB_PRICE_ID=price_...

# ── Custom Domain (Phase 5+) ──────────────────────────────────────────────────
CUSTOM_DOMAIN=arivu.app

# ── Monitoring (Phase 4+) ─────────────────────────────────────────────────────
SENTRY_DSN=

# ── Translation ───────────────────────────────────────────────────────────────
LIBRETRANSLATE_URL=https://libretranslate.com
LIBRETRANSLATE_KEY=

# ── Developer Tier / Webhooks (Phase 7+) ──────────────────────────────────────
STRIPE_DEVELOPER_PRICE_ID=price_...
WEBHOOK_SIGNING_SECRET=
API_BASE_URL=https://arivu.app
MAX_UPLOAD_MB=10

# ── Retraction Watch / Live Mode (Phase 8+) ───────────────────────────────────
RETRACTION_WATCH_CSV_URL=   # Register at retractionwatch.com to get the URL
LIVE_MODE_ENABLED=false
```

---

## PART 12 — DEPENDENCIES

Dependencies are pinned. Never change version numbers without logging the change in `DECISIONS.md`.

### `requirements.txt` — Phase 1 baseline (complete list)

```
flask==3.0.3
flask-cors==4.0.1
gunicorn==22.0.0
psycopg2-binary==2.9.9
pgvector==0.2.5
requests==2.32.3
httpx==0.27.0
aiohttp==3.9.5
networkx==3.3
pydantic[email]==2.7.1
numpy==1.26.4
scikit-learn==1.4.2
PyMuPDF==1.24.3
python-magic==0.4.27
langdetect==1.0.9
groq==0.8.0
boto3==1.34.101
bcrypt==4.1.2
python-docx==1.1.2
reportlab==4.2.0
stripe==9.9.0
resend==0.7.2
sentry-sdk[flask]==2.3.1
structlog==24.1.0
python-dotenv==1.0.1
python-dateutil==2.9.0
```

**Phase-dependent additions (add in the phase where first needed, do not add early):**
- Phase 3: `scipy` (DNA consensus clustering via `scipy.cluster.hierarchy`)
- Phase 5: `weasyprint==60.2`, `matplotlib==3.8.4`, `Markdown==3.5.2`
- Phase 6: verify `stripe` and `resend` versions match phase file — Phase 6 §0.4 specifies `stripe==8.11.0`, `resend==2.3.0`. This conflicts with the Phase 1 baseline above. See CONFLICT-007 in Part 22.

### `requirements-nlp-worker.txt` — Phase 1–3

```
fastapi==0.111.0
uvicorn==0.29.0
sentence-transformers==2.7.0
torch==2.2.2
numpy==1.26.4
scikit-learn==1.4.2
groq==0.8.0
httpx==0.27.0
pydantic==2.7.1
python-dotenv==1.0.1
```

**Note:** Phase 4 §1.5 specifies `nlp_worker/requirements.txt` with different pinned versions (`fastapi==0.110.0`, `torch==2.2.1`, `scikit-learn==1.4.1`, no `groq`/`httpx`/`python-dotenv`). After Phase 4, these two files diverge. See CONFLICT-005 in Part 22.

### `requirements-dev.txt`

```
pytest==8.2.0
pytest-asyncio==0.23.6
black==24.4.2
flake8==7.0.0
mypy==1.9.0
```

---

## PART 13 — KEY IMPLEMENTATION RULES

### Reference Selection

```python
relevance_score = (semantic_similarity * 0.65) + (normalized_citation_count * 0.35)
```
Top `config.MAX_REFS_PER_PAPER` (default 50) references per paper by this score.

In Phase 2, semantic similarity is approximated via title word overlap (no NLP worker call during BFS). Phase 3 upgrades to real embedding-based similarity.

### BFS Depth — Adaptive, Not Fixed

BFS depth is determined by `determine_crawl_depth()`:
- Default: `2`
- Papers published before 2000: `3`
- `user_goal="deep_ancestry"`: `min(base + 1, 3)`
- `user_goal="quick_overview"`: `min(base, 2)`
- Absolute cap: `3`. Never goes above 3.
- Total node cap: `config.MAX_GRAPH_SIZE` (default 600)

Do not implement a fixed depth-2 cap. The function must be adaptive.

### NLP Three-Stage Pipeline

**Stage 1 — Similarity:** Call `/similarity_matrix` on NLP worker. Up to 50 sentences per paper (server-side cap enforced by worker). Returns best-matching sentence pair + cosine similarity.

**Stage 2 — LLM Classification:** Only for edges with `similarity_score > config.NLP_SIMILARITY_THRESHOLD` (default 0.25). Batched at exactly `config.NLP_BATCH_SIZE` (default 5) edges per Groq call, anchored by `edge_id`. Uses `config.GROQ_FAST_MODEL`.

**Stage 3 — Structural Validation:** Cross-reference LLM output against PageRank-based structural importance. `pagerank_scores = nx.pagerank(graph, alpha=0.85)` — computed **once per graph build**, not per edge.

Edges below threshold → automatic `mutation_type="incidental"`, `citation_intent="incidental_mention"`, `llm_classified=False`. No Groq call.

### `graph_id` — Canonical Definition (from Phase 2)

The `graph_id` is generated during graph build and embedded in graph JSON metadata from Phase 2 onward. The Phase 2 integration test checks for it.

```python
def _compute_graph_id(self, seed_paper_id: str, session_id: str) -> str:
    import hashlib
    raw = f"{seed_paper_id}_{session_id}"
    return hashlib.sha256(raw.encode()).hexdigest()[:32]
```

This is stored in `graphs.graph_id TEXT` (column added by Phase 8 migration, but the metadata field exists from Phase 2). Phase 8 §0.8 formalizes and wires it — it does not introduce it.

### DNA Clustering Algorithm

`stable_dna_clustering()` in `dna_profiler.py` uses:
- **Allowed linkage methods:** `"average"` and `"complete"` only
- **Forbidden linkage:** `"ward"` — incompatible with cosine metric
- **Algorithm:** Consensus clustering over `["average", "complete"]` × `[0.40, 0.45, 0.50, 0.55, 0.60]` thresholds, building a co-occurrence matrix, then final clustering with cityblock distance on co-occurrence

### Export Formats — Exact 8 Names

```python
ExportGenerator.EXPORT_TYPES = [
    "graph-json", "graph-csv", "bibtex", "literature-review",
    "genealogy-pdf", "action-log", "graph-png", "graph-svg",
]
```

Note: `graph-csv` produces a ZIP of two CSVs (nodes.csv + edges.csv), not a flat CSV. The `ExportRequest` Pydantic schema in `schemas.py` has a different format validation pattern — see CONFLICT-012 in Part 22.

### Graph JSON Format — Key Requirements

`AncestryGraph.export_to_json()` must produce:

```json
{
  "nodes": [...],
  "edges": [...],
  "metadata": {
    "graph_id": "...",
    "seed_paper_id": "...",
    "seed_paper_title": "...",
    "total_nodes": 152,
    "total_edges": 203,
    "model_version": "1.0.0",
    "build_timestamp": 1234567890
  },
  "precomputed_pruning": {
    "{seed_paper_id}": {
      "collapsed_nodes": [{"paper_id": "...", "bfs_level": 1}, ...],
      "surviving_nodes": [{"paper_id": "...", "survival_path": ["...", "..."]}, ...],
      "impact_percentage": 31.0,
      "collapsed_count": 47
    }
  }
}
```

All six metadata fields (`graph_id`, `seed_paper_id`, `seed_paper_title`, `total_nodes`, `total_edges`, `model_version`) are checked in the Phase 2 integration test. Missing any will cause test failure.

### SSE Progress Streaming

- Route: `GET /api/graph/stream` (GET, not POST)
- Build progress inserted into `job_events`. SSE route polls this table.
- Client reconnection: send `Last-Event-ID` header → server replays from that `id` onward
- `job_events.id` = primary key. `job_events.sequence` = ordering. Both columns exist.
- 5-minute build timeout. SSE cleanup on `GeneratorExit` (client disconnect).

### Chat History Security

`/api/chat` loads conversation history from `chat_history` DB table (keyed by `session_id`). It **never** accepts a `messages` array from the client payload. This prevents history injection attacks.

### No Cycles in Citation Graph

After BFS crawl: `nx.simple_cycles()` → remove cycle-closing edges → log every removal. The graph must be a DAG.

### Stripe Webhook Security

In the Stripe webhook route, always use `request.data` (raw bytes) for signature verification — never `request.json`. Using `request.json` consumes the request body before Stripe's signature check, causing permanent 400 failures.

### Logging Standard

Always use `structlog` for structured logging. Never use bare `print()`. Never use `logging.basicConfig()` at module level — configure logging inside `create_app()` only.

```python
import logging
logger = logging.getLogger(__name__)
# then: logger.info("..."), logger.warning("..."), logger.error("...")
```

### PyMuPDF Import Name

```python
import fitz   # correct
# NEVER:
import pymupdf  # wrong — causes ImportError on some versions
```

### `await_sync` Pattern

Flask routes are synchronous. Graph building is async. The bridge is `await_sync()` from `backend/utils.py`. Always use it — never call `asyncio.run()` directly inside a route handler.

```python
from backend.utils import await_sync
# In a Flask route:
result = await_sync(some_async_function(args))
```

### `execute_returning` for INSERT...RETURNING

`backend/db.py` provides six helpers: `fetchone`, `fetchall`, `execute`, `execute_returning`, `executemany`, `paginate`. Use `execute_returning` for `INSERT ... RETURNING` patterns — never two separate round-trips.

---

## PART 14 — DESIGN SYSTEM

### Color Palette (CSS variables in the main CSS file)

```css
:root {
  --bg-primary:    #0a0e17;
  --bg-surface:    #1E293B;
  --bg-elevated:   #263548;
  --accent-gold:   #D4A843;
  --accent-blue:   #3B82F6;
  --accent-teal:   #06B6D4;
  --text-primary:  #E2E8F0;
  --text-secondary:#94A3B8;
  --text-muted:    #64748B;
  --success:       #22C55E;
  --danger:        #EF4444;
  --warning:       #F59E0B;
  --info:          #60A5FA;
  --conf-high:     #22C55E;
  --conf-medium:   #3B82F6;
  --conf-low:      #F59E0B;
  --conf-specul:   #9333EA;
  --field-cs:      #648FFF;
  --field-bio:     #785EF0;
  --field-physics: #DC267F;
  --field-chem:    #FE6100;
  --field-econ:    #FFB000;
  --field-math:    #009E73;
  --field-other:   #56B4E9;
}
```

### Typography

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
body { font-family: 'Inter', sans-serif; font-size: 16px; }
.mono, code, .paper-id { font-family: 'JetBrains Mono', monospace; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

### Tool Page Layout (CSS Grid)

```css
.tool-layout {
  display: grid;
  grid-template-rows: 56px 1fr 240px;
  grid-template-columns: 1fr 380px;
  grid-template-areas: "header header" "graph right" "bottom bottom";
  height: 100vh;
  overflow: hidden;
}
```

### Accessibility

Every graph view must have a parallel accessible table view. Node colors also use distinct SVG shapes: CS=circle, Biology=triangle, Physics=square, Chemistry=diamond, Math=circle+dashed, Economics=pentagon. Information is never conveyed by color alone.

---

## PART 15 — GALLERY PAPERS

Exactly **7 papers**. These are Semantic Scholar corpus IDs — do not abbreviate, fabricate, or guess them.

| Paper | S2 ID | Slug |
|---|---|---|
| Attention Is All You Need (Vaswani 2017) | `204e3073870fae3d05bcbc2f6a8e263d9b72e776` | `attention` |
| AlexNet (Krizhevsky 2012) | `abd1c342495432171beb7ca8fd9551ef13cbd0ff` | `alexnet` |
| BERT (Devlin 2018) | `df2b0e26d0599ce3e70df8a9da02e51594e0e992` | `bert` |
| GANs (Goodfellow 2014) | `54e325aee6b2d476bbbb88615ac15e251c6e8214` | `gans` |
| Word2Vec (Mikolov 2013) | `330da625c15427c6e42ccfa3b747fb29e5835bf0` | `word2vec` |
| ResNet (He 2016) | `2c03df8b48bf3fa39054345bafabfeff15bfd11d` | `resnet` |
| GPT-2 (Radford 2019) | `9405cc0d6169988371b2755e573cc28650d14dfe` | `gpt2` |

The Vaswani "Attention" paper is the landing page demo. Its graph must be precomputed with `precomputed_pruning` embedded. The demo state machine: `IDLE → HIGHLIGHTING → WAITING → PRUNING → COMPLETE ↘ SKIPPED`.

---

## PART 16 — SCOPE PER PHASE

| Phase | In Scope | Explicitly Out |
|---|---|---|
| 1 | Skeleton only. `/health` route. 17 DB tables. Smoke tests. | All business logic. |
| 2 | Data layer. NLP worker. Graph builds. SSE streaming. | Frontend, pruning, DNA, auth. |
| 3 | Full-text pipeline. All intelligence modules. Complete frontend. | Auth, export, billing, Time Machine. |
| 4 | Deployment. Production hardening. Gallery launch. SemanticZoom. | Auth, Stripe. |
| 5 | Export system. Living paper scorer. Originality. Paradigm. Custom domain. | Auth, billing, Time Machine. |
| 6 | Auth. Stripe billing. GDPR. 4 intelligence modules. | Time Machine, public API, Supervisor Dashboard. |
| 7 | Time Machine. Visualization modes. Writing tools. Public REST API. Lab collaboration. | Collaborative annotation (community), Prediction Market. |
| 8 | Remaining intelligence features. Trust layer. Researcher profiles. Live Mode. v1.0 tag. | Post-v1 features below. |

**Permanently post-v1 (not in any phase):**
Prediction Market, Mental Model Mapper, Community-wide Collaborative Annotation, Lab Genealogy System, Conference Intelligence Layer (F11.10), 3D WebGL visualization upgrades.

**Phase-to-module attribution corrections (Phase 1 stub table had errors):**
- `dna_profiler.py` — Phase 3 (Phase 1 said Phase 4)
- `diversity_scorer.py` — Phase 3 (Phase 1 said Phase 4)
- `orphan_detector.py` — Phase 3 (Phase 1 said Phase 4)
- `quality_monitor.py` — Phase 4 (Phase 1 said Phase 6)
- `precompute_gallery.py` — Phase 3 (Phase 1 said Phase 5)
- `load_retraction_watch.py` — Phase 5 (Phase 1 said Phase 2)

---

## PART 17 — TRACKING FILES PROTOCOL

### `CONTEXT.md` — Update Every Session End

```markdown
# Arivu — Active Context

## Current Phase
Phase N — [Phase Title]

## Phases
### Completed
- [x] Phase 1 — skeleton, schema, smoke tests
### In Progress
- [ ] Phase N — [specific subpart being worked on]
### Not Started
- Phase N+1 through 8

## Live Deployment (Phase 4+)
| Service | URL |
|---------|-----|
| Backend (Koyeb) | https://... |
| NLP Worker (HF) | https://... |

## Architecture Notes
- DB pool: N workers × DB_POOL_MAX=X = Y connections (Neon free cap = 10)

## Last Session Summary
[One paragraph: what was done, what is in progress, any decisions made, any open critiques]

## Known Issues / Blockers
- [list any open CRITIQUE_LOG entries that are blockers]
```

### `DECISIONS.md` — Consult Before Any Architecture Decision

Check before any decision about: schema changes, new API endpoints, new module dependencies, naming choices affecting multiple files, or any choice that could impact a later phase.

Format:
```markdown
## ADR-XXX: [Short title]
**Date:** YYYY-MM-DD
**Context:** Why was this decision needed?
**Decision:** What was decided?
**Alternatives considered:** What else was evaluated?
**Rationale:** Why this option?
**Implications:** What does this lock in or rule out?
```

### `CRITIQUE_LOG.md` — See Part 4

Append-only. Every conflict, hallucination catch, scope question, and critique. Format defined in Part 4.1.

---

## PART 18 — EXCEPTION CLASSES

Defined in `exceptions.py`. All exceptions inherit from `ArivuError` (not `ArivuBaseError` — that name was used in an earlier draft and is wrong). The `register_error_handlers(app)` function must be called inside `create_app()`.

**Complete hierarchy (16 classes + 1 registration function):**

```python
class ArivuError(Exception):
    """Base. Carries HTTP status, error code, details dict, and to_dict()."""
    def __init__(self, message, code="INTERNAL_ERROR", status_code=500, details=None): ...
    def to_dict(self) -> dict: ...

class PaperNotFoundError(ArivuError):        # 404
class PaperResolutionError(ArivuError):      # 503
class NoAbstractError(ArivuError):           # 422
class GraphBuildError(ArivuError):           # 500
class GraphTooLargeError(ArivuError):        # 422
class EmptyGraphError(ArivuError):           # 422
class NLPWorkerError(ArivuError):            # 503
class NLPTimeoutError(NLPWorkerError):       # 503 (inherits NLPWorkerError)
class AuthenticationError(ArivuError):       # 401
class AuthorizationError(ArivuError):        # 403
class GraphLimitReachedError(ArivuError):    # 429
class RateLimitError(ArivuError):            # 429
class ExternalAPIError(ArivuError):          # 502
class ExternalAPIRateLimitError(ExternalAPIError):  # 502
class StorageError(ArivuError):              # 500
class ValidationError(ArivuError):           # 400

def register_error_handlers(app): ...
```

Phase 2 imports `NLPTimeoutError`, `EmptyGraphError`, `GraphTooLargeError`, and `StorageError`. These must exist from Phase 1.

---

## PART 19 — PYDANTIC SCHEMAS

Defined in `backend/schemas.py`. These are the validation models for API endpoints. Import from here — never redefine inline in routes.

```python
# SearchRequest: query str, min_length=3, max_length=500, sanitized
# GraphBuildRequest: paper_id (validated format), max_depth (1-2), max_refs (10-50)
# PruneRequest: paper_ids list[str] (40-char hex), seed_paper_id str
# ChatRequest: message str (1-2000 chars, sanitized). NO messages array accepted from client.
# ExportRequest: format str, seed_paper_id str
# FlagRequest: source_id, target_id, seed_paper_id, reason (max 500 chars)
# HealthResponse: status, db bool, nlp_worker bool, version str
```

**CONFLICT-012 pre-log:** `ExportRequest.format` is validated against `^(json|csv|pdf|markdown)$` in the Phase 1 `schemas.py`. But `ExportGenerator.EXPORT_TYPES` uses hyphenated names (`graph-json`, `graph-csv`, etc.). These patterns do not match. The route must translate or the schema must be updated. Ask the user in Phase 5 before implementing the export route.

---

## PART 20 — UTILS MODULE

`backend/utils.py` defines these six functions. All are used across multiple phases.

| Function | Description | Used By |
|---|---|---|
| `await_sync(coro)` | Run async coroutine from sync Flask route. Handles both running-loop and no-loop cases. Timeout: 120s | `app.py` graph build routes |
| `load_gallery_index()` | Load `data/gallery_index.json`. Returns `[]` if missing. | Gallery routes |
| `load_precomputed_graph(slug)` | Load `data/precomputed/{slug}.json`. Returns `None` if missing. | Gallery routes |
| `log_action(session_id, action_type, action_data)` | Insert to `action_log`. Silently swallows all errors — logging must never break requests. | Throughout |
| `update_graph_memory(session_id, updates)` | Merge updates dict into `sessions.graph_memory` JSONB. | Graph exploration tracking |
| `get_graph_summary_for_chat(graph)` | Compact <1500-token LLM-safe summary. Top 15 papers, 5 bottlenecks, 20 top edges. Used by ChatGuide. | `chat_guide.py` |

`GALLERY_DIR` and `GALLERY_INDEX_PATH` constants — canonical values from Phase 5 §0.3:
```python
GALLERY_DIR        = Path(__file__).parent.parent / "data" / "precomputed"
GALLERY_INDEX_PATH = Path(__file__).parent.parent / "data" / "gallery_index.json"
```

---

## PART 21 — NEVER-DO LIST

These rules apply in every phase, every session, without exception.

**Architecture:**
- Never import `sentence_transformers`, `torch`, or any ML model in `app.py` or any `backend/` file — causes Koyeb OOM
- Never use `sqlite3` anywhere — not for tests, not for anything
- Never use `import pymupdf` — the correct import is `import fitz`
- Never accept a `messages` array from the client in the `/api/chat` route
- Never expose raw stack traces in API responses
- Never call `os.environ` directly outside `backend/config.py`
- Never call `asyncio.run()` inside a Flask route — use `await_sync()` from `backend/utils.py`
- Never load an ML model on the main Flask server — HTTP calls to NLP worker only

**Database:**
- Never use `edge_analysis_cache`, `edge_flags`, or `retractions` as table names
- Never invent a DB column that isn't in the migration SQL
- Never use `created_at` for graph cache freshness — use `last_accessed` for TTL, `computed_at` for recency
- Never use an integer for `confidence_tier` — it is always a string

**NLP Pipeline:**
- Never use `/embed`, `/embeddings`, or `/encode` as endpoint names — it's `/encode_batch`
- Never use `"groq_llm"` as the rate limiter throttle key — it's `"groq"`
- Never use `inheritance_confidence` as a field name — it's `base_confidence`
- Never call `nx.pagerank()` per edge — compute it once per graph, store in a dict, look up per edge
- Never send more than 512 texts in a single `/encode_batch` call (hard server-side limit)

**Git:**
- Never commit `.env`
- Never create branches other than `main`
- Never commit with failing tests

**Dependencies:**
- Never install a library not in `requirements.txt` without flagging it first
- Never add `--break-system-packages` to `requirements.txt` — it's a CLI flag, not a package

**Deployment:**
- Never use `--workers 2` without also setting `DB_POOL_MAX=4` in config — will exceed Neon cap
- Never set `FLASK_DEBUG=true` on Koyeb — disables security headers and exposes debugger
- Never use `request.json` in the Stripe webhook route — always `request.data` (raw bytes)

**Spec Compliance:**
- Never implement a feature from a future phase
- Never silently fix a spec error — log it and ask
- Never make up information not in the spec and proceed as if correct
- Never reference `CLAUDE.md v1`'s "Section 14" for build order — it doesn't exist in v3

---

## PART 22 — PRE-LOGGED CONFLICTS

These are known conflicts discovered during spec analysis. They are pre-logged here to prevent Claude Code from hitting them cold. Each conflict must be resolved with the user before the relevant code is written.

---

**CONFLICT-001** `[PHASE 3]` CSS file naming
- Phase 1 creates `static/css/style.css` stub
- Phase 3 new files list shows `static/css/main.css`; Phase 8 modified list references `style.css`
- **Resolution needed before:** Phase 3 CSS implementation
- **Question:** Does Phase 3 rename style.css → main.css, create a separate main.css, or populate style.css as-is?

---

**CONFLICT-002** `[PHASE 3]` Landing demo JS naming
- Phase 1 creates `static/js/landing-demo.js` stub
- Phase 3 creates `static/js/index.js` as the landing page demo state machine
- **Resolution needed before:** Phase 3 landing demo implementation
- **Question:** Are both files used? Is landing-demo.js renamed to index.js?

---

**CONFLICT-003** `[PHASE 8]` `retractions` vs `retraction_watch` table name
- Phase 8 §0.1 uses `SELECT COUNT(*) FROM retractions` and "Phase 6 defines the `retractions` table schema"
- Part 6.8 and Part 21 of this rulebook prohibit using `retractions` — canonical name is `retraction_watch`
- **Resolution needed before:** Phase 8 §0.1 backport
- **Question:** Is Phase 8 §0.1 a typo, or was the table actually renamed in Phase 6?

---

**CONFLICT-004** `[PHASE 4]` Procfile workers + DB pool must change atomically
- Phase 1 Procfile: `--workers 1`, `DB_POOL_MAX=8`
- Phase 4 Procfile: `--workers 2`, must set `DB_POOL_MAX=4`
- These must change together — changing workers without changing pool exceeds Neon cap
- **Resolution:** Already documented in Part 6.3. Apply as one atomic change in Phase 4 §1.1.

---

**CONFLICT-005** `[PHASE 4]` `nlp_worker/requirements.txt` version divergence
- Phase 1 and `requirements-nlp-worker.txt` specify: `fastapi==0.111.0`, `torch==2.2.2`, `scikit-learn==1.4.2`, includes `groq`, `httpx`, `python-dotenv`
- Phase 4 §1.5 specifies `nlp_worker/requirements.txt` as: `fastapi==0.110.0`, `torch==2.2.1`, `scikit-learn==1.4.1`, no `groq`/`httpx`/`python-dotenv`
- After Phase 4, these two files are intentionally different
- **Resolution needed before:** Phase 4 §1.5. Ask which version set is correct for each file.

---

**CONFLICT-006** `[PHASE 8]` `graph_id` format: prose vs code
- Phase 8 §0.8 prose: `graph_id = f"{seed_paper_id}_{session_id}"`
- Phase 8 §0.8 code: `hashlib.sha256(raw.encode()).hexdigest()[:32]`
- These produce different strings. The code is authoritative.
- **Resolution:** Use the code version (SHA256 truncated to 32 chars). This is pre-resolved; log as RESOLVED.

---

**CONFLICT-007** `[PHASE 6]` Stripe and Resend version mismatch
- Phase 1 requirements.txt baseline: `stripe==9.9.0`, `resend==0.7.2`
- Phase 6 §0.4 specifies: `stripe==8.11.0`, `resend==2.3.0`
- **Resolution needed before:** Phase 6 implementation. Ask which versions are correct.

---

**CONFLICT-008** `[PHASE 6]` bcrypt version mismatch
- Phase 1 baseline: `bcrypt==4.1.2`
- Rulebook v2 said `bcrypt==4.1.3`
- Phase 6 §0.4 says `bcrypt==4.1.2`
- **Resolution:** Use `bcrypt==4.1.2` from Phase 6 spec. This is pre-resolved; log as RESOLVED.

---

**CONFLICT-009** `[PHASE 7/8]` `TIER_ORDER` dictionary contradiction
- Phase 7 §0.1: `{"free": 0, "researcher": 1, "developer": 2, "lab": 3}` — Lab is highest
- Phase 8 §0.7: `{"free": 0, "researcher": 1, "lab": 2, "developer": 2}` — Lab and Developer are equal
- These produce different authorization behavior for Lab users
- **Resolution needed before:** Phase 8 §0.7 implementation. Ask which tier hierarchy is correct.

---

**CONFLICT-010** `[PHASE 1/7]` `security.py` vs `secure_upload.py` — same class name
- Phase 1 creates `backend/security.py` with `SecureFileUploadHandler` (stub)
- Phase 7 creates `backend/secure_upload.py` with `SecureFileUploadHandler` (real implementation)
- Unclear relationship — are they the same file renamed, or two different files with the same class?
- **Resolution needed before:** Phase 7 `secure_upload.py` implementation.

---

**CONFLICT-011** `[PHASE 6]` `consent_log` table listed but may be missing from DDL
- Phase 6 "What Phase 6 Produces" lists `consent_log` as one of 7 new tables
- Verify `consent_log` CREATE TABLE statement exists in `scripts/migrate_phase6.py` before assuming it's created
- **Resolution:** Check the Phase 6 migration SQL. If missing, add the DDL before running migration.

---

**CONFLICT-012** `[PHASE 5]` ExportRequest schema vs ExportGenerator format names
- `schemas.py` `ExportRequest.format` validates against `^(json|csv|pdf|markdown)$`
- `ExportGenerator.EXPORT_TYPES` uses: `"graph-json"`, `"graph-csv"`, `"genealogy-pdf"`, etc. (hyphenated, specific)
- These validation patterns don't match — the route cannot validate and pass format strings simultaneously
- **Resolution needed before:** Phase 5 export route implementation.

---

**CONFLICT-013** `[PHASE 3]` `gap_finder.py` scope confusion
- Phase 1 stub table marks it "OUT OF SCOPE — v1"
- Phase 3 "What NOT To Do" explicitly says: "DO implement `gap_finder.py` GapFinder class as specified in §8 — the complete pgvector-based implementation is required and tested in `tests/test_phase3.py`. An earlier draft of this spec said 'do not implement' — that was incorrect."
- **Resolution:** Phase 3 implements `gap_finder.py` as a real module. This is pre-resolved; log as RESOLVED.

---

## PART 23 — STARTING FRESH

If `CONTEXT.md` does not exist, you are at the very beginning of the project.

1. Read `PHASE_1.md` — the complete file. It is 2,600+ lines.
2. Execute `PHASE_1.md §30 — Exact Build Sequence` step by step. Do not use Part 7 of this file as a build guide — the phase file is authoritative for implementation details.
3. When creating stubs: the Phase 1 stub table has attribution errors for 5 files (see Part 16). Use the corrected phase mapping, not the stub table.
4. Create `DECISIONS.md` in Phase 1 — it is listed as a Phase 1 "real implementation" file. Use the ADR format from Part 17.
5. Create `CRITIQUE_LOG.md` in Phase 1 as an empty file with the header format from Part 4.1.

**Phase 1 is complete when all four are simultaneously true:**
1. `python -m pytest tests/test_smoke.py -v` → **3 passed, 0 failed**
2. `python scripts/migrate.py` → **"Verified 17 required tables exist."**
3. `git log --oneline` shows exactly two commits on `main`: `[init] add Claude Code rulebook` and `[init] project skeleton - health check passing`
4. `CONTEXT.md` shows Phase 1 under "Completed", Phase 2 under "In Progress"

Do not implement any business logic beyond `/health` in Phase 1. Do not proceed to Phase 2 until all four criteria are met.

---

*End of CLAUDE.md v3. If you find a gap in this rulebook, log it to `CRITIQUE_LOG.md` with type SPEC_GAP and raise it. The rulebook itself is not infallible.*
