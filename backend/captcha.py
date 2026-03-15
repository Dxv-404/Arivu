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
