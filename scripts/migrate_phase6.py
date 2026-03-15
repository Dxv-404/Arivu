#!/usr/bin/env python3
"""
scripts/migrate_phase6.py
Phase 6 DB schema additions. Safe to re-run (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
Usage: python scripts/migrate_phase6.py
"""
import sys
import os
import logging
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

PHASE_6_SQL = """
-- ── Users table ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    user_id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email               TEXT        UNIQUE NOT NULL,
    email_verified      BOOLEAN     NOT NULL DEFAULT FALSE,
    password_hash       TEXT        NOT NULL,
    display_name        TEXT,
    institution         TEXT,
    role                TEXT        DEFAULT 'researcher',
    tier                TEXT        NOT NULL DEFAULT 'free'
                        CHECK(tier IN ('free', 'researcher', 'lab')),
    tier_expires_at     TIMESTAMPTZ,
    stripe_customer_id  TEXT        UNIQUE,
    graphs_this_month   INT         NOT NULL DEFAULT 0,
    usage_reset_at      TIMESTAMPTZ NOT NULL
                        DEFAULT DATE_TRUNC('month', NOW()) + INTERVAL '1 month',
    failed_login_count  INT         NOT NULL DEFAULT 0,
    locked_until        TIMESTAMPTZ,
    last_login_at       TIMESTAMPTZ,
    marketing_consent           BOOLEAN NOT NULL DEFAULT FALSE,
    data_processing_consent     BOOLEAN NOT NULL DEFAULT TRUE,
    gdpr_deletion_requested_at  TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_email        ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_stripe       ON users(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_users_tier         ON users(tier);
CREATE INDEX IF NOT EXISTS idx_users_gdpr_pending ON users(gdpr_deletion_requested_at)
    WHERE gdpr_deletion_requested_at IS NOT NULL;

-- ── Email verification tokens ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_verification_tokens (
    token_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    token       TEXT        UNIQUE NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
    used_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_evtokens_user    ON email_verification_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_evtokens_token   ON email_verification_tokens(token);
CREATE INDEX IF NOT EXISTS idx_evtokens_expires ON email_verification_tokens(expires_at);

-- ── Password reset tokens ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    token_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    token       TEXT        UNIQUE NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '1 hour',
    used_at     TIMESTAMPTZ,
    ip_address  INET
);
CREATE INDEX IF NOT EXISTS idx_prtokens_user    ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_prtokens_token   ON password_reset_tokens(token);
CREATE INDEX IF NOT EXISTS idx_prtokens_expires ON password_reset_tokens(expires_at);

-- ── Lab memberships ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lab_memberships (
    membership_id   UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    lab_user_id     UUID    NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    member_user_id  UUID    NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    role            TEXT    NOT NULL DEFAULT 'member' CHECK(role IN ('owner', 'member')),
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(lab_user_id, member_user_id)
);
CREATE INDEX IF NOT EXISTS idx_lab_members_lab    ON lab_memberships(lab_user_id);
CREATE INDEX IF NOT EXISTS idx_lab_members_member ON lab_memberships(member_user_id);

-- ── API keys (Lab tier only) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_keys (
    key_id       UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID    NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    key_hash     TEXT    UNIQUE NOT NULL,
    key_prefix   TEXT    NOT NULL,     -- first 8 chars shown in UI
    label        TEXT,
    scopes       TEXT[]  NOT NULL DEFAULT ARRAY['read'],
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    expires_at   TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_api_keys_user   ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash   ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(user_id)
    WHERE revoked_at IS NULL;

-- ── sessions table: extend with user_id ──────────────────────────────────────
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_id     UUID REFERENCES users(user_id) ON DELETE SET NULL;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS expires_at  TIMESTAMPTZ;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ip_address  INET;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_agent  TEXT;
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)
    WHERE expires_at IS NOT NULL;

-- ── graphs table: link to users ───────────────────────────────────────────────
ALTER TABLE graphs ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(user_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_graphs_user ON graphs(user_id, created_at DESC);

-- ── papers table: publication_date for precise months_apart calculation ───────
ALTER TABLE papers ADD COLUMN IF NOT EXISTS publication_date DATE;

-- ── graph_memory: per-user exploration state ──────────────────────────────────
CREATE TABLE IF NOT EXISTS graph_memory (
    id          SERIAL      PRIMARY KEY,
    user_id     UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    graph_id    TEXT        NOT NULL,
    memory_json JSONB       NOT NULL DEFAULT '{}',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, graph_id)
);
CREATE INDEX IF NOT EXISTS idx_graph_memory_user  ON graph_memory(user_id);
CREATE INDEX IF NOT EXISTS idx_graph_memory_graph ON graph_memory(graph_id);

-- ── consent log (GDPR audit trail) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS consent_log (
    id           SERIAL      PRIMARY KEY,
    user_id      UUID        REFERENCES users(user_id) ON DELETE SET NULL,
    session_id   TEXT,
    consent_type TEXT        NOT NULL,
    ip_address   INET,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_consent_user    ON consent_log(user_id);
CREATE INDEX IF NOT EXISTS idx_consent_session ON consent_log(session_id);
"""


def run():
    from dotenv import load_dotenv
    load_dotenv()
    import backend.db as db
    from backend.config import Config
    db.init_pool(database_url=Config.DATABASE_URL)
    logger.info("Running Phase 6 migrations...")
    try:
        db.execute(PHASE_6_SQL)
        logger.info("Phase 6 schema applied successfully.")
    except Exception as exc:
        logger.error(f"Migration failed: {exc}")
        sys.exit(1)

    expected_tables = [
        "users", "email_verification_tokens", "password_reset_tokens",
        "lab_memberships", "api_keys", "graph_memory", "consent_log",
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
    logger.info(f"Verified {len(expected_tables)} tables. Phase 6 migration complete.")


if __name__ == "__main__":
    run()
