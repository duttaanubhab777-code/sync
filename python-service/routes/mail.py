"""Mail relay for the Node backend (Render free plan cannot send email itself).

POST /mail/send   header  X-Relay-Key: <MAIL_RELAY_SECRET>
                  body    {"to": "...", "subject": "...", "html": "...", "fromName"?, "replyTo"?}
GET  /mail/diag   header X-Relay-Key, or ?key=<MAIL_RELAY_SECRET> so it opens in a phone browser
                  (+ optional &to=you@gmail.com to send a test mail)

Server-to-server only: any request that carries a browser Origin header is refused.
"""
from __future__ import annotations

import hmac
import logging

from flask import Blueprint, current_app, request

from services import mail_service
from utils.responses import error_response, success_response
from utils.security import get_client_ip

log = logging.getLogger("sync.media")

mail_bp = Blueprint("mail", __name__)

MAX_HTML_CHARS = 200_000
MAX_SUBJECT_CHARS = 200


def _key_ok(given: str, secret: str) -> bool:
    # compare as bytes so a non-ASCII key can never crash the request
    return bool(secret) and hmac.compare_digest(str(given or "").encode("utf-8"), secret.encode("utf-8"))


def _guard(allow_query_key: bool = False):
    """Common checks. Returns (runtime, settings, client_ip, error_response_or_None).

    ``allow_query_key`` is only for /mail/diag: a phone browser cannot send custom headers.
    (A key in a URL can end up in browser history, so use it only for the self-test.)
    """
    runtime = current_app.extensions["sync_media"]
    settings = runtime.settings
    client_ip = get_client_ip(request.headers, request.remote_addr, settings.client_ip_header)

    if request.headers.get("Origin"):  # browsers must never call the relay
        return runtime, settings, client_ip, error_response(403, "Forbidden")

    if not settings.mail_configured:
        log.error("/mail called but the mail relay is not configured: %s", "; ".join(settings.mail_problems))
        return runtime, settings, client_ip, error_response(503, "Mail relay is not configured")

    blocked, retry_after = runtime.mail_failure_limiter.is_blocked(client_ip)
    if blocked:
        return runtime, settings, client_ip, error_response(
            429, "Too many failed attempts", headers={"Retry-After": str(retry_after)}
        )

    given = request.headers.get("X-Relay-Key") or (request.args.get("key") if allow_query_key else "")
    if not _key_ok(given, settings.mail_relay_secret):
        runtime.mail_failure_limiter.record(client_ip)
        log.warning("Mail relay: wrong key")
        return runtime, settings, client_ip, error_response(403, "Forbidden")

    return runtime, settings, client_ip, None


@mail_bp.post("/mail/send")
def send():
    runtime, settings, _ip, failed = _guard()
    if failed is not None:
        return failed

    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return error_response(400, "Body must be a JSON object")

    to = str(data.get("to") or "").strip().lower()
    subject = mail_service.one_line(data.get("subject"), MAX_SUBJECT_CHARS)
    html = str(data.get("html") or "")
    reply_to = str(data.get("replyTo") or "").strip()

    if not mail_service.EMAIL_RE.match(to) or len(to) > 254 or not subject or not html:
        return error_response(400, "Bad request")
    if len(html) > MAX_HTML_CHARS:
        return error_response(413, "Message too large")
    if reply_to and not mail_service.EMAIL_RE.match(reply_to):
        reply_to = ""  # a bad reply-to must not stop the mail

    # Defence in depth: even with the right key, one address cannot be flooded.
    allowed, retry_after = runtime.mail_recipient_limiter.allow(to)
    if not allowed:
        return error_response(
            429, "Too many mails to this address. Please wait.", headers={"Retry-After": str(retry_after)}
        )

    try:
        port = mail_service.send_mail(settings, to, subject, html, data.get("fromName") or "", reply_to)
    except Exception as exc:  # noqa: BLE001 - Node shows a friendly message, we log the reason
        code, hint = mail_service.explain(exc)
        log.error("Mail send failed (%s): %s", code, type(exc).__name__)
        return error_response(502, f"{code}: {hint}")

    log.info("Mail sent via port %s", port)  # never log the address or the body (it holds an OTP)
    return success_response({"port": port}, "Mail sent")


@mail_bp.get("/mail/diag")
def diag():
    """Owner-only self-test (phone browser can't send headers, so use curl / the Bash console)."""
    _runtime, settings, _ip, failed = _guard(allow_query_key=True)
    if failed is not None:
        return failed

    report = {"gmailUser": settings.gmail_user, "ports": mail_service.check_ports(settings)}
    to = (request.args.get("to") or "").strip()
    if to:
        if not mail_service.EMAIL_RE.match(to):
            report["testMail"] = "Invalid 'to' address"
        else:
            try:
                html = "<p>Sync mail relay is working. This test mail was sent from PythonAnywhere.</p>"
                port = mail_service.send_mail(settings, to, "Sync mail relay test", html)
                report["testMail"] = f"Sent via port {port}"
            except Exception as exc:  # noqa: BLE001
                code, hint = mail_service.explain(exc)
                report["testMail"] = f"FAIL {code}: {hint}"
    report["ok"] = any(row["result"] == "OK" for row in report["ports"])
    return success_response(report, "Mail diagnostics")
