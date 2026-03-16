#!/usr/bin/env python3
"""
scripts/migrate_phase7.py — Phase 7 schema additions.
Creates 9 tables + adds columns to sessions, users, papers, graphs.
Run: python scripts/migrate_phase7.py
"""
import sys
import logging
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


PHASE_7_SQL = """
-- ── Shared graph links (shareable read-only URLs) ───────────────────────────
CREATE TABLE IF NOT EXISTS shared_graphs (
    share_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    graph_id        TEXT        NOT NULL,
    user_id         UUID        REFERENCES users(user_id) ON DELETE SET NULL,
    share_token     TEXT        UNIQUE NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ,
    view_count      INT         NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_shared_graphs_token ON shared_graphs(share_token);
CREATE INDEX IF NOT EXISTS idx_shared_graphs_graph ON shared_graphs(graph_id);

-- ── Vocabulary snapshots (per-year, per-graph, for Time Machine) ────────────
CREATE TABLE IF NOT EXISTS vocabulary_snapshots (
    id              SERIAL      PRIMARY KEY,
    graph_id        TEXT        NOT NULL,
    year            INT         NOT NULL,
    terms_json      JSONB       NOT NULL,
    computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(graph_id, year)
);
CREATE INDEX IF NOT EXISTS idx_vocab_snap_graph ON vocabulary_snapshots(graph_id);

-- ── Time Machine result cache ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS time_machine_cache (
    id              SERIAL      PRIMARY KEY,
    graph_id        TEXT        UNIQUE NOT NULL,
    result_json     JSONB       NOT NULL,
    computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tmc_graph ON time_machine_cache(graph_id);

-- ── Counterfactual analysis cache ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS counterfactual_cache (
    id              SERIAL      PRIMARY KEY,
    graph_id        TEXT        NOT NULL,
    paper_id        TEXT        NOT NULL,
    result_json     JSONB       NOT NULL,
    computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(graph_id, paper_id)
);
CREATE INDEX IF NOT EXISTS idx_cf_cache ON counterfactual_cache(graph_id, paper_id);

-- ── Adversarial review jobs ─────────────────────────────────────────────────
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

-- ── Persona modes per session/user ──────────────────────────────────────────
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS persona_mode TEXT DEFAULT 'explorer';
ALTER TABLE users    ADD COLUMN IF NOT EXISTS default_persona TEXT DEFAULT 'explorer';

-- ── Lab invites ─────────────────────────────────────────────────────────────
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

-- ── Webhooks (F9.2) ────────────────────────────────────────────────────────
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

-- ── Webhook delivery log ────────────────────────────────────────────────────
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

-- ── Email change tokens ─────────────────────────────────────────────────────
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

-- ── papers table: publication_date ──────────────────────────────────────────
ALTER TABLE papers ADD COLUMN IF NOT EXISTS publication_date DATE;

-- ── graphs table: shared_count for analytics ────────────────────────────────
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
