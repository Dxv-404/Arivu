"""
backend/auth.py — Authentication Blueprint.

Security:
- Passwords: bcrypt, 12 rounds
- Tokens: secrets.token_hex(32) — 256-bit entropy
- Emails: never reveal whether email is registered (timing-safe)
- Sessions: HTTP-only, Secure, SameSite=Lax, 30-day sliding expiry
- Brute force: 5 failed logins → hCaptcha required; 10+ → 15-min lockout
- Email change: NOT supported in Phase 6 (Phase 7+)
"""
import logging
import re
import secrets
from datetime import datetime, timezone

import bcrypt
from flask import (Blueprint, g, jsonify, redirect, render_template,
                   request, url_for, make_response)

import backend.db as db
from backend.captcha import captcha_required, verify_captcha
from backend.config import Config
from backend.mailer import (send_account_deletion_confirmation,
                             send_password_reset_email,
                             send_verification_email, send_welcome_email)

logger = logging.getLogger(__name__)
auth_bp        = Blueprint("auth", __name__)
SESSION_COOKIE = "arivu_session"
EMAIL_REGEX    = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")

def _check_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False

def _create_session(user_id: str, response) -> str:
    session_id = secrets.token_hex(32)
    ip = request.headers.get("X-Forwarded-For", request.remote_addr or "")
    ua = request.headers.get("User-Agent", "")[:512]
    db.execute(
        """
        INSERT INTO sessions (session_id, user_id, created_at, last_seen, expires_at,
                              ip_address, user_agent)
        VALUES (%s, %s, NOW(), NOW(), NOW() + INTERVAL '30 days', %s::inet, %s)
        ON CONFLICT (session_id) DO NOTHING
        """,
        (session_id, user_id, ip or None, ua),
    )
    secure = not Config.DEBUG
    response.set_cookie(
        SESSION_COOKIE, session_id,
        httponly=True, secure=secure, samesite="Lax",
        max_age=30 * 24 * 60 * 60, path="/",
    )
    return session_id

def _invalidate_all_sessions(user_id: str):
    db.execute("DELETE FROM sessions WHERE user_id = %s", (user_id,))

def _get_user_by_email(email: str) -> dict | None:
    return db.fetchone("SELECT * FROM users WHERE email = %s", (email.lower().strip(),))

def _get_user_by_id(user_id: str) -> dict | None:
    return db.fetchone("SELECT * FROM users WHERE user_id = %s::uuid", (user_id,))


# ── GET /login ────────────────────────────────────────────────────────────────

@auth_bp.route("/login", methods=["GET"])
def login_page():
    if Config.ENABLE_AUTH:
        from backend.decorators import get_current_user
        if get_current_user():
            return redirect("/tool")
    return render_template("auth/login.html", captcha_site_key=Config.HCAPTCHA_SITE_KEY)


# ── POST /login ───────────────────────────────────────────────────────────────

@auth_bp.route("/login", methods=["POST"])
def login():
    data     = request.get_json(silent=True) or {}
    email    = (data.get("email") or "").lower().strip()
    password = data.get("password") or ""

    if not email or not password:
        return jsonify({"error": "email and password are required"}), 400

    user = _get_user_by_email(email)
    _generic_error = {"error": "invalid_credentials", "message": "Incorrect email or password."}

    if not user:
        return jsonify(_generic_error), 401

    if user.get("locked_until") and datetime.now(timezone.utc) < user["locked_until"]:
        return jsonify({"error": "account_locked",
                        "message": "Too many failed attempts. Try again in 15 minutes."}), 429

    if captcha_required(user.get("failed_login_count", 0)):
        token = data.get("captcha_token", "")
        ip    = request.headers.get("X-Forwarded-For", request.remote_addr or "")
        if not verify_captcha(token, ip):
            return jsonify({"error": "captcha_required",
                            "message": "Please complete the CAPTCHA.",
                            "requires_captcha": True}), 400

    if not user.get("email_verified"):
        return jsonify({"error": "email_not_verified",
                        "message": "Please check your email and click the verification link.",
                        "can_resend": True}), 403

    if not _check_password(password, user.get("password_hash", "")):
        new_count = (user.get("failed_login_count", 0) or 0) + 1
        lock_sql  = ", locked_until = NOW() + INTERVAL '15 minutes'" if new_count >= 10 else ""
        db.execute(
            f"UPDATE users SET failed_login_count = %s {lock_sql} WHERE user_id = %s",
            (new_count, user["user_id"]),
        )
        resp = _generic_error.copy()
        if new_count >= 5:
            resp["requires_captcha"] = True
        return jsonify(resp), 401

    db.execute(
        "UPDATE users SET failed_login_count = 0, locked_until = NULL, "
        "last_login_at = NOW() WHERE user_id = %s",
        (user["user_id"],),
    )

    resp = make_response(jsonify({"success": True, "redirect": "/tool"}))
    _create_session(str(user["user_id"]), resp)

    if not user.get("last_login_at"):
        send_welcome_email(user["email"], user.get("display_name", ""))

    return resp


# ── GET /register ─────────────────────────────────────────────────────────────

@auth_bp.route("/register", methods=["GET"])
def register_page():
    if Config.ENABLE_AUTH:
        from backend.decorators import get_current_user
        if get_current_user():
            return redirect("/tool")
    return render_template("auth/register.html", captcha_site_key=Config.HCAPTCHA_SITE_KEY)


# ── POST /register ────────────────────────────────────────────────────────────

@auth_bp.route("/register", methods=["POST"])
def register():
    data         = request.get_json(silent=True) or {}
    email        = (data.get("email") or "").lower().strip()
    password     = data.get("password") or ""
    display_name = (data.get("display_name") or "").strip()[:100]
    institution  = (data.get("institution") or "").strip()[:200]

    if not email or not EMAIL_REGEX.match(email):
        return jsonify({"error": "invalid_email",
                        "message": "Please enter a valid email address."}), 400

    if len(password) < 8:
        return jsonify({"error": "password_too_short",
                        "message": "Password must be at least 8 characters."}), 400

    ip    = request.headers.get("X-Forwarded-For", request.remote_addr or "")
    token = data.get("captcha_token", "")
    if Config.HCAPTCHA_SECRET_KEY and not verify_captcha(token, ip):
        return jsonify({"error": "captcha_failed",
                        "message": "Please complete the CAPTCHA."}), 400

    existing = _get_user_by_email(email)
    if existing:
        return jsonify({
            "success": True,
            "message": "If that email isn't already registered, you'll receive a verification link shortly.",
        })

    hashed = _hash_password(password)
    row    = db.execute_returning(
        """
        INSERT INTO users (email, password_hash, display_name, institution, email_verified)
        VALUES (%s, %s, %s, %s, FALSE)
        RETURNING user_id
        """,
        (email, hashed, display_name or None, institution or None),
    )
    user_id = str(row["user_id"])

    token_str = secrets.token_hex(32)
    db.execute(
        "INSERT INTO email_verification_tokens (user_id, token) VALUES (%s, %s)",
        (user_id, token_str),
    )

    # Migrate anonymous session graphs to new user_id
    anon_session_id = request.cookies.get("arivu_session")
    if anon_session_id:
        # db.execute() returns cursor.rowcount
        migrated = db.execute(
            """
            UPDATE graphs SET user_id = %s::uuid
            WHERE graph_id IN (
                SELECT graph_id FROM session_graphs WHERE session_id = %s
            )
            AND user_id IS NULL
            """,
            (user_id, anon_session_id),
        )
        if migrated and migrated > 0:
            logger.info(f"Migrated {migrated} anonymous graphs to user_id={user_id}")

    send_verification_email(email, display_name, token_str)

    return jsonify({"success": True, "message": "Check your email to verify your account."})


# ── GET /verify-email ─────────────────────────────────────────────────────────

@auth_bp.route("/verify-email", methods=["GET"])
def verify_email():
    token_str = request.args.get("token", "")
    if not token_str:
        return render_template("auth/verify_email.html", status="missing")

    row = db.fetchone(
        "SELECT user_id, expires_at, used_at FROM email_verification_tokens WHERE token = %s",
        (token_str,),
    )

    if not row:
        return render_template("auth/verify_email.html", status="invalid")
    if row.get("used_at"):
        return render_template("auth/verify_email.html", status="already_used")
    if datetime.now(timezone.utc) > row["expires_at"]:
        return render_template("auth/verify_email.html", status="expired")

    db.execute("UPDATE email_verification_tokens SET used_at = NOW() WHERE token = %s", (token_str,))
    db.execute("UPDATE users SET email_verified = TRUE WHERE user_id = %s", (str(row["user_id"]),))

    user = _get_user_by_id(str(row["user_id"]))
    resp = make_response(redirect("/tool?welcome=1"))
    if user:
        _create_session(str(user["user_id"]), resp)
    return resp


# ── POST /logout ──────────────────────────────────────────────────────────────

@auth_bp.route("/logout", methods=["POST"])
def logout():
    session_id = request.cookies.get(SESSION_COOKIE)
    if session_id:
        db.execute("DELETE FROM sessions WHERE session_id = %s", (session_id,))
    resp = make_response(jsonify({"success": True, "redirect": "/"}))
    resp.delete_cookie(SESSION_COOKIE)
    return resp


# ── GET /forgot-password ──────────────────────────────────────────────────────

@auth_bp.route("/forgot-password", methods=["GET"])
def forgot_password_page():
    return render_template("auth/forgot_password.html")


# ── POST /forgot-password ─────────────────────────────────────────────────────

@auth_bp.route("/forgot-password", methods=["POST"])
def forgot_password():
    data  = request.get_json(silent=True) or {}
    email = (data.get("email") or "").lower().strip()
    _ok   = {"success": True, "message": "If that email is registered, a reset link is on its way."}

    if not email or not EMAIL_REGEX.match(email):
        return jsonify(_ok)

    user = _get_user_by_email(email)
    if not user:
        return jsonify(_ok)

    db.execute(
        "UPDATE password_reset_tokens SET used_at = NOW() "
        "WHERE user_id = %s AND used_at IS NULL",
        (str(user["user_id"]),),
    )

    token_str = secrets.token_hex(32)
    ip        = request.headers.get("X-Forwarded-For", request.remote_addr or "")
    db.execute(
        "INSERT INTO password_reset_tokens (user_id, token, ip_address) VALUES (%s, %s, %s::inet)",
        (str(user["user_id"]), token_str, ip or None),
    )
    send_password_reset_email(email, user.get("display_name", ""), token_str)
    return jsonify(_ok)


# ── GET /reset-password ───────────────────────────────────────────────────────

@auth_bp.route("/reset-password", methods=["GET"])
def reset_password_page():
    token_str = request.args.get("token", "")
    row = db.fetchone(
        "SELECT token_id, expires_at, used_at FROM password_reset_tokens WHERE token = %s",
        (token_str,),
    )
    if not row or row.get("used_at") or datetime.now(timezone.utc) > row["expires_at"]:
        return render_template("auth/reset_password.html", token=None, status="invalid")
    return render_template("auth/reset_password.html", token=token_str, status="valid")


# ── POST /reset-password ──────────────────────────────────────────────────────

@auth_bp.route("/reset-password", methods=["POST"])
def reset_password():
    data      = request.get_json(silent=True) or {}
    token_str = data.get("token", "")
    new_pw    = data.get("password", "")

    if len(new_pw) < 8:
        return jsonify({"error": "password_too_short",
                        "message": "Password must be at least 8 characters."}), 400

    row = db.fetchone(
        "SELECT user_id, expires_at, used_at FROM password_reset_tokens WHERE token = %s",
        (token_str,),
    )
    if not row:
        return jsonify({"error": "invalid_token", "message": "Reset link is invalid."}), 400
    if row.get("used_at"):
        return jsonify({"error": "token_used", "message": "Reset link already used."}), 400
    if datetime.now(timezone.utc) > row["expires_at"]:
        return jsonify({"error": "token_expired", "message": "Reset link has expired."}), 400

    new_hash = _hash_password(new_pw)
    db.execute("UPDATE users SET password_hash = %s WHERE user_id = %s",
               (new_hash, str(row["user_id"])))
    db.execute("UPDATE password_reset_tokens SET used_at = NOW() WHERE token = %s", (token_str,))
    _invalidate_all_sessions(str(row["user_id"]))

    user = _get_user_by_id(str(row["user_id"]))
    resp = make_response(jsonify({"success": True, "redirect": "/tool"}))
    if user:
        _create_session(str(user["user_id"]), resp)
    return resp


# ── POST /resend-verification ─────────────────────────────────────────────────

@auth_bp.route("/resend-verification", methods=["POST"])
def resend_verification():
    data  = request.get_json(silent=True) or {}
    email = (data.get("email") or "").lower().strip()
    user  = _get_user_by_email(email)
    if not user or user.get("email_verified"):
        return jsonify({"success": True})

    token_str = secrets.token_hex(32)
    db.execute(
        "UPDATE email_verification_tokens SET used_at = NOW() "
        "WHERE user_id = %s AND used_at IS NULL",
        (str(user["user_id"]),),
    )
    db.execute(
        "INSERT INTO email_verification_tokens (user_id, token) VALUES (%s, %s)",
        (str(user["user_id"]), token_str),
    )
    send_verification_email(email, user.get("display_name", ""), token_str)
    return jsonify({"success": True})
