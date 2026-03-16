#!/usr/bin/env python3
"""
scripts/weekly_digest.py — Supervisor dashboard weekly digest.

Aggregates lab activity for the past 7 days and logs summary.
Can be extended to email a digest to lab owners.

Run: python scripts/weekly_digest.py
"""
import sys
import logging
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

    logger.info("Generating weekly digest...")

    # Find all lab owners (users who have lab_memberships as owner)
    lab_owners = db.fetchall(
        """
        SELECT DISTINCT u.user_id, u.email, u.display_name
        FROM users u
        JOIN lab_memberships lm ON lm.lab_owner_id = u.user_id
        """
    )
    logger.info(f"Found {len(lab_owners)} lab owners.")

    for owner in lab_owners:
        owner_id = str(owner["user_id"])
        name = owner.get("display_name") or owner.get("email", "?")

        # Member count
        member_count = db.fetchone(
            "SELECT COUNT(*) as cnt FROM lab_memberships WHERE lab_owner_id = %s::uuid",
            (owner_id,),
        )
        mc = member_count["cnt"] if member_count else 0

        # Graphs built this week
        graphs_week = db.fetchone(
            """
            SELECT COUNT(*) as cnt FROM graphs
            WHERE user_id = %s::uuid AND created_at > NOW() - INTERVAL '7 days'
            """,
            (owner_id,),
        )
        gc = graphs_week["cnt"] if graphs_week else 0

        # Pending invites
        pending = db.fetchone(
            """
            SELECT COUNT(*) as cnt FROM lab_invites
            WHERE lab_user_id = %s::uuid AND accepted_at IS NULL AND expires_at > NOW()
            """,
            (owner_id,),
        )
        pc = pending["cnt"] if pending else 0

        logger.info(
            f"  Lab owner: {name} | Members: {mc} | "
            f"Graphs this week: {gc} | Pending invites: {pc}"
        )

    logger.info("Weekly digest complete.")


if __name__ == "__main__":
    run()
