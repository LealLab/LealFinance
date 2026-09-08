"""Outgoing email over SMTP.

`send_email` is a no-op unless SMTP is configured (see Settings.email_enabled),
mirroring app/services/exchange_rates.py, which silently degrades without an
API key. The only mail the app sends today is the invitation link; without
SMTP an admin copies that link from the users screen instead.

Sends are blocking stdlib smtplib. Callers schedule them off the request path
(FastAPI BackgroundTasks) so a slow or dead SMTP host never delays a response.
"""

import html as html_lib
import logging
import smtplib
from email.message import EmailMessage
from email.utils import formataddr
from urllib.parse import urlencode

from app.core.config import get_settings

logger = logging.getLogger(__name__)

_SMTP_TIMEOUT_SECONDS = 10
_FROM_NAME = "LealFinance"
_BRAND = "#135e71"  # matches frontend/public/logo.svg
_FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"


def send_email(*, to: str, subject: str, body: str, html: str | None = None) -> None:
    """Deliver one message. No-op when SMTP is unconfigured.

    `body` is the plain-text part; `html`, if given, is added as an
    alternative so clients that render it get the styled version.

    Never raises: a delivery failure is logged, not propagated, because the
    invitation token is already persisted and the link stays copyable.
    """
    settings = get_settings()
    host = settings.smtp_host
    if not settings.email_enabled or not host:
        return

    from_addr = settings.smtp_from or settings.smtp_username or "lealfinance@localhost"
    message = EmailMessage()
    message["From"] = formataddr((_FROM_NAME, from_addr))
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)
    if html:
        message.add_alternative(html, subtype="html")

    try:
        with smtplib.SMTP(host, settings.smtp_port, timeout=_SMTP_TIMEOUT_SECONDS) as smtp:
            if settings.smtp_starttls:
                smtp.starttls()
            if settings.smtp_username and settings.smtp_password:
                smtp.login(settings.smtp_username, settings.smtp_password)
            smtp.send_message(message)
    except (OSError, smtplib.SMTPException):
        logger.exception("Failed to send email to %s", to)


def build_invitation_email(*, email: str, token: str) -> tuple[str, str, str]:
    """Subject, plain-text body, and HTML body for an invitation. English only
    - the /register page the link opens is fully translated, and the backend
    has no i18n catalog."""
    base_url = (get_settings().app_base_url or "").rstrip("/")
    query = urlencode({"email": email, "token": token})
    link = f"{base_url}/register?{query}"
    ttl_days = get_settings().invitation_ttl_days

    subject = "You've been invited to LealFinance"
    text = (
        "You've been invited to LealFinance.\n\n"
        "An administrator invited you to create an account. Open this link to "
        f"get started (expires in {ttl_days} days):\n\n"
        f"{link}\n"
    )
    return subject, text, _invitation_html(link=link, ttl_days=ttl_days)


def _invitation_html(*, link: str, ttl_days: int) -> str:
    href = html_lib.escape(link, quote=True)
    shown = html_lib.escape(link)
    card = (
        "max-width:600px;width:100%;background:#ffffff;"
        "border:1px solid #e5e7eb;border-radius:12px;overflow:hidden"
    )
    header = f"padding:28px 24px;font-family:{_FONT};font-size:22px;font-weight:700;color:#ffffff"
    body_td = f"padding:32px 40px 4px;font-family:{_FONT};color:#1f2937;text-align:center"
    lead = "margin:0 0 8px;font-size:15px;line-height:1.6;color:#4b5563"
    note = "margin:0 0 24px;font-size:13px;color:#6b7280"
    tail_td = f"padding:0 40px 36px;font-family:{_FONT};text-align:center"
    button = (
        f"display:inline-block;padding:13px 30px;font-family:{_FONT};font-size:15px;"
        "font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px"
    )
    hint = "margin:0 0 6px;font-size:12px;color:#6b7280"
    fallback = "margin:0;font-size:12px;word-break:break-all"
    footer = f"margin:16px 0 0;font-family:{_FONT};font-size:11px;color:#9ca3af"
    lines = [
        "<!doctype html>",
        '<html><body style="margin:0;padding:0;background:#f4f5f7;">',
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"'
        ' style="background:#f4f5f7;"><tr>',
        '<td align="center" style="padding:32px 16px;">',
        f'<table role="presentation" cellpadding="0" cellspacing="0" style="{card}">',
        f'<tr><td align="center" bgcolor="{_BRAND}" style="{header}">LealFinance</td></tr>',
        f'<tr><td style="{body_td}">',
        '<h1 style="margin:0 0 12px;font-size:20px;font-weight:700;">You\'re invited</h1>',
        f'<p style="{lead}">An administrator invited you to LealFinance.'
        " Use the button below to create your account.</p>",
        f'<p style="{note}">This invitation expires in {ttl_days} days.</p>',
        "</td></tr>",
        '<tr><td align="center" style="padding:4px 40px 32px;">',
        '<table role="presentation" cellpadding="0" cellspacing="0"><tr>',
        f'<td align="center" bgcolor="{_BRAND}" style="border-radius:8px;">',
        f'<a href="{href}" style="{button}">Create your account</a>',
        "</td></tr></table></td></tr>",
        f'<tr><td style="{tail_td}">',
        f'<p style="{hint}">If the button doesn\'t work, copy and paste this link'
        " into your browser:</p>",
        f'<p style="{fallback}"><a href="{href}" style="color:{_BRAND};">{shown}</a></p>',
        "</td></tr></table>",
        f'<p style="{footer}">LealFinance &middot; self-hosted personal finance</p>',
        "</td></tr></table></body></html>",
    ]
    return "\n".join(lines)
