# PHASE 7 — Temporal Intelligence, Workflow Tools, Visualization Modes & Public API
## Version 2 — All 34 Gaps Resolved. Single Authoritative Source of Truth.

> **This file supersedes PHASE_7.md v1.**
> All 34 gaps identified in the gap analysis are resolved here. Do not reference the v1 file.

## Before You Start
1. Read `CLAUDE.md` — architecture non-negotiables apply throughout.
2. Read `CONTEXT.md` — verify Phase 6 is marked **Completed** before continuing.
3. **Phase 6 must be complete.** Run `python -m pytest tests/ -v` — all must pass.
4. **`ENABLE_AUTH=true` must be live in Koyeb** — Phase 7 features require authenticated users.
5. **Apply all §0 backports before writing any Phase 7 code.**
6. **Gather all credentials listed in §3 before starting §5+.**
7. This file is the **only** spec you need right now. Do not open any other phase file.

---

## What Phase 7 Produces

### Temporal Intelligence
- **The Time Machine** (F2.1) — animated field growth from any year to present, D3 timeline slider, play/pause, node appearance by year, edge thickness by citation age
- **Vocabulary Evolution Tracker** (F1.8) — TF-IDF term heatmap layer on the Time Machine, term appearance/peak/decline/replacement
- **The Extinction Event Detector** (F1.6) — research threads that died identified and annotated on the timeline
- **The Historical What-If Engine** (F2.2) — counterfactual reasoning in four tiers: structural fact → graph inference → reasoned speculation → imagination
- **The Counterfactual Engine** (F2.3) — deep version: intellectual necessity vs. contingency, LLM reasoning grounded in graph

### Visualization Modes
- **Living Constellation View** (F10.2) — papers as stars on deep space, gossamer edges, pruning as star-collapse, fully interactive
- **Geological Core Sample** (F10.3) — cross-section through time, horizontal year-layers, rotatable, paradigm shifts as geological unconformities
- **Idea Flow River System** (F10.4) — watershed visualization, foundational papers as mountain peaks, citation edges as rivers
- **Timeline View** (F10.5) — static chronological layout, papers on horizontal axis, citation arcs
- **View Mode Switcher** — seamless transition between all 5 modes, state preserved across switches

### Writing & Workflow Tools
- **The Adversarial Reviewer** (F4.1) — PDF upload, full security validation, 6-category analysis, structured PDF report
- **Paper Positioning Tool** (F4.2) — where a paper sits, natural comparators, strongest framing, venue recommendations
- **The Rewrite Suggester** (F4.3) — rewrite related-work sections as intellectual narrative
- **Citation Audit** (F4.4) — missing citation finder: unknown / known-but-skipped / conspicuous absence
- **The Reading Prioritizer** (F4.6) — rank any reading list by structural importance + novelty + velocity
- **The Citation Generator** (F4.9) — APA, MLA, Chicago, IEEE, Vancouver, Harvard; one-click copy; batch generation

### Experience Layer (Phase 3 stubs → real)
- **Research Persona System** (F5.2) — Explorer / Critic / Innovator / Historian modes wired to actual feature surfacing
- **The Insight Feed** (F5.4) — proactive discovery cards, progressive loading, click-to-navigate
- **Guided Discovery Flow** (F5.3) — two-question onboarding, structured pathway, progress tracking
- **Action Log / Research Journal** (F5.6) — exportable PDF research journal, full structured audit trail
- **Email change** — re-verification flow (deferred from Phase 6)

### Collaboration (Lab tier)
- **Lab Member Accounts** — Lab owners can invite team members, shared graph visibility
- **The Supervisor Dashboard** (F8.5) — PhD advisor interface, student monitoring, weekly digest
- **Shareable Graph Links** (F6.3) — permanent read-only URLs, no account required to view

### Public REST API (F9.1 + F9.2)
- **`/v1/` REST API** — 10 public endpoints, API key authentication, tier-based rate limiting
- **Webhook System** (F9.2) — subscribe to paper events, HMAC-signed payloads
- **Developer billing tier** — `$20/month` fourth pricing tier

### New files
```
backend/time_machine.py              ← TimeMachineEngine
backend/vocabulary_tracker.py       ← VocabularyEvolutionTracker
backend/extinction_detector.py      ← ExtinctionEventDetector
backend/counterfactual_engine.py    ← CounterfactualEngine
backend/adversarial_reviewer.py     ← AdversarialReviewer (PDF + abstract modes + PDF report)
backend/paper_positioning.py        ← PaperPositioningTool (NEW — fully specified in §5.7)
backend/rewrite_suggester.py        ← RewriteSuggester (NEW — fully specified in §5.8)
backend/citation_audit.py           ← CitationAudit
backend/reading_prioritizer.py      ← ReadingPrioritizer
backend/citation_generator.py       ← CitationGenerator: 6 formats
backend/persona_engine.py           ← PersonaEngine
backend/insight_engine.py           ← InsightEngine
backend/secure_upload.py            ← SecureFileUploadHandler
backend/public_api.py               ← Public REST API Blueprint (/v1/)
backend/webhook_manager.py          ← WebhookManager
backend/lab_manager.py              ← LabManager
scripts/migrate_phase7.py           ← Phase 7 DB schema additions
scripts/weekly_digest.py            ← Supervisor dashboard weekly digest cron job
tests/test_phase7.py                ← Phase 7 test suite
static/js/time-machine.js           ← TimeMachineController (replaces timeline.js stub)
static/js/constellation.js          ← ConstellationView (fully specified in §13)
static/js/geological.js             ← GeologicalView (fully specified in §14)
static/js/river-view.js             ← RiverView (fully specified in §15)
static/js/view-switcher.js          ← ViewSwitcher
static/js/insight-feed.js           ← InsightFeed (fully specified in §19)
static/js/persona.js                ← PersonaPanel (fully specified in §18)
static/js/workflow.js               ← WorkflowPanel (fully specified in §16)
static/js/citation-gen.js           ← CitationGenerator frontend (fully specified in §17)
templates/shared_graph.html         ← Read-only shared graph view
templates/supervisor.html           ← Supervisor dashboard (fully specified in §24)
templates/api_docs.html             ← Public API documentation page (fully specified in §25)
```

### Modified
```
app.py                  ← register public_api Blueprint, all Phase 7 routes
backend/config.py       ← STRIPE_DEVELOPER_PRICE_ID, WEBHOOK_SIGNING_SECRET, API_BASE_URL additions
backend/rate_limiter.py ← Phase 7 endpoint limits
backend/billing.py      ← Developer ($20/month) tier + webhook handler update
backend/mailer.py       ← lab invite email, weekly digest email, email change flow
backend/auth.py         ← email change route with re-verification
templates/pricing.html  ← Developer tier column (specified in §2.4)
templates/account.html  ← email change form, lab member management (specified in §22.3)
templates/base.html     ← persona mode switcher in nav, insight feed sidebar (specified in §22.2)
templates/tool.html     ← Time Machine slider, view mode switcher, workflow panel (specified in §22.1)
templates/auth/login.html ← invite token preservation through login (specified in §30)
static/js/panels.js     ← wire Insight Feed and Persona modes into right panel (specified in §20)
static/js/graph.js      ← view-mode rendering hooks + readOnly support (specified in §21)
CONTEXT.md              ← Phase 7 → Completed
```

### Unchanged (do not touch)
```
backend/independent_discovery.py
backend/citation_shadow.py
backend/field_fingerprint.py
backend/serendipity_engine.py
backend/gdpr.py
backend/nlp_pipeline.py
backend/export_generator.py
backend/living_paper_scorer.py
backend/originality_mapper.py
backend/paradigm_detector.py
All Phase 1–6 tests
scripts/migrate.py
scripts/migrate_phase6.py
```

---

## Architecture Reminders for Phase 7

- The main Koyeb server **still may never** import `sentence_transformers`, `torch`, or any ML model library. All Phase 7 intelligence features use pre-computed embeddings from `paper_embeddings` via pgvector, the NLP worker for new embedding requests, and the Groq LLM client for reasoning.
- **The Adversarial Reviewer** is the only Phase 7 feature that requires file upload. Use `SecureFileUploadHandler` (§5.1) — 4-layer PDF validation before any processing.
- **Webhook delivery** uses background threads, not the request cycle. Never block a user request waiting for a webhook to deliver.
- **The Developer API tier** reuses the existing Lab API key infrastructure (`api_keys` table). A Developer-tier user gets `tier='developer'` from Stripe webhook handling — not a new DB user type.
- **Visualization modes** (constellation, geological, river) are pure frontend JavaScript — no new backend routes. They transform the same graph JSON from Phase 2's stream into different D3.js renderings.
- **Phase 3 stubs fully replaced**: `static/js/constellation.js`, `static/js/timeline.js` → replaced by `time-machine.js`, `static/js/insight-feed.js`. Replace these files entirely.
- **`vocabulary_snapshots` table IS used** — `TimeMachineEngine.build_timeline()` reads and writes it as a cache layer. Do not skip the caching logic.
- **`WEBHOOK_SIGNING_SECRET`** is a global fallback secret used when a subscriber does not provide their own secret on subscription creation. It is not the Stripe webhook secret (that is `STRIPE_WEBHOOK_SECRET` from Phase 6).

---

## §0 — Backports (Apply Before Any Phase 7 Code)

### §0.1 — Add `developer` tier to users table CHECK constraint

```bash
psql $DATABASE_URL -c "
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_tier_check;
ALTER TABLE users ADD CONSTRAINT users_tier_check
  CHECK(tier IN ('free', 'researcher', 'lab', 'developer'));
"
```

Update `TIER_ORDER` in `backend/decorators.py`:
```python
TIER_ORDER = {"free": 0, "researcher": 1, "developer": 2, "lab": 3}
```

### §0.2 — Add `developer` to api_keys tier scope CHECK (GAP-P7-19)

The `api_keys` table from Phase 6 may have a CHECK constraint on scopes or no constraint at all. Ensure Developer-tier keys are valid:
```bash
psql $DATABASE_URL -c "
-- Verify: if api_keys has a tier-based check constraint, extend it
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint WHERE conrelid = 'api_keys'::regclass;
-- If a tier check exists, alter it to include 'developer'.
-- If none exists, nothing to do.
"
```

### §0.3 — Verify publication_date column exists on papers table

```bash
psql $DATABASE_URL -c "\d papers" | grep publication_date
# Expected: publication_date | date |
# If missing:
psql $DATABASE_URL -c "ALTER TABLE papers ADD COLUMN IF NOT EXISTS publication_date DATE;"
```

### §0.4 — Verify lab_memberships.joined_at column name (GAP-P7-20)

Phase 6 created `lab_memberships`. Verify the correct column name:
```bash
psql $DATABASE_URL -c "\d lab_memberships"
# If the timestamp column is called 'created_at' rather than 'joined_at', note this.
# weekly_digest.py and lab_manager.py both use 'joined_at'. If it's 'created_at', use:
psql $DATABASE_URL -c "ALTER TABLE lab_memberships RENAME COLUMN created_at TO joined_at;"
# If already joined_at, skip this.
```

### §0.5 — requirements.txt: Add Phase 7 packages

Add to `requirements.txt`:
```
python-magic==0.4.27    # PDF magic bytes validation for Adversarial Reviewer
pymupdf==1.24.5         # PDF text extraction for Adversarial Reviewer (import fitz)
```

Remove `pyahocorasick` — it is NOT used in Phase 7 (VocabularyTracker uses stdlib regex).

Verify python-magic and pymupdf have libmagic/libmupdf system dependencies (already in Dockerfile):
```dockerfile
# In Dockerfile, apt-get install line must include:
RUN apt-get install -y libmagic1 libmupdf-dev
```

### §0.6 — .env.example: Add Phase 7 variables (GAP-P7-21)

Add to `.env.example`:
```bash
# Phase 7 — Developer tier, Webhooks, Public API
STRIPE_DEVELOPER_PRICE_ID=price_xxx      # Stripe price ID for Developer $20/mo plan
WEBHOOK_SIGNING_SECRET=                  # Global fallback HMAC secret for webhook subscriptions
API_BASE_URL=https://arivu.app           # Public base URL for API docs
MAX_UPLOAD_MB=10                         # Max PDF upload size in MB
```

---

## §1 — Phase 7 DB Migration: scripts/migrate_phase7.py

```python
#!/usr/bin/env python3
"""
scripts/migrate_phase7.py
Phase 7 schema additions. Safe to re-run.
Usage: python scripts/migrate_phase7.py
"""
import sys, logging
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

PHASE_7_SQL = """
-- ── Developer tier: extend CHECK constraint ──────────────────────────────────
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_tier_check;
ALTER TABLE users ADD CONSTRAINT users_tier_check
    CHECK(tier IN ('free', 'researcher', 'lab', 'developer'));

-- ── Shared graph links (F6.3) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shared_graphs (
    share_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    share_token     TEXT        UNIQUE NOT NULL,
    graph_id        TEXT        NOT NULL,
    user_id         UUID        REFERENCES users(user_id) ON DELETE CASCADE,
    seed_paper_id   TEXT,
    seed_title      TEXT,
    view_mode       TEXT        NOT NULL DEFAULT 'force',
    view_state      JSONB       NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ,
    view_count      INT         NOT NULL DEFAULT 0,
    last_viewed_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_shared_graphs_token  ON shared_graphs(share_token);
CREATE INDEX IF NOT EXISTS idx_shared_graphs_user   ON shared_graphs(user_id);
CREATE INDEX IF NOT EXISTS idx_shared_graphs_graph  ON shared_graphs(graph_id);

-- ── Vocabulary evolution cache ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vocabulary_snapshots (
    id          SERIAL      PRIMARY KEY,
    graph_id    TEXT        NOT NULL,
    year        INT         NOT NULL,
    terms_json  JSONB       NOT NULL DEFAULT '{}',
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(graph_id, year)
);
CREATE INDEX IF NOT EXISTS idx_vocab_graph ON vocabulary_snapshots(graph_id);

-- ── Time Machine full result cache ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS time_machine_cache (
    id          SERIAL      PRIMARY KEY,
    graph_id    TEXT        UNIQUE NOT NULL,
    result_json JSONB       NOT NULL,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tmc_graph ON time_machine_cache(graph_id);

-- ── Counterfactual analysis cache ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS counterfactual_cache (
    id              SERIAL      PRIMARY KEY,
    graph_id        TEXT        NOT NULL,
    paper_id        TEXT        NOT NULL,
    result_json     JSONB       NOT NULL,
    computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(graph_id, paper_id)
);
CREATE INDEX IF NOT EXISTS idx_cf_cache ON counterfactual_cache(graph_id, paper_id);

-- ── Adversarial review jobs ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS adversarial_reviews (
    review_id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    session_id      TEXT,
    file_hash       TEXT        NOT NULL,
    file_name       TEXT,
    status          TEXT        NOT NULL DEFAULT 'pending'
                    CHECK(status IN ('pending','processing','done','failed')),
    result_json     JSONB,
    report_r2_key   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_adv_review_user ON adversarial_reviews(user_id);
CREATE INDEX IF NOT EXISTS idx_adv_review_hash ON adversarial_reviews(file_hash);

-- ── Persona modes per session/user ───────────────────────────────────────────
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS persona_mode TEXT DEFAULT 'explorer'
    CHECK(persona_mode IN ('explorer','critic','innovator','historian'));
ALTER TABLE users    ADD COLUMN IF NOT EXISTS default_persona TEXT DEFAULT 'explorer'
    CHECK(default_persona IN ('explorer','critic','innovator','historian'));

-- ── Lab member accounts ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lab_invites (
    invite_id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    lab_user_id     UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    invite_token    TEXT        UNIQUE NOT NULL,
    invitee_email   TEXT        NOT NULL,
    role            TEXT        NOT NULL DEFAULT 'member' CHECK(role IN ('owner','member')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
    accepted_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_lab_invites_lab   ON lab_invites(lab_user_id);
CREATE INDEX IF NOT EXISTS idx_lab_invites_email ON lab_invites(invitee_email);
CREATE INDEX IF NOT EXISTS idx_lab_invites_token ON lab_invites(invite_token);

-- ── Webhooks (F9.2) ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webhook_subscriptions (
    subscription_id UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    paper_id        TEXT        NOT NULL,
    webhook_url     TEXT        NOT NULL,
    events          TEXT[]      NOT NULL,
    secret          TEXT        NOT NULL,
    active          BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_triggered  TIMESTAMPTZ,
    failure_count   INT         NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_webhooks_user   ON webhook_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_paper  ON webhook_subscriptions(paper_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_active ON webhook_subscriptions(paper_id)
    WHERE active = TRUE;

-- ── Webhook delivery log ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webhook_deliveries (
    delivery_id     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID        NOT NULL REFERENCES webhook_subscriptions(subscription_id),
    event_type      TEXT        NOT NULL,
    payload_json    JSONB,
    status          TEXT        NOT NULL DEFAULT 'pending'
                    CHECK(status IN ('pending','delivered','failed')),
    http_status     INT,
    attempt_count   INT         NOT NULL DEFAULT 0,
    last_attempt_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_webhook_del_sub ON webhook_deliveries(subscription_id);

-- ── Email change tokens ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_change_tokens (
    token_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    new_email       TEXT        NOT NULL,
    token           TEXT        UNIQUE NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '1 hour',
    used_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_email_change_user  ON email_change_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_email_change_token ON email_change_tokens(token);

-- ── papers table: publication_date ────────────────────────────────────────────
ALTER TABLE papers ADD COLUMN IF NOT EXISTS publication_date DATE;

-- ── graphs table: shared_count for analytics ──────────────────────────────────
ALTER TABLE graphs ADD COLUMN IF NOT EXISTS shared_count INT NOT NULL DEFAULT 0;

-- NOTE: researcher_profiles is NOT created here — F3.1 is Phase 8+.
"""


def run():
    from dotenv import load_dotenv
    load_dotenv()
    import backend.db as db
    from backend.config import Config
    db.init_pool(database_url=Config.DATABASE_URL)
    logger.info("Running Phase 7 migrations...")
    try:
        db.execute(PHASE_7_SQL)
        logger.info("Phase 7 schema applied successfully.")
    except Exception as exc:
        logger.error(f"Migration failed: {exc}")
        sys.exit(1)

    expected_tables = [
        "shared_graphs", "vocabulary_snapshots", "time_machine_cache",
        "counterfactual_cache", "adversarial_reviews", "lab_invites",
        "webhook_subscriptions", "webhook_deliveries", "email_change_tokens",
    ]
    rows = db.fetchall(
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_schema='public' AND table_name = ANY(%s)",
        (expected_tables,),
    )
    found   = {r["table_name"] for r in rows}
    missing = set(expected_tables) - found
    if missing:
        logger.error(f"Missing tables after migration: {missing}")
        sys.exit(1)
    logger.info(f"Verified {len(expected_tables)} tables. Phase 7 migration complete.")


if __name__ == "__main__":
    run()
```

Run immediately:
```bash
python scripts/migrate_phase7.py
```

---

## §2 — Developer Tier & Updated Billing

### §2.1 — backend/config.py Additions

```python
    # ── Phase 7 — Developer tier, Webhooks, API ───────────────────────────────
    STRIPE_DEVELOPER_PRICE_ID = os.environ.get("STRIPE_DEVELOPER_PRICE_ID", "")
    WEBHOOK_SIGNING_SECRET    = os.environ.get("WEBHOOK_SIGNING_SECRET", "")
    API_BASE_URL              = os.environ.get("API_BASE_URL", "https://arivu.app")
    MAX_UPLOAD_MB             = int(os.environ.get("MAX_UPLOAD_MB", "10"))
```

Add to `Config.validate()` warnings:
```python
if not cls.STRIPE_DEVELOPER_PRICE_ID and cls.ENABLE_AUTH:
    logger.warning("STRIPE_DEVELOPER_PRICE_ID not set — Developer tier billing unavailable")
if not cls.WEBHOOK_SIGNING_SECRET:
    logger.warning("WEBHOOK_SIGNING_SECRET not set — webhook subscriptions will use random per-subscription secrets only")
```

### §2.2 — Stripe: Create Developer Product

In Stripe dashboard:
1. Create product: "Developer" — $20/month recurring
2. Copy Price ID → `STRIPE_DEVELOPER_PRICE_ID`
3. Add to Koyeb env vars

### §2.3 — backend/billing.py: Add Developer Tier

Update `_get_tier_by_price_id()`:
```python
def _get_tier_by_price_id() -> dict:
    return {
        Config.STRIPE_RESEARCHER_PRICE_ID: "researcher",
        Config.STRIPE_LAB_PRICE_ID:        "lab",
        Config.STRIPE_DEVELOPER_PRICE_ID:  "developer",
    }
```

Update `create_checkout_session()`:
```python
price_id = {
    "researcher": Config.STRIPE_RESEARCHER_PRICE_ID,
    "lab":        Config.STRIPE_LAB_PRICE_ID,
    "developer":  Config.STRIPE_DEVELOPER_PRICE_ID,
}.get(tier)
```

Update the Stripe webhook handler — the `customer.subscription.deleted` and `invoice.payment_failed` handlers must already call `_get_tier_by_price_id()` to resolve the tier. Verify the handler does NOT have any hardcoded `tier IN ('researcher', 'lab')` guard:
```python
# In the webhook handler for subscription events, the tier lookup uses:
tier = _get_tier_by_price_id().get(price_id)
# Now that 'developer' is in the dict, Developer subscriptions are handled automatically.
# VERIFY: grep billing.py for any hardcoded tier lists and add 'developer' where missing.
```

### §2.4 — templates/pricing.html: Add Developer Tier Column

Add fourth column to the pricing grid (insert between Researcher and Lab):

```html
<!-- Insert in pricing-grid, after Researcher card -->
<div class="pricing-card {% if user and user.tier == 'developer' %}current-plan{% endif %}">
  <div class="plan-name">Developer</div>
  <div class="plan-price">$20 <span class="plan-period">/ month</span></div>
  <ul class="plan-features">
    <li><strong>Everything in Researcher</strong></li>
    <li>Public REST API (10,000 req/day)</li>
    <li>API key management (up to 5 keys)</li>
    <li>Webhook subscriptions (up to 10)</li>
    <li>Adversarial Reviewer (10 reviews/month)</li>
    <li>Graph sharing (permanent links)</li>
  </ul>
  {% if not user %}
    <a href="/register" class="btn-primary plan-btn">Sign up free</a>
  {% elif user.tier == 'developer' %}
    <button class="btn-secondary plan-btn" onclick="openPortal()">Manage billing</button>
  {% elif user.tier in ('free', 'researcher') %}
    <button class="btn-primary plan-btn" onclick="checkout('developer')">Upgrade to Developer</button>
  {% endif %}
</div>
```

Update the pricing grid CSS in `static/css/auth.css`:
```css
.pricing-grid { grid-template-columns: repeat(4, 1fr); }
@media (max-width: 900px) { .pricing-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 500px) { .pricing-grid { grid-template-columns: 1fr; } }
```

---

## §3 — Account Setup (Human Steps)

### §3.1 — Create Stripe Developer Product
(See §2.2 above)

### §3.2 — Generate Webhook Signing Secret
```bash
python -c "import secrets; print(secrets.token_hex(32))"
# → Copy to WEBHOOK_SIGNING_SECRET in Koyeb
```

### §3.3 — Koyeb Environment Variables
Add to Koyeb dashboard:
```
STRIPE_DEVELOPER_PRICE_ID=price_...
WEBHOOK_SIGNING_SECRET=<generated above>
API_BASE_URL=https://arivu.app
MAX_UPLOAD_MB=10
```

---

## §4 — Temporal Intelligence Backend

### §4.1 — backend/time_machine.py

```python
"""
backend/time_machine.py — TimeMachineEngine (F2.1)

Computes temporal slices of a citation graph for the Time Machine visualization.
Results cached in time_machine_cache table (7-day TTL).

FIX (GAP-P7-N6): ExtinctionEventDetector.detect() called ONCE, not O(N_years) times.
FIX (GAP-P7-N5): vocabulary_snapshots table is used as a read/write cache.
"""
import json
import logging
from dataclasses import dataclass, field
from typing import Optional

import backend.db as db

logger = logging.getLogger(__name__)


@dataclass
class TemporalSlice:
    year:            int
    nodes:           list
    edges:           list
    added_nodes:     list
    added_edges:     list
    node_weights:    dict
    paradigm_events: list
    extinction_events: list

    def to_dict(self) -> dict:
        return {
            "year":              self.year,
            "nodes":             self.nodes,
            "edges":             self.edges,
            "added_nodes":       self.added_nodes,
            "added_edges":       self.added_edges,
            "node_weights":      self.node_weights,
            "paradigm_events":   self.paradigm_events,
            "extinction_events": self.extinction_events,
        }


class TimeMachineEngine:
    """Stateless — instantiate fresh per request."""

    def build_timeline(self, graph_json: dict) -> dict:
        """
        Build the complete temporal dataset for the Time Machine.
        Checks time_machine_cache first (7-day TTL).
        Writes result to cache on miss.
        """
        graph_id = graph_json.get("metadata", {}).get("graph_id", "")

        # Check full result cache first
        if graph_id:
            cached = db.fetchone(
                "SELECT result_json FROM time_machine_cache "
                "WHERE graph_id = %s AND computed_at > NOW() - INTERVAL '7 days'",
                (graph_id,),
            )
            if cached:
                return cached["result_json"]

        result = self._compute_timeline(graph_json)

        # Write to cache
        if graph_id:
            db.execute(
                """
                INSERT INTO time_machine_cache (graph_id, result_json)
                VALUES (%s, %s::jsonb)
                ON CONFLICT (graph_id) DO UPDATE
                SET result_json=EXCLUDED.result_json, computed_at=NOW()
                """,
                (graph_id, json.dumps(result, default=str)),
            )

        return result

    def _compute_timeline(self, graph_json: dict) -> dict:
        nodes = graph_json.get("nodes", [])
        edges = graph_json.get("edges", [])

        if not nodes:
            return {"min_year": 0, "max_year": 0, "slices": {},
                    "vocabulary_heatmap": {}, "extinction_events": [], "paradigm_events": []}

        years = [n.get("year") for n in nodes if n.get("year")]
        if not years:
            return {"min_year": 0, "max_year": 0, "slices": {},
                    "vocabulary_heatmap": {}, "extinction_events": [], "paradigm_events": []}

        min_year = min(years)
        max_year = max(years)

        # FIX (GAP-P7-N6): Call detect() ONCE before the loop, not inside it.
        from backend.extinction_detector import ExtinctionEventDetector
        all_extinction_events = ExtinctionEventDetector().detect(graph_json)
        all_paradigm_events   = graph_json.get("paradigm_data", {}).get("shift_events", [])

        # Index events by year for O(1) per-year lookup inside loop
        extinction_by_year: dict = {}
        for e in all_extinction_events:
            for yr in [e.get("peak_year"), e.get("end_year")]:
                if yr:
                    extinction_by_year.setdefault(yr, []).append(e)

        paradigm_by_year: dict = {}
        for pe in all_paradigm_events:
            yr = pe.get("year")
            if yr:
                paradigm_by_year.setdefault(yr, []).append(pe)

        slices:          dict = {}
        prev_node_ids:   set  = set()
        prev_edge_keys:  set  = set()

        for year in range(min_year, max_year + 1):
            year_nodes    = [n for n in nodes if n.get("year") and n["year"] <= year]
            year_node_ids = {n["id"] for n in year_nodes}

            year_edges = [
                e for e in edges
                if (e.get("source") or e.get("citing_paper_id", "")) in year_node_ids
                and (e.get("target") or e.get("cited_paper_id", "")) in year_node_ids
            ]

            node_weights: dict = {}
            for node_id in year_node_ids:
                node_weights[node_id] = sum(
                    1 for e in year_edges
                    if (e.get("target") or e.get("cited_paper_id", "")) == node_id
                )

            added_nodes = [n for n in year_nodes if n["id"] not in prev_node_ids]
            edge_keys   = {(e.get("source",""), e.get("target","")) for e in year_edges}
            added_edges = [e for e in year_edges
                           if (e.get("source",""), e.get("target","")) not in prev_edge_keys]

            slices[year] = TemporalSlice(
                year=year,
                nodes=year_nodes,
                edges=year_edges,
                added_nodes=added_nodes,
                added_edges=added_edges,
                node_weights=node_weights,
                paradigm_events=paradigm_by_year.get(year, []),
                extinction_events=extinction_by_year.get(year, []),
            ).to_dict()

            prev_node_ids  = year_node_ids
            prev_edge_keys = edge_keys

        # Build vocabulary heatmap with caching via vocabulary_snapshots
        from backend.vocabulary_tracker import VocabularyEvolutionTracker
        vocab             = VocabularyEvolutionTracker()
        graph_id          = graph_json.get("metadata", {}).get("graph_id", "")
        vocabulary_heatmap = vocab.build_heatmap_cached(graph_json, min_year, max_year, graph_id)

        return {
            "min_year":           min_year,
            "max_year":           max_year,
            "slices":             slices,
            "vocabulary_heatmap": vocabulary_heatmap,
            "extinction_events":  all_extinction_events,
            "paradigm_events":    all_paradigm_events,
        }
```

### §4.2 — backend/vocabulary_tracker.py

```python
"""
backend/vocabulary_tracker.py — VocabularyEvolutionTracker (F1.8)

FIX (GAP-P7-N5): build_heatmap_cached() reads/writes vocabulary_snapshots table.
"""
import json
import logging
import math
import re
from collections import defaultdict

import backend.db as db

logger = logging.getLogger(__name__)

STOP_WORDS = {
    "the","a","an","and","or","but","in","on","at","to","for","of","with",
    "by","from","as","is","was","are","were","be","been","being","have","has",
    "had","do","does","did","will","would","could","should","may","might","must",
    "this","that","these","those","it","its","we","our","they","their",
    "paper","study","method","approach","results","using","used","based","which",
    "also","show","shows","shown","propose","proposed","present","presents","work",
}
MIN_TERM_LENGTH = 3
MAX_TERMS_PER_YEAR = 30


class VocabularyEvolutionTracker:

    def build_heatmap_cached(
        self, graph_json: dict, min_year: int, max_year: int, graph_id: str
    ) -> dict:
        """
        Build vocabulary heatmap with DB caching.
        Reads per-year snapshots from vocabulary_snapshots; writes any missing years.
        """
        if not graph_id:
            return self.build_heatmap(graph_json, min_year, max_year)

        # Load all cached years for this graph
        rows = db.fetchall(
            "SELECT year, terms_json FROM vocabulary_snapshots WHERE graph_id = %s",
            (graph_id,),
        )
        cached: dict = {r["year"]: r["terms_json"] for r in rows}

        needed_years = [y for y in range(min_year, max_year + 1) if y not in cached]
        if needed_years:
            full_heatmap = self.build_heatmap(graph_json, min_year, max_year)
            for year in needed_years:
                terms = full_heatmap.get(year, {})
                try:
                    db.execute(
                        """
                        INSERT INTO vocabulary_snapshots (graph_id, year, terms_json)
                        VALUES (%s, %s, %s::jsonb)
                        ON CONFLICT (graph_id, year) DO UPDATE SET terms_json=EXCLUDED.terms_json
                        """,
                        (graph_id, year, json.dumps(terms)),
                    )
                except Exception as exc:
                    logger.warning(f"Failed to cache vocab snapshot: {exc}")
                cached[year] = terms

        return {y: cached.get(y, {}) for y in range(min_year, max_year + 1)}

    def build_heatmap(self, graph_json: dict, min_year: int, max_year: int) -> dict:
        """Build vocabulary heatmap without caching."""
        nodes = graph_json.get("nodes", [])
        if not nodes:
            return {}

        docs_by_year: dict = defaultdict(list)
        for node in nodes:
            year = node.get("year")
            if not year:
                continue
            text = node.get("abstract") or node.get("title") or ""
            if text:
                docs_by_year[year].append(text.lower())

        if not docs_by_year:
            return {}

        year_term_freqs: dict = {}
        all_terms: set = set()

        for year, texts in docs_by_year.items():
            combined = " ".join(texts)
            tokens   = re.findall(r'\b[a-z][a-z\-]{2,}\b', combined)
            freq: dict = defaultdict(int)
            for tok in tokens:
                if tok not in STOP_WORDS and len(tok) >= MIN_TERM_LENGTH:
                    freq[tok] += 1
            total = max(sum(freq.values()), 1)
            year_term_freqs[year] = {term: count / total for term, count in freq.items()}
            all_terms.update(freq.keys())

        year_count = len(year_term_freqs)
        idf: dict = {}
        for term in all_terms:
            docs_with_term = sum(1 for yf in year_term_freqs.values() if term in yf)
            idf[term] = math.log((year_count + 1) / (docs_with_term + 1)) + 1

        heatmap: dict = {}
        for year in range(min_year, max_year + 1):
            if year not in year_term_freqs:
                heatmap[year] = {}
                continue
            tf    = year_term_freqs[year]
            tfidf = {term: tf_score * idf.get(term, 1.0) for term, tf_score in tf.items()}
            top   = sorted(tfidf.items(), key=lambda x: x[1], reverse=True)[:MAX_TERMS_PER_YEAR]
            max_s = top[0][1] if top else 1.0
            heatmap[year] = {term: round(score / max_s, 3) for term, score in top}

        return heatmap

    def find_term_trajectories(self, heatmap: dict) -> list:
        all_terms: set = set()
        for year_data in heatmap.values():
            all_terms.update(year_data.keys())

        years   = sorted(heatmap.keys())
        results = []

        for term in all_terms:
            scores = [(y, heatmap[y].get(term, 0)) for y in years]
            present = [(y, s) for y, s in scores if s > 0]
            if len(present) < 2:
                continue

            first_year = present[0][0]
            peak_year  = max(present, key=lambda x: x[1])[0]
            last_year  = present[-1][0]
            last_score = present[-1][1]
            peak_score = max(s for _, s in present)

            if last_year == years[-1] and last_score > 0.5 * peak_score:
                trajectory = "emerging" if first_year >= years[-3] else "rising"
            elif peak_year < years[-2] and last_score < 0.3 * peak_score:
                trajectory = "declining"
            else:
                trajectory = "peaked"

            results.append({
                "term":       term,
                "trajectory": trajectory,
                "peak_year":  peak_year,
                "first_year": first_year,
                "peak_score": round(peak_score, 3),
            })

        return sorted(results, key=lambda x: x["peak_score"], reverse=True)[:50]
```

### §4.3 — backend/extinction_detector.py

```python
"""
backend/extinction_detector.py — ExtinctionEventDetector (F1.6)

Research threads that died from paradigm shift or abandonment.
Does NOT call NLP worker — uses graph structure + year data only.
"""
import logging
from dataclasses import dataclass
from collections import defaultdict

logger = logging.getLogger(__name__)

MINIMUM_CLUSTER_SIZE = 3
EXTINCTION_WINDOW    = 5
NEAR_ZERO_THRESHOLD  = 0.1


@dataclass
class ExtinctionEvent:
    cluster_papers:     list
    cluster_label:      str
    peak_year:          int
    end_year:           int
    peak_citation_rate: float
    cause:              str
    notes:              str

    def to_dict(self) -> dict:
        return {
            "cluster_papers":     self.cluster_papers,
            "cluster_label":      self.cluster_label,
            "peak_year":          self.peak_year,
            "end_year":           self.end_year,
            "peak_citation_rate": round(self.peak_citation_rate, 2),
            "cause":              self.cause,
            "notes":              self.notes,
        }


class ExtinctionEventDetector:

    def detect(self, graph_json: dict) -> list:
        nodes = graph_json.get("nodes", [])
        edges = graph_json.get("edges", [])

        if len(nodes) < MINIMUM_CLUSTER_SIZE * 2:
            return []

        clusters: dict = defaultdict(list)
        node_by_id     = {n["id"]: n for n in nodes}

        for node in nodes:
            fields  = node.get("fields_of_study") or ["unknown"]
            primary = fields[0] if fields else "unknown"
            clusters[primary].append(node)

        results = []
        for cluster_label, cluster_nodes in clusters.items():
            if len(cluster_nodes) < MINIMUM_CLUSTER_SIZE:
                continue

            years = sorted({n.get("year") for n in cluster_nodes if n.get("year")})
            if len(years) < 3:
                continue

            paper_ids_in_cluster = {n["id"] for n in cluster_nodes}
            citing_by_year: dict = defaultdict(int)

            for edge in edges:
                src = edge.get("source") or edge.get("citing_paper_id", "")
                tgt = edge.get("target") or edge.get("cited_paper_id", "")
                if tgt in paper_ids_in_cluster and src not in paper_ids_in_cluster:
                    src_year = node_by_id.get(src, {}).get("year")
                    if src_year:
                        citing_by_year[src_year] += 1

            if not citing_by_year:
                continue

            all_cite_years = sorted(citing_by_year.keys())
            if len(all_cite_years) < 3:
                continue

            peak_rate = max(citing_by_year.values())
            peak_year = max(citing_by_year, key=citing_by_year.get)
            post_peak = [y for y in all_cite_years if y > peak_year]
            if len(post_peak) < EXTINCTION_WINDOW:
                continue

            window_rates = [citing_by_year.get(y, 0) for y in post_peak[:EXTINCTION_WINDOW]]
            if max(window_rates) > NEAR_ZERO_THRESHOLD * peak_rate:
                continue

            paradigm_events = graph_json.get("paradigm_data", {}).get("shift_events", [])
            cause = "unknown"
            for pe in paradigm_events:
                if abs(pe.get("year", 0) - peak_year) <= 3:
                    cause = "paradigm_shift"
                    break
            if cause == "unknown":
                cause = "abandoned"

            end_year = post_peak[0]
            results.append(ExtinctionEvent(
                cluster_papers=list(paper_ids_in_cluster),
                cluster_label=cluster_label,
                peak_year=peak_year,
                end_year=end_year,
                peak_citation_rate=peak_rate,
                cause=cause,
                notes=(
                    f"The {cluster_label} cluster peaked around {peak_year} "
                    f"with {peak_rate:.0f} incoming citations, then fell to near-zero "
                    f"by {end_year}. Likely cause: {cause.replace('_', ' ')}."
                ),
            ).to_dict())

        return sorted(results, key=lambda x: x["peak_year"])
```

### §4.4 — backend/counterfactual_engine.py

*(Identical to v1 — no changes needed in this module. Reproduce verbatim from PHASE_7.md v1 §4.4.)*

---

## §5 — Writing & Workflow Backend Modules

### §5.1 — backend/secure_upload.py
*(Identical to v1. Reproduce verbatim from PHASE_7.md v1 §5.1.)*

### §5.2 — backend/adversarial_reviewer.py

The `review_from_pdf()` method now also generates a PDF report via `ExportGenerator` and uploads it to R2, populating `report_r2_key`.

```python
"""
backend/adversarial_reviewer.py — AdversarialReviewer (F4.1)

FIX (GAP-P7-N11): PDF report is now generated via ExportGenerator and stored in R2.
"""
import json
import logging
import hashlib
from dataclasses import dataclass, field
from typing import Optional

import backend.db as db
from backend.config import Config
from backend.llm_client import LLMClient

logger = logging.getLogger(__name__)

MAX_LANDSCAPE_PAPERS = 15
MAX_ABSTRACT_CHARS   = 4000


@dataclass
class AdversarialReviewResult:
    paper_title:          str
    paper_abstract:       str
    weak_citation_claims: list
    missing_citations:    list
    missing_by_type:      dict
    novelty_ancestors:    list
    novelty_assessment:   str
    intellectual_position: str
    natural_comparators:  list
    reviewer_criticisms:  list
    identified_strengths: list
    confidence:           str

    def to_dict(self) -> dict:
        return {
            "paper_title":         self.paper_title,
            "paper_abstract":      self.paper_abstract[:500] + "...",
            "confidence":          self.confidence,
            "citation_weaknesses": self.weak_citation_claims,
            "missing_citations": {
                "all":     self.missing_citations,
                "by_type": self.missing_by_type,
            },
            "novelty": {
                "ancestors":  self.novelty_ancestors,
                "assessment": self.novelty_assessment,
            },
            "landscape": {
                "position":            self.intellectual_position,
                "natural_comparators": self.natural_comparators,
            },
            "reviewer_criticisms": self.reviewer_criticisms,
            "strengths":           self.identified_strengths,
        }


class AdversarialReviewer:

    def review_from_pdf(
        self, pdf_bytes: bytes, filename: str, user_id: str, review_id: str = ""
    ) -> AdversarialReviewResult:
        """Full review from PDF upload. Generates PDF report and stores in R2."""
        try:
            import fitz  # PyMuPDF
            doc  = fitz.open(stream=pdf_bytes, filetype="pdf")
            text = "\n".join(page.get_text() for page in doc)
            doc.close()
        except Exception as exc:
            logger.warning(f"PDF extraction failed: {exc} — falling back to abstract-only")
            return self._review_abstract_only("Uploaded PDF", "", "pdf_extraction_failed")

        abstract = self._extract_abstract(text)
        title    = self._extract_title(text)
        result   = self._run_analysis(title, abstract, text, confidence="full_text")

        # Generate PDF report and upload to R2 (GAP-P7-N11 fix)
        if review_id:
            try:
                self._generate_and_store_report(result, review_id)
            except Exception as exc:
                logger.warning(f"PDF report generation failed (non-fatal): {exc}")

        return result

    def _generate_and_store_report(self, result: AdversarialReviewResult, review_id: str):
        """Generate a PDF report and upload to R2. Update adversarial_reviews.report_r2_key."""
        from backend.export_generator import ExportGenerator
        from backend.r2_client import R2Client

        report_data = {
            "type":  "adversarial_review",
            "title": f"Adversarial Review: {result.paper_title}",
            "sections": [
                {
                    "heading": "Intellectual Position",
                    "body":    result.intellectual_position,
                },
                {
                    "heading": "Missing Citations",
                    "body":    (
                        f"Found {len(result.missing_citations)} potential missing citations. "
                        + " | ".join(
                            f"{m.get('title','?')} ({m.get('category','?')})"
                            for m in result.missing_citations[:5]
                        )
                    ),
                },
                {
                    "heading": "Novelty Assessment",
                    "body":    (
                        f"Assessment: {result.novelty_assessment}. "
                        + (
                            f"Closest ancestor: {result.novelty_ancestors[0].get('title','?')}"
                            if result.novelty_ancestors else "No close ancestors found."
                        )
                    ),
                },
                {
                    "heading": "Reviewer Criticisms",
                    "items":   [
                        f"[{c.get('severity','?').upper()}] {c.get('criticism','?')}"
                        for c in result.reviewer_criticisms
                    ],
                },
                {
                    "heading": "Strengths",
                    "items":   [s.get("strength", "") for s in result.identified_strengths],
                },
            ],
        }

        generator = ExportGenerator()
        pdf_bytes = generator.generate_pdf(report_data)
        r2_key    = f"adversarial_reviews/{review_id}/report.pdf"
        R2Client().upload_bytes(r2_key, pdf_bytes, content_type="application/pdf")

        db.execute(
            "UPDATE adversarial_reviews SET report_r2_key = %s WHERE review_id = %s::uuid",
            (r2_key, review_id),
        )
        logger.info(f"Adversarial review PDF report stored: {r2_key}")

    def review_from_abstract(self, title: str, abstract: str) -> AdversarialReviewResult:
        return self._run_analysis(title, abstract, abstract, confidence="abstract_only")

    def _run_analysis(self, title, abstract, full_text, confidence) -> AdversarialReviewResult:
        llm           = LLMClient()
        abstract_trunc = abstract[:MAX_ABSTRACT_CHARS]
        landscape     = self._find_landscape_papers(abstract_trunc)
        missing, missing_by_type = self._find_missing_citations(abstract_trunc, landscape, full_text)
        novelty_ancestors, novelty_assessment = self._assess_novelty(abstract_trunc, landscape)
        natural_comparators = landscape[:5]
        criticisms, strengths = self._generate_criticisms(title, abstract_trunc, missing, novelty_assessment, llm)
        weak_claims  = self._check_citation_claims(full_text, landscape) if confidence == "full_text" else []
        position     = self._describe_position(abstract_trunc, landscape, llm)
        return AdversarialReviewResult(
            paper_title=title or "Untitled",
            paper_abstract=abstract_trunc,
            weak_citation_claims=weak_claims,
            missing_citations=missing,
            missing_by_type=missing_by_type,
            novelty_ancestors=novelty_ancestors,
            novelty_assessment=novelty_assessment,
            intellectual_position=position,
            natural_comparators=natural_comparators,
            reviewer_criticisms=criticisms,
            identified_strengths=strengths,
            confidence=confidence,
        )

    def _find_landscape_papers(self, abstract: str) -> list:
        try:
            import httpx
            resp = httpx.post(
                f"{Config.NLP_WORKER_URL}/encode_batch",
                json={"texts": [abstract], "model": "abstract"},
                headers={"Authorization": f"Bearer {Config.NLP_WORKER_SECRET}"},
                timeout=15.0,
            )
            emb     = resp.json()["embeddings"][0]
            emb_str = "[" + ",".join(str(x) for x in emb) + "]"
            rows    = db.fetchall(
                """
                SELECT p.paper_id, p.title, p.year, p.citation_count,
                       p.fields_of_study, p.abstract,
                       1 - (pe.embedding <=> %s::vector) AS similarity
                FROM paper_embeddings pe
                JOIN papers p ON p.paper_id = pe.paper_id
                WHERE p.abstract IS NOT NULL
                  AND 1 - (pe.embedding <=> %s::vector) > 0.5
                ORDER BY pe.embedding <=> %s::vector
                LIMIT %s
                """,
                (emb_str, emb_str, emb_str, MAX_LANDSCAPE_PAPERS),
            )
            return [dict(r) for r in rows]
        except Exception as exc:
            logger.warning(f"Landscape search failed: {exc}")
            return []

    def _find_missing_citations(self, abstract, landscape, full_text):
        mentioned_ids: set = set()
        for paper in landscape:
            title_words = set((paper.get("title") or "").lower().split())
            if len(title_words & set(abstract.lower().split())) > 3:
                mentioned_ids.add(paper["paper_id"])
        missing = [p for p in landscape if p["paper_id"] not in mentioned_ids and p.get("similarity", 0) > 0.65]
        by_type: dict = {"unknown_concurrent": [], "known_skipped": [], "conspicuous": []}
        for paper in missing:
            sim = paper.get("similarity", 0)
            if sim > 0.80:
                by_type["conspicuous"].append(paper)
            elif sim > 0.70:
                by_type["known_skipped"].append(paper)
            else:
                by_type["unknown_concurrent"].append(paper)
        return missing, by_type

    def _assess_novelty(self, abstract, landscape):
        ancestors = [p for p in landscape if p.get("similarity", 0) > 0.72]
        if not ancestors:
            return [], "clear_contribution"
        if any(p.get("similarity", 0) > 0.85 for p in ancestors):
            return ancestors, "potential_overlap"
        return ancestors, "incremental"

    def _generate_criticisms(self, title, abstract, missing, novelty, llm):
        prompt = (
            f"You are a strict but fair academic reviewer reading: '{title}'.\n\n"
            f"Abstract:\n{abstract}\n\n"
            f"Known missing citations ({len(missing)} found):\n"
            + "\n".join(
                f"- {p.get('title')} ({p.get('year')}) — similarity {p.get('similarity',0):.2f}"
                for p in missing[:5]
            ) + "\n\n"
            f"Novelty assessment: {novelty}\n\n"
            f"Generate 3-5 specific reviewer criticisms in this format:\n"
            f"CRITICISM|severity(major/minor/cosmetic)|text|suggested_response\n\n"
            f"Then generate 2-3 strengths:\n"
            f"STRENGTH|text|evidence\n\nBe specific. Do not be generic."
        )
        try:
            raw = llm.call_llm(prompt, max_tokens=500)
            criticisms, strengths = [], []
            for line in raw.strip().split("\n"):
                parts = line.split("|")
                if parts[0].strip().upper() == "CRITICISM" and len(parts) >= 4:
                    criticisms.append({
                        "severity": parts[1].strip(),
                        "criticism": parts[2].strip(),
                        "suggested_response": parts[3].strip(),
                    })
                elif parts[0].strip().upper() == "STRENGTH" and len(parts) >= 3:
                    strengths.append({"strength": parts[1].strip(), "evidence": parts[2].strip()})
            return criticisms, strengths
        except Exception:
            return [], []

    def _check_citation_claims(self, full_text, landscape):
        import re
        weak = []
        for paper in landscape[:5]:
            title_words = (paper.get("title") or "").split()[:3]
            if not title_words:
                continue
            pattern = re.compile(
                r'[^.!?]*(?:' + re.escape(title_words[0]) + r')[^.!?]*[.!?]', re.IGNORECASE
            )
            for m in pattern.findall(full_text)[:2]:
                weak.append({
                    "claim_text": m.strip()[:200],
                    "cited_paper_id": paper["paper_id"],
                    "issue_description": "Citation used for claim — verify paper supports this.",
                })
        return weak[:5]

    def _describe_position(self, abstract, landscape, llm):
        if not landscape:
            return "Could not determine position — no similar papers found."
        fields = set()
        for p in landscape[:5]:
            for f in (p.get("fields_of_study") or []):
                fields.add(f)
        field_str = ", ".join(list(fields)[:3]) or "unknown field"
        return (
            f"This paper sits at the intersection of {field_str}, "
            f"with {len(landscape)} closely related works in the database. "
            f"Closest neighbor: '{landscape[0].get('title','unknown')}' "
            f"({landscape[0].get('year','?')}, similarity {landscape[0].get('similarity',0):.2f})."
        )

    def _extract_abstract(self, text):
        import re
        match = re.search(
            r'(?:abstract|ABSTRACT)[:\s]*\n*(.*?)(?:\n\n|\n[A-Z])',
            text, re.DOTALL | re.IGNORECASE
        )
        if match:
            return match.group(1).strip()[:MAX_ABSTRACT_CHARS]
        return text[:MAX_ABSTRACT_CHARS]

    def _extract_title(self, text):
        lines = [l.strip() for l in text.split('\n') if l.strip()]
        return lines[0][:200] if lines else "Untitled"

    def _review_abstract_only(self, title, abstract, reason):
        return AdversarialReviewResult(
            paper_title=title, paper_abstract=abstract,
            weak_citation_claims=[], missing_citations=[], missing_by_type={},
            novelty_ancestors=[], novelty_assessment="unknown",
            intellectual_position=f"Analysis incomplete: {reason}",
            natural_comparators=[], reviewer_criticisms=[
                {"severity": "info", "criticism": f"Could not process PDF: {reason}",
                 "suggested_response": "Try pasting your abstract instead."}
            ],
            identified_strengths=[], confidence="failed",
        )
```

### §5.3 — backend/citation_generator.py
*(Identical to v1. Reproduce verbatim from PHASE_7.md v1 §5.3.)*

### §5.4 — backend/citation_audit.py
*(Identical to v1. Reproduce verbatim from PHASE_7.md v1 §5.4.)*

### §5.5 — backend/reading_prioritizer.py
*(Identical to v1. Reproduce verbatim from PHASE_7.md v1 §5.5.)*

### §5.6 — backend/persona_engine.py
*(Identical to v1. Reproduce verbatim from PHASE_7.md v1 §5.6.)*

### §5.7 — backend/insight_engine.py
*(Identical to v1. Reproduce verbatim from PHASE_7.md v1 §5.7.)*

---

### §5.8 — backend/paper_positioning.py (NEW — GAP-P7-6)

```python
"""
backend/paper_positioning.py — PaperPositioningTool (F4.2)

For any paper (by abstract or full text): identify where it sits in the intellectual
landscape, find its natural comparators, suggest the strongest framing, and recommend
appropriate publication venues.

Uses pgvector for landscape search + Groq LLM for framing suggestions.
Does NOT call NLP worker for existing papers (uses stored embeddings).
"""
import logging
from dataclasses import dataclass
from typing import Optional

import backend.db as db
from backend.config import Config
from backend.llm_client import LLMClient

logger = logging.getLogger(__name__)

MAX_COMPARATORS = 8
SIMILARITY_FLOOR = 0.55


@dataclass
class PositioningResult:
    paper_id:          Optional[str]   # None if paper not yet in DB
    paper_title:       str
    intellectual_cluster: str          # e.g. "Transformer efficiency methods"
    comparators:       list            # [{paper_id, title, year, similarity, how_different}]
    strongest_framing: str             # one-sentence positioning statement
    venue_recommendations: list        # [{venue, rationale}]
    positioning_statement: str         # full paragraph for related-work section

    def to_dict(self) -> dict:
        return {
            "paper_id":            self.paper_id,
            "paper_title":         self.paper_title,
            "intellectual_cluster": self.intellectual_cluster,
            "comparators":         self.comparators,
            "strongest_framing":   self.strongest_framing,
            "venue_recommendations": self.venue_recommendations,
            "positioning_statement": self.positioning_statement,
        }


class PaperPositioningTool:
    """Stateless — instantiate fresh per request."""

    def position_by_abstract(self, title: str, abstract: str) -> PositioningResult:
        """Position a paper that may not yet be in the DB."""
        embedding = self._embed_text(abstract)
        comparators = self._find_comparators_by_embedding(embedding) if embedding else []
        return self._build_result(None, title, abstract, comparators)

    def position_by_paper_id(self, paper_id: str, graph_json: dict) -> PositioningResult:
        """Position a paper that is already in the graph."""
        node_by_id = {n["id"]: n for n in graph_json.get("nodes", [])}
        node = node_by_id.get(paper_id, {})
        title    = node.get("title", paper_id)
        abstract = node.get("abstract", "")

        # Use stored embedding
        comparators = self._find_comparators_by_paper_id(paper_id)
        if not comparators and abstract:
            embedding   = self._embed_text(abstract)
            comparators = self._find_comparators_by_embedding(embedding) if embedding else []

        return self._build_result(paper_id, title, abstract, comparators)

    def _embed_text(self, text: str) -> Optional[list]:
        try:
            import httpx
            resp = httpx.post(
                f"{Config.NLP_WORKER_URL}/encode_batch",
                json={"texts": [text[:4000]], "model": "abstract"},
                headers={"Authorization": f"Bearer {Config.NLP_WORKER_SECRET}"},
                timeout=15.0,
            )
            return resp.json()["embeddings"][0]
        except Exception as exc:
            logger.warning(f"Embedding failed: {exc}")
            return None

    def _find_comparators_by_embedding(self, embedding: list) -> list:
        emb_str = "[" + ",".join(str(x) for x in embedding) + "]"
        try:
            rows = db.fetchall(
                """
                SELECT p.paper_id, p.title, p.year, p.citation_count,
                       p.fields_of_study,
                       1 - (pe.embedding <=> %s::vector) AS similarity
                FROM paper_embeddings pe
                JOIN papers p ON p.paper_id = pe.paper_id
                WHERE 1 - (pe.embedding <=> %s::vector) > %s
                ORDER BY pe.embedding <=> %s::vector
                LIMIT %s
                """,
                (emb_str, emb_str, SIMILARITY_FLOOR, emb_str, MAX_COMPARATORS),
            )
            return [dict(r) for r in rows]
        except Exception as exc:
            logger.warning(f"Comparator search failed: {exc}")
            return []

    def _find_comparators_by_paper_id(self, paper_id: str) -> list:
        try:
            rows = db.fetchall(
                """
                SELECT p2.paper_id, p2.title, p2.year, p2.citation_count,
                       p2.fields_of_study,
                       1 - (pe1.embedding <=> pe2.embedding) AS similarity
                FROM paper_embeddings pe1
                JOIN paper_embeddings pe2 ON pe2.paper_id != pe1.paper_id
                JOIN papers p2 ON p2.paper_id = pe2.paper_id
                WHERE pe1.paper_id = %s
                  AND 1 - (pe1.embedding <=> pe2.embedding) > %s
                ORDER BY pe1.embedding <=> pe2.embedding
                LIMIT %s
                """,
                (paper_id, SIMILARITY_FLOOR, MAX_COMPARATORS),
            )
            return [dict(r) for r in rows]
        except Exception as exc:
            logger.warning(f"Paper comparator search failed: {exc}")
            return []

    def _build_result(
        self, paper_id: Optional[str], title: str, abstract: str, comparators: list
    ) -> PositioningResult:
        llm = LLMClient()

        # Identify cluster from top comparators
        cluster = self._identify_cluster(comparators)

        # Add differentiation notes to comparators
        enriched = []
        for c in comparators[:5]:
            enriched.append({
                "paper_id":    c["paper_id"],
                "title":       c.get("title", ""),
                "year":        c.get("year"),
                "similarity":  round(float(c.get("similarity", 0)), 3),
                "how_different": self._differentiate(title, c.get("title", "")),
            })

        # LLM framing
        framing, statement, venues = self._generate_framing(title, abstract, enriched, llm)

        return PositioningResult(
            paper_id=paper_id,
            paper_title=title,
            intellectual_cluster=cluster,
            comparators=enriched,
            strongest_framing=framing,
            venue_recommendations=venues,
            positioning_statement=statement,
        )

    def _identify_cluster(self, comparators: list) -> str:
        if not comparators:
            return "Unknown cluster"
        fields = []
        for c in comparators[:4]:
            fs = c.get("fields_of_study") or []
            fields.extend(fs[:1])
        if fields:
            from collections import Counter
            most_common = Counter(fields).most_common(1)[0][0]
            return most_common
        return "Interdisciplinary"

    def _differentiate(self, title_a: str, title_b: str) -> str:
        """Generate a brief differentiation hint (no LLM — keyword heuristic)."""
        words_a = set(title_a.lower().split())
        words_b = set(title_b.lower().split())
        unique_to_a = words_a - words_b - {"the","a","of","in","for","and","with","on"}
        if unique_to_a:
            return f"This work focuses on: {', '.join(list(unique_to_a)[:3])}"
        return "Closely related — differentiate by scope or method"

    def _generate_framing(self, title, abstract, comparators, llm):
        comp_str = "\n".join(
            f"- {c['title']} ({c.get('year','?')}) — similarity {c['similarity']:.2f}"
            for c in comparators[:4]
        )
        prompt = (
            f"Paper title: '{title}'\n"
            f"Abstract: {abstract[:1500]}\n\n"
            f"Most similar existing work:\n{comp_str}\n\n"
            f"Respond in exactly this format:\n"
            f"FRAMING: [one sentence: what makes this paper distinct from the work above]\n"
            f"STATEMENT: [2-3 sentence related-work positioning paragraph]\n"
            f"VENUE1: [venue name] | [one-sentence rationale]\n"
            f"VENUE2: [venue name] | [one-sentence rationale]\n"
            f"VENUE3: [venue name] | [one-sentence rationale]\n"
        )
        try:
            raw = llm.call_llm(prompt, max_tokens=400)
            import re
            framing   = ""
            statement = ""
            venues    = []
            for line in raw.strip().split("\n"):
                if line.startswith("FRAMING:"):
                    framing = line[8:].strip()
                elif line.startswith("STATEMENT:"):
                    statement = line[10:].strip()
                elif line.startswith("VENUE"):
                    parts = line.split("|")
                    if len(parts) >= 2:
                        vname = re.sub(r'^VENUE\d+:\s*', '', parts[0]).strip()
                        venues.append({"venue": vname, "rationale": parts[1].strip()})
            return framing or title, statement or "Could not generate positioning statement.", venues
        except Exception:
            return title, "Positioning analysis unavailable.", []
```

---

### §5.9 — backend/rewrite_suggester.py (NEW — GAP-P7-7)

```python
"""
backend/rewrite_suggester.py — RewriteSuggester (F4.3)

Takes an existing related-work section (as text) and suggests a rewrite that
frames it as an intellectual narrative — tracing idea evolution rather than
listing papers chronologically.

Input: related_work_text (str), seed_paper_id (str, optional)
Output: RewriteResult with original_critique + suggested_rewrite + principles

Does NOT store the user's text. Stateless per-call.
Architecture constraint: uses Groq LLM only — no NLP worker call.
"""
import logging
from dataclasses import dataclass

from backend.llm_client import LLMClient

logger = logging.getLogger(__name__)

MAX_INPUT_CHARS = 6000


@dataclass
class RewriteResult:
    original_critique: str      # What's weak about the original structure
    suggested_rewrite: str      # The rewritten version
    narrative_arc:     str      # One sentence describing the intellectual story
    principles_applied: list    # [{principle, explanation}] — educational

    def to_dict(self) -> dict:
        return {
            "original_critique":  self.original_critique,
            "suggested_rewrite":  self.suggested_rewrite,
            "narrative_arc":      self.narrative_arc,
            "principles_applied": self.principles_applied,
        }


REWRITE_PRINCIPLES = [
    "Chronological listing → problem-driven narrative",
    "Paper citations as evidence, not as the subject",
    "Explicit statement of intellectual debt",
    "Identification of the contested gap this paper fills",
    "Forward-looking bridge to the paper's contribution",
]


class RewriteSuggester:
    """Stateless — instantiate fresh per request."""

    def suggest(self, related_work_text: str, paper_title: str = "") -> RewriteResult:
        if not related_work_text or not related_work_text.strip():
            return RewriteResult(
                original_critique="No text provided.",
                suggested_rewrite="",
                narrative_arc="",
                principles_applied=[],
            )

        truncated = related_work_text[:MAX_INPUT_CHARS]
        llm       = LLMClient()

        critique, rewrite, arc, principles = self._call_llm(
            truncated, paper_title, llm
        )
        return RewriteResult(
            original_critique=critique,
            suggested_rewrite=rewrite,
            narrative_arc=arc,
            principles_applied=principles,
        )

    def _call_llm(self, text, title, llm):
        prompt = (
            f"You are an expert academic writing coach.\n\n"
            f"Paper being written: '{title or 'Unknown'}'\n\n"
            f"EXISTING RELATED WORK SECTION:\n{text}\n\n"
            f"---\n"
            f"This related-work section likely lists papers chronologically without building "
            f"an intellectual narrative. Rewrite it to:\n"
            f"1. Open with the intellectual problem this research addresses\n"
            f"2. Trace how the field has evolved toward (but not solved) this problem\n"
            f"3. Identify the specific gap that this paper fills\n"
            f"4. Use citations as evidence for claims, not as the main subject\n\n"
            f"Respond in exactly this format:\n"
            f"CRITIQUE: [2-3 sentences describing what's weak about the original structure]\n"
            f"ARC: [one sentence describing the intellectual story arc of the rewrite]\n"
            f"REWRITE:\n[The full rewritten related-work section — preserve all citations]\n"
            f"PRINCIPLE1: [name] | [one sentence explanation of how it was applied]\n"
            f"PRINCIPLE2: [name] | [one sentence explanation]\n"
            f"PRINCIPLE3: [name] | [one sentence explanation]\n"
        )
        try:
            raw = llm.call_llm(prompt, max_tokens=1200)
            critique  = ""
            arc       = ""
            rewrite   = ""
            principles = []
            in_rewrite = False

            for line in raw.split("\n"):
                if line.startswith("CRITIQUE:"):
                    critique   = line[9:].strip()
                    in_rewrite = False
                elif line.startswith("ARC:"):
                    arc        = line[4:].strip()
                    in_rewrite = False
                elif line.startswith("REWRITE:"):
                    in_rewrite = True
                    rewrite    = line[8:].strip()
                elif line.startswith("PRINCIPLE"):
                    in_rewrite = False
                    parts = line.split("|")
                    if len(parts) >= 2:
                        name = parts[0].split(":", 1)[-1].strip()
                        principles.append({"principle": name, "explanation": parts[1].strip()})
                elif in_rewrite:
                    rewrite += "\n" + line

            return (
                critique or "The original uses a listing structure without intellectual narrative.",
                rewrite.strip() or text,
                arc or "Traces the field's evolution toward the paper's contribution.",
                principles or [{"principle": p, "explanation": "Applied implicitly."} for p in REWRITE_PRINCIPLES[:3]],
            )
        except Exception as exc:
            logger.warning(f"RewriteSuggester LLM call failed: {exc}")
            return (
                "Could not critique — LLM unavailable.",
                text,
                "Original preserved — LLM unavailable.",
                [],
            )
```

---

## §6 — Shareable Graph Links & Lab Manager

### §6.1 — backend/lab_manager.py

```python
"""
backend/lab_manager.py — LabManager

FIX (GAP-P7-N7): create_share_link() falls back to user_id graph lookup for multi-device.
"""
import json
import logging
import secrets
from datetime import datetime, timezone

import backend.db as db
from backend.config import Config

logger = logging.getLogger(__name__)


class LabManager:

    # ── Lab Member Management ──────────────────────────────────────────────────

    def invite_member(self, lab_user_id: str, invitee_email: str, role: str = "member") -> str:
        token = secrets.token_hex(32)
        db.execute(
            """
            INSERT INTO lab_invites (lab_user_id, invite_token, invitee_email, role)
            VALUES (%s::uuid, %s, %s, %s)
            """,
            (lab_user_id, token, invitee_email.lower().strip(), role),
        )
        return token

    def accept_invite(self, token: str, accepting_user_id: str) -> bool:
        row = db.fetchone(
            "SELECT invite_id, lab_user_id, invitee_email, role, expires_at, accepted_at "
            "FROM lab_invites WHERE invite_token = %s",
            (token,),
        )
        if not row or row.get("accepted_at"):
            return False
        if datetime.now(timezone.utc) > row["expires_at"]:
            return False

        user = db.fetchone("SELECT email FROM users WHERE user_id = %s::uuid", (accepting_user_id,))
        if not user or user["email"] != row["invitee_email"]:
            logger.warning(f"Email mismatch on lab invite: {accepting_user_id}")
            return False

        db.execute(
            """
            INSERT INTO lab_memberships (lab_user_id, member_user_id, role)
            VALUES (%s::uuid, %s::uuid, %s)
            ON CONFLICT (lab_user_id, member_user_id) DO NOTHING
            """,
            (str(row["lab_user_id"]), accepting_user_id, row["role"]),
        )
        db.execute(
            "UPDATE lab_invites SET accepted_at = NOW() WHERE invite_token = %s", (token,)
        )
        return True

    def get_lab_members(self, lab_user_id: str) -> list:
        rows = db.fetchall(
            """
            SELECT u.user_id::text, u.email, u.display_name, u.institution,
                   lm.role, lm.joined_at
            FROM lab_memberships lm
            JOIN users u ON u.user_id = lm.member_user_id
            WHERE lm.lab_user_id = %s::uuid
            ORDER BY lm.joined_at
            """,
            (lab_user_id,),
        )
        return [dict(r) for r in rows]

    def remove_member(self, lab_user_id: str, member_user_id: str) -> bool:
        n = db.execute(
            "DELETE FROM lab_memberships WHERE lab_user_id = %s::uuid AND member_user_id = %s::uuid",
            (lab_user_id, member_user_id),
        )
        return n > 0

    # ── Shareable Graph Links (F6.3) ──────────────────────────────────────────

    def create_share_link(
        self,
        graph_id: str,
        user_id: str,
        seed_paper_id: str = "",
        seed_title: str = "",
        view_mode: str = "force",
        view_state: dict = None,
        expires_days: int = None,
    ) -> str:
        token      = secrets.token_urlsafe(24)
        expires_at = None
        if expires_days:
            from datetime import timedelta
            expires_at = datetime.now(timezone.utc) + timedelta(days=expires_days)

        db.execute(
            """
            INSERT INTO shared_graphs
              (share_token, graph_id, user_id, seed_paper_id, seed_title,
               view_mode, view_state, expires_at)
            VALUES (%s, %s, %s::uuid, %s, %s, %s, %s::jsonb, %s)
            """,
            (token, graph_id, user_id, seed_paper_id, seed_title,
             view_mode, json.dumps(view_state or {}), expires_at),
        )
        db.execute(
            "UPDATE graphs SET shared_count = shared_count + 1 WHERE graph_id = %s",
            (graph_id,),
        )
        return token

    def get_share(self, token: str) -> dict | None:
        row = db.fetchone(
            """
            SELECT share_token, graph_id, user_id::text, seed_paper_id, seed_title,
                   view_mode, view_state, created_at, expires_at, view_count
            FROM shared_graphs
            WHERE share_token = %s
              AND (expires_at IS NULL OR expires_at > NOW())
            """,
            (token,),
        )
        if not row:
            return None
        db.execute(
            "UPDATE shared_graphs SET view_count = view_count + 1, last_viewed_at = NOW() "
            "WHERE share_token = %s",
            (token,),
        )
        return dict(row)

    def list_shares(self, user_id: str) -> list:
        rows = db.fetchall(
            "SELECT share_token, seed_title, view_mode, created_at, expires_at, view_count "
            "FROM shared_graphs WHERE user_id = %s::uuid ORDER BY created_at DESC LIMIT 50",
            (user_id,),
        )
        return [dict(r) for r in rows]

    def delete_share(self, token: str, user_id: str) -> bool:
        n = db.execute(
            "DELETE FROM shared_graphs WHERE share_token = %s AND user_id = %s::uuid",
            (token, user_id),
        )
        return n > 0
```

---

## §7 — Public REST API (F9.1 + F9.2)

### §7.1 — backend/public_api.py
*(Identical to v1 except: fix `__import__('secrets')` inline pattern. Reproduce v1 §7.1 verbatim but replace `__import__('secrets').token_hex(16)` with `import secrets` at the top of the file and use `secrets.token_hex(16)` inline.)*

Key corrections to make when reproducing:
```python
# At top of file, add:
import json
import hashlib
import logging
import secrets
# Replace all __import__('secrets') occurrences with secrets.token_hex(...)
```

### §7.2 — backend/webhook_manager.py
*(Identical to v1. The per-subscription `secret` field is already used for HMAC signing. The global `WEBHOOK_SIGNING_SECRET` is used as default when a subscriber provides no secret — add this to `v1_create_subscription()`:)*

```python
# In v1_create_subscription(), update the secret line:
secret = data.get("secret", "") or Config.WEBHOOK_SIGNING_SECRET or secrets.token_hex(16)
```

---

## §8 — Email Change Flow

*(Identical to v1. Reproduce §8 verbatim from PHASE_7.md v1.)*

---

## §9 — app.py Phase 7 Route Additions

### §9.1 — Register Blueprints and Imports

```python
import json

from backend.public_api import api_v1
from backend.time_machine import TimeMachineEngine
from backend.counterfactual_engine import CounterfactualEngine
from backend.adversarial_reviewer import AdversarialReviewer
from backend.citation_audit import CitationAudit
from backend.citation_generator import CitationGenerator
from backend.reading_prioritizer import ReadingPrioritizer
from backend.paper_positioning import PaperPositioningTool
from backend.rewrite_suggester import RewriteSuggester
from backend.persona_engine import PersonaEngine
from backend.insight_engine import InsightEngine
from backend.lab_manager import LabManager
from backend.secure_upload import SecureFileUploadHandler
from backend.webhook_manager import WebhookManager

# Register blueprint inside create_app():
app.register_blueprint(api_v1)
```

### §9.2 — Time Machine Routes

```python
@app.route("/api/time-machine/<seed_paper_id>")
@require_auth
@require_tier("researcher")
def api_time_machine(seed_paper_id: str):
    """
    Build the temporal dataset for the Time Machine.
    FIX (GAP-P7-N13): The route tries to load the graph for seed_paper_id specifically.
    Falls back to session's latest graph if no graph found for that specific paper.
    """
    session_id = session_manager.get_session_id(request)
    allowed, headers = rate_limiter.check_sync(
        session_id or g.user_id, "GET /api/time-machine"
    )
    if not allowed:
        return jsonify(rate_limiter.get_429_response(headers)), 429, headers

    # Try to load graph for the specific seed paper first
    graph_data = None
    if seed_paper_id and seed_paper_id != "current":
        from backend.r2_client import R2Client
        row = db.fetchone(
            "SELECT graph_json_url FROM graphs WHERE seed_paper_id = %s "
            "AND user_id = %s::uuid ORDER BY created_at DESC LIMIT 1",
            (seed_paper_id, g.user_id),
        )
        if row:
            try:
                graph_data = R2Client().download_json(row["graph_json_url"])
            except Exception:
                graph_data = None

    # Fallback: session's latest graph
    if not graph_data:
        try:
            graph_data = _get_latest_graph_json(session_id, g.user_id)
        except RuntimeError:
            return jsonify({"error": "Could not load graph"}), 500

    if not graph_data:
        return jsonify({"error": "No graph built yet."}), 404

    engine = TimeMachineEngine()
    result = engine.build_timeline(graph_data)
    return jsonify(result)


@app.route("/api/counterfactual/<paper_id>")
@require_auth
@require_tier("researcher")
def api_counterfactual(paper_id: str):
    session_id = session_manager.get_session_id(request)
    allowed, headers = rate_limiter.check_sync(
        session_id or g.user_id, "GET /api/counterfactual"
    )
    if not allowed:
        return jsonify(rate_limiter.get_429_response(headers)), 429, headers

    try:
        graph_data = _get_latest_graph_json(session_id, g.user_id)
    except RuntimeError:
        return jsonify({"error": "Could not load graph"}), 500
    if not graph_data:
        return jsonify({"error": "No graph built yet."}), 404

    graph_id = graph_data.get("metadata", {}).get("graph_id", "")
    cached   = db.fetchone(
        "SELECT result_json FROM counterfactual_cache WHERE graph_id = %s AND paper_id = %s "
        "AND computed_at > NOW() - INTERVAL '7 days'",
        (graph_id, paper_id),
    )
    if cached:
        return jsonify(cached["result_json"])

    from backend.counterfactual_engine import CounterfactualEngine
    engine      = CounterfactualEngine()
    result      = engine.analyze(graph_data, paper_id)
    result_dict = result.to_dict()

    if graph_id:
        db.execute(
            """
            INSERT INTO counterfactual_cache (graph_id, paper_id, result_json)
            VALUES (%s, %s, %s::jsonb)
            ON CONFLICT (graph_id, paper_id) DO UPDATE
            SET result_json=EXCLUDED.result_json, computed_at=NOW()
            """,
            (graph_id, paper_id, json.dumps(result_dict)),
        )
    return jsonify(result_dict)
```

### §9.3 — Graph Public Access Route (NEW — GAP-P7-2 + GAP-P7-N8)

```python
@app.route("/api/graph/<graph_id>")
def api_graph_by_id(graph_id: str):
    """
    Public graph retrieval by internal graph_id.
    Used by shared_graph.html — no auth required.
    SECURITY (GAP-P7-N8): Only serves graphs that have a valid active shared_graphs entry
    OR are owned by the authenticated user. Prevents unauthorized enumeration.
    """
    from backend.r2_client import R2Client

    # Allow if caller is the owner
    user_id = getattr(g, "user_id", None)
    if user_id:
        row = db.fetchone(
            "SELECT graph_json_url FROM graphs WHERE graph_id = %s AND user_id = %s::uuid",
            (graph_id, user_id),
        )
        if row:
            try:
                return jsonify(R2Client().download_json(row["graph_json_url"]))
            except Exception:
                return jsonify({"error": "Could not load graph data"}), 500

    # Allow if a valid non-expired share link exists for this graph
    share = db.fetchone(
        "SELECT graph_id FROM shared_graphs WHERE graph_id = %s "
        "AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1",
        (graph_id,),
    )
    if share:
        row = db.fetchone(
            "SELECT graph_json_url FROM graphs WHERE graph_id = %s", (graph_id,)
        )
        if row:
            try:
                return jsonify(R2Client().download_json(row["graph_json_url"]))
            except Exception:
                return jsonify({"error": "Could not load graph data"}), 500

    return jsonify({"error": "Graph not found or not publicly shared"}), 404
```

### §9.4 — Adversarial Reviewer Routes

```python
@app.route("/api/adversarial-review", methods=["POST"])
@require_auth
@require_tier("developer")
def api_adversarial_review():
    reviewer = AdversarialReviewer()
    handler  = SecureFileUploadHandler()

    if request.content_type and "multipart" in request.content_type:
        file = request.files.get("pdf")
        if not file:
            return jsonify({"error": "No PDF file uploaded", "code": "missing_file"}), 400

        pdf_bytes = file.read()
        valid, err, file_hash = handler.validate_and_hash(pdf_bytes, file.filename or "upload.pdf")
        if not valid:
            return jsonify({"error": err, "code": "invalid_file"}), 400

        count = db.fetchone(
            "SELECT COUNT(*) AS cnt FROM adversarial_reviews "
            "WHERE user_id = %s::uuid AND created_at > NOW() - INTERVAL '30 days'",
            (g.user_id,),
        )["cnt"]
        if count >= 10:
            return jsonify({"error": "Monthly review limit reached (10/month)", "code": "limit_reached"}), 429

        existing = db.fetchone(
            "SELECT review_id::text, result_json FROM adversarial_reviews "
            "WHERE file_hash = %s AND user_id = %s::uuid AND status = 'done'",
            (file_hash, g.user_id),
        )
        if existing and existing.get("result_json"):
            return jsonify({"review_id": existing["review_id"], "cached": True,
                            "result": existing["result_json"]})

        row = db.execute_returning(
            "INSERT INTO adversarial_reviews (user_id, file_hash, file_name, status) "
            "VALUES (%s::uuid, %s, %s, 'processing') RETURNING review_id::text",
            (g.user_id, file_hash, (file.filename or "upload.pdf")[:200]),
        )
        review_id = row["review_id"]

        try:
            # Pass review_id so PDF report can be stored (GAP-P7-N11 fix)
            result      = reviewer.review_from_pdf(pdf_bytes, file.filename or "upload.pdf",
                                                    g.user_id, review_id=review_id)
            result_json = json.dumps(result.to_dict())
            db.execute(
                "UPDATE adversarial_reviews SET status='done', result_json=%s::jsonb, "
                "completed_at=NOW() WHERE review_id=%s::uuid",
                (result_json, review_id),
            )
            return jsonify({"review_id": review_id, "result": result.to_dict()})
        except Exception as exc:
            db.execute(
                "UPDATE adversarial_reviews SET status='failed' WHERE review_id=%s::uuid",
                (review_id,),
            )
            app.logger.error(f"Adversarial review failed: {exc}")
            return jsonify({"error": "Review processing failed", "code": "processing_error"}), 500
    else:
        data     = request.get_json(silent=True) or {}
        title    = data.get("title", "")
        abstract = data.get("abstract", "")
        if not abstract:
            return jsonify({"error": "abstract required", "code": "missing_param"}), 400
        result = reviewer.review_from_abstract(title, abstract)
        return jsonify(result.to_dict())
```

### §9.5 — Workflow Routes

```python
# ── GET /api/citation-audit/<paper_id> ───────────────────────────────────────
@app.route("/api/citation-audit/<paper_id>")
@require_auth
@require_tier("researcher")
def api_citation_audit(paper_id: str):
    session_id = session_manager.get_session_id(request)
    try:
        graph_data = _get_latest_graph_json(session_id, g.user_id)
    except RuntimeError:
        return jsonify({"error": "Could not load graph"}), 500
    if not graph_data:
        return jsonify({"error": "No graph built yet."}), 404
    return jsonify(CitationAudit().audit(graph_data, paper_id))


# ── POST /api/citation-generator ─────────────────────────────────────────────
@app.route("/api/citation-generator", methods=["POST"])
@require_auth
def api_citation_generator():
    data       = request.get_json(silent=True) or {}
    paper_ids  = data.get("paper_ids", [])
    style      = data.get("style", "apa")
    all_styles = data.get("all_styles", False)
    if not paper_ids:
        return jsonify({"error": "paper_ids required"}), 400
    if len(paper_ids) > 50:
        return jsonify({"error": "Maximum 50 papers per batch"}), 400
    rows   = db.fetchall(
        "SELECT paper_id, title, year, authors, doi, journal_name, volume, pages, url "
        "FROM papers WHERE paper_id = ANY(%s)", (paper_ids,)
    )
    papers = [dict(r) for r in rows]
    gen    = CitationGenerator()
    if all_styles:
        result = {p["paper_id"]: gen.generate_all_styles(p) for p in papers}
    else:
        result = {p["paper_id"]: gen.generate(p, style) for p in papers}
    return jsonify({"citations": result, "style": style if not all_styles else "all"})


# ── POST /api/reading-prioritizer ────────────────────────────────────────────
@app.route("/api/reading-prioritizer", methods=["POST"])
@require_auth
@require_tier("researcher")
def api_reading_prioritizer():
    data              = request.get_json(silent=True) or {}
    paper_ids         = data.get("paper_ids", [])
    already_read      = data.get("already_read", [])
    research_question = data.get("research_question", "")
    if not paper_ids:
        return jsonify({"error": "paper_ids required"}), 400
    if len(paper_ids) > 100:
        return jsonify({"error": "Maximum 100 papers per request"}), 400
    result = ReadingPrioritizer().prioritize(paper_ids, already_read, research_question)
    return jsonify({"ranked": result, "total": len(result)})


# ── POST /api/paper-positioning ──────────────────────────────────────────────
@app.route("/api/paper-positioning", methods=["POST"])
@require_auth
@require_tier("researcher")
def api_paper_positioning():
    """
    Position a paper in the intellectual landscape.
    Body: {"paper_id": "..."} OR {"title": "...", "abstract": "..."}
    """
    data      = request.get_json(silent=True) or {}
    paper_id  = data.get("paper_id", "")
    title     = data.get("title", "")
    abstract  = data.get("abstract", "")
    tool      = PaperPositioningTool()

    if paper_id:
        session_id = session_manager.get_session_id(request)
        try:
            graph_data = _get_latest_graph_json(session_id, g.user_id)
        except RuntimeError:
            return jsonify({"error": "Could not load graph"}), 500
        result = tool.position_by_paper_id(paper_id, graph_data or {"nodes": [], "edges": []})
    elif abstract:
        result = tool.position_by_abstract(title, abstract)
    else:
        return jsonify({"error": "paper_id or abstract required"}), 400

    return jsonify(result.to_dict())


# ── POST /api/rewrite-suggester ───────────────────────────────────────────────
@app.route("/api/rewrite-suggester", methods=["POST"])
@require_auth
@require_tier("researcher")
def api_rewrite_suggester():
    """
    Suggest a rewrite for a related-work section.
    Body: {"related_work_text": "...", "paper_title": "..."}
    """
    data             = request.get_json(silent=True) or {}
    related_work     = data.get("related_work_text", "")
    paper_title      = data.get("paper_title", "")
    if not related_work or not related_work.strip():
        return jsonify({"error": "related_work_text required"}), 400
    if len(related_work) > 10000:
        return jsonify({"error": "Text too long — maximum 10,000 characters"}), 400
    result = RewriteSuggester().suggest(related_work, paper_title)
    return jsonify(result.to_dict())


# ── POST /api/persona ─────────────────────────────────────────────────────────
@app.route("/api/persona", methods=["POST"])
@require_auth
def api_set_persona():
    data = request.get_json(silent=True) or {}
    mode = data.get("mode", "explorer")
    if mode not in ("explorer", "critic", "innovator", "historian"):
        return jsonify({"error": "Invalid mode"}), 400
    session_id = session_manager.get_session_id(request)
    if session_id:
        db.execute(
            "UPDATE sessions SET persona_mode = %s WHERE session_id = %s", (mode, session_id)
        )
    if hasattr(g, "user_id"):
        db.execute(
            "UPDATE users SET default_persona = %s WHERE user_id = %s::uuid", (mode, g.user_id)
        )
    return jsonify({"mode": mode, "config": PersonaEngine().get_config(mode).to_dict()})


@app.route("/api/persona")
def api_get_persona():
    session_id = session_manager.get_session_id(request)
    mode       = "explorer"
    if session_id:
        row = db.fetchone("SELECT persona_mode FROM sessions WHERE session_id = %s", (session_id,))
        if row:
            mode = row.get("persona_mode") or "explorer"
    return jsonify(PersonaEngine().get_config(mode).to_dict())


# ── GET /api/insights/<seed_paper_id> ────────────────────────────────────────
@app.route("/api/insights/<seed_paper_id>")
@require_session
def api_insights(seed_paper_id: str):
    session_id = g.session_id
    try:
        from backend.r2_client import R2Client
        row = db.fetchone(
            "SELECT g.graph_json_url FROM graphs g "
            "JOIN session_graphs sg ON sg.graph_id = g.graph_id "
            "WHERE sg.session_id = %s ORDER BY g.created_at DESC LIMIT 1",
            (session_id,),
        )
        if not row:
            return jsonify({"insights": []})
        graph_data = R2Client().download_json(row["graph_json_url"])
    except Exception:
        return jsonify({"insights": []})

    insights = InsightEngine().generate(graph_data)
    row_s    = db.fetchone("SELECT persona_mode FROM sessions WHERE session_id = %s", (session_id,))
    mode     = (row_s.get("persona_mode") or "explorer") if row_s else "explorer"
    insights = PersonaEngine().filter_insights_for_mode(insights, mode)
    return jsonify({"insights": insights, "persona_mode": mode})


# ── GET /api/action-log/<seed_paper_id>/export (NEW — GAP-P7-N3) ────────────
@app.route("/api/action-log/<seed_paper_id>/export")
@require_auth
def api_export_research_journal(seed_paper_id: str):
    """
    Export the user's action log as a PDF research journal.
    Retrieves all action_log entries for this session + seed paper
    and generates a structured PDF via ExportGenerator.
    """
    session_id = session_manager.get_session_id(request)
    rows       = db.fetchall(
        "SELECT action_type, action_data, timestamp FROM action_log "
        "WHERE session_id = %s ORDER BY timestamp ASC",
        (session_id,),
    )
    if not rows:
        return jsonify({"error": "No action log entries found for this session"}), 404

    paper = db.fetchone("SELECT title FROM papers WHERE paper_id = %s", (seed_paper_id,))
    title = (paper.get("title") if paper else None) or "Research Session"

    from backend.export_generator import ExportGenerator
    export_data = {
        "type":    "research_journal",
        "title":   f"Research Journal: {title}",
        "entries": [
            {
                "timestamp": str(r["timestamp"]),
                "action":    r["action_type"],
                "detail":    (r["action_data"] or {}).get("description", ""),
            }
            for r in rows
        ],
    }
    generator = ExportGenerator()
    pdf_bytes = generator.generate_pdf(export_data)
    from flask import Response
    return Response(
        pdf_bytes,
        mimetype="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="arivu-journal-{seed_paper_id[:8]}.pdf"'
        },
    )


# ── Shareable Graph Links ─────────────────────────────────────────────────────

@app.route("/api/share", methods=["POST"])
@require_auth
@require_tier("developer")
def api_create_share():
    """
    Create a shareable link. Developer+ tier.
    FIX (GAP-P7-N7): falls back to user's most recent graph if session has none.
    """
    data       = request.get_json(silent=True) or {}
    view_mode  = data.get("view_mode", "force")
    view_state = data.get("view_state", {})

    session_id = session_manager.get_session_id(request)

    # Try session graph first
    row = None
    if session_id:
        row = db.fetchone(
            """
            SELECT g.graph_id, g.seed_paper_id, p.title
            FROM graphs g
            JOIN session_graphs sg ON sg.graph_id = g.graph_id
            LEFT JOIN papers p ON p.paper_id = g.seed_paper_id
            WHERE sg.session_id = %s ORDER BY g.created_at DESC LIMIT 1
            """,
            (session_id,),
        )

    # Multi-device fallback: user's most recent graph (GAP-P7-N7 fix)
    if not row:
        row = db.fetchone(
            """
            SELECT g.graph_id, g.seed_paper_id, p.title
            FROM graphs g
            LEFT JOIN papers p ON p.paper_id = g.seed_paper_id
            WHERE g.user_id = %s::uuid
            ORDER BY g.created_at DESC LIMIT 1
            """,
            (g.user_id,),
        )

    if not row:
        return jsonify({"error": "No graph to share. Build a graph first."}), 404

    manager   = LabManager()
    token     = manager.create_share_link(
        graph_id=str(row["graph_id"]),
        user_id=g.user_id,
        seed_paper_id=str(row["seed_paper_id"] or ""),
        seed_title=str(row["title"] or ""),
        view_mode=view_mode,
        view_state=view_state,
    )
    return jsonify({"token": token, "url": f"https://{Config.CUSTOM_DOMAIN}/share/{token}"})


@app.route("/share/<token>")
def view_shared_graph(token: str):
    share = LabManager().get_share(token)
    if not share:
        return render_template("404.html"), 404
    return render_template("shared_graph.html", share=share,
                           share_url=f"https://{Config.CUSTOM_DOMAIN}/share/{token}")


@app.route("/api/shares")
@require_auth
def api_list_shares():
    return jsonify({"shares": LabManager().list_shares(g.user_id)})


@app.route("/api/shares/<token>", methods=["DELETE"])
@require_auth
def api_delete_share(token: str):
    return jsonify({"success": LabManager().delete_share(token, g.user_id)})


# ── Lab Member Management ─────────────────────────────────────────────────────

@app.route("/api/lab/members", methods=["GET"])
@require_auth
@require_tier("lab")
def api_lab_members():
    return jsonify({"members": LabManager().get_lab_members(g.user_id)})


@app.route("/api/lab/invite", methods=["POST"])
@require_auth
@require_tier("lab")
def api_lab_invite():
    data  = request.get_json(silent=True) or {}
    email = (data.get("email") or "").lower().strip()
    role  = data.get("role", "member")
    if not email:
        return jsonify({"error": "email required"}), 400
    if role not in ("owner", "member"):
        return jsonify({"error": "role must be owner or member"}), 400

    manager   = LabManager()
    token     = manager.invite_member(g.user_id, email, role)

    # FIX (GAP-P7-4): Use DB lookup instead of undefined g.user
    lab_user  = db.fetchone(
        "SELECT display_name FROM users WHERE user_id = %s::uuid", (g.user_id,)
    )
    lab_name  = (lab_user.get("display_name") if lab_user else None) or "Your lab"

    from backend.mailer import send_lab_invite_email
    send_lab_invite_email(
        email, lab_name,
        f"https://{Config.CUSTOM_DOMAIN}/lab/accept?token={token}"
    )
    return jsonify({"success": True, "message": f"Invite sent to {email}."})


@app.route("/lab/accept")
def lab_accept_invite():
    token = request.args.get("token", "")
    if not token:
        return redirect("/login")
    return redirect(f"/login?invite={token}")


@app.route("/api/lab/accept", methods=["POST"])
@require_auth
def api_lab_accept_invite():
    data  = request.get_json(silent=True) or {}
    token = data.get("token", "")
    if not token:
        return jsonify({"error": "token required"}), 400
    success = LabManager().accept_invite(token, g.user_id)
    return jsonify({"success": success,
                    "message": "Lab access granted." if success else "Invalid or expired invite."})


@app.route("/api/lab/members/<member_id>", methods=["DELETE"])
@require_auth
@require_tier("lab")
def api_lab_remove_member(member_id: str):
    return jsonify({"success": LabManager().remove_member(g.user_id, member_id)})


# ── Supervisor Dashboard ──────────────────────────────────────────────────────
@app.route("/supervisor")
@require_auth
@require_tier("lab")
def supervisor_dashboard():
    """Supervisor Dashboard — Lab tier only."""
    members = LabManager().get_lab_members(g.user_id)
    return render_template("supervisor.html", members=members)


# ── API Docs ──────────────────────────────────────────────────────────────────
@app.route("/api-docs")
def api_docs():
    """Public API documentation page."""
    return render_template("api_docs.html")


# ── Guided Discovery Flow (F5.3, NEW — GAP-P7-N2) ───────────────────────────
@app.route("/api/guided-discovery", methods=["POST"])
@require_session
def api_guided_discovery():
    """
    Process onboarding answers and return a prioritized feature pathway.
    Body: {"relationship": "...", "context": "..."}
    Stores guidance in session; returns feature pathway list.
    """
    data         = request.get_json(silent=True) or {}
    relationship = data.get("relationship", "")   # "new_field"|"writing"|"reviewing"|"curious"
    context      = data.get("context", "")         # sub-answer

    pathway = _build_discovery_pathway(relationship, context)
    session_id = g.session_id
    db.execute(
        "UPDATE sessions SET persona_mode = %s WHERE session_id = %s",
        (pathway["suggested_persona"], session_id),
    )
    return jsonify(pathway)


def _build_discovery_pathway(relationship: str, context: str) -> dict:
    PATHWAYS = {
        "new_field": {
            "suggested_persona": "explorer",
            "primary_feature":   {"label": "Intellectual Genealogy Story", "route": "/api/genealogy"},
            "secondary_feature": {"label": "Research DNA Profile", "route": "/api/dna"},
            "tertiary_feature":  {"label": "Reading Prioritizer", "route": "/api/reading-prioritizer"},
            "guide_message":     "Let me show you how this field evolved. Start with the genealogy story.",
        },
        "writing": {
            "suggested_persona": "innovator",
            "primary_feature":   {"label": "Research DNA Profile", "route": "/api/dna"},
            "secondary_feature": {"label": "Citation Audit", "route": "/api/citation-audit"},
            "tertiary_feature":  {"label": "Paper Positioning", "route": "/api/paper-positioning"},
            "guide_message":     "I'll help you position your contribution. Start with the DNA profile of your seed paper.",
        },
        "reviewing": {
            "suggested_persona": "critic",
            "primary_feature":   {"label": "Originality Mapper", "route": "/api/originality"},
            "secondary_feature": {"label": "Citation Audit", "route": "/api/citation-audit"},
            "tertiary_feature":  {"label": "Adversarial Reviewer", "route": "/api/adversarial-review"},
            "guide_message":     "I'll surface what reviewers look for. Start with originality mapping.",
        },
        "curious": {
            "suggested_persona": "historian",
            "primary_feature":   {"label": "Interactive Pruning", "route": "/api/prune"},
            "secondary_feature": {"label": "Time Machine", "route": "/api/time-machine"},
            "tertiary_feature":  {"label": "Extinction Events", "route": "/api/time-machine"},
            "guide_message":     "Start by removing a foundational paper and watching the field collapse.",
        },
    }
    return PATHWAYS.get(relationship, PATHWAYS["curious"])
```

---

## §10 — Rate Limiter Phase 7 Additions

Add to `ArivuRateLimiter.LIMITS` in `backend/rate_limiter.py`:

```python
'GET /api/time-machine':           (3,  60, 1),
'GET /api/counterfactual':         (5,  60, 1),
'POST /api/adversarial-review':    (3,  3600, 1),
'GET /api/citation-audit':         (10, 60, 1),
'POST /api/citation-generator':    (30, 60, 1),
'POST /api/reading-prioritizer':   (5,  60, 1),
'POST /api/paper-positioning':     (10, 60, 1),
'POST /api/rewrite-suggester':     (5,  60, 1),
'POST /api/share':                 (10, 3600, 1),
'POST /api/lab/invite':            (5,  3600, 1),
'GET /api/insights':               (30, 60, 1),
'POST /api/persona':               (20, 60, 1),
'POST /api/guided-discovery':      (20, 60, 1),
# Public API rate limits — key format is "API <endpoint_template>" (literal string).
# The api_rate_limit() decorator builds: f"API {endpoint_name}" where endpoint_name
# is the string passed to @api_rate_limit(). These are matched exactly.
# (GAP-P7-17): Confirm ArivuRateLimiter.check_sync() uses exact-key lookup.
# The endpoint_name strings below MUST match what is passed to @api_rate_limit().
'API GET /papers/{id}/graph':      (100, 3600, 1),
'API GET /papers/{id}/dna':        (200, 3600, 1),
'API GET /papers/{id}/score':      (200, 3600, 1),
'API POST /papers/{id}/prune':     (50,  3600, 1),
'API GET /papers/{id}/gaps':       (100, 3600, 1),
'API GET /papers/{id}/mutations':  (100, 3600, 1),
'API GET /papers/search':          (200, 3600, 1),
'API GET /fields/{name}/fingerprint': (50, 3600, 1),
'API POST /v1/subscriptions':      (20,  3600, 1),
```

**Important — rate limiter key format (GAP-P7-17):**
The `api_rate_limit()` decorator in `public_api.py` calls:
```python
arivu_rate_limiter.check_sync(key_id, f"API {endpoint_name}")
```
The `endpoint_name` parameter passed to `@api_rate_limit("GET /papers/{id}/graph")` is a literal template string — it is NOT the real path. The rate limiter must use exact-string key lookup (which it does by default). This is intentional: all requests to `GET /papers/*/graph` share one rate limit bucket per API key, regardless of which paper ID is used.

---

## §11 — Frontend: Time Machine (static/js/time-machine.js)

This file **replaces** `static/js/timeline.js` entirely. *(Identical to v1. Reproduce §11 verbatim from PHASE_7.md v1.)*

---

## §12 — Frontend: View Mode Switcher (static/js/view-switcher.js)

*(Identical to v1. Reproduce §12 verbatim from PHASE_7.md v1.)*

---

## §13 — Frontend: Constellation View (static/js/constellation.js) [NEW — GAP-P7-8]

```javascript
/**
 * static/js/constellation.js — ConstellationView (F10.2)
 *
 * Papers as stars on a deep-space background. Gossamer edges. Pruning animates
 * as star collapse (radius→0 + opacity→0). Bottleneck papers pulse gently.
 *
 * Requires: D3.js (already loaded), graph data (same schema as ArivuGraph).
 */
class ConstellationView {
  constructor(graphData, container) {
    this.graphData = graphData;
    this.container = container;
    this.svg       = null;
    this.sim       = null;
    this.width     = container.offsetWidth  || 900;
    this.height    = container.offsetHeight || 600;
  }

  render() {
    this.container.innerHTML = '';

    // Deep space background
    this.container.style.background = '#050812';

    const svg = d3.select(this.container)
      .append('svg')
      .attr('width', this.width)
      .attr('height', this.height)
      .style('display', 'block');

    this.svg = svg;

    // Starfield background (static noise)
    const starCount = 120;
    const stars     = d3.range(starCount).map(() => ({
      x: Math.random() * this.width,
      y: Math.random() * this.height,
      r: Math.random() * 1.2 + 0.2,
      o: Math.random() * 0.4 + 0.1,
    }));

    svg.append('g').attr('class', 'starfield')
      .selectAll('circle')
      .data(stars).enter().append('circle')
      .attr('cx', d => d.x).attr('cy', d => d.y)
      .attr('r',  d => d.r)
      .attr('fill', 'white')
      .attr('opacity', d => d.o);

    const nodes = (this.graphData.nodes || []).map(d => ({...d}));
    const edges = (this.graphData.edges || []).map(d => ({...d}));

    // Force simulation
    this.sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(edges)
        .id(d => d.id)
        .distance(80)
        .strength(0.3))
      .force('charge', d3.forceManyBody().strength(-120))
      .force('center', d3.forceCenter(this.width / 2, this.height / 2))
      .force('collide', d3.forceCollide(12));

    // Gossamer edges (very low opacity lines)
    const link = svg.append('g').attr('class', 'links')
      .selectAll('line')
      .data(edges).enter().append('line')
      .attr('stroke', 'rgba(160,200,255,0.12)')
      .attr('stroke-width', 0.8);

    // Star nodes
    const nodeRadius = d => {
      const base = d.is_bottleneck ? 8 : 4;
      return base + Math.log1p(d.citation_count || 0) * 0.4;
    };

    const node = svg.append('g').attr('class', 'nodes')
      .selectAll('g')
      .data(nodes).enter().append('g')
      .attr('class', 'star-node')
      .call(d3.drag()
        .on('start', (event, d) => {
          if (!event.active) this.sim.alphaTarget(0.3).restart();
          d.fx = d.x; d.fy = d.y;
        })
        .on('drag',  (event, d) => { d.fx = event.x; d.fy = event.y; })
        .on('end',   (event, d) => {
          if (!event.active) this.sim.alphaTarget(0);
          d.fx = null; d.fy = null;
        }));

    // Glow effect for bottleneck stars
    node.append('circle')
      .attr('r', d => nodeRadius(d) * 2.2)
      .attr('fill', d => d.is_bottleneck ? 'rgba(212,168,67,0.08)' : 'transparent');

    // Core star
    node.append('circle')
      .attr('r', nodeRadius)
      .attr('fill', d => {
        if (d.is_seed)        return '#ffffff';
        if (d.is_bottleneck)  return '#D4A843';
        return d3.interpolateYlOrBr(Math.min((d.citation_count || 0) / 2000, 1));
      })
      .attr('opacity', 0.9);

    // Pulse animation for bottleneck stars
    node.filter(d => d.is_bottleneck)
      .append('circle')
      .attr('class', 'pulse-ring')
      .attr('r', d => nodeRadius(d) + 3)
      .attr('fill', 'none')
      .attr('stroke', '#D4A843')
      .attr('stroke-width', 1)
      .attr('opacity', 0.5)
      .each(function() {
        const el = d3.select(this);
        (function repeat() {
          el.attr('r', +el.attr('r') === +d3.select(this.parentNode).select('circle').attr('r') + 3
              ? +d3.select(this.parentNode).select('circle').attr('r') + 3 : 0);
          el.transition().duration(1800)
            .attr('opacity', 0).attr('r', d => (parseFloat(el.attr('r')) || 5) + 12)
            .transition().duration(200).attr('opacity', 0.5)
            .on('end', repeat);
        })();
      });

    // Tooltip
    node.append('title').text(d => `${d.title || d.id} (${d.year || '?'})`);

    this.sim.on('tick', () => {
      link
        .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
      node.attr('transform', d => `translate(${d.x},${d.y})`);
    });
  }

  /**
   * Highlight pruning result: collapsed nodes implode (star collapses to point).
   * @param {string[]} collapsedIds - paper IDs that would be removed
   */
  showPruningPreview(collapsedIds) {
    const collapsed = new Set(collapsedIds);
    this.svg.selectAll('.star-node')
      .transition().duration(600)
      .attr('opacity', d => collapsed.has(d.id) ? 0 : 1)
      .select('circle')
      .attr('r', d => collapsed.has(d.id) ? 0 : undefined);
  }

  destroy() {
    if (this.sim) this.sim.stop();
    if (this.container) this.container.innerHTML = '';
    this.container.style.background = '';
  }
}
```

---

## §14 — Frontend: Geological View (static/js/geological.js) [NEW — GAP-P7-8]

```javascript
/**
 * static/js/geological.js — GeologicalView (F10.3)
 *
 * Cross-section through time: papers arranged in horizontal strata by publication year.
 * Each stratum = one year band. Paradigm shifts shown as geological unconformities
 * (a bold jagged line separating eras).
 *
 * 2D D3.js implementation. Full 3D is Phase 8+.
 */
class GeologicalView {
  constructor(graphData, container) {
    this.graphData = graphData;
    this.container = container;
    this.width     = container.offsetWidth  || 900;
    this.height    = container.offsetHeight || 600;
    this.svg       = null;
  }

  render() {
    this.container.innerHTML = '';
    const nodes = (this.graphData.nodes || []).filter(n => n.year);
    if (!nodes.length) {
      this.container.innerHTML = '<p style="color:#64748B;padding:20px">No year data available for geological view.</p>';
      return;
    }

    const years   = [...new Set(nodes.map(n => n.year))].sort((a,b) => b - a); // newest on top
    const minYear = Math.min(...years);
    const maxYear = Math.max(...years);
    const yearSpan = Math.max(maxYear - minYear, 1);

    // Layer height: divide canvas among strata
    const layerH  = Math.max(24, Math.floor((this.height - 60) / Math.min(years.length, 30)));
    const totalH  = layerH * Math.min(years.length, 30) + 60;

    const svg = d3.select(this.container)
      .append('svg')
      .attr('width', this.width)
      .attr('height', totalH)
      .style('background', '#0f1117');

    this.svg = svg;

    const paradigmYears = new Set(
      (this.graphData.paradigm_data?.shift_events || []).map(e => e.year)
    );

    const displayYears = years.slice(0, 30);

    displayYears.forEach((year, i) => {
      const y       = 40 + i * layerH;
      const isShift = paradigmYears.has(year);

      // Geological stratum color (older = darker, warmer)
      const age   = (maxYear - year) / yearSpan;
      const color = d3.interpolateRgb('#1e2a3a', '#3d2b1a')(age);

      // Stratum band
      svg.append('rect')
        .attr('x', 60).attr('y', y)
        .attr('width', this.width - 80).attr('height', layerH - 2)
        .attr('fill', color)
        .attr('rx', 1);

      // Year label
      svg.append('text')
        .attr('x', 50).attr('y', y + layerH / 2 + 4)
        .attr('text-anchor', 'end')
        .attr('fill', '#94a3b8')
        .attr('font-size', '11px')
        .text(year);

      // Paradigm shift: unconformity line
      if (isShift) {
        const zig = d3.line()([[60, y], [80, y-3], [100, y+3], [120, y-2],
                                [this.width - 80, y]]);
        svg.append('path')
          .attr('d', zig)
          .attr('stroke', '#D4A843')
          .attr('stroke-width', 2)
          .attr('fill', 'none')
          .attr('opacity', 0.8);
        svg.append('text')
          .attr('x', this.width - 75).attr('y', y - 2)
          .attr('fill', '#D4A843').attr('font-size', '10px')
          .text('⚡ Paradigm shift');
      }

      // Papers in this stratum
      const yearNodes = nodes.filter(n => n.year === year);
      const spacing   = Math.min(18, (this.width - 120) / Math.max(yearNodes.length, 1));
      yearNodes.forEach((node, j) => {
        const cx = 70 + j * spacing + spacing / 2;
        const cy = y + layerH / 2;
        const r  = node.is_bottleneck ? 6 : 3;

        svg.append('circle')
          .attr('cx', cx).attr('cy', cy).attr('r', r)
          .attr('fill', node.is_bottleneck ? '#D4A843' : '#60a5fa')
          .attr('opacity', 0.85)
          .on('mouseover', function() { d3.select(this).attr('r', r + 2); })
          .on('mouseout',  function() { d3.select(this).attr('r', r); })
          .append('title').text(`${node.title || node.id} (${node.year})`);
      });
    });

    // Depth axis label
    svg.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('x', -totalH / 2).attr('y', 14)
      .attr('text-anchor', 'middle')
      .attr('fill', '#64748B').attr('font-size', '11px')
      .text('← Deeper (older)   Newer (surface) →');
  }

  destroy() {
    if (this.container) this.container.innerHTML = '';
  }
}
```

---

## §15 — Frontend: River View (static/js/river-view.js) [NEW — GAP-P7-8]

```javascript
/**
 * static/js/river-view.js — RiverView (F10.4)
 *
 * Watershed visualization: foundational papers as mountain peaks (top),
 * citation edges as rivers flowing downward (newer papers downstream).
 * Edge weight = similarity score → river width.
 *
 * 2D D3.js implementation. Full 3D WebGL is Phase 8+.
 */
class RiverView {
  constructor(graphData, container) {
    this.graphData = graphData;
    this.container = container;
    this.width     = container.offsetWidth  || 900;
    this.height    = container.offsetHeight || 600;
    this.svg       = null;
  }

  render() {
    this.container.innerHTML = '';
    const nodes = (this.graphData.nodes || []).filter(n => n.year);
    if (!nodes.length) {
      this.container.innerHTML = '<p style="color:#64748B;padding:20px">No year data for river view.</p>';
      return;
    }

    const edges    = this.graphData.edges || [];
    const minYear  = Math.min(...nodes.map(n => n.year));
    const maxYear  = Math.max(...nodes.map(n => n.year));
    const yearSpan = Math.max(maxYear - minYear, 1);

    // Y position = year (older = higher = more "upstream")
    const yScale = d3.scaleLinear().domain([minYear, maxYear]).range([60, this.height - 40]);

    // X position = rank within year (spread horizontally)
    const nodeById: dict = {};
    const byYear: dict   = {};
    nodes.forEach(n => {
      nodeById[n.id] = n;
      (byYear[n.year] = byYear[n.year] || []).push(n);
    });
    nodes.forEach(n => {
      const siblings = byYear[n.year];
      const idx      = siblings.indexOf(n);
      n._x = 60 + (idx + 1) * ((this.width - 120) / (siblings.length + 1));
      n._y = yScale(n.year);
    });

    const svg = d3.select(this.container)
      .append('svg')
      .attr('width', this.width).attr('height', this.height)
      .style('background', '#0a1428');

    this.svg = svg;

    // River edges: bezier curves, width by similarity
    const link = svg.append('g').attr('class', 'rivers');
    edges.forEach(e => {
      const src = nodeById[e.source] || nodeById[e.citing_paper_id];
      const tgt = nodeById[e.target] || nodeById[e.cited_paper_id];
      if (!src || !tgt) return;
      const sim   = e.similarity_score || 0.5;
      const width = 1 + sim * 4;
      const mx    = (src._x + tgt._x) / 2;
      // River flows from older (cited) to newer (citing) — upstream to downstream
      link.append('path')
        .attr('d', `M${tgt._x},${tgt._y} C${mx},${tgt._y} ${mx},${src._y} ${src._x},${src._y}`)
        .attr('fill', 'none')
        .attr('stroke', `rgba(96,165,250,${0.15 + sim * 0.3})`)
        .attr('stroke-width', width);
    });

    // Mountain peaks (high-citation bottleneck papers) — triangle shape at top
    const peakGroup = svg.append('g').attr('class', 'peaks');
    nodes.filter(n => n.is_bottleneck).forEach(n => {
      const x = n._x, y = n._y;
      peakGroup.append('polygon')
        .attr('points', `${x},${y-16} ${x-10},${y+4} ${x+10},${y+4}`)
        .attr('fill', '#D4A843').attr('opacity', 0.9);
    });

    // Regular paper nodes — dots
    svg.append('g').attr('class', 'nodes')
      .selectAll('circle')
      .data(nodes.filter(n => !n.is_bottleneck))
      .enter().append('circle')
      .attr('cx', d => d._x).attr('cy', d => d._y)
      .attr('r',  d => 2 + Math.log1p(d.citation_count || 0) * 0.3)
      .attr('fill', '#60a5fa').attr('opacity', 0.75)
      .append('title').text(d => `${d.title || d.id} (${d.year})`);

    // Year axis (left side)
    const yearTicks = d3.range(minYear, maxYear + 1, Math.max(1, Math.floor(yearSpan / 10)));
    yearTicks.forEach(y => {
      svg.append('text')
        .attr('x', 8).attr('y', yScale(y) + 4)
        .attr('fill', '#475569').attr('font-size', '10px')
        .text(y);
    });
  }

  destroy() {
    if (this.container) this.container.innerHTML = '';
  }
}
```

---

## §16 — Frontend: Workflow Panel (static/js/workflow.js) [NEW — GAP-P7-8]

```javascript
/**
 * static/js/workflow.js — WorkflowPanel
 *
 * Manages the workflow tools panel: Adversarial Reviewer, Paper Positioning,
 * Rewrite Suggester, Citation Audit, Reading Prioritizer, Citation Generator.
 * Attaches to #workflow-panel in tool.html.
 */
class WorkflowPanel {
  constructor(seedPaperId) {
    this.seedPaperId = seedPaperId;
    this.panel       = document.getElementById('workflow-panel');
    this.activeTab   = null;
    if (this.panel) this._init();
  }

  _init() {
    const tabs = [
      { id: 'adversarial',  label: '🔍 Review', icon: '🔍' },
      { id: 'positioning',  label: '📍 Positioning', icon: '📍' },
      { id: 'rewrite',      label: '✏️ Rewrite', icon: '✏️' },
      { id: 'citation-gen', label: '📄 Cite', icon: '📄' },
    ];

    this.panel.innerHTML = `
      <div class="workflow-tabs">
        ${tabs.map(t => `<button class="workflow-tab" data-tab="${t.id}">${t.label}</button>`).join('')}
      </div>
      <div class="workflow-content" id="workflow-content"></div>
    `;

    this.panel.querySelectorAll('.workflow-tab').forEach(btn => {
      btn.addEventListener('click', () => this.showTab(btn.dataset.tab));
    });

    this.showTab('adversarial');
  }

  showTab(tabId) {
    this.activeTab = tabId;
    this.panel.querySelectorAll('.workflow-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    const content = document.getElementById('workflow-content');
    switch (tabId) {
      case 'adversarial': this._renderAdversarial(content); break;
      case 'positioning': this._renderPositioning(content); break;
      case 'rewrite':     this._renderRewrite(content);     break;
      case 'citation-gen': window.citationGen && window.citationGen.renderInto(content); break;
    }
  }

  _renderAdversarial(el) {
    el.innerHTML = `
      <div class="wf-section">
        <p class="wf-desc">Upload your paper PDF or paste your abstract for pre-submission analysis.</p>
        <div class="wf-tabs-inner">
          <button class="wf-inner-tab active" data-inner="pdf">PDF Upload</button>
          <button class="wf-inner-tab" data-inner="abstract">Abstract</button>
        </div>
        <div id="adv-pdf-form">
          <input type="file" id="adv-pdf-input" accept=".pdf" class="wf-file-input">
          <button id="adv-pdf-btn" class="btn-primary wf-btn">Analyze PDF</button>
        </div>
        <div id="adv-abstract-form" style="display:none">
          <input id="adv-title" placeholder="Paper title" class="wf-input">
          <textarea id="adv-abstract" placeholder="Paste abstract..." class="wf-textarea" rows="5"></textarea>
          <button id="adv-abstract-btn" class="btn-primary wf-btn">Analyze Abstract</button>
        </div>
        <div id="adv-result" class="wf-result"></div>
      </div>
    `;

    el.querySelectorAll('.wf-inner-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        el.querySelectorAll('.wf-inner-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        el.getElementById('adv-pdf-form').style.display  = btn.dataset.inner === 'pdf'      ? '' : 'none';
        el.getElementById('adv-abstract-form').style.display = btn.dataset.inner === 'abstract' ? '' : 'none';
      });
    });

    document.getElementById('adv-pdf-btn').addEventListener('click', () => this._submitPDF());
    document.getElementById('adv-abstract-btn').addEventListener('click', () => this._submitAbstract());
  }

  async _submitPDF() {
    const file    = document.getElementById('adv-pdf-input').files[0];
    const result  = document.getElementById('adv-result');
    if (!file) { result.innerHTML = '<p class="wf-error">Select a PDF first.</p>'; return; }
    result.innerHTML = '<p class="wf-loading">Analyzing…</p>';
    const fd = new FormData();
    fd.append('pdf', file);
    try {
      const resp = await fetch('/api/adversarial-review', {method:'POST', body:fd, credentials:'include'});
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed');
      this._renderReviewResult(result, data.result);
    } catch (err) {
      result.innerHTML = `<p class="wf-error">${err.message}</p>`;
    }
  }

  async _submitAbstract() {
    const title    = document.getElementById('adv-title').value;
    const abstract = document.getElementById('adv-abstract').value;
    const result   = document.getElementById('adv-result');
    if (!abstract.trim()) { result.innerHTML = '<p class="wf-error">Enter an abstract.</p>'; return; }
    result.innerHTML = '<p class="wf-loading">Analyzing…</p>';
    try {
      const resp = await fetch('/api/adversarial-review', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        credentials: 'include',
        body: JSON.stringify({title, abstract}),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed');
      this._renderReviewResult(result, data);
    } catch (err) {
      result.innerHTML = `<p class="wf-error">${err.message}</p>`;
    }
  }

  _renderReviewResult(el, result) {
    const criSize = result.reviewer_criticisms?.length || 0;
    const missing = result.missing_citations?.all?.length || 0;
    el.innerHTML = `
      <div class="adv-summary">
        <span class="adv-badge">${result.novelty?.assessment || 'unknown'}</span>
        <span class="adv-badge adv-badge-warn">${missing} missing citation(s)</span>
        <span class="adv-badge adv-badge-info">${criSize} reviewer concern(s)</span>
      </div>
      <p class="adv-position">${result.landscape?.position || ''}</p>
      ${result.reviewer_criticisms?.map(c => `
        <div class="adv-criticism adv-crit-${c.severity}">
          <strong>[${c.severity.toUpperCase()}]</strong> ${c.criticism}
          <em class="adv-response">${c.suggested_response}</em>
        </div>`).join('') || ''}
    `;
  }

  _renderPositioning(el) {
    el.innerHTML = `
      <div class="wf-section">
        <p class="wf-desc">Discover where your paper sits in the intellectual landscape.</p>
        <textarea id="pos-abstract" placeholder="Paste your abstract..." class="wf-textarea" rows="5"></textarea>
        <input id="pos-title" placeholder="Paper title" class="wf-input">
        <button id="pos-btn" class="btn-primary wf-btn">Find My Position</button>
        <div id="pos-result" class="wf-result"></div>
      </div>
    `;
    document.getElementById('pos-btn').addEventListener('click', async () => {
      const abstract = document.getElementById('pos-abstract').value;
      const title    = document.getElementById('pos-title').value;
      const result   = document.getElementById('pos-result');
      if (!abstract.trim()) { result.innerHTML = '<p class="wf-error">Enter an abstract.</p>'; return; }
      result.innerHTML = '<p class="wf-loading">Positioning…</p>';
      try {
        const resp = await fetch('/api/paper-positioning', {
          method:'POST', headers:{'Content-Type':'application/json'},
          credentials:'include', body:JSON.stringify({title, abstract}),
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Failed');
        result.innerHTML = `
          <p><strong>Cluster:</strong> ${data.intellectual_cluster}</p>
          <p><strong>Strongest framing:</strong> ${data.strongest_framing}</p>
          <p>${data.positioning_statement}</p>
          <p><strong>Suggested venues:</strong> ${data.venue_recommendations?.map(v => v.venue).join(', ')}</p>
        `;
      } catch (err) {
        result.innerHTML = `<p class="wf-error">${err.message}</p>`;
      }
    });
  }

  _renderRewrite(el) {
    el.innerHTML = `
      <div class="wf-section">
        <p class="wf-desc">Paste your related-work section. Get a narrative rewrite.</p>
        <input id="rw-title" placeholder="Your paper title (optional)" class="wf-input">
        <textarea id="rw-text" placeholder="Paste related work section..." class="wf-textarea" rows="8"></textarea>
        <button id="rw-btn" class="btn-primary wf-btn">Suggest Rewrite</button>
        <div id="rw-result" class="wf-result"></div>
      </div>
    `;
    document.getElementById('rw-btn').addEventListener('click', async () => {
      const text   = document.getElementById('rw-text').value;
      const title  = document.getElementById('rw-title').value;
      const result = document.getElementById('rw-result');
      if (!text.trim()) { result.innerHTML = '<p class="wf-error">Paste your related-work text first.</p>'; return; }
      result.innerHTML = '<p class="wf-loading">Analyzing narrative structure…</p>';
      try {
        const resp = await fetch('/api/rewrite-suggester', {
          method:'POST', headers:{'Content-Type':'application/json'},
          credentials:'include', body:JSON.stringify({related_work_text:text, paper_title:title}),
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Failed');
        result.innerHTML = `
          <div class="rw-critique"><strong>Critique:</strong> ${data.original_critique}</div>
          <div class="rw-arc"><strong>Narrative arc:</strong> ${data.narrative_arc}</div>
          <hr>
          <h4>Suggested Rewrite:</h4>
          <div class="rw-rewrite">${data.suggested_rewrite.replace(/\n/g, '<br>')}</div>
        `;
      } catch (err) {
        result.innerHTML = `<p class="wf-error">${err.message}</p>`;
      }
    });
  }
}
```

---

## §17 — Frontend: Citation Generator (static/js/citation-gen.js) [NEW — GAP-P7-8]

```javascript
/**
 * static/js/citation-gen.js — CitationGeneratorUI
 *
 * Frontend for the Citation Generator (F4.9).
 * Selects papers from the current graph and exports citations in any of 6 formats.
 */
class CitationGeneratorUI {
  constructor(graphData) {
    this.graphData  = graphData;
    this.selected   = new Set();
    this.allPapers  = (graphData.nodes || []).map(n => ({
      id:    n.id,
      title: n.title || n.id,
      year:  n.year,
    }));
  }

  renderInto(container) {
    container.innerHTML = `
      <div class="citgen-panel">
        <p class="wf-desc">Select papers and export formatted citations.</p>
        <div class="citgen-controls">
          <select id="citgen-style" class="wf-select">
            <option value="apa">APA</option>
            <option value="mla">MLA</option>
            <option value="chicago">Chicago</option>
            <option value="ieee">IEEE</option>
            <option value="vancouver">Vancouver</option>
            <option value="harvard">Harvard</option>
          </select>
          <button id="citgen-all-btn" class="btn-secondary citgen-btn">Select All</button>
          <button id="citgen-gen-btn" class="btn-primary citgen-btn">Generate Citations</button>
        </div>
        <div id="citgen-list" class="citgen-list"></div>
        <div id="citgen-output" class="citgen-output"></div>
      </div>
    `;

    this._renderPaperList(document.getElementById('citgen-list'));

    document.getElementById('citgen-all-btn').addEventListener('click', () => {
      this.allPapers.forEach(p => this.selected.add(p.id));
      this._renderPaperList(document.getElementById('citgen-list'));
    });

    document.getElementById('citgen-gen-btn').addEventListener('click', () => this._generate());
  }

  _renderPaperList(container) {
    container.innerHTML = this.allPapers.map(p => `
      <label class="citgen-item">
        <input type="checkbox" value="${p.id}" ${this.selected.has(p.id) ? 'checked' : ''}>
        ${p.title} (${p.year || '?'})
      </label>
    `).join('');

    container.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.addEventListener('change', () => {
        cb.checked ? this.selected.add(cb.value) : this.selected.delete(cb.value);
      });
    });
  }

  async _generate() {
    const style  = document.getElementById('citgen-style').value;
    const ids    = [...this.selected];
    const output = document.getElementById('citgen-output');
    if (!ids.length) { output.innerHTML = '<p class="wf-error">Select at least one paper.</p>'; return; }
    output.innerHTML = '<p class="wf-loading">Generating citations…</p>';
    try {
      const resp = await fetch('/api/citation-generator', {
        method:'POST', headers:{'Content-Type':'application/json'},
        credentials:'include', body:JSON.stringify({paper_ids:ids, style}),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed');
      const lines = Object.values(data.citations).join('\n\n');
      output.innerHTML = `
        <div class="citgen-citations">${lines.replace(/\n/g, '<br>')}</div>
        <button class="btn-secondary citgen-copy-btn" onclick="navigator.clipboard.writeText(\`${lines.replace(/`/g,'\\`')}\`)">Copy All</button>
      `;
    } catch (err) {
      output.innerHTML = `<p class="wf-error">${err.message}</p>`;
    }
  }
}

// Expose for WorkflowPanel
window.citationGen = null;  // Set by tool.html after graph loads
```

---

## §18 — Frontend: Persona Panel (static/js/persona.js) [NEW — GAP-P7-8]

```javascript
/**
 * static/js/persona.js — PersonaPanel
 *
 * Mode selector UI: Explorer / Critic / Innovator / Historian.
 * Persists choice to server via POST /api/persona.
 * Updates the right panel emphasis and AI guide framing on switch.
 */
class PersonaPanel {
  constructor(containerId = 'persona-panel') {
    this.container  = document.getElementById(containerId);
    this.currentMode = 'explorer';
    if (this.container) this._init();
  }

  _init() {
    const modes = [
      { id: 'explorer',   label: '🔭 Explorer',  desc: 'New to the field' },
      { id: 'critic',     label: '🔍 Critic',    desc: 'Reviewing work' },
      { id: 'innovator',  label: '💡 Innovator', desc: 'Finding gaps' },
      { id: 'historian',  label: '📜 Historian', desc: 'Tracing evolution' },
    ];

    this.container.innerHTML = `
      <div class="persona-header">Research Mode</div>
      <div class="persona-modes">
        ${modes.map(m => `
          <button class="persona-btn ${m.id === this.currentMode ? 'active' : ''}"
                  data-mode="${m.id}" title="${m.desc}">
            ${m.label}
          </button>
        `).join('')}
      </div>
      <div id="persona-guide" class="persona-guide"></div>
    `;

    this.container.querySelectorAll('.persona-btn').forEach(btn => {
      btn.addEventListener('click', () => this.setMode(btn.dataset.mode));
    });

    // Load current mode from server
    fetch('/api/persona', {credentials: 'include'})
      .then(r => r.json())
      .then(data => this._applyConfig(data))
      .catch(() => {});
  }

  async setMode(mode) {
    try {
      const resp = await fetch('/api/persona', {
        method:'POST', headers:{'Content-Type':'application/json'},
        credentials:'include', body:JSON.stringify({mode}),
      });
      const data = await resp.json();
      this._applyConfig(data.config || data);
    } catch (err) {
      console.warn('Persona set failed:', err);
    }
  }

  _applyConfig(config) {
    if (!config || !config.mode) return;
    this.currentMode = config.mode;
    this.container.querySelectorAll('.persona-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === config.mode);
    });
    const guide = document.getElementById('persona-guide');
    if (guide) {
      guide.innerHTML = `<p>${config.ai_guide_framing || ''}</p>`;
    }
    // Notify insight feed to re-filter
    document.dispatchEvent(new CustomEvent('persona-changed', {detail: config}));
  }
}
```

---

## §19 — Frontend: Insight Feed (static/js/insight-feed.js) [NEW — GAP-P7-8]

Replaces Phase 3 empty stub entirely.

```javascript
/**
 * static/js/insight-feed.js — InsightFeed (F5.4)
 *
 * Proactive discovery cards. Loads from /api/insights/<seed_paper_id>.
 * Listens for persona-changed events to re-filter.
 * Supports progressive loading (shows first 3 immediately, lazy-loads rest).
 */
class InsightFeed {
  constructor(seedPaperId, containerId = 'insight-feed') {
    this.seedPaperId = seedPaperId;
    this.container   = document.getElementById(containerId);
    this.allCards    = [];
    this.shown       = 0;
    if (this.container && seedPaperId) this._load();
  }

  async _load() {
    this.container.innerHTML = '<div class="insight-loading">Loading insights…</div>';
    try {
      const resp = await fetch(`/api/insights/${this.seedPaperId}`, {credentials: 'include'});
      if (!resp.ok) throw new Error('Failed to load insights');
      const data = await resp.json();
      this.allCards = data.insights || [];
      this._render();
    } catch (err) {
      this.container.innerHTML = '<p class="insight-error">Could not load insights.</p>';
    }
  }

  _render() {
    if (!this.allCards.length) {
      this.container.innerHTML = '<p class="insight-empty">No insights yet — build a graph to see them.</p>';
      return;
    }

    this.container.innerHTML = `
      <div class="insight-list" id="insight-list"></div>
      ${this.allCards.length > 3
        ? '<button id="insight-more-btn" class="btn-secondary insight-more-btn">Show more insights</button>'
        : ''}
    `;

    this._showCards(0, 3);

    const moreBtn = document.getElementById('insight-more-btn');
    if (moreBtn) {
      moreBtn.addEventListener('click', () => {
        this._showCards(this.shown, this.shown + 5);
        if (this.shown >= this.allCards.length) moreBtn.remove();
      });
    }

    // Re-filter when persona changes
    document.addEventListener('persona-changed', (e) => {
      const focus = new Set(e.detail?.insight_focus || []);
      if (!focus.size) return;
      document.querySelectorAll('.insight-card').forEach(card => {
        card.style.opacity = focus.has(card.dataset.type) ? '1' : '0.35';
        card.style.order   = focus.has(card.dataset.type) ? '0' : '1';
      });
    });
  }

  _showCards(from, to) {
    const list = document.getElementById('insight-list');
    if (!list) return;
    this.allCards.slice(from, to).forEach(card => {
      const el = document.createElement('div');
      el.className   = 'insight-card';
      el.dataset.type = card.type || '';
      el.innerHTML   = `
        <div class="insight-icon">${card.icon || '💡'}</div>
        <div class="insight-body">
          <div class="insight-title">${card.title}</div>
          <div class="insight-text">${card.body}</div>
          ${card.action
            ? `<a href="${card.action.route}" class="insight-action">${card.action.label} →</a>`
            : ''}
        </div>
      `;
      list.appendChild(el);
    });
    this.shown = to;
  }
}
```

---

## §20 — Frontend: panels.js Wiring [NEW — GAP-P7-13]

Add to `static/js/panels.js`:

```javascript
// ── Phase 7: Wire Insight Feed and Persona Panel ──────────────────────────────

// Called after graph data is loaded and seed paper ID is known
function initPhase7Panels(seedPaperId, graphData) {
  // Insight Feed (right panel)
  window.insightFeed = new InsightFeed(seedPaperId, 'insight-feed');

  // Persona Panel (nav sidebar)
  window.personaPanel = new PersonaPanel('persona-panel');

  // Citation Generator (workflow panel)
  window.citationGen = new CitationGeneratorUI(graphData);

  // Workflow Panel (bottom / right panel)
  window.workflowPanel = new WorkflowPanel(seedPaperId);

  // Guided Discovery — check if first visit, show modal if so
  const hasSeenOnboarding = sessionStorage.getItem('arivu-onboarding-done');
  if (!hasSeenOnboarding && seedPaperId) {
    _showGuidedDiscoveryModal(seedPaperId);
  }
}

function _showGuidedDiscoveryModal(seedPaperId) {
  const modal = document.createElement('div');
  modal.id        = 'discovery-modal';
  modal.className = 'discovery-modal-overlay';
  modal.innerHTML = `
    <div class="discovery-modal">
      <h2>How are you using this paper?</h2>
      <div class="discovery-options">
        <button class="disco-btn" data-rel="new_field">🔭 Exploring a new field</button>
        <button class="disco-btn" data-rel="writing">✍️ Writing a paper that builds on this</button>
        <button class="disco-btn" data-rel="reviewing">🔍 Reviewing work in this area</button>
        <button class="disco-btn" data-rel="curious">💡 Just curious about the history</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelectorAll('.disco-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const relationship = btn.dataset.rel;
      modal.remove();
      sessionStorage.setItem('arivu-onboarding-done', '1');
      try {
        const resp = await fetch('/api/guided-discovery', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          credentials: 'include',
          body: JSON.stringify({relationship}),
        });
        const data = await resp.json();
        // Show guidance banner
        _showPathwayBanner(data);
        // Update persona
        if (data.suggested_persona && window.personaPanel) {
          window.personaPanel.setMode(data.suggested_persona);
        }
      } catch (err) {
        console.warn('Guided discovery failed:', err);
      }
    });
  });
}

function _showPathwayBanner(pathway) {
  const banner = document.createElement('div');
  banner.className = 'pathway-banner';
  banner.innerHTML = `
    <div class="pathway-text">${pathway.guide_message || ''}</div>
    <a href="${pathway.primary_feature?.route || '#'}" class="pathway-link">
      → ${pathway.primary_feature?.label || 'Start here'}
    </a>
    <button class="pathway-close" onclick="this.parentElement.remove()">✕</button>
  `;
  document.querySelector('.tool-main')?.prepend(banner);
}
```

---

## §21 — graph.js Additions [GAP-P7-22 + GAP-P7-N14]

Add to `ArivuGraph` class in `static/js/graph.js`:

```javascript
// ── Add to ArivuGraph constructor ─────────────────────────────────────────────

constructor(container, graphData, options = {}) {
  // ... existing constructor code ...
  this.readOnly = options.readOnly || false;  // (GAP-P7-N14 fix)
  if (this.readOnly) this._disableInteractions();
}

// ── Add method: disable interactions for shared/read-only view ────────────────
_disableInteractions() {
  // Called when readOnly: true. Disables pruning clicks, panel triggers.
  this._readOnlyMode = true;
  // CSS class for visual indication
  if (this.container) this.container.classList.add('graph-readonly');
}

// Override node click to no-op in read-only mode
_handleNodeClick(event, d) {
  if (this._readOnlyMode) return;  // (GAP-P7-N14 fix)
  // ... existing click logic ...
}

// ── Time Machine update method ────────────────────────────────────────────────
updateForTimeMachine(slice) {
  const visibleIds = new Set(slice.nodes.map(n => n.id));
  const addedIds   = new Set(slice.added_nodes.map(n => n.id));
  const weights    = slice.node_weights || {};

  this.svg.selectAll('.node')
    .attr('opacity', d => visibleIds.has(d.id) ? 1 : 0.05)
    .filter(d => addedIds.has(d.id))
    .attr('opacity', 0)
    .transition().duration(400)
    .attr('opacity', 1);

  this.svg.selectAll('.node circle')
    .attr('r', d => {
      const w    = weights[d.id] || 0;
      const base = this.nodeRadius(d);
      return Math.max(base, base * (1 + w * 0.03));
    });

  const edgeKeys = new Set(slice.edges.map(e => `${e.source}|${e.target}`));
  this.svg.selectAll('.link')
    .attr('opacity', d =>
      edgeKeys.has(`${d.source.id || d.source}|${d.target.id || d.target}`) ? 0.6 : 0.03
    );
}

// ── Vocabulary overlay method ─────────────────────────────────────────────────
showVocabularyOverlay(terms) {
  this.svg.selectAll('.vocab-label').remove();
  if (!terms || !terms.length) return;

  const overlay = this.svg.select('.graph-overlay').empty()
    ? this.svg.append('g').attr('class', 'graph-overlay')
    : this.svg.select('.graph-overlay');

  terms.forEach((item, i) => {
    overlay.append('text')
      .attr('class', 'vocab-label')
      .attr('x', 50 + i * 80)
      .attr('y', 20)
      .attr('fill', `hsl(${40 + item.score * 20}, 80%, 65%)`)
      .attr('font-size', `${10 + item.score * 6}px`)
      .attr('opacity', 0.7 + item.score * 0.3)
      .attr('pointer-events', 'none')
      .text(item.term);
  });
}

// ── View mode notification ────────────────────────────────────────────────────
// Called by ViewSwitcher when this view is being unmounted
destroy() {
  if (this.simulation) this.simulation.stop();
  // Clear vocab overlay on destroy
  if (this.svg) this.svg.selectAll('.vocab-label').remove();
}
```

---

## §22 — Template Modifications [GAP-P7-9]

### §22.1 — templates/tool.html additions

Add inside `{% block content %}` in `tool.html`, after the existing graph container:

```html
<!-- ── View Mode Bar ──────────────────────────────────────────────────── -->
<div id="view-mode-bar" class="view-mode-bar"></div>

<!-- ── Time Machine Panel ─────────────────────────────────────────────── -->
<div id="time-machine-panel" class="time-machine-panel" hidden>
  <!-- Populated by TimeMachineController._setupUI() -->
</div>

<!-- ── Workflow Panel ─────────────────────────────────────────────────── -->
<div id="workflow-panel" class="workflow-panel panel-collapsed">
  <!-- Populated by WorkflowPanel -->
</div>

<!-- ── Insight Feed (right sidebar) ───────────────────────────────────── -->
<div id="insight-feed" class="insight-feed-sidebar">
  <!-- Populated by InsightFeed -->
</div>
```

Add to `{% block scripts %}` in `tool.html` (after existing scripts):

```html
<script src="/static/js/view-switcher.js"></script>
<script src="/static/js/time-machine.js"></script>
<script src="/static/js/constellation.js"></script>
<script src="/static/js/geological.js"></script>
<script src="/static/js/river-view.js"></script>
<script src="/static/js/persona.js"></script>
<script src="/static/js/insight-feed.js"></script>
<script src="/static/js/citation-gen.js"></script>
<script src="/static/js/workflow.js"></script>
<script>
// Initialize Phase 7 panels after graph data loads
document.addEventListener('arivu-graph-ready', function(e) {
  const graphData    = e.detail.graphData;
  const seedPaperId  = e.detail.seedPaperId;

  // View mode switcher
  window.viewSwitcher = new ViewSwitcher(graphData, 'graph-container');

  // Time machine (auto-hide if no year data)
  window.timeMachine = new TimeMachineController(window.arivuGraph);
  if (seedPaperId) window.timeMachine.loadData(seedPaperId);

  // All other Phase 7 panels
  initPhase7Panels(seedPaperId, graphData);

  // Citation generator instance
  window.citationGen = new CitationGeneratorUI(graphData);
});
</script>
```

Note: The existing graph build SSE completion handler must dispatch the `arivu-graph-ready` event:
```javascript
// In graph.js or the SSE handler, after graph is fully rendered:
document.dispatchEvent(new CustomEvent('arivu-graph-ready', {
  detail: { graphData: window.arivuGraph.graphData, seedPaperId: currentSeedPaperId }
}));
```

### §22.2 — templates/base.html additions

Add inside `<nav>` or the header element, after existing nav items:

```html
<!-- Persona Mode Switcher (nav bar) -->
<div id="persona-panel" class="persona-nav-widget"></div>
```

Add before `</body>`:

```html
<!-- Insight Feed sidebar (visible on tool pages only) -->
{% if request.endpoint == 'tool' %}
<div class="insight-feed-wrapper">
  <button id="insight-feed-toggle" class="insight-feed-toggle" title="Insights">💡</button>
</div>
<script>
document.getElementById('insight-feed-toggle')?.addEventListener('click', () => {
  document.querySelector('.insight-feed-sidebar')?.classList.toggle('open');
});
</script>
{% endif %}
```

### §22.3 — templates/account.html additions

Add a new section for **Email Change** (after the existing password change form):

```html
<!-- Email Change Section -->
<section class="account-section" id="section-email-change">
  <h2>Change Email Address</h2>
  <p class="section-desc">A verification link will be sent to your new email. Your current email stays active until verified.</p>
  <div class="form-group">
    <label for="new-email">New Email Address</label>
    <input type="email" id="new-email" class="form-input" placeholder="new@example.com">
  </div>
  <div class="form-group">
    <label for="email-change-password">Current Password (required)</label>
    <input type="password" id="email-change-password" class="form-input" placeholder="Confirm your password">
  </div>
  <button id="change-email-btn" class="btn-primary">Send Verification Link</button>
  <div id="email-change-msg" class="form-message"></div>
</section>

<!-- Lab Member Management (Lab tier only) -->
{% if user and user.tier in ('lab', 'developer') %}
<section class="account-section" id="section-lab">
  <h2>Lab Members</h2>
  <div id="lab-members-list" class="lab-members-list">Loading…</div>
  <div class="invite-form">
    <input type="email" id="invite-email" class="form-input" placeholder="colleague@university.edu">
    <select id="invite-role" class="form-select">
      <option value="member">Member</option>
      <option value="owner">Owner</option>
    </select>
    <button id="invite-btn" class="btn-primary">Send Invite</button>
  </div>
  <div id="invite-msg" class="form-message"></div>
</section>
{% endif %}

<script>
// Email change
document.getElementById('change-email-btn')?.addEventListener('click', async () => {
  const newEmail  = document.getElementById('new-email').value;
  const password  = document.getElementById('email-change-password').value;
  const msg       = document.getElementById('email-change-msg');
  try {
    const resp = await fetch('/account/change-email', {
      method:'POST', headers:{'Content-Type':'application/json'},
      credentials:'include', body:JSON.stringify({new_email:newEmail, password}),
    });
    const data = await resp.json();
    msg.textContent = data.message || (resp.ok ? 'Check your new email.' : data.error);
    msg.className   = `form-message ${resp.ok ? 'success' : 'error'}`;
  } catch (err) {
    msg.textContent = 'Failed to request email change.';
    msg.className   = 'form-message error';
  }
});

// Lab members
async function loadLabMembers() {
  const list = document.getElementById('lab-members-list');
  if (!list) return;
  try {
    const resp = await fetch('/api/lab/members', {credentials:'include'});
    const data = await resp.json();
    list.innerHTML = (data.members || []).map(m => `
      <div class="lab-member-row">
        <span>${m.display_name || m.email}</span>
        <span class="member-role">${m.role}</span>
        <button class="btn-danger-sm" onclick="removeMember('${m.user_id}')">Remove</button>
      </div>
    `).join('') || '<p>No members yet.</p>';
  } catch (err) {
    list.innerHTML = '<p class="error">Could not load members.</p>';
  }
}

async function removeMember(userId) {
  await fetch(`/api/lab/members/${userId}`, {method:'DELETE', credentials:'include'});
  loadLabMembers();
}

document.getElementById('invite-btn')?.addEventListener('click', async () => {
  const email = document.getElementById('invite-email').value;
  const role  = document.getElementById('invite-role').value;
  const msg   = document.getElementById('invite-msg');
  try {
    const resp = await fetch('/api/lab/invite', {
      method:'POST', headers:{'Content-Type':'application/json'},
      credentials:'include', body:JSON.stringify({email, role}),
    });
    const data = await resp.json();
    msg.textContent = data.message || (resp.ok ? 'Invite sent.' : data.error);
    msg.className   = `form-message ${resp.ok ? 'success' : 'error'}`;
  } catch (err) {
    msg.textContent = 'Failed to send invite.';
    msg.className   = 'form-message error';
  }
});

loadLabMembers();
</script>
```

---

## §23 — templates/shared_graph.html

*(Identical to v1. Reproduce §13 verbatim from PHASE_7.md v1. The `/api/graph/<graph_id>` route is now specified in §9.3 with security guard.)*

---

## §24 — templates/supervisor.html [NEW — GAP-P7-10]

```html
{% extends "base.html" %}
{% block title %}Supervisor Dashboard — Arivu{% endblock %}
{% block content %}
<div class="supervisor-page">
  <div class="supervisor-header">
    <h1>Lab Supervisor Dashboard</h1>
    <p class="supervisor-sub">Monitor your team's research activity. Digest emails arrive every Monday.</p>
  </div>

  <div class="supervisor-grid">
    {% for member in members %}
    <div class="supervisor-card" id="member-{{ member.user_id[:8] }}">
      <div class="member-name">{{ member.display_name or member.email }}</div>
      <div class="member-role badge">{{ member.role }}</div>
      <div class="member-graphs" id="graphs-{{ member.user_id[:8] }}">
        <em>Loading activity…</em>
      </div>
    </div>
    {% else %}
    <p class="no-members">No lab members yet. <a href="/account#section-lab">Invite members</a> from Account Settings.</p>
    {% endfor %}
  </div>
</div>

<script>
// Load recent graphs per member
const members = {{ members | tojson }};
members.forEach(m => {
  fetch(`/api/lab/member-graphs/${m.user_id}`, {credentials:'include'})
    .then(r => r.json())
    .then(data => {
      const el = document.getElementById(`graphs-${m.user_id.slice(0,8)}`);
      if (!el) return;
      if (!data.graphs || !data.graphs.length) {
        el.innerHTML = '<span class="no-activity">No activity this week.</span>';
        return;
      }
      el.innerHTML = data.graphs.slice(0,3).map(g => `
        <div class="member-graph-item">
          <span class="graph-title">${g.seed_title || 'Unknown paper'}</span>
          <span class="graph-date">${new Date(g.created_at).toLocaleDateString()}</span>
        </div>
      `).join('');
    })
    .catch(() => {
      const el = document.getElementById(`graphs-${m.user_id.slice(0,8)}`);
      if (el) el.innerHTML = '<em class="error">Could not load.</em>';
    });
});
</script>
{% endblock %}
```

Add route to `app.py` (§9.5 already covers this — `/supervisor` renders this template).

Also add `/api/lab/member-graphs/<member_user_id>` route:

```python
@app.route("/api/lab/member-graphs/<member_user_id>")
@require_auth
@require_tier("lab")
def api_lab_member_graphs(member_user_id: str):
    """Return recent graphs for a lab member. Lab owner only."""
    # Verify the member belongs to this lab
    membership = db.fetchone(
        "SELECT member_user_id FROM lab_memberships "
        "WHERE lab_user_id = %s::uuid AND member_user_id = %s::uuid",
        (g.user_id, member_user_id),
    )
    if not membership:
        return jsonify({"error": "Not a member of your lab"}), 403
    rows = db.fetchall(
        """
        SELECT g.graph_id, g.seed_paper_id, p.title AS seed_title, g.created_at
        FROM graphs g
        LEFT JOIN papers p ON p.paper_id = g.seed_paper_id
        WHERE g.user_id = %s::uuid
          AND g.created_at > NOW() - INTERVAL '30 days'
        ORDER BY g.created_at DESC LIMIT 10
        """,
        (member_user_id,),
    )
    return jsonify({"graphs": [dict(r) for r in rows]})
```

---

## §25 — templates/api_docs.html [NEW — GAP-P7-10]

```html
{% extends "base.html" %}
{% block title %}Public API Documentation — Arivu{% endblock %}
{% block content %}
<div class="api-docs-page">
  <div class="api-docs-header">
    <h1>Arivu Public REST API</h1>
    <p>Access citation graphs, DNA profiles, and research intelligence programmatically.
       Requires a Developer or Lab API key.</p>
    <a href="/account" class="btn-primary">Get API Key</a>
  </div>

  <div class="api-docs-content">
    <h2>Authentication</h2>
    <p>Include your API key in the <code>X-API-Key</code> header on every request:</p>
    <pre><code>curl -H "X-API-Key: ak_your_key" https://arivu.app/v1/papers/&lt;paper_id&gt;/graph</code></pre>

    <h2>Base URL</h2>
    <pre><code>https://arivu.app/v1/</code></pre>

    <h2>Rate Limits</h2>
    <table class="api-table">
      <tr><th>Tier</th><th>Requests/hour</th><th>Graphs/day</th></tr>
      <tr><td>Lab</td><td>10,000</td><td>100</td></tr>
      <tr><td>Developer</td><td>10,000</td><td>100</td></tr>
    </table>

    <h2>Endpoints</h2>

    <div class="api-endpoint">
      <span class="method get">GET</span>
      <code>/v1/papers/{paper_id}/graph</code>
      <p>Return the full citation graph JSON for a paper. The graph must be pre-built via the web interface.</p>
    </div>

    <div class="api-endpoint">
      <span class="method get">GET</span>
      <code>/v1/papers/{paper_id}/dna</code>
      <p>Return the Research DNA profile for a paper.</p>
    </div>

    <div class="api-endpoint">
      <span class="method get">GET</span>
      <code>/v1/papers/{paper_id}/score</code>
      <p>Return the living paper score and velocity (rising/stable/declining).</p>
    </div>

    <div class="api-endpoint">
      <span class="method post">POST</span>
      <code>/v1/papers/{paper_id}/prune</code>
      <p>Return the pruning result for removing a paper. Body: <code>{"remove_paper_id": "..."}</code></p>
    </div>

    <div class="api-endpoint">
      <span class="method get">GET</span>
      <code>/v1/papers/{paper_id}/gaps</code>
      <p>Return identified research gaps for a paper's graph.</p>
    </div>

    <div class="api-endpoint">
      <span class="method get">GET</span>
      <code>/v1/papers/{paper_id}/mutations</code>
      <p>Return edge mutation classifications (adoption/extension/synthesis/etc.).</p>
    </div>

    <div class="api-endpoint">
      <span class="method get">GET</span>
      <code>/v1/papers/search?q={query}&amp;limit={n}</code>
      <p>Search papers by title. Returns up to 50 results.</p>
    </div>

    <div class="api-endpoint">
      <span class="method get">GET</span>
      <code>/v1/fields/{field_name}/fingerprint</code>
      <p>Return the structural radar profile for a research field.</p>
    </div>

    <div class="api-endpoint">
      <span class="method post">POST</span>
      <code>/v1/subscriptions</code>
      <p>Subscribe to paper events via webhook. Body: <code>{"paper_id","webhook_url","events":["new_citation","paradigm_shift"],"secret":""}</code></p>
    </div>

    <div class="api-endpoint">
      <span class="method get">GET</span>
      <code>/v1/subscriptions</code>
      <p>List your active webhook subscriptions.</p>
    </div>

    <div class="api-endpoint">
      <span class="method delete">DELETE</span>
      <code>/v1/subscriptions/{subscription_id}</code>
      <p>Deactivate a webhook subscription.</p>
    </div>

    <h2>Webhook Events</h2>
    <p>All webhooks are signed with <code>X-Arivu-Signature: sha256=&lt;hmac&gt;</code>.
       Verify using your subscription secret against the raw request body.</p>
    <ul>
      <li><code>new_citation</code> — a new paper citing this one was detected</li>
      <li><code>paradigm_shift</code> — paradigm stability score crossed threshold</li>
      <li><code>orphan_detected</code> — a citation thread has gone silent</li>
      <li><code>gap_filled</code> — a research gap was addressed by new work</li>
      <li><code>retraction_alert</code> — a paper in the graph was flagged for retraction</li>
    </ul>

    <h2>Error Format</h2>
    <pre><code>{"error": "Description", "code": "machine_readable_code"}</code></pre>
  </div>
</div>
{% endblock %}
```

---

## §26 — mailer.py: Lab Invite + Email Change Emails

Add to `backend/mailer.py`:

```python
def send_lab_invite_email(to_email: str, lab_name: str, accept_url: str) -> bool:
    text = (
        f"Hello,\n\nYou've been invited to join '{lab_name}' on Arivu.\n\n"
        f"Accept the invitation: {accept_url}\n\n"
        f"This invite expires in 7 days.\n\n— The Arivu team"
    )
    html = f"""<!DOCTYPE html>
<html><body style="font-family:sans-serif;max-width:600px;margin:40px auto;color:#1a1a2e">
<h2 style="color:#D4A843">You're invited to join a lab on Arivu</h2>
<p><strong>{lab_name}</strong> has invited you to collaborate.</p>
<a href="{accept_url}" style="display:inline-block;padding:12px 24px;background:#D4A843;
  color:#0a0e17;text-decoration:none;border-radius:6px;font-weight:600;">Accept invitation</a>
<p style="font-size:13px;color:#64748B">This invite expires in 7 days.</p>
</body></html>"""
    return _send(to_email, f"You're invited to join '{lab_name}' on Arivu", text, html)


def send_email_change_verification(new_email: str, old_email: str, token: str) -> bool:
    link = f"https://{Config.CUSTOM_DOMAIN}/account/confirm-email-change?token={token}"
    text = (
        f"Hello,\n\nSomeone requested to change the Arivu account email from {old_email} "
        f"to this address.\n\nConfirm the change: {link}\n\n"
        f"This link expires in 1 hour. If you didn't request this, ignore this email.\n\n"
        f"— The Arivu team"
    )
    html = f"""<!DOCTYPE html>
<html><body style="font-family:sans-serif;max-width:600px;margin:40px auto;color:#1a1a2e">
<h2 style="color:#D4A843">Confirm email change</h2>
<p>Someone requested to change the Arivu account email from <strong>{old_email}</strong>
   to this address.</p>
<a href="{link}" style="display:inline-block;padding:12px 24px;background:#D4A843;
  color:#0a0e17;text-decoration:none;border-radius:6px;font-weight:600;">Confirm new email</a>
<p style="font-size:13px;color:#64748B">Link expires in 1 hour.</p>
</body></html>"""
    return _send(new_email, "Confirm your new Arivu email address", text, html)
```

---

## §27 — scripts/weekly_digest.py

*(Identical to v1. Reproduce §15 verbatim from PHASE_7.md v1.)*

---

## §28 — Email Change Backend Routes (backend/auth.py)

*(Identical to v1. Reproduce §8 verbatim from PHASE_7.md v1.)*

---

## §29 — login.html: Invite Token Preservation (NEW — GAP-P7-N12)

Add to `templates/auth/login.html`, inside the `{% block scripts %}` or at the end of `{% block content %}`:

```html
<!-- Preserve ?invite=<token> through the login flow -->
{% if request.args.get('invite') %}
<input type="hidden" id="pending-invite-token" value="{{ request.args.get('invite') | e }}">
{% endif %}

<script>
// After successful login, auto-accept the pending lab invite if token is present
const pendingInvite = document.getElementById('pending-invite-token')?.value;
if (pendingInvite) {
  // Store in sessionStorage so it survives the POST redirect
  sessionStorage.setItem('pending-lab-invite', pendingInvite);
}

// On page load: if logged in and a pending invite is stored, accept it
(async function() {
  const token = sessionStorage.getItem('pending-lab-invite');
  // Check if user is now logged in (simplest: presence of a user nav element)
  const isLoggedIn = document.querySelector('[data-user-id]') !== null;
  if (token && isLoggedIn) {
    sessionStorage.removeItem('pending-lab-invite');
    try {
      const resp = await fetch('/api/lab/accept', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        credentials: 'include',
        body: JSON.stringify({token}),
      });
      const data = await resp.json();
      if (data.success) {
        // Show success notice
        const banner = document.createElement('div');
        banner.className = 'invite-accepted-banner';
        banner.textContent = 'Lab invitation accepted! You now have lab access.';
        document.body.prepend(banner);
      }
    } catch (err) {
      console.warn('Invite accept failed:', err);
    }
  }
})();
</script>
```

Additionally, add to the existing login form's success handler (wherever the page redirects after login), ensure the `?invite=<token>` query param is forwarded through the POST to the login route so the redirect destination preserves it:

```python
# In backend/auth.py, login success handler:
next_url = request.args.get("next") or request.form.get("next") or "/"
invite   = request.args.get("invite") or request.form.get("invite")
if invite:
    # Redirect back to /login?invite=<token> so the JS can detect it
    # The JS above will auto-accept on the next page load
    pass  # invite token is preserved via sessionStorage on the client side
```

---

## §30 — Public REST API Backend (backend/public_api.py)

*(Reproduce v1 §7.1 verbatim but with these corrections:)*

At the top of `backend/public_api.py`, replace all `__import__` inline patterns:

```python
# Top of file — replace all inline imports:
import hashlib
import json
import logging
import secrets
from datetime import datetime, timezone
from functools import wraps

from flask import Blueprint, g, jsonify, request
import backend.db as db
from backend.config import Config

# In v1_create_subscription(), the secret line becomes:
secret = data.get("secret", "") or Config.WEBHOOK_SIGNING_SECRET or secrets.token_hex(16)
```

*(All other logic identical to v1 §7.1.)*

---

## §31 — tests/test_phase7.py

*(Reproduce v1 §16 verbatim, then add these new test classes:)*

```python
# ── PaperPositioningTool ──────────────────────────────────────────────────────

class TestPaperPositioningTool:
    def test_position_by_abstract_returns_structure(self):
        from backend.paper_positioning import PaperPositioningTool
        tool = PaperPositioningTool()
        with (patch("backend.paper_positioning.db.fetchall", return_value=[]),
              patch("backend.paper_positioning.LLMClient") as mock_llm):
            mock_llm.return_value.call_llm.return_value = (
                "FRAMING: Novel contribution.\n"
                "STATEMENT: This paper advances the field.\n"
                "VENUE1: NeurIPS | Major ML venue\n"
            )
            with patch("backend.paper_positioning.PaperPositioningTool._embed_text", return_value=None):
                result = tool.position_by_abstract("My Paper", "My abstract text.")
        d = result.to_dict()
        assert "intellectual_cluster" in d
        assert "comparators"          in d
        assert "positioning_statement" in d
        assert json.dumps(d)  # Must be serializable

    def test_position_fallback_on_no_embedding(self):
        from backend.paper_positioning import PaperPositioningTool
        tool = PaperPositioningTool()
        with (patch("backend.paper_positioning.PaperPositioningTool._embed_text", return_value=None),
              patch("backend.paper_positioning.LLMClient") as mock_llm):
            mock_llm.return_value.call_llm.return_value = "FRAMING: x\nSTATEMENT: y\n"
            result = tool.position_by_abstract("T", "A")
        assert result.comparators == []


# ── RewriteSuggester ──────────────────────────────────────────────────────────

class TestRewriteSuggester:
    def test_suggest_returns_structure(self):
        from backend.rewrite_suggester import RewriteSuggester
        suggester = RewriteSuggester()
        with patch("backend.rewrite_suggester.LLMClient") as mock_llm:
            mock_llm.return_value.call_llm.return_value = (
                "CRITIQUE: Lists papers without narrative.\n"
                "ARC: Traces field evolution.\n"
                "REWRITE:\nImproved related work section.\n"
                "PRINCIPLE1: Narrative over listing | Applied well\n"
            )
            result = suggester.suggest("Prior work: Smith (2020) did X. Jones (2021) did Y.", "My Paper")
        d = result.to_dict()
        assert "original_critique"  in d
        assert "suggested_rewrite"  in d
        assert "narrative_arc"      in d
        assert "principles_applied" in d
        assert json.dumps(d)

    def test_empty_input_returns_gracefully(self):
        from backend.rewrite_suggester import RewriteSuggester
        result = RewriteSuggester().suggest("", "")
        assert result.original_critique == "No text provided."
        assert result.suggested_rewrite == ""


# ── TimeMachine Caching ───────────────────────────────────────────────────────

class TestTimeMachineCaching:
    def test_build_timeline_uses_cache(self):
        """If cache hit, should not recompute."""
        from backend.time_machine import TimeMachineEngine
        cached_result = {"min_year": 2010, "max_year": 2020, "slices": {}}
        engine = TimeMachineEngine()
        with patch("backend.time_machine.db.fetchone",
                   return_value={"result_json": cached_result}):
            graph = {"metadata": {"graph_id": "test-id"}, "nodes": [], "edges": []}
            result = engine.build_timeline(graph)
        assert result == cached_result

    def test_extinction_detector_called_once(self):
        """GAP-P7-N6: detect() must be called exactly once, not per-year."""
        from backend.time_machine import TimeMachineEngine
        engine = TimeMachineEngine()
        call_count = {"n": 0}
        original_detect = None

        def counting_detect(graph_json):
            call_count["n"] += 1
            return []

        graph = {
            "metadata": {"graph_id": ""},
            "nodes": [
                {"id": f"p{i}", "year": 2010 + i, "citation_count": 10, "fields_of_study": ["CS"]}
                for i in range(5)
            ],
            "edges": [],
        }
        with (patch("backend.time_machine.ExtinctionEventDetector") as mock_det,
              patch("backend.time_machine.VocabularyEvolutionTracker") as mock_vt):
            mock_det.return_value.detect.side_effect = counting_detect
            mock_vt.return_value.build_heatmap_cached.return_value = {}
            engine._compute_timeline(graph)
        # detect() should be called at most twice (once for slice loop, once for all_events)
        # With the fix, it should be called exactly ONCE before the loop
        assert mock_det.return_value.detect.call_count == 1, (
            f"Expected 1 call, got {mock_det.return_value.detect.call_count}. "
            "GAP-P7-N6 fix not applied."
        )


# ── Shared Graph Security ─────────────────────────────────────────────────────

class TestSharedGraphSecurity:
    @pytest.fixture
    def client(self):
        from app import create_app
        app = create_app()
        app.config["TESTING"] = True
        with app.test_client() as c:
            yield c

    def test_api_graph_by_id_requires_valid_share(self, client):
        """Random graph_id with no share entry must return 404."""
        with patch("app.db.fetchone", return_value=None):
            resp = client.get("/api/graph/nonexistent-graph-id")
        assert resp.status_code == 404

    def test_api_graph_by_id_allows_valid_share(self, client):
        """Graph with active share entry must be accessible."""
        def mock_fetchone(query, params=None):
            if "shared_graphs" in query:
                return {"graph_id": "test-graph"}
            if "graph_json_url" in query:
                return {"graph_json_url": "r2://test/graph.json"}
            return None

        with (patch("app.db.fetchone", side_effect=mock_fetchone),
              patch("app.R2Client") as mock_r2):
            mock_r2.return_value.download_json.return_value = {"nodes": [], "edges": {}}
            resp = client.get("/api/graph/test-graph")
        assert resp.status_code == 200
```

---

## §32 — CONTEXT.md Update Format [GAP-P7-24]

The current `CONTEXT.md` file follows this format (update accordingly):

```markdown
# Arivu — Development Context

## Phase Status
- Phase 1: Completed
- Phase 2: Completed
- Phase 3: Completed
- Phase 4: Completed
- Phase 5: Completed
- Phase 6: Completed
- Phase 7: Completed   ← Move from "In Progress" to "Completed"

## Live URLs
- Production: https://arivu.app
- NLP Worker: https://arivu-nlp.hf.space
- /v1/ API Base: https://arivu.app/v1/        ← Add this line

## Key Architectural Decisions
[...existing entries...]

## Phase 7 Notes
- Webhook signing secret rotation policy: every 90 days (WEBHOOK_SIGNING_SECRET in Koyeb)
- Koyeb weekly digest schedule: 0 8 * * 1 (Monday 08:00 UTC)
- Developer tier Stripe Price ID: stored as STRIPE_DEVELOPER_PRICE_ID
- Time Machine results cached in time_machine_cache table (7-day TTL)
- Vocabulary snapshots cached in vocabulary_snapshots table (per-year, per-graph)
```

---

## §33 — CLAUDE.md Content [GAP-P7-23]

`CLAUDE.md` must exist at the project root. Create it if it doesn't exist. It contains the architecture non-negotiables Claude Code must never violate:

```markdown
# CLAUDE.md — Arivu Architecture Non-Negotiables

Read this before every session. These rules are absolute.

## 1. ML Library Ban on Main Server
The Koyeb main server (Flask app) may NEVER import:
- sentence_transformers
- torch
- transformers
- Any model inference library

Reason: Koyeb free tier has insufficient RAM. All embedding work goes through the NLP worker.

## 2. Intelligence Pipeline
- Pre-computed embeddings: read from paper_embeddings via pgvector
- New embeddings: POST to Config.NLP_WORKER_URL/encode_batch
- LLM reasoning: use backend/llm_client.py (Groq)
- Never call NLP worker or LLM in a synchronous request if the caller expects <200ms response

## 3. Database
- PostgreSQL on Neon.tech only. SQLite is permanently ruled out.
- Use backend/db.py helpers: db.fetchone(), db.fetchall(), db.execute(), db.execute_returning()
- Never use raw psycopg2 directly in routes — always go through backend/db.py

## 4. File Uploads
- SecureFileUploadHandler MUST validate all uploads (4-layer: size, magic bytes, MIME, content scan)
- Maximum file size: Config.MAX_UPLOAD_MB (default 10MB)
- Store files in R2 only — never on local filesystem

## 5. Background Work
- Webhook deliveries: always background threads (WebhookManager.trigger_event)
- Never block a request cycle waiting for external HTTP calls
- Long operations (graph build): SSE streaming via /api/graph/stream

## 6. Auth & Sessions
- Session system: PostgreSQL sessions table. Not Flask-Login, not JWT.
- All premium routes: @require_auth + @require_tier("researcher"|"lab"|"developer")
- Tier order: free < researcher < developer < lab (TIER_ORDER in decorators.py)
- ENABLE_AUTH env var gates auth in production

## 7. R2 Storage
- All large data (graph JSON, PDF reports): Cloudflare R2
- Use backend/r2_client.py. Canonical env vars: R2_BUCKET, R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY
- Key format: graphs/{graph_id}/graph.json

## 8. Code Style
- No __import__() inline — use top-of-file imports
- No hardcoded URLs — use Config.CUSTOM_DOMAIN
- No hardcoded tier strings outside decorators.py — use TIER_ORDER
- All new modules: stateless classes, instantiate fresh per request

## 9. Environment Variables
- Never commit .env or any file with real API keys
- Never set FLASK_DEBUG=true in Koyeb
- All new env vars must be in .env.example

## 10. Deployment
- Main app: Koyeb (Flask/Gunicorn)
- NLP worker: HuggingFace Spaces (FastAPI)
- DB: Neon.tech (PostgreSQL + pgvector)
- Storage: Cloudflare R2
- CDN/DNS: Cloudflare
```

---

## §34 — Common Failure Modes

### Time Machine returns empty for some years
Papers with `year=NULL` are excluded from slices. Check graph `coverage_score`.

### ExtinctionEventDetector slow on large graphs
If Time Machine is slow, confirm the GAP-P7-N6 fix is applied: `detect()` must be called once before the year loop, not inside it.

### Time Machine always recomputes (no cache hit)
`time_machine_cache` requires `graph_id` in `graph_json.metadata`. Verify `_on_graph_complete()` in `graph_engine.py` sets `metadata.graph_id`.

### Vocabulary snapshots not persisting
`build_heatmap_cached()` requires a non-empty `graph_id`. If `graph_id = ""`, falls back to uncached `build_heatmap()` — this is intentional for anonymous graphs.

### CounterfactualEngine pgvector query fails
Ensure `publication_date` column exists on `papers` table (added by Phase 7 migration). The contingency score computation fails gracefully (returns 0.5) if embedding isn't found.

### Adversarial Reviewer: `python-magic` MagicException
Requires `libmagic1` system library. Dockerfile must include `libmagic1`.

### Adversarial Reviewer: PDF extraction fails silently
Requires `pymupdf` (`fitz`). If `import fitz` fails, review falls back to abstract-only. Confirm `pymupdf==1.24.5` is in `requirements.txt` and `libmupdf-dev` is in Dockerfile.

### Adversarial Reviewer: PDF report not generated
`_generate_and_store_report()` requires `ExportGenerator.generate_pdf()` to accept a dict with a `"type": "adversarial_review"` key. Verify ExportGenerator supports this. If not, add the handler to `export_generator.py`.

### Webhook HMAC mismatch on receiver
The receiver must use raw request body bytes — not re-serialized JSON — to verify the HMAC signature.

### Shared graph shows "This graph is no longer available"
The `/api/graph/<graph_id>` route (§9.3) requires either the requesting user to own the graph OR a valid `shared_graphs` entry to exist. Check that `create_share_link()` succeeded and the token was stored.

### Lab invite: invite accepted by wrong user
`accept_invite()` verifies the accepting user's email matches `invitee_email`. Correct flow: invite email → user registers with that exact email → accepts invite.

### Lab invite: token lost after login redirect
Confirm `login.html` (§29) contains the `sessionStorage` persistence code for the `?invite=<token>` parameter.

### Constellation/Geological/River views blank on load
These views depend on `window.arivuGraph` and `graphData` being set before `ViewSwitcher` is initialized. Ensure the `arivu-graph-ready` event is dispatched after graph load.

### Email change confirmation logs user out
By design: after email change, all sessions are invalidated. Redirect is to `/login?email_changed=1`. Login page can detect this parameter and show a success message before the form.

### Supervisor dashboard shows no member activity
The `lab_memberships.joined_at` column must exist (verified in §0.4). If Phase 6 used `created_at`, the rename migration in §0.4 must be applied.

---

## §35 — Koyeb Scheduled Jobs (Phase 7 Additions)

| Job | Command | Schedule | Purpose |
|-----|---------|----------|---------|
| Weekly digest | `python scripts/weekly_digest.py` | `0 8 * * 1` | Supervisor digest every Monday 08:00 UTC |

*(Nightly maintenance cron from Phase 6 continues unchanged at `0 2 * * *.`)*

---

## §36 — Done When

Phase 7 is complete when ALL of the following are true:

1. **All tests pass:**
   ```bash
   python -m pytest tests/ -v
   # 0 failed (smoke + phase2 + ... + phase6 + phase7)
   ```

2. **Phase 7 migration ran:**
   ```bash
   python scripts/migrate_phase7.py
   psql $DATABASE_URL -c "\dt" | grep -E "shared_graphs|vocabulary_snapshots|time_machine_cache|webhook_subscriptions|adversarial_reviews"
   ```

3. **Time Machine loads for a graph:**
   ```bash
   curl -b "arivu_session=<cookie>" "https://arivu.app/api/time-machine/<seed_id>"
   # Returns {min_year, max_year, slices, vocabulary_heatmap, ...}
   ```

4. **Counterfactual analysis works:**
   ```bash
   curl -b "arivu_session=<cookie>" "https://arivu.app/api/counterfactual/<paper_id>"
   # Returns four-tier analysis dict
   ```

5. **Citation generator works:**
   ```bash
   curl -b "..." -X POST -H "Content-Type: application/json" \
     -d '{"paper_ids":["<id>"],"all_styles":true}' \
     "https://arivu.app/api/citation-generator"
   # Returns {"citations": {"<id>": {"apa": "...", "mla": "...", ...}}}
   ```

6. **Paper Positioning works:**
   ```bash
   curl -b "..." -X POST -H "Content-Type: application/json" \
     -d '{"title":"Test","abstract":"This paper proposes..."}' \
     "https://arivu.app/api/paper-positioning"
   # Returns {intellectual_cluster, comparators, positioning_statement, venue_recommendations}
   ```

7. **Rewrite Suggester works:**
   ```bash
   curl -b "..." -X POST -H "Content-Type: application/json" \
     -d '{"related_work_text":"Smith (2020) did X. Jones (2021) did Y."}' \
     "https://arivu.app/api/rewrite-suggester"
   # Returns {original_critique, suggested_rewrite, narrative_arc, principles_applied}
   ```

8. **Public API authenticated:**
   ```bash
   curl -H "X-API-Key: ak_<your_key>" "https://arivu.app/v1/papers/<id>/graph"
   # 200 with graph JSON (or 404 if graph not built yet)
   ```

9. **Shareable link works:**
   ```bash
   curl "https://arivu.app/share/<token>"
   # 200 — no auth cookie required
   ```

10. **Lab invite flow completes end-to-end:**
    - POST `/api/lab/invite` → invite email received
    - GET `/lab/accept?token=<t>` → redirect to `/login?invite=<t>`
    - Login → sessionStorage preserves token → POST `/api/lab/accept` → `{"success": true}`
    - GET `/api/lab/members` → member appears

11. **View mode switcher renders all 5 modes** without JS errors (force, constellation, geological, river, timeline).

12. **Adversarial Reviewer processes a PDF:**
    - POST `/api/adversarial-review` with PDF file → `{"result": {...}}`
    - Result contains all 6 analysis categories.
    - `adversarial_reviews.report_r2_key` is populated.

13. **Weekly digest job runs:**
    ```bash
    python scripts/weekly_digest.py
    # Logs completion without errors
    ```

14. **CONTEXT.md updated**, Phase 7 under "Completed", `/v1/` base URL recorded.

15. **Two git commits on `main`:**
    - `[phase7] time machine, visualization modes, workflow tools, public API, lab members, shareable links`
    - `[context] Phase 7 complete — temporal intelligence, workflow tools, public REST API live`

---

## What NOT To Do in Phase 7

- Do NOT implement Researcher Identity Profiles (F3.1) — Phase 8+. `researcher_profiles` table is NOT in the migration.
- Do NOT implement the Prediction Market — Phase 8+
- Do NOT implement the Collaboration Finder community version (F8.4) — Phase 8+
- Do NOT implement the Lab Genealogy System (F3.4) — Phase 8+
- Do NOT implement the Mental Model Mapper (F3.3) — Phase 8+
- Do NOT implement the Science Policy Brief Generator (F11.8) — Phase 8+
- Do NOT implement the Conference Intelligence Layer (F11.10) — Phase 8+
- Do NOT implement Live Mode (F8.1) — Phase 8+
- Do NOT implement Collaborative Graph Annotation (F8.2) — Phase 8+
- Do NOT implement the Interdisciplinary Translation Service (F8.3) — Phase 8+
- Do NOT implement Field Entry Kit (F4.7) composite document generation — Phase 8+. Remove `backend/field_entry_kit.py` from your file list — it is not a Phase 7 deliverable.
- Do NOT implement D3 animated counterfactual graph rendering — text analysis only in Phase 7; D3 animation is Phase 8+
- Do NOT implement full 3D WebGL for Geological or River views — 2D D3.js approximations only in Phase 7
- Do NOT process webhook deliveries synchronously in the request cycle — always use background threads
- Do NOT add `pyahocorasick` to requirements — it is not used in Phase 7
- Do NOT commit `.env` or any file with real API keys
- Do NOT set `FLASK_DEBUG=true` in Koyeb
