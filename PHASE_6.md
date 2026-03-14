# PHASE 6 — Complete Authoritative Spec
## Version 2 — All 34 Gaps Resolved. Single source of truth.

> **This file supersedes PHASE_6.md, PHASE_6_ADDENDUM.md, and PHASE_6_ADDENDUM_V2.md.**
> Do not reference any of those three documents. Use only this file.

## Before You Start
1. Read `CLAUDE.md` — architecture non-negotiables apply throughout.
2. Read `CONTEXT.md` — verify Phase 5 is marked **Completed** before continuing.
3. **Phase 5 must be complete.** Run `python -m pytest tests/ -v` — all must pass.
4. **Arivu must be live at `arivu.app`** — Phase 6 features require the production URL.
5. **Apply all §0 backports before writing any Phase 6 code.**
6. **Gather all credentials listed in §3 before starting §4+.**

---

## What Phase 6 Produces

- **User accounts** — registration, login, email verification, password reset
- **Three-tier billing** — Free (10 graphs/month), Researcher ($8/month), Lab ($30/month)
- **Stripe Checkout + webhooks** — automated tier management, end-of-period cancellation
- **Persistent graph history** — Researcher/Lab users keep graph history across sessions
- **Graph usage limits** — Free registered users: 10 graphs/month (cache hits free); anonymous: 5/hour rate-limited
- **Email system** — verification, password reset, welcome, payment-failed emails via Resend
- **GDPR compliance** — cookie consent, data export, right to erasure, retention automation
- **hCaptcha** — brute-force protection after 5 failed login attempts
- **API key management** — Lab tier can create/list/revoke REST API keys
- **Feature gating** — tier-aware decorators on all premium routes
- **Independent Discovery Tracker** — detects simultaneous independent discoveries (F1.7)
- **Citation Shadow Detector** — finds hidden intellectual pillars (F1.5)
- **Research Field Fingerprinting** — structural radar profile of any field (F1.12)
- **The Serendipity Engine** — cross-domain structural analogs (F11.2)
- **Graph Memory persistence** — Researcher/Lab users' exploration saved across sessions
- **Pricing page** (`/pricing`) — three-column pricing table
- **Account settings page** (`/account`) — profile, email, password, billing, API keys, GDPR
- **Privacy policy** (`/privacy`) — GDPR-compliant disclosure
- **Auth templates** — login, register, verify-email, forgot-password, reset-password
- Nightly maintenance cron job scheduled on Koyeb

Nothing else. No Time Machine, no Geological Core Sample, no Lab Genealogy System, no Supervisor Dashboard, no Prediction Market, no Adversarial Reviewer.

---

## Files Changed / Created

### New files
```
backend/auth.py
backend/billing.py
backend/gdpr.py
backend/decorators.py
backend/captcha.py
backend/mailer.py
backend/independent_discovery.py
backend/citation_shadow.py
backend/field_fingerprint.py
backend/serendipity_engine.py
scripts/nightly_maintenance.py
scripts/migrate_phase6.py
tests/test_phase6.py
templates/auth/login.html
templates/auth/register.html
templates/auth/verify_email.html
templates/auth/forgot_password.html
templates/auth/reset_password.html
templates/pricing.html
templates/account.html
templates/privacy.html
static/js/account.js
static/css/auth.css
```

### Modified
```
app.py                  ← register auth Blueprint, add all Phase 6 routes,
                          _get_latest_graph_json helper, _inject_user before_request,
                          graph stream route: user_id linkage + cache-aware limit increment
backend/config.py       ← add STRIPE_*, RESEND_*, HCAPTCHA_*, ENABLE_AUTH
backend/rate_limiter.py ← add Phase 6 endpoint limits + anonymous graph limit
backend/session_manager.py ← get_session() respects expires_at
backend/db.py           ← add docstring to execute() re: rowcount
requirements.txt        ← add stripe, resend
.env.example            ← add Phase 6 vars
templates/base.html     ← cookie consent banner (Secure flag fix) + auth-aware nav
CONTEXT.md              ← Phase 6 → Completed
```

### Unchanged
```
backend/db.py (except docstring)
backend/models.py
backend/schemas.py
backend/r2_client.py
backend/nlp_pipeline.py
backend/graph_engine.py  ← no graphs_this_month increment here (handled by stream route)
backend/export_generator.py
backend/living_paper_scorer.py
backend/originality_mapper.py
backend/paradigm_detector.py
backend/quality_monitor.py
All Phase 1-5 tests
scripts/migrate.py
scripts/precompute_gallery.py
```

---

## Architecture Reminders

- The main Koyeb server **may never** import `sentence_transformers`, `torch`, or ML model libraries.
- Intelligence features use **only** pre-computed embeddings from `paper_embeddings` via pgvector.
- Auth system uses **PostgreSQL sessions** (existing `sessions` table extended). Not Flask-Login, not JWT.
- **Stripe webhooks:** always use `request.data` (raw bytes) for signature verification — never `request.json`.
- **`graphs_this_month` increment** lives in the **stream route** (after cache miss confirmed), NOT in the `@check_graph_limit` decorator. The decorator only checks; the stream route increments.
- **`STRIPE_ENABLED` and `EMAIL_ENABLED`** are lowercase classmethods (`Config.stripe_enabled()`) to prevent the truthy-method bug of calling without parentheses.

---

## §0 — Backports (Apply Before Any Phase 6 Code)

### §0.1 — sessions table: Add user_id and expiry columns

```bash
psql $DATABASE_URL -c "
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(user_id) ON DELETE SET NULL;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ip_address INET;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_agent TEXT;
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at) WHERE expires_at IS NOT NULL;
"
```

### §0.2 — session_manager.py: Respect expires_at in get_session()

Replace `get_session()` in `backend/session_manager.py`:

```python
def get_session(self, session_id: str) -> bool:
    """
    Validate session_id exists and has not expired.
    Phase 6: now checks expires_at column added in §0.1 migration.
    """
    if not session_id or len(session_id) > 64:
        return False
    row = db.fetchone(
        """
        SELECT session_id FROM sessions
        WHERE session_id = %s
          AND (expires_at IS NULL OR expires_at > NOW())
        """,
        (session_id,),
    )
    if not row:
        return False
    db.execute(
        "UPDATE sessions SET last_seen = NOW() WHERE session_id = %s",
        (session_id,),
    )
    return True
```

### §0.3 — Verify ENABLE_AUTH config flag exists

```bash
python -c "from backend.config import Config; print(Config.ENABLE_AUTH)"
# Local dev: False. Koyeb production: True (set as env var).
```

### §0.4 — requirements.txt: Add Phase 6 packages

```
stripe==8.11.0
resend==2.3.0
bcrypt==4.1.2   # already present from Phase 1 — verify
```

```bash
grep "bcrypt" requirements.txt   # must show bcrypt==4.1.2
```

### §0.5 — .env.example: Add Phase 6 vars

```bash
ENABLE_AUTH=false
HCAPTCHA_SITE_KEY=your_hcaptcha_site_key
HCAPTCHA_SECRET_KEY=your_hcaptcha_secret_key
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_RESEARCHER_PRICE_ID=price_...
STRIPE_LAB_PRICE_ID=price_...
RESEND_API_KEY=re_...
EMAIL_FROM=noreply@arivu.app
EMAIL_FROM_NAME=Arivu
CUSTOM_DOMAIN=arivu.app
```

### §0.6 — backend/auth.py and backend/gdpr.py: Phase 1 stubs

```bash
wc -l backend/auth.py backend/gdpr.py
# If <20 lines each — stubs. Phase 6 replaces entirely.
# If >20 lines — read before overwriting.
```

---

## §1 — Phase 6 DB Migration: scripts/migrate_phase6.py

```python
#!/usr/bin/env python3
"""
scripts/migrate_phase6.py
Phase 6 DB schema additions. Safe to re-run (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
Usage: python scripts/migrate_phase6.py
"""
import sys
import os
import logging
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

PHASE_6_SQL = """
-- ── Users table ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    user_id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email               TEXT        UNIQUE NOT NULL,
    email_verified      BOOLEAN     NOT NULL DEFAULT FALSE,
    password_hash       TEXT        NOT NULL,
    display_name        TEXT,
    institution         TEXT,
    role                TEXT        DEFAULT 'researcher',
    tier                TEXT        NOT NULL DEFAULT 'free'
                        CHECK(tier IN ('free', 'researcher', 'lab')),
    tier_expires_at     TIMESTAMPTZ,
    stripe_customer_id  TEXT        UNIQUE,
    graphs_this_month   INT         NOT NULL DEFAULT 0,
    usage_reset_at      TIMESTAMPTZ NOT NULL
                        DEFAULT DATE_TRUNC('month', NOW()) + INTERVAL '1 month',
    failed_login_count  INT         NOT NULL DEFAULT 0,
    locked_until        TIMESTAMPTZ,
    last_login_at       TIMESTAMPTZ,
    marketing_consent           BOOLEAN NOT NULL DEFAULT FALSE,
    data_processing_consent     BOOLEAN NOT NULL DEFAULT TRUE,
    gdpr_deletion_requested_at  TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_email        ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_stripe       ON users(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_users_tier         ON users(tier);
CREATE INDEX IF NOT EXISTS idx_users_gdpr_pending ON users(gdpr_deletion_requested_at)
    WHERE gdpr_deletion_requested_at IS NOT NULL;

-- ── Email verification tokens ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_verification_tokens (
    token_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    token       TEXT        UNIQUE NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
    used_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_evtokens_user    ON email_verification_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_evtokens_token   ON email_verification_tokens(token);
CREATE INDEX IF NOT EXISTS idx_evtokens_expires ON email_verification_tokens(expires_at);

-- ── Password reset tokens ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    token_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    token       TEXT        UNIQUE NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '1 hour',
    used_at     TIMESTAMPTZ,
    ip_address  INET
);
CREATE INDEX IF NOT EXISTS idx_prtokens_user    ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_prtokens_token   ON password_reset_tokens(token);
CREATE INDEX IF NOT EXISTS idx_prtokens_expires ON password_reset_tokens(expires_at);

-- ── Lab memberships ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lab_memberships (
    membership_id   UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    lab_user_id     UUID    NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    member_user_id  UUID    NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    role            TEXT    NOT NULL DEFAULT 'member' CHECK(role IN ('owner', 'member')),
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(lab_user_id, member_user_id)
);
CREATE INDEX IF NOT EXISTS idx_lab_members_lab    ON lab_memberships(lab_user_id);
CREATE INDEX IF NOT EXISTS idx_lab_members_member ON lab_memberships(member_user_id);

-- ── API keys (Lab tier only) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_keys (
    key_id       UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID    NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    key_hash     TEXT    UNIQUE NOT NULL,
    key_prefix   TEXT    NOT NULL,     -- first 8 chars shown in UI
    label        TEXT,
    scopes       TEXT[]  NOT NULL DEFAULT ARRAY['read'],
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    expires_at   TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_api_keys_user   ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash   ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(user_id)
    WHERE revoked_at IS NULL;

-- ── sessions table: extend with user_id ──────────────────────────────────────
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_id     UUID REFERENCES users(user_id) ON DELETE SET NULL;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS expires_at  TIMESTAMPTZ;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ip_address  INET;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_agent  TEXT;
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)
    WHERE expires_at IS NOT NULL;

-- ── graphs table: link to users ───────────────────────────────────────────────
ALTER TABLE graphs ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(user_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_graphs_user ON graphs(user_id, created_at DESC);

-- ── papers table: publication_date for precise months_apart calculation ───────
ALTER TABLE papers ADD COLUMN IF NOT EXISTS publication_date DATE;

-- ── graph_memory: per-user exploration state ──────────────────────────────────
CREATE TABLE IF NOT EXISTS graph_memory (
    id          SERIAL      PRIMARY KEY,
    user_id     UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    graph_id    TEXT        NOT NULL,
    memory_json JSONB       NOT NULL DEFAULT '{}',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, graph_id)
);
CREATE INDEX IF NOT EXISTS idx_graph_memory_user  ON graph_memory(user_id);
CREATE INDEX IF NOT EXISTS idx_graph_memory_graph ON graph_memory(graph_id);

-- ── consent log (GDPR audit trail) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS consent_log (
    id           SERIAL      PRIMARY KEY,
    user_id      UUID        REFERENCES users(user_id) ON DELETE SET NULL,
    session_id   TEXT,
    consent_type TEXT        NOT NULL,
    ip_address   INET,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_consent_user    ON consent_log(user_id);
CREATE INDEX IF NOT EXISTS idx_consent_session ON consent_log(session_id);
"""


def run():
    from dotenv import load_dotenv
    load_dotenv()
    import backend.db as db
    from backend.config import Config
    db.init_pool(database_url=Config.DATABASE_URL)
    logger.info("Running Phase 6 migrations...")
    try:
        db.execute(PHASE_6_SQL)
        logger.info("✅ Phase 6 schema applied successfully.")
    except Exception as exc:
        logger.error(f"Migration failed: {exc}")
        sys.exit(1)

    expected_tables = [
        "users", "email_verification_tokens", "password_reset_tokens",
        "lab_memberships", "api_keys", "graph_memory", "consent_log",
    ]
    rows = db.fetchall(
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_schema='public' AND table_name = ANY(%s)",
        (expected_tables,),
    )
    found   = {r["table_name"] for r in rows}
    missing = set(expected_tables) - found
    if missing:
        logger.error(f"Missing tables after migration: {missing}")
        sys.exit(1)
    logger.info(f"Verified {len(expected_tables)} tables. Phase 6 migration complete.")


if __name__ == "__main__":
    run()
```

Run immediately:
```bash
python scripts/migrate_phase6.py
# Expected: ✅ Phase 6 schema applied successfully.
```

---

## §2 — Account Setup (Human Steps Before §4+)

### §2.1 — hCaptcha
1. Register at https://hcaptcha.com → Add site: `arivu.app` + `localhost`
2. Copy Site Key → `HCAPTCHA_SITE_KEY`, Secret Key → `HCAPTCHA_SECRET_KEY`

### §2.2 — Resend
1. Register at https://resend.com → Verify domain `arivu.app` (SPF + DKIM)
2. Create API key → `RESEND_API_KEY`, set `EMAIL_FROM=noreply@arivu.app`

### §2.3 — Stripe
1. Register at https://stripe.com → **test mode first**
2. Create two products: "Researcher" ($8/month) → `STRIPE_RESEARCHER_PRICE_ID`, "Lab" ($30/month) → `STRIPE_LAB_PRICE_ID`
3. Create webhook: URL `https://arivu.app/webhooks/stripe`, events: `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed` → `STRIPE_WEBHOOK_SECRET`
4. Copy keys → `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`

### §2.4 — Koyeb environment variables
Add all Phase 6 env vars. Set `ENABLE_AUTH=true` **last** — only after everything is tested.

---

## §3 — backend/config.py Additions

```python
    # ── Phase 6 — Auth, Billing, Email ───────────────────────────────────────
    ENABLE_AUTH          = os.environ.get("ENABLE_AUTH", "false").lower() == "true"

    HCAPTCHA_SITE_KEY    = os.environ.get("HCAPTCHA_SITE_KEY", "")
    HCAPTCHA_SECRET_KEY  = os.environ.get("HCAPTCHA_SECRET_KEY", "")

    STRIPE_SECRET_KEY           = os.environ.get("STRIPE_SECRET_KEY", "")
    STRIPE_PUBLISHABLE_KEY      = os.environ.get("STRIPE_PUBLISHABLE_KEY", "")
    STRIPE_WEBHOOK_SECRET       = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
    STRIPE_RESEARCHER_PRICE_ID  = os.environ.get("STRIPE_RESEARCHER_PRICE_ID", "")
    STRIPE_LAB_PRICE_ID         = os.environ.get("STRIPE_LAB_PRICE_ID", "")

    RESEND_API_KEY   = os.environ.get("RESEND_API_KEY", "")
    EMAIL_FROM       = os.environ.get("EMAIL_FROM", "noreply@arivu.app")
    EMAIL_FROM_NAME  = os.environ.get("EMAIL_FROM_NAME", "Arivu")

    CUSTOM_DOMAIN    = os.environ.get("CUSTOM_DOMAIN", "arivu.app")

    @classmethod
    def stripe_enabled(cls) -> bool:
        """Always call as Config.stripe_enabled() — lowercase to prevent bare truthy bug."""
        return bool(cls.STRIPE_SECRET_KEY and cls.STRIPE_WEBHOOK_SECRET)

    @classmethod
    def email_enabled(cls) -> bool:
        """Always call as Config.email_enabled() — lowercase to prevent bare truthy bug."""
        return bool(cls.RESEND_API_KEY)
```

Also add to `Config.validate()` warnings:
```python
        if Config.ENABLE_AUTH:
            for var, msg in {
                "STRIPE_SECRET_KEY":  "Billing disabled",
                "RESEND_API_KEY":     "Email disabled — auth emails will fail",
                "HCAPTCHA_SITE_KEY":  "hCaptcha disabled",
            }.items():
                if not getattr(cls, var, ""):
                    logger.warning(f"Config: {var} not set — {msg}")
```

---

## §4 — backend/captcha.py

```python
"""
backend/captcha.py — hCaptcha verification wrapper.
Used by /login (after 5 failed attempts) and /register.
"""
import logging
import httpx
from backend.config import Config

logger = logging.getLogger(__name__)
HCAPTCHA_VERIFY_URL = "https://hcaptcha.com/siteverify"


def verify_captcha(token: str, remote_ip: str = "") -> bool:
    if not Config.HCAPTCHA_SECRET_KEY:
        logger.warning("hCaptcha not configured — bypassing (dev mode only)")
        return True
    if not token:
        return False
    try:
        resp = httpx.post(
            HCAPTCHA_VERIFY_URL,
            data={"secret": Config.HCAPTCHA_SECRET_KEY, "response": token, "remoteip": remote_ip or ""},
            timeout=5.0,
        )
        data = resp.json()
        success = data.get("success", False)
        if not success:
            logger.debug(f"hCaptcha failed: {data.get('error-codes', [])}")
        return success
    except Exception as exc:
        logger.warning(f"hCaptcha verification failed: {exc} — failing closed")
        return False


def captcha_required(user_failed_count: int) -> bool:
    return user_failed_count >= 5
```

---

## §5 — backend/mailer.py

```python
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
        f"1. Free accounts can build 10 graphs per month.\n"
        f"2. Every graph is cached — re-visiting the same paper is instant and free.\n"
        f"3. Try 'Attention Is All You Need' first — it's precomputed and loads immediately.\n"
        f"4. The pruning animation is the best entry point. Click any node in the graph.\n\n"
        f"If you have questions, reply to this email.\n\n— Dev"
    )
    html = f"""<!DOCTYPE html>
<html><body style="font-family:sans-serif;max-width:600px;margin:40px auto;color:#1a1a2e">
<h2 style="color:#D4A843">Welcome to Arivu, {name}!</h2>
<ol>
  <li>Free accounts: <strong>10 graphs per month</strong>. Cached graphs are free.</li>
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
```

---

## §6 — backend/decorators.py

```python
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
```

---

## §7 — backend/auth.py (complete)

```python
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
        # db.execute() returns cursor.rowcount — see backend/db.py
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
```

---

## §8 — backend/billing.py

```python
"""
backend/billing.py — Stripe integration.

CRITICAL: Use request.data (raw bytes) for webhook verification — NEVER request.json.
Cancellation policy: subscription.deleted sets tier_expires_at to period end.
  The nightly job handles the actual downgrade when tier_expires_at < NOW().
"""
import logging
import stripe
import backend.db as db
from backend.config import Config

logger = logging.getLogger(__name__)


def _get_tier_by_price_id() -> dict:
    return {
        Config.STRIPE_RESEARCHER_PRICE_ID: "researcher",
        Config.STRIPE_LAB_PRICE_ID:        "lab",
    }


def create_checkout_session(user_id: str, user_email: str, tier: str) -> str:
    stripe.api_key = Config.STRIPE_SECRET_KEY
    price_id = {"researcher": Config.STRIPE_RESEARCHER_PRICE_ID,
                 "lab":        Config.STRIPE_LAB_PRICE_ID}.get(tier)
    if not price_id:
        raise ValueError(f"Unknown tier: {tier!r}")

    customer_id = _ensure_stripe_customer(user_id, user_email)
    session = stripe.checkout.Session.create(
        customer=customer_id,
        payment_method_types=["card"],
        mode="subscription",
        line_items=[{"price": price_id, "quantity": 1}],
        success_url=f"https://{Config.CUSTOM_DOMAIN}/account?upgraded=1",
        cancel_url=f"https://{Config.CUSTOM_DOMAIN}/pricing",
        allow_promotion_codes=True,
        metadata={"user_id": user_id, "tier": tier},
    )
    logger.info(f"Checkout session created for user={user_id} tier={tier}")
    return session.url


def create_portal_session(user_id: str) -> str:
    stripe.api_key = Config.STRIPE_SECRET_KEY
    user = db.fetchone("SELECT stripe_customer_id FROM users WHERE user_id = %s::uuid", (user_id,))
    if not user or not user.get("stripe_customer_id"):
        raise ValueError("User has no Stripe customer ID")
    session = stripe.billing_portal.Session.create(
        customer=user["stripe_customer_id"],
        return_url=f"https://{Config.CUSTOM_DOMAIN}/account",
    )
    return session.url


def handle_webhook(raw_body: bytes, signature: str) -> dict:
    """
    raw_body: request.data (bytes) — NEVER parsed JSON.
    signature: request.headers['Stripe-Signature']
    """
    stripe.api_key = Config.STRIPE_SECRET_KEY
    try:
        event = stripe.Webhook.construct_event(
            raw_body, signature, Config.STRIPE_WEBHOOK_SECRET
        )
    except stripe.error.SignatureVerificationError:
        logger.warning("Stripe webhook: invalid signature")
        raise

    event_type = event["type"]
    obj        = event["data"]["object"]

    if event_type in ("customer.subscription.created", "customer.subscription.updated"):
        _handle_subscription_change(obj)

    elif event_type == "customer.subscription.deleted":
        customer_id = obj.get("customer")
        if customer_id:
            # Honour paid period: set tier_expires_at to period end.
            # Nightly maintenance downgrades to free when that time passes.
            period_end = obj.get("current_period_end")
            if period_end:
                from datetime import datetime, timezone
                expires_at = datetime.fromtimestamp(period_end, tz=timezone.utc)
                db.execute(
                    "UPDATE users SET tier_expires_at = %s WHERE stripe_customer_id = %s",
                    (expires_at, customer_id),
                )
                logger.info(f"Subscription cancelled for customer={customer_id}, access until {expires_at}")
            else:
                db.execute(
                    "UPDATE users SET tier = 'free', tier_expires_at = NULL "
                    "WHERE stripe_customer_id = %s",
                    (customer_id,),
                )
                logger.info(f"Subscription deleted (no period_end) for customer={customer_id}")

    elif event_type == "invoice.payment_failed":
        customer_id = obj.get("customer")
        if customer_id:
            db.execute(
                "UPDATE users SET tier_expires_at = NOW() + INTERVAL '3 days' "
                "WHERE stripe_customer_id = %s",
                (customer_id,),
            )
            user = db.fetchone(
                "SELECT email, display_name, tier FROM users WHERE stripe_customer_id = %s",
                (customer_id,),
            )
            if user:
                from backend.mailer import send_payment_failed_email
                send_payment_failed_email(
                    user["email"], user.get("display_name", ""), user.get("tier", "paid")
                )
            logger.warning(f"Payment failed for customer={customer_id} — 3-day grace, email sent")
    else:
        logger.debug(f"Stripe webhook: unhandled event {event_type!r}")

    return {"ok": True}


def _handle_subscription_change(subscription: dict):
    customer_id = subscription.get("customer")
    status      = subscription.get("status")
    if status not in ("active", "trialing"):
        return

    items = subscription.get("items", {}).get("data", [])
    tier  = None
    for item in items:
        price_id = item.get("price", {}).get("id", "")
        tier_map = _get_tier_by_price_id()
        if price_id in tier_map:
            tier = tier_map[price_id]
            break

    if not tier:
        logger.warning(f"Unknown price in subscription for customer={customer_id}")
        return

    period_end = subscription.get("current_period_end")
    expires_at = None
    if period_end:
        from datetime import datetime, timezone
        expires_at = datetime.fromtimestamp(period_end, tz=timezone.utc)

    db.execute(
        "UPDATE users SET tier = %s, tier_expires_at = %s WHERE stripe_customer_id = %s",
        (tier, expires_at, customer_id),
    )
    logger.info(f"Tier updated: customer={customer_id} → {tier} (expires {expires_at})")


def _ensure_stripe_customer(user_id: str, email: str) -> str:
    stripe.api_key = Config.STRIPE_SECRET_KEY
    user = db.fetchone(
        "SELECT stripe_customer_id FROM users WHERE user_id = %s::uuid", (user_id,)
    )
    if user and user.get("stripe_customer_id"):
        return user["stripe_customer_id"]
    customer = stripe.Customer.create(email=email, metadata={"arivu_user_id": user_id})
    db.execute(
        "UPDATE users SET stripe_customer_id = %s WHERE user_id = %s::uuid",
        (customer.id, user_id),
    )
    return customer.id
```

---

## §9 — backend/gdpr.py

```python
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

        feedback = db.fetchall(
            "SELECT source_id, target_id, reason, created_at FROM edge_flags "
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
```

---

## §10 — Intelligence Modules

### §10.1 — backend/independent_discovery.py (F1.7)

```python
"""
backend/independent_discovery.py — IndependentDiscoveryTracker

Detection criteria (ALL must be true):
  1. High semantic similarity (>= SIMILARITY_THRESHOLD)
  2. No citation relationship in either direction
  3. Publication dates within CONVERGENCE_WINDOW_MONTHS of each other
  4. Authors from different institutions (skipped if data unavailable, lowers confidence)

Uses pre-computed embeddings from paper_embeddings via pgvector. No NLP worker calls.
shared_concept descriptions generated via single batched LLM call (falls back to template).
"""
import logging
import math
import re
from dataclasses import dataclass
from typing import Optional

import backend.db as db

logger = logging.getLogger(__name__)

SIMILARITY_THRESHOLD      = 0.72
CONVERGENCE_WINDOW_MONTHS = 24
MAX_PAIRS_RETURNED        = 10


def _extract_institutions(node: dict) -> set:
    """Extract institution names from a graph node's authors field."""
    institutions = set()
    for author in node.get("authors", []):
        if isinstance(author, dict):
            for affiliation in author.get("affiliations", []):
                if isinstance(affiliation, dict):
                    name = affiliation.get("name", "").strip().lower()
                elif isinstance(affiliation, str):
                    name = affiliation.strip().lower()
                else:
                    continue
                if name:
                    institutions.add(name)
    return institutions


@dataclass
class DiscoveryPair:
    paper_a_id:     str
    paper_b_id:     str
    paper_a_title:  str
    paper_b_title:  str
    paper_a_year:   Optional[int]
    paper_b_year:   Optional[int]
    similarity:     float
    months_apart:   int
    date_precision: str   # "month" | "year"
    shared_concept: str
    confidence:     str   # "high" | "medium" | "low"

    def to_dict(self) -> dict:
        return {
            "paper_a_id":     self.paper_a_id,
            "paper_b_id":     self.paper_b_id,
            "paper_a_title":  self.paper_a_title,
            "paper_b_title":  self.paper_b_title,
            "paper_a_year":   self.paper_a_year,
            "paper_b_year":   self.paper_b_year,
            "similarity":     round(self.similarity, 3),
            "months_apart":   self.months_apart,
            "date_precision": self.date_precision,
            "shared_concept": self.shared_concept,
            "confidence":     self.confidence,
        }


class IndependentDiscoveryTracker:
    """Stateless — instantiate fresh per request."""

    def find_independent_discoveries(self, graph_json: dict) -> list[DiscoveryPair]:
        nodes = graph_json.get("nodes", [])
        edges = graph_json.get("edges", [])

        if len(nodes) < 2:
            return []

        cited_pairs: set = set()
        for edge in edges:
            src = edge.get("source") or edge.get("citing_paper_id", "")
            tgt = edge.get("target") or edge.get("cited_paper_id", "")
            if src and tgt:
                cited_pairs.add((src, tgt))
                cited_pairs.add((tgt, src))

        node_by_id = {n["id"]: n for n in nodes}
        node_ids   = [n["id"] for n in nodes if n.get("year")]

        if not node_ids:
            return []

        rows = db.fetchall(
            "SELECT paper_id, embedding FROM paper_embeddings WHERE paper_id = ANY(%s)",
            (node_ids,),
        )
        embeddings = {r["paper_id"]: r["embedding"] for r in rows if r.get("embedding")}

        if len(embeddings) < 2:
            return []

        pairs: list[DiscoveryPair] = []
        ids_with_emb = list(embeddings.keys())

        for i, id_a in enumerate(ids_with_emb):
            for id_b in ids_with_emb[i+1:]:
                if (id_a, id_b) in cited_pairs:
                    continue

                node_a = node_by_id.get(id_a, {})
                node_b = node_by_id.get(id_b, {})
                year_a = node_a.get("year")
                year_b = node_b.get("year")

                if not year_a or not year_b:
                    continue

                # Criterion 3: publication date proximity
                pub_date_a = node_a.get("publication_date")
                pub_date_b = node_b.get("publication_date")
                date_precision = "year"
                if pub_date_a and pub_date_b:
                    try:
                        from datetime import datetime
                        d_a = datetime.strptime(pub_date_a[:7], "%Y-%m")
                        d_b = datetime.strptime(pub_date_b[:7], "%Y-%m")
                        months_apart = abs((d_a.year - d_b.year) * 12 + (d_a.month - d_b.month))
                        date_precision = "month"
                    except ValueError:
                        months_apart = abs((year_a - year_b) * 12)
                else:
                    months_apart = abs((year_a - year_b) * 12)

                if months_apart > CONVERGENCE_WINDOW_MONTHS:
                    continue

                # Criterion 4: different institutions
                inst_a = _extract_institutions(node_a)
                inst_b = _extract_institutions(node_b)
                institution_data_available = bool(inst_a and inst_b)
                if institution_data_available and inst_a == inst_b:
                    continue   # same institution — skip

                # Criterion 2: semantic similarity
                sim = self._cosine_similarity(embeddings[id_a], embeddings[id_b])
                if sim < SIMILARITY_THRESHOLD:
                    continue

                # Confidence
                if months_apart <= 6 and institution_data_available:
                    confidence = "high"
                elif months_apart <= 12:
                    confidence = "medium"
                else:
                    confidence = "low"
                if not institution_data_available and confidence == "high":
                    confidence = "medium"

                pairs.append(DiscoveryPair(
                    paper_a_id=id_a, paper_b_id=id_b,
                    paper_a_title=node_a.get("title", "Unknown"),
                    paper_b_title=node_b.get("title", "Unknown"),
                    paper_a_year=year_a, paper_b_year=year_b,
                    similarity=sim, months_apart=months_apart,
                    date_precision=date_precision,
                    shared_concept="",   # filled by batch LLM below
                    confidence=confidence,
                ))

        pairs.sort(key=lambda p: p.similarity, reverse=True)
        top_pairs = pairs[:MAX_PAIRS_RETURNED]

        # Generate shared_concept descriptions via single LLM call
        concepts = self._generate_shared_concepts_batch(top_pairs, node_by_id)
        for pair, concept in zip(top_pairs, concepts):
            pair.shared_concept = concept

        return top_pairs

    def _generate_shared_concepts_batch(self, pairs: list, node_by_id: dict) -> list[str]:
        """Single LLM call for all pairs. Falls back to template on failure."""
        if not pairs:
            return []
        try:
            from backend.llm_client import LLMClient
            client = LLMClient()
            descriptions = []
            for i, pair in enumerate(pairs):
                descriptions.append(
                    f"{i+1}. Paper A: \"{pair.paper_a_title}\" ({pair.paper_a_year})\n"
                    f"   Paper B: \"{pair.paper_b_title}\" ({pair.paper_b_year})\n"
                    f"   Similarity: {pair.similarity:.2f}, {pair.months_apart} months apart"
                )
            prompt = (
                "The following pairs of papers appear to be independent simultaneous discoveries. "
                "For each pair, write one concise sentence (max 20 words) describing the shared "
                "intellectual contribution. Focus on the specific problem both solved.\n\n"
                + "\n".join(descriptions)
                + "\n\nRespond with exactly one numbered line per pair. No preamble."
            )
            result   = client.call_llm(prompt, max_tokens=400)
            lines    = [l.strip() for l in result.strip().split("\n") if l.strip()]
            concepts = [re.sub(r"^\d+\.\s*", "", line) for line in lines]
            while len(concepts) < len(pairs):
                idx = len(concepts)
                concepts.append(self._infer_shared_concept_fallback(
                    node_by_id.get(pairs[idx].paper_a_id, {}),
                    node_by_id.get(pairs[idx].paper_b_id, {}),
                ))
            return concepts[:len(pairs)]
        except Exception as exc:
            logger.warning(f"LLM batch concept generation failed: {exc} — using fallbacks")
            return [
                self._infer_shared_concept_fallback(
                    node_by_id.get(p.paper_a_id, {}),
                    node_by_id.get(p.paper_b_id, {}),
                )
                for p in pairs
            ]

    def _infer_shared_concept_fallback(self, node_a: dict, node_b: dict) -> str:
        fields_a = set(node_a.get("fields_of_study", []))
        fields_b = set(node_b.get("fields_of_study", []))
        shared   = fields_a & fields_b
        field_str = next(iter(shared), "multiple fields") if shared else "different fields"
        return f"Simultaneous contribution to {field_str} — no citation relationship found."

    @staticmethod
    def _cosine_similarity(a, b) -> float:
        try:
            if hasattr(a, "tolist"): a = a.tolist()
            if hasattr(b, "tolist"): b = b.tolist()
            dot   = sum(x * y for x, y in zip(a, b))
            mag_a = math.sqrt(sum(x * x for x in a))
            mag_b = math.sqrt(sum(x * x for x in b))
            if mag_a == 0 or mag_b == 0: return 0.0
            return dot / (mag_a * mag_b)
        except Exception:
            return 0.0
```

### §10.2 — backend/citation_shadow.py (F1.5)

```python
"""
backend/citation_shadow.py — CitationShadowDetector
Shadow score = indirect_descendants / (direct_citations + 1)
High score = foundational but under-recognized in direct citations.
"""
import logging
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)
MIN_DIRECT_CITATIONS = 2
MIN_SHADOW_SCORE     = 2.0
MAX_RESULTS          = 15


@dataclass
class ShadowPaper:
    paper_id:             str
    title:                str
    year:                 Optional[int]
    direct_citations:     int
    indirect_descendants: int
    shadow_score:         float
    citation_count:       int

    def to_dict(self) -> dict:
        return {
            "paper_id":             self.paper_id,
            "title":                self.title,
            "year":                 self.year,
            "direct_citations":     self.direct_citations,
            "indirect_descendants": self.indirect_descendants,
            "shadow_score":         round(self.shadow_score, 2),
            "citation_count":       self.citation_count,
        }


class CitationShadowDetector:
    def detect_shadows(self, graph_json: dict) -> list[ShadowPaper]:
        try:
            import networkx as nx
        except ImportError:
            logger.error("networkx not installed")
            return []

        nodes = graph_json.get("nodes", [])
        edges = graph_json.get("edges", [])
        if len(nodes) < 3:
            return []

        node_by_id = {n["id"]: n for n in nodes}
        G = nx.DiGraph()
        for node in nodes:
            G.add_node(node["id"])
        for edge in edges:
            src = edge.get("source") or edge.get("citing_paper_id", "")
            tgt = edge.get("target") or edge.get("cited_paper_id", "")
            if src and tgt and src in G and tgt in G:
                G.add_edge(src, tgt)

        results: list[ShadowPaper] = []
        for node_id in G.nodes():
            direct = G.in_degree(node_id)
            if direct < MIN_DIRECT_CITATIONS:
                continue
            try:
                descendants = len(nx.descendants(G, node_id))
            except Exception:
                descendants = 0
            indirect = max(0, descendants - direct)
            shadow   = indirect / (direct + 1)
            if shadow < MIN_SHADOW_SCORE:
                continue
            node = node_by_id.get(node_id, {})
            results.append(ShadowPaper(
                paper_id=node_id, title=node.get("title", "Unknown"),
                year=node.get("year"), direct_citations=direct,
                indirect_descendants=indirect, shadow_score=shadow,
                citation_count=node.get("citation_count", 0) or 0,
            ))

        results.sort(key=lambda p: p.shadow_score, reverse=True)
        return results[:MAX_RESULTS]
```

### §10.3 — backend/field_fingerprint.py (F1.12)

```python
"""
backend/field_fingerprint.py — FieldFingerprintAnalyzer
Five-dimension structural profile of a research field. All scores 0-1 for radar chart.
"""
import logging
from dataclasses import dataclass
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


@dataclass
class FieldFingerprint:
    seed_paper_id:            str
    bottleneck_concentration: float
    cross_domain_rate:        float
    idea_velocity:            float
    paradigm_fragility:       float
    temporal_depth:           float
    summary:                  str

    def to_dict(self) -> dict:
        return {
            "seed_paper_id": self.seed_paper_id,
            "dimensions": {
                "bottleneck_concentration": round(self.bottleneck_concentration, 3),
                "cross_domain_rate":        round(self.cross_domain_rate, 3),
                "idea_velocity":            round(self.idea_velocity, 3),
                "paradigm_fragility":       round(self.paradigm_fragility, 3),
                "temporal_depth":           round(self.temporal_depth, 3),
            },
            "radar_labels": [
                "Bottleneck Concentration", "Cross-Domain Influx",
                "Idea Velocity", "Paradigm Fragility", "Temporal Depth",
            ],
            "summary": self.summary,
        }


class FieldFingerprintAnalyzer:
    def analyze(self, graph_json: dict) -> FieldFingerprint:
        nodes   = graph_json.get("nodes", [])
        edges   = graph_json.get("edges", [])
        seed_id = graph_json.get("metadata", {}).get("seed_paper_id", "unknown")

        if not nodes:
            return FieldFingerprint(
                seed_paper_id=seed_id,
                bottleneck_concentration=0.0, cross_domain_rate=0.0,
                idea_velocity=0.0, paradigm_fragility=0.0, temporal_depth=0.0,
                summary="Graph is empty — no fingerprint available.",
            )

        node_by_id = {n["id"]: n for n in nodes}

        bottleneck_count         = sum(1 for n in nodes if n.get("is_bottleneck"))
        bottleneck_concentration = min(1.0, (bottleneck_count / max(len(nodes), 1)) / 0.2)

        cross_domain = sum(
            1 for edge in edges
            if (set(node_by_id.get(edge.get("source", ""), {}).get("fields_of_study", [])) and
                set(node_by_id.get(edge.get("target", ""), {}).get("fields_of_study", [])) and
                not set(node_by_id.get(edge.get("source", ""), {}).get("fields_of_study", [])).intersection(
                    set(node_by_id.get(edge.get("target", ""), {}).get("fields_of_study", []))
                ))
        )
        cross_domain_rate = cross_domain / max(len(edges), 1)

        current_year = datetime.now(timezone.utc).year
        velocities   = []
        for node in nodes:
            year = node.get("year")
            cit  = node.get("citation_count", 0) or 0
            if year and year > 1990 and cit > 0:
                velocities.append(cit / max(1, current_year - year))
        idea_velocity = min(1.0, (sum(velocities) / len(velocities)) / 100.0) if velocities else 0.0

        impacts           = [n.get("pruning_impact", 0) or 0 for n in nodes]
        paradigm_fragility = min(1.0, max(impacts) / 0.40) if impacts else 0.0

        years = [n.get("year") for n in nodes if n.get("year")]
        temporal_depth = min(1.0, (current_year - min(years)) / 50.0) if len(years) >= 2 else 0.0

        parts = []
        if bottleneck_concentration > 0.6:
            parts.append("Cathedral-like structure with strong bottleneck nodes")
        elif bottleneck_concentration < 0.2:
            parts.append("Bazaar-like structure with distributed intellectual foundations")
        if cross_domain_rate > 0.3:
            parts.append(f"highly interdisciplinary ({cross_domain_rate:.0%} cross-domain citations)")
        elif cross_domain_rate < 0.1:
            parts.append("insular field (low cross-domain citation rate)")
        if idea_velocity > 0.6:
            parts.append("fast-moving research area")
        elif idea_velocity < 0.2:
            parts.append("slow-accumulation field")
        summary = (". ".join(parts).capitalize() + "." if parts else
                   "Moderate structural profile — no extreme characteristics detected.")

        return FieldFingerprint(
            seed_paper_id=seed_id,
            bottleneck_concentration=bottleneck_concentration,
            cross_domain_rate=cross_domain_rate,
            idea_velocity=idea_velocity,
            paradigm_fragility=paradigm_fragility,
            temporal_depth=temporal_depth,
            summary=summary,
        )
```

### §10.4 — backend/serendipity_engine.py (F11.2)

```python
"""
backend/serendipity_engine.py — SerendipityEngine
Finds structural analogs — papers in different fields solving the same mathematical problem.
Uses pgvector similarity search filtered by field-of-study distance.
"""
import logging
from dataclasses import dataclass
import backend.db as db

logger = logging.getLogger(__name__)
SIMILARITY_THRESHOLD  = 0.68
MAX_ANALOGS_PER_PAPER = 5
MAX_TOTAL_RESULTS     = 20


@dataclass
class StructuralAnalog:
    source_paper_id: str
    source_title:    str
    source_fields:   list
    analog_paper_id: str
    analog_title:    str
    analog_fields:   list
    similarity:      float
    field_distance:  float
    relevance_score: float
    insight:         str

    def to_dict(self) -> dict:
        return {
            "source_paper_id": self.source_paper_id,
            "source_title":    self.source_title,
            "source_fields":   self.source_fields,
            "analog_paper_id": self.analog_paper_id,
            "analog_title":    self.analog_title,
            "analog_fields":   self.analog_fields,
            "similarity":      round(self.similarity, 3),
            "field_distance":  round(self.field_distance, 3),
            "relevance_score": round(self.relevance_score, 3),
            "insight":         self.insight,
        }


class SerendipityEngine:
    def find_analogs(self, graph_json: dict) -> list[StructuralAnalog]:
        nodes = graph_json.get("nodes", [])
        if not nodes:
            return []

        node_by_id = {n["id"]: n for n in nodes}
        node_ids   = [n["id"] for n in nodes]

        rows = db.fetchall(
            "SELECT paper_id, embedding FROM paper_embeddings WHERE paper_id = ANY(%s)",
            (node_ids,),
        )
        graph_embeddings = {r["paper_id"]: r["embedding"] for r in rows if r.get("embedding")}

        results: list[StructuralAnalog] = []
        seen_pairs: set = set()

        for node in nodes:
            paper_id = node["id"]
            emb = graph_embeddings.get(paper_id)
            if not emb:
                continue
            paper_fields = set(node.get("fields_of_study", []))
            if not paper_fields:
                continue

            try:
                emb_list = emb.tolist() if hasattr(emb, "tolist") else list(emb)
                emb_str  = "[" + ",".join(str(x) for x in emb_list) + "]"
                similar_rows = db.fetchall(
                    """
                    SELECT p.paper_id, p.title, p.fields_of_study,
                           1 - (pe.embedding <=> %s::vector) AS similarity
                    FROM paper_embeddings pe
                    JOIN papers p ON p.paper_id = pe.paper_id
                    WHERE pe.paper_id != ALL(%s)
                      AND p.fields_of_study IS NOT NULL
                      AND p.fields_of_study != '[]'::jsonb
                      AND 1 - (pe.embedding <=> %s::vector) >= %s
                    ORDER BY pe.embedding <=> %s::vector
                    LIMIT 20
                    """,
                    (emb_str, node_ids, emb_str, SIMILARITY_THRESHOLD, emb_str),
                )
            except Exception as exc:
                logger.debug(f"pgvector search failed for {paper_id}: {exc}")
                continue

            count = 0
            for row in similar_rows:
                if count >= MAX_ANALOGS_PER_PAPER:
                    break
                analog_id     = row["paper_id"]
                analog_fields = set(row.get("fields_of_study") or [])
                if not analog_fields or paper_fields & analog_fields:
                    continue
                pair_key = tuple(sorted([paper_id, analog_id]))
                if pair_key in seen_pairs:
                    continue
                seen_pairs.add(pair_key)

                similarity  = float(row["similarity"])
                s_field     = list(paper_fields)[0] if paper_fields else "one field"
                a_field     = list(analog_fields)[0] if analog_fields else "another field"
                results.append(StructuralAnalog(
                    source_paper_id=paper_id, source_title=node.get("title", "Unknown"),
                    source_fields=list(paper_fields),
                    analog_paper_id=analog_id, analog_title=row.get("title", "Unknown"),
                    analog_fields=list(analog_fields),
                    similarity=similarity, field_distance=1.0,
                    relevance_score=similarity,
                    insight=(f"Papers in {s_field} and {a_field} appear to solve "
                             f"structurally similar problems — methods may transfer."),
                ))
                count += 1

        results.sort(key=lambda r: r.relevance_score, reverse=True)
        return results[:MAX_TOTAL_RESULTS]
```

---

## §11 — scripts/nightly_maintenance.py

```python
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

    n = db.execute(
        """
        UPDATE users SET graphs_this_month = 0,
          usage_reset_at = DATE_TRUNC('month', NOW()) + INTERVAL '1 month'
        WHERE usage_reset_at < NOW() AND tier = 'free'
        """
    )
    logger.info(f"  Reset monthly graph counters for {n} free-tier users")

    n = db.execute(
        """
        UPDATE users SET tier = 'free', tier_expires_at = NULL
        WHERE tier != 'free'
          AND tier_expires_at IS NOT NULL
          AND tier_expires_at < NOW()
        """
    )
    logger.info(f"  Downgraded {n} users with expired paid tiers to free")

    logger.info("Nightly maintenance complete.")


if __name__ == "__main__":
    run()
```

### §11.1 — Scheduling on Koyeb

Create a Koyeb **Job** service using the same git repo as the main web service.

| Setting | Value |
|---------|-------|
| Service type | Job |
| Command | `python scripts/nightly_maintenance.py` |
| Schedule | `0 2 * * *` (02:00 UTC daily) |
| Environment | Same env vars as main service |

GDPR deletion SLA: requests processed within 24 hours (1-hour hold + ≤24-hour cron delay).
Note this in `/privacy`: *"Account deletion requests are processed within 24 hours."*

---

## §12 — app.py Additions

### §12.1 — Imports and Blueprint Registration

```python
# Add to top of app.py:
from backend.auth import auth_bp
from backend.billing import (create_checkout_session, create_portal_session, handle_webhook)
from backend.decorators import (require_auth, require_tier, check_graph_limit, get_current_user)
from backend.gdpr import generate_user_data_export, delete_user_account
from backend.independent_discovery import IndependentDiscoveryTracker
from backend.citation_shadow import CitationShadowDetector
from backend.field_fingerprint import FieldFingerprintAnalyzer
from backend.serendipity_engine import SerendipityEngine

# Inside create_app(), after existing setup:
app.register_blueprint(auth_bp)

# Initialize Resend once at startup
from backend.mailer import _init_resend
_init_resend()

# Inject current user into all templates
@app.before_request
def _inject_user():
    from backend.decorators import get_current_user
    g.user = get_current_user() if Config.ENABLE_AUTH else None
```

### §12.2 — Graph Stream Route: Cache-Aware Limit Increment + User Linkage

In the existing `/api/graph/stream` route, add after the cache-hit check returns early
and before `_background_build()` starts (i.e., only when a fresh build is starting):

```python
# --- Add inside /api/graph/stream AFTER cache miss is confirmed, BEFORE background thread ---

# Increment free-tier graph counter (cache miss = actual build = counts against limit)
if Config.ENABLE_AUTH:
    _stream_user = get_current_user()
    if _stream_user and _stream_user.get("tier") == "free":
        db.execute(
            "UPDATE users SET graphs_this_month = graphs_this_month + 1 "
            "WHERE user_id = %s::uuid",
            (str(_stream_user["user_id"]),),
        )
        # Note: counter is NOT rolled back if build fails. Failed builds still consumed
        # API capacity. Users who hit limit from failed builds can contact privacy@arivu.app.
```

After a graph_id is confirmed (background build completes or cache hit):

```python
# Link graph to authenticated user (enables persistent history for Researcher/Lab)
if Config.ENABLE_AUTH:
    _link_user = get_current_user()
    if _link_user:
        db.execute(
            "UPDATE graphs SET user_id = %s::uuid WHERE graph_id = %s",
            (str(_link_user["user_id"]), graph_id),
        )
```

### §12.3 — Helper: _get_latest_graph_json

Add this helper near the top of Phase 6 additions in app.py:

```python
def _get_latest_graph_json(session_id: str, user_id: str | None = None) -> dict | None:
    """
    Fetch the latest graph JSON for a request.
    Priority: session_id → user_id fallback.
    Returns parsed graph dict, or None if not found.
    Raises RuntimeError if R2 download fails.
    """
    from backend.r2_client import R2Client

    row = None
    if session_id:
        row = db.fetchone(
            """
            SELECT g.graph_json_url FROM graphs g
            JOIN session_graphs sg ON sg.graph_id = g.graph_id
            WHERE sg.session_id = %s ORDER BY g.created_at DESC LIMIT 1
            """,
            (session_id,),
        )
    if not row and user_id:
        row = db.fetchone(
            "SELECT graph_json_url FROM graphs WHERE user_id = %s::uuid "
            "ORDER BY created_at DESC LIMIT 1",
            (user_id,),
        )
    if not row:
        return None
    try:
        return R2Client().download_json(row["graph_json_url"])
    except Exception as exc:
        raise RuntimeError(f"R2 download failed: {exc}") from exc
```

### §12.4 — Page Routes

```python
@app.route("/pricing")
def pricing_page():
    user = get_current_user()
    return render_template("pricing.html", user=user)

@app.route("/account")
@require_auth
def account_page():
    return render_template("account.html", user=g.user)

@app.route("/privacy")
def privacy_page():
    return render_template("privacy.html")
```

### §12.5 — Account API Routes

```python
# ─── POST /api/account/profile ───────────────────────────────────────────────
@app.route("/api/account/profile", methods=["POST"])
@require_auth
def api_update_profile():
    data = request.get_json(silent=True) or {}
    if "email" in data:
        return jsonify({"error": "email_change_not_supported",
                        "message": "Email change is not available. Contact privacy@arivu.app."}), 400
    display_name = (data.get("display_name") or "").strip()[:100]
    institution  = (data.get("institution") or "").strip()[:200]
    role         = (data.get("role") or "").strip()[:50]
    db.execute(
        "UPDATE users SET display_name = %s, institution = %s, role = %s WHERE user_id = %s::uuid",
        (display_name or None, institution or None, role or None, g.user_id),
    )
    return jsonify({"success": True})


# ─── POST /api/account/password ──────────────────────────────────────────────
@app.route("/api/account/password", methods=["POST"])
@require_auth
def api_change_password():
    import bcrypt as _bcrypt
    data       = request.get_json(silent=True) or {}
    current_pw = data.get("current_password", "")
    new_pw     = data.get("new_password", "")
    if len(new_pw) < 8:
        return jsonify({"error": "password_too_short"}), 400
    user = db.fetchone("SELECT password_hash FROM users WHERE user_id = %s::uuid", (g.user_id,))
    if not _bcrypt.checkpw(current_pw.encode(), (user or {}).get("password_hash", "").encode()):
        return jsonify({"error": "wrong_current_password"}), 403
    new_hash = _bcrypt.hashpw(new_pw.encode(), _bcrypt.gensalt(rounds=12)).decode()
    db.execute("UPDATE users SET password_hash = %s WHERE user_id = %s::uuid", (new_hash, g.user_id))
    return jsonify({"success": True})


# ─── GET /api/usage ───────────────────────────────────────────────────────────
@app.route("/api/usage")
@require_auth
def api_usage():
    user = g.user
    return jsonify({
        "tier":              user.get("tier", "free"),
        "graphs_this_month": user.get("graphs_this_month", 0),
        "limit":             10 if user.get("tier") == "free" else None,
        "reset_at":          str(user.get("usage_reset_at", "")),
    })


# ─── POST /api/billing/checkout ──────────────────────────────────────────────
@app.route("/api/billing/checkout", methods=["POST"])
@require_auth
def api_billing_checkout():
    if not Config.stripe_enabled():
        return jsonify({"error": "Billing not configured"}), 503
    data = request.get_json(silent=True) or {}
    tier = data.get("tier", "")
    if tier not in ("researcher", "lab"):
        return jsonify({"error": "Invalid tier"}), 400
    try:
        url = create_checkout_session(g.user_id, g.user.get("email", ""), tier)
        return jsonify({"url": url})
    except Exception as exc:
        app.logger.error(f"Checkout session failed: {exc}")
        return jsonify({"error": "Could not create checkout session"}), 500


# ─── POST /api/billing/portal ─────────────────────────────────────────────────
@app.route("/api/billing/portal", methods=["POST"])
@require_auth
def api_billing_portal():
    if not Config.stripe_enabled():
        return jsonify({"error": "Billing not configured"}), 503
    try:
        url = create_portal_session(g.user_id)
        return jsonify({"url": url})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400


# ─── POST /webhooks/stripe ────────────────────────────────────────────────────
@app.route("/webhooks/stripe", methods=["POST"])
def stripe_webhook():
    raw_body  = request.data      # MUST use .data, not .json — for signature verification
    signature = request.headers.get("Stripe-Signature", "")
    if not Config.stripe_enabled():
        return jsonify({"error": "Billing not configured"}), 503
    try:
        result = handle_webhook(raw_body, signature)
        return jsonify(result)
    except Exception as exc:
        app.logger.warning(f"Stripe webhook failed: {exc}")
        return jsonify({"error": "Webhook processing failed"}), 400


# ─── GET /api/account/api-keys ───────────────────────────────────────────────
@app.route("/api/account/api-keys", methods=["GET"])
@require_auth
@require_tier("lab")
def api_list_api_keys():
    rows = db.fetchall(
        """
        SELECT key_id::text, key_prefix, label, scopes, created_at, last_used_at
        FROM api_keys WHERE user_id = %s::uuid AND revoked_at IS NULL
        ORDER BY created_at DESC
        """,
        (g.user_id,),
    )
    return jsonify({"keys": [dict(r) for r in rows]})


# ─── POST /api/account/api-keys ──────────────────────────────────────────────
@app.route("/api/account/api-keys", methods=["POST"])
@require_auth
@require_tier("lab")
def api_create_api_key():
    import hashlib, secrets as _secrets
    data      = request.get_json(silent=True) or {}
    label     = (data.get("label") or "").strip()[:100]
    raw_key   = "ak_" + _secrets.token_hex(32)
    key_hash  = hashlib.sha256(raw_key.encode()).hexdigest()
    key_prefix = raw_key[:8]    # 8 chars as documented in schema
    db.execute(
        "INSERT INTO api_keys (user_id, key_hash, key_prefix, label) VALUES (%s::uuid, %s, %s, %s)",
        (g.user_id, key_hash, key_prefix, label or None),
    )
    return jsonify({"key": raw_key, "prefix": key_prefix, "label": label,
                    "note": "Copy this key — it will never be shown again."})


# ─── DELETE /api/account/api-keys/<key_id> ───────────────────────────────────
@app.route("/api/account/api-keys/<key_id>", methods=["DELETE"])
@require_auth
@require_tier("lab")
def api_revoke_api_key(key_id: str):
    db.execute(
        "UPDATE api_keys SET revoked_at = NOW() WHERE key_id = %s::uuid AND user_id = %s::uuid",
        (key_id, g.user_id),
    )
    return jsonify({"success": True})


# ─── POST /api/account/export-data ───────────────────────────────────────────
@app.route("/api/account/export-data", methods=["POST"])
@require_auth
def api_request_data_export():
    from backend.mailer import send_data_export_ready
    try:
        url = generate_user_data_export(g.user_id)
        send_data_export_ready(g.user.get("email", ""), g.user.get("display_name", ""), url)
        return jsonify({"success": True,
                        "message": "Your data export is ready. Check your email for the download link."})
    except Exception as exc:
        app.logger.error(f"Data export failed: {exc}")
        return jsonify({"error": "Export generation failed"}), 500


# ─── POST /api/account/delete ─────────────────────────────────────────────────
@app.route("/api/account/delete", methods=["POST"])
@require_auth
def api_delete_account():
    import bcrypt as _bcrypt
    data         = request.get_json(silent=True) or {}
    confirmation = data.get("confirmation", "")
    password     = data.get("password", "")

    if confirmation != "DELETE MY ACCOUNT":
        return jsonify({"error": "confirmation_mismatch",
                        "message": "Type 'DELETE MY ACCOUNT' to confirm."}), 400

    user = db.fetchone("SELECT password_hash FROM users WHERE user_id = %s::uuid", (g.user_id,))
    if not _bcrypt.checkpw(password.encode(), (user or {}).get("password_hash", "").encode()):
        return jsonify({"error": "wrong_password"}), 403

    from backend.mailer import send_account_deletion_confirmation
    email = g.user.get("email", "")
    name  = g.user.get("display_name", "")

    success = delete_user_account(g.user_id)
    if success:
        if email and not email.startswith("deleted_"):
            send_account_deletion_confirmation(email, name)
        resp = make_response(jsonify({"success": True, "redirect": "/"}))
        resp.delete_cookie("arivu_session")
        return resp
    return jsonify({"error": "Account deletion failed — try again or contact support."}), 500


# ─── POST /api/consent ────────────────────────────────────────────────────────
@app.route("/api/consent", methods=["POST"])
def api_consent():
    data         = request.get_json(silent=True) or {}
    consent_type = data.get("consent_type", "necessary")
    if consent_type not in ("all", "necessary"):
        return jsonify({"error": "Invalid consent_type"}), 400
    ip         = request.headers.get("X-Forwarded-For", request.remote_addr or "")
    session_id = request.cookies.get("arivu_session", "")
    user       = get_current_user()
    user_id    = str(user["user_id"]) if user else None
    db.execute(
        "INSERT INTO consent_log (user_id, session_id, consent_type, ip_address) "
        "VALUES (%s::uuid, %s, %s, %s::inet)",
        (user_id, session_id or None, consent_type, ip or None),
    )
    if user_id:
        db.execute(
            "UPDATE users SET marketing_consent = %s WHERE user_id = %s::uuid",
            (consent_type == "all", user_id),
        )
    return jsonify({"success": True})
```

### §12.6 — Intelligence Routes

Feature gating reference:

| Route | Decorator Stack |
|-------|----------------|
| `/api/independent-discovery` | `@require_auth` |
| `/api/citation-shadow` | `@require_auth` |
| `/api/field-fingerprint/<seed_id>` | `@require_auth` + `@require_tier("researcher")` |
| `/api/serendipity/<paper_id>` | `@require_auth` + `@require_tier("researcher")` |
| `/api/graphs/history` | `@require_auth` + `@require_tier("researcher")` |
| `/api/graph-memory` (GET + POST) | `@require_auth` + `@require_tier("researcher")` |

```python
@app.route("/api/independent-discovery")
@require_auth
def api_independent_discovery():
    session_id = session_manager.get_session_id(request)
    allowed, headers = rate_limiter.check_sync(
        session_id or getattr(g, "user_id", "anon"), "GET /api/independent-discovery"
    )
    if not allowed:
        return jsonify(rate_limiter.get_429_response(headers)), 429, headers
    try:
        graph_data = _get_latest_graph_json(session_id, getattr(g, "user_id", None))
    except RuntimeError:
        return jsonify({"error": "Could not load graph"}), 500
    if graph_data is None:
        return jsonify({"error": "No graph built yet. Build a graph first."}), 404
    tracker = IndependentDiscoveryTracker()
    pairs   = tracker.find_independent_discoveries(graph_data)
    return jsonify({"pairs": [p.to_dict() for p in pairs]})


@app.route("/api/citation-shadow")
@require_auth
def api_citation_shadow():
    session_id = session_manager.get_session_id(request)
    allowed, headers = rate_limiter.check_sync(
        session_id or getattr(g, "user_id", "anon"), "GET /api/citation-shadow"
    )
    if not allowed:
        return jsonify(rate_limiter.get_429_response(headers)), 429, headers
    try:
        graph_data = _get_latest_graph_json(session_id, getattr(g, "user_id", None))
    except RuntimeError:
        return jsonify({"error": "Could not load graph"}), 500
    if graph_data is None:
        return jsonify({"error": "No graph built yet."}), 404
    detector = CitationShadowDetector()
    shadows  = detector.detect_shadows(graph_data)
    return jsonify({"shadows": [s.to_dict() for s in shadows]})


@app.route("/api/field-fingerprint/<seed_id>")
@require_auth
@require_tier("researcher")
def api_field_fingerprint(seed_id: str):
    session_id = session_manager.get_session_id(request)
    allowed, headers = rate_limiter.check_sync(
        session_id or getattr(g, "user_id", "anon"), "GET /api/field-fingerprint"
    )
    if not allowed:
        return jsonify(rate_limiter.get_429_response(headers)), 429, headers
    row = db.fetchone(
        """
        SELECT g.graph_json_url FROM graphs g
        JOIN session_graphs sg ON sg.graph_id = g.graph_id
        WHERE sg.session_id = %s AND g.seed_paper_id = %s
        ORDER BY g.created_at DESC LIMIT 1
        """,
        (session_id, seed_id),
    )
    if not row and getattr(g, "user_id", None):
        row = db.fetchone(
            "SELECT graph_json_url FROM graphs WHERE user_id = %s::uuid AND seed_paper_id = %s "
            "ORDER BY created_at DESC LIMIT 1",
            (g.user_id, seed_id),
        )
    if not row:
        return jsonify({"error": "No graph found for this seed paper"}), 404
    try:
        from backend.r2_client import R2Client
        graph_data = R2Client().download_json(row["graph_json_url"])
    except Exception:
        return jsonify({"error": "Could not load graph"}), 500
    analyzer    = FieldFingerprintAnalyzer()
    fingerprint = analyzer.analyze(graph_data)
    return jsonify(fingerprint.to_dict())


@app.route("/api/serendipity/<paper_id>")
@require_auth
@require_tier("researcher")
def api_serendipity(paper_id: str):
    session_id = session_manager.get_session_id(request)
    allowed, headers = rate_limiter.check_sync(
        session_id or getattr(g, "user_id", "anon"), "GET /api/serendipity"
    )
    if not allowed:
        return jsonify(rate_limiter.get_429_response(headers)), 429, headers
    try:
        graph_data = _get_latest_graph_json(session_id, getattr(g, "user_id", None))
    except RuntimeError:
        return jsonify({"error": "Could not load graph"}), 500
    if graph_data is None:
        return jsonify({"error": "No graph built yet."}), 404
    engine  = SerendipityEngine()
    analogs = engine.find_analogs(graph_data)
    return jsonify({"analogs": [a.to_dict() for a in analogs]})


@app.route("/api/graphs/history")
@require_auth
@require_tier("researcher")
def api_graph_history():
    rows = db.fetchall(
        """
        SELECT graph_id, seed_paper_id, node_count, edge_count, coverage_score, created_at
        FROM graphs WHERE user_id = %s::uuid ORDER BY created_at DESC LIMIT 50
        """,
        (g.user_id,),
    )
    return jsonify({"graphs": [dict(r) for r in rows]})


@app.route("/api/graph-memory")
@require_auth
@require_tier("researcher")
def api_get_graph_memory():
    graph_id = request.args.get("graph_id", "").strip()
    if not graph_id:
        return jsonify({"error": "graph_id is required"}), 400
    row = db.fetchone(
        "SELECT memory_json FROM graph_memory WHERE user_id = %s::uuid AND graph_id = %s",
        (g.user_id, graph_id),
    )
    return jsonify({"memory": row["memory_json"] if row else {}})


@app.route("/api/graph-memory", methods=["POST"])
@require_auth
@require_tier("researcher")
def api_save_graph_memory():
    import json as _json
    data     = request.get_json(silent=True) or {}
    graph_id = data.get("graph_id", "").strip()
    memory   = data.get("memory", {})
    if not graph_id:
        return jsonify({"error": "graph_id is required"}), 400
    if not isinstance(memory, dict):
        return jsonify({"error": "memory must be a JSON object"}), 400
    memory_str = _json.dumps(memory)
    if len(memory_str) > 65536:
        return jsonify({"error": "memory state too large (max 64KB)"}), 413
    db.execute(
        """
        INSERT INTO graph_memory (user_id, graph_id, memory_json, updated_at)
        VALUES (%s::uuid, %s, %s::jsonb, NOW())
        ON CONFLICT (user_id, graph_id)
        DO UPDATE SET memory_json = EXCLUDED.memory_json, updated_at = NOW()
        """,
        (g.user_id, graph_id, memory_str),
    )
    return jsonify({"success": True})
```

---

## §13 — Rate Limiter Additions

Add to `ArivuRateLimiter.LIMITS` in `backend/rate_limiter.py`:

```python
'GET /api/independent-discovery': (5,  60, 1),
'GET /api/citation-shadow':       (10, 60, 1),
'GET /api/field-fingerprint':     (10, 60, 1),
'GET /api/serendipity':           (5,  60, 1),
'POST /api/billing/checkout':     (3,  60, 1),
'POST /api/account/export-data':  (2,  3600, 1),
'POST /api/account/delete':       (3,  3600, 1),
'GET /api/account/api-keys':      (20, 60, 1),
'GET /api/graph-memory':          (30, 60, 1),
'POST /api/graph-memory':         (20, 60, 1),
# Anonymous graph build limit: 5 fresh builds per hour per session
'POST /api/graph/stream':         (5,  3600, 2),
```

The `POST /api/graph/stream` limit applies to all sessions. When a registered free-tier
user hits this limit with a 429, include in the error:
```python
"message": "Graph limit reached. Create a free account for 10 graphs/month — or upgrade for unlimited.",
"register_url": "/register",
```

---

## §14 — Templates

### §14.1 — templates/auth/login.html

```html
{% extends "base.html" %}
{% block title %}Log in — Arivu{% endblock %}
{% block content %}
<div class="auth-container">
  <div class="auth-card">
    <div class="auth-header">
      <a href="/" class="auth-logo">Arivu</a>
      <h1>Welcome back</h1>
    </div>
    <div id="auth-error" class="auth-error" hidden></div>
    <form id="login-form" class="auth-form" novalidate>
      <div class="form-group">
        <label for="email">Email</label>
        <input type="email" id="email" name="email" required autocomplete="email" placeholder="you@university.edu">
      </div>
      <div class="form-group">
        <label for="password">Password <a href="/forgot-password" class="forgot-link">Forgot?</a></label>
        <input type="password" id="password" name="password" required autocomplete="current-password">
      </div>
      <div id="captcha-widget" hidden>
        <div class="h-captcha" data-sitekey="{{ captcha_site_key }}"></div>
      </div>
      <button type="submit" class="btn-primary btn-full" id="login-btn">Log in</button>
    </form>
    <div class="auth-footer">Don't have an account? <a href="/register">Create one — it's free</a></div>
  </div>
</div>
<script src="https://js.hcaptcha.com/1/api.js" async defer></script>
<script>
const form = document.getElementById('login-form');
const err  = document.getElementById('auth-error');
const btn  = document.getElementById('login-btn');
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.hidden = true; btn.disabled = true; btn.textContent = 'Logging in…';
  const captchaWidget = document.getElementById('captcha-widget');
  const captchaToken  = captchaWidget.hidden ? '' : (window.hcaptcha?.getResponse() || '');
  const resp = await fetch('/login', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({email: document.getElementById('email').value,
                          password: document.getElementById('password').value,
                          captcha_token: captchaToken}),
  });
  const data = await resp.json().catch(() => ({}));
  if (resp.ok && data.success) { window.location.href = data.redirect || '/tool'; return; }
  btn.disabled = false; btn.textContent = 'Log in';
  if (data.requires_captcha) captchaWidget.hidden = false;
  err.textContent = data.message || 'Login failed. Please try again.';
  err.hidden = false;
});
</script>
{% endblock %}
```

### §14.2 — templates/auth/register.html

```html
{% extends "base.html" %}
{% block title %}Create account — Arivu{% endblock %}
{% block content %}
<div class="auth-container">
  <div class="auth-card">
    <div class="auth-header">
      <a href="/" class="auth-logo">Arivu</a>
      <h1>Create your account</h1>
      <p class="auth-subhead">Free — 10 graphs per month</p>
    </div>
    <div id="auth-error"   class="auth-error"  hidden></div>
    <div id="auth-success" class="auth-success" hidden></div>
    <form id="register-form" class="auth-form" novalidate>
      <div class="form-group">
        <label for="email">Email</label>
        <input type="email" id="email" required autocomplete="email" placeholder="you@university.edu">
      </div>
      <div class="form-group">
        <label for="display_name">Name (optional)</label>
        <input type="text" id="display_name" autocomplete="name" placeholder="Alex Chen">
      </div>
      <div class="form-group">
        <label for="password">Password</label>
        <input type="password" id="password" required autocomplete="new-password" minlength="8" placeholder="At least 8 characters">
      </div>
      <div class="captcha-wrapper">
        <div class="h-captcha" data-sitekey="{{ captcha_site_key }}"></div>
      </div>
      <p class="consent-text">By creating an account, you agree that Arivu may store your email and usage data as described in our <a href="/privacy">Privacy Policy</a>.</p>
      <button type="submit" class="btn-primary btn-full" id="register-btn">Create account</button>
    </form>
    <div class="auth-footer">Already have an account? <a href="/login">Log in</a></div>
  </div>
</div>
<script src="https://js.hcaptcha.com/1/api.js" async defer></script>
<script>
const form = document.getElementById('register-form');
const err  = document.getElementById('auth-error');
const ok   = document.getElementById('auth-success');
const btn  = document.getElementById('register-btn');
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.hidden = true; ok.hidden = true; btn.disabled = true; btn.textContent = 'Creating account…';
  const captchaToken = window.hcaptcha?.getResponse() || '';
  const resp = await fetch('/register', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({email: document.getElementById('email').value,
                          password: document.getElementById('password').value,
                          display_name: document.getElementById('display_name').value,
                          captcha_token: captchaToken}),
  });
  const data = await resp.json().catch(() => ({}));
  btn.disabled = false; btn.textContent = 'Create account';
  if (data.success) { form.style.display = 'none'; ok.textContent = data.message || 'Check your email to verify.'; ok.hidden = false; }
  else { err.textContent = data.message || 'Registration failed.'; err.hidden = false; if (window.hcaptcha) window.hcaptcha.reset(); }
});
</script>
{% endblock %}
```

### §14.3 — templates/auth/verify_email.html

```html
{% extends "base.html" %}
{% block title %}Verify email — Arivu{% endblock %}
{% block content %}
<div class="auth-container"><div class="auth-card">
  <div class="auth-header">
    <a href="/" class="auth-logo">Arivu</a>
    {% if status == "missing" %}<h1>No token provided</h1><p class="auth-subhead">The verification link appears incomplete.</p>
    {% elif status == "invalid" %}<h1>Invalid link</h1><p class="auth-subhead">This link doesn't exist or was already used.</p>
    {% elif status == "already_used" %}<h1>Already verified</h1><p class="auth-subhead">This link was already used. Your account is verified.</p>
    {% elif status == "expired" %}<h1>Link expired</h1><p class="auth-subhead">Verification links expire after 24 hours.</p>
    {% else %}<h1>Something went wrong</h1><p class="auth-subhead">Please try again.</p>{% endif %}
  </div>
  {% if status == "already_used" %}
    <a href="/login" class="btn-primary btn-full">Log in</a>
  {% elif status == "expired" %}
    <div id="resend-msg" class="auth-success" hidden></div>
    <button class="btn-primary btn-full" id="resend-btn">Send new verification email</button>
    <p class="auth-footer" style="margin-top:1rem"><a href="/login">Back to log in</a></p>
    <script>
    document.getElementById('resend-btn').addEventListener('click', async () => {
      const btn = document.getElementById('resend-btn');
      btn.disabled = true; btn.textContent = 'Sending…';
      const email = prompt('Enter your email address:');
      if (!email) { btn.disabled = false; btn.textContent = 'Send new verification email'; return; }
      await fetch('/resend-verification', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});
      btn.disabled = false; btn.textContent = 'Send new verification email';
      const msg = document.getElementById('resend-msg');
      msg.textContent = 'If that email is registered and unverified, a new link is on its way.';
      msg.hidden = false;
    });
    </script>
  {% else %}
    <a href="/register" class="btn-primary btn-full">Create new account</a>
    <p class="auth-footer" style="margin-top:1rem"><a href="/login">Back to log in</a></p>
  {% endif %}
</div></div>
{% endblock %}
```

### §14.4 — templates/auth/forgot_password.html

```html
{% extends "base.html" %}
{% block title %}Reset password — Arivu{% endblock %}
{% block content %}
<div class="auth-container"><div class="auth-card">
  <div class="auth-header">
    <a href="/" class="auth-logo">Arivu</a>
    <h1>Reset your password</h1>
    <p class="auth-subhead">Enter your email and we'll send a reset link.</p>
  </div>
  <div id="auth-error"   class="auth-error"  hidden></div>
  <div id="auth-success" class="auth-success" hidden></div>
  <form id="forgot-form" class="auth-form" novalidate>
    <div class="form-group">
      <label for="email">Email</label>
      <input type="email" id="email" required autocomplete="email" placeholder="you@university.edu">
    </div>
    <button type="submit" class="btn-primary btn-full" id="forgot-btn">Send reset link</button>
  </form>
  <div class="auth-footer"><a href="/login">Back to log in</a></div>
</div></div>
<script>
const form = document.getElementById('forgot-form');
const err  = document.getElementById('auth-error');
const ok   = document.getElementById('auth-success');
const btn  = document.getElementById('forgot-btn');
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.hidden = true; ok.hidden = true; btn.disabled = true; btn.textContent = 'Sending…';
  const resp = await fetch('/forgot-password', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:document.getElementById('email').value})});
  const data = await resp.json().catch(() => ({}));
  btn.disabled = false; btn.textContent = 'Send reset link';
  if (data.success) { form.style.display='none'; ok.textContent=data.message||'If that email is registered, a reset link is on its way.'; ok.hidden=false; }
  else { err.textContent=data.message||'Something went wrong.'; err.hidden=false; }
});
</script>
{% endblock %}
```

### §14.5 — templates/auth/reset_password.html

```html
{% extends "base.html" %}
{% block title %}Set new password — Arivu{% endblock %}
{% block content %}
<div class="auth-container"><div class="auth-card">
  <div class="auth-header">
    <a href="/" class="auth-logo">Arivu</a>
    {% if status == "valid" %}<h1>Set new password</h1><p class="auth-subhead">At least 8 characters.</p>
    {% else %}<h1>Link invalid or expired</h1><p class="auth-subhead">Reset links expire after 1 hour and can only be used once.</p>{% endif %}
  </div>
  {% if status == "valid" %}
    <div id="auth-error" class="auth-error" hidden></div>
    <form id="reset-form" class="auth-form" novalidate>
      <input type="hidden" id="reset-token" value="{{ token }}">
      <div class="form-group">
        <label for="new_password">New password</label>
        <input type="password" id="new_password" required autocomplete="new-password" minlength="8" placeholder="At least 8 characters">
      </div>
      <div class="form-group">
        <label for="confirm_password">Confirm password</label>
        <input type="password" id="confirm_password" required autocomplete="new-password">
      </div>
      <button type="submit" class="btn-primary btn-full" id="reset-btn">Set new password</button>
    </form>
    <script>
    const form = document.getElementById('reset-form');
    const err  = document.getElementById('auth-error');
    const btn  = document.getElementById('reset-btn');
    const token = document.getElementById('reset-token').value;
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); err.hidden = true;
      const pw = document.getElementById('new_password').value;
      const confirm = document.getElementById('confirm_password').value;
      if (pw.length < 8) { err.textContent='Password must be at least 8 characters.'; err.hidden=false; return; }
      if (pw !== confirm) { err.textContent='Passwords do not match.'; err.hidden=false; return; }
      btn.disabled=true; btn.textContent='Setting password…';
      const resp = await fetch('/reset-password', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,password:pw})});
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.success) { window.location.href = data.redirect||'/tool'; return; }
      btn.disabled=false; btn.textContent='Set new password';
      const msgs={token_expired:'This reset link has expired.',token_used:'This link was already used.',invalid_token:'Invalid reset link.',password_too_short:'Password must be at least 8 characters.'};
      err.textContent=msgs[data.error]||data.message||'Something went wrong.'; err.hidden=false;
    });
    </script>
  {% else %}
    <a href="/forgot-password" class="btn-primary btn-full">Request a new reset link</a>
    <div class="auth-footer"><a href="/login">Back to log in</a></div>
  {% endif %}
</div></div>
{% endblock %}
```

### §14.6 — templates/pricing.html

```html
{% extends "base.html" %}
{% block title %}Pricing — Arivu{% endblock %}
{% block content %}
<div class="pricing-page">
  <div class="pricing-header">
    <h1>Simple pricing</h1>
    <p>Start free. Upgrade when you need more.</p>
  </div>
  <div class="pricing-grid">
    <div class="pricing-card {% if user and user.tier == 'free' %}current-plan{% endif %}">
      <div class="plan-name">Free</div>
      <div class="plan-price">$0 <span class="plan-period">/ month</span></div>
      <ul class="plan-features">
        <li>10 graphs per month</li>
        <li>Cached graphs are free (don't count)</li>
        <li>All core analysis features</li>
        <li>Independent Discovery Tracker</li>
        <li>Citation Shadow Detector</li>
        <li>Export: JSON, CSV, BibTeX</li>
      </ul>
      {% if not user %}<a href="/register" class="btn-primary plan-btn">Sign up free</a>
      {% elif user.tier == 'free' %}<span class="plan-btn btn-ghost" style="text-align:center;cursor:default">Current plan</span>
      {% endif %}
    </div>
    <div class="pricing-card {% if user and user.tier == 'researcher' %}current-plan{% endif %}">
      <div class="plan-name">Researcher</div>
      <div class="plan-price">$8 <span class="plan-period">/ month</span></div>
      <ul class="plan-features">
        <li><strong>Everything in Free</strong></li>
        <li>Unlimited graphs</li>
        <li>Field Fingerprinting (radar chart)</li>
        <li>Serendipity Engine (cross-domain)</li>
        <li>Persistent graph history</li>
        <li>Graph memory across sessions</li>
      </ul>
      {% if not user %}<a href="/register" class="btn-primary plan-btn">Sign up free</a>
      {% elif user.tier == 'researcher' %}<button class="btn-secondary plan-btn" onclick="openPortal()">Manage billing</button>
      {% elif user.tier == 'free' %}<button class="btn-primary plan-btn" onclick="checkout('researcher')">Upgrade to Researcher</button>
      {% endif %}
    </div>
    <div class="pricing-card {% if user and user.tier == 'lab' %}current-plan{% endif %}">
      <div class="plan-name">Lab</div>
      <div class="plan-price">$30 <span class="plan-period">/ month</span></div>
      <ul class="plan-features">
        <li><strong>Everything in Researcher</strong></li>
        <li>Public REST API access</li>
        <li>API key management (up to 10 keys)</li>
        <li>Priority support</li>
        <li class="coming-soon">Lab member accounts <span class="badge-soon">Soon</span></li>
        <li class="coming-soon">Webhooks <span class="badge-soon">Soon</span></li>
      </ul>
      {% if not user %}<a href="/register" class="btn-secondary plan-btn">Sign up free</a>
      {% elif user.tier == 'lab' %}<button class="btn-secondary plan-btn" onclick="openPortal()">Manage billing</button>
      {% else %}<button class="btn-secondary plan-btn" onclick="checkout('lab')">Upgrade to Lab</button>{% endif %}
    </div>
  </div>
  <div class="pricing-faq">
    <h2>Questions</h2>
    <div class="faq-item">
      <strong>What counts as a graph?</strong>
      <p>Each time you analyze a new paper. Re-visiting a paper you've analyzed before is served from cache and doesn't count against your limit.</p>
    </div>
    <div class="faq-item">
      <strong>Can I cancel anytime?</strong>
      <p>Yes. Cancel from your account settings — you keep full access until the end of your current billing period. No immediate cutoff.</p>
    </div>
    <div class="faq-item">
      <strong>Is my data safe?</strong>
      <p>Yes. See our <a href="/privacy">privacy policy</a>. We never sell data, never show ads.</p>
    </div>
  </div>
</div>
<script>
async function checkout(tier) {
  const btn = event.target; btn.disabled=true; btn.textContent='Redirecting…';
  const resp = await fetch('/api/billing/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tier})});
  const data = await resp.json();
  if (data.url) { window.location.href=data.url; }
  else { btn.disabled=false; btn.textContent='Try again'; alert(data.error||'Could not start checkout.'); }
}
async function openPortal() {
  const btn = event.target; btn.disabled=true; btn.textContent='Opening portal…';
  const resp = await fetch('/api/billing/portal',{method:'POST'});
  const data = await resp.json();
  if (data.url) window.location.href=data.url;
  else { btn.disabled=false; btn.textContent='Manage billing'; }
}
</script>
{% endblock %}
```

### §14.7 — templates/account.html

```html
{% extends "base.html" %}
{% block title %}Account — Arivu{% endblock %}
{% block content %}
<div class="account-page">
  <div class="account-header">
    <h1>Account settings</h1>
    <span class="tier-badge tier-badge--{{ user.tier }}">{{ user.tier | capitalize }} plan</span>
  </div>

  {% if user.tier == 'free' %}
  <section class="account-section" id="usage-section">
    <h2>Usage this month</h2>
    <div class="usage-meter">
      <div class="usage-bar"><div class="usage-fill" style="width:{{ (user.graphs_this_month / 10 * 100) | int }}%"></div></div>
      <span class="usage-label">{{ user.graphs_this_month }} / 10 graphs used — resets {{ user.usage_reset_at.strftime('%b') }} {{ user.usage_reset_at.day if user.usage_reset_at else '' }}</span>
    </div>
    <a href="/pricing" class="btn-primary btn-sm" style="margin-top:0.75rem">Upgrade to Researcher — unlimited graphs</a>
  </section>
  {% endif %}

  <section class="account-section" id="profile-section">
    <h2>Profile</h2>
    <div id="profile-msg" class="account-msg" hidden></div>
    <div class="form-row">
      <div class="form-group">
        <label for="display_name">Display name</label>
        <input type="text" id="display_name" value="{{ user.display_name or '' }}" maxlength="100">
      </div>
      <div class="form-group">
        <label for="institution">Institution</label>
        <input type="text" id="institution" value="{{ user.institution or '' }}" maxlength="200">
      </div>
    </div>
    <div class="form-group">
      <label for="role_field">Role</label>
      <select id="role_field">
        {% for r in ['researcher','student','faculty','industry','journalist','other'] %}
        <option value="{{ r }}" {% if user.role == r %}selected{% endif %}>{{ r | capitalize }}</option>
        {% endfor %}
      </select>
    </div>
    <p class="field-readonly"><strong>Email:</strong> {{ user.email }} <span class="field-note">— email cannot be changed in Phase 6</span></p>
    <button class="btn-primary btn-sm" id="save-profile-btn">Save profile</button>
  </section>

  <section class="account-section" id="password-section">
    <h2>Change password</h2>
    <div id="password-msg" class="account-msg" hidden></div>
    <div class="form-group"><label for="current_password">Current password</label><input type="password" id="current_password" autocomplete="current-password"></div>
    <div class="form-group"><label for="new_password">New password</label><input type="password" id="new_password" autocomplete="new-password" minlength="8" placeholder="At least 8 characters"></div>
    <button class="btn-primary btn-sm" id="change-password-btn">Change password</button>
  </section>

  <section class="account-section" id="billing-section">
    <h2>Billing</h2>
    {% if user.tier == 'free' %}
      <p>You're on the <strong>Free</strong> plan.</p>
      <a href="/pricing" class="btn-primary btn-sm">View upgrade options</a>
    {% else %}
      <p>You're on the <strong>{{ user.tier | capitalize }}</strong> plan.{% if user.tier_expires_at %} Renews {{ user.tier_expires_at.strftime('%b') }} {{ user.tier_expires_at.day }}, {{ user.tier_expires_at.year }}.{% endif %}</p>
      <button class="btn-secondary btn-sm" id="manage-billing-btn">Manage billing (Stripe portal)</button>
    {% endif %}
  </section>

  {% if user.tier == 'lab' %}
  <section class="account-section" id="api-keys-section">
    <h2>API keys</h2>
    <p class="section-note">Lab tier only. Keys grant programmatic access to Arivu's API.</p>
    <div id="api-key-msg" class="account-msg" hidden></div>
    <div id="api-keys-list" class="api-keys-list"><p class="loading-text">Loading keys…</p></div>
    <div class="form-row">
      <div class="form-group"><label for="key_label">Label (optional)</label><input type="text" id="key_label" placeholder="e.g. My research script" maxlength="100"></div>
      <button class="btn-primary btn-sm" id="create-key-btn" style="align-self:flex-end">Create API key</button>
    </div>
    <div id="new-key-reveal" class="new-key-reveal" hidden>
      <strong>Copy your key now — it will not be shown again:</strong>
      <code id="new-key-value"></code>
      <button onclick="navigator.clipboard.writeText(document.getElementById('new-key-value').textContent).then(()=>this.textContent='Copied!')" class="btn-ghost btn-sm">Copy</button>
    </div>
  </section>
  {% endif %}

  <section class="account-section account-section--danger" id="data-section">
    <h2>Your data</h2>
    <div id="gdpr-msg" class="account-msg" hidden></div>
    <div class="data-action">
      <div><strong>Export all your data</strong><p>Download a ZIP with your profile, sessions, graph history, and action log.</p></div>
      <button class="btn-secondary btn-sm" id="export-data-btn">Request data export</button>
    </div>
    <hr class="section-divider">
    <div class="data-action data-action--danger">
      <div><strong>Delete account</strong><p>Permanently delete your account and all personal data. Graphs (no personal data) are not deleted.</p></div>
      <button class="btn-danger btn-sm" id="delete-account-btn">Delete my account</button>
    </div>
  </section>
</div>
<script src="/static/js/account.js"></script>
{% endblock %}
```

### §14.8 — templates/privacy.html

```html
{% extends "base.html" %}
{% block title %}Privacy Policy — Arivu{% endblock %}
{% block content %}
<div class="legal-page">
  <h1>Privacy Policy</h1>
  <p class="legal-date">Effective date: see CONTEXT.md for Phase 6 launch date</p>
  <h2>What we collect and why</h2>
  <p>When you create an account, we collect your email address and password hash (bcrypt, 12 rounds — we never store your plain password). We collect session data (session ID, IP address, user agent) to keep you logged in and detect abuse. We log actions you take (which papers you analyze, pruning operations) for 90 days.</p>
  <h2>Third-party processors</h2>
  <ul>
    <li><strong>Neon.tech</strong> — PostgreSQL database</li>
    <li><strong>Cloudflare R2</strong> — object storage for graphs and exports</li>
    <li><strong>Koyeb</strong> — backend hosting</li>
    <li><strong>Stripe</strong> — payment processing (we never see your card number)</li>
    <li><strong>Resend</strong> — transactional email</li>
    <li><strong>Groq</strong> — LLM API (paper abstracts only — never personal data)</li>
    <li><strong>hCaptcha</strong> — bot protection on login and registration</li>
  </ul>
  <h2>Data retention</h2>
  <table class="retention-table">
    <thead><tr><th>Data</th><th>Retention</th><th>Legal basis</th></tr></thead>
    <tbody>
      <tr><td>Account (email, name)</td><td>Account lifetime + 30 days</td><td>Contract</td></tr>
      <tr><td>Sessions</td><td>30 days or until logout</td><td>Legitimate interest</td></tr>
      <tr><td>Action log</td><td>90 days</td><td>Legitimate interest</td></tr>
      <tr><td>Password reset tokens</td><td>7 days after use/expiry</td><td>Contract</td></tr>
    </tbody>
  </table>
  <h2>Your rights</h2>
  <p>Access, rectification, erasure, portability, restriction, and objection. Exercise these from <a href="/account">your account settings</a> or email <strong>privacy@arivu.app</strong>. Account deletion requests are processed within 24 hours.</p>
  <h2>Cookies</h2>
  <p>We use one cookie: <code>arivu_session</code> — strictly necessary for keeping you logged in. HTTP-only, Secure, SameSite=Lax. No tracking cookies. No advertising cookies.</p>
  <h2>Contact</h2>
  <p>Data controller: Dev (Arivu). Contact: <strong>privacy@arivu.app</strong></p>
</div>
{% endblock %}
```

---

## §15 — static/css/auth.css (complete file)

```css
/* ── Site Nav ─────────────────────────────────────────────────────────────── */
.site-nav {
  display: flex; align-items: center; gap: 1.5rem;
  padding: 0.875rem 2rem;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  position: sticky; top: 0; z-index: 100;
  background: rgba(10,14,23,0.92); backdrop-filter: blur(12px);
}
.nav-logo { font-size: 1.25rem; font-weight: 700; color: #D4A843; text-decoration: none; letter-spacing: -0.02em; margin-right: auto; }
.nav-links { display: flex; gap: 1rem; }
.nav-link { color: #94a3b8; text-decoration: none; font-size: 0.875rem; transition: color 0.15s; }
.nav-link:hover { color: #e2e8f0; }
.nav-auth { display: flex; align-items: center; gap: 0.75rem; }
.nav-tier-badge { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; padding: 0.2rem 0.5rem; border-radius: 4px; }
.nav-tier-free       { background: rgba(100,116,139,0.2); color: #94a3b8; }
.nav-tier-researcher { background: rgba(212,168,67,0.15); color: #D4A843; }
.nav-tier-lab        { background: rgba(99,102,241,0.15); color: #818cf8; }

/* ── Upgrade nudge ────────────────────────────────────────────────────────── */
.upgrade-nudge { display:flex;align-items:center;justify-content:center;gap:0.75rem;padding:0.5rem 1rem;background:rgba(212,168,67,0.08);border-bottom:1px solid rgba(212,168,67,0.15);font-size:0.8125rem;color:#D4A843; }
.upgrade-nudge a { color:#D4A843;font-weight:600; }
.nudge-dismiss { background:none;border:none;color:#D4A843;cursor:pointer;font-size:0.875rem;padding:0;opacity:0.6; }
.nudge-dismiss:hover { opacity:1; }

/* ── Buttons ──────────────────────────────────────────────────────────────── */
.btn-primary { background:#D4A843;color:#0a0e17;border:none;border-radius:8px;padding:0.625rem 1.25rem;font-weight:600;font-size:0.9375rem;cursor:pointer;text-decoration:none;display:inline-block;transition:opacity 0.15s;text-align:center; }
.btn-primary:hover { opacity:0.88; }
.btn-primary:disabled { opacity:0.5;cursor:not-allowed; }
.btn-secondary { background:transparent;color:#D4A843;border:1px solid #D4A843;border-radius:8px;padding:0.625rem 1.25rem;font-weight:600;font-size:0.9375rem;cursor:pointer;text-decoration:none;display:inline-block;transition:background 0.15s; }
.btn-secondary:hover { background:rgba(212,168,67,0.08); }
.btn-ghost { background:transparent;color:#94a3b8;border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:0.625rem 1.25rem;font-weight:500;font-size:0.875rem;cursor:pointer;text-decoration:none;display:inline-block;transition:border-color 0.15s,color 0.15s; }
.btn-ghost:hover { border-color:rgba(255,255,255,0.2);color:#e2e8f0; }
.btn-danger { background:rgba(239,68,68,0.12);color:#fca5a5;border:1px solid rgba(239,68,68,0.25);border-radius:8px;padding:0.625rem 1.25rem;font-weight:600;font-size:0.875rem;cursor:pointer;transition:background 0.15s; }
.btn-danger:hover { background:rgba(239,68,68,0.2); }
.btn-full { width:100%; }
.btn-sm { padding:0.4375rem 0.875rem;font-size:0.8125rem; }

/* ── Auth pages ───────────────────────────────────────────────────────────── */
.auth-container { display:flex;align-items:center;justify-content:center;min-height:calc(100vh - 64px);padding:2rem 1rem; }
.auth-card { width:100%;max-width:440px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:2.5rem; }
.auth-header { text-align:center;margin-bottom:2rem; }
.auth-logo { display:inline-block;font-size:1.5rem;font-weight:700;color:#D4A843;text-decoration:none;margin-bottom:0.75rem; }
.auth-header h1 { font-size:1.5rem;font-weight:600;color:#e2e8f0;margin:0 0 0.25rem; }
.auth-subhead { color:#64748b;font-size:0.875rem;margin:0; }
.auth-form { display:flex;flex-direction:column;gap:1.25rem; }
.form-group { display:flex;flex-direction:column;gap:0.375rem; }
.form-row { display:grid;grid-template-columns:1fr 1fr;gap:1rem; }
.form-group label { font-size:0.8125rem;font-weight:500;color:#94a3b8;display:flex;justify-content:space-between;align-items:center; }
.form-group input, .form-group select { background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:0.625rem 0.875rem;color:#e2e8f0;font-size:0.9375rem;transition:border-color 0.15s;outline:none;width:100%;box-sizing:border-box; }
.form-group input:focus, .form-group select:focus { border-color:#D4A843; }
.form-group input::placeholder { color:#475569; }
.forgot-link { font-size:0.8125rem;color:#64748b;text-decoration:none; }
.forgot-link:hover { color:#D4A843; }
.auth-error { background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.25);border-radius:8px;padding:0.75rem 1rem;color:#fca5a5;font-size:0.875rem; }
.auth-success { background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.2);border-radius:8px;padding:0.75rem 1rem;color:#86efac;font-size:0.875rem; }
.consent-text { font-size:0.75rem;color:#64748b;line-height:1.5;margin:0; }
.consent-text a { color:#94a3b8; }
.auth-footer { text-align:center;margin-top:1.5rem;font-size:0.875rem;color:#64748b; }
.auth-footer a { color:#D4A843;text-decoration:none; }
.captcha-wrapper { display:flex;justify-content:center; }

/* ── Pricing ──────────────────────────────────────────────────────────────── */
.pricing-page { max-width:960px;margin:0 auto;padding:3rem 1.5rem; }
.pricing-header { text-align:center;margin-bottom:3rem; }
.pricing-header h1 { font-size:2.25rem;font-weight:700;color:#e2e8f0;margin-bottom:0.5rem; }
.pricing-header p { color:#64748b;font-size:1.0625rem; }
.pricing-grid { display:grid;grid-template-columns:repeat(3,1fr);gap:1.25rem;margin-bottom:3rem; }
@media (max-width:680px) { .pricing-grid { grid-template-columns:1fr; } }
.pricing-card { background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:2rem 1.5rem;display:flex;flex-direction:column;gap:1rem; }
.pricing-card.current-plan { border-color:#D4A843; }
.plan-name { font-size:0.875rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8; }
.plan-price { font-size:2.25rem;font-weight:700;color:#e2e8f0; }
.plan-period { font-size:1rem;font-weight:400;color:#64748b; }
.plan-features { list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:0.5rem;flex:1; }
.plan-features li { font-size:0.875rem;color:#94a3b8;padding-left:1.25rem;position:relative; }
.plan-features li::before { content:"✓";position:absolute;left:0;color:#D4A843;font-weight:700; }
.plan-features .coming-soon { opacity:0.5; }
.plan-features .coming-soon::before { content:"–";color:#64748b; }
.badge-soon { font-size:0.6rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;background:rgba(99,102,241,0.2);color:#818cf8;padding:0.1rem 0.35rem;border-radius:3px;margin-left:0.25rem; }
.plan-btn { width:100%;margin-top:auto; }
.pricing-faq { border-top:1px solid rgba(255,255,255,0.06);padding-top:2.5rem; }
.pricing-faq h2 { font-size:1.25rem;color:#e2e8f0;margin-bottom:1.5rem; }
.faq-item { margin-bottom:1.5rem; }
.faq-item strong { color:#e2e8f0;font-size:0.9375rem; }
.faq-item p { color:#64748b;font-size:0.875rem;margin:0.25rem 0 0; }

/* ── Account page ─────────────────────────────────────────────────────────── */
.account-page { max-width:680px;margin:0 auto;padding:2.5rem 1.5rem; }
.account-header { display:flex;align-items:center;gap:1rem;margin-bottom:2.5rem; }
.account-header h1 { font-size:1.75rem;font-weight:700;color:#e2e8f0;margin:0; }
.tier-badge { font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;padding:0.25rem 0.6rem;border-radius:4px; }
.tier-badge--free       { background:rgba(100,116,139,0.2);color:#94a3b8; }
.tier-badge--researcher { background:rgba(212,168,67,0.15);color:#D4A843; }
.tier-badge--lab        { background:rgba(99,102,241,0.15);color:#818cf8; }
.account-section { background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:1.75rem;margin-bottom:1.25rem; }
.account-section h2 { font-size:1rem;font-weight:600;color:#e2e8f0;margin:0 0 1.25rem; }
.account-section--danger { border-color:rgba(239,68,68,0.15); }
.account-msg { padding:0.625rem 0.875rem;border-radius:8px;font-size:0.875rem;margin-bottom:1rem; }
.account-msg.success { background:rgba(34,197,94,0.1);color:#86efac;border:1px solid rgba(34,197,94,0.2); }
.account-msg.error   { background:rgba(239,68,68,0.1);color:#fca5a5;border:1px solid rgba(239,68,68,0.2); }
.field-readonly { font-size:0.875rem;color:#94a3b8;margin:0 0 1rem; }
.field-note { font-size:0.75rem;color:#475569; }
.section-note { font-size:0.8125rem;color:#64748b;margin:-0.75rem 0 1rem; }
.section-divider { border:none;border-top:1px solid rgba(255,255,255,0.06);margin:1.25rem 0; }
.data-action { display:flex;align-items:flex-start;justify-content:space-between;gap:1rem; }
.data-action p { font-size:0.8125rem;color:#64748b;margin:0.25rem 0 0; }
.data-action strong { color:#e2e8f0;font-size:0.9375rem; }
.usage-meter { display:flex;flex-direction:column;gap:0.5rem; }
.usage-bar { height:6px;background:rgba(255,255,255,0.06);border-radius:99px;overflow:hidden; }
.usage-fill { height:100%;background:#D4A843;border-radius:99px;transition:width 0.3s; }
.usage-label { font-size:0.8125rem;color:#64748b; }
.api-keys-list { display:flex;flex-direction:column;gap:0.5rem;margin-bottom:1rem; }
.api-key-row { display:flex;align-items:center;justify-content:space-between;gap:0.75rem;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:8px;padding:0.625rem 0.875rem; }
.api-key-prefix { font-family:monospace;font-size:0.875rem;color:#94a3b8; }
.api-key-label { font-size:0.8125rem;color:#64748b; }
.new-key-reveal { background:rgba(34,197,94,0.06);border:1px solid rgba(34,197,94,0.2);border-radius:8px;padding:1rem;display:flex;flex-direction:column;gap:0.5rem;margin-top:0.75rem; }
.new-key-reveal strong { font-size:0.8125rem;color:#86efac; }
.new-key-reveal code { font-family:monospace;font-size:0.875rem;color:#e2e8f0;word-break:break-all; }
.loading-text { color:#475569;font-size:0.875rem; }

/* ── Legal page ───────────────────────────────────────────────────────────── */
.legal-page { max-width:720px;margin:0 auto;padding:2.5rem 1.5rem; }
.legal-page h1 { font-size:2rem;color:#e2e8f0;margin-bottom:0.25rem; }
.legal-date { color:#64748b;font-size:0.875rem;margin-bottom:2rem; }
.legal-page h2 { font-size:1.125rem;color:#e2e8f0;margin:2rem 0 0.75rem; }
.legal-page p, .legal-page ul { color:#94a3b8;line-height:1.7; }
.retention-table { width:100%;border-collapse:collapse;margin:1rem 0;font-size:0.875rem; }
.retention-table th { text-align:left;color:#64748b;padding:0.5rem 0.75rem;border-bottom:1px solid rgba(255,255,255,0.08); }
.retention-table td { color:#94a3b8;padding:0.5rem 0.75rem;border-bottom:1px solid rgba(255,255,255,0.05); }
```

---

## §16 — templates/base.html Additions

### §16.1 — Auth-Aware Navigation

Replace the existing nav in `templates/base.html` with:

```html
<nav class="site-nav" role="navigation" aria-label="Main navigation">
  <a href="/" class="nav-logo" aria-label="Arivu home">Arivu</a>
  <div class="nav-links">
    <a href="/explore" class="nav-link">Explore</a>
    <a href="/pricing" class="nav-link">Pricing</a>
  </div>
  <div class="nav-auth">
    {% if g.user %}
      <span class="nav-tier-badge nav-tier-{{ g.user.tier }}">{{ g.user.tier | capitalize }}</span>
      <a href="/account" class="nav-link nav-link--account">{{ g.user.display_name or g.user.email.split('@')[0] }}</a>
      <button class="btn-ghost btn-sm nav-logout" id="nav-logout-btn">Log out</button>
    {% else %}
      <a href="/login"    class="btn-ghost btn-sm">Log in</a>
      <a href="/register" class="btn-primary btn-sm">Sign up free</a>
    {% endif %}
  </div>
</nav>

{% if g.user and g.user.tier == 'free' %}
<div class="upgrade-nudge" id="upgrade-nudge" hidden>
  <span>{{ g.user.graphs_this_month }} / 10 graphs used this month. <a href="/pricing">Upgrade for unlimited →</a></span>
  <button onclick="document.getElementById('upgrade-nudge').hidden=true" aria-label="Dismiss" class="nudge-dismiss">✕</button>
</div>
{% endif %}

<script>
document.getElementById('nav-logout-btn')?.addEventListener('click', async () => {
  await fetch('/logout', { method: 'POST' });
  window.location.href = '/';
});
{% if g.user and g.user.tier == 'free' and g.user.graphs_this_month >= 8 %}
  document.getElementById('upgrade-nudge').hidden = false;
{% endif %}
</script>
```

### §16.2 — Cookie Consent Banner

Add at bottom of `<body>` before closing tag:

```html
<div id="cookie-banner" class="cookie-banner" role="dialog"
     aria-labelledby="cookie-banner-title" hidden>
  <p id="cookie-banner-title">
    Arivu uses one cookie to keep you logged in. <a href="/privacy">Learn more</a>
  </p>
  <div class="cookie-actions">
    <button id="cookie-accept-all" class="btn-primary btn-sm">Accept</button>
    <button id="cookie-necessary" class="btn-ghost btn-sm">Necessary only</button>
  </div>
</div>

<script>
(function() {
  const consent = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('cookie_consent='));
  if (!consent) document.getElementById('cookie-banner').hidden = false;

  function setConsent(type) {
    const expires  = new Date(Date.now() + 365*24*60*60*1000).toUTCString();
    const isHttps  = location.protocol === 'https:';
    const secure   = isHttps ? '; Secure' : '';     // omit Secure on HTTP (local dev)
    document.cookie = `cookie_consent=${type}; expires=${expires}; path=/; SameSite=Lax${secure}`;
    document.getElementById('cookie-banner').hidden = true;
    fetch('/api/consent', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({consent_type: type}),
    });
  }

  document.getElementById('cookie-accept-all')?.addEventListener('click', () => setConsent('all'));
  document.getElementById('cookie-necessary')?.addEventListener('click',  () => setConsent('necessary'));
})();
</script>
```

---

## §17 — static/js/account.js (complete file)

```javascript
/**
 * static/js/account.js
 * Account page: profile, password, billing, API keys, GDPR.
 */

function showMsg(id, text, type = 'success') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = `account-msg ${type}`;
  el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 5000);
}

async function apiPost(url, body) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });
  return {ok: resp.ok, status: resp.status, data: await resp.json().catch(() => ({}))};
}

// ── Profile ──────────────────────────────────────────────────────────────────
document.getElementById('save-profile-btn')?.addEventListener('click', async () => {
  const btn = document.getElementById('save-profile-btn');
  btn.disabled = true; btn.textContent = 'Saving…';
  const {ok, data} = await apiPost('/api/account/profile', {
    display_name: document.getElementById('display_name')?.value || '',
    institution:  document.getElementById('institution')?.value  || '',
    role:         document.getElementById('role_field')?.value   || '',
  });
  btn.disabled = false; btn.textContent = 'Save profile';
  if (ok) showMsg('profile-msg', 'Profile saved.', 'success');
  else    showMsg('profile-msg', data.message || 'Save failed.', 'error');
});

// ── Password ──────────────────────────────────────────────────────────────────
document.getElementById('change-password-btn')?.addEventListener('click', async () => {
  const btn   = document.getElementById('change-password-btn');
  const newPw = document.getElementById('new_password')?.value || '';
  if (newPw.length < 8) { showMsg('password-msg', 'New password must be at least 8 characters.', 'error'); return; }
  btn.disabled = true; btn.textContent = 'Changing…';
  const {ok, data} = await apiPost('/api/account/password', {
    current_password: document.getElementById('current_password')?.value || '',
    new_password:     newPw,
  });
  btn.disabled = false; btn.textContent = 'Change password';
  if (ok) {
    showMsg('password-msg', 'Password changed.', 'success');
    document.getElementById('current_password').value = '';
    document.getElementById('new_password').value = '';
  } else {
    const msgs = {wrong_current_password: 'Current password is incorrect.', password_too_short: 'Password must be at least 8 characters.'};
    showMsg('password-msg', msgs[data.error] || data.message || 'Change failed.', 'error');
  }
});

// ── Billing ────────────────────────────────────────────────────────────────────
document.getElementById('manage-billing-btn')?.addEventListener('click', async () => {
  const btn = document.getElementById('manage-billing-btn');
  btn.disabled = true; btn.textContent = 'Opening portal…';
  const {ok, data} = await apiPost('/api/billing/portal', {});
  if (ok && data.url) { window.location.href = data.url; }
  else { btn.disabled = false; btn.textContent = 'Manage billing (Stripe portal)'; showMsg('gdpr-msg', 'Could not open portal.', 'error'); }
});

// ── API Keys ────────────────────────────────────────────────────────────────────
async function loadApiKeys() {
  const list = document.getElementById('api-keys-list');
  if (!list) return;
  try {
    const resp = await fetch('/api/account/api-keys');
    if (!resp.ok) { list.innerHTML = '<p class="loading-text">Could not load keys.</p>'; return; }
    const {keys} = await resp.json();
    if (!keys || keys.length === 0) { list.innerHTML = '<p class="loading-text">No API keys yet.</p>'; return; }
    list.innerHTML = keys.map(k => `
      <div class="api-key-row" data-key-id="${k.key_id}">
        <span class="api-key-prefix">${k.key_prefix}${'•'.repeat(12)}</span>
        <span class="api-key-label">${k.label || 'Unlabelled'}</span>
        <span class="api-key-label" style="color:#475569">${k.last_used_at ? 'Last used ' + new Date(k.last_used_at).toLocaleDateString() : 'Never used'}</span>
        <button class="btn-danger btn-sm" onclick="revokeKey('${k.key_id}')">Revoke</button>
      </div>
    `).join('');
  } catch { list.innerHTML = '<p class="loading-text">Error loading keys.</p>'; }
}

window.revokeKey = async function(keyId) {
  if (!confirm('Revoke this API key? It will stop working immediately.')) return;
  const resp = await fetch(`/api/account/api-keys/${keyId}`, {method: 'DELETE'});
  if (resp.ok) { await loadApiKeys(); }
  else { showMsg('api-key-msg', 'Could not revoke key.', 'error'); }
};

document.getElementById('create-key-btn')?.addEventListener('click', async () => {
  const btn   = document.getElementById('create-key-btn');
  const label = document.getElementById('key_label')?.value || '';
  btn.disabled = true; btn.textContent = 'Creating…';
  const {ok, data} = await apiPost('/api/account/api-keys', {label});
  btn.disabled = false; btn.textContent = 'Create API key';
  if (ok && data.key) {
    document.getElementById('new-key-value').textContent = data.key;
    document.getElementById('new-key-reveal').hidden = false;
    document.getElementById('key_label').value = '';
    await loadApiKeys();
  } else {
    showMsg('api-key-msg', data.message || 'Could not create key.', 'error');
  }
});

// ── GDPR ───────────────────────────────────────────────────────────────────────
document.getElementById('export-data-btn')?.addEventListener('click', async () => {
  const btn = document.getElementById('export-data-btn');
  btn.disabled = true; btn.textContent = 'Requesting…';
  const {ok, data} = await apiPost('/api/account/export-data', {});
  btn.disabled = false; btn.textContent = 'Request data export';
  if (ok) showMsg('gdpr-msg', "Export requested. You'll receive an email with a download link shortly.", 'success');
  else    showMsg('gdpr-msg', data.message || 'Export failed.', 'error');
});

document.getElementById('delete-account-btn')?.addEventListener('click', async () => {
  const confirmed = confirm(
    'Delete your account permanently?\n\n' +
    'Your email, profile, and session history will be erased.\n' +
    'Graphs you built will remain (they contain no personal data).\n\n' +
    'This cannot be undone.'
  );
  if (!confirmed) return;

  const password = prompt('Enter your password to confirm:');
  if (!password) return;

  const btn = document.getElementById('delete-account-btn');
  btn.disabled = true; btn.textContent = 'Deleting…';

  const {ok, data} = await apiPost('/api/account/delete', {
    confirmation: 'DELETE MY ACCOUNT',
    password,
  });
  if (ok && data.success) { window.location.href = data.redirect || '/'; }
  else {
    btn.disabled = false; btn.textContent = 'Delete my account';
    showMsg('gdpr-msg', data.error || 'Deletion failed. Try again or contact privacy@arivu.app.', 'error');
  }
});

// ── Init ────────────────────────────────────────────────────────────────────────
(function init() { loadApiKeys(); })();
```

---

## §18 — tests/test_phase6.py (complete)

```python
"""
tests/test_phase6.py — Phase 6 test suite.
All tests offline — no live Stripe, Resend, or hCaptcha required.
Run: pytest tests/test_phase6.py -v
"""
import json, inspect
import pytest
from unittest.mock import patch, MagicMock


def _make_test_graph(n: int = 15) -> dict:
    import random
    rng = random.Random(42)
    nodes = [{"id": f"paper_{i}", "title": f"Test Paper {i}", "authors": [f"Author {i}"],
              "year": 2010 + i, "citation_count": rng.randint(10, 1000),
              "fields_of_study": ["Computer Science"] if i % 3 != 0 else ["Biology"],
              "is_bottleneck": i == 0, "pruning_impact": 0.35 if i == 0 else rng.random() * 0.1,
              "abstract": f"Abstract for paper {i}."} for i in range(n)]
    edges = [{"source": f"paper_{i}", "target": f"paper_{i-1}",
               "mutation_type": "adoption", "similarity_score": round(0.4 + rng.random() * 0.4, 3),
               "base_confidence": round(0.5 + rng.random() * 0.3, 3)} for i in range(1, n)]
    return {"nodes": nodes, "edges": edges,
            "metadata": {"seed_paper_id": f"paper_{n-1}", "seed_paper_title": "Test Seed"}}


class TestPasswordHashing:
    def test_hash_and_verify(self):
        import bcrypt
        pw     = "test_password_123"
        hashed = bcrypt.hashpw(pw.encode(), bcrypt.gensalt(rounds=12))
        assert bcrypt.checkpw(pw.encode(), hashed)

    def test_wrong_password_fails(self):
        import bcrypt
        hashed = bcrypt.hashpw(b"correct", bcrypt.gensalt(rounds=12))
        assert not bcrypt.checkpw(b"wrong", hashed)


class TestCaptcha:
    def test_captcha_required_after_5_failures(self):
        from backend.captcha import captcha_required
        assert captcha_required(0) is False
        assert captcha_required(4) is False
        assert captcha_required(5) is True

    def test_verify_captcha_bypasses_without_key(self):
        from backend.captcha import verify_captcha
        import backend.captcha as cap_mod
        orig = cap_mod.Config.HCAPTCHA_SECRET_KEY
        cap_mod.Config.HCAPTCHA_SECRET_KEY = ""
        try:
            assert verify_captcha("any_token", "127.0.0.1") is True
        finally:
            cap_mod.Config.HCAPTCHA_SECRET_KEY = orig


class TestDecorators:
    def test_require_auth_passthrough_when_disabled(self):
        from backend.decorators import require_auth
        import backend.decorators as dec_mod
        orig = dec_mod.Config.ENABLE_AUTH
        dec_mod.Config.ENABLE_AUTH = False
        try:
            called = []
            @require_auth
            def view(): called.append(True); return "ok"
            from flask import Flask
            with Flask(__name__).test_request_context("/"):
                assert view() == "ok"
                assert called
        finally:
            dec_mod.Config.ENABLE_AUTH = orig

    def test_tier_order_mapping(self):
        from backend.decorators import TIER_ORDER
        assert TIER_ORDER["free"] < TIER_ORDER["researcher"] < TIER_ORDER["lab"]

    def test_check_graph_limit_does_not_increment(self):
        """check_graph_limit must NOT contain graphs_this_month + 1 — increment is in stream route."""
        from backend.decorators import check_graph_limit
        source = inspect.getsource(check_graph_limit)
        assert "graphs_this_month + 1" not in source, (
            "check_graph_limit still increments — move increment to stream route (§12.2)."
        )


class TestSessionExpiry:
    def test_get_session_excludes_expired(self):
        from backend.session_manager import _manager
        with patch("backend.session_manager.db.fetchone", return_value=None):
            assert _manager.get_session("expired_session_id_12345678901234567890") is False


class TestGDPR:
    def test_delete_nonexistent_user_returns_false(self):
        from backend.gdpr import delete_user_account
        with patch("backend.gdpr.db.fetchone", return_value=None):
            assert delete_user_account("nonexistent") is False

    def test_export_creates_zip(self):
        from backend.gdpr import generate_user_data_export
        fake_user = {"user_id": "test-uuid", "email": "t@t.com", "tier": "free", "created_at": None}
        with (patch("backend.gdpr.db.fetchone", return_value=fake_user),
              patch("backend.gdpr.db.fetchall", return_value=[]),
              patch("backend.gdpr.R2Client") as mock_r2):
            mock_r2.return_value.upload.return_value = None
            mock_r2.return_value.presigned_url.return_value = "https://example.com/dl.zip"
            url = generate_user_data_export("test-uuid")
        assert url == "https://example.com/dl.zip"


class TestBillingWebhook:
    def test_raises_on_bad_signature(self):
        from backend.billing import handle_webhook
        with patch("stripe.Webhook.construct_event", side_effect=Exception("bad sig")):
            with pytest.raises(Exception):
                handle_webhook(b"raw", "bad_sig")

    def test_cancellation_sets_expiry_not_immediate_free(self):
        import time
        from backend.billing import handle_webhook
        future_ts = int(time.time()) + 86400 * 15
        fake_event = {"type": "customer.subscription.deleted",
                      "data": {"object": {"customer": "cus_test", "current_period_end": future_ts}}}
        executed_sql = []
        with (patch("stripe.Webhook.construct_event", return_value=fake_event),
              patch("backend.billing.db.execute", side_effect=lambda sql, p=(): executed_sql.append(sql)),
              patch("backend.billing.db.fetchone", return_value=None),
              patch("backend.billing.Config") as mock_cfg):
            mock_cfg.STRIPE_SECRET_KEY = "sk_test"
            mock_cfg.STRIPE_WEBHOOK_SECRET = "whsec"
            mock_cfg.STRIPE_RESEARCHER_PRICE_ID = "price_r"
            mock_cfg.STRIPE_LAB_PRICE_ID = "price_l"
            handle_webhook(b"raw", "sig")
        for sql in executed_sql:
            if "UPDATE users" in sql:
                assert "tier = 'free'" not in sql, (
                    "Cancellation is immediately downgrading to free — should set tier_expires_at instead."
                )


class TestIndependentDiscoveryTracker:
    def test_empty_for_small_graph(self):
        from backend.independent_discovery import IndependentDiscoveryTracker
        assert IndependentDiscoveryTracker().find_independent_discoveries(
            {"nodes": [{"id": "p1"}], "edges": []}
        ) == []

    def test_skips_cited_pairs(self):
        from backend.independent_discovery import IndependentDiscoveryTracker
        graph = {"nodes": [{"id": "p1", "year": 2020, "title": "A"},
                            {"id": "p2", "year": 2020, "title": "B"}],
                 "edges": [{"source": "p1", "target": "p2"}]}
        with patch("backend.independent_discovery.db.fetchall", return_value=[
            {"paper_id": "p1", "embedding": [1.0, 0.0, 0.0]},
            {"paper_id": "p2", "embedding": [1.0, 0.0, 0.0]},
        ]):
            result = IndependentDiscoveryTracker().find_independent_discoveries(graph)
        assert result == []

    def test_to_dict_serializable(self):
        from backend.independent_discovery import DiscoveryPair
        pair = DiscoveryPair("p1","p2","A","B",2020,2020,0.85,3,"month","concept","high")
        json.dumps(pair.to_dict())


class TestCitationShadowDetector:
    def test_empty_for_small_graph(self):
        from backend.citation_shadow import CitationShadowDetector
        assert CitationShadowDetector().detect_shadows(
            {"nodes": [{"id": "p1"}, {"id": "p2"}], "edges": []}
        ) == []

    def test_finds_shadow(self):
        from backend.citation_shadow import CitationShadowDetector
        nodes = [{"id": f"p{i}", "title": f"Paper {i}", "year": 2010+i, "citation_count": 100} for i in range(1,11)]
        edges = [{"source": f"p{i+1}", "target": f"p{i}"} for i in range(1, 10)]
        result = CitationShadowDetector().detect_shadows({"nodes": nodes, "edges": edges, "metadata": {}})
        assert "p1" in [s.paper_id for s in result]

    def test_to_dict_serializable(self):
        from backend.citation_shadow import ShadowPaper
        json.dumps(ShadowPaper("p1","T",2020,2,10,4.0,500).to_dict())


class TestFieldFingerprintAnalyzer:
    def test_returns_fingerprint(self):
        from backend.field_fingerprint import FieldFingerprintAnalyzer
        result = FieldFingerprintAnalyzer().analyze(_make_test_graph(15))
        assert 0.0 <= result.bottleneck_concentration <= 1.0
        assert result.summary

    def test_empty_graph_returns_zeros(self):
        from backend.field_fingerprint import FieldFingerprintAnalyzer
        result = FieldFingerprintAnalyzer().analyze({"nodes": [], "edges": [], "metadata": {}})
        assert result.bottleneck_concentration == 0.0

    def test_to_dict_serializable(self):
        from backend.field_fingerprint import FieldFingerprintAnalyzer
        result = FieldFingerprintAnalyzer().analyze(_make_test_graph(10))
        d = result.to_dict()
        json.dumps(d)
        assert "dimensions" in d and "radar_labels" in d


class TestSerendipityEngine:
    def test_empty_without_embeddings(self):
        from backend.serendipity_engine import SerendipityEngine
        with patch("backend.serendipity_engine.db.fetchall", return_value=[]):
            assert SerendipityEngine().find_analogs(_make_test_graph(5)) == []

    def test_to_dict_serializable(self):
        from backend.serendipity_engine import StructuralAnalog
        json.dumps(StructuralAnalog("p1","A",["CS"],"p2","B",["Bio"],0.75,1.0,0.75,"insight").to_dict())


class TestMailer:
    def test_disabled_without_api_key(self):
        from backend.mailer import send_verification_email
        import backend.mailer as mm
        orig = mm.Config.RESEND_API_KEY
        mm.Config.RESEND_API_KEY = ""
        try:
            assert send_verification_email("t@t.com", "T", "token123") is True
        finally:
            mm.Config.RESEND_API_KEY = orig

    def test_payment_failed_email_exists(self):
        from backend import mailer
        assert hasattr(mailer, "send_payment_failed_email"), (
            "send_payment_failed_email missing from mailer.py — apply §5."
        )


class TestPhase6RateLimits:
    def test_limits_present(self):
        from backend.rate_limiter import arivu_rate_limiter
        limits = getattr(arivu_rate_limiter, "LIMITS", {})
        for ep in ["GET /api/independent-discovery", "GET /api/citation-shadow",
                   "GET /api/field-fingerprint", "GET /api/serendipity",
                   "GET /api/account/api-keys", "GET /api/graph-memory",
                   "POST /api/graph-memory"]:
            assert ep in limits, f"Rate limit missing for {ep!r} — apply §13."


class TestApiKeyRoutes:
    @pytest.fixture
    def client(self):
        from app import create_app
        app = create_app()
        app.config["TESTING"] = True
        with app.test_client() as c:
            yield c

    def test_get_api_keys_not_405(self, client):
        resp = client.get("/api/account/api-keys")
        assert resp.status_code != 405, "GET /api/account/api-keys returns 405 — route is missing. Apply §12.5."


class TestAuthRoutes:
    @pytest.fixture
    def client(self):
        from app import create_app
        app = create_app()
        app.config["TESTING"] = True
        with app.test_client() as c:
            yield c

    def test_login_200(self, client):         assert client.get("/login").status_code == 200
    def test_register_200(self, client):      assert client.get("/register").status_code == 200
    def test_pricing_200(self, client):       assert client.get("/pricing").status_code == 200
    def test_privacy_200(self, client):       assert client.get("/privacy").status_code == 200
    def test_account_requires_auth(self, client): assert client.get("/account").status_code in (301,302,401)
    def test_login_rejects_empty(self, client): assert client.post("/login", json={}).status_code in (400,401)
    def test_forgot_always_success(self, client):
        resp = client.post("/forgot-password", json={"email": "nope@nowhere.com"})
        assert resp.status_code == 200
        assert resp.get_json().get("success") is True

    def test_key_prefix_is_8_chars(self):
        """key_prefix must be exactly 8 characters as documented."""
        from app import api_create_api_key
        source = inspect.getsource(api_create_api_key)
        assert "raw_key[:8]" in source, (
            "key_prefix uses wrong length — must be raw_key[:8]. Apply §12.5."
        )
```

---

## §19 — Common Failure Modes

### Stripe `construct_event` fails with `SignatureVerificationError`
You called `request.get_json()` before `request.data`. Flask parses the body on first access.
For webhooks: **always use `request.data` first**, then verify, then parse. Never call `request.json` in the webhook route.

### Email not received
- Check Resend dashboard → Logs for delivery status
- Verify domain DNS records (SPF + DKIM) for `arivu.app`
- Check `EMAIL_FROM` matches verified domain in Resend
- Resend free tier: 100 emails/day — check for limit hits

### hCaptcha always fails in local dev
Set `HCAPTCHA_SITE_KEY=` and `HCAPTCHA_SECRET_KEY=` (empty) in `.env`. The captcha module bypasses verification when secret key is empty.

### Stripe checkout redirects to wrong URL
`success_url` and `cancel_url` use `Config.CUSTOM_DOMAIN`. Ensure `CUSTOM_DOMAIN=arivu.app` is set in Koyeb.

### `pgvector` operator error in SerendipityEngine
```python
# CORRECT:
"1 - (pe.embedding <=> %s::vector)"
# WRONG — type mismatch:
"1 - (pe.embedding <=> %s)"
```

### Cookie consent banner reappears every page load in local dev
The consent cookie requires HTTPS for the Secure flag. On `http://localhost`, the Secure flag causes browsers to silently drop the cookie. The `setConsent()` function in base.html detects `location.protocol` and omits Secure on HTTP. Verify you have the updated version from §16.2.

### `ENABLE_AUTH=true` breaks existing anonymous sessions
`@require_auth` passes through when `ENABLE_AUTH=False`. In production with `ENABLE_AUTH=True`, existing anonymous sessions (no `user_id`) are still valid for anonymous routes. Only routes with `@require_auth` require login.

### `sessions` table `user_id` FK constraint fails
Always cast to `::uuid`:
```python
# CORRECT:
db.execute("... WHERE user_id = %s::uuid", (user_id,))
```

### graphs_this_month double-counting
The `@check_graph_limit` decorator does NOT increment the counter. The increment is in the stream route after a cache miss is confirmed. If you see double-counting, verify `graph_engine.py` contains no `graphs_this_month` reference.

### Stripe cancellation immediately reverts to free
The `customer.subscription.deleted` handler sets `tier_expires_at` to the period end, NOT `tier = 'free'`. The nightly maintenance job handles the downgrade when `tier_expires_at < NOW()`. If you see immediate reversion, verify the webhook handler in `backend/billing.py` matches §8.

### `Config.stripe_enabled()` called without parentheses
Always call with parentheses: `Config.stripe_enabled()` not `Config.stripe_enabled`. The lowercase name makes this easier to spot. Add this check to code review:
```bash
grep -rn "Config\.stripe_enabled[^(]" backend/ app.py
grep -rn "Config\.email_enabled[^(]"  backend/ app.py
# Expected: no output
```

---

## §20 — Done When

Phase 6 is complete when ALL of the following are true:

1. **All tests pass:**
   ```bash
   python -m pytest tests/ -v
   # All pass. 0 failed. (smoke + phase2 + phase3 + phase4 + phase5 + phase6)
   ```

2. **Migration ran:**
   ```bash
   python scripts/migrate_phase6.py
   # ✅ Phase 6 schema applied successfully.
   psql $DATABASE_URL -c "\dt" | grep -E "users|api_keys|lab_memberships|graph_memory"
   ```

3. **Registration → verification → login works end-to-end**

4. **Login → cookie set → /account accessible**

5. **10 graphs → 429 on 11th (cache miss only, not cache hits)**

6. **Stripe test checkout completes → webhook fires → tier updated**

7. **`/pricing` loads at `https://arivu.app/pricing`**

8. **`/privacy` loads**

9. **Intelligence endpoints respond with session cookie**

10. **GDPR export → email received with download link**

11. **Cookie consent banner appears first visit, disappears after choice**

12. **Nightly maintenance script runs without errors:**
    ```bash
    python scripts/nightly_maintenance.py
    ```

13. **Koyeb scheduled job created** (§11.1)

14. **`CONTEXT.md` updated**, Phase 6 under "Completed"

15. **Two git commits on `main`:**
    - `[phase6] user accounts, billing, GDPR, independent discovery, citation shadow, field fingerprint, serendipity`
    - `[context] Phase 6 complete — auth and billing live`

---

## What NOT To Do in Phase 6

- Do NOT implement the Time Machine — Phase 7
- Do NOT implement the Geological Core Sample or Idea Flow River — Phase 7
- Do NOT implement the Supervisor Dashboard — Phase 7+
- Do NOT implement the Collaborative Annotation system — Phase 7+
- Do NOT implement the Prediction Market — Phase 7+
- Do NOT implement the Adversarial Reviewer (PDF upload) — Phase 7
- Do NOT implement the Lab Genealogy System — Phase 7+
- Do NOT implement email change — Phase 7 (account.html shows it read-only)
- Do NOT set `FLASK_DEBUG=true` in Koyeb
- Do NOT commit `.env` or any file with real API keys to git
- Do NOT go live with `ENABLE_AUTH=true` until registration, email verification, and password reset are tested end-to-end in production
- Do NOT run `scripts/nightly_maintenance.py` as a Koyeb web service — it's a cron job
- Do NOT process Stripe webhook events without signature verification
- Do NOT store full API keys — only `key_hash` (SHA-256) and `key_prefix` (first 8 chars)
- Do NOT add `graphs_this_month` increment to `graph_engine.py` — it belongs in the stream route
- Do NOT call `Config.stripe_enabled` or `Config.email_enabled` without parentheses
- Do NOT call `resend.api_key = ...` inside `_send()` — it's set once at startup by `_init_resend()`
