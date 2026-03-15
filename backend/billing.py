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
