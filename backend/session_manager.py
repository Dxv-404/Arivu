"""
session_manager.py — SessionManager: anonymous sessions, secure cookie.
Implemented in Phase 2.
"""
from functools import wraps
from flask import request, g


def require_session(f):
    """
    Phase 2 TODO: validate session cookie, set g.session_id, create anonymous
    session in DB if needed.
    Phase 1 stub: passes through unconditionally — no DB write, no validation.
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        g.session_id = request.cookies.get("arivu_session", "anon")
        return f(*args, **kwargs)
    return decorated


# TODO: Phase 2 — full SessionManager class
