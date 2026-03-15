#!/usr/bin/env python3
"""
scripts/nightly_maintenance.py — GDPR retention + session cleanup + usage resets.
Run via Koyeb scheduled job at 02:00 UTC daily (see §11.1 for setup).
"""
import sys, logging
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def run():
    from dotenv import load_dotenv
    load_dotenv()
    import backend.db as db
    from backend.config import Config
    db.init_pool(database_url=Config.DATABASE_URL)
    logger.info("Starting nightly maintenance...")

    n = db.execute("DELETE FROM sessions WHERE expires_at IS NOT NULL AND expires_at < NOW()")
    logger.info(f"  Deleted {n} expired sessions")

    n = db.execute("DELETE FROM action_log WHERE timestamp < NOW() - INTERVAL '90 days'")
    logger.info(f"  Deleted {n} old action_log rows")

    n = db.execute("DELETE FROM password_reset_tokens WHERE expires_at < NOW() - INTERVAL '7 days'")
    logger.info(f"  Deleted {n} old password_reset_tokens")

    n = db.execute("DELETE FROM email_verification_tokens WHERE expires_at < NOW() - INTERVAL '7 days'")
    logger.info(f"  Deleted {n} old email_verification_tokens")

    pending = db.fetchall(
        """
        SELECT user_id, email FROM users
        WHERE gdpr_deletion_requested_at IS NOT NULL
          AND password_hash != ''
          AND gdpr_deletion_requested_at < NOW() - INTERVAL '1 hour'
        LIMIT 50
        """,
    )
    if pending:
        from backend.gdpr import delete_user_account
        from backend.mailer import send_account_deletion_confirmation
        for row in pending:
            uid   = str(row["user_id"])
            email = row.get("email", "")
            try:
                if delete_user_account(uid):
                    if email and not email.startswith("deleted_"):
                        send_account_deletion_confirmation(email, "")
                    logger.info(f"  Completed deletion for user_id={uid}")
                else:
                    logger.warning(f"  Deletion failed for user_id={uid}")
            except Exception as exc:
                logger.error(f"  Deletion error for user_id={uid}: {exc}")

    # Usage-reset and tier-downgrade blocks removed — all features free (ADR-016).

    logger.info("Nightly maintenance complete.")


if __name__ == "__main__":
    run()
