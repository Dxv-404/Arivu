"""
session_manager.py — Anonymous session management.

Sessions are the identity mechanism for users without accounts.
A session is created automatically on first request and persists for
SESSION_DURATION_DAYS via a secure httpOnly cookie.

Cookie name:    arivu_session
Cookie flags:   HttpOnly, Secure (HTTPS only), SameSite=Lax, Path=/
DB table:       sessions (session_id, created_at, last_seen, persona, graph_memory)

The require_session decorator is imported by app.py and applied to every
route that needs a session. It sets g.session_id and g.session_response
so downstream code can read the session ID.

IMPORTANT: set_cookie() must be called on the response AFTER the route handler
returns. This is done via after_this_request() — see _attach_cookie_if_new().
"""
import logging
import os
import secrets
from functools import wraps
from typing import Optional

from flask import after_this_request, g, request

import backend.db as db

logger = logging.getLogger(__name__)

SESSION_COOKIE_NAME = "arivu_session"
SESSION_DURATION_DAYS = 365
_SESSION_MAX_AGE = SESSION_DURATION_DAYS * 24 * 3600


class SessionManager:
    """
    Creates and validates anonymous sessions backed by the sessions table.
    """

    def create_session(self) -> str:
        """Create a new anonymous session. Returns the session_id."""
        session_id = secrets.token_urlsafe(32)
        db.execute(
            """
            INSERT INTO sessions (session_id, created_at, last_seen, persona, graph_memory)
            VALUES (%s, NOW(), NOW(), 'explorer', '{}'::jsonb)
            """,
            (session_id,),
        )
        logger.debug(f"Created session: {session_id[:8]}...")
        return session_id

    def get_session(self, session_id: str) -> bool:
        """
        Validate that session_id exists in the DB and update last_seen.
        Returns True if valid, False if not.
        """
        if not session_id or len(session_id) > 64:
            return False
        row = db.fetchone(
            "SELECT session_id FROM sessions WHERE session_id = %s",
            (session_id,),
        )
        if not row:
            return False
        db.execute(
            "UPDATE sessions SET last_seen = NOW() WHERE session_id = %s",
            (session_id,),
        )
        return True

    def require_session(self) -> str:
        """
        Get the session_id from the cookie, validating it against the DB.
        If missing or invalid, create a new session.
        Schedules a Set-Cookie header on the response if a new session was created.
        Returns the valid session_id.
        """
        existing = request.cookies.get(SESSION_COOKIE_NAME)
        is_valid = self.get_session(existing) if existing else False

        if is_valid:
            return existing

        # Create new session
        new_id = self.create_session()

        is_debug = os.environ.get("FLASK_DEBUG", "0") == "1"

        @after_this_request
        def _set_cookie(response):
            response.set_cookie(
                SESSION_COOKIE_NAME,
                new_id,
                max_age=_SESSION_MAX_AGE,
                httponly=True,
                secure=not is_debug,   # HTTPS-only in production; allow HTTP in dev
                samesite="Lax",
                path="/",
            )
            return response

        return new_id


# Module-level singleton
_manager = SessionManager()


def require_session(f):
    """
    Route decorator: ensures g.session_id is set before the handler runs.
    Creates a new session automatically if the cookie is absent or invalid.

    Usage in app.py:
        @app.route("/api/search", methods=["POST"])
        @require_session
        def search_papers():
            session_id = g.session_id
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        g.session_id = _manager.require_session()
        return f(*args, **kwargs)
    return decorated


def get_session_id(req) -> Optional[str]:
    """
    Read and validate session cookie. Returns session_id if valid, None otherwise.
    Does NOT create a new session — use the @require_session decorator for that.
    Used by routes that return 401 when no session is present.
    """
    existing = req.cookies.get(SESSION_COOKIE_NAME)
    if not existing:
        return None
    return existing if _manager.get_session(existing) else None
