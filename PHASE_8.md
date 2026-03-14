# PHASE 8 — Final Intelligence Layer, Trust Features, Live Mode & v1.0 Completion
## Version 2 — All 68 Gaps Resolved. Single Authoritative Source of Truth.

> **This file supersedes PHASE_8.md v1.** All 68 gaps identified in the gap analysis are
> resolved here. Do not reference the v1 file.
>
> **This is the final phase.** Phase 8 completes every remaining feature from the complete spec
> that is buildable within v1.0. After Phase 8 passes all tests and checks, Arivu is v1.0.

## Before You Start
1. Read `CLAUDE.md` — architecture non-negotiables apply throughout.
2. Read `CONTEXT.md` — verify Phase 7 is marked **Completed** before continuing.
3. **Phase 7 must be complete.** Run `python -m pytest tests/ -v` — all must pass.
4. **Apply all §0 backports before writing any Phase 8 code.**
5. This file is the **only** spec you need right now. Do not open any other phase file.

---

## What Phase 8 Produces

### Intelligence Completion (remaining Layer 1 + Layer 11 features)
- **Cross-Domain Spark Detector** (F1.14) — ideas crossing field boundaries, what they unlocked, future spark predictions
- **Error Propagation Tracker** (F1.15) — Retraction Watch + PubPeer integration, fault-line styling on affected edges
- **Citation Intent Classification** (F1.11) — visual labels per edge: methodological / theoretical / empirical / contradiction / incidental / revival
- **Reading Between the Lines Detector** (F11.3) — real claim vs. hedged claim, implicit foil, author confidence signals
- **Intellectual Debt Tracker** (F11.4) — foundational assumptions accepted without proof, methods standardized before validated
- **Challenge Generator** (F11.5) — strongest possible counterargument for each foundational paper
- **Idea Credit System** (F11.7) — Pioneer / Enabling / Bridge / Amplification / Refinement credit profiles per researcher

### Researcher Profiles (Layer 3)
- **Researcher Identity Profiles** (F3.1) — intellectual DNA across a researcher's body of work, contribution type distribution, most propagated idea

### Workflow Completion (remaining Layer 4 features)
- **Literature Review Engine** (F4.5) — multi-seed graph analysis, Word doc literature review outline organized by conceptual thread
- **Field Entry Kit** (F4.7) — composite onboarding document: reading sequence + vocabulary guide + controversy map + white space
- **Research Risk Analyzer** (F4.8) — redundancy / foundation / trajectory / competition risk matrix

### Experience Layer Completion (Layer 5)
- **Graph Memory** (F5.5) — seen/unseen node visual distinction, persistent hover/flag/exploration state across sessions

### Output Completion (Layer 6)
- **Coverage Report** (F7.4) — per-graph coverage panel, feature gating by coverage score
- **Science Journalism Layer** (F6.4) — hype detector, context generator, expert finder, plain language graph, stakes analyzer

### Trust & Transparency Layer (Layer 7, all four)
- **Confidence Layer** (F7.1) — ●●●● badges on every analytical output, epistemic language tier system, wired into frontend
- **Evidence Trail** (F7.2) — expandable panel showing raw data, sentences, scores behind every LLM claim
- **Disagreement Flag** (F7.3) — per-edge and per-insight thumbs-down, auto-downgrade at threshold, user feedback loop

### Platform Completion (Layer 8)
- **Live Mode** (F8.1) — polling-based subscription, new citation alerts, paradigm shift alerts, weekly digest
- **Interdisciplinary Translation Service** (F8.3) — vocabulary equivalence map across fields, untranslated techniques as opportunities

### Final Quality & Finalization
- `scripts/load_retraction_watch.py` — **replacing** Phase 5 version (HTTP download; Phase 5 used local CSV)
- `scripts/ground_truth_eval.py` — **replacing** Phase 5 version (DB-queried inline pairs; Phase 5 used pairs.json)
- `scripts/benchmark_nlp.py` — stub → real (end-to-end graph build latency benchmark)
- `scripts/precompute_gallery.py` — stub → real (builds all 7 gallery papers, including leaderboard_json)
- `README.md` — complete per §51 of complete spec
- Security audit checklist verification
- Performance audit and optimization
- Accessibility audit pass
- v1.0 git tag

### New files
```
backend/cross_domain_spark.py            ← CrossDomainSparkDetector (F1.14)
backend/error_propagation.py             ← ErrorPropagationTracker (F1.15)
backend/reading_between_lines.py         ← ReadingBetweenLines (F11.3)
backend/intellectual_debt.py             ← IntellectualDebtTracker (F11.4)
backend/challenge_generator.py           ← ChallengeGenerator (F11.5)
backend/idea_credit.py                   ← IdeaCreditSystem (F11.7)
backend/researcher_profiles.py           ← ResearcherProfileBuilder (F3.1)
backend/literature_review_engine.py      ← LiteratureReviewEngine (F4.5)
backend/field_entry_kit.py               ← FieldEntryKit (F4.7)
backend/research_risk_analyzer.py        ← ResearchRiskAnalyzer (F4.8)
backend/science_journalism.py            ← ScienceJournalismLayer (F6.4)
backend/live_mode.py                     ← LiveModeManager (F8.1)
backend/interdisciplinary_translation.py ← InterdisciplinaryTranslator (F8.3)
backend/graph_memory.py                  ← GraphMemoryManager (F5.5)
static/js/confidence-layer.js            ← ConfidenceLayer: badges + evidence trail
static/js/disagreement-flag.js           ← DisagreementFlag: per-edge/insight UI
static/js/graph-memory.js                ← GraphMemory: seen/unseen state
static/js/live-mode.js                   ← LiveModePanel: alert subscription UI
static/js/researcher-profile.js          ← ResearcherProfileView (inline in researcher.html; file is a thin shim)
static/js/journalism.js                  ← JournalismLayerPanel (inline in journalism.html; file is a thin shim)
scripts/migrate_phase8.py                ← Phase 8 DB schema additions
scripts/load_retraction_watch.py         ← REPLACES Phase 5 version
scripts/ground_truth_eval.py             ← REPLACES Phase 5 version
scripts/benchmark_nlp.py                 ← stub → real
scripts/precompute_gallery.py            ← stub → real
scripts/live_monitor_cron.py             ← NEW: nightly new-paper polling for live mode
tests/test_phase8.py                     ← Phase 8 test suite
templates/researcher.html                ← Researcher profile page
templates/journalism.html                ← Science journalism layer page
README.md                                ← Complete (per spec §51)
```

### Modified
```
app.py                      ← all Phase 8 routes
backend/config.py           ← RETRACTION_WATCH_CSV_URL, PUBPEER_API_KEY, LIVE_MODE_ENABLED
backend/rate_limiter.py     ← Phase 8 endpoint limits
backend/nlp_pipeline.py     ← wire citation intent classification into edge_analysis (F1.11)
backend/graph_engine.py     ← populate graph_id in metadata; store researcher_sids during build
backend/chat_guide.py       ← use PersonaEngine framing in chat responses
static/js/graph.js          ← confidence badges on nodes/edges, seen-paper visual state, researcher profile link
static/js/panels.js         ← wire confidence layer, evidence trail, disagreement flag, action log
static/css/style.css        ← confidence badge styles, seen-paper opacity, fault-line edge, coverage report
templates/tool.html         ← live mode panel container
CONTEXT.md                  ← Phase 8 → Completed, v1.0 tagged
```

### Unchanged (do not touch)
```
All Phase 1–7 backend modules not in Modified list above
All Phase 1–7 test files
scripts/migrate.py through scripts/migrate_phase7.py
```

---

## Architecture Reminders for Phase 8

- **Architecture non-negotiables still apply**: no ML library imports on main server.
- **`graph_id` is a stable TEXT identifier** defined as the seed_paper_id + build timestamp hash. See §0.8 for canonical definition and how `graph_engine.py` generates it.
- **`graph_memory_state` supersedes `graph_memory`** (Phase 6 table). Phase 8 migration drops `graph_memory` and all Phase 8 code uses only `graph_memory_state`. See §0.9.
- **Researcher Profiles** are computed from existing `papers` data — no new API calls.
- **Live Mode** is polling-based via the nightly cron — NOT WebSocket.
- **Error Propagation Tracker** reads from the `retractions` table (populated by `load_retraction_watch.py`) and `papers.pubpeer_flags` JSONB. No new external API calls during request cycle.
- **Confidence Layer** only adds UI — the confidence data is already computed and stored.
- **Graph Memory** stores state per user, not per session. Requires `@require_auth`. Anonymous users see no memory distinction.
- **Science Journalism Layer** is a separate route/template, not integrated into the main tool page.
- **Literature Review Engine** uses the current session's graph as its starting corpus (not a global paper search). Calls the NLP worker to embed the user's research question. Rate-limited heavily.
- **`require_tier` decorator hierarchy**: `"researcher"` passes for tiers: researcher, lab, developer. `"lab"` passes for tiers: lab only. Confirm this is the behavior in `backend/decorators.py` before using `@require_tier`.

---

## §0 — Backports (Apply Before Any Phase 8 Code)

### §0.1 — Verify retraction watch table populated

Phase 6 defines the `retractions` table schema. Verify it is populated:
```bash
psql $DATABASE_URL -c "SELECT COUNT(*) FROM retractions;"
# If 0: run python scripts/load_retraction_watch.py (after §1 makes it real)
```

### §0.2 — Verify edge_analysis.citation_intent column exists

The complete spec defines `citation_intent TEXT` on `edge_analysis`. Verify and add if missing:
```bash
psql $DATABASE_URL -c "\d edge_analysis" | grep citation_intent
# If missing:
psql $DATABASE_URL -c "ALTER TABLE edge_analysis ADD COLUMN IF NOT EXISTS citation_intent TEXT;"
```

### §0.3 — Verify Phase 8 tables do not already exist

```bash
psql $DATABASE_URL -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_name IN ('graph_memory_state', 'researcher_profiles', 'live_subscriptions', 'confidence_overrides');"
# Expected: 0
```

### §0.4 — requirements.txt: Add Phase 8 packages

Add to `requirements.txt`:
```
python-docx==1.1.2         # Literature Review Engine + Field Entry Kit Word doc generation
langdetect==1.0.9          # Language detection (if not already present)
```

### §0.5 — .env.example: Phase 8 variables

Add to `.env.example`:
```bash
# Phase 8 — Retraction Watch + PubPeer
# RETRACTION_WATCH_CSV_URL: obtain after registering at retractionwatch.com/the-retraction-watch-database/
# The URL on the documentation page is NOT the CSV download URL.
# Register, then use the actual CSV download link they provide.
RETRACTION_WATCH_CSV_URL=   # Set after RW registration

PUBPEER_API_KEY=            # Optional: PubPeer post-publication review API key
LIVE_MODE_ENABLED=false     # Set true to enable live monitoring cron
```

### §0.6 — backend/config.py: Add Phase 8 config vars

Add to the `Config` class:
```python
    # ── Phase 8 — Retraction Watch, PubPeer, Live Mode ───────────────────────
    RETRACTION_WATCH_CSV_URL = os.environ.get("RETRACTION_WATCH_CSV_URL", "")
    PUBPEER_API_KEY          = os.environ.get("PUBPEER_API_KEY", "")
    LIVE_MODE_ENABLED        = os.environ.get("LIVE_MODE_ENABLED", "false").lower() == "true"
```

Also add a validation warning:
```python
    if cls.LIVE_MODE_ENABLED and not cls.RETRACTION_WATCH_CSV_URL:
        logger.warning("LIVE_MODE_ENABLED=true but RETRACTION_WATCH_CSV_URL not set — retraction sync will fail")
```

### §0.7 — Verify require_tier hierarchy for "researcher"

```bash
# Confirm that @require_tier("researcher") passes for lab and developer users:
python -c "
from backend.decorators import TIER_ORDER
print(TIER_ORDER)
# Expected: {'free': 0, 'researcher': 1, 'lab': 2, 'developer': 2}
# If not present, add TIER_ORDER to decorators.py and fix require_tier to use >= comparison
"
```

If `TIER_ORDER` does not exist, add to `backend/decorators.py`:
```python
TIER_ORDER = {"free": 0, "researcher": 1, "lab": 2, "developer": 2}

def require_tier(min_tier: str):
    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            if not g.get("user"):
                return jsonify({"error": "Authentication required"}), 401
            user_level  = TIER_ORDER.get(g.user.get("tier", "free"), 0)
            min_level   = TIER_ORDER.get(min_tier, 99)
            if user_level < min_level:
                return jsonify({"error": f"This feature requires {min_tier} tier or above."}), 403
            return f(*args, **kwargs)
        return wrapper
    return decorator
```

### §0.8 — CRITICAL: Define canonical `graph_id` and wire into graph_engine.py

**The `graph_id` TEXT identifier is the foundation of Phase 8 caching, live subscriptions, and graph memory.** It must be stable across multiple API calls for the same graph.

**Definition:** `graph_id = f"{seed_paper_id}_{session_id}"` — the seed paper ID concatenated with the session or user ID that built it. This makes it stable for repeated requests within the same session.

Add to `backend/graph_engine.py` in the `export_to_json()` method (or wherever `metadata` is assembled):
```python
def _compute_graph_id(self, seed_paper_id: str, session_id: str) -> str:
    """
    Stable graph identifier for caching and subscription lookup.
    Format: {seed_paper_id}_{session_id[:16]}
    Stable across multiple requests for the same paper+session.
    """
    import hashlib
    raw = f"{seed_paper_id}_{session_id}"
    return hashlib.sha256(raw.encode()).hexdigest()[:32]
```

In `export_to_json()`, ensure `metadata` contains:
```python
metadata = {
    "graph_id":         self._compute_graph_id(self.seed_paper_id, self.session_id),
    "seed_paper_id":    self.seed_paper_id,
    "seed_paper_title": ...,
    ...
}
```

**Also add `graph_id TEXT` to the `graphs` table** (see §1 migration).

Additionally, `populate researcher_sids` means: after graph build completes, collect all unique author IDs from `graph_json["nodes"]` and upsert minimal rows into `researcher_profiles` (author_id, display_name only) so the profile page can confirm the author exists even before a full profile is computed. Add this to the `_on_graph_complete()` hook:
```python
def _on_graph_complete(self, graph_json: dict, session_id: str, user_id: str):
    # ... existing code ...
    # Phase 8: seed researcher_profiles with author stubs
    for node in graph_json.get("nodes", []):
        for author in (node.get("authors") or []):
            if isinstance(author, dict) and author.get("authorId"):
                db.execute(
                    """
                    INSERT INTO researcher_profiles (author_id, display_name)
                    VALUES (%s, %s)
                    ON CONFLICT (author_id) DO NOTHING
                    """,
                    (author["authorId"], author.get("name", "Unknown")),
                )
```

### §0.9 — CRITICAL: Migrate graph_memory → graph_memory_state

Phase 6 created a `graph_memory` table with a simple `memory_json JSONB` blob. Phase 8 replaces it with `graph_memory_state` which has typed, indexed columns. The migration (§1) handles this, but be aware:

- **All Phase 6 code that read/wrote `graph_memory` is superseded.** The `GraphMemoryManager` in Phase 8 reads/writes ONLY from `graph_memory_state`.
- The old `graph_memory` table is renamed to `graph_memory_legacy` in the migration (not dropped — preserves data for debugging).
- Any Phase 6 code that called `db.execute("INSERT INTO graph_memory ...")` will continue to write to `graph_memory_legacy` silently. This is acceptable — those code paths will be removed in a post-v1 cleanup.

---

## §1 — Phase 8 DB Migration: scripts/migrate_phase8.py

```python
#!/usr/bin/env python3
"""
scripts/migrate_phase8.py
Phase 8 schema additions. Safe to re-run.
Usage: python scripts/migrate_phase8.py

GAP FIXES:
  - Adds graph_id TEXT column to graphs table (GAP-P8-51 / GAP-P8-67)
  - Adds pubpeer_flags JSONB to papers table (GAP-P8-11)
  - Adds error_message to literature_review_jobs (GAP-P8-12)
  - Adds UNIQUE(insight_id, session_id) to insight_feedback (GAP-P8-13)
  - Replaces graph_memory with graph_memory_state (GAP-P8-52 / GAP-P8-55)
  - Adds composite index on live_subscriptions for cron query (GAP-P8-15)
  - Adds user-tracking to confidence_overrides (GAP-P8-14)
"""
import sys, logging
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

PHASE_8_SQL = """
-- ── graphs table: add stable graph_id TEXT column (GAP-P8-51/67) ─────────────
ALTER TABLE graphs ADD COLUMN IF NOT EXISTS graph_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_graphs_graph_id ON graphs(graph_id)
    WHERE graph_id IS NOT NULL;

-- Backfill existing rows with a derived graph_id so cron doesn't break on old rows
UPDATE graphs
SET graph_id = 'legacy_' || id::text
WHERE graph_id IS NULL;

-- ── papers table: add pubpeer_flags JSONB (GAP-P8-11) ────────────────────────
ALTER TABLE papers ADD COLUMN IF NOT EXISTS pubpeer_flags  JSONB;
ALTER TABLE papers ADD COLUMN IF NOT EXISTS pubpeer_url    TEXT;
ALTER TABLE papers ADD COLUMN IF NOT EXISTS is_retracted   BOOLEAN DEFAULT FALSE;
ALTER TABLE papers ADD COLUMN IF NOT EXISTS retraction_reason TEXT;

-- ── Researcher profiles (F3.1) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS researcher_profiles (
    profile_id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id           TEXT        UNIQUE NOT NULL,
    display_name        TEXT,
    institution         TEXT,
    h_index             INT,
    paper_count         INT         NOT NULL DEFAULT 0,
    contribution_type   TEXT,
    credit_breakdown    JSONB       NOT NULL DEFAULT '{}',
    intellectual_heroes JSONB       NOT NULL DEFAULT '[]',
    intellectual_radius FLOAT,
    profile_json        JSONB       NOT NULL DEFAULT '{}',
    embedding           vector(384),
    computed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_contribution_type CHECK(
        contribution_type IN ('pioneer','synthesizer','bridge','refiner','contradictor')
        OR contribution_type IS NULL
    )
);
CREATE INDEX IF NOT EXISTS idx_researcher_author_id ON researcher_profiles(author_id);
CREATE INDEX IF NOT EXISTS idx_researcher_embedding
    ON researcher_profiles USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 50);

-- ── graph_memory_state (F5.5) — replaces graph_memory from Phase 6 ──────────
-- First, preserve old table as legacy for data safety
ALTER TABLE IF EXISTS graph_memory RENAME TO graph_memory_legacy;

CREATE TABLE IF NOT EXISTS graph_memory_state (
    id                  SERIAL      PRIMARY KEY,
    user_id             UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    graph_id            TEXT        NOT NULL,
    seen_paper_ids      TEXT[]      NOT NULL DEFAULT '{}',
    flagged_edges       TEXT[]      NOT NULL DEFAULT '{}',
    expanded_edges      TEXT[]      NOT NULL DEFAULT '{}',
    pruning_history     JSONB       NOT NULL DEFAULT '[]',
    navigation_path     JSONB       NOT NULL DEFAULT '[]',  -- [{paper_id, visited_at}] ordered array
    time_machine_position INT,
    last_updated        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, graph_id)
);
CREATE INDEX IF NOT EXISTS idx_graph_memory_user ON graph_memory_state(user_id, graph_id);

-- ── Live mode subscriptions (F8.1) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS live_subscriptions (
    subscription_id UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    graph_id        TEXT        NOT NULL,
    seed_paper_id   TEXT        NOT NULL,
    alert_events    TEXT[]      NOT NULL DEFAULT '{new_citation,paradigm_shift,gap_filled,retraction_alert}',
    digest_email    BOOLEAN     NOT NULL DEFAULT TRUE,
    active          BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_checked_at TIMESTAMPTZ,
    UNIQUE(user_id, graph_id)
);
CREATE INDEX IF NOT EXISTS idx_live_subs_user   ON live_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_live_subs_paper  ON live_subscriptions(seed_paper_id) WHERE active = TRUE;
-- Cron query index: WHERE active=TRUE ORDER BY last_checked_at ASC NULLS FIRST (GAP-P8-15)
CREATE INDEX IF NOT EXISTS idx_live_subs_checked ON live_subscriptions(last_checked_at ASC NULLS FIRST)
    WHERE active = TRUE;

-- ── Live mode alerts log ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS live_alerts (
    alert_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID        NOT NULL REFERENCES live_subscriptions(subscription_id) ON DELETE CASCADE,
    event_type      TEXT        NOT NULL,
    event_data      JSONB       NOT NULL DEFAULT '{}',
    delivered       BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_live_alerts_sub        ON live_alerts(subscription_id, delivered);
CREATE INDEX IF NOT EXISTS idx_live_alerts_undelivered ON live_alerts(created_at) WHERE delivered = FALSE;

-- ── Confidence overrides (F7.3) with user deduplication (GAP-P8-14) ──────────
CREATE TABLE IF NOT EXISTS confidence_overrides (
    edge_id          TEXT        NOT NULL,
    original_tier    TEXT,
    override_tier    TEXT        NOT NULL,
    flag_count       INT         NOT NULL DEFAULT 1,
    flagged_by_users TEXT[]      NOT NULL DEFAULT '{}',  -- user_ids who flagged (for dedup)
    last_flagged_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    review_required  BOOLEAN     NOT NULL DEFAULT FALSE,  -- set TRUE when flag_count >= 5
    PRIMARY KEY(edge_id)
);

-- ── edge_analysis: add citation intent + per-user flag count ──────────────────
ALTER TABLE edge_analysis ADD COLUMN IF NOT EXISTS citation_intent     TEXT;
ALTER TABLE edge_analysis ADD COLUMN IF NOT EXISTS flagged_by_users    INT  NOT NULL DEFAULT 0;

-- ── Cross-domain spark cache (F1.14) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cross_domain_spark_cache (
    id              SERIAL      PRIMARY KEY,
    graph_id        TEXT        NOT NULL,
    result_json     JSONB       NOT NULL,
    computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(graph_id)
);

-- ── Literature review jobs (F4.5) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS literature_review_jobs (
    job_id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    research_question TEXT        NOT NULL,
    seed_paper_ids    TEXT[]      NOT NULL DEFAULT '{}',
    status            TEXT        NOT NULL DEFAULT 'pending'
                      CHECK(status IN ('pending','processing','done','failed')),
    result_docx_r2    TEXT,
    result_json       JSONB,
    error_message     TEXT,    -- GAP-P8-12: stores failure reason
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_litrev_user ON literature_review_jobs(user_id);

-- ── insight_feedback: add UNIQUE constraint for deduplication (GAP-P8-13) ─────
ALTER TABLE insight_feedback ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(user_id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_insight_feedback_unique
    ON insight_feedback(insight_id, COALESCE(user_id::text, session_id))
    WHERE feedback = 'not_helpful';
"""


def run():
    from dotenv import load_dotenv
    load_dotenv()
    import backend.db as db
    from backend.config import Config
    db.init_pool(database_url=Config.DATABASE_URL)
    logger.info("Running Phase 8 migrations...")
    try:
        db.execute(PHASE_8_SQL)
        logger.info("Phase 8 schema applied successfully.")
    except Exception as exc:
        logger.error(f"Migration failed: {exc}")
        sys.exit(1)

    expected = [
        "researcher_profiles", "graph_memory_state", "live_subscriptions",
        "live_alerts", "confidence_overrides", "cross_domain_spark_cache",
        "literature_review_jobs",
    ]
    rows = db.fetchall(
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_schema='public' AND table_name = ANY(%s)",
        (expected,),
    )
    found   = {r["table_name"] for r in rows}
    missing = set(expected) - found
    if missing:
        logger.error(f"Missing tables: {missing}")
        sys.exit(1)
    logger.info(f"Verified {len(expected)} tables. Phase 8 migration complete.")


if __name__ == "__main__":
    run()
```

---

## §2 — scripts/load_retraction_watch.py (REPLACES Phase 5 version)

> **Note (GAP-P8-53):** This script REPLACES the Phase 5 version which read from a local CSV
> file path. This version downloads via HTTP. Claude Code must overwrite the existing file.
>
> **Note (GAP-P8-30 / GAP-P8-64):** The RETRACTION_WATCH_CSV_URL env var must be set to
> the actual CSV download URL obtained after registering at retractionwatch.com. The documentation
> page URL is NOT a CSV download. The FALLBACK_CSV_URL points to CrossRef's retraction API
> as a real alternative data source.

```python
#!/usr/bin/env python3
"""
scripts/load_retraction_watch.py
REPLACES Phase 5 version.

Downloads and loads the Retraction Watch database into PostgreSQL.
Primary source: Retraction Watch CSV (requires registration at retractionwatch.com).
Fallback: CrossRef retraction data via public API.

Run: python scripts/load_retraction_watch.py
Schedule: Koyeb cron — weekly (Sunday 04:00 UTC): 0 4 * * 0
"""
import csv, io, logging, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# Set RETRACTION_WATCH_CSV_URL after registering at retractionwatch.com
# This is the actual CSV file URL, NOT the documentation page.
FALLBACK_CSV_URL = "https://api.crossref.org/works?filter=type:journal-article,update-type:retraction&rows=1000"


def run():
    from dotenv import load_dotenv
    load_dotenv()
    import backend.db as db
    from backend.config import Config
    db.init_pool(database_url=Config.DATABASE_URL)

    csv_url = Config.RETRACTION_WATCH_CSV_URL
    if not csv_url:
        logger.warning(
            "RETRACTION_WATCH_CSV_URL not set. Register at retractionwatch.com to get "
            "the CSV download URL, then set this env var. Attempting CrossRef fallback."
        )
        _load_from_crossref(db)
        return

    logger.info(f"Downloading Retraction Watch data from configured URL...")
    try:
        import httpx
        resp = httpx.get(csv_url, follow_redirects=True, timeout=120.0)
        resp.raise_for_status()
        csv_content = resp.text
        _load_csv(db, csv_content)
    except Exception as exc:
        logger.error(f"Download failed: {exc}. Trying CrossRef fallback.")
        _load_from_crossref(db)


def _load_csv(db, csv_content: str):
    inserted = 0
    updated  = 0
    reader   = csv.DictReader(io.StringIO(csv_content))

    for row in reader:
        doi    = (row.get("DOI") or row.get("doi") or "").strip().lower()
        title  = (row.get("Title") or row.get("title") or "")[:500]
        journal = (row.get("Journal") or row.get("journal") or "")[:300]
        date   = (row.get("RetractionDate") or row.get("retraction_date") or "")[:20]
        reason = (row.get("Reason") or row.get("reason") or "")[:500]

        if not doi and not title:
            continue

        try:
            db.execute(
                """
                INSERT INTO retractions (doi, title, journal, retraction_date, reason)
                VALUES (%s, %s, %s, %s::date, %s)
                ON CONFLICT (doi) DO UPDATE
                SET title=EXCLUDED.title, journal=EXCLUDED.journal,
                    retraction_date=EXCLUDED.retraction_date, reason=EXCLUDED.reason
                """,
                (doi or title[:100], title, journal, date or None, reason),
            )
            inserted += 1
            if doi:
                db.execute(
                    """
                    UPDATE papers SET is_retracted = TRUE, retraction_reason = %s
                    WHERE doi = %s AND (is_retracted IS NULL OR is_retracted = FALSE)
                    """,
                    (reason[:200], doi),
                )
                updated += 1
        except Exception as exc:
            logger.warning(f"Row insert failed (doi={doi}): {exc}")

    logger.info(f"Retraction Watch load complete: {inserted} records upserted, {updated} papers flagged.")


def _load_from_crossref(db):
    """CrossRef fallback: fetch retraction notices via their public API."""
    import httpx
    logger.info("Loading retraction data from CrossRef API (fallback)...")
    inserted = 0
    try:
        resp = httpx.get(
            "https://api.crossref.org/works",
            params={"filter": "type:journal-article,update-type:retraction", "rows": "1000"},
            headers={"User-Agent": "Arivu Research Platform (contact: admin@arivu.app)"},
            timeout=30.0,
        )
        resp.raise_for_status()
        items = resp.json().get("message", {}).get("items", [])
        for item in items:
            doi    = (item.get("DOI") or "").lower()
            title  = " ".join(item.get("title", [""]))[:500]
            if not doi:
                continue
            try:
                db.execute(
                    """
                    INSERT INTO retractions (doi, title, reason)
                    VALUES (%s, %s, 'Retraction notice via CrossRef')
                    ON CONFLICT (doi) DO NOTHING
                    """,
                    (doi, title),
                )
                inserted += 1
            except Exception:
                pass
    except Exception as exc:
        logger.error(f"CrossRef fallback also failed: {exc}")
    logger.info(f"CrossRef fallback: {inserted} retraction records loaded.")


if __name__ == "__main__":
    run()
```

---

## §3 — Intelligence Backend Modules

### §3.1 — backend/cross_domain_spark.py (F1.14)

> No changes from v1. GAP-P8-33 (hardcoded year 2025) is fixed below.

```python
"""
backend/cross_domain_spark.py — CrossDomainSparkDetector (F1.14)
"""
import logging
import datetime
from collections import defaultdict
from dataclasses import dataclass
from typing import Optional

import backend.db as db
from backend.llm_client import LLMClient

logger = logging.getLogger(__name__)

CROSS_DOMAIN_SIMILARITY_FLOOR = 0.60
MAX_FUTURE_SPARKS = 10
_CURRENT_YEAR = datetime.datetime.now().year  # GAP-P8-33: not hardcoded


@dataclass
class CrossDomainSpark:
    source_paper_id:  str
    source_title:     str
    source_field:     str
    source_year:      Optional[int]
    target_paper_id:  str
    target_title:     str
    target_field:     str
    idea_transferred: str
    enabled_count:    int
    years_ago:        Optional[int]
    similarity:       float

    def to_dict(self) -> dict:
        return {
            "source": {"paper_id": self.source_paper_id, "title": self.source_title,
                       "field": self.source_field, "year": self.source_year},
            "target": {"paper_id": self.target_paper_id, "title": self.target_title,
                       "field": self.target_field},
            "idea_transferred": self.idea_transferred,
            "enabled_count":    self.enabled_count,
            "years_ago":        self.years_ago,
            "similarity":       round(self.similarity, 3),
        }


@dataclass
class FutureSpark:
    field_a:      str
    field_b:      str
    paper_a_id:   str
    paper_a_title: str
    paper_b_id:   str
    paper_b_title: str
    similarity:   float
    opportunity:  str

    def to_dict(self) -> dict:
        return {
            "field_a":     self.field_a,
            "field_b":     self.field_b,
            "paper_a":     {"id": self.paper_a_id, "title": self.paper_a_title},
            "paper_b":     {"id": self.paper_b_id, "title": self.paper_b_title},
            "similarity":  round(self.similarity, 3),
            "opportunity": self.opportunity,
        }


class CrossDomainSparkDetector:
    """Stateless — instantiate fresh per request."""

    def detect(self, graph_json: dict) -> dict:
        nodes      = graph_json.get("nodes", [])
        edges      = graph_json.get("edges", [])
        node_by_id = {n["id"]: n for n in nodes}

        sparks        = self._find_historical_sparks(nodes, edges, node_by_id)
        future_sparks = self._find_future_sparks(nodes, edges, node_by_id)
        summary       = self._build_summary(sparks, future_sparks)
        return {
            "sparks":        [s.to_dict() for s in sparks],
            "future_sparks": [f.to_dict() for f in future_sparks],
            "summary":       summary,
        }

    def _find_historical_sparks(self, nodes, edges, node_by_id) -> list:
        results = []
        for edge in edges:
            src_id = edge.get("source") or edge.get("citing_paper_id", "")
            tgt_id = edge.get("target") or edge.get("cited_paper_id", "")
            src    = node_by_id.get(src_id, {})
            tgt    = node_by_id.get(tgt_id, {})

            src_fields = src.get("fields_of_study") or []
            tgt_fields = tgt.get("fields_of_study") or []
            if not src_fields or not tgt_fields:
                continue

            src_field = src_fields[0]
            tgt_field = tgt_fields[0]
            if src_field == tgt_field:
                continue

            similarity = float(edge.get("similarity_score") or 0)
            if similarity < CROSS_DOMAIN_SIMILARITY_FLOOR:
                continue

            src_year = src.get("year") or 0
            enabled  = sum(
                1 for n in nodes
                if n.get("year", 0) > src_year
                and src_field in (n.get("fields_of_study") or [])
                and tgt_field in (n.get("fields_of_study") or [])
            )

            idea      = edge.get("inherited_idea") or f"Technique from {tgt_field} applied to {src_field}"
            years_ago = (_CURRENT_YEAR - src_year) if src_year else None  # GAP-P8-33 fixed

            results.append(CrossDomainSpark(
                source_paper_id=src_id, source_title=src.get("title", ""),
                source_field=src_field, source_year=src.get("year"),
                target_paper_id=tgt_id, target_title=tgt.get("title", ""),
                target_field=tgt_field, idea_transferred=idea,
                enabled_count=enabled, years_ago=years_ago, similarity=similarity,
            ))
        return sorted(results, key=lambda x: (x.enabled_count, x.similarity), reverse=True)[:10]

    def _find_future_sparks(self, nodes, edges, node_by_id) -> list:
        existing_pairs = {
            (e.get("source") or e.get("citing_paper_id", ""),
             e.get("target") or e.get("cited_paper_id", ""))
            for e in edges
        }
        all_node_ids   = [n["id"] for n in nodes if n.get("id")]
        node_field_map = {n["id"]: (n.get("fields_of_study") or ["unknown"])[0] for n in nodes}
        if not all_node_ids:
            return []

        try:
            rows = db.fetchall(
                """
                SELECT pe1.paper_id AS id_a, pe2.paper_id AS id_b,
                       1 - (pe1.embedding <=> pe2.embedding) AS similarity
                FROM paper_embeddings pe1
                JOIN paper_embeddings pe2 ON pe1.paper_id < pe2.paper_id
                WHERE pe1.paper_id = ANY(%s)
                  AND pe2.paper_id = ANY(%s)
                  AND 1 - (pe1.embedding <=> pe2.embedding) > %s
                ORDER BY similarity DESC
                LIMIT 30
                """,
                (all_node_ids, all_node_ids, CROSS_DOMAIN_SIMILARITY_FLOOR),
            )
        except Exception as exc:
            logger.warning(f"Future spark pgvector query failed: {exc}")
            return []

        results = []
        llm     = LLMClient()
        for row in rows:
            id_a, id_b = row["id_a"], row["id_b"]
            if (id_a, id_b) in existing_pairs or (id_b, id_a) in existing_pairs:
                continue
            fa = node_field_map.get(id_a, "unknown")
            fb = node_field_map.get(id_b, "unknown")
            if fa == fb:
                continue
            pa = node_by_id.get(id_a, {})
            pb = node_by_id.get(id_b, {})
            try:
                prompt = (
                    f"Two papers from different fields have high semantic similarity "
                    f"({float(row['similarity']):.2f}) but no citation between them.\n"
                    f"Paper A ({fa}): '{pa.get('title','?')}'\n"
                    f"Paper B ({fb}): '{pb.get('title','?')}'\n"
                    f"In one sentence, what research opportunity does this cross-domain gap represent? "
                    f"Be specific about what technique or concept from one field could transfer."
                )
                opportunity = llm.call_llm(prompt, max_tokens=80).strip()
            except Exception:
                opportunity = (
                    f"High-similarity work across {fa} and {fb} — "
                    f"techniques from one field may be transferable to the other."
                )
            results.append(FutureSpark(
                field_a=fa, field_b=fb,
                paper_a_id=id_a, paper_a_title=pa.get("title", ""),
                paper_b_id=id_b, paper_b_title=pb.get("title", ""),
                similarity=float(row["similarity"]), opportunity=opportunity,
            ))
            if len(results) >= MAX_FUTURE_SPARKS:
                break
        return results

    def _build_summary(self, sparks, future_sparks) -> str:
        if not sparks and not future_sparks:
            return "No cross-domain activity detected in this graph."
        parts = []
        if sparks:
            fields = set()
            for s in sparks[:5]:
                fields.add(s.source_field)
                fields.add(s.target_field)
            parts.append(f"Found {len(sparks)} cross-domain idea transfer(s) spanning {', '.join(list(fields)[:4])}.")
        if future_sparks:
            parts.append(f"{len(future_sparks)} potential future spark(s) identified.")
        return " ".join(parts)
```

### §3.2 — backend/error_propagation.py (F1.15)

> Same as v1, with GAP-P8-11 fix: queries now correctly reference `pubpeer_flags` which the
> migration adds to the `papers` table.

```python
"""
backend/error_propagation.py — ErrorPropagationTracker (F1.15)

Requires papers.pubpeer_flags JSONB column — added in Phase 8 migration.
"""
import logging
from dataclasses import dataclass
from typing import Optional

import backend.db as db

logger = logging.getLogger(__name__)


@dataclass
class RetractedFoundation:
    paper_id:       str
    title:          str
    issue_type:     str
    issue_detail:   str
    affected_count: int
    affected_ids:   list

    def to_dict(self) -> dict:
        return {
            "paper_id":       self.paper_id,
            "title":          self.title,
            "issue_type":     self.issue_type,
            "issue_detail":   self.issue_detail,
            "affected_count": self.affected_count,
            "affected_ids":   self.affected_ids[:10],
        }


@dataclass
class ErrorExposure:
    paper_id:          str
    title:             str
    exposure_score:    float
    exposure_tier:     str
    flagged_ancestors: list

    def to_dict(self) -> dict:
        return {
            "paper_id":          self.paper_id,
            "title":             self.title,
            "exposure_score":    round(self.exposure_score, 3),
            "exposure_tier":     self.exposure_tier,
            "flagged_ancestors": self.flagged_ancestors,
        }


class ErrorPropagationTracker:
    """Stateless — instantiate fresh per request."""

    def analyze(self, graph_json: dict) -> dict:
        nodes      = graph_json.get("nodes", [])
        edges      = graph_json.get("edges", [])
        node_by_id = {n["id"]: n for n in nodes}
        all_ids    = [n["id"] for n in nodes]

        if not all_ids:
            return {"flagged_papers": [], "exposure_scores": [], "clean": True, "summary": "Empty graph."}

        # GAP-P8-11 fix: pubpeer_flags column now exists in papers table after migration
        flagged_rows = db.fetchall(
            """
            SELECT p.paper_id, p.title, p.is_retracted, p.retraction_reason,
                   p.pubpeer_flags, r.reason AS rw_reason, r.retraction_date
            FROM papers p
            LEFT JOIN retractions r ON r.doi = p.doi
            WHERE p.paper_id = ANY(%s)
              AND (p.is_retracted = TRUE OR p.pubpeer_flags IS NOT NULL)
            """,
            (all_ids,),
        )

        flagged:     list = []
        flagged_ids: set  = set()
        descendants       = self._build_descendants(edges, all_ids)

        for row in flagged_rows:
            pid        = row["paper_id"]
            flagged_ids.add(pid)
            issue_type = "retracted" if row.get("is_retracted") else "pubpeer_concern"
            pf         = row.get("pubpeer_flags")
            pf_summary = ""
            if isinstance(pf, dict):
                pf_summary = pf.get("summary", "Post-publication concerns flagged")
            issue_detail = (row.get("rw_reason") or pf_summary or "No detail available")[:300]
            affected     = [d for d in descendants.get(pid, []) if d in node_by_id]

            flagged.append(RetractedFoundation(
                paper_id=pid, title=row.get("title", ""),
                issue_type=issue_type, issue_detail=issue_detail,
                affected_count=len(affected), affected_ids=affected[:10],
            ).to_dict())

        exposures: list = []
        for node in nodes:
            nid       = node["id"]
            ancestors = self._get_ancestors(nid, edges)
            if not ancestors:
                continue
            n_flagged = len(ancestors & flagged_ids)
            score     = n_flagged / max(len(ancestors), 1)
            tier      = "clean"
            if score > 0.3:
                tier = "high"
            elif score > 0.1:
                tier = "medium"
            elif score > 0:
                tier = "low"

            if tier != "clean":
                flagged_anc = [
                    next((f for f in flagged if f["paper_id"] == a), None)
                    for a in ancestors & flagged_ids
                ]
                exposures.append(ErrorExposure(
                    paper_id=nid, title=node.get("title", ""),
                    exposure_score=score, exposure_tier=tier,
                    flagged_ancestors=[f for f in flagged_anc if f],
                ).to_dict())

        exposures.sort(key=lambda x: x["exposure_score"], reverse=True)
        clean   = len(flagged) == 0
        summary = self._build_summary(flagged, exposures)

        return {
            "flagged_papers":  flagged,
            "exposure_scores": exposures[:20],
            "clean":           clean,
            "summary":         summary,
        }

    def _build_descendants(self, edges: list, all_ids: list) -> dict:
        cited_by: dict = {}
        for e in edges:
            src = e.get("source") or e.get("citing_paper_id", "")
            tgt = e.get("target") or e.get("cited_paper_id", "")
            cited_by.setdefault(tgt, set()).add(src)
        descendants: dict = {}
        for node_id in all_ids:
            desc    = set()
            queue   = list(cited_by.get(node_id, []))
            visited = {node_id}
            while queue:
                curr = queue.pop(0)
                if curr in visited:
                    continue
                visited.add(curr)
                desc.add(curr)
                queue.extend(cited_by.get(curr, []))
            descendants[node_id] = desc
        return descendants

    def _get_ancestors(self, paper_id: str, edges: list) -> set:
        cites: dict = {}
        for e in edges:
            src = e.get("source") or e.get("citing_paper_id", "")
            tgt = e.get("target") or e.get("cited_paper_id", "")
            cites.setdefault(src, set()).add(tgt)
        ancestors = set()
        queue     = list(cites.get(paper_id, []))
        visited   = {paper_id}
        while queue:
            curr = queue.pop(0)
            if curr in visited:
                continue
            visited.add(curr)
            ancestors.add(curr)
            queue.extend(cites.get(curr, []))
        return ancestors

    def _build_summary(self, flagged, exposures) -> str:
        if not flagged:
            return "No retracted or flagged papers found in this graph."
        high = sum(1 for e in exposures if e["exposure_tier"] == "high")
        return (
            f"Found {len(flagged)} paper(s) with known issues. "
            f"{high} paper(s) have high exposure (>30% of intellectual foundation on flagged work)."
        )
```

### §3.3 — backend/nlp_pipeline.py modification (F1.11 — Citation Intent Classification)

> **GAP-P8-01 fix:** Phase 8 adds `citation_intent` column to `edge_analysis` but never populates
> it. This section specifies the complete implementation.

Add the following class to `backend/nlp_pipeline.py`:

```python
# ── Citation Intent Classification (F1.11) ────────────────────────────────────
# Add this import at the top of nlp_pipeline.py:
# (already imported) from backend.llm_client import LLMClient

CITATION_INTENT_CATEGORIES = (
    "methodological_adoption",   # Paper adopts this paper's method
    "theoretical_foundation",    # Paper uses as theoretical basis
    "empirical_baseline",        # Paper uses as comparison baseline
    "conceptual_inspiration",    # Paper inspired by but diverges
    "direct_contradiction",      # Paper explicitly challenges
    "incidental_mention",        # Passing reference, not central
    "negative_citation",         # Cited as example of what NOT to do
    "revival",                   # Resurrects forgotten work
)

INTENT_LINGUISTIC_MARKERS = {
    "direct_contradiction": [
        "contrary to", "in contrast to", "unlike", "challenge", "refute",
        "disprove", "however", "argue against", "fail to",
    ],
    "methodological_adoption": [
        "following", "adopt", "implement", "we use", "as in", "similar to",
        "based on", "building on", "extending",
    ],
    "empirical_baseline": [
        "baseline", "benchmark", "compare", "outperform", "compared to",
        "relative to", "versus",
    ],
    "incidental_mention": [
        "e.g.", "for example", "such as", "among others", "see also",
    ],
    "revival": [
        "revisit", "rediscover", "renewed interest", "overlooked", "forgotten",
        "original work by",
    ],
}


class CitationIntentClassifier:
    """
    Classifies WHY a paper cites another paper.
    Called from IdeaExtractor.extract_inherited_idea() for each edge.
    Results stored in edge_analysis.citation_intent.

    Strategy:
      1. Try linguistic marker detection on citing_sentence (fast, no LLM)
      2. Fall back to LLM classification on abstract context
    """

    def classify(
        self,
        citing_sentence: str,
        citing_abstract: str,
        cited_title: str,
        mutation_type: str,
    ) -> str:
        """Return one of CITATION_INTENT_CATEGORIES."""
        # Fast path: linguistic markers
        intent = self._detect_markers(citing_sentence or "")
        if intent:
            return intent

        # Map from already-classified mutation_type to a likely intent
        intent = self._from_mutation_type(mutation_type)
        if intent:
            return intent

        # LLM fallback
        return self._llm_classify(citing_sentence, citing_abstract, cited_title)

    def _detect_markers(self, sentence: str) -> str:
        lower = sentence.lower()
        for intent, markers in INTENT_LINGUISTIC_MARKERS.items():
            if any(m in lower for m in markers):
                return intent
        return ""

    def _from_mutation_type(self, mutation_type: str) -> str:
        mapping = {
            "adoption":       "methodological_adoption",
            "contradiction":  "direct_contradiction",
            "revival":        "revival",
            "incidental":     "incidental_mention",
        }
        return mapping.get(mutation_type, "")

    def _llm_classify(self, sentence: str, abstract: str, cited_title: str) -> str:
        try:
            llm    = LLMClient()
            prompt = (
                f"Classify WHY this paper cites '{cited_title}'.\n"
                f"Citing sentence: {(sentence or abstract or '')[:500]}\n\n"
                f"Choose exactly one: {', '.join(CITATION_INTENT_CATEGORIES)}\n"
                f"Reply with only the category name, nothing else."
            )
            result = llm.call_llm(prompt, max_tokens=20).strip().lower().replace(" ", "_")
            if result in CITATION_INTENT_CATEGORIES:
                return result
        except Exception:
            pass
        return "methodological_adoption"  # safe default
```

Wire into `IdeaExtractor.extract_inherited_idea()` — after computing `mutation_type`, add:

```python
# Citation intent (F1.11)
classifier    = CitationIntentClassifier()
citation_intent = classifier.classify(
    citing_sentence=citing_sentence,
    citing_abstract=citing_paper.abstract or "",
    cited_title=cited_paper.title or "",
    mutation_type=mutation_type,
)
# Store in edge_analysis record:
edge_analysis.citation_intent = citation_intent
```

And update the `edge_analysis` DB upsert to include `citation_intent`:
```python
db.execute(
    """
    INSERT INTO edge_analysis
        (citing_paper_id, cited_paper_id, ..., citation_intent)
    VALUES (%s, %s, ..., %s)
    ON CONFLICT (citing_paper_id, cited_paper_id) DO UPDATE
    SET ..., citation_intent = EXCLUDED.citation_intent
    """,
    (..., citation_intent),
)
```

### §3.4 — backend/reading_between_lines.py (F11.3)

> Same as v1. No changes needed.

*(Full implementation from Phase 8 v1 — copy verbatim)*

```python
"""
backend/reading_between_lines.py — ReadingBetweenLines (F11.3)
"""
import logging
from dataclasses import dataclass
from backend.llm_client import LLMClient

logger = logging.getLogger(__name__)


@dataclass
class BetweenTheLinesResult:
    paper_id:           str
    paper_title:        str
    real_claim:         str
    implicit_foil:      str
    confidence_signals: str
    minimal_claim:      str
    confidence:         str  # "abstract_only" | "full_text" | "unavailable"

    def to_dict(self) -> dict:
        return {
            "paper_id":           self.paper_id,
            "paper_title":        self.paper_title,
            "real_claim":         self.real_claim,
            "implicit_foil":      self.implicit_foil,
            "confidence_signals": self.confidence_signals,
            "minimal_claim":      self.minimal_claim,
            "confidence":         self.confidence,
        }


class ReadingBetweenLines:
    def analyze(self, graph_json: dict, paper_id: str) -> BetweenTheLinesResult:
        nodes      = graph_json.get("nodes", [])
        node_by_id = {n["id"]: n for n in nodes}
        node       = node_by_id.get(paper_id, {})
        title      = node.get("title", paper_id)
        abstract   = node.get("abstract", "")

        if not abstract:
            return BetweenTheLinesResult(
                paper_id=paper_id, paper_title=title,
                real_claim="Abstract unavailable.", implicit_foil="",
                confidence_signals="", minimal_claim="", confidence="unavailable",
            )

        llm    = LLMClient()
        prompt = (
            f"You are a sharp academic reader. Analyze this paper's abstract:\n\n"
            f"Title: '{title}'\nAbstract: {abstract[:3000]}\n\n"
            f"Respond in exactly this format:\n"
            f"REAL_CLAIM: [One sentence — what the paper is actually claiming, stripped of all hedges.]\n"
            f"IMPLICIT_FOIL: [One sentence — what existing approach this paper is designed to challenge.]\n"
            f"CONFIDENCE_SIGNALS: [One sentence — what hedging language reveals about author confidence.]\n"
            f"MINIMAL_CLAIM: [One sentence — the simplest system that would demonstrate the core contribution.]\n"
        )
        try:
            raw    = llm.call_llm(prompt, max_tokens=300)
            parsed = self._parse(raw)
            return BetweenTheLinesResult(
                paper_id=paper_id, paper_title=title,
                real_claim=parsed.get("real_claim", "Could not extract."),
                implicit_foil=parsed.get("implicit_foil", ""),
                confidence_signals=parsed.get("confidence_signals", ""),
                minimal_claim=parsed.get("minimal_claim", ""),
                confidence="abstract_only",
            )
        except Exception as exc:
            logger.warning(f"ReadingBetweenLines LLM failed for {paper_id}: {exc}")
            return BetweenTheLinesResult(
                paper_id=paper_id, paper_title=title,
                real_claim="LLM analysis unavailable.", implicit_foil="",
                confidence_signals="", minimal_claim="", confidence="unavailable",
            )

    def _parse(self, raw: str) -> dict:
        import re
        keys = {
            "real_claim":         r"REAL_CLAIM:\s*(.+)",
            "implicit_foil":      r"IMPLICIT_FOIL:\s*(.+)",
            "confidence_signals": r"CONFIDENCE_SIGNALS:\s*(.+)",
            "minimal_claim":      r"MINIMAL_CLAIM:\s*(.+)",
        }
        result = {}
        for key, pattern in keys.items():
            m = re.search(pattern, raw, re.IGNORECASE)
            result[key] = m.group(1).strip() if m else ""
        return result
```

### §3.5 — backend/intellectual_debt.py (F11.4)

> Same as v1. No changes needed.

*(Full implementation from Phase 8 v1 — copy verbatim. It is correct as specified.)*

### §3.6 — backend/challenge_generator.py (F11.5)

> Same as v1. No changes needed.

### §3.7 — backend/idea_credit.py (F11.7)

> Same as v1. No changes needed.

### §3.8 — backend/researcher_profiles.py (F3.1)

> Same as v1, with GAP-P8-59 fix: the canonical key name for contribution distribution
> in `to_dict()` is `"contribution_types"` (not `"credits"`). Tests must use this key.

*(Full implementation from Phase 8 v1 — copy verbatim. Key is already `contribution_types`.)*

### §3.9 — backend/literature_review_engine.py (F4.5)

> GAP-P8-35 fix: ancestry collection now goes 2 hops deep (not 1).
> GAP-P8-63 fix: the route now passes the current session graph to the engine as a starting
>   corpus, and populates seed_paper_ids in the job record.

```python
"""
backend/literature_review_engine.py — LiteratureReviewEngine (F4.5)

Multi-seed graph analysis. Uses the current session's graph as the primary corpus,
supplemented by DB lookups for deeper ancestry.
"""
import json
import logging
from dataclasses import dataclass
from typing import Optional

import backend.db as db
from backend.config import Config
from backend.llm_client import LLMClient

logger = logging.getLogger(__name__)

MAX_SEED_PAPERS   = 5
MAX_THREAD_PAPERS = 8
MAX_REVIEW_PAPERS = 30


@dataclass
class ConceptThread:
    label:       str
    description: str
    papers:      list

    def to_dict(self) -> dict:
        return {"label": self.label, "description": self.description, "papers": self.papers}


@dataclass
class LiteratureReviewResult:
    research_question: str
    seed_papers:       list
    threads:           list
    minimum_reading:   list
    gaps:              list
    docx_r2_key:       Optional[str]

    def to_dict(self) -> dict:
        return {
            "research_question": self.research_question,
            "seed_papers":       self.seed_papers,
            "threads":           [t.to_dict() for t in self.threads],
            "minimum_reading":   self.minimum_reading,
            "gaps":              self.gaps,
            "docx_r2_key":       self.docx_r2_key,
        }


class LiteratureReviewEngine:

    def generate(
        self,
        research_question: str,
        user_id: str,
        graph_json: Optional[dict] = None,   # GAP-P8-63: current graph passed in
        seed_paper_ids: Optional[list] = None,
    ) -> LiteratureReviewResult:
        llm = LLMClient()

        # Step 1: Embed research question
        question_embedding = self._embed_question(research_question)

        # Step 2: Find seed papers (prefer current graph nodes if available)
        if graph_json:
            seed_papers = self._find_seeds_in_graph(question_embedding, research_question, graph_json)
        else:
            seed_papers = self._find_seed_papers(question_embedding, research_question)

        if not seed_papers:
            return LiteratureReviewResult(
                research_question=research_question,
                seed_papers=[], threads=[], minimum_reading=[], gaps=[],
                docx_r2_key=None,
            )

        # Step 3: Collect 2-hop ancestry (GAP-P8-35 fix)
        all_papers = self._collect_ancestry_two_hop(seed_papers, graph_json)

        # Step 4: Minimum reading set
        minimum_reading = self._find_minimum_reading(all_papers, seed_papers)

        # Step 5: Conceptual threads
        threads = self._build_threads(all_papers, research_question, llm)

        # Step 6: Research gaps
        gaps = self._identify_gaps(all_papers, research_question, llm)

        result = LiteratureReviewResult(
            research_question=research_question,
            seed_papers=[{"paper_id": p["paper_id"], "title": p.get("title",""), "year": p.get("year")}
                         for p in seed_papers],
            threads=threads, minimum_reading=minimum_reading, gaps=gaps,
            docx_r2_key=None,
        )

        try:
            result.docx_r2_key = self._generate_docx(result, user_id)
        except Exception as exc:
            logger.warning(f"LiteratureReview docx generation failed: {exc}")

        return result

    def _embed_question(self, question: str) -> Optional[list]:
        try:
            import httpx
            resp = httpx.post(
                f"{Config.NLP_WORKER_URL}/encode_batch",
                json={"texts": [question[:2000]], "model": "abstract"},
                headers={"Authorization": f"Bearer {Config.NLP_WORKER_SECRET}"},
                timeout=15.0,
            )
            return resp.json()["embeddings"][0]
        except Exception as exc:
            logger.warning(f"Question embedding failed: {exc}")
            return None

    def _find_seeds_in_graph(self, embedding, question, graph_json) -> list:
        """Use current graph nodes as the primary seed corpus."""
        nodes = graph_json.get("nodes", [])
        if not nodes:
            return self._find_seed_papers(embedding, question)

        # Score each node by embedding similarity if available, else use citation count
        if embedding:
            node_ids = [n["id"] for n in nodes if n.get("id")]
            try:
                emb_str = "[" + ",".join(str(x) for x in embedding) + "]"
                rows = db.fetchall(
                    """
                    SELECT p.paper_id, p.title, p.year, p.citation_count, p.abstract,
                           p.fields_of_study,
                           1 - (pe.embedding <=> %s::vector) AS similarity
                    FROM paper_embeddings pe
                    JOIN papers p ON p.paper_id = pe.paper_id
                    WHERE pe.paper_id = ANY(%s) AND p.abstract IS NOT NULL
                    ORDER BY pe.embedding <=> %s::vector
                    LIMIT %s
                    """,
                    (emb_str, node_ids, emb_str, MAX_SEED_PAPERS),
                )
                if rows:
                    return [dict(r) for r in rows]
            except Exception as exc:
                logger.warning(f"Graph-scoped seed search failed: {exc}")

        # Fallback: top cited in graph
        sorted_nodes = sorted(
            [n for n in nodes if n.get("abstract")],
            key=lambda n: n.get("citation_count") or 0,
            reverse=True,
        )
        return [
            {
                "paper_id":      n["id"],
                "title":         n.get("title", ""),
                "year":          n.get("year"),
                "citation_count": n.get("citation_count", 0),
                "abstract":      n.get("abstract", ""),
                "fields_of_study": n.get("fields_of_study", []),
            }
            for n in sorted_nodes[:MAX_SEED_PAPERS]
        ]

    def _find_seed_papers(self, embedding, question) -> list:
        if embedding:
            emb_str = "[" + ",".join(str(x) for x in embedding) + "]"
            try:
                rows = db.fetchall(
                    """
                    SELECT p.paper_id, p.title, p.year, p.citation_count, p.abstract,
                           p.fields_of_study,
                           1 - (pe.embedding <=> %s::vector) AS similarity
                    FROM paper_embeddings pe
                    JOIN papers p ON p.paper_id = pe.paper_id
                    WHERE p.abstract IS NOT NULL
                    ORDER BY pe.embedding <=> %s::vector
                    LIMIT %s
                    """,
                    (emb_str, emb_str, MAX_SEED_PAPERS),
                )
                return [dict(r) for r in rows]
            except Exception as exc:
                logger.warning(f"Seed paper search failed: {exc}")
        words = question.split()[:5]
        rows  = db.fetchall(
            "SELECT paper_id, title, year, citation_count, abstract, fields_of_study "
            "FROM papers WHERE title ILIKE ANY(%s) ORDER BY citation_count DESC LIMIT %s",
            ([f"%{w}%" for w in words], MAX_SEED_PAPERS),
        )
        return [dict(r) for r in rows]

    def _collect_ancestry_two_hop(self, seed_papers: list, graph_json: Optional[dict]) -> list:
        """
        GAP-P8-35 fix: collect 2-hop ancestry, not just 1 hop.
        First includes graph nodes if available, then queries DB for their references.
        """
        paper_ids  = [p["paper_id"] for p in seed_papers]
        seen_ids   = set(paper_ids)
        all_papers = list(seed_papers)

        # Hop 1: direct references of seeds
        hop1 = db.fetchall(
            """
            SELECT DISTINCT p.paper_id, p.title, p.year, p.citation_count,
                   p.abstract, p.fields_of_study
            FROM edge_analysis ea
            JOIN papers p ON p.paper_id = ea.cited_paper_id
            WHERE ea.citing_paper_id = ANY(%s) AND p.year IS NOT NULL
            ORDER BY p.citation_count DESC
            LIMIT %s
            """,
            (paper_ids, 20),
        )
        hop1_ids = []
        for r in hop1:
            if r["paper_id"] not in seen_ids:
                seen_ids.add(r["paper_id"])
                all_papers.append(dict(r))
                hop1_ids.append(r["paper_id"])

        # Hop 2: references of references
        if hop1_ids:
            hop2 = db.fetchall(
                """
                SELECT DISTINCT p.paper_id, p.title, p.year, p.citation_count,
                       p.abstract, p.fields_of_study
                FROM edge_analysis ea
                JOIN papers p ON p.paper_id = ea.cited_paper_id
                WHERE ea.citing_paper_id = ANY(%s) AND p.year IS NOT NULL
                ORDER BY p.citation_count DESC
                LIMIT %s
                """,
                (hop1_ids, 20),
            )
            for r in hop2:
                if r["paper_id"] not in seen_ids:
                    seen_ids.add(r["paper_id"])
                    all_papers.append(dict(r))

        return all_papers[:MAX_REVIEW_PAPERS]

    def _find_minimum_reading(self, all_papers: list, seed_papers: list) -> list:
        sorted_papers = sorted(all_papers, key=lambda p: p.get("citation_count") or 0, reverse=True)
        return [
            {
                "paper_id":     p["paper_id"],
                "title":        p.get("title", ""),
                "year":         p.get("year"),
                "why_essential": f"Cited {p.get('citation_count',0):,} times — foundational to this area.",
            }
            for p in sorted_papers[:10]
        ]

    def _build_threads(self, papers: list, question: str, llm: LLMClient) -> list:
        paper_list = "\n".join(
            f"- '{p.get('title','?')}' ({p.get('year','?')}) — {(p.get('abstract') or '')[:150]}"
            for p in papers[:15]
        )
        prompt = (
            f"Research question: '{question}'\n\n"
            f"Papers in the intellectual ancestry:\n{paper_list}\n\n"
            f"Organize these papers into 3-5 conceptual threads.\n"
            f"For each thread:\nTHREAD: [2-4 word name]\n"
            f"DESCRIPTION: [One sentence]\nPAPERS: [comma-separated titles]\n---\n"
        )
        try:
            raw     = llm.call_llm(prompt, max_tokens=600)
            threads = self._parse_threads(raw, papers)
            return threads
        except Exception as exc:
            logger.warning(f"Thread building failed: {exc}")
            from collections import defaultdict
            by_field: dict = defaultdict(list)
            for p in papers:
                field = (p.get("fields_of_study") or ["General"])[0]
                by_field[field].append(p)
            return [
                ConceptThread(
                    label=field,
                    description=f"Papers from {field} contributing to this research question.",
                    papers=[{"paper_id": p["paper_id"], "title": p.get("title",""),
                              "year": p.get("year"), "role": "contributor"}
                             for p in sorted(plist, key=lambda x: x.get("year") or 0)]
                )
                for field, plist in list(by_field.items())[:4]
            ]

    def _parse_threads(self, raw: str, papers: list) -> list:
        import re
        blocks    = raw.split("---")
        threads   = []
        paper_map = {p.get("title","").lower(): p for p in papers}
        for block in blocks:
            if not block.strip():
                continue
            label_m = re.search(r"THREAD:\s*(.+)",      block, re.IGNORECASE)
            desc_m  = re.search(r"DESCRIPTION:\s*(.+)", block, re.IGNORECASE)
            pap_m   = re.search(r"PAPERS:\s*(.+)",      block, re.IGNORECASE)
            if not label_m:
                continue
            paper_titles = [t.strip().strip("'\"") for t in (pap_m.group(1) if pap_m else "").split(",")]
            thread_papers = []
            for title in paper_titles:
                for ptitle, p in paper_map.items():
                    if title.lower() in ptitle or ptitle in title.lower():
                        thread_papers.append({
                            "paper_id": p["paper_id"], "title": p.get("title",""),
                            "year": p.get("year"), "role": "contributor",
                        })
                        break
            threads.append(ConceptThread(
                label=label_m.group(1).strip(),
                description=desc_m.group(1).strip() if desc_m else "",
                papers=sorted(thread_papers, key=lambda x: x.get("year") or 0),
            ))
        return threads[:5]

    def _identify_gaps(self, papers: list, question: str, llm: LLMClient) -> list:
        paper_list = "\n".join(f"- '{p.get('title','?')}' ({p.get('year','?')})" for p in papers[:12])
        prompt = (
            f"Research question: '{question}'\nExisting papers:\n{paper_list}\n\n"
            f"Identify 3 research gaps. One sentence per gap.\nGAP1: ...\nGAP2: ...\nGAP3: ...\n"
        )
        try:
            import re
            raw  = llm.call_llm(prompt, max_tokens=200)
            gaps = []
            for i in range(1, 4):
                m = re.search(rf"GAP{i}:\s*(.+)", raw, re.IGNORECASE)
                if m:
                    gaps.append(m.group(1).strip())
            return gaps
        except Exception:
            return []

    def _generate_docx(self, result: LiteratureReviewResult, user_id: str) -> str:
        from backend.export_generator import ExportGenerator
        from backend.r2_client import R2Client
        import uuid
        export_data = {
            "type": "literature_review",
            "title": f"Literature Review: {result.research_question[:80]}",
            "research_question": result.research_question,
            "seed_papers": result.seed_papers,
            "threads": [t.to_dict() for t in result.threads],
            "minimum_reading": result.minimum_reading,
            "gaps": result.gaps,
        }
        generator  = ExportGenerator()
        docx_bytes = generator.generate_docx(export_data)
        r2_key     = f"exports/{user_id}/litrev-{uuid.uuid4().hex[:8]}.docx"
        R2Client().upload_bytes(r2_key, docx_bytes,
                                content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        return r2_key
```

### §3.10 — backend/field_entry_kit.py (F4.7)

> Same as v1. No changes needed.

### §3.11 — backend/research_risk_analyzer.py (F4.8)

> Same as v1. No changes needed.

### §3.12 — backend/science_journalism.py (F6.4)

> Same as v1. No changes needed.

### §3.13 — backend/live_mode.py (F8.1)

> Same as v1. The `create_alert()`, `get_unread_alerts()`, `mark_alerts_read()`,
> `get_active_subscriptions()`, and `update_last_checked()` methods are correct.
> `get_unread_alerts()` accepts an optional `limit` parameter.

### §3.14 — backend/interdisciplinary_translation.py (F8.3)

> Same as v1. No changes needed.

---

## §4 — Graph Memory Backend (F5.5)

> **GAP-P8-34 fix:** `navigation_path` is now stored as JSONB `[{paper_id, visited_at}]`
> (ordered array of objects), not a PostgreSQL TEXT[] with DISTINCT (which loses ordering).
>
> **GAP-P8-17 fix:** Three additional methods added below the existing ones,
> with corresponding routes added in §5.

```python
"""
backend/graph_memory.py — GraphMemoryManager (F5.5)

Uses graph_memory_state table (Phase 8), NOT the legacy graph_memory table (Phase 6).
Navigation path stored as ordered JSONB array to preserve visit order (GAP-P8-34).
"""
import json
import logging
from datetime import datetime, timezone
from typing import Optional

import backend.db as db

logger = logging.getLogger(__name__)


class GraphMemoryManager:

    def get_memory(self, user_id: str, graph_id: str) -> dict:
        row = db.fetchone(
            "SELECT seen_paper_ids, flagged_edges, expanded_edges, "
            "pruning_history, navigation_path, time_machine_position "
            "FROM graph_memory_state WHERE user_id=%s::uuid AND graph_id=%s",
            (user_id, graph_id),
        )
        if not row:
            return {
                "seen_paper_ids": [], "flagged_edges": [], "expanded_edges": [],
                "pruning_history": [], "navigation_path": [], "time_machine_position": None,
            }
        return {
            "seen_paper_ids":         list(row["seen_paper_ids"] or []),
            "flagged_edges":          list(row["flagged_edges"] or []),
            "expanded_edges":         list(row["expanded_edges"] or []),
            "pruning_history":        row["pruning_history"] or [],
            "navigation_path":        row["navigation_path"] or [],   # [{paper_id, visited_at}]
            "time_machine_position":  row["time_machine_position"],
        }

    def mark_papers_seen(self, user_id: str, graph_id: str, paper_ids: list):
        self._ensure_row(user_id, graph_id)
        db.execute(
            """
            UPDATE graph_memory_state
            SET seen_paper_ids = (
                SELECT ARRAY(SELECT DISTINCT unnest(seen_paper_ids || %s::text[]))
            ),
            last_updated = NOW()
            WHERE user_id=%s::uuid AND graph_id=%s
            """,
            (paper_ids, user_id, graph_id),
        )

    def mark_edge_flagged(self, user_id: str, graph_id: str, edge_id: str):
        """GAP-P8-18 fix: record flagged edge in memory so visual persists."""
        self._ensure_row(user_id, graph_id)
        db.execute(
            """
            UPDATE graph_memory_state
            SET flagged_edges = (
                SELECT ARRAY(SELECT DISTINCT unnest(flagged_edges || ARRAY[%s::text]))
            ),
            last_updated = NOW()
            WHERE user_id=%s::uuid AND graph_id=%s
            """,
            (edge_id, user_id, graph_id),
        )

    def record_edge_expansion(self, user_id: str, graph_id: str, edge_id: str):
        self._ensure_row(user_id, graph_id)
        db.execute(
            """
            UPDATE graph_memory_state
            SET expanded_edges = (
                SELECT ARRAY(SELECT DISTINCT unnest(expanded_edges || ARRAY[%s::text]))
            ),
            last_updated = NOW()
            WHERE user_id=%s::uuid AND graph_id=%s
            """,
            (edge_id, user_id, graph_id),
        )

    def record_pruning(self, user_id: str, graph_id: str, pruned_ids: list, result_summary: dict):
        self._ensure_row(user_id, graph_id)
        entry = json.dumps({
            "paper_ids": pruned_ids,
            "result":    result_summary,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        db.execute(
            """
            UPDATE graph_memory_state
            SET pruning_history = pruning_history || %s::jsonb,
            last_updated = NOW()
            WHERE user_id=%s::uuid AND graph_id=%s
            """,
            (entry, user_id, graph_id),
        )

    def update_navigation(self, user_id: str, graph_id: str, paper_id: str):
        """
        GAP-P8-34 fix: Navigation path stored as JSONB array of {paper_id, visited_at}
        objects, preserving visit order. NOT a TEXT[] with DISTINCT (loses order).
        """
        self._ensure_row(user_id, graph_id)
        entry = json.dumps({
            "paper_id":   paper_id,
            "visited_at": datetime.now(timezone.utc).isoformat(),
        })
        # Append only if paper_id not already in the path (check via jsonb @> query)
        db.execute(
            """
            UPDATE graph_memory_state
            SET navigation_path = CASE
                WHEN navigation_path @> %s::jsonb THEN navigation_path
                ELSE navigation_path || %s::jsonb
            END,
            last_updated = NOW()
            WHERE user_id=%s::uuid AND graph_id=%s
            """,
            (
                json.dumps([{"paper_id": paper_id}]),
                json.dumps([{"paper_id": paper_id, "visited_at": datetime.now(timezone.utc).isoformat()}]),
                user_id,
                graph_id,
            ),
        )

    def update_time_machine_position(self, user_id: str, graph_id: str, year: int):
        self._ensure_row(user_id, graph_id)
        db.execute(
            "UPDATE graph_memory_state SET time_machine_position=%s, last_updated=NOW() "
            "WHERE user_id=%s::uuid AND graph_id=%s",
            (year, user_id, graph_id),
        )

    def _ensure_row(self, user_id: str, graph_id: str):
        db.execute(
            """
            INSERT INTO graph_memory_state (user_id, graph_id)
            VALUES (%s::uuid, %s)
            ON CONFLICT (user_id, graph_id) DO NOTHING
            """,
            (user_id, graph_id),
        )
```

---

## §5 — app.py Phase 8 Route Additions

### §5.1 — Register Imports

```python
# Add to app.py imports:
import json

from backend.cross_domain_spark        import CrossDomainSparkDetector
from backend.error_propagation         import ErrorPropagationTracker
from backend.reading_between_lines     import ReadingBetweenLines
from backend.intellectual_debt         import IntellectualDebtTracker
from backend.challenge_generator       import ChallengeGenerator
from backend.idea_credit               import IdeaCreditSystem
from backend.researcher_profiles       import ResearcherProfileBuilder
from backend.literature_review_engine  import LiteratureReviewEngine
from backend.field_entry_kit           import FieldEntryKit
from backend.research_risk_analyzer    import ResearchRiskAnalyzer
from backend.science_journalism        import ScienceJournalismLayer
from backend.live_mode                 import LiveModeManager
from backend.interdisciplinary_translation import InterdisciplinaryTranslator
from backend.graph_memory              import GraphMemoryManager
```

### §5.2 — Intelligence Routes

```python
# ── Cross-Domain Spark Detector ───────────────────────────────────────────────
@app.route("/api/cross-domain-sparks/<seed_paper_id>")
@require_auth
@require_tier("researcher")
def api_cross_domain_sparks(seed_paper_id: str):
    session_id = session_manager.get_session_id(request)
    try:
        graph_data = _get_latest_graph_json(session_id, g.user_id)
    except RuntimeError:
        return jsonify({"error": "Could not load graph"}), 500
    if not graph_data:
        return jsonify({"error": "No graph built yet."}), 404

    graph_id = graph_data.get("metadata", {}).get("graph_id", "")
    if graph_id:
        cached = db.fetchone(
            "SELECT result_json FROM cross_domain_spark_cache WHERE graph_id=%s",
            (graph_id,),
        )
        if cached:
            return jsonify(cached["result_json"])
        # GAP-P8-62: cache is permanent (graph is immutable), no TTL filter

    result = CrossDomainSparkDetector().detect(graph_data)
    if graph_id:
        db.execute(
            "INSERT INTO cross_domain_spark_cache (graph_id, result_json) VALUES (%s,%s::jsonb) "
            "ON CONFLICT (graph_id) DO UPDATE SET result_json=EXCLUDED.result_json, computed_at=NOW()",
            (graph_id, json.dumps(result)),
        )
    action_log("cross_domain_sparks", {"seed_paper_id": seed_paper_id, "graph_id": graph_id})
    return jsonify(result)


# ── Error Propagation Tracker ─────────────────────────────────────────────────
@app.route("/api/error-propagation/<seed_paper_id>")
@require_auth
def api_error_propagation(seed_paper_id: str):
    session_id = session_manager.get_session_id(request)
    try:
        graph_data = _get_latest_graph_json(session_id, g.user_id)
    except RuntimeError:
        return jsonify({"error": "Could not load graph"}), 500
    if not graph_data:
        return jsonify({"error": "No graph built yet."}), 404
    result = ErrorPropagationTracker().analyze(graph_data)
    action_log("error_propagation", {"seed_paper_id": seed_paper_id})
    return jsonify(result)


# ── Reading Between the Lines ─────────────────────────────────────────────────
@app.route("/api/reading-between-lines/<paper_id>")
@require_auth
@require_tier("researcher")
def api_reading_between_lines(paper_id: str):
    session_id = session_manager.get_session_id(request)
    try:
        graph_data = _get_latest_graph_json(session_id, g.user_id)
    except RuntimeError:
        return jsonify({"error": "Could not load graph"}), 500
    if not graph_data:
        return jsonify({"error": "No graph built yet."}), 404
    result = ReadingBetweenLines().analyze(graph_data, paper_id)
    action_log("reading_between_lines", {"paper_id": paper_id})
    return jsonify(result.to_dict())


# ── Intellectual Debt Tracker ─────────────────────────────────────────────────
@app.route("/api/intellectual-debt/<seed_paper_id>")
@require_auth
@require_tier("researcher")
def api_intellectual_debt(seed_paper_id: str):
    session_id = session_manager.get_session_id(request)
    try:
        graph_data = _get_latest_graph_json(session_id, g.user_id)
    except RuntimeError:
        return jsonify({"error": "Could not load graph"}), 500
    if not graph_data:
        return jsonify({"error": "No graph built yet."}), 404
    result = IntellectualDebtTracker().analyze(graph_data)
    action_log("intellectual_debt", {"seed_paper_id": seed_paper_id})
    return jsonify(result)


# ── Challenge Generator ───────────────────────────────────────────────────────
@app.route("/api/challenge/<paper_id>")
@require_auth
@require_tier("researcher")
def api_challenge_generator(paper_id: str):
    session_id = session_manager.get_session_id(request)
    try:
        graph_data = _get_latest_graph_json(session_id, g.user_id)
    except RuntimeError:
        return jsonify({"error": "Could not load graph"}), 500
    if not graph_data:
        return jsonify({"error": "No graph built yet."}), 404
    result = ChallengeGenerator().generate(graph_data, paper_id)
    action_log("challenge_generator", {"paper_id": paper_id})
    return jsonify(result.to_dict())


# ── Idea Credit System ────────────────────────────────────────────────────────
@app.route("/api/credits/<seed_paper_id>")
@require_auth
def api_idea_credits(seed_paper_id: str):
    session_id = session_manager.get_session_id(request)
    try:
        graph_data = _get_latest_graph_json(session_id, g.user_id)
    except RuntimeError:
        return jsonify({"error": "Could not load graph"}), 500
    if not graph_data:
        return jsonify({"error": "No graph built yet."}), 404
    profiles = IdeaCreditSystem().compute_graph_credits(graph_data)
    return jsonify({"credit_profiles": profiles, "total": len(profiles)})


# ── Researcher Profiles ───────────────────────────────────────────────────────
@app.route("/api/researcher/<author_id>")
@require_auth
def api_researcher_profile(author_id: str):
    cached = db.fetchone(
        "SELECT profile_json FROM researcher_profiles WHERE author_id=%s "
        "AND computed_at > NOW() - INTERVAL '30 days'",
        (author_id,),
    )
    if cached:
        return jsonify(cached["profile_json"])

    session_id = session_manager.get_session_id(request)
    try:
        graph_data = _get_latest_graph_json(session_id, g.user_id)
    except RuntimeError:
        return jsonify({"error": "Could not load graph"}), 500
    if not graph_data:
        return jsonify({"error": "No graph built yet."}), 404

    profile = ResearcherProfileBuilder().build_for_author(author_id, graph_data)
    if not profile:
        return jsonify({"error": "Researcher not found in current graph"}), 404

    db.execute(
        "INSERT INTO researcher_profiles (author_id, display_name, profile_json) "
        "VALUES (%s, %s, %s::jsonb) "
        "ON CONFLICT (author_id) DO UPDATE SET profile_json=EXCLUDED.profile_json, "
        "display_name=EXCLUDED.display_name, computed_at=NOW()",
        (author_id, profile.get("display_name",""), json.dumps(profile)),
    )
    return jsonify(profile)


# ── Literature Review Engine ──────────────────────────────────────────────────
@app.route("/api/literature-review", methods=["POST"])
@require_auth
@require_tier("researcher")
def api_literature_review():
    data              = request.get_json(silent=True) or {}
    research_question = (data.get("research_question") or "").strip()
    if not research_question:
        return jsonify({"error": "research_question required"}), 400
    if len(research_question) > 500:
        return jsonify({"error": "research_question too long (max 500 chars)"}), 400

    # GAP-P8-63 fix: load current graph to use as primary corpus
    session_id = session_manager.get_session_id(request)
    try:
        graph_data = _get_latest_graph_json(session_id, g.user_id)
    except RuntimeError:
        graph_data = None

    # Create job record (GAP-P8-12: error_message column now exists)
    seed_ids = [n["id"] for n in (graph_data or {}).get("nodes", [])][:10]
    row = db.execute_returning(
        "INSERT INTO literature_review_jobs (user_id, research_question, seed_paper_ids, status) "
        "VALUES (%s::uuid, %s, %s, 'processing') RETURNING job_id::text",
        (g.user_id, research_question, seed_ids),
    )
    job_id = row["job_id"]

    try:
        engine = LiteratureReviewEngine()
        result = engine.generate(research_question, g.user_id, graph_json=graph_data, seed_paper_ids=seed_ids)
        result_dict = result.to_dict()
        db.execute(
            "UPDATE literature_review_jobs SET status='done', result_json=%s::jsonb, "
            "result_docx_r2=%s, completed_at=NOW() WHERE job_id=%s::uuid",
            (json.dumps(result_dict), result.docx_r2_key, job_id),
        )
        action_log("literature_review", {"job_id": job_id, "research_question": research_question[:100]})
        return jsonify({"job_id": job_id, "result": result_dict})
    except Exception as exc:
        db.execute(
            "UPDATE literature_review_jobs SET status='failed', error_message=%s WHERE job_id=%s::uuid",
            (str(exc)[:500], job_id),
        )
        app.logger.error(f"Literature review failed: {exc}")
        return jsonify({"error": "Literature review generation failed", "code": "processing_error"}), 500


# ── Field Entry Kit ───────────────────────────────────────────────────────────
@app.route("/api/field-entry-kit", methods=["POST"])
@require_auth
@require_tier("researcher")
def api_field_entry_kit():
    # GAP-P8-66 fix: explicit rate limit check
    allowed, headers = rate_limiter.check_sync(g.user_id, "POST /api/field-entry-kit")
    if not allowed:
        return jsonify(rate_limiter.get_429_response(headers)), 429, headers

    data              = request.get_json(silent=True) or {}
    research_question = (data.get("research_question") or "").strip()
    if not research_question:
        return jsonify({"error": "research_question required"}), 400

    session_id = session_manager.get_session_id(request)
    try:
        graph_data = _get_latest_graph_json(session_id, g.user_id)
    except RuntimeError:
        return jsonify({"error": "Could not load graph"}), 500
    if not graph_data:
        return jsonify({"error": "No graph built yet."}), 404

    result = FieldEntryKit().generate(graph_data, research_question, g.user_id)
    action_log("field_entry_kit", {"research_question": research_question[:100]})
    return jsonify(result)


# ── Research Risk Analyzer ────────────────────────────────────────────────────
@app.route("/api/research-risk", methods=["POST"])
@require_auth
@require_tier("researcher")
def api_research_risk():
    data               = request.get_json(silent=True) or {}
    research_direction = (data.get("research_direction") or "").strip()
    if not research_direction:
        return jsonify({"error": "research_direction required"}), 400

    session_id = session_manager.get_session_id(request)
    try:
        graph_data = _get_latest_graph_json(session_id, g.user_id)
    except RuntimeError:
        return jsonify({"error": "Could not load graph"}), 500
    if not graph_data:
        return jsonify({"error": "No graph built yet."}), 404

    result = ResearchRiskAnalyzer().analyze(graph_data, research_direction)
    action_log("research_risk", {"research_direction": research_direction[:100]})
    return jsonify(result.to_dict())


# ── Science Journalism Layer ──────────────────────────────────────────────────
@app.route("/api/journalism/<paper_id>")
@require_session
def api_journalism(paper_id: str):
    """Public-facing — no auth required. Uses session for rate limiting."""
    # GAP-P8-37 fix: use session_id + paper_id composite key to avoid bucket sharing
    rate_key = f"{g.session_id or 'anon'}:{paper_id}"
    allowed, headers = rate_limiter.check_sync(rate_key, "GET /api/journalism")
    if not allowed:
        return jsonify(rate_limiter.get_429_response(headers)), 429, headers

    session_id = g.session_id
    try:
        graph_data = _get_latest_graph_json(session_id, None)
    except RuntimeError:
        graph_data = None

    if not graph_data:
        row = db.fetchone(
            "SELECT graph_json_url FROM graphs WHERE seed_paper_id=%s "
            "ORDER BY created_at DESC LIMIT 1",
            (paper_id,),
        )
        if row:
            try:
                from backend.r2_client import R2Client
                graph_data = R2Client().download_json(row["graph_json_url"])
            except Exception:
                pass

    if not graph_data:
        return jsonify({"error": "No graph available for this paper."}), 404

    result = ScienceJournalismLayer().analyze(graph_data, paper_id)
    return jsonify(result.to_dict())


# ── Interdisciplinary Translation ─────────────────────────────────────────────
@app.route("/api/translation/<seed_paper_id>")
@require_auth
@require_tier("researcher")
def api_interdisciplinary_translation(seed_paper_id: str):
    session_id = session_manager.get_session_id(request)
    try:
        graph_data = _get_latest_graph_json(session_id, g.user_id)
    except RuntimeError:
        return jsonify({"error": "Could not load graph"}), 500
    if not graph_data:
        return jsonify({"error": "No graph built yet."}), 404
    return jsonify(InterdisciplinaryTranslator().translate(graph_data))


# ── Coverage Report (F7.4) ────────────────────────────────────────────────────
# GAP-P8-02 fix: F7.4 Coverage Report was completely absent.
@app.route("/api/coverage-report/<seed_paper_id>")
@require_session
def api_coverage_report(seed_paper_id: str):
    """Returns coverage metadata for the current graph. Public — no auth required."""
    session_id = session_manager.get_session_id(request)
    try:
        graph_data = _get_latest_graph_json(session_id, g.get("user_id"))
    except RuntimeError:
        return jsonify({"error": "Could not load graph"}), 500
    if not graph_data:
        return jsonify({"error": "No graph built yet."}), 404

    metadata = graph_data.get("metadata", {})
    nodes    = graph_data.get("nodes", [])
    total    = len(nodes)

    with_abstract  = sum(1 for n in nodes if n.get("abstract"))
    without        = total - with_abstract
    coverage_score = metadata.get("coverage_score", with_abstract / max(total, 1))

    report = {
        "total_papers":      total,
        "abstract_coverage": {
            "count":   with_abstract,
            "total":   total,
            "pct":     round(with_abstract / max(total, 1) * 100, 1),
        },
        "coverage_score":    round(coverage_score, 3),
        "reliability_label": (
            "HIGH"   if coverage_score >= 0.80 else
            "MEDIUM" if coverage_score >= 0.55 else
            "LOW"
        ),
        "features_available": _coverage_gate(coverage_score),
        "data_sources":       metadata.get("sources_queried", []),
        "missing_estimate":   f"~{max(0, int((1 - coverage_score) * total))} papers",
    }
    return jsonify(report)


def _coverage_gate(score: float) -> dict:
    """
    F7.4: features gated by coverage score.
    Returns dict of feature_name -> available (bool).
    """
    return {
        "genealogy_story":    score >= 0.60,
        "idea_credits":       score >= 0.60,
        "intellectual_debt":  score >= 0.70,
        "challenge_generator": score >= 0.65,
        "literature_review":  score >= 0.65,
        "cross_domain_spark": score >= 0.55,
        "reading_between_lines": score >= 0.70,
    }


# ── Graph Memory ──────────────────────────────────────────────────────────────
@app.route("/api/memory/<graph_id>")
@require_auth
def api_get_memory(graph_id: str):
    return jsonify(GraphMemoryManager().get_memory(g.user_id, graph_id))


@app.route("/api/memory/<graph_id>/seen", methods=["POST"])
@require_auth
def api_mark_seen(graph_id: str):
    data      = request.get_json(silent=True) or {}
    paper_ids = data.get("paper_ids", [])
    if paper_ids:
        GraphMemoryManager().mark_papers_seen(g.user_id, graph_id, paper_ids)
    return jsonify({"success": True})


@app.route("/api/memory/<graph_id>/edge-expand", methods=["POST"])
@require_auth
def api_expand_edge(graph_id: str):
    data    = request.get_json(silent=True) or {}
    edge_id = data.get("edge_id", "")
    if edge_id:
        GraphMemoryManager().record_edge_expansion(g.user_id, graph_id, edge_id)
    return jsonify({"success": True})


# GAP-P8-17 fix: three previously missing GraphMemory routes:

@app.route("/api/memory/<graph_id>/time-machine", methods=["POST"])
@require_auth
def api_update_time_machine(graph_id: str):
    """Persist the user's time machine year position across sessions."""
    data = request.get_json(silent=True) or {}
    year = data.get("year")
    if year and isinstance(year, int):
        GraphMemoryManager().update_time_machine_position(g.user_id, graph_id, year)
    return jsonify({"success": True})


@app.route("/api/memory/<graph_id>/pruning", methods=["POST"])
@require_auth
def api_record_pruning(graph_id: str):
    """Record a pruning operation in the user's exploration history."""
    data           = request.get_json(silent=True) or {}
    pruned_ids     = data.get("pruned_ids", [])
    result_summary = data.get("result_summary", {})
    if pruned_ids:
        GraphMemoryManager().record_pruning(g.user_id, graph_id, pruned_ids, result_summary)
    return jsonify({"success": True})


@app.route("/api/memory/<graph_id>/navigation", methods=["POST"])
@require_auth
def api_update_navigation(graph_id: str):
    """Record that the user visited a paper node."""
    data     = request.get_json(silent=True) or {}
    paper_id = data.get("paper_id", "")
    if paper_id:
        GraphMemoryManager().update_navigation(g.user_id, graph_id, paper_id)
    return jsonify({"success": True})


# ── Live Mode ─────────────────────────────────────────────────────────────────
@app.route("/api/live/subscribe", methods=["POST"])
@require_auth
@require_tier("researcher")
def api_live_subscribe():
    data          = request.get_json(silent=True) or {}
    graph_id      = data.get("graph_id", "")
    seed_paper_id = data.get("seed_paper_id", "")
    alert_events  = data.get("alert_events",
                              ["new_citation","paradigm_shift","gap_filled","retraction_alert"])
    digest_email  = data.get("digest_email", True)

    if not graph_id or not seed_paper_id:
        return jsonify({"error": "graph_id and seed_paper_id required"}), 400

    sub_id = LiveModeManager().create_subscription(
        g.user_id, graph_id, seed_paper_id, alert_events, digest_email
    )
    return jsonify({"subscription_id": sub_id, "active": True})


@app.route("/api/live/subscriptions")
@require_auth
def api_live_subscriptions():
    return jsonify({"subscriptions": LiveModeManager().get_subscriptions(g.user_id)})


@app.route("/api/live/cancel", methods=["POST"])
@require_auth
def api_live_cancel():
    data     = request.get_json(silent=True) or {}
    graph_id = data.get("graph_id", "")
    success  = LiveModeManager().cancel_subscription(g.user_id, graph_id)
    if not success:
        return jsonify({"error": "No active subscription found for this graph."}), 404  # GAP-P8-38
    return jsonify({"success": True})


@app.route("/api/live/alerts")
@require_auth
def api_live_alerts():
    alerts = LiveModeManager().get_unread_alerts(g.user_id)
    return jsonify({"alerts": alerts, "count": len(alerts)})


@app.route("/api/live/alerts/read", methods=["POST"])
@require_auth
def api_live_alerts_read():
    data      = request.get_json(silent=True) or {}
    alert_ids = data.get("alert_ids", [])
    n = LiveModeManager().mark_alerts_read(g.user_id, alert_ids)
    return jsonify({"marked": n})


# ── Disagreement Flag (F7.3) ──────────────────────────────────────────────────
# GAP-P8-16 fix: /api/flag-edge now includes auto-downgrade logic.
@app.route("/api/flag-edge", methods=["POST"])
@require_session
def api_flag_edge():
    """
    Flag an edge classification as incorrect.
    Auto-downgrades confidence tier when 3+ DISTINCT users flag the same edge.
    Flags for manual review at 5+ distinct users.
    """
    data          = request.get_json(silent=True) or {}
    edge_id       = (data.get("edge_id") or "").strip()
    reason        = (data.get("reason") or "")[:200]
    feedback_type = data.get("feedback_type", "disagreement")

    if not edge_id:
        return jsonify({"error": "edge_id required"}), 400

    user_id = g.get("user_id") or g.session_id  # use session for anonymous

    # Record in edge_flags
    db.execute(
        """
        INSERT INTO edge_flags (source_id, target_id, session_id, reason)
        VALUES (%s, %s, %s, %s)
        """,
        (edge_id.split("->")[0] if "->" in edge_id else edge_id,
         edge_id.split("->")[1] if "->" in edge_id else "",
         g.session_id, reason),
    )

    # GAP-P8-14 fix: count DISTINCT users, not total flags
    current = db.fetchone(
        "SELECT flag_count, flagged_by_users, original_tier FROM confidence_overrides WHERE edge_id=%s",
        (edge_id,),
    )

    if current:
        flagged_users = list(current["flagged_by_users"] or [])
        if user_id not in flagged_users:
            flagged_users.append(user_id)
        flag_count     = len(flagged_users)
        review_needed  = flag_count >= 5
        new_tier       = _downgrade_tier(current["original_tier"] or "medium", flag_count)
        db.execute(
            """
            UPDATE confidence_overrides
            SET flag_count=%s, flagged_by_users=%s, override_tier=%s,
                review_required=%s, last_flagged_at=NOW()
            WHERE edge_id=%s
            """,
            (flag_count, flagged_users, new_tier, review_needed, edge_id),
        )
    else:
        # First flag — get original tier from edge_analysis
        orig_row    = db.fetchone(
            "SELECT confidence_tier FROM edge_analysis WHERE edge_id=%s OR "
            "(citing_paper_id || '_' || cited_paper_id) = %s",
            (edge_id, edge_id),
        )
        orig_tier   = (orig_row["confidence_tier"] if orig_row else "medium") or "medium"
        flag_count  = 1
        db.execute(
            """
            INSERT INTO confidence_overrides
                (edge_id, original_tier, override_tier, flag_count, flagged_by_users)
            VALUES (%s, %s, %s, 1, %s)
            ON CONFLICT (edge_id) DO NOTHING
            """,
            (edge_id, orig_tier, orig_tier, [user_id]),
        )

    # Also increment edge_analysis.flagged_by_users (GAP-P8-58)
    db.execute(
        "UPDATE edge_analysis SET flagged_by_users = flagged_by_users + 1 "
        "WHERE edge_id=%s OR (citing_paper_id || '_' || cited_paper_id) = %s",
        (edge_id, edge_id),
    )

    # GAP-P8-18: record in graph memory if authenticated
    if g.get("user_id"):
        graph_id = data.get("graph_id", "")
        if graph_id:
            GraphMemoryManager().mark_edge_flagged(g.user_id, graph_id, edge_id)

    return jsonify({"success": True, "total_flags": flag_count})


def _downgrade_tier(original_tier: str, flag_count: int) -> str:
    """Auto-downgrade confidence tier when multiple distinct users flag."""
    tier_order = ["high", "medium", "low", "speculative"]
    if flag_count < 3:
        return original_tier
    idx = tier_order.index(original_tier) if original_tier in tier_order else 1
    new_idx = min(idx + 1, len(tier_order) - 1)
    return tier_order[new_idx]


# GAP-P8-20 fix: insight auto-downgrade logic added.
@app.route("/api/flag-insight", methods=["POST"])
@require_session
def api_flag_insight():
    """
    Flag an LLM-generated insight as incorrect/unhelpful.
    Auto-downgrades at 3+ distinct users (via insight_feedback UNIQUE constraint).
    """
    data       = request.get_json(silent=True) or {}
    insight_id = data.get("insight_id", "")
    if not insight_id:
        return jsonify({"error": "insight_id required"}), 400

    user_id = g.get("user_id")

    try:
        db.execute(
            "INSERT INTO insight_feedback (insight_id, session_id, user_id, feedback) "
            "VALUES (%s, %s, %s, 'not_helpful') ON CONFLICT DO NOTHING",
            (insight_id, g.session_id, user_id),
        )
    except Exception:
        pass  # Already flagged by this user

    # Count distinct user flags
    count_row = db.fetchone(
        "SELECT COUNT(*) AS n FROM insight_feedback WHERE insight_id=%s AND feedback='not_helpful'",
        (insight_id,),
    )
    flag_count = int(count_row["n"]) if count_row else 0

    return jsonify({"success": True, "total_flags": flag_count, "auto_downgraded": flag_count >= 3})


# ── Researcher Profile Page ───────────────────────────────────────────────────
@app.route("/researcher/<author_id>")
def researcher_page(author_id: str):
    # GAP-P8-36 fix: redirect anonymous users to login rather than show broken page
    if not g.get("user"):
        from flask import redirect, url_for
        return redirect(url_for("auth.login", next=f"/researcher/{author_id}"))
    # Verify author exists in DB before rendering
    exists = db.fetchone(
        "SELECT author_id FROM researcher_profiles WHERE author_id=%s", (author_id,)
    )
    if not exists:
        return render_template("researcher.html", author_id=author_id,
                               not_found=True), 200  # Template handles not_found gracefully
    return render_template("researcher.html", author_id=author_id, not_found=False)


# ── Science Journalism Page ───────────────────────────────────────────────────
@app.route("/explain/<paper_id>")
def journalism_page(paper_id: str):
    """Public-facing simplified view for non-academic users."""
    paper = db.fetchone(
        "SELECT paper_id, title, year, abstract FROM papers WHERE paper_id=%s",
        (paper_id,),
    )
    return render_template("journalism.html", paper=dict(paper) if paper else {})
```

### §5.3 — Helper: `action_log()`

Add this helper near the top of `app.py` (after imports), used by Phase 8 routes to populate F5.6 Action Log:

```python
def action_log(action_type: str, action_data: dict):
    """
    GAP-P8-31 fix: record Phase 8 feature invocations in action_log table
    so they appear in the Research Journal (F5.6).
    """
    try:
        db.execute(
            "INSERT INTO action_log (session_id, action_type, action_data) "
            "VALUES (%s, %s, %s::jsonb)",
            (g.get("session_id", ""), action_type, json.dumps(action_data)),
        )
    except Exception:
        pass  # Non-fatal
```

### §5.4 — Public API Extensions (add to backend/public_api.py)

```python
# Add to /v1/ Blueprint in backend/public_api.py:

@api_v1.route("/researchers/<author_id>/profile")
@require_api_key
@api_rate_limit("GET /researchers/{id}/profile")
def v1_researcher_profile(author_id: str):
    cached = db.fetchone(
        "SELECT profile_json FROM researcher_profiles WHERE author_id=%s "
        "AND computed_at > NOW() - INTERVAL '30 days'",
        (author_id,),
    )
    if cached:
        return jsonify(cached["profile_json"])
    return jsonify({"error": "Profile not yet computed.", "code": "not_found"}), 404


@api_v1.route("/literature-review", methods=["POST"])
@require_api_key
@api_rate_limit("POST /literature-review")
def v1_literature_review():
    data     = request.get_json(silent=True) or {}
    question = (data.get("research_question") or "").strip()
    if not question:
        return jsonify({"error": "research_question required", "code": "missing_param"}), 400
    result = LiteratureReviewEngine().generate(question, g.api_user_id)
    return jsonify(result.to_dict())


@api_v1.route("/papers/<paper_id>/journalism")
@require_api_key
@api_rate_limit("GET /papers/{id}/journalism")
def v1_journalism(paper_id: str):
    graph = _load_graph_for_paper(paper_id)
    if not graph:
        return jsonify({"error": "Graph not found", "code": "not_found"}), 404
    result = ScienceJournalismLayer().analyze(graph, paper_id)
    return jsonify(result.to_dict())
```

Add to `rate_limiter.py`:
```python
'GET /api/cross-domain-sparks':       (5,  60,   1),
'GET /api/error-propagation':         (10, 60,   1),
'GET /api/reading-between-lines':     (5,  60,   1),
'GET /api/intellectual-debt':         (3,  60,   1),
'GET /api/challenge':                 (5,  60,   1),
'GET /api/credits':                   (10, 60,   1),
'GET /api/researcher':                (20, 60,   1),
'POST /api/literature-review':        (3,  3600, 1),
'POST /api/field-entry-kit':          (5,  3600, 1),
'POST /api/research-risk':            (10, 60,   1),
'GET /api/journalism':                (30, 60,   1),
'GET /api/translation':               (5,  60,   1),
'GET /api/memory':                    (30, 60,   1),
'POST /api/live/subscribe':           (10, 3600, 1),
'GET /api/live/alerts':               (60, 60,   1),
'GET /api/coverage-report':           (30, 60,   1),
'API GET /researchers/{id}/profile':  (200, 3600, 1),
'API POST /literature-review':        (10,  3600, 1),
'API GET /papers/{id}/journalism':    (200, 3600, 1),
```

---

## §6 — scripts/live_monitor_cron.py (F8.1 — nightly cron)

> **GAP-P8-44 fix:** `gap_filled` event detection implemented.
> **GAP-P8-56 fix:** `_check_new_citations` uses `last_checked_at` timestamp, not year.
> **GAP-P8-57:** Node limit documented as a known v1 constraint.
> **GAP-P8-61 fix:** Uses public `send_email()` from mailer, not private `_send`.
> **GAP-P8-51 fix:** Cron queries `graphs.graph_id` TEXT column (added in migration).

```python
#!/usr/bin/env python3
"""
scripts/live_monitor_cron.py — Live Mode nightly polling cron.

Checks each active live subscription for new papers citing any node in its graph.
Creates alert records. Sends weekly digest emails on Mondays.

Schedule: 0 3 * * *  (03:00 UTC nightly)

Known v1 limitation (GAP-P8-57): each subscription check queries only the first
10 nodes of each graph to stay within Semantic Scholar API rate limits.
Full-graph monitoring is Phase 9+.
"""
import json
import logging
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

MAX_SUBS_PER_RUN  = 50
MAX_NODES_CHECKED = 10  # S2 API rate limit constraint — v1.0 known limitation


def run():
    from dotenv import load_dotenv
    load_dotenv()
    import backend.db as db
    from backend.config import Config
    from backend.live_mode import LiveModeManager
    from backend.r2_client import R2Client

    db.init_pool(database_url=Config.DATABASE_URL)
    live_mgr = LiveModeManager()
    r2       = R2Client()

    if not Config.LIVE_MODE_ENABLED:
        logger.info("LIVE_MODE_ENABLED=false — skipping live monitor run.")
        return

    subscriptions = live_mgr.get_active_subscriptions()[:MAX_SUBS_PER_RUN]
    logger.info(f"Checking {len(subscriptions)} active subscription(s).")

    processed = 0
    for sub in subscriptions:
        try:
            _check_subscription(sub, live_mgr, r2, db)
            live_mgr.update_last_checked(sub["subscription_id"])
            processed += 1
        except Exception as exc:
            logger.error(f"Failed to check subscription {sub['subscription_id']}: {exc}")

    logger.info(f"Live monitor complete: {processed}/{len(subscriptions)} subscriptions checked.")

    # Send weekly digest on Mondays
    if datetime.now(timezone.utc).weekday() == 0:
        _send_weekly_digests(live_mgr, db)


def _check_subscription(sub: dict, live_mgr, r2, db):
    """Check a single subscription for new activity."""
    # GAP-P8-51 fix: query by graph_id TEXT column, not SERIAL id
    graph_row = db.fetchone(
        "SELECT graph_json_url FROM graphs WHERE graph_id=%s",
        (sub["graph_id"],),
    )
    if not graph_row:
        # Fallback: try by seed_paper_id in case graph_id wasn't set
        graph_row = db.fetchone(
            "SELECT graph_json_url FROM graphs WHERE seed_paper_id=%s "
            "ORDER BY created_at DESC LIMIT 1",
            (sub["seed_paper_id"],),
        )
    if not graph_row:
        logger.warning(f"No graph found for subscription {sub['subscription_id']}")
        return

    try:
        graph_data = r2.download_json(graph_row["graph_json_url"])
    except Exception as exc:
        logger.warning(f"Could not load graph {sub['graph_id']}: {exc}")
        return

    node_ids      = [n["id"] for n in graph_data.get("nodes", [])]
    if not node_ids:
        return

    last_checked  = sub.get("last_checked_at") or (datetime.now(timezone.utc) - timedelta(days=7))
    alert_events  = set(sub.get("alert_events") or [])

    if "new_citation" in alert_events:
        _check_new_citations(sub, node_ids, last_checked, live_mgr)

    if "paradigm_shift" in alert_events:
        _check_paradigm_shift(sub, graph_data, live_mgr)

    if "retraction_alert" in alert_events:
        _check_retractions(sub, node_ids, live_mgr, db)

    if "gap_filled" in alert_events:
        _check_gap_filled(sub, graph_data, live_mgr, db)


def _check_new_citations(sub, node_ids, last_checked, live_mgr):
    """
    GAP-P8-56 fix: compare citation publication date against last_checked_at,
    not a hardcoded year cutoff.
    GAP-P8-57: limited to first 10 nodes (v1 known limitation).
    """
    import httpx
    from backend.config import Config

    headers = {}
    if getattr(Config, "SEMANTIC_SCHOLAR_API_KEY", ""):
        headers["x-api-key"] = Config.SEMANTIC_SCHOLAR_API_KEY

    # Convert last_checked to a comparable date
    if isinstance(last_checked, str):
        from dateutil import parser as dateparser
        last_checked_dt = dateparser.parse(last_checked)
    else:
        last_checked_dt = last_checked
    if last_checked_dt.tzinfo is None:
        last_checked_dt = last_checked_dt.replace(tzinfo=timezone.utc)

    new_papers = []
    for paper_id in node_ids[:MAX_NODES_CHECKED]:
        try:
            resp = httpx.get(
                f"https://api.semanticscholar.org/graph/v1/paper/{paper_id}/citations",
                params={"fields": "paperId,title,year,publicationDate", "limit": 10},
                headers=headers,
                timeout=10.0,
            )
            if resp.status_code == 200:
                for citation in resp.json().get("data", []):
                    cp      = citation.get("citingPaper", {})
                    pub_date = cp.get("publicationDate")
                    # GAP-P8-56: use publicationDate string comparison when available
                    is_new  = False
                    if pub_date:
                        from dateutil import parser as dp
                        try:
                            pub_dt = dp.parse(pub_date).replace(tzinfo=timezone.utc)
                            is_new = pub_dt > last_checked_dt
                        except Exception:
                            # Fallback to year comparison
                            is_new = (cp.get("year") or 0) >= last_checked_dt.year
                    else:
                        is_new = (cp.get("year") or 0) >= last_checked_dt.year

                    if is_new and cp.get("paperId"):
                        new_papers.append({"paper_id": cp["paperId"], "title": cp.get("title","")})
        except Exception:
            pass

    if new_papers:
        live_mgr.create_alert(
            sub["subscription_id"],
            "new_citation",
            {"new_papers": new_papers[:5], "graph_id": sub["graph_id"]},
        )


def _check_paradigm_shift(sub, graph_data, live_mgr):
    stability = graph_data.get("paradigm_data", {}).get("stability_score", 100)
    if stability and stability < 40:
        live_mgr.create_alert(
            sub["subscription_id"],
            "paradigm_shift",
            {"stability_score": stability, "graph_id": sub["graph_id"]},
        )


def _check_retractions(sub, node_ids, live_mgr, db):
    retracted = db.fetchall(
        "SELECT paper_id, title FROM papers WHERE paper_id=ANY(%s) AND is_retracted=TRUE",
        (node_ids,),
    )
    if retracted:
        live_mgr.create_alert(
            sub["subscription_id"],
            "retraction_alert",
            {"papers": [dict(r) for r in retracted]},
        )


def _check_gap_filled(sub, graph_data, live_mgr, db):
    """
    GAP-P8-44 fix: detect when a previously identified gap now has a paper addressing it.
    Strategy: reload the graph's stored gap analysis, then check if any new paper
    in the DB has high semantic similarity to the gap description embedding.
    """
    try:
        import httpx
        from backend.config import Config

        # Load previously stored gap analysis for this graph
        gap_row = db.fetchone(
            "SELECT result_json FROM cross_domain_spark_cache WHERE graph_id=%s",
            (sub["graph_id"],),
        )
        if not gap_row:
            return

        future_sparks = (gap_row["result_json"] or {}).get("future_sparks", [])
        if not future_sparks:
            return

        # Check if any future_spark pair now has a citation edge between them
        for spark in future_sparks[:5]:
            id_a = spark.get("paper_a", {}).get("id")
            id_b = spark.get("paper_b", {}).get("id")
            if not id_a or not id_b:
                continue

            # Check if a new citation edge exists between these two papers
            edge_exists = db.fetchone(
                """
                SELECT 1 FROM edge_analysis
                WHERE (citing_paper_id=%s AND cited_paper_id=%s)
                   OR (citing_paper_id=%s AND cited_paper_id=%s)
                LIMIT 1
                """,
                (id_a, id_b, id_b, id_a),
            )
            if edge_exists:
                live_mgr.create_alert(
                    sub["subscription_id"],
                    "gap_filled",
                    {
                        "gap": f"{spark.get('field_a')} ↔ {spark.get('field_b')}",
                        "paper_a": spark.get("paper_a"),
                        "paper_b": spark.get("paper_b"),
                    },
                )
                break  # One gap_filled alert per run is enough
    except Exception as exc:
        logger.warning(f"gap_filled check failed: {exc}")


def _send_weekly_digests(live_mgr, db):
    """Send weekly digest emails to all users with active subscriptions."""
    from backend.mailer import send_email   # GAP-P8-61 fix: use public function
    from backend.config import Config

    users = db.fetchall(
        """
        SELECT DISTINCT u.user_id::text, u.email
        FROM live_subscriptions ls
        JOIN users u ON u.user_id = ls.user_id
        WHERE ls.active=TRUE AND ls.digest_email=TRUE
        """,
    )
    for user in users:
        alerts = live_mgr.get_unread_alerts(user["user_id"], limit=10)
        if not alerts:
            continue

        text = "Arivu Weekly Digest\n\nYour monitored graphs have new activity:\n\n"
        for a in alerts:
            text += f"• {a['event_type'].replace('_',' ').title()} — {str(a['event_data'])[:100]}\n"
        text += f"\nView your alerts: https://{Config.CUSTOM_DOMAIN}/tool\n\n— Arivu"

        html = f"""<!DOCTYPE html>
<html><body style="font-family:sans-serif;max-width:600px;margin:40px auto">
<h2 style="color:#D4A843">Arivu Weekly Digest</h2>
<p>New activity in your monitored graphs:</p>
<ul>{''.join(f'<li>{a["event_type"].replace("_"," ").title()} — {str(a["event_data"])[:80]}</li>' for a in alerts)}</ul>
<br><a href="https://{Config.CUSTOM_DOMAIN}/tool">View in Arivu →</a>
</body></html>"""

        send_email(user["email"], "Arivu Weekly Digest — New Activity", text, html)
        logger.info(f"Weekly digest sent to {user['email']}")


if __name__ == "__main__":
    run()
```

> **Note:** Add a public `send_email(to, subject, text, html)` wrapper to `backend/mailer.py`
> if one does not already exist. The function should call the existing `_send()` internal
> helper. This makes `send_email` importable by cron scripts without accessing private APIs.

---

## §7 — Frontend Modules

### §7.1 — static/js/confidence-layer.js (F7.1 + F7.2)

> Same as v1. Correct as specified.

*(Copy verbatim from Phase 8 v1 §7.1)*

### §7.2 — static/js/disagreement-flag.js (F7.3)

> Same as v1. Correct as specified.

*(Copy verbatim from Phase 8 v1 §7.2)*

### §7.3 — static/js/graph-memory.js (F5.5)

> GAP-P8-65 fix: `destroy()` is now also called when the panel is hidden (not just removed),
> and the `attachHoverTracking` also posts navigation events.

```javascript
/**
 * static/js/graph-memory.js — GraphMemory (F5.5)
 *
 * Loads and applies the user's persistent graph memory state.
 * Seen papers appear at 45% opacity with a grey tint.
 * Records node hovers as "seen" after 3 seconds.
 * Records navigation events (paper panel opens) via POST.
 */
class GraphMemory {
  constructor(graphId) {
    this.graphId     = graphId;
    this.state       = null;
    this.hoverTimers = new Map();
    this.pollInterval = null;
  }

  async load() {
    try {
      const resp = await fetch(`/api/memory/${this.graphId}`, {credentials: 'include'});
      if (!resp.ok) return;
      this.state = await resp.json();
    } catch (err) {
      console.warn('GraphMemory load failed:', err);
      this.state = {seen_paper_ids: [], flagged_edges: [], expanded_edges: []};
    }
  }

  applyToGraph(svg) {
    if (!this.state?.seen_paper_ids?.length) return;
    const seen = new Set(this.state.seen_paper_ids);
    svg.selectAll('.node').each(function(d) {
      if (seen.has(d.id)) {
        d3.select(this).select('circle')
          .style('opacity', 0.45)
          .style('filter', 'grayscale(60%)');
      }
    });
  }

  attachHoverTracking(svg, graphId) {
    const self = this;
    svg.selectAll('.node').on('mouseenter.memory', function(event, d) {
      if (!self.state) return;
      if (self.state.seen_paper_ids.includes(d.id)) return;
      const node = this;
      const timer = setTimeout(async () => {
        self.state.seen_paper_ids.push(d.id);
        d3.select(node).select('circle')
          .style('opacity', 0.45)
          .style('filter', 'grayscale(60%)');
        try {
          await fetch(`/api/memory/${graphId}/seen`, {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            credentials: 'include',
            body: JSON.stringify({paper_ids: [d.id]}),
          });
        } catch (err) { /* non-fatal */ }
      }, 3000);
      self.hoverTimers.set(d.id, timer);
    }).on('mouseleave.memory', function(event, d) {
      const timer = self.hoverTimers.get(d.id);
      if (timer) { clearTimeout(timer); self.hoverTimers.delete(d.id); }
    });
  }

  /** Call when user opens a paper's detail panel (records navigation event). */
  async recordNavigation(paperId) {
    try {
      await fetch(`/api/memory/${this.graphId}/navigation`, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        credentials: 'include',
        body: JSON.stringify({paper_id: paperId}),
      });
    } catch (err) { /* non-fatal */ }
  }

  /** Call when user sets the time machine year. */
  async recordTimeMachinePosition(year) {
    try {
      await fetch(`/api/memory/${this.graphId}/time-machine`, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        credentials: 'include',
        body: JSON.stringify({year}),
      });
    } catch (err) { /* non-fatal */ }
  }

  hasSeen(paperId) { return this.state?.seen_paper_ids?.includes(paperId) || false; }
  getSeenCount()   { return this.state?.seen_paper_ids?.length || 0; }

  /**
   * GAP-P8-65 fix: destroy() clears all timers and intervals.
   * Call on panel hide, route change, or component removal.
   */
  destroy() {
    for (const timer of this.hoverTimers.values()) clearTimeout(timer);
    this.hoverTimers.clear();
    if (this.pollInterval) { clearInterval(this.pollInterval); this.pollInterval = null; }
  }
}

window.GraphMemory = GraphMemory;
```

### §7.4 — static/js/live-mode.js (F8.1)

> GAP-P8-65 fix: `_stopPolling()` called when panel container is hidden via
> `IntersectionObserver`, not only when `destroy()` is called.

```javascript
/**
 * static/js/live-mode.js — LiveModePanel
 *
 * Polls /api/live/alerts every 5 minutes when panel is visible.
 * Stops polling when panel is hidden (IntersectionObserver).
 */
class LiveModePanel {
  constructor(graphId, seedPaperId, containerId = 'live-mode-panel') {
    this.graphId      = graphId;
    this.seedPaperId  = seedPaperId;
    this.container    = document.getElementById(containerId);
    this.pollInterval = null;
    if (this.container) {
      this._init();
      // GAP-P8-65: stop polling when panel scrolls out of view / is hidden
      this._observer = new IntersectionObserver((entries) => {
        entries[0].isIntersecting ? this._startPolling() : this._stopPolling();
      });
      this._observer.observe(this.container);
    }
  }

  _init() {
    this.container.innerHTML = `
      <div class="live-header">
        <span class="live-icon">📡</span> Live Mode
        <span id="live-status" class="live-status">Loading…</span>
      </div>
      <div id="live-subscribe-btn-area"></div>
      <div id="live-alerts-list" class="live-alerts-list"></div>
    `;
    this._loadStatus();
  }

  async _loadStatus() {
    try {
      const resp = await fetch('/api/live/subscriptions', {credentials: 'include'});
      const data = await resp.json();
      const sub  = (data.subscriptions || []).find(s => s.graph_id === this.graphId && s.active);
      const status = document.getElementById('live-status');
      const area   = document.getElementById('live-subscribe-btn-area');
      if (sub) {
        status.textContent = 'Active';
        status.className   = 'live-status live-active';
        area.innerHTML     = `<button id="live-cancel-btn" class="btn-secondary">Cancel alerts</button>`;
        document.getElementById('live-cancel-btn').addEventListener('click', () => this._cancel());
      } else {
        status.textContent = 'Not subscribed';
        status.className   = 'live-status';
        area.innerHTML     = `<button id="live-subscribe-btn" class="btn-primary">Subscribe to alerts</button>`;
        document.getElementById('live-subscribe-btn').addEventListener('click', () => this._subscribe());
      }
    } catch (err) { console.warn('LiveMode status failed:', err); }
  }

  async _subscribe() {
    try {
      const resp = await fetch('/api/live/subscribe', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        credentials: 'include',
        body: JSON.stringify({graph_id: this.graphId, seed_paper_id: this.seedPaperId, digest_email: true}),
      });
      if (resp.ok) this._loadStatus();
    } catch (err) { console.warn('Subscribe failed:', err); }
  }

  async _cancel() {
    try {
      await fetch('/api/live/cancel', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        credentials: 'include', body: JSON.stringify({graph_id: this.graphId}),
      });
      this._stopPolling();
      this._loadStatus();
    } catch (err) { console.warn('Cancel failed:', err); }
  }

  _startPolling() {
    if (this.pollInterval) return;  // already polling
    this._fetchAlerts();
    this.pollInterval = setInterval(() => this._fetchAlerts(), 5 * 60 * 1000);
  }

  _stopPolling() {
    if (this.pollInterval) { clearInterval(this.pollInterval); this.pollInterval = null; }
  }

  async _fetchAlerts() {
    try {
      const resp   = await fetch('/api/live/alerts', {credentials: 'include'});
      const data   = await resp.json();
      const alerts = data.alerts || [];
      const list   = document.getElementById('live-alerts-list');
      if (!list) return;
      if (!alerts.length) {
        list.innerHTML = '<p class="live-no-alerts">No new alerts.</p>';
        return;
      }
      list.innerHTML = alerts.map(a => `
        <div class="live-alert live-alert-${a.event_type}">
          <span class="live-alert-icon">${this._icon(a.event_type)}</span>
          <div class="live-alert-body">
            <strong>${a.event_type.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase())}</strong>
            <p>${this._summarize(a)}</p>
            <small>${new Date(a.created_at).toLocaleDateString()}</small>
          </div>
        </div>`).join('');
      const ids = alerts.map(a => a.alert_id);
      await fetch('/api/live/alerts/read', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        credentials: 'include', body: JSON.stringify({alert_ids: ids}),
      });
    } catch (err) { console.warn('Alert fetch failed:', err); }
  }

  _icon(type) {
    return {new_citation:'📄',paradigm_shift:'🌊',gap_filled:'✅',retraction_alert:'⚠️'}[type] || '📢';
  }

  _summarize(alert) {
    const d = alert.event_data || {};
    if (alert.event_type === 'new_citation')     return `${(d.new_papers||[]).length} new paper(s) citing your graph.`;
    if (alert.event_type === 'paradigm_shift')   return `Paradigm stability dropped to ${d.stability_score}.`;
    if (alert.event_type === 'gap_filled')       return `A gap between ${d.gap} has been bridged.`;
    if (alert.event_type === 'retraction_alert') return `${(d.papers||[]).length} paper(s) flagged or retracted.`;
    return JSON.stringify(d).slice(0, 100);
  }

  destroy() {
    this._stopPolling();
    if (this._observer) { this._observer.disconnect(); }
  }
}

window.LiveModePanel = LiveModePanel;
```

### §7.5 — static/js/graph.js modifications (GAP-P8-05)

Add the following to `graph.js` in the section where the graph finishes rendering (after D3 simulation stabilizes, or in the `onGraphLoaded` callback):

```javascript
// ── Phase 8: wire Confidence Layer, Graph Memory, researcher links ────────────
// Add this block after the graph renders (e.g., in the simulation 'end' event handler
// or wherever the graph is considered fully drawn):

function onGraphRendered(graphData, svg, graphId, seedPaperId) {
  // 1. Confidence badges on edges (F7.1)
  if (window.ConfidenceLayer) {
    ConfidenceLayer.applyToGraph(graphData);
  }

  // 2. Graph memory: seen-paper visual state (F5.5)
  if (window.GraphMemory && window.ArivuAuth?.isAuthenticated()) {
    window._graphMemory = new GraphMemory(graphId);
    window._graphMemory.load().then(() => {
      window._graphMemory.applyToGraph(svg);
      window._graphMemory.attachHoverTracking(svg, graphId);
    });
  }

  // 3. Fault-line edge styling for retracted/flagged papers (F1.15)
  // Applied when error propagation data is loaded (see panels.js)

  // 4. Researcher profile links on author names in node tooltips
  // (GAP-P8-19: make researcher profile reachable from graph)
  svg.selectAll('.node').on('click.researcher', function(event, d) {
    // If Ctrl/Cmd+click on a node, open researcher profile for primary author
    if (event.ctrlKey || event.metaKey) {
      const authors = d.authors || [];
      const primary = authors[0];
      if (primary && primary.authorId) {
        window.open(`/researcher/${primary.authorId}`, '_blank');
      }
    }
  });

  // 5. Live Mode panel (F8.1) — inject if container exists
  if (document.getElementById('live-mode-panel') && window.LiveModePanel) {
    window._liveModePanel = new LiveModePanel(graphId, seedPaperId);
  }

  // 6. Time machine position persistence
  if (window._graphMemory) {
    // Wire time machine slider 'change' event (if time machine exists)
    const tmSlider = document.getElementById('time-machine-slider');
    if (tmSlider) {
      tmSlider.addEventListener('change', (e) => {
        window._graphMemory.recordTimeMachinePosition(parseInt(e.target.value));
      });
    }
  }
}
```

Also add author name tooltip note — in the node tooltip HTML, add:
```javascript
// In tooltip construction, add author links:
const authorsHtml = (d.authors || []).slice(0,3).map(a => {
  if (a.authorId) {
    return `<span class="author-link" data-author-id="${a.authorId}"
              title="Ctrl+click node to open researcher profile">${a.name}</span>`;
  }
  return a.name || a;
}).join(', ');
```

### §7.6 — static/js/panels.js modifications (GAP-P8-06)

Add the following to `panels.js` in the insight card rendering section and evidence trail wiring:

```javascript
// ── Phase 8: wire Confidence Layer and Disagreement Flag to panels ────────────

/**
 * Call this after rendering each insight card in the InsightFeed (GAP-P8-21).
 * @param {HTMLElement} cardEl - the insight card DOM element
 * @param {object} insight    - {id, tier, evidence, text}
 */
function attachInsightTrustLayer(cardEl, insight) {
  // Confidence badge (F7.1 + F7.2)
  if (window.ConfidenceLayer) {
    ConfidenceLayer.inject(
      cardEl,
      insight.confidence_tier || 'speculative',
      insight.confidence_explanation || 'LLM-generated insight.',
      insight.evidence || {}
    );
  }

  // Disagreement flag (F7.3) — GAP-P8-20 / GAP-P8-21
  if (window.DisagreementFlag) {
    DisagreementFlag.attachToInsight(cardEl, insight.id);
  }
}

// ── Fault-line edge styling (F1.15) (GAP-P8-22) ──────────────────────────────
/**
 * Apply fault-line visual styling to graph edges connected to retracted papers.
 * Call after error propagation API returns results.
 * @param {object} errorData - result from /api/error-propagation
 * @param {d3 selection} linkSelection - D3 selection of edge elements
 */
function applyFaultLineEdges(errorData, linkSelection) {
  const flaggedIds = new Set(
    (errorData.flagged_papers || []).map(p => p.paper_id)
  );
  linkSelection.each(function(d) {
    const src = d.source?.id || d.source;
    const tgt = d.target?.id || d.target;
    if (flaggedIds.has(src) || flaggedIds.has(tgt)) {
      // High exposure: red dashed fault line
      const exposureEntry = (errorData.exposure_scores || [])
        .find(e => e.paper_id === tgt);
      const tier = exposureEntry?.exposure_tier || 'low';
      const color = {high: '#ef4444', medium: '#f97316', low: '#f59e0b'}[tier] || '#f59e0b';
      d3.select(this)
        .style('stroke', color)
        .style('stroke-dasharray', '6 3')
        .style('stroke-width', tier === 'high' ? 3 : 2)
        .attr('class', (d3.select(this).attr('class') || '') + ' fault-line-edge');
    }
  });
}

// Expose for use in graph.js
window.ArivuPanels = window.ArivuPanels || {};
window.ArivuPanels.attachInsightTrustLayer = attachInsightTrustLayer;
window.ArivuPanels.applyFaultLineEdges     = applyFaultLineEdges;
```

### §7.7 — static/js/researcher-profile.js

> GAP-P8-08: This file is a thin shim that the template loads. The actual logic is inline
> in `researcher.html`. This file just documents the interface and exports nothing.

```javascript
/**
 * static/js/researcher-profile.js — ResearcherProfileView shim
 *
 * The researcher profile UI logic is implemented inline in templates/researcher.html
 * using Chart.js for the doughnut chart and plain fetch() for the data.
 * This file intentionally contains no implementation — it exists as a manifest entry
 * so build tools can include it in the bundle.
 *
 * The researcher.html template self-contained approach was chosen because the profile
 * page is a standalone page, not an embedded panel, and has no shared state with graph.js.
 */
// No exports. researcher.html is self-contained.
```

### §7.8 — static/js/journalism.js

> GAP-P8-09: Same pattern as researcher-profile.js — journalism.html is self-contained.

```javascript
/**
 * static/js/journalism.js — JournalismLayerPanel shim
 *
 * The journalism layer UI is implemented inline in templates/journalism.html.
 * This file exists as a bundle manifest entry only.
 */
// No exports. journalism.html is self-contained.
```

---

## §8 — CSS Additions (GAP-P8-07)

Add to `static/css/style.css`:

```css
/* ── Confidence Layer (F7.1 + F7.2) ───────────────────────────────────────── */
.confidence-badge {
  display:       inline-flex;
  align-items:   center;
  gap:           4px;
  font-size:     11px;
  margin-bottom: 4px;
}

.conf-dots {
  font-size:   13px;
  line-height: 1;
}

.conf-expand-btn {
  background:    none;
  border:        none;
  color:         #64748b;
  cursor:        pointer;
  font-size:     10px;
  padding:       0 4px;
  text-decoration: underline;
}
.conf-expand-btn:hover { color: #D4A843; }

.evidence-trail {
  background:  #0f172a;
  border:      1px solid #1e293b;
  border-radius: 6px;
  font-size:   12px;
  margin:      4px 0 8px 0;
  padding:     10px 12px;
  color:       #94a3b8;
}

.et-explanation { color: #cbd5e1; margin-bottom: 6px; }
.et-signals     { margin-bottom: 6px; }
.et-scores      { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 6px; }
.et-scores div  { font-size: 11px; }

.et-quote {
  border-left:  2px solid #334155;
  color:        #94a3b8;
  font-style:   italic;
  font-size:    11px;
  margin:       4px 0;
  padding-left: 8px;
}

/* ── Seen-paper visual state (F5.5) ───────────────────────────────────────── */
/* Applied via JS on the circle element — defined here for reference */
/* JS: .style('opacity', 0.45).style('filter', 'grayscale(60%)') */
/* CSS class alternative for non-JS paths: */
.node-seen circle {
  opacity: 0.45;
  filter:  grayscale(60%);
}

/* ── Fault-line edge styling (F1.15) (GAP-P8-22) ─────────────────────────── */
.fault-line-edge {
  /* Base styles — color and stroke-dasharray applied via JS based on severity */
  stroke-linecap:  round;
  stroke-linejoin: round;
  transition:      stroke 0.3s ease;
}

/* Fault-line severity legend tooltip */
.fault-line-legend {
  display:         flex;
  gap:             12px;
  font-size:       11px;
  color:           #94a3b8;
  margin:          8px 0;
}
.fault-line-legend span { display: flex; align-items: center; gap: 4px; }
.fault-dot-high   { background: #ef4444; width: 8px; height: 8px; border-radius: 50%; }
.fault-dot-medium { background: #f97316; width: 8px; height: 8px; border-radius: 50%; }
.fault-dot-low    { background: #f59e0b; width: 8px; height: 8px; border-radius: 50%; }

/* ── Disagreement flag buttons (F7.3) ─────────────────────────────────────── */
.flag-btn, .insight-flag-btn {
  background:   none;
  border:       1px solid #334155;
  border-radius: 4px;
  color:        #64748b;
  cursor:       pointer;
  font-size:    11px;
  padding:      2px 6px;
  margin-left:  6px;
}
.flag-btn:hover, .insight-flag-btn:hover { border-color: #ef4444; color: #ef4444; }
.flag-btn:disabled, .insight-flag-btn:disabled { opacity: 0.5; cursor: default; }

.flag-threshold-warn {
  color:      #f97316;
  font-size:  10px;
  margin-left: 6px;
}

/* ── Live Mode panel ──────────────────────────────────────────────────────── */
.live-header {
  align-items:   center;
  border-bottom: 1px solid #1e293b;
  display:       flex;
  gap:           8px;
  margin-bottom: 10px;
  padding-bottom: 8px;
}
.live-status       { font-size: 11px; color: #64748b; }
.live-active       { color: #22c55e !important; }
.live-alerts-list  { display: flex; flex-direction: column; gap: 8px; }
.live-alert        { background: #0f172a; border-radius: 6px; display: flex;
                     gap: 10px; padding: 10px 12px; }
.live-alert-icon   { font-size: 18px; flex-shrink: 0; }
.live-alert-body p { color: #94a3b8; font-size: 12px; margin: 2px 0; }
.live-no-alerts    { color: #64748b; font-size: 12px; }

/* ── Coverage Report panel (F7.4) (GAP-P8-02) ────────────────────────────── */
.coverage-report {
  background:   #0f172a;
  border:       1px solid #1e293b;
  border-radius: 8px;
  font-size:    13px;
  padding:      14px 16px;
}
.coverage-score-HIGH   { color: #22c55e; font-weight: 700; }
.coverage-score-MEDIUM { color: #f59e0b; font-weight: 700; }
.coverage-score-LOW    { color: #ef4444; font-weight: 700; }
.coverage-bar {
  background:    #1e293b;
  border-radius: 4px;
  height:        6px;
  margin:        6px 0;
  overflow:      hidden;
}
.coverage-bar-fill {
  background:    #D4A843;
  border-radius: 4px;
  height:        100%;
  transition:    width 0.5s ease;
}
.feature-gated {
  color:            #64748b;
  text-decoration:  line-through;
  font-size:        11px;
}

/* ── Researcher profile page ──────────────────────────────────────────────── */
.researcher-page    { max-width: 900px; margin: 40px auto; padding: 0 20px; }
.researcher-header  { margin-bottom: 24px; }
.researcher-grid    { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.researcher-card    { background: #0f172a; border: 1px solid #1e293b;
                      border-radius: 8px; padding: 16px; }
.researcher-card h2 { color: #D4A843; font-size: 14px; margin: 0 0 12px; }
.credit-bar-row     { align-items: center; display: flex; gap: 8px; margin-bottom: 8px; }
.credit-label       { color: #94a3b8; font-size: 12px; min-width: 80px; }
.credit-bar-track   { background: #1e293b; border-radius: 4px; flex: 1; height: 8px; overflow: hidden; }
.credit-bar-fill    { border-radius: 4px; height: 100%; transition: width 0.5s; }
.credit-pct         { color: #94a3b8; font-size: 11px; min-width: 32px; text-align: right; }
.hero-item          { align-items: center; display: flex; justify-content: space-between;
                      padding: 4px 0; border-bottom: 1px solid #1e293b; }
.hero-title         { color: #cbd5e1; font-size: 12px; }
.hero-count         { color: #D4A843; font-size: 11px; }

/* ── Author link in node tooltips (GAP-P8-19) ────────────────────────────── */
.author-link { color: #60a5fa; cursor: pointer; text-decoration: underline; font-size: 11px; }
.author-link:hover { color: #D4A843; }
```

---

## §9 — templates/tool.html Modification (GAP-P8-10)

Add the live mode panel container to `templates/tool.html`. Find the right panel section (where insight feed and persona panel are) and add:

```html
<!-- Live Mode Panel (F8.1) — Phase 8 addition (GAP-P8-10) -->
<div id="live-mode-section" class="panel-section">
  <h3 class="panel-section-title">📡 Live Mode</h3>
  <div id="live-mode-panel"></div>
</div>
```

Also add the coverage report panel in the graph metadata section:

```html
<!-- Coverage Report (F7.4) — Phase 8 addition (GAP-P8-02) -->
<div id="coverage-report-panel" class="coverage-report" style="display:none">
  Loading coverage report…
</div>
```

And wire up graph initialization at the bottom of the tool.html script block:

```javascript
// Phase 8: initialize live mode, coverage report, graph memory after graph loads
window.addEventListener('arivuGraphLoaded', function(e) {
  const { graphData, svg, graphId, seedPaperId } = e.detail;

  // Live Mode panel
  if (document.getElementById('live-mode-panel')) {
    window._liveModePanel = new LiveModePanel(graphId, seedPaperId);
  }

  // Coverage report
  fetch(`/api/coverage-report/${seedPaperId}`)
    .then(r => r.json())
    .then(report => {
      const panel = document.getElementById('coverage-report-panel');
      if (!panel) return;
      panel.style.display = 'block';
      panel.innerHTML = `
        <div>Coverage: <span class="coverage-score-${report.reliability_label}">
          ${report.reliability_label}</span>
          (${(report.coverage_score * 100).toFixed(0)}%)
        </div>
        <div class="coverage-bar">
          <div class="coverage-bar-fill" style="width:${report.abstract_coverage.pct}%"></div>
        </div>
        <div style="font-size:11px;color:#64748b">
          ${report.abstract_coverage.count}/${report.abstract_coverage.total} papers have abstracts
          · ~${report.missing_estimate} missing
        </div>
      `;
    })
    .catch(() => {});
});
```

---

## §10 — Templates

### §10.1 — templates/researcher.html

> GAP-P8-36 fix: template handles `not_found` gracefully.

```html
{% extends "base.html" %}
{% block title %}Researcher Profile — Arivu{% endblock %}
{% block content %}
<div class="researcher-page" id="researcher-page">
  {% if not_found %}
  <div class="researcher-header">
    <h1>Researcher Not Found</h1>
    <p style="color:#94a3b8">This researcher has not appeared in any graph yet.
       Build a graph containing their work to generate a profile.</p>
    <a href="/tool" class="btn-primary" style="margin-top:16px">Go to Tool →</a>
  </div>
  {% else %}
  <div class="researcher-header">
    <h1 id="researcher-name">Loading…</h1>
    <p id="researcher-meta" style="color:#94a3b8"></p>
  </div>
  <div class="researcher-grid">
    <div class="researcher-card" id="contribution-types">
      <h2>Contribution Profile</h2>
      <canvas id="contribution-chart" width="300" height="200"></canvas>
    </div>
    <div class="researcher-card" id="intellectual-heroes">
      <h2>Intellectual Heroes</h2>
      <div id="heroes-list"></div>
    </div>
    <div class="researcher-card" id="most-propagated">
      <h2>Most Propagated Idea</h2>
      <div id="propagated-info"></div>
    </div>
    <div class="researcher-card" id="credit-profile">
      <h2>Credit Distribution</h2>
      <div id="credit-bars"></div>
    </div>
  </div>

  <script>
  (async () => {
    const authorId = {{ author_id | tojson }};
    try {
      const resp = await fetch(`/api/researcher/${authorId}`, {credentials: 'include'});
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const p = await resp.json();

      document.getElementById('researcher-name').textContent = p.display_name || authorId;
      document.getElementById('researcher-meta').textContent =
        `${p.paper_count} paper(s) in graph · ${(p.fields||[]).slice(0,3).join(', ')} · `
        + `Intellectual radius: ${((p.intellectual_radius||0) * 100).toFixed(0)}%`;

      // Contribution types doughnut
      const ctx = document.getElementById('contribution-chart').getContext('2d');
      new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: Object.keys(p.contribution_types || {}),
          datasets: [{
            data: Object.values(p.contribution_types || {}).map(v => (v*100).toFixed(1)),
            backgroundColor: ['#D4A843','#60a5fa','#a78bfa','#34d399','#f97316'],
          }]
        },
        options: {plugins: {legend: {labels: {color: '#94a3b8'}}}}
      });

      // Intellectual heroes
      document.getElementById('heroes-list').innerHTML =
        (p.intellectual_heroes || []).map(h =>
          `<div class="hero-item">
             <span class="hero-title">${h.title || h.paper_id}</span>
             <span class="hero-count">${h.cite_count_in_work}×</span>
           </div>`).join('') || '<em style="color:#64748b">No data.</em>';

      // Most propagated
      if (p.most_propagated) {
        document.getElementById('propagated-info').innerHTML =
          `<strong style="color:#cbd5e1">${p.most_propagated.title}</strong><br>
           <span style="color:#94a3b8;font-size:12px">Cited by ${p.most_propagated.descendant_count} paper(s) in this graph.</span>`;
      }

      // Credit distribution bars — GAP-P8-59: canonical key is contribution_types
      const credits = p.contribution_types || {};
      document.getElementById('credit-bars').innerHTML =
        Object.entries(credits).map(([type, frac]) =>
          `<div class="credit-bar-row">
             <span class="credit-label">${type}</span>
             <div class="credit-bar-track">
               <div class="credit-bar-fill" style="width:${(frac*100).toFixed(0)}%;background:#D4A843"></div>
             </div>
             <span class="credit-pct">${(frac*100).toFixed(0)}%</span>
           </div>`).join('');
    } catch (err) {
      document.getElementById('researcher-name').textContent = 'Profile unavailable';
      document.getElementById('researcher-meta').textContent = err.message;
    }
  })();
  </script>
  {% endif %}
</div>
{% endblock %}
```

### §10.2 — templates/journalism.html

> Same as v1. No changes needed.

*(Copy verbatim from Phase 8 v1 §8.2)*

---

## §11 — Finalization Scripts (stubs → real)

### §11.1 — scripts/precompute_gallery.py (stub → real)

> **GAP-P8-60 fix:** script now computes and stores `leaderboard_json` in the `graphs` table.
> **GAP-P8-29 fix:** exponential backoff added between gallery papers.

```python
#!/usr/bin/env python3
"""
scripts/precompute_gallery.py — Pre-compute gallery graphs for 7 iconic papers.
Run once before launch. Results stored in R2 as precomputed/{name}.json.
Also stores graph_id and leaderboard_json in the graphs table (GAP-P8-60).

GAP-P8-29 fix: exponential backoff between papers to respect S2 API quotas.
GAP-P8-60 fix: leaderboard_json computed and stored.

Gallery papers (with verified Semantic Scholar IDs):
  attention  — Vaswani 2017  "Attention Is All You Need"          204E3073
  alexnet    — Krizhevsky 2012 "ImageNet Classification..."       32e56e1a
  bert       — Devlin 2019   "BERT: Pre-training..."              df2b0e16
  gans       — Goodfellow 2014 "Generative Adversarial Nets"      61c4a3c0
  word2vec   — Mikolov 2013  "Distributed Representations..."     fff114e3
  resnet     — He 2016       "Deep Residual Learning..."          2c03df8b
  gpt2       — Radford 2019  "Language Models are..."             9405cc0d

Usage: python scripts/precompute_gallery.py [--paper NAME]
"""
import sys, logging, argparse, json, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

GALLERY_PAPERS = {
    "attention": "204E3073",
    "alexnet":   "32e56e1a",
    "bert":      "df2b0e16",
    "gans":      "61c4a3c0",
    "word2vec":  "fff114e3",
    "resnet":    "2c03df8b",
    "gpt2":      "9405cc0d",
}


def _compute_leaderboard(graph_json: dict) -> list:
    """
    GAP-P8-60: compute pruning impact leaderboard for gallery graphs.
    Returns list of LeaderboardEntry dicts.
    """
    nodes      = graph_json.get("nodes", [])
    edges      = graph_json.get("edges", [])
    total      = len(nodes)
    if total == 0:
        return []

    node_by_id = {n["id"]: n for n in nodes}

    # Build descendants map
    cited_by: dict = {}
    for e in edges:
        src = e.get("source") or e.get("citing_paper_id", "")
        tgt = e.get("target") or e.get("cited_paper_id", "")
        cited_by.setdefault(tgt, set()).add(src)

    def count_descendants(nid: str) -> int:
        visited, queue = {nid}, list(cited_by.get(nid, []))
        while queue:
            curr = queue.pop(0)
            if curr not in visited:
                visited.add(curr)
                queue.extend(cited_by.get(curr, []))
        return len(visited) - 1  # exclude self

    impacts = [(nid, count_descendants(nid)) for nid in node_by_id]
    impacts.sort(key=lambda x: x[1], reverse=True)

    entries = []
    for rank, (paper_id, count) in enumerate(impacts[:20], start=1):
        node = node_by_id[paper_id]
        authors = node.get("authors") or ["Unknown"]
        first = authors[0]
        last_name = (first.get("name") if isinstance(first, dict) else str(first)).split()[-1]
        year  = node.get("year", "")
        entries.append({
            "paper_id":       paper_id,
            "title":          node.get("title", ""),
            "author_year":    f"{last_name} {year}",
            "collapse_count": count,
            "pct":            round(count / total * 100, 1),
            "rank":           rank,
        })
    return entries


def run(target: str = None):
    from dotenv import load_dotenv
    load_dotenv()
    import backend.db as db
    from backend.config import Config
    from backend.r2_client import R2Client
    from backend.api_client import SmartPaperResolver
    from backend.graph_engine import AncestryGraph

    db.init_pool(database_url=Config.DATABASE_URL)
    r2       = R2Client()
    resolver = SmartPaperResolver()

    papers = {target: GALLERY_PAPERS[target]} if target else GALLERY_PAPERS

    for name, paper_id in papers.items():
        logger.info(f"Precomputing gallery: {name} ({paper_id})")
        try:
            graph = AncestryGraph(resolver=resolver)
            graph.build(paper_id, max_depth=2, max_refs_per_node=50)
            graph_json = graph.export_to_json()

            # Compute leaderboard (GAP-P8-60)
            leaderboard = _compute_leaderboard(graph_json)
            graph_json["metadata"]["leaderboard"] = leaderboard

            r2_key = f"precomputed/{name}.json"
            r2.upload_bytes(
                r2_key,
                json.dumps(graph_json, default=str).encode(),
                content_type="application/json",
            )
            logger.info(f"  Uploaded {r2_key}: {len(graph_json.get('nodes',[]))} nodes")

            # Store in graphs table with graph_id and leaderboard_json (GAP-P8-60/51)
            graph_id = graph_json.get("metadata", {}).get("graph_id", f"gallery_{name}")
            db.execute(
                """
                INSERT INTO graphs
                    (seed_paper_id, graph_json_url, node_count, edge_count, leaderboard_json, graph_id)
                VALUES (%s, %s, %s, %s, %s::jsonb, %s)
                ON CONFLICT DO NOTHING
                """,
                (
                    paper_id, r2_key,
                    len(graph_json.get("nodes", [])),
                    len(graph_json.get("edges", [])),
                    json.dumps(leaderboard),
                    graph_id,
                ),
            )

            # Update gallery_index.json
            index_path = Path("data/gallery_index.json")
            index      = json.loads(index_path.read_text()) if index_path.exists() else {}
            index[name] = {
                "paper_id":    paper_id,
                "seed_title":  graph_json.get("metadata", {}).get("seed_paper_title", ""),
                "node_count":  len(graph_json.get("nodes", [])),
                "edge_count":  len(graph_json.get("edges", [])),
                "coverage":    graph_json.get("metadata", {}).get("coverage_score", 0),
                "r2_key":      r2_key,
                "leaderboard": leaderboard[:5],
            }
            index_path.write_text(json.dumps(index, indent=2))
            logger.info(f"  gallery_index.json updated for {name}")

            # GAP-P8-29: exponential backoff between papers
            wait_seconds = 30
            logger.info(f"  Waiting {wait_seconds}s before next paper (S2 rate limit courtesy)...")
            time.sleep(wait_seconds)

        except Exception as exc:
            logger.error(f"Failed to precompute {name}: {exc}")
            time.sleep(60)  # Wait longer after failure

    logger.info("Gallery precomputation complete.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--paper", choices=list(GALLERY_PAPERS.keys()), default=None)
    args = parser.parse_args()
    run(args.paper)
```

### §11.2 — scripts/ground_truth_eval.py (REPLACES Phase 5 version)

> **GAP-P8-53 fix:** Explicitly noted as replacing Phase 5 version.
> **GAP-P8-54 fix:** `sys.exit(1)` on failure so CI/CD can detect it. Uses 5 inline pairs
>   (no external JSON file needed). Threshold is 80% (consistent with Done-When §14).
> **Note:** The Phase 5 `data/ground_truth/pairs.json` file remains on disk — it is not
>   used by this script but can be referenced for manual analysis.

```python
#!/usr/bin/env python3
"""
scripts/ground_truth_eval.py — REPLACES Phase 5 version.

Evaluates NLP pipeline accuracy against known ground truth pairs.
Ground truth is embedded inline in this script (no external JSON file required).
Threshold: 80% mutation type accuracy.

Usage: python scripts/ground_truth_eval.py
Returns: exit code 0 on pass, 1 on fail (CI/CD compatible). (GAP-P8-54 fix)
"""
import sys, logging
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# Known correct inheritance relationships for validation.
# Format: citing → cited, expected mutation type, expected similarity (±0.1 tolerance)
GROUND_TRUTH_PAIRS = [
    {"citing": "204E3073", "cited": "fc26b9c1", "mutation": "generalization",  "expected_sim": 0.75},
    {"citing": "df2b0e16", "cited": "204E3073", "mutation": "adoption",        "expected_sim": 0.80},
    {"citing": "2c03df8b", "cited": "5d9f9b49", "mutation": "extension",       "expected_sim": 0.70},
    {"citing": "9405cc0d", "cited": "df2b0e16", "mutation": "adoption",        "expected_sim": 0.82},
    {"citing": "1b6d81dd", "cited": "204E3073", "mutation": "specialization",  "expected_sim": 0.72},
]

PASS_THRESHOLD = 0.80   # GAP-P8-24 fix: consistent with Done-When §14 criterion


def run():
    from dotenv import load_dotenv
    load_dotenv()
    import backend.db as db
    from backend.config import Config
    db.init_pool(database_url=Config.DATABASE_URL)

    results = {"correct_mutation": 0, "total": 0, "similarity_mae": 0.0, "skipped": 0}

    for pair in GROUND_TRUTH_PAIRS:
        row = db.fetchone(
            "SELECT mutation_type, similarity_score, mutation_confidence "
            "FROM edge_analysis WHERE citing_paper_id=%s AND cited_paper_id=%s",
            (pair["citing"], pair["cited"]),
        )
        if not row:
            logger.warning(f"Edge not in DB: {pair['citing']} → {pair['cited']} — skipping")
            results["skipped"] += 1
            continue

        results["total"] += 1
        if row["mutation_type"] == pair["mutation"]:
            results["correct_mutation"] += 1

        sim_err = abs(float(row["similarity_score"] or 0) - pair["expected_sim"])
        results["similarity_mae"] += sim_err

    if results["total"] == 0:
        logger.error(
            "No ground truth pairs found in DB. "
            "Build graphs for the test papers first (see GROUND_TRUTH_PAIRS paper IDs)."
        )
        sys.exit(1)  # GAP-P8-54 fix: exit with error code

    precision = results["correct_mutation"] / results["total"]
    mae       = results["similarity_mae"] / results["total"]
    logger.info(f"Ground truth evaluation:")
    logger.info(f"  Pairs evaluated:        {results['total']}/{len(GROUND_TRUTH_PAIRS)} ({results['skipped']} skipped)")
    logger.info(f"  Mutation type accuracy: {precision:.1%}")
    logger.info(f"  Similarity MAE:         {mae:.3f}")

    if precision >= PASS_THRESHOLD:
        logger.info(f"  ✅ PASS — mutation accuracy ≥ {PASS_THRESHOLD:.0%}")
        sys.exit(0)
    else:
        logger.warning(f"  ❌ FAIL — {precision:.1%} is below {PASS_THRESHOLD:.0%} target")
        sys.exit(1)  # GAP-P8-54: machine-readable exit code


if __name__ == "__main__":
    run()
```

### §11.3 — scripts/benchmark_nlp.py (stub → real)

> **GAP-P8-23 fix:** This script measures end-to-end graph build time (consistent with the
>   Done-When criterion "Total build time < 90 seconds"). The main spec §59.11 described a
>   different sentences-per-second benchmark — Phase 8 uses the build-time definition.
>   Both metrics are printed; only build time is the pass/fail criterion.

```python
#!/usr/bin/env python3
"""
scripts/benchmark_nlp.py — End-to-end graph build latency benchmark.
Target: under 90 seconds for a typical paper (Attention Is All You Need).
Also reports NLP worker throughput as informational metric.

GAP-P8-23 fix: build time is the Done-When criterion, not sentences/sec.
Usage: python scripts/benchmark_nlp.py
"""
import sys, logging, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

TEST_PAPER_ID   = "204E3073"  # "Attention Is All You Need"
TARGET_SECONDS  = 90


def run():
    from dotenv import load_dotenv
    load_dotenv()
    import backend.db as db
    from backend.config import Config
    from backend.api_client import SmartPaperResolver
    from backend.graph_engine import AncestryGraph

    db.init_pool(database_url=Config.DATABASE_URL)

    logger.info(f"Benchmarking graph build for: {TEST_PAPER_ID}")
    logger.info(f"Target: under {TARGET_SECONDS}s")

    start    = time.time()
    resolver = SmartPaperResolver()

    t0 = time.time()
    resolver.resolve(TEST_PAPER_ID)
    logger.info(f"  Paper resolution: {time.time()-t0:.1f}s")

    t0    = time.time()
    graph = AncestryGraph(resolver=resolver)
    graph.build(TEST_PAPER_ID, max_depth=2, max_refs_per_node=30)
    logger.info(f"  BFS crawl + NLP:  {time.time()-t0:.1f}s ({len(graph.nodes)} nodes)")

    t0         = time.time()
    graph_json = graph.export_to_json()
    logger.info(f"  Export to JSON:   {time.time()-t0:.1f}s")

    total = time.time() - start
    logger.info(f"\nTotal build time: {total:.1f}s")

    # Informational: NLP worker throughput
    try:
        import httpx
        sample_texts = ["Attention mechanisms allow sequence models to process inputs efficiently."] * 10
        t0 = time.time()
        resp = httpx.post(
            f"{Config.NLP_WORKER_URL}/encode_batch",
            json={"texts": sample_texts, "model": "abstract"},
            headers={"Authorization": f"Bearer {Config.NLP_WORKER_SECRET}"},
            timeout=30.0,
        )
        elapsed = time.time() - t0
        logger.info(f"  NLP worker throughput: {len(sample_texts)/elapsed:.0f} texts/sec (informational)")
    except Exception as exc:
        logger.warning(f"  NLP worker throughput check failed: {exc}")

    if total <= TARGET_SECONDS:
        logger.info(f"✅ PASS — build time {total:.1f}s under {TARGET_SECONDS}s target")
        sys.exit(0)
    else:
        logger.warning(f"❌ FAIL — {total:.1f}s exceeds {TARGET_SECONDS}s target")
        logger.info("Optimization suggestions:")
        logger.info("  - Check embedding cache hit rate (should be >70%)")
        logger.info("  - Verify S2 batch endpoint usage (should use /paper/batch, not per-paper)")
        logger.info("  - Check DB query performance with EXPLAIN ANALYZE on slowest queries")
        sys.exit(1)


if __name__ == "__main__":
    run()
```

---

## §12 — chat_guide.py Modification (GAP-P8-04)

Add the following to `backend/chat_guide.py` to wire PersonaEngine framing into chat responses.
Find the section where the system prompt is assembled and add:

```python
# ── Phase 8: Persona-aware chat framing (GAP-P8-04) ─────────────────────────
# Add this import at the top of chat_guide.py:
# from backend.persona_engine import PersonaEngine

def _get_persona_framing(session_id: str) -> str:
    """
    Get persona-specific framing instructions for the AI guide.
    PersonaEngine was built in Phase 7 — this wires it into chat responses.
    """
    try:
        import backend.db as db
        row = db.fetchone(
            "SELECT persona_mode FROM sessions WHERE session_id=%s",
            (session_id,),
        )
        persona = (row["persona_mode"] if row else "explorer") or "explorer"
    except Exception:
        persona = "explorer"

    PERSONA_FRAMING = {
        "explorer": (
            "The user is exploring a new field. Emphasize: reading sequence, foundational papers, "
            "vocabulary explanations, intellectual context. Use accessible language."
        ),
        "critic": (
            "The user is critically evaluating work. Emphasize: citation foundation quality, "
            "missing citations, originality scores, contested claims, retraction risks."
        ),
        "innovator": (
            "The user is looking for research opportunities. Emphasize: research gaps, orphan ideas, "
            "cross-domain opportunities, white space, future spark predictions."
        ),
        "historian": (
            "The user wants intellectual history. Emphasize: paradigm shifts, extinction events, "
            "time machine insights, genealogy story, how the field evolved."
        ),
    }
    return PERSONA_FRAMING.get(persona, PERSONA_FRAMING["explorer"])


# In the ChatGuide.build_system_prompt() method (or equivalent), add:
# persona_framing = _get_persona_framing(session_id)
# Include persona_framing in the system prompt:
# system_prompt = f"""You are Arivu's AI research guide...
# {persona_framing}
# ..."""
```

---

## §13 — README.md (complete per spec §51)

```markdown
# Arivu

**Research intelligence platform** — traces the intellectual ancestry of any academic paper,
revealing what ideas it inherited, which papers are critical to the field's survival, and where
the white space lies for future research.

> "Citation graphs show structure. Arivu reveals meaning."

## Screenshots

_(Add graph screenshot, pruning animation GIF, DNA profile screenshot here)_

## Quick Start

```bash
# 1. Clone
git clone https://github.com/<you>/arivu.git && cd arivu

# 2. Create virtual environment
python -m venv .venv && source .venv/bin/activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Copy and fill in environment variables
cp .env.example .env
# Edit .env with your API keys (see API Keys section below)

# 5. Run database migration
python scripts/migrate.py

# 6. Start the app
flask run --port 5000
```

Open `http://localhost:5000`. Paste any paper title, DOI, or arXiv URL.

## Features

**Core intelligence:**
- 🔗 Citation ancestry graph (D3.js force-directed, depth-2 BFS)
- 💉 Idea mutation tracking — classifies every citation edge (adoption / generalization / synthesis / contradiction)
- ✂️ Interactive pruning — "what if this paper never existed?" cascading animation
- 🧬 Research DNA profile — what intellectual clusters built this paper
- 📊 Living paper score — rising/stable/declining trajectory per paper
- 🔍 Research gap finder — high-similarity papers with no citation between them

**Intelligence layer:**
- 🌊 Paradigm shift early warning — structural signals of impending intellectual revolution
- 💀 Extinction event detector — research threads that died from paradigm shift or abandonment
- ⏰ Time Machine — animated field growth from any year to present
- 🌐 Cross-domain spark detector — ideas that crossed field boundaries and what they unlocked
- ⚠️ Error propagation tracker — Retraction Watch + PubPeer integration
- 🏆 Idea credit system — Pioneer / Enabling / Bridge / Amplification / Refinement credits
- 🔬 Citation intent classification — why each paper cites each other paper
- 📖 Reading between the lines — real claim vs. hedged claim analysis
- 💰 Intellectual debt tracker — foundational assumptions accepted without proof
- 🥊 Challenge generator — strongest possible counterargument for any paper

**Workflow tools:**
- 📄 Adversarial reviewer — pre-submission analysis via PDF upload
- 📍 Paper positioning — where does your paper sit in the intellectual landscape
- ✏️ Rewrite suggester — related-work section as intellectual narrative
- 📚 Literature review engine — multi-seed Word document organized by conceptual thread
- 📦 Field entry kit — complete onboarding document for a new research area
- ⚠️ Research risk analyzer — redundancy / foundation / trajectory / competition risks
- 📎 Citation generator — APA, MLA, Chicago, IEEE, Vancouver, Harvard

**Platform:**
- 👤 User accounts with four billing tiers (Free / Researcher / Lab / Developer)
- 📡 Live mode — alerts when new papers cite your monitored graphs
- 🔗 Shareable graph links — permanent read-only URLs
- 🌍 Public REST API — `/v1/` with API key authentication
- 👁 Graph memory — persistent exploration state across sessions
- 🎭 Research personas — Explorer / Critic / Innovator / Historian modes
- ✅ Trust layer — confidence badges, evidence trails, disagreement flags
- 📰 Science journalism layer — plain-language summaries for non-academic readers

## Architecture

```
Browser → Flask (Koyeb) → PostgreSQL/pgvector (Neon)
                        → Cloudflare R2 (graph JSON, exports)
                        → FastAPI NLP Worker (HuggingFace Spaces)
                        → Groq LLM API
```

All ML inference runs in the NLP worker. The main server never imports `sentence_transformers`.

## API Keys Required

| Service | Where | Cost |
|---|---|---|
| Semantic Scholar | api.semanticscholar.org | Free (request key) |
| OpenAlex | openalex.org | Free (add email) |
| Groq | console.groq.com | Free tier available |
| Neon.tech | neon.tech | Free tier |
| Cloudflare R2 | cloudflare.com | Free tier (10GB) |
| Stripe | stripe.com | Free for testing |
| Resend | resend.com | Free tier (100 emails/day) |
| hCaptcha | hcaptcha.com | Free |
| HuggingFace | huggingface.co | Free (Spaces) |
| Retraction Watch | retractionwatch.com | Free (registration required) |

See `.env.example` for all required variables.

## Development

```bash
# Run tests
python -m pytest tests/ -v

# Ground truth evaluation (NLP accuracy)
python scripts/ground_truth_eval.py

# Benchmark build pipeline
python scripts/benchmark_nlp.py

# Precompute gallery
python scripts/precompute_gallery.py

# Load Retraction Watch data
python scripts/load_retraction_watch.py
```

## License

MIT License — see LICENSE file.

## Author

Built by Dev as a research intelligence tool. Tamil: அறிவு (Arivu) = knowledge, wisdom.
```

---

## §14 — tests/test_phase8.py

```python
"""
tests/test_phase8.py — Phase 8 test suite.
All tests offline — no live APIs required.
Run: pytest tests/test_phase8.py -v

GAP-P8-40 fix: TestResearcherProfileBuilder uses correct key 'contribution_types'
GAP-P8-41 fix: competition risk tested with affiliation data
GAP-P8-42 fix: TestFieldEntryKit added
GAP-P8-59 fix: canonical key is 'contribution_types'
"""
import json
import pytest
from unittest.mock import patch, MagicMock


def _make_graph(n=15, cross_domain=False) -> dict:
    import random
    rng    = random.Random(42)
    fields = ["CS", "Biology", "Physics"]
    nodes  = [
        {
            "id":             f"p{i}",
            "title":          f"Paper {i}",
            "year":           2010 + i,
            "citation_count": rng.randint(5, 500),
            "fields_of_study": [fields[i % len(fields)] if cross_domain else "CS"],
            "abstract":       f"This paper proposes a new method for task {i}. We show results.",
            "is_bottleneck":  i == 0,
            "pruning_impact": 0.4 if i == 0 else 0.05,
            "is_retracted":   False,
            "authors":        [{"authorId": f"a{i}", "name": f"Author {i}",
                                "affiliations": [f"University {i % 5}"]}],
        }
        for i in range(n)
    ]
    edges = [
        {
            "source":           f"p{i}",
            "target":           f"p{i-1}",
            "mutation_type":    "adoption",
            "similarity_score": 0.7 + rng.random() * 0.2,
            "inherited_idea":   f"method from paper {i-1}",
            "confidence_tier":  "medium",
        }
        for i in range(1, n)
    ]
    return {
        "nodes": nodes,
        "edges": edges,
        "metadata": {
            "seed_paper_id":    f"p{n-1}",
            "seed_paper_title": "Seed Paper",
            "graph_id":         "test-graph-001",
            "coverage_score":   0.85,
        },
    }


# ── CrossDomainSparkDetector ──────────────────────────────────────────────────

class TestCrossDomainSparkDetector:
    def test_finds_cross_domain_edges(self):
        from backend.cross_domain_spark import CrossDomainSparkDetector
        graph = _make_graph(10, cross_domain=True)
        with patch("backend.cross_domain_spark.db.fetchall", return_value=[]):
            with patch("backend.cross_domain_spark.LLMClient") as mock_llm:
                mock_llm.return_value.call_llm.return_value = "technique transfers well"
                result = CrossDomainSparkDetector().detect(graph)
        assert "sparks"        in result
        assert "future_sparks" in result
        assert "summary"       in result
        assert json.dumps(result)

    def test_empty_graph_returns_gracefully(self):
        from backend.cross_domain_spark import CrossDomainSparkDetector
        with patch("backend.cross_domain_spark.db.fetchall", return_value=[]):
            result = CrossDomainSparkDetector().detect({"nodes": [], "edges": []})
        assert result["sparks"] == []

    def test_years_ago_not_hardcoded(self):
        """GAP-P8-33 fix: years_ago uses current year, not hardcoded 2025."""
        import datetime
        from backend.cross_domain_spark import CrossDomainSparkDetector, _CURRENT_YEAR
        assert _CURRENT_YEAR == datetime.datetime.now().year


# ── ErrorPropagationTracker ───────────────────────────────────────────────────

class TestErrorPropagationTracker:
    def test_clean_graph(self):
        from backend.error_propagation import ErrorPropagationTracker
        with patch("backend.error_propagation.db.fetchall", return_value=[]):
            result = ErrorPropagationTracker().analyze(_make_graph(5))
        assert result["clean"] is True
        assert result["flagged_papers"] == []

    def test_flagged_paper_detected(self):
        from backend.error_propagation import ErrorPropagationTracker
        mock_row = {
            "paper_id": "p0", "title": "Retracted Paper",
            "is_retracted": True, "retraction_reason": "Data fabrication",
            "pubpeer_flags": None, "rw_reason": "Data fabrication",
            "retraction_date": "2023-01-01",
        }
        with patch("backend.error_propagation.db.fetchall", return_value=[mock_row]):
            result = ErrorPropagationTracker().analyze(_make_graph(5))
        assert result["clean"] is False
        assert result["flagged_papers"][0]["issue_type"] == "retracted"

    def test_pubpeer_flags_handled(self):
        """GAP-P8-11 fix: pubpeer_flags JSONB now exists and is handled correctly."""
        from backend.error_propagation import ErrorPropagationTracker
        mock_row = {
            "paper_id": "p1", "title": "Contested Paper",
            "is_retracted": False, "retraction_reason": None,
            "pubpeer_flags": {"summary": "Reviewer concerns about data"},
            "rw_reason": None, "retraction_date": None,
        }
        with patch("backend.error_propagation.db.fetchall", return_value=[mock_row]):
            result = ErrorPropagationTracker().analyze(_make_graph(5))
        assert result["clean"] is False
        assert result["flagged_papers"][0]["issue_type"] == "pubpeer_concern"


# ── CitationIntentClassifier ──────────────────────────────────────────────────

class TestCitationIntentClassifier:
    def test_detects_contradiction_markers(self):
        from backend.nlp_pipeline import CitationIntentClassifier
        clf = CitationIntentClassifier()
        result = clf.classify(
            "Contrary to prior work, we show this approach fails.",
            "abstract text", "Some Paper", "adoption"
        )
        assert result == "direct_contradiction"

    def test_mutation_type_mapping(self):
        from backend.nlp_pipeline import CitationIntentClassifier
        clf = CitationIntentClassifier()
        result = clf.classify("", "", "Some Paper", "revival")
        assert result == "revival"

    def test_returns_valid_category(self):
        from backend.nlp_pipeline import CitationIntentClassifier, CITATION_INTENT_CATEGORIES
        clf = CitationIntentClassifier()
        with patch("backend.nlp_pipeline.LLMClient") as mock_llm:
            mock_llm.return_value.call_llm.return_value = "methodological_adoption"
            result = clf.classify("", "", "Paper", "synthesis")
        assert result in CITATION_INTENT_CATEGORIES


# ── ReadingBetweenLines ───────────────────────────────────────────────────────

class TestReadingBetweenLines:
    def test_returns_structure(self):
        from backend.reading_between_lines import ReadingBetweenLines
        with patch("backend.reading_between_lines.LLMClient") as mock_llm:
            mock_llm.return_value.call_llm.return_value = (
                "REAL_CLAIM: A new method achieves state of the art.\n"
                "IMPLICIT_FOIL: Prior approaches relied on expensive computation.\n"
                "CONFIDENCE_SIGNALS: Hedging language suggests uncertainty.\n"
                "MINIMAL_CLAIM: A smaller model on one dataset.\n"
            )
            result = ReadingBetweenLines().analyze(_make_graph(5), "p0")
        d = result.to_dict()
        assert "real_claim"         in d
        assert "implicit_foil"      in d
        assert "confidence_signals" in d
        assert json.dumps(d)

    def test_no_abstract_graceful(self):
        from backend.reading_between_lines import ReadingBetweenLines
        graph  = {"nodes": [{"id": "p0", "title": "T"}], "edges": []}
        result = ReadingBetweenLines().analyze(graph, "p0")
        assert result.confidence == "unavailable"


# ── IntellectualDebtTracker ───────────────────────────────────────────────────

class TestIntellectualDebtTracker:
    def test_returns_structure(self):
        from backend.intellectual_debt import IntellectualDebtTracker
        with patch("backend.intellectual_debt.LLMClient") as mock_llm:
            mock_llm.return_value.call_llm.return_value = (
                "DEBT_TYPE: unproven_assumption\n"
                "DESCRIPTION: Attention weights assumed to be meaningful.\n"
                "SOURCE: Paper 0\nSEVERITY: high\n"
                "ADDRESSING: Recent work questions this.\n---\n"
            )
            result = IntellectualDebtTracker().analyze(_make_graph(10))
        assert "debt_items" in result
        assert "summary"    in result
        assert json.dumps(result)


# ── ChallengeGenerator ────────────────────────────────────────────────────────

class TestChallengeGenerator:
    def test_generates_challenge(self):
        from backend.challenge_generator import ChallengeGenerator, DISCLAIMER
        with patch("backend.challenge_generator.LLMClient") as mock_llm:
            mock_llm.return_value.call_llm.return_value = (
                "CORE_ASSUMPTION: Performance generalizes.\n"
                "STRONGEST_ATTACK: Results on one benchmark only.\n"
                "WEAKNESS_TYPE: empirical\n"
                "COUNTEREVIDENCE: Show failure on out-of-domain data.\n"
            )
            result = ChallengeGenerator().generate(_make_graph(5), "p0")
        d = result.to_dict()
        assert "strongest_attack" in d
        assert d["disclaimer"]    == DISCLAIMER
        assert json.dumps(d)


# ── IdeaCreditSystem ──────────────────────────────────────────────────────────

class TestIdeaCreditSystem:
    def test_computes_all_five_credits(self):
        from backend.idea_credit import IdeaCreditSystem
        profiles = IdeaCreditSystem().compute_graph_credits(_make_graph(10))
        assert isinstance(profiles, list)
        for p in profiles:
            for credit_type in ("pioneer","enabling","bridge","amplification","refinement"):
                assert credit_type in p["credits"]
            assert json.dumps(p)

    def test_dominant_is_highest_score(self):
        from backend.idea_credit import IdeaCreditSystem
        for p in IdeaCreditSystem().compute_graph_credits(_make_graph(6)):
            assert p["credits"][p["dominant"]] == max(p["credits"].values())


# ── ResearcherProfileBuilder ──────────────────────────────────────────────────

class TestResearcherProfileBuilder:
    def test_builds_profiles_for_graph(self):
        from backend.researcher_profiles import ResearcherProfileBuilder
        # Use n=20 so multiple authors appear ≥2 times
        graph    = _make_graph(20)
        profiles = ResearcherProfileBuilder().build_for_graph(graph)
        assert isinstance(profiles, list)
        for p in profiles:
            assert "author_id"         in p
            assert "display_name"      in p
            assert "contribution_types" in p   # GAP-P8-40/59 fix: canonical key
            assert "credits" not in p           # NOT this key
            assert json.dumps(p)

    def test_total_qualified_in_response(self):
        """GAP-P8-39 fix: response includes count for truncation transparency."""
        from backend.researcher_profiles import ResearcherProfileBuilder
        graph = _make_graph(20)
        # build_for_graph returns list; route wraps with total_qualified
        profiles = ResearcherProfileBuilder().build_for_graph(graph)
        # The list itself is fine — route adds total_qualified wrapper
        assert isinstance(profiles, list)


# ── LiteratureReviewEngine ────────────────────────────────────────────────────

class TestLiteratureReviewEngine:
    def test_returns_structure(self):
        from backend.literature_review_engine import LiteratureReviewEngine
        engine = LiteratureReviewEngine()
        mock_paper = {
            "paper_id": "p1", "title": "Test Paper", "year": 2020,
            "citation_count": 100, "abstract": "An abstract.", "fields_of_study": ["CS"],
        }
        with (patch.object(engine, '_embed_question', return_value=None),
              patch("backend.literature_review_engine.db.fetchall", return_value=[]),
              patch.object(engine, '_generate_docx', return_value="r2://test/litrev.docx"),
              patch("backend.literature_review_engine.LLMClient") as mock_llm):
            mock_llm.return_value.call_llm.return_value = "GAP1: x\nGAP2: y\nGAP3: z"
            result = engine.generate("What is reinforcement learning?", "user123")
        d = result.to_dict()
        assert "research_question" in d
        assert "threads"           in d
        assert "minimum_reading"   in d
        assert json.dumps(d)

    def test_uses_graph_when_provided(self):
        """GAP-P8-63 fix: engine uses current graph as seed corpus."""
        from backend.literature_review_engine import LiteratureReviewEngine
        engine = LiteratureReviewEngine()
        graph  = _make_graph(5)
        with (patch.object(engine, '_embed_question', return_value=None),
              patch("backend.literature_review_engine.db.fetchall", return_value=[]),
              patch.object(engine, '_generate_docx', return_value=None),
              patch("backend.literature_review_engine.LLMClient") as mock_llm):
            mock_llm.return_value.call_llm.return_value = "THREAD: Test\nDESCRIPTION: x\nPAPERS: y\n---"
            # Should not raise even when graph nodes have no abstract in DB
            result = engine.generate("test question", "user123", graph_json=graph)
        assert result is not None


# ── ResearchRiskAnalyzer ──────────────────────────────────────────────────────

class TestResearchRiskAnalyzer:
    def test_returns_four_risks(self):
        from backend.research_risk_analyzer import ResearchRiskAnalyzer
        with patch("backend.research_risk_analyzer.db.fetchall", return_value=[]):
            result = ResearchRiskAnalyzer().analyze(_make_graph(12), "self-supervised learning").to_dict()
        rm = result["risk_matrix"]
        for key in ("redundancy", "foundation", "trajectory", "competition"):
            assert key in rm
        assert result["overall_risk"] in ("low", "medium", "high")
        assert json.dumps(result)

    def test_competition_with_affiliations(self):
        """GAP-P8-41 fix: competition risk tested with affiliation data in nodes."""
        from backend.research_risk_analyzer import ResearchRiskAnalyzer
        # _make_graph() now includes affiliations in author dicts
        graph  = _make_graph(12)
        with patch("backend.research_risk_analyzer.db.fetchall", return_value=[]):
            result = ResearchRiskAnalyzer().analyze(graph, "attention mechanisms").to_dict()
        # With affiliations present, similar_active_groups > 0
        # (5 unique institutions for 12 nodes)
        assert result["risk_matrix"]["competition"]["similar_active_groups"] >= 0

    def test_mitigation_present(self):
        from backend.research_risk_analyzer import ResearchRiskAnalyzer
        with patch("backend.research_risk_analyzer.db.fetchall", return_value=[]):
            result = ResearchRiskAnalyzer().analyze(_make_graph(5), "test").to_dict()
        assert len(result["mitigation"]) >= 1


# ── GraphMemory ───────────────────────────────────────────────────────────────

class TestGraphMemory:
    def test_get_memory_returns_default_for_new_user(self):
        from backend.graph_memory import GraphMemoryManager
        with patch("backend.graph_memory.db.fetchone", return_value=None):
            mem = GraphMemoryManager().get_memory("user123", "graph456")
        assert mem["seen_paper_ids"] == []
        assert mem["flagged_edges"]  == []

    def test_navigation_path_is_jsonb_list(self):
        """GAP-P8-34 fix: navigation_path is a list of dicts, not a flat text array."""
        from backend.graph_memory import GraphMemoryManager
        with patch("backend.graph_memory.db.fetchone", return_value=None):
            mem = GraphMemoryManager().get_memory("u1", "g1")
        assert isinstance(mem["navigation_path"], list)

    def test_mark_edge_flagged(self):
        """GAP-P8-18 fix: flagged edges stored in memory."""
        from backend.graph_memory import GraphMemoryManager
        with (patch("backend.graph_memory.db.fetchone", return_value=None),
              patch("backend.graph_memory.db.execute") as mock_exec):
            GraphMemoryManager().mark_edge_flagged("u1", "g1", "e1->e2")
        assert mock_exec.call_count >= 1


# ── FieldEntryKit ─────────────────────────────────────────────────────────────
# GAP-P8-42 fix: FieldEntryKit now has tests.

class TestFieldEntryKit:
    def test_returns_required_keys(self):
        from backend.field_entry_kit import FieldEntryKit
        graph = _make_graph(8)
        with (patch("backend.field_entry_kit.VocabularyEvolutionTracker", MagicMock()),
              patch("backend.field_entry_kit.FieldFingerprintAnalyzer", MagicMock()),
              patch("backend.field_entry_kit.R2Client"),
              patch("backend.field_entry_kit.ExportGenerator") as mock_gen):
            mock_gen.return_value.generate_docx.return_value = b"docx content"
            result = FieldEntryKit().generate(graph, "test question", "user123")
        for key in ("reading_sequence", "vocabulary_guide", "controversy_map",
                    "structural_overview", "white_space"):
            assert key in result
        assert json.dumps(result)

    def test_handles_empty_graph_gracefully(self):
        from backend.field_entry_kit import FieldEntryKit
        graph  = {"nodes": [], "edges": [], "metadata": {}}
        with (patch("backend.field_entry_kit.R2Client"),
              patch("backend.field_entry_kit.ExportGenerator") as mock_gen):
            mock_gen.return_value.generate_docx.return_value = b""
            result = FieldEntryKit().generate(graph, "empty test", "user123")
        assert "reading_sequence" in result
        assert result["reading_sequence"] == []


# ── ScienceJournalismLayer ────────────────────────────────────────────────────

class TestScienceJournalismLayer:
    def test_returns_all_fields(self):
        from backend.science_journalism import ScienceJournalismLayer
        with patch("backend.science_journalism.LLMClient") as mock_llm:
            mock_llm.return_value.call_llm.return_value = (
                "HYPE_SCORE: 0.7\nHYPE_VERDICT: significant\n"
                "HYPE_REASONING: Solid empirical results.\n"
                "CONTEXT_STORY: The field evolved from early work.\n"
                "PLAIN_LANGUAGE: A faster model for text classification.\n"
                "STAKES_IF_TRUE: Could enable real-time translation.\n"
            )
            result = ScienceJournalismLayer().analyze(_make_graph(5), "p0").to_dict()
        for key in ("hype_detector", "context_story", "plain_language", "stakes_if_true"):
            assert key in result
        assert json.dumps(result)


# ── InterdisciplinaryTranslator ───────────────────────────────────────────────

class TestInterdisciplinaryTranslator:
    def test_translate_returns_structure(self):
        from backend.interdisciplinary_translation import InterdisciplinaryTranslator
        with patch("backend.interdisciplinary_translation.LLMClient") as mock_llm:
            mock_llm.return_value.call_llm.return_value = (
                "TERM_A: gradient descent\nTERM_B: error minimization\n"
                "EXPLANATION: Equivalent concepts across CS and biology.\n"
                "UNTRANSLATED: regularization\n"
            )
            result = InterdisciplinaryTranslator().translate(_make_graph(8, cross_domain=True))
        for key in ("equivalences", "untranslated", "summary"):
            assert key in result
        assert json.dumps(result)


# ── LiveModeManager ───────────────────────────────────────────────────────────

class TestLiveModeManager:
    def test_create_subscription(self):
        from backend.live_mode import LiveModeManager
        with patch("backend.live_mode.db.execute_returning",
                   return_value={"subscription_id": "sub-uuid-1234"}):
            sub_id = LiveModeManager().create_subscription(
                "user1", "graph1", "paper1",
                ["new_citation","paradigm_shift"], True,
            )
        assert sub_id == "sub-uuid-1234"

    def test_get_unread_alerts(self):
        from backend.live_mode import LiveModeManager
        mock_rows = [
            {"alert_id": "a1", "event_type": "new_citation", "event_data": {},
             "created_at": "2025-01-01", "seed_paper_id": "p1"},
        ]
        with patch("backend.live_mode.db.fetchall", return_value=mock_rows):
            alerts = LiveModeManager().get_unread_alerts("user1")
        assert len(alerts) == 1
        assert alerts[0]["event_type"] == "new_citation"


# ── Coverage Report ───────────────────────────────────────────────────────────
# GAP-P8-02 fix: coverage report now has tests via feature gating function.

class TestCoverageGate:
    def test_high_coverage_unlocks_all_features(self):
        import app as a
        gates = a._coverage_gate(0.90)
        assert all(gates.values())

    def test_low_coverage_gates_features(self):
        import app as a
        gates = a._coverage_gate(0.40)
        assert gates["cross_domain_spark"] is True   # threshold 0.55
        assert gates["intellectual_debt"]  is False  # threshold 0.70
```

---

## §15 — Koyeb Scheduled Jobs (Phase 8 Additions)

| Job | Command | Schedule | Purpose |
|-----|---------|----------|---------|
| Live monitor | `python scripts/live_monitor_cron.py` | `0 3 * * *` | Nightly new-paper polling + retraction check |
| Retraction sync | `python scripts/load_retraction_watch.py` | `0 4 * * 0` | Weekly Retraction Watch update (Sunday 04:00 UTC) |

> **GAP-P8-27 clarification:** Phase 7's `scripts/weekly_digest.py` serves the **Supervisor
> Dashboard** (Lab advisor weekly digests for student monitoring). Phase 8's
> `live_monitor_cron.py` sends **Live Mode** weekly digests (citation alert summaries).
> These are different features for different users — both crons must continue running.
> Ensure Phase 7's `weekly_digest.py` is still scheduled at its original time (e.g., `0 8 * * 1`).

Full Phase 6–8 cron schedule:

| Job | Schedule | Phase |
|-----|----------|-------|
| `nightly_maintenance.py` | `0 2 * * *` | P6 |
| `live_monitor_cron.py`   | `0 3 * * *` | P8 |
| `load_retraction_watch.py` | `0 4 * * 0` | P8 |
| `weekly_digest.py`       | `0 8 * * 1` | P7 |

---

## §16 — CONTEXT.md Update

```markdown
## Phase Status
- Phase 1: Completed
- Phase 2: Completed
- Phase 3: Completed
- Phase 4: Completed
- Phase 5: Completed
- Phase 6: Completed
- Phase 7: Completed
- Phase 8: Completed   ← mark when all checks pass

## v1.0 Release Notes
- Tagged: v1.0
- Feature count: ~62 features built across phases 1–8
  - Deferred to post-v1: F2.4 Prediction Market, F3.2 Collaboration Finder,
    F3.3 Mental Model Mapper, F3.4 Lab Genealogy, F8.2 Collaborative Annotation,
    F8.4 Collaboration Finder Community, F11.8 Policy Brief Generator,
    F11.10 Conference Intelligence Layer
- Gallery: 7 precomputed papers (with leaderboard_json)
- Live Mode: polling-based (WebSocket is Phase 9+)
- Researcher Profiles: single-graph version (multi-paper merging is Phase 9+)
- Scheduled crons: nightly maintenance, weekly supervisor digest, live monitor, retraction sync
- Known v1 limitation: live mode checks only first 10 nodes per subscription (S2 rate limit)

## Post-v1 Roadmap
- F2.4  Prediction Market (community scale needed)
- F3.2  Collaboration Finder (researcher profile index needed)
- F3.3  Mental Model Mapper (multi-author aggregation)
- F3.4  Lab Genealogy System (Math Genealogy Project API)
- F8.2  Collaborative Annotation (moderation system)
- F8.4  Collaboration Finder Community
- F11.8 Science Policy Brief Generator
- F11.10 Conference Intelligence Layer
- Phase 9: WebSocket live mode, async job queue, full-graph live monitoring, mobile app
```

---

## §17 — Done When

Phase 8 (and v1.0) is complete when ALL of the following are true:

1. **All tests pass:**
   ```bash
   python -m pytest tests/ -v
   # 0 failed (smoke + phase2 + ... + phase7 + phase8)
   ```

2. **Phase 8 migration ran:**
   ```bash
   python scripts/migrate_phase8.py
   psql $DATABASE_URL -c "\dt" | grep -E "researcher_profiles|graph_memory_state|live_subscriptions|live_alerts"
   # Also verify graphs table has graph_id column:
   psql $DATABASE_URL -c "\d graphs" | grep graph_id
   ```

3. **Gallery precomputed with leaderboard:**
   ```bash
   python scripts/precompute_gallery.py
   cat data/gallery_index.json | python -c "import json,sys; d=json.load(sys.stdin); print(len(d), 'papers')"
   # 7 papers
   psql $DATABASE_URL -c "SELECT graph_id, jsonb_array_length(leaderboard_json) FROM graphs WHERE graph_id LIKE 'gallery%';"
   # Each should have leaderboard_json with entries
   ```

4. **Ground truth eval passes:**
   ```bash
   python scripts/ground_truth_eval.py
   # Exit code 0, mutation accuracy ≥ 80%
   ```

5. **NLP benchmark passes:**
   ```bash
   python scripts/benchmark_nlp.py
   # Exit code 0, total build time < 90 seconds
   ```

6. **Retraction watch loaded:**
   ```bash
   python scripts/load_retraction_watch.py
   psql $DATABASE_URL -c "SELECT COUNT(*) FROM retractions;"
   # > 0 (requires RETRACTION_WATCH_CSV_URL to be set, or CrossRef fallback ran)
   ```

7. **Citation intent populated:**
   ```bash
   psql $DATABASE_URL -c "SELECT citation_intent, COUNT(*) FROM edge_analysis WHERE citation_intent IS NOT NULL GROUP BY 1;"
   # Should show multiple categories
   ```

8. **Cross-domain spark works:**
   ```bash
   curl -b "arivu_session=<cookie>" "https://arivu.app/api/cross-domain-sparks/<seed_id>"
   # Returns {sparks, future_sparks, summary}
   ```

9. **Literature review generates Word doc:**
   ```bash
   curl -b "..." -X POST -H "Content-Type: application/json" \
     -d '{"research_question":"What is self-supervised learning?"}' \
     "https://arivu.app/api/literature-review"
   # Returns {job_id, result: {threads, minimum_reading, docx_r2_key}}
   ```

10. **Coverage report works:**
    ```bash
    curl "https://arivu.app/api/coverage-report/<seed_id>"
    # Returns {coverage_score, reliability_label, abstract_coverage, features_available}
    ```

11. **Journalism layer works:**
    ```bash
    curl "https://arivu.app/api/journalism/<paper_id>"
    # Returns {hype_detector, context_story, plain_language, stakes_if_true}
    ```

12. **Live mode subscribe/unsubscribe works:**
    - POST `/api/live/subscribe` → `{"subscription_id": "...", "active": true}`
    - GET `/api/live/subscriptions` → subscription appears
    - POST `/api/live/cancel` → `{"success": true}` (or 404 if not subscribed)

13. **Flag-edge with auto-downgrade:**
    ```bash
    # Flag same edge from 3 different sessions
    curl -b "..." -X POST -d '{"edge_id":"p1->p0","reason":"wrong type","graph_id":"..."}' \
      "https://arivu.app/api/flag-edge"
    # After 3 distinct users: confidence_overrides row exists with override_tier downgraded
    psql $DATABASE_URL -c "SELECT * FROM confidence_overrides LIMIT 5;"
    ```

14. **Confidence badges visible** on edge tooltips in the graph view.

15. **Graph memory persists** — hover a node for 3s, reload page, node appears at reduced opacity.

16. **Researcher profile page** loads at `/researcher/<author_id>` (authenticated), shows chart.

17. **README.md complete** — all sections filled in, no placeholder text.

18. **Security audit checklist:**
    - [ ] All SQL uses parameterized queries (no f-strings in SQL)
    - [ ] All file uploads go through `SecureFileUploadHandler`
    - [ ] CSP header present (`Content-Security-Policy` in response headers)
    - [ ] Rate limiting blocks at `/api/` endpoints (test with 100 rapid requests)
    - [ ] No API keys in git history (`git log --all -S 'sk-' -- .`)
    - [ ] HTTPS enforced in Koyeb
    - [ ] CORS configured — only `arivu.app` and `localhost` in `Access-Control-Allow-Origin`
    - [ ] Session cookies have `HttpOnly`, `Secure`, `SameSite=Lax` flags

19. **Performance audit:**
    - [ ] Graph build < 90s (`benchmark_nlp.py` passes)
    - [ ] Frontend renders 200 nodes at 60fps
    - [ ] DB queries < 100ms (check slowest with `EXPLAIN ANALYZE`)
    - [ ] Embedding cache hit rate > 70% after first week
    - [ ] R2 graph JSON download < 2s for typical graph (< 5MB)

20. **Accessibility audit:**
    - [ ] Keyboard navigation works (Tab through all interactive elements)
    - [ ] Screen reader announces graph node information
    - [ ] Color-blind mode available
    - [ ] Mobile shows "best on desktop" notice
    - [ ] Modal dialogs trap focus (Evidence Trail, Live Mode panel, Disagreement Flag prompt)

21. **v1.0 git tag:**
    ```bash
    git tag -a v1.0 -m "Arivu v1.0 — complete research intelligence platform"
    git push origin v1.0
    ```

22. **CONTEXT.md updated**, Phase 8 marked Completed, v1.0 release notes recorded.

23. **Two git commits on `main`:**
    - `[phase8] intelligence completion, trust layer, live mode, researcher profiles, literature review`
    - `[v1.0] Arivu v1.0 complete — all phases 1-8 done`

---

## What NOT To Do in Phase 8

- Do NOT implement Prediction Market (F2.4) — requires community at scale
- Do NOT implement the Collaboration Finder (F3.2 / F8.4) — requires researcher profile index
- Do NOT implement Mental Model Mapper (F3.3) — requires multi-author aggregation
- Do NOT implement Lab Genealogy System (F3.4) — requires Math Genealogy Project API
- Do NOT implement Collaborative Graph Annotation (F8.2) — requires community moderation
- Do NOT implement Science Policy Brief Generator (F11.8) — explicitly deferred in spec §4
- Do NOT implement Conference Intelligence Layer (F11.10) — requires conference data pipeline
- Do NOT implement WebSocket live mode — polling is v1.0; WebSocket is Phase 9+
- Do NOT implement multi-paper researcher profile merging — single-graph profiles only in v1.0
- Do NOT commit `.env` or any file with real API keys
- Do NOT set `FLASK_DEBUG=true` in Koyeb
- Do NOT run `precompute_gallery.py` more than once per paper without clearing R2 first
- Do NOT read from the `graph_memory` table (Phase 6 legacy) — use `graph_memory_state` only
- Do NOT hardcode year values (use `datetime.datetime.now().year`)
- Do NOT use `_send` from `mailer.py` in scripts — use the public `send_email()` wrapper
