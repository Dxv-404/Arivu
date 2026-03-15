"""
backend/gdpr.py — GDPR: data export (right of access) and account deletion (right to erasure).
"""
import io, json, logging, zipfile
from datetime import datetime, timezone
import backend.db as db
from backend.config import Config
from backend.r2_client import R2Client

logger = logging.getLogger(__name__)


def generate_user_data_export(user_id: str) -> str:
    user = db.fetchone("SELECT * FROM users WHERE user_id = %s::uuid", (user_id,))
    if not user:
        raise ValueError(f"User {user_id} not found")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        profile = {k: str(v) if v is not None else None
                   for k, v in user.items() if k not in ("password_hash",)}
        zf.writestr("profile.json", json.dumps(profile, indent=2, default=str))

        sessions = db.fetchall(
            "SELECT session_id, created_at, last_seen, expires_at, ip_address, user_agent "
            "FROM sessions WHERE user_id = %s::uuid AND created_at > NOW() - INTERVAL '90 days'",
            (user_id,),
        )
        zf.writestr("sessions.json", json.dumps([dict(s) for s in sessions], indent=2, default=str))

        graphs = db.fetchall(
            "SELECT graph_id, seed_paper_id, node_count, edge_count, created_at "
            "FROM graphs WHERE user_id = %s::uuid ORDER BY created_at DESC",
            (user_id,),
        )
        zf.writestr("graphs.json", json.dumps([dict(g) for g in graphs], indent=2, default=str))

        actions = db.fetchall(
            "SELECT action_type, action_data, timestamp FROM action_log "
            "WHERE session_id IN (SELECT session_id FROM sessions WHERE user_id = %s::uuid) "
            "ORDER BY timestamp DESC",
            (user_id,),
        )
        zf.writestr("action_log.json", json.dumps([dict(a) for a in actions], indent=2, default=str))

        # Note: canonical table name is edge_feedback (NOT edge_flags per CLAUDE.md Part 6.8)
        feedback = db.fetchall(
            "SELECT source_id, target_id, reason, created_at FROM edge_feedback "
            "WHERE session_id IN (SELECT session_id FROM sessions WHERE user_id = %s::uuid) "
            "ORDER BY created_at DESC",
            (user_id,),
        )
        zf.writestr("edge_feedback.json", json.dumps([dict(f) for f in feedback], indent=2, default=str))

        api_keys = db.fetchall(
            "SELECT key_prefix, label, scopes, created_at, last_used_at, revoked_at "
            "FROM api_keys WHERE user_id = %s::uuid",
            (user_id,),
        )
        zf.writestr("api_keys.json", json.dumps([dict(k) for k in api_keys], indent=2, default=str))

        zf.writestr("README.txt", (
            f"Arivu Data Export\nUser: {user.get('email', '')}\n"
            f"Exported: {datetime.now(timezone.utc).isoformat()}\n\n"
            f"Files: profile.json, sessions.json, graphs.json, action_log.json, "
            f"edge_feedback.json, api_keys.json\n\nQuestions: privacy@arivu.app\n"
        ))

    zip_bytes = buf.getvalue()
    r2  = R2Client()
    key = f"gdpr-exports/{user_id}/{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.zip"
    r2.upload(key, zip_bytes, "application/zip")
    url = r2.presigned_url(key, expires_in=86400)
    logger.info(f"GDPR export generated for user_id={user_id}")
    return url


def delete_user_account(user_id: str) -> bool:
    user = db.fetchone("SELECT * FROM users WHERE user_id = %s::uuid", (user_id,))
    if not user:
        return False

    try:
        db.execute("DELETE FROM sessions WHERE user_id = %s::uuid", (user_id,))
        db.execute("UPDATE api_keys SET revoked_at = NOW() WHERE user_id = %s::uuid", (user_id,))
        db.execute("DELETE FROM email_verification_tokens WHERE user_id = %s::uuid", (user_id,))
        db.execute("DELETE FROM password_reset_tokens WHERE user_id = %s::uuid", (user_id,))
        db.execute("DELETE FROM graph_memory WHERE user_id = %s::uuid", (user_id,))
        db.execute("DELETE FROM api_keys WHERE user_id = %s::uuid", (user_id,))
        db.execute("DELETE FROM consent_log WHERE user_id = %s::uuid", (user_id,))

        stripe_id = user.get("stripe_customer_id")
        if stripe_id and Config.stripe_enabled():
            try:
                import stripe as _stripe
                _stripe.api_key = Config.STRIPE_SECRET_KEY
                subs = _stripe.Subscription.list(customer=stripe_id, status="active")
                for sub in subs.auto_paging_iter():
                    _stripe.Subscription.cancel(sub.id)
            except Exception as exc:
                logger.warning(f"Could not cancel Stripe subscription for {stripe_id}: {exc}")

        db.execute(
            """
            UPDATE users SET
                email            = 'deleted_' || user_id::text || '@deleted.arivu',
                password_hash    = '',
                display_name     = '[Deleted User]',
                institution      = NULL,
                stripe_customer_id = NULL,
                gdpr_deletion_requested_at = NOW()
            WHERE user_id = %s::uuid
            """,
            (user_id,),
        )
        logger.info(f"Account deleted for user_id={user_id}")
        return True
    except Exception as exc:
        logger.error(f"Account deletion failed for user_id={user_id}: {exc}")
        return False
