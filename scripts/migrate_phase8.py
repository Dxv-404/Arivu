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
-- ── graphs table: ensure graph_id TEXT column exists (GAP-P8-51/67) ──────────
-- Note: graph_id is already the PK in our schema (Phase 1 migrate.py).
-- This ADD COLUMN is a no-op safety net for any schema variation.
ALTER TABLE graphs ADD COLUMN IF NOT EXISTS graph_id TEXT;

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
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'graph_memory' AND table_schema = 'public') THEN
        ALTER TABLE graph_memory RENAME TO graph_memory_legacy;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS graph_memory_state (
    id                  SERIAL      PRIMARY KEY,
    user_id             UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    graph_id            TEXT        NOT NULL,
    seen_paper_ids      TEXT[]      NOT NULL DEFAULT '{}',
    flagged_edges       TEXT[]      NOT NULL DEFAULT '{}',
    expanded_edges      TEXT[]      NOT NULL DEFAULT '{}',
    pruning_history     JSONB       NOT NULL DEFAULT '[]',
    navigation_path     JSONB       NOT NULL DEFAULT '[]',
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
    flagged_by_users TEXT[]      NOT NULL DEFAULT '{}',
    last_flagged_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    review_required  BOOLEAN     NOT NULL DEFAULT FALSE,
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
    error_message     TEXT,
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
