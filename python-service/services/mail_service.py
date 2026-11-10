"""Gmail SMTP sender used by the /mail/send relay route.

Render's free plan blocks outgoing SMTP, but PythonAnywhere (free) can reach
smtp.gmail.com. The Node backend therefore asks THIS service to send the mail.

Nothing in this module ever logs or returns the Gmail app password.
"""
from __future__ import annotations

import logging
import re
import smtplib
import socket
import ssl
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid
from html import unescape
from typing import List, Tuple

log = logging.getLogger("sync.media.mail")

EMAIL_RE = re.compile(r"^[^\s@<>\",;]+@[^\s@<>\",;]+\.[^\s@<>\",;]{2,}$")
SMTP_TIMEOUT_SECONDS = 12  # per port; Node waits longer than 2x this


class MailNotConfiguredError(Exception):
    """Gmail user / app password are missing."""


def one_line(value, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit]


def html_to_text(html: str) -> str:
    """Plain-text twin of the HTML mail (better spam score, readable in old mail apps)."""
    text = re.sub(r"(?is)<(script|style|head).*?>.*?</\1>", "", html)
    text = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</tr>|</h[1-6]>", "\n", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = unescape(text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n\s*\n+", "\n\n", text)
    return text.strip() or "Please view this email in an HTML-capable mail app."


def build_message(settings, to: str, subject: str, html: str, from_name: str = "", reply_to: str = "") -> EmailMessage:
    msg = EmailMessage()
    msg["From"] = formataddr((one_line(from_name or settings.mail_from_name, 80), settings.gmail_user))
    msg["To"] = to
    msg["Subject"] = subject
    msg["Date"] = formatdate(localtime=False)
    msg["Message-ID"] = make_msgid(domain=settings.gmail_user.split("@")[-1] or None)
    if reply_to:
        msg["Reply-To"] = reply_to
    msg.set_content(html_to_text(html))
    msg.add_alternative(html, subtype="html")
    return msg


def _port_plan(mode: str) -> List[Tuple[int, str]]:
    if mode == "465":
        return [(465, "ssl")]
    if mode == "587":
        return [(587, "starttls")]
    return [(465, "ssl"), (587, "starttls")]


def _open(settings, port: int, mode: str):
    """Connect + log in on one port and return the open connection."""
    ctx = ssl.create_default_context()
    if mode == "ssl":
        server = smtplib.SMTP_SSL(settings.smtp_host, port, timeout=SMTP_TIMEOUT_SECONDS, context=ctx)
    else:
        server = smtplib.SMTP(settings.smtp_host, port, timeout=SMTP_TIMEOUT_SECONDS)
        server.ehlo()
        server.starttls(context=ctx)
        server.ehlo()
    try:
        server.login(settings.gmail_user, settings.gmail_app_password)
    except Exception:
        try:
            server.close()
        except Exception:  # noqa: BLE001
            pass
        raise
    return server


def explain(exc: Exception) -> Tuple[str, str]:
    """Turn an exception into (short_code, owner-friendly hint). Safe to show to the owner."""
    if isinstance(exc, MailNotConfiguredError):
        return "not_configured", "Set GMAIL_USER, GMAIL_APP_PASSWORD and MAIL_RELAY_SECRET in config.py"
    if isinstance(exc, smtplib.SMTPAuthenticationError):
        return (
            "gmail_auth_failed",
            "Gmail login failed. Turn on 2-Step Verification and create a NEW App password "
            "(a normal Gmail password does not work).",
        )
    if isinstance(exc, smtplib.SMTPRecipientsRefused):
        return "recipient_refused", "Gmail refused the recipient address"
    if isinstance(exc, smtplib.SMTPSenderRefused):
        return "sender_refused", "Gmail refused the sender address"
    if isinstance(exc, (socket.timeout, TimeoutError)):
        return "timeout", "Timed out while talking to Gmail"
    if isinstance(exc, smtplib.SMTPException):
        return "smtp_error", "Gmail SMTP error"
    if isinstance(exc, (socket.gaierror, ConnectionError, OSError)):
        return "network_blocked", "Could not reach smtp.gmail.com (check /mail/diag)"
    return "error", "Unknown error"


def send_mail(settings, to: str, subject: str, html: str, from_name: str = "", reply_to: str = "") -> int:
    """Send one mail. Tries port 465 then 587 (unless SMTP_MODE pins one). Returns the port used."""
    if not settings.mail_configured:
        raise MailNotConfiguredError()
    msg = build_message(settings, to, subject, html, from_name, reply_to)
    last: Exception | None = None
    for port, mode in _port_plan(settings.smtp_mode):
        try:
            server = _open(settings, port, mode)
            try:
                server.send_message(msg, from_addr=settings.gmail_user, to_addrs=[to])
            finally:
                try:
                    server.quit()
                except Exception:  # noqa: BLE001
                    server.close()
            return port
        except smtplib.SMTPAuthenticationError:
            raise  # wrong login: trying another port will not help
        except Exception as exc:  # noqa: BLE001 - connect/timeout/ssl -> try next port
            log.warning("SMTP port %s failed: %s", port, type(exc).__name__)
            last = exc
    raise last or RuntimeError("no SMTP port configured")


def check_ports(settings) -> list:
    """Connect + login on each port without sending anything (used by /mail/diag)."""
    rows = []
    for port, mode in [(465, "ssl"), (587, "starttls")]:
        row = {"port": port, "mode": mode}
        try:
            server = _open(settings, port, mode)
            server.quit()
            row["result"] = "OK"
        except Exception as exc:  # noqa: BLE001
            code, hint = explain(exc)
            row.update(result="FAIL", code=code, hint=hint, detail=type(exc).__name__)
        rows.append(row)
    return rows
