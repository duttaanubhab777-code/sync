"""Sync Media Service - Flask application.

Two jobs, both small enough for the PythonAnywhere free plan:
  1. /media/sign - creates Cloudinary upload signatures (stores no files).
  2. /mail/send  - mail relay: sends the signup OTP emails through Gmail SMTP,
                   because Render's free plan cannot send email itself.

PythonAnywhere (WSGI) imports ``app`` from here, see pythonanywhere_wsgi.py.
For local development:  python app.py
"""
from __future__ import annotations

import logging
from types import SimpleNamespace
from typing import Optional

from flask import Flask, request
from werkzeug.exceptions import HTTPException

from routes.health import health_bp
from routes.mail import mail_bp
from routes.media import media_bp
from settings import Settings, load_settings
from utils.responses import error_response
from utils.security import SlidingWindowLimiter, is_origin_allowed

CORS_ALLOWED_METHODS = "GET, POST, OPTIONS"
CORS_ALLOWED_HEADERS = "Authorization, Content-Type"
CORS_MAX_AGE_SECONDS = "600"
MAX_REQUEST_BYTES = 8 * 1024  # the sign request is tiny; refuse anything big


def _setup_logging() -> logging.Logger:
    logger = logging.getLogger("sync.media")
    if not logger.handlers:
        handler = logging.StreamHandler()  # stderr -> PythonAnywhere "Error log"
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
        logger.propagate = False
    return logger


def create_app(settings: Optional[Settings] = None) -> Flask:
    logger = _setup_logging()
    settings = settings or load_settings()

    app = Flask(__name__)
    app.url_map.strict_slashes = False
    app.config["MAX_CONTENT_LENGTH"] = MAX_REQUEST_BYTES
    app.config["DEBUG"] = False  # never debug in production
    app.config["PROPAGATE_EXCEPTIONS"] = False

    app.extensions["sync_media"] = SimpleNamespace(
        settings=settings,
        user_limiter=SlidingWindowLimiter(settings.rate_limit_per_minute, 60),
        failure_limiter=SlidingWindowLimiter(settings.auth_failure_limit_per_minute, 60),
        # mail relay: wrong-key attempts per IP, and mails per recipient address (10 minutes)
        mail_failure_limiter=SlidingWindowLimiter(10, 60),
        mail_recipient_limiter=SlidingWindowLimiter(settings.mail_per_recipient_limit, 600),
    )

    for problem in settings.problems:
        logger.error("Configuration problem: %s", problem)
    for warning in settings.warnings:
        logger.warning("Configuration warning: %s", warning)
    for problem in settings.mail_problems:
        logger.warning("Mail relay not ready: %s", problem)
    if settings.is_configured:
        logger.info("Sync Media Service ready (allowed origins: %s)", ", ".join(settings.allowed_origins) or "none")

    app.register_blueprint(health_bp)
    app.register_blueprint(media_bp)
    app.register_blueprint(mail_bp)

    # ---------- CORS (explicit allow-list, never "*") ----------
    @app.before_request
    def handle_preflight():
        if request.method != "OPTIONS":
            return None
        origin = request.headers.get("Origin")
        if not origin:
            return ("", 204)
        if not is_origin_allowed(origin, settings.allowed_origins):
            return error_response(403, "Origin not allowed")
        return ("", 204)  # headers are added in after_request

    @app.after_request
    def add_headers(response):
        origin = request.headers.get("Origin")
        if origin and is_origin_allowed(origin, settings.allowed_origins):
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Vary"] = "Origin"
            if request.method == "OPTIONS":
                response.headers["Access-Control-Allow-Methods"] = CORS_ALLOWED_METHODS
                response.headers["Access-Control-Allow-Headers"] = CORS_ALLOWED_HEADERS
                response.headers["Access-Control-Max-Age"] = CORS_MAX_AGE_SECONDS
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        if request.path == "/media/sign" or request.path.startswith("/mail/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    # ---------- safe error responses (no stack traces, no secrets) ----------
    @app.errorhandler(HTTPException)
    def handle_http_error(exc: HTTPException):
        messages = {
            404: "Not found",
            405: "Method not allowed",
            413: "Request body is too large",
        }
        status = exc.code or 500
        return error_response(status, messages.get(status, exc.name or "Error"))

    @app.errorhandler(Exception)
    def handle_unexpected_error(exc: Exception):
        logger.exception("Unhandled error")
        return error_response(500, "Internal Server Error")

    return app


# PythonAnywhere imports this object. Creating it is harmless: it does not
# start a server and it does not crash when configuration is missing.
app = create_app()

if __name__ == "__main__":
    # Local development only. PythonAnywhere never runs this block.
    app.run(host="127.0.0.1", port=5001, debug=False)
