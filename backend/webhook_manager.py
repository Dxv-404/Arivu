"""
backend/webhook_manager.py — WebhookManager (F9.2)

Manages webhook delivery for paper events.
Deliveries are always sent in background threads — never blocks a request cycle.

Written from scratch (v1 missing).
"""
import hashlib
import hmac
import json
import logging
import threading
from datetime import datetime, timezone

import requests
import backend.db as db

logger = logging.getLogger(__name__)

MAX_RETRY_ATTEMPTS = 3
DELIVERY_TIMEOUT   = 10  # seconds


class WebhookManager:
    """Manages webhook subscriptions and deliveries."""

    def trigger_event(self, paper_id: str, event_type: str, payload: dict):
        """
        Fire webhooks for a paper event. Always runs in background threads.
        Never blocks the calling request cycle.
        """
        thread = threading.Thread(
            target=self._deliver_all,
            args=(paper_id, event_type, payload),
            daemon=True,
        )
        thread.start()

    def _deliver_all(self, paper_id: str, event_type: str, payload: dict):
        """Find matching subscriptions and deliver webhooks."""
        try:
            subs = db.fetchall(
                """
                SELECT subscription_id, webhook_url, secret, events
                FROM webhook_subscriptions
                WHERE paper_id = %s AND active = TRUE AND failure_count < %s
                """,
                (paper_id, MAX_RETRY_ATTEMPTS * 3),
            )
        except Exception as exc:
            logger.error(f"Webhook subscription lookup failed: {exc}")
            return

        for sub in subs:
            events = sub.get("events") or []
            if event_type not in events:
                continue

            self._deliver_one(
                subscription_id=str(sub["subscription_id"]),
                webhook_url=sub["webhook_url"],
                secret=sub["secret"],
                event_type=event_type,
                payload=payload,
            )

    def _deliver_one(
        self, subscription_id: str, webhook_url: str,
        secret: str, event_type: str, payload: dict
    ):
        """Deliver a single webhook with HMAC signing."""
        body = json.dumps({
            "event": event_type,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "data": payload,
        }, default=str)

        # Compute HMAC signature
        signature = hmac.new(
            secret.encode(), body.encode(), hashlib.sha256
        ).hexdigest()

        # Create delivery record
        try:
            delivery = db.execute_returning(
                """
                INSERT INTO webhook_deliveries (subscription_id, event_type, payload_json)
                VALUES (%s::uuid, %s, %s::jsonb)
                RETURNING delivery_id
                """,
                (subscription_id, event_type, body),
            )
            delivery_id = str(delivery["delivery_id"]) if delivery else None
        except Exception as exc:
            logger.error(f"Failed to create delivery record: {exc}")
            delivery_id = None

        # Send the webhook
        try:
            resp = requests.post(
                webhook_url,
                data=body,
                headers={
                    "Content-Type": "application/json",
                    "X-Arivu-Signature": f"sha256={signature}",
                    "X-Arivu-Event": event_type,
                    "User-Agent": "Arivu-Webhook/1.0",
                },
                timeout=DELIVERY_TIMEOUT,
            )
            http_status = resp.status_code
            status = "delivered" if 200 <= http_status < 300 else "failed"
        except requests.RequestException as exc:
            logger.warning(f"Webhook delivery failed for {subscription_id}: {exc}")
            http_status = 0
            status = "failed"

        # Update delivery record
        if delivery_id:
            try:
                db.execute(
                    """
                    UPDATE webhook_deliveries
                    SET status = %s, http_status = %s,
                        attempt_count = attempt_count + 1, last_attempt_at = NOW()
                    WHERE delivery_id = %s::uuid
                    """,
                    (status, http_status, delivery_id),
                )
            except Exception:
                pass

        # Update subscription metadata
        try:
            if status == "delivered":
                db.execute(
                    "UPDATE webhook_subscriptions SET last_triggered = NOW(), failure_count = 0 "
                    "WHERE subscription_id = %s::uuid",
                    (subscription_id,),
                )
            else:
                db.execute(
                    "UPDATE webhook_subscriptions SET failure_count = failure_count + 1 "
                    "WHERE subscription_id = %s::uuid",
                    (subscription_id,),
                )
        except Exception:
            pass

        logger.info(
            f"Webhook delivery: sub={subscription_id} event={event_type} "
            f"status={status} http={http_status}"
        )
