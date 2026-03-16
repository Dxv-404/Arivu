"""
backend/live_mode.py — LiveModeManager (F8.1)

Persistent subscriptions to any graph. When a user saves a graph, they can
opt into live monitoring. Arivu monitors for new papers that cite any node
in the graph via S2/OpenAlex new paper feeds.

Tables: live_subscriptions, live_alerts (Phase 8 migration).
"""
import logging

import backend.db as db

logger = logging.getLogger(__name__)


class LiveModeManager:
    """Stateless — instantiate fresh per request."""

    def create_subscription(
        self,
        user_id: str,
        graph_id: str,
        seed_paper_id: str,
        alert_events: list,
        digest_email: bool,
    ) -> str:
        """Create a live mode subscription. Returns subscription_id."""
        row = db.execute_returning(
            """
            INSERT INTO live_subscriptions
                (user_id, graph_id, seed_paper_id, alert_events, digest_email)
            VALUES (%s, %s, %s, %s::text[], %s)
            ON CONFLICT (user_id, graph_id) DO UPDATE SET
                alert_events  = EXCLUDED.alert_events,
                digest_email  = EXCLUDED.digest_email,
                active        = TRUE
            RETURNING subscription_id::text AS subscription_id
            """,
            (user_id, graph_id, seed_paper_id, alert_events, digest_email),
        )
        return row["subscription_id"]

    def get_subscriptions(self, user_id: str) -> list:
        """Get all subscriptions for a user."""
        rows = db.fetchall(
            """
            SELECT subscription_id::text, graph_id, seed_paper_id,
                   alert_events, digest_email, active,
                   created_at::text, last_checked_at::text
            FROM live_subscriptions
            WHERE user_id = %s
            ORDER BY created_at DESC
            """,
            (user_id,),
        )
        return [dict(r) for r in rows]

    def cancel_subscription(self, user_id: str, graph_id: str) -> bool:
        """Deactivate a subscription. Returns True if found, False otherwise."""
        row = db.execute_returning(
            """
            UPDATE live_subscriptions
            SET active = FALSE
            WHERE user_id = %s AND graph_id = %s AND active = TRUE
            RETURNING subscription_id::text
            """,
            (user_id, graph_id),
        )
        return row is not None

    def get_unread_alerts(self, user_id: str, limit: int = None) -> list:
        """Get undelivered alerts for a user, optionally limited."""
        query = """
            SELECT a.alert_id::text, a.event_type, a.event_data,
                   a.created_at::text, s.seed_paper_id
            FROM live_alerts a
            JOIN live_subscriptions s ON s.subscription_id = a.subscription_id
            WHERE s.user_id = %s AND a.delivered = FALSE
            ORDER BY a.created_at DESC
        """
        params = [user_id]
        if limit:
            query += " LIMIT %s"
            params.append(limit)

        rows = db.fetchall(query, tuple(params))
        return [dict(r) for r in rows]

    def mark_alerts_read(self, user_id: str, alert_ids: list) -> int:
        """Mark specific alerts as delivered. Returns count marked."""
        if not alert_ids:
            return 0
        row = db.fetchone(
            """
            WITH updated AS (
                UPDATE live_alerts a
                SET delivered = TRUE
                FROM live_subscriptions s
                WHERE a.subscription_id = s.subscription_id
                  AND s.user_id = %s
                  AND a.alert_id = ANY(%s::uuid[])
                  AND a.delivered = FALSE
                RETURNING a.alert_id
            )
            SELECT COUNT(*) AS cnt FROM updated
            """,
            (user_id, alert_ids),
        )
        return int(row["cnt"]) if row else 0

    def get_active_subscriptions(self) -> list:
        """Get all active subscriptions across all users (for cron job)."""
        rows = db.fetchall(
            """
            SELECT subscription_id::text, user_id::text, graph_id,
                   seed_paper_id, alert_events, digest_email,
                   last_checked_at::text
            FROM live_subscriptions
            WHERE active = TRUE
            ORDER BY last_checked_at ASC NULLS FIRST
            """,
        )
        return [dict(r) for r in rows]

    def update_last_checked(self, subscription_id: str) -> None:
        """Update last_checked_at timestamp for a subscription."""
        db.execute(
            "UPDATE live_subscriptions SET last_checked_at = NOW() WHERE subscription_id = %s::uuid",
            (subscription_id,),
        )

    def create_alert(
        self,
        subscription_id: str,
        event_type: str,
        event_data: dict,
    ) -> None:
        """Insert a new alert for a subscription."""
        import json
        db.execute(
            """
            INSERT INTO live_alerts (subscription_id, event_type, event_data)
            VALUES (%s::uuid, %s, %s::jsonb)
            """,
            (subscription_id, event_type, json.dumps(event_data)),
        )
