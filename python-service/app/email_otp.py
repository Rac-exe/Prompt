"""
OTP email service — sole owner of signup/reset OTP state, Resend email
delivery, and Supabase Admin password reset.

Secrets used (read from environment, never shipped to clients):
  - RESEND_API_KEY
  - SUPABASE_SERVICE_ROLE_KEY
  - SUPABASE_URL
"""

import logging
import os
import secrets
import time
from dataclasses import dataclass, field

import httpx
import sentry_sdk

logger = logging.getLogger("prmpt.email_otp")

OTP_EXPIRY_S = 600  # 10 minutes
MAX_ATTEMPTS = 5
FROM_ADDRESS = "TryPrmpt <no-reply@tryprmpt.com>"

RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

if not RESEND_API_KEY:
    logger.warning("[EmailOTP] RESEND_API_KEY not set — OTP emails will be logged to console only")
if not SUPABASE_SERVICE_ROLE_KEY:
    logger.warning("[EmailOTP] SUPABASE_SERVICE_ROLE_KEY not set — admin password reset unavailable")


@dataclass
class PendingSignup:
    name: str
    dob: str
    email: str
    password: str
    otp: str
    expires_at: float
    attempts: int = 0


@dataclass
class PendingReset:
    otp: str
    expires_at: float
    attempts: int = 0


_pending_signups: dict[str, PendingSignup] = {}
_pending_resets: dict[str, PendingReset] = {}


def _generate_otp() -> str:
    return f"{secrets.randbelow(900000) + 100000}"


def _build_otp_html(otp: str, purpose: str) -> str:
    title = "Verify Your Email" if purpose == "signup" else "Reset Your Password"
    subtitle = (
        "Enter this code to complete your sign-up"
        if purpose == "signup"
        else "Enter this code to reset your password"
    )
    return f"""\
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:system-ui,-apple-system,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 0">
    <tr><td align="center">
      <table width="420" cellpadding="0" cellspacing="0" style="background:#141414;border-radius:12px;border:1px solid #222;padding:40px">
        <tr><td align="center" style="padding-bottom:24px">
          <span style="font-size:28px;font-weight:700;color:#fff;letter-spacing:-0.5px">Prmpt</span>
        </td></tr>
        <tr><td align="center" style="padding-bottom:8px">
          <span style="font-size:20px;font-weight:600;color:#fff">{title}</span>
        </td></tr>
        <tr><td align="center" style="padding-bottom:28px">
          <span style="font-size:14px;color:#888">{subtitle}</span>
        </td></tr>
        <tr><td align="center" style="padding-bottom:28px">
          <div style="background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:16px 32px;display:inline-block">
            <span style="font-size:32px;font-weight:700;color:#10b981;letter-spacing:8px;font-family:monospace">{otp}</span>
          </div>
        </td></tr>
        <tr><td align="center" style="padding-bottom:12px">
          <span style="font-size:13px;color:#666">This code expires in 10 minutes.</span>
        </td></tr>
        <tr><td align="center">
          <span style="font-size:12px;color:#444">If you didn't request this, you can safely ignore this email.</span>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""


async def _send_email(to: str, otp: str, purpose: str) -> None:
    subject = (
        "Prmpt \u2013 Verify your email"
        if purpose == "signup"
        else "Prmpt \u2013 Password reset code"
    )
    html = _build_otp_html(otp, purpose)

    if not RESEND_API_KEY:
        logger.info(f"[EmailOTP] (no Resend key) OTP for {to}: {otp}")
        return

    with sentry_sdk.start_span(op="http.client", description=f"Resend send-email ({purpose})") as span:
        span.set_tag("email.purpose", purpose)
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {RESEND_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "from": FROM_ADDRESS,
                    "to": [to],
                    "subject": subject,
                    "html": html,
                },
            )
            span.set_tag("http.status_code", resp.status_code)
            if resp.status_code >= 400:
                body = resp.text
                logger.error(f"[EmailOTP] Resend error {resp.status_code}: {body}")
                sentry_sdk.capture_message(
                    f"Resend API error: {resp.status_code}",
                    level="error",
                )
                raise RuntimeError(f"Resend API error: {resp.status_code}")

    sentry_sdk.add_breadcrumb(
        category="email",
        message=f"OTP email sent ({purpose})",
        level="info",
        data={"purpose": purpose, "status": "sent"},
    )
    logger.info(f"[EmailOTP] OTP email sent to {to} ({purpose})")


# ── Signup OTP ──────────────────────────────────────────────────────────────


async def send_signup_otp(
    email: str, name: str, dob: str, password: str
) -> dict:
    key = email.lower().strip()
    otp = _generate_otp()
    _pending_signups[key] = PendingSignup(
        name=name, dob=dob, email=key, password=password,
        otp=otp, expires_at=time.time() + OTP_EXPIRY_S,
    )
    with sentry_sdk.start_span(op="otp.send", description="send_signup_otp") as span:
        try:
            await _send_email(key, otp, "signup")
            span.set_tag("result", "sent")
            sentry_sdk.add_breadcrumb(
                category="auth", message="Signup OTP stored and sent", level="info",
            )
            return {"success": True}
        except Exception as exc:
            _pending_signups.pop(key, None)
            span.set_tag("result", "error")
            sentry_sdk.capture_exception(exc)
            logger.error(f"[EmailOTP] send_signup_otp failed: {exc}")
            return {"success": False, "error": "Failed to send verification email. Please try again."}


def verify_signup_otp(email: str, otp: str) -> dict:
    key = email.lower().strip()
    pending = _pending_signups.get(key)

    with sentry_sdk.start_span(op="otp.verify", description="verify_signup_otp") as span:
        if not pending:
            span.set_tag("result", "not_found")
            return {"valid": False, "error": "No verification pending for this email. Please sign up again."}

        if time.time() > pending.expires_at:
            _pending_signups.pop(key, None)
            span.set_tag("result", "expired")
            return {"valid": False, "error": "Code has expired. Please request a new one."}

        pending.attempts += 1
        if pending.attempts > MAX_ATTEMPTS:
            _pending_signups.pop(key, None)
            span.set_tag("result", "max_attempts")
            sentry_sdk.capture_message(f"Signup OTP max attempts exceeded for {email}", level="warning")
            return {"valid": False, "error": "Too many failed attempts. Please request a new code."}

        if pending.otp != otp.strip():
            remaining = MAX_ATTEMPTS - pending.attempts
            span.set_tag("result", "wrong_code")
            return {"valid": False, "error": f"Invalid code. {remaining} attempts remaining."}

        _pending_signups.pop(key, None)
        span.set_tag("result", "success")
        sentry_sdk.add_breadcrumb(
            category="auth", message="Signup OTP verified", level="info",
        )
        return {
            "valid": True,
            "data": {
                "name": pending.name,
                "dob": pending.dob,
                "email": pending.email,
                "password": pending.password,
            },
        }


# ── Password Reset OTP ─────────────────────────────────────────────────────


async def send_reset_otp(email: str) -> dict:
    key = email.lower().strip()
    otp = _generate_otp()
    _pending_resets[key] = PendingReset(otp=otp, expires_at=time.time() + OTP_EXPIRY_S)
    with sentry_sdk.start_span(op="otp.send", description="send_reset_otp") as span:
        try:
            await _send_email(key, otp, "reset")
            span.set_tag("result", "sent")
            sentry_sdk.add_breadcrumb(
                category="auth", message="Reset OTP stored and sent", level="info",
            )
            return {"success": True}
        except Exception as exc:
            _pending_resets.pop(key, None)
            span.set_tag("result", "error")
            sentry_sdk.capture_exception(exc)
            logger.error(f"[EmailOTP] send_reset_otp failed: {exc}")
            return {"success": False, "error": "Failed to send reset email. Please try again."}


async def reset_password(email: str, otp: str, new_password: str) -> dict:
    """Verify OTP and update password via Supabase Admin API atomically."""
    key = email.lower().strip()
    pending = _pending_resets.get(key)

    with sentry_sdk.start_span(op="otp.verify", description="reset_password.otp_check") as otp_span:
        if not pending:
            otp_span.set_tag("result", "not_found")
            return {"valid": False, "error": "No reset pending for this email. Please request a new code."}

        if time.time() > pending.expires_at:
            _pending_resets.pop(key, None)
            otp_span.set_tag("result", "expired")
            return {"valid": False, "error": "Code has expired. Please request a new one."}

        pending.attempts += 1
        if pending.attempts > MAX_ATTEMPTS:
            _pending_resets.pop(key, None)
            otp_span.set_tag("result", "max_attempts")
            sentry_sdk.capture_message(f"Reset OTP max attempts exceeded for {email}", level="warning")
            return {"valid": False, "error": "Too many failed attempts. Please request a new code."}

        if pending.otp != otp.strip():
            remaining = MAX_ATTEMPTS - pending.attempts
            otp_span.set_tag("result", "wrong_code")
            return {"valid": False, "error": f"Invalid code. {remaining} attempts remaining."}

        otp_span.set_tag("result", "valid")

    # OTP valid — now update password via Supabase Admin API
    _pending_resets.pop(key, None)

    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        return {"valid": False, "error": "Password reset is not configured. Contact support."}

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            with sentry_sdk.start_span(op="http.client", description="Supabase admin list-users") as span:
                list_resp = await client.get(
                    f"{SUPABASE_URL}/auth/v1/admin/users",
                    headers={
                        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
                        "apikey": SUPABASE_SERVICE_ROLE_KEY,
                    },
                    params={"page": 1, "per_page": 1000},
                )
                span.set_tag("http.status_code", list_resp.status_code)
                if list_resp.status_code >= 400:
                    logger.error(f"[EmailOTP] Admin listUsers error: {list_resp.text}")
                    sentry_sdk.capture_message(f"Admin listUsers error: {list_resp.status_code}", level="error")
                    return {"valid": False, "error": "Could not look up user. Please try again."}

            users = list_resp.json().get("users", [])
            target = next((u for u in users if (u.get("email") or "").lower() == key), None)

            if not target:
                sentry_sdk.add_breadcrumb(
                    category="auth", message="Password reset: user not found in Supabase", level="warning",
                )
                return {"valid": False, "error": "No account found with this email address."}

            with sentry_sdk.start_span(op="http.client", description="Supabase admin update-user") as span:
                update_resp = await client.put(
                    f"{SUPABASE_URL}/auth/v1/admin/users/{target['id']}",
                    headers={
                        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
                        "apikey": SUPABASE_SERVICE_ROLE_KEY,
                        "Content-Type": "application/json",
                    },
                    json={"password": new_password},
                )
                span.set_tag("http.status_code", update_resp.status_code)
                if update_resp.status_code >= 400:
                    logger.error(f"[EmailOTP] Admin updateUser error: {update_resp.text}")
                    sentry_sdk.capture_message(f"Admin updateUser error: {update_resp.status_code}", level="error")
                    return {"valid": False, "error": "Failed to update password. Please try again."}

        logger.info(f"[EmailOTP] Password reset successful for {email}")
        sentry_sdk.add_breadcrumb(
            category="auth", message="Password reset successful", level="info",
        )
        return {"valid": True, "success": True}

    except Exception as exc:
        sentry_sdk.capture_exception(exc)
        logger.error(f"[EmailOTP] Password reset failed: {exc}")
        return {"valid": False, "error": "Password reset failed. Please try again."}


# ── Cleanup ─────────────────────────────────────────────────────────────────


def cleanup_expired() -> None:
    """Remove expired OTP entries. Called periodically."""
    now = time.time()
    expired_s = [k for k, v in _pending_signups.items() if now > v.expires_at]
    expired_r = [k for k, v in _pending_resets.items() if now > v.expires_at]
    for k in expired_s:
        _pending_signups.pop(k, None)
    for k in expired_r:
        _pending_resets.pop(k, None)
    if expired_s or expired_r:
        logger.info(f"[EmailOTP] Cleaned {len(expired_s)} signups, {len(expired_r)} resets")
