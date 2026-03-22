#!/usr/bin/env python3
"""
migrate.py — Apply the full Arivu PostgreSQL schema.

Usage:
    python scripts/migrate.py

Reads DATABASE_URL from .env (or environment).
Safe to run multiple times — all DDL uses IF NOT EXISTS.
Exits 0 on success, 1 on failure.

TABLE COUNT: Creates exactly 17 tables. The Done When criteria in PHASE_1.md
verifies this. If you add a table, update REQUIRED_TABLES below.

CORRECT TABLE NAMES — three names were wrong in earlier drafts:
  edge_analysis      (NOT edge_analysis_cache)
  edge_feedback      (NOT edge_flags)
  retraction_watch   (NOT retractions)
"""
import os
import sys
from pathlib import Path


def main() -> None:
    sys.path.insert(0, str(Path(__file__).parent.parent))

    try:
        from dotenv import load_dotenv
        load_dotenv(Path(__file__).parent.parent / ".env")
    except ImportError:
        pass

    import psycopg2

    DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
    if not DATABASE_URL:
        print(
            "ERROR: DATABASE_URL is not set.\n"
            "Copy .env.example to .env and fill in DATABASE_URL.",
            file=sys.stderr,
        )
        sys.exit(1)

    if "sslmode" not in DATABASE_URL:
        sep = "&" if "?" in DATABASE_URL else "?"
        DATABASE_URL = f"{DATABASE_URL}{sep}sslmode=require"

    print("Connecting to database...")
    try:
        conn = psycopg2.connect(DATABASE_URL)
        conn.autocommit = True
    except Exception as exc:
        print(f"ERROR: Could not connect: {exc}", file=sys.stderr)
        sys.exit(1)

    print("Applying schema...")
    try:
        with conn.cursor() as cur:
            cur.execute(MIGRATION_SQL)
        print("Schema applied.")
    except Exception as exc:
        print(f"ERROR: Migration failed: {exc}", file=sys.stderr)
        conn.close()
        sys.exit(1)

    print("Verifying tables...")
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema = 'public'"
            )
            existing = {row[0] for row in cur.fetchall()}
    except Exception as exc:
        print(f"ERROR: Verification failed: {exc}", file=sys.stderr)
        conn.close()
        sys.exit(1)

    missing = REQUIRED_TABLES - existing
    if missing:
        print(
            f"ERROR: Missing tables after migration: {sorted(missing)}\n"
            "This should not happen — check MIGRATION_SQL.",
            file=sys.stderr,
        )
        conn.close()
        sys.exit(1)

    conn.close()
    print(f"Verified {len(REQUIRED_TABLES)} required tables exist.")
    print("Migration complete. Ready to run smoke tests.")


# ---------------------------------------------------------------------------
# Correct table names (three names were wrong in earlier spec drafts):
#   edge_analysis      NOT edge_analysis_cache
#   edge_feedback      NOT edge_flags
#   retraction_watch   NOT retractions

REQUIRED_TABLES = {
    "papers",
    "paper_embeddings",
    "edge_analysis",
    "graphs",
    "build_jobs",
    "job_events",
    "sessions",
    "session_graphs",
    "users",
    "action_log",
    "edge_feedback",
    "llm_cache",
    "genealogy_cache",
    "retraction_watch",
    "chat_history",
    "insight_cache",
    "background_jobs",
    "pathfinder_prompts",
}

# ---------------------------------------------------------------------------

MIGRATION_SQL = """
CREATE EXTENSION IF NOT EXISTS vector;   -- pgvector: 384-dim (all-MiniLM-L6-v2)
CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- fuzzy title search

-- Papers (canonical record - all sources merged)
CREATE TABLE IF NOT EXISTS papers (
    paper_id                  TEXT      PRIMARY KEY,
    canonical_id              TEXT,
    source_ids                JSONB     DEFAULT '{}',
    title                     TEXT      NOT NULL,
    authors                   JSONB     DEFAULT '[]',
    year                      INTEGER,
    venue                     TEXT,
    doi                       TEXT,
    language                  TEXT      DEFAULT 'en',
    is_retracted              BOOLEAN   DEFAULT FALSE,
    retraction_reason         TEXT,
    pubpeer_flags             JSONB     DEFAULT '[]',
    fields_of_study           JSONB     DEFAULT '[]',
    concepts                  JSONB     DEFAULT '[]',
    funding                   JSONB     DEFAULT '{}',
    citation_count            INTEGER   DEFAULT 0,
    reference_ids             JSONB     DEFAULT '[]',
    abstract                  TEXT,
    abstract_source           TEXT,
    url                       TEXT,
    text_tier                 INTEGER   DEFAULT 4,
    data_completeness         FLOAT     DEFAULT 0.0,
    sources_queried           JSONB     DEFAULT '[]',
    citation_count_updated_at TIMESTAMP,
    abstract_updated_at       TIMESTAMP,
    references_updated_at     TIMESTAMP,
    full_text_updated_at      TIMESTAMP,
    created_at                TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_papers_doi       ON papers(doi);
CREATE INDEX IF NOT EXISTS idx_papers_year      ON papers(year);
CREATE INDEX IF NOT EXISTS idx_papers_citations ON papers(citation_count DESC);
CREATE INDEX IF NOT EXISTS idx_papers_created   ON papers(created_at);
CREATE INDEX IF NOT EXISTS idx_papers_title_gin ON papers
    USING GIN(to_tsvector('english', title));

-- Paper embeddings (pgvector)
-- Dimension 384 = all-MiniLM-L6-v2 output. If model changes to 768-dim,
-- this column must be recreated (DROP + ADD). Update models.py comment too.
CREATE TABLE IF NOT EXISTS paper_embeddings (
    paper_id      TEXT      PRIMARY KEY REFERENCES papers(paper_id),
    embedding     vector(384),
    model_version TEXT      DEFAULT '1.0.0',
    computed_at   TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_paper_embeddings_vec
    ON paper_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Edge analysis - NLP pipeline output cache
-- CORRECT NAME: edge_analysis (NOT edge_analysis_cache)
CREATE TABLE IF NOT EXISTS edge_analysis (
    edge_id             TEXT      PRIMARY KEY,
    citing_paper_id     TEXT      REFERENCES papers(paper_id),
    cited_paper_id      TEXT      REFERENCES papers(paper_id),
    similarity_score    FLOAT,
    citing_sentence     TEXT,
    cited_sentence      TEXT,
    citing_text_source  TEXT,
    cited_text_source   TEXT,
    comparable          BOOLEAN   DEFAULT TRUE,
    mutation_type       TEXT,
    mutation_confidence FLOAT,
    mutation_evidence   TEXT,
    citation_intent     TEXT,
    base_confidence     FLOAT,
    signals_used        JSONB     DEFAULT '[]',
    llm_classified      BOOLEAN   DEFAULT FALSE,
    flagged_by_users    INTEGER   DEFAULT 0,
    model_version       TEXT      DEFAULT '1.0.0',
    computed_at         TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_edge_citing ON edge_analysis(citing_paper_id);
CREATE INDEX IF NOT EXISTS idx_edge_cited  ON edge_analysis(cited_paper_id);

-- Graphs (metadata only - full JSON stored in R2)
-- graph_id is TEXT assigned by the app, not SERIAL.
-- Cache TTL uses last_accessed NOT created_at (see DECISIONS.md #10).
-- No FK on session_id: use session_graphs join table instead (DECISIONS.md #13).
CREATE TABLE IF NOT EXISTS graphs (
    graph_id           TEXT      PRIMARY KEY,
    seed_paper_id      TEXT      REFERENCES papers(paper_id),
    graph_json_url     TEXT,
    node_count         INTEGER,
    edge_count         INTEGER,
    max_depth          INTEGER   DEFAULT 2,
    coverage_score     FLOAT,
    coverage_report    JSONB,
    model_version      TEXT      DEFAULT '1.0.0',
    build_time_seconds FLOAT,
    created_at         TIMESTAMP DEFAULT NOW(),
    last_accessed      TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_graphs_seed     ON graphs(seed_paper_id);
CREATE INDEX IF NOT EXISTS idx_graphs_accessed ON graphs(last_accessed);

-- Build jobs (for SSE progress streaming)
CREATE TABLE IF NOT EXISTS build_jobs (
    job_id       UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
    paper_id     TEXT,
    session_id   TEXT,
    status       TEXT      DEFAULT 'pending',
    created_at   TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);

-- Job events (one row per SSE event emitted)
CREATE TABLE IF NOT EXISTS job_events (
    id         SERIAL    PRIMARY KEY,
    job_id     UUID      REFERENCES build_jobs(job_id),
    sequence   INTEGER,
    event_data JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_job_events_job ON job_events(job_id, id);

-- Sessions (anonymous)
CREATE TABLE IF NOT EXISTS sessions (
    session_id   TEXT      PRIMARY KEY,
    created_at   TIMESTAMP DEFAULT NOW(),
    last_seen    TIMESTAMP DEFAULT NOW(),
    persona      TEXT      DEFAULT 'explorer',
    graph_memory JSONB     DEFAULT '{}'
);

-- Session-to-graph mapping
-- Anonymous sessions can view graphs without a FK on graphs.session_id.
CREATE TABLE IF NOT EXISTS session_graphs (
    session_id TEXT      NOT NULL,
    graph_id   TEXT      NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (session_id, graph_id)
);
CREATE INDEX IF NOT EXISTS idx_session_graphs_session
    ON session_graphs(session_id, created_at DESC);

-- Users (authenticated accounts - future use, created now to avoid future migrations)
CREATE TABLE IF NOT EXISTS users (
    user_id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email                      TEXT        UNIQUE NOT NULL,
    email_verified             BOOLEAN     DEFAULT FALSE,
    password_hash              TEXT        NOT NULL,
    created_at                 TIMESTAMPTZ DEFAULT NOW(),
    last_login_at              TIMESTAMPTZ,
    display_name               TEXT,
    institution                TEXT,
    role                       TEXT,
    tier                       TEXT        DEFAULT 'free',
    tier_expires_at            TIMESTAMPTZ,
    stripe_customer_id         TEXT,
    graphs_this_month          INTEGER     DEFAULT 0,
    usage_reset_at             TIMESTAMPTZ DEFAULT DATE_TRUNC('month', NOW()) + INTERVAL '1 month',
    marketing_consent          BOOLEAN     DEFAULT FALSE,
    data_processing_consent    BOOLEAN     NOT NULL DEFAULT TRUE,
    gdpr_deletion_requested_at TIMESTAMPTZ
);

-- Action log (per-session behaviour tracking)
CREATE TABLE IF NOT EXISTS action_log (
    id          SERIAL    PRIMARY KEY,
    session_id  TEXT,
    action_type TEXT      NOT NULL,
    action_data JSONB     DEFAULT '{}',
    timestamp   TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_action_log_session ON action_log(session_id, timestamp);

-- Edge feedback (user disagreements with NLP classifications)
-- CORRECT NAME: edge_feedback (NOT edge_flags)
CREATE TABLE IF NOT EXISTS edge_feedback (
    id              SERIAL    PRIMARY KEY,
    edge_id         TEXT      NOT NULL,
    session_id      TEXT,
    feedback_type   TEXT,
    feedback_detail TEXT,
    timestamp       TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_edge_feedback_edge ON edge_feedback(edge_id, feedback_type);

-- LLM response cache
-- Key = SHA256(model + ":" + system_prompt + ":" + user_prompt). TTL = 30 days.
CREATE TABLE IF NOT EXISTS llm_cache (
    cache_key   TEXT      PRIMARY KEY,
    prompt_hash TEXT      NOT NULL,
    response    TEXT      NOT NULL,
    model       TEXT      NOT NULL,
    created_at  TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_llm_cache_created ON llm_cache(created_at);

-- Genealogy story cache (per seed paper)
CREATE TABLE IF NOT EXISTS genealogy_cache (
    paper_id    TEXT      PRIMARY KEY,
    story_json  JSONB     NOT NULL,
    computed_at TIMESTAMP DEFAULT NOW()
);

-- Retraction Watch data
-- CORRECT NAME: retraction_watch (NOT retractions)
-- Loaded by scripts/load_retraction_watch.py
CREATE TABLE IF NOT EXISTS retraction_watch (
    doi             TEXT PRIMARY KEY,
    paper_id        TEXT,
    title           TEXT,
    reason          TEXT,
    retraction_date DATE
);

-- AI guide chat history (server-side only - never from client payload)
CREATE TABLE IF NOT EXISTS chat_history (
    id         SERIAL    PRIMARY KEY,
    session_id TEXT      NOT NULL,
    role       TEXT      NOT NULL CHECK (role IN ('user', 'assistant')),
    content    TEXT      NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_history(session_id, id);

-- Per-paper proactive insight cache
CREATE TABLE IF NOT EXISTS insight_cache (
    paper_id   TEXT      PRIMARY KEY,
    insights   JSONB     NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Background jobs (GDPR export, account deletion, etc.)
CREATE TABLE IF NOT EXISTS background_jobs (
    job_id       TEXT      PRIMARY KEY,
    job_type     TEXT      NOT NULL,
    params       JSONB     DEFAULT '{}',
    status       TEXT      DEFAULT 'pending',
    created_at   TIMESTAMP DEFAULT NOW(),
    started_at   TIMESTAMP,
    completed_at TIMESTAMP,
    error        TEXT,
    result_url   TEXT
);
CREATE INDEX IF NOT EXISTS idx_bg_jobs_status  ON background_jobs(status);
CREATE INDEX IF NOT EXISTS idx_bg_jobs_created ON background_jobs(created_at);

-- ═══════════════════════════════════════════════════════════════════════════════
-- Phase 3 additions: ALTER TABLE for graphs columns + insights + insight_feedback tables
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE graphs ADD COLUMN IF NOT EXISTS leaderboard_json JSONB;
ALTER TABLE graphs ADD COLUMN IF NOT EXISTS dna_json JSONB;
ALTER TABLE graphs ADD COLUMN IF NOT EXISTS diversity_json JSONB;
ALTER TABLE graphs ADD COLUMN IF NOT EXISTS computed_at TIMESTAMP DEFAULT NOW();
ALTER TABLE graphs ADD COLUMN IF NOT EXISTS intel_json JSONB;

CREATE TABLE IF NOT EXISTS insights (
    insight_id   SERIAL PRIMARY KEY,
    paper_id     TEXT NOT NULL,
    insight_type TEXT NOT NULL,
    content      TEXT NOT NULL,
    upvotes      INT DEFAULT 0,
    downvotes    INT DEFAULT 0,
    created_at   TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_insights_paper_id ON insights(paper_id);

CREATE TABLE IF NOT EXISTS insight_feedback (
    id           SERIAL    PRIMARY KEY,
    insight_id   INTEGER   NOT NULL,
    session_id   TEXT,
    feedback     TEXT      CHECK (feedback IN ('helpful', 'not_helpful')),
    created_at   TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_insight_feedback_insight ON insight_feedback(insight_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- Phase 4 backport §0.7: Fix insight_cache column name + insight_feedback schema
-- ═══════════════════════════════════════════════════════════════════════════════

-- insight_cache: rename 'insights' column to 'insights_json' if old name exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='insight_cache' AND column_name='insights'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='insight_cache' AND column_name='insights_json'
    ) THEN
        ALTER TABLE insight_cache RENAME COLUMN insights TO insights_json;
    END IF;
END $$;

-- Add index on insight_cache.paper_id if not exists
CREATE INDEX IF NOT EXISTS idx_insight_cache_paper ON insight_cache(paper_id);

-- insight_feedback: TEXT insight_id (no FK — client supplies arbitrary string IDs)
-- Drop old version if it exists with wrong schema (INT FK to insights table)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='insight_feedback' AND column_name='insight_id'
        AND data_type='integer'
    ) THEN
        DROP TABLE IF EXISTS insight_feedback CASCADE;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS insight_feedback (
    id           SERIAL      PRIMARY KEY,
    session_id   TEXT,
    insight_id   TEXT        NOT NULL,
    feedback     TEXT        NOT NULL CHECK(feedback IN ('helpful','not_helpful')),
    timestamp    TIMESTAMP   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_insight_fb_insight ON insight_feedback(insight_id);

-- genealogy_cache (should exist from Phase 1; ensure it does)
CREATE TABLE IF NOT EXISTS genealogy_cache (
    paper_id    TEXT        PRIMARY KEY,
    story_json  JSONB,
    computed_at TIMESTAMP   DEFAULT NOW()
);

-- session_graphs (should exist from Phase 1; ensure it does)
CREATE TABLE IF NOT EXISTS session_graphs (
    session_id  TEXT        NOT NULL,
    graph_id    TEXT        NOT NULL,
    created_at  TIMESTAMP   NOT NULL DEFAULT NOW(),
    PRIMARY KEY (session_id, graph_id)
);
CREATE INDEX IF NOT EXISTS idx_sgs_session
    ON session_graphs(session_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════════
-- Pathfinder prompts (research position analysis + conversation history)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS pathfinder_prompts (
    id              SERIAL      PRIMARY KEY,
    session_id      TEXT        NOT NULL,
    graph_id        TEXT        NOT NULL,
    prompt          TEXT        NOT NULL,
    prompt_type     TEXT        DEFAULT 'unknown',
    classification  TEXT        DEFAULT 'valid',
    output_json     JSONB,
    similar_papers  JSONB,
    model_used      TEXT,
    energy_cost     INTEGER     DEFAULT 1,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pf_session_graph ON pathfinder_prompts(session_id, graph_id);
CREATE INDEX IF NOT EXISTS idx_pf_created ON pathfinder_prompts(created_at DESC);

-- Pathfinder schema additions (embedding column for semantic dedup)
ALTER TABLE pathfinder_prompts ADD COLUMN IF NOT EXISTS embedding vector(384);
ALTER TABLE pathfinder_prompts ADD COLUMN IF NOT EXISTS seed_paper_title TEXT;
"""


if __name__ == "__main__":
    main()
