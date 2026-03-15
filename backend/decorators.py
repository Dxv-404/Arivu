"""
backend/decorators.py — Flask route decorators for auth, tier gating, usage limits.

IMPORTANT: check_graph_limit only CHECKS the limit. It does NOT increment
graphs_this_month. The increment happens in the stream route AFTER a cache miss
is confirmed. This prevents charged usage for free cache-hit graph loads.
"""
import logging
from datetime import datetime, timezone
from functools import wraps

from flask import g, jsonify, request
import backend.db as db
from backend.config import Config

logger = logging.getLogger(__name__)
TIER_ORDER = {"free": 0, "researcher": 1, "lab": 2}


def get_current_user():
    """Resolve authenticated user from session cookie. Caches in g for request lifetime."""
    if hasattr(g, "_current_user"):
        return g._current_user

    session_id = request.cookies.get("arivu_session")
    if not session_id:
        g._current_user = None
        return None

    row = db.fetchone(
        """
        SELECT u.user_id, u.email, u.display_name, u.institution, u.role,
               u.tier, u.tier_expires_at, u.email_verified,
               u.graphs_this_month, u.usage_reset_at, u.failed_login_count,
               u.marketing_consent, u.gdpr_deletion_requested_at
        FROM sessions s
        JOIN users u ON u.user_id = s.user_id
        WHERE s.session_id = %s
          AND (s.expires_at IS NULL OR s.expires_at > NOW())
          AND u.email_verified = TRUE
          AND u.gdpr_deletion_requested_at IS NULL
        """,
        (session_id,),
    )

    if row:
        db.execute(
            "UPDATE sessions SET expires_at = NOW() + INTERVAL '30 days', "
            "last_seen = NOW() WHERE session_id = %s",
            (session_id,),
        )
        if row.get("usage_reset_at") and datetime.now(timezone.utc) > row["usage_reset_at"]:
            db.execute(
                "UPDATE users SET graphs_this_month = 0, "
                "usage_reset_at = DATE_TRUNC('month', NOW()) + INTERVAL '1 month' "
                "WHERE user_id = %s",
                (row["user_id"],),
            )
            row["graphs_this_month"] = 0

    g._current_user = row
    return row


def require_auth(f):
    """
    Require logged-in user. Returns 401 if not authenticated.
    Sets g.user, g.user_id, g.session_id for the request.
    When ENABLE_AUTH=false (local dev): passes through unconditionally.
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        if not Config.ENABLE_AUTH:
            g.user       = None
            g.user_id    = "00000000-0000-0000-0000-000000000000"
            g.session_id = request.cookies.get("arivu_session", "anon")
            return f(*args, **kwargs)

        user = get_current_user()
        if not user:
            return jsonify({
                "error":     "login_required",
                "message":   "You must be logged in to use this feature.",
                "login_url": "/login",
            }), 401

        g.user       = user
        g.user_id    = str(user["user_id"])
        g.session_id = request.cookies.get("arivu_session", "")
        return f(*args, **kwargs)
    return decorated


def require_tier(minimum_tier: str):
    """
    Require user to have at least minimum_tier. Must follow @require_auth.
    TIER_ORDER: free=0, researcher=1, lab=2.
    @require_tier("researcher") allows both researcher AND lab.
    """
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            if not Config.ENABLE_AUTH:
                return f(*args, **kwargs)

            user = getattr(g, "user", None)
            if not user:
                return jsonify({"error": "login_required"}), 401

            user_rank = TIER_ORDER.get(user.get("tier", "free"), 0)
            min_rank  = TIER_ORDER.get(minimum_tier, 0)

            if user_rank < min_rank:
                return jsonify({
                    "error":         "tier_required",
                    "required_tier": minimum_tier,
                    "current_tier":  user.get("tier", "free"),
                    "upgrade_url":   "/pricing",
                    "message":       f"This feature requires the {minimum_tier!r} plan. Upgrade at /pricing.",
                }), 403

            return f(*args, **kwargs)
        return decorated
    return decorator


def check_graph_limit(f):
    """
    For free-tier users: check 10 graphs/month limit and return 429 if exceeded.

    DOES NOT INCREMENT — increment happens in the stream route after cache miss.
    Researcher/Lab users pass through with no limit check.
    Anonymous users (no g.user) pass through — they are rate-limited by rate_limiter.py.
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        if not Config.ENABLE_AUTH:
            return f(*args, **kwargs)

        user = getattr(g, "user", None)
        if not user:
            return f(*args, **kwargs)   # anonymous — rate_limiter handles these

        if user.get("tier", "free") != "free":
            return f(*args, **kwargs)   # no limit for paid tiers

        count = user.get("graphs_this_month", 0)
        if count >= 10:
            return jsonify({
                "error":       "graph_limit_reached",
                "limit":       10,
                "used":        count,
                "reset_at":    str(user.get("usage_reset_at", "")),
                "upgrade_url": "/pricing",
                "message":     (
                    "You've used all 10 free graphs this month. "
                    "Upgrade to Researcher ($8/month) for unlimited graphs."
                ),
            }), 429

        # Do NOT increment here. Increment is in the graph stream route after cache miss.
        return f(*args, **kwargs)
    return decorated
