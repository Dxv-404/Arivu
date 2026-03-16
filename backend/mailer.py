"""
backend/mailer.py — Transactional email via Resend.com.
Free tier: 3,000 emails/month, 100/day.
Degrades gracefully when RESEND_API_KEY is not set (logs to console).

IMPORTANT: Call _init_resend() once at app startup (done in create_app()).
Do NOT set resend.api_key per-call — that is not thread-safe.
"""
import logging
import resend
from backend.config import Config

logger = logging.getLogger(__name__)


def _init_resend():
    """Set Resend API key once at app startup. Called by create_app()."""
    if Config.RESEND_API_KEY:
        resend.api_key = Config.RESEND_API_KEY


def _send(to: str, subject: str, text: str, html: str) -> bool:
    """Send one email. Returns True on success, False on failure. Never raises."""
    if not Config.email_enabled():
        logger.info(
            f"[EMAIL DISABLED] Would send to={to!r} subject={subject!r}\n"
            f"--- TEXT ---\n{text}\n--- END ---"
        )
        return True
    try:
        # resend.api_key is set at startup by _init_resend()
        resend.Emails.send({
            "from":    f"{Config.EMAIL_FROM_NAME} <{Config.EMAIL_FROM}>",
            "to":      [to],
            "subject": subject,
            "text":    text,
            "html":    html,
        })
        logger.info(f"Email sent: to={to!r} subject={subject!r}")
        return True
    except Exception as exc:
        logger.error(f"Email send failed: to={to!r} subject={subject!r} error={exc}")
        return False


def send_verification_email(email: str, display_name: str, token: str) -> bool:
    name = display_name or "there"
    link = f"https://{Config.CUSTOM_DOMAIN}/verify-email?token={token}"
    text = (
        f"Hi {name},\n\nClick the link to verify your Arivu account:\n\n{link}\n\n"
        f"This link expires in 24 hours.\n\nIf you didn't create an account, ignore this.\n\n— The Arivu team"
    )
    html = f"""<!DOCTYPE html>
<html><body style="font-family:sans-serif;max-width:600px;margin:40px auto;color:#1a1a2e">
<h2 style="color:#D4A843">Arivu</h2><p>Hi {name},</p>
<p>Click the button below to verify your email address.</p>
<a href="{link}" style="display:inline-block;padding:12px 24px;background:#D4A843;color:#0a0e17;text-decoration:none;border-radius:6px;font-weight:600;">Verify my email</a>
<p style="margin-top:24px;font-size:13px;color:#64748B">Link expires in 24 hours.</p>
</body></html>"""
    return _send(email, "Confirm your Arivu account", text, html)


def send_password_reset_email(email: str, display_name: str, token: str) -> bool:
    name = display_name or "there"
    link = f"https://{Config.CUSTOM_DOMAIN}/reset-password?token={token}"
    text = (
        f"Hi {name},\n\nReset your password: {link}\n\n"
        f"This link expires in 1 hour and can only be used once.\n\n"
        f"If you didn't request this, your account is safe.\n\n— The Arivu team"
    )
    html = f"""<!DOCTYPE html>
<html><body style="font-family:sans-serif;max-width:600px;margin:40px auto;color:#1a1a2e">
<h2 style="color:#D4A843">Arivu</h2><p>Hi {name},</p>
<p>Someone requested a password reset for this email address.</p>
<a href="{link}" style="display:inline-block;padding:12px 24px;background:#D4A843;color:#0a0e17;text-decoration:none;border-radius:6px;font-weight:600;">Reset my password</a>
<p style="margin-top:24px;font-size:13px;color:#64748B">Link expires in 1 hour.</p>
</body></html>"""
    return _send(email, "Reset your Arivu password", text, html)


def send_welcome_email(email: str, display_name: str) -> bool:
    name = display_name or "there"
    text = (
        f"Hi {name},\n\nYour account is ready. A few things worth knowing:\n\n"
        f"1. All features are free — build unlimited graphs.\n"
        f"2. Every graph is cached — re-visiting the same paper is instant.\n"
        f"3. Try 'Attention Is All You Need' first — it's precomputed and loads immediately.\n"
        f"4. The pruning animation is the best entry point. Click any node in the graph.\n\n"
        f"If you have questions, reply to this email.\n\n— Dev"
    )
    html = f"""<!DOCTYPE html>
<html><body style="font-family:sans-serif;max-width:600px;margin:40px auto;color:#1a1a2e">
<h2 style="color:#D4A843">Welcome to Arivu, {name}!</h2>
<ol>
  <li>All features are free — <strong>unlimited graphs</strong>.</li>
  <li>Try <em>"Attention Is All You Need"</em> first — it's precomputed.</li>
  <li>Click any node in the graph to trigger the pruning animation.</li>
</ol>
<p>Questions? Just reply.</p>
<p style="color:#64748B;font-size:13px">— Dev</p>
</body></html>"""
    return _send(email, "Welcome to Arivu — a few things to know", text, html)


def send_payment_failed_email(email: str, display_name: str, tier: str) -> bool:
    name = display_name or "there"
    text = (
        f"Hi {name},\n\nYour payment for the Arivu {tier.capitalize()} plan failed.\n\n"
        f"Your account remains active for 3 more days. Update your payment method at:\n\n"
        f"https://{Config.CUSTOM_DOMAIN}/account\n\n"
        f"(Click 'Manage billing' to update your card via Stripe)\n\n— The Arivu team"
    )
    html = f"""<!DOCTYPE html>
<html><body style="font-family:sans-serif;max-width:600px;margin:40px auto;color:#1a1a2e">
<h2 style="color:#D4A843">Payment failed</h2><p>Hi {name},</p>
<p>Your payment for the Arivu <strong>{tier.capitalize()}</strong> plan failed.</p>
<p>Your account stays active for <strong>3 more days</strong>. Update your card to keep access.</p>
<a href="https://{Config.CUSTOM_DOMAIN}/account" style="display:inline-block;padding:12px 24px;background:#D4A843;color:#0a0e17;text-decoration:none;border-radius:6px;font-weight:600;">Update payment method</a>
</body></html>"""
    return _send(email, f"Action required: Arivu {tier.capitalize()} payment failed", text, html)


def send_account_deletion_confirmation(email: str, display_name: str) -> bool:
    name = display_name or "there"
    text = (
        f"Hi {name},\n\nYour Arivu account deletion is confirmed.\n\n"
        f"Your personal data has been permanently deleted.\n\n"
        f"Precomputed graphs are not deleted — they contain no personal data.\n\n— The Arivu team"
    )
    html = f"""<!DOCTYPE html>
<html><body style="font-family:sans-serif;max-width:600px;margin:40px auto;color:#1a1a2e">
<h2>Account Deleted</h2><p>Hi {name},</p>
<p>Your Arivu account has been permanently deleted.</p>
<p style="color:#64748B;font-size:13px">Precomputed graphs are not deleted — they contain no personal data.</p>
</body></html>"""
    return _send(email, "Your Arivu account has been deleted", text, html)


def send_data_export_ready(email: str, display_name: str, download_url: str) -> bool:
    name = display_name or "there"
    text = (
        f"Hi {name},\n\nYour Arivu data export is ready:\n\n{download_url}\n\n"
        f"This link expires in 24 hours.\n\n— The Arivu team"
    )
    html = f"""<!DOCTYPE html>
<html><body style="font-family:sans-serif;max-width:600px;margin:40px auto;color:#1a1a2e">
<h2 style="color:#D4A843">Your data export is ready</h2><p>Hi {name},</p>
<a href="{download_url}" style="display:inline-block;padding:12px 24px;background:#D4A843;color:#0a0e17;text-decoration:none;border-radius:6px;font-weight:600;">Download my data</a>
<p style="font-size:13px;color:#64748B">Link expires in 24 hours.</p>
</body></html>"""
    return _send(email, "Your Arivu data export is ready", text, html)


# ── Phase 7 additions ────────────────────────────────────────────────────────

def send_lab_invite_email(email: str, lab_name: str, accept_url: str) -> bool:
    """Send a lab invitation email."""
    text = (
        f"Hi,\n\nYou've been invited to join {lab_name} on Arivu.\n\n"
        f"Accept the invitation here:\n\n{accept_url}\n\n"
        f"This invite expires in 7 days.\n\n— The Arivu team"
    )
    html = f"""<!DOCTYPE html>
<html><body style="font-family:sans-serif;max-width:600px;margin:40px auto;color:#1a1a2e">
<h2 style="color:#D4A843">Lab Invitation</h2>
<p>You've been invited to join <strong>{lab_name}</strong> on Arivu.</p>
<a href="{accept_url}" style="display:inline-block;padding:12px 24px;background:#D4A843;color:#0a0e17;text-decoration:none;border-radius:6px;font-weight:600;">Accept invitation</a>
<p style="margin-top:24px;font-size:13px;color:#64748B">This invite expires in 7 days.</p>
</body></html>"""
    return _send(email, f"You're invited to join {lab_name} on Arivu", text, html)


def send_email_change_verification(new_email: str, token: str, confirm_url: str) -> bool:
    """Send email change verification to the new email address."""
    text = (
        f"Hi,\n\nYou requested to change your Arivu email to this address.\n\n"
        f"Confirm the change here:\n\n{confirm_url}\n\n"
        f"This link expires in 1 hour. If you didn't request this, ignore this email.\n\n— The Arivu team"
    )
    html = f"""<!DOCTYPE html>
<html><body style="font-family:sans-serif;max-width:600px;margin:40px auto;color:#1a1a2e">
<h2 style="color:#D4A843">Confirm Email Change</h2>
<p>You requested to change your Arivu account email to this address.</p>
<a href="{confirm_url}" style="display:inline-block;padding:12px 24px;background:#D4A843;color:#0a0e17;text-decoration:none;border-radius:6px;font-weight:600;">Confirm email change</a>
<p style="margin-top:24px;font-size:13px;color:#64748B">This link expires in 1 hour.</p>
</body></html>"""
    return _send(new_email, "Confirm your new Arivu email address", text, html)
