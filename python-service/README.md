# Sync Python Media and Mail Service

[![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![Flask](https://img.shields.io/badge/Flask-3.x-000000?logo=flask&logoColor=white)](https://flask.palletsprojects.com/)
[![Main project](https://img.shields.io/badge/Part%20of-Sync-6366F1?logo=github)](https://github.com/duttaanubhab777-code/sync)

A small Flask microservice that supports [Sync](https://github.com/duttaanubhab777-code/sync), the real-time communication platform. It provides server-side Cloudinary upload signing and a protected Gmail SMTP relay for signup verification emails.

This service is maintained in two locations:

- **Main Sync repository:** `python-service/` — the canonical development and integration copy.
- **Standalone deployment repository:** [sync_python_media_upload](https://github.com/arnabadhikari777/sync_python_media_upload) — the source repository connected to PythonAnywhere.

The application code and this README are intended to stay identical in both locations. Repository-specific deployment and product documentation remains in the main Sync repository and is linked below.

## Responsibilities

| Capability | What this service does |
|---|---|
| Media signing | Validates a Sync access token and creates a short-lived Cloudinary upload signature. |
| Email relay | Accepts authenticated server-to-server requests from the Node.js backend and sends signup OTP email through Gmail SMTP. |
| Health status | Reports service availability and non-secret configuration status. |
| Diagnostics | Provides a protected SMTP connectivity check for service owners. |

The service does not store uploaded media and does not replace the main Node.js backend. The browser uploads media directly to Cloudinary after receiving signed parameters.

## Architecture

### Media upload

~~~text
Sync browser
    |  Authorization: Bearer <access token>
    v
Python service: POST /api/v1/media/sign
    |  validates token and signs upload parameters
    v
Sync browser ----------------------> Cloudinary
    |                                  |
    | media URL + metadata             | stores media
    v                                  |
Sync Node.js backend <----------------+
    |
    v
MongoDB
~~~

### Signup OTP email

~~~text
Sync browser
    |
    v
Sync Node.js backend
    |  POST /api/v1/mail/send
    |  X-Relay-Key: <shared secret>
    v
Python service
    |
    v
Gmail SMTP
    |
    v
User inbox
~~~

## API reference

All application endpoints are versioned under /api/v1. The prefix is registered centrally in app.py; route decorators inside the blueprints must remain relative to that prefix.

| Method | Endpoint | Authentication | Purpose |
|---|---|---|---|
| GET | /api/v1/health | Public | Liveness and non-secret configuration status. |
| POST | /api/v1/media/sign | Bearer access token | Creates signed Cloudinary upload parameters. |
| POST | /api/v1/mail/send | X-Relay-Key header | Sends an email requested by the trusted Node.js backend. |
| GET | /api/v1/mail/diag | X-Relay-Key header, or key query parameter for owner diagnostics | Checks SMTP connectivity and can optionally send a test email. |

### Media signing

Request:

~~~http
POST /api/v1/media/sign
Authorization: Bearer <accessToken>
Content-Type: application/json
~~~

The request body may be empty or specify one supported purpose:

~~~json
{
  "purpose": "chat"
}
~~~

Supported purposes: chat, voice, avatar, story, group, and notice. If omitted, the service uses chat.

The response contains the Cloudinary upload parameters required by the browser. It must never expose CLOUDINARY_API_SECRET or JWT_SECRET.

### Mail relay

Request:

~~~http
POST /api/v1/mail/send
X-Relay-Key: <MAIL_RELAY_SECRET>
Content-Type: application/json
~~~

Example body:

~~~json
{
  "to": "user@example.com",
  "subject": "Your Sync verification code",
  "html": "<p>Your verification code is ...</p>"
}
~~~

This endpoint is for server-to-server use only. Requests carrying a browser Origin header are rejected. The shared relay secret must be kept private and must match the Node backend configuration.

### SMTP diagnostics

The owner-only endpoint is GET /api/v1/mail/diag. Prefer the X-Relay-Key request header. A key query parameter is supported for limited browser-based diagnostics, but URLs containing secrets may be retained in browser history and logs; do not share them.

## Configuration

Configuration is loaded from environment variables first and then from config.py in the service directory. Environment variables take precedence.

1. Copy config.example.py to config.py.
2. Set the required values in config.py or the hosting provider's environment configuration.
3. Never commit config.py or real credentials.

### Required settings

| Setting | Used for |
|---|---|
| JWT_SECRET | Must exactly match the Node backend's JWT_SECRET; used to verify access tokens. |
| CLOUDINARY_CLOUD_NAME | Cloudinary account name. |
| CLOUDINARY_API_KEY | Cloudinary API key. |
| CLOUDINARY_API_SECRET | Private Cloudinary signing secret. |
| ALLOWED_ORIGINS | Comma-separated list of permitted browser origins; do not use a wildcard. |
| GMAIL_USER | Gmail sender account for OTP messages. |
| GMAIL_APP_PASSWORD | Google App Password, not the normal account password. |
| MAIL_RELAY_SECRET | Shared secret matching the Node backend's mail relay secret; at least 24 characters. |

### Optional settings

The safe template documents optional settings, including MAIL_FROM_NAME, SMTP_MODE, SMTP_HOST, MEDIA_FOLDER_ROOT, ENFORCE_ALLOWED_FORMATS, CLIENT_IP_HEADER, RATE_LIMIT_PER_MINUTE, AUTH_FAILURE_LIMIT_PER_MINUTE, MAIL_PER_RECIPIENT_LIMIT, and JWT_LEEWAY_SECONDS.

Keep private values out of source control, frontend code, browser storage, screenshots, and public issue reports. Do not use VITE_ variables for server secrets.

## Local development

Requirements: Python 3.10 or later and pip.

Run these commands from the directory containing app.py:

~~~sh
python -m venv .venv

# Linux / Alpine Linux / macOS
. .venv/bin/activate

# Windows PowerShell
# .venv\Scripts\Activate.ps1

python -m pip install --upgrade pip
python -m pip install -r requirements.txt
cp config.example.py config.py
python app.py
~~~

Edit config.py with valid development credentials before testing configured functionality. The Flask development server listens on 127.0.0.1:5001 by default. Do not expose the development server directly to the public internet.

For browser-based local testing, add the exact local frontend origin to ALLOWED_ORIGINS. Keep the production origin in the allow-list when required by the deployed Sync application.

## Validation and tests

Run the configuration and dependency check:

~~~sh
python verify_install.py
~~~

Run the automated test suite:

~~~sh
python -m unittest discover -s tests -v
~~~

The tests use isolated test settings and should not require production credentials. Run them after changing routes, authentication, configuration, or service behavior. A successful test run does not replace a deployment smoke test.

## PythonAnywhere deployment

The standalone repository is connected to the PythonAnywhere deployment. The WSGI entry point is pythonanywhere_wsgi.py; use it as the reference when configuring the PythonAnywhere WSGI file.

Deployment checklist:

1. Pull the intended commit from the standalone repository in the PythonAnywhere project directory.
2. Install or update dependencies in the web app's configured virtual environment.
3. Confirm config.py exists on the server and contains the required private settings.
4. Confirm the WSGI file points to the directory containing app.py.
5. Reload the PythonAnywhere web app.
6. Check the public health endpoint.
7. Verify media signing from an authenticated Sync session and verify mail delivery through the normal signup flow.

Health check:

~~~text
https://<PYTHONANYWHERE_USERNAME>.pythonanywhere.com/api/v1/health
~~~

A healthy response confirms that the application is responding; inspect the non-secret configuration indicators as well. Never paste production secrets, access tokens, OTPs, or diagnostic URLs containing keys into support requests or public logs.

The full, maintained deployment procedure is documented in the main Sync repository:
[PythonAnywhere Deployment Guide](https://github.com/duttaanubhab777-code/sync/blob/main/docs/PYTHONANYWHERE_DEPLOYMENT_GUIDE.md).

## Repository synchronization policy

To prevent the two copies from drifting:

- Make service-code changes in the main Sync repository under python-service/.
- Keep the standalone repository's application files synchronized with that directory.
- Keep this README identical in both repositories; update both copies whenever service behavior or configuration changes.
- Do not overwrite the standalone repository's server-side config.py, local environment files, or deployment-specific files when synchronizing.
- Do not force-push or replace the standalone repository's Git history to copy service files.

The standalone README is intentionally self-contained. Links to API and deployment details point to the main Sync repository so the documentation has one maintained reference for product-wide integration.

## Related resources

- [Main Sync repository](https://github.com/duttaanubhab777-code/sync)
- [Standalone Python service repository](https://github.com/arnabadhikari777/sync_python_media_upload)
- [Sync API reference](https://github.com/duttaanubhab777-code/sync/blob/main/docs/API.md)
- [PythonAnywhere deployment guide](https://github.com/duttaanubhab777-code/sync/blob/main/docs/PYTHONANYWHERE_DEPLOYMENT_GUIDE.md)
- [OTP and mail relay setup guide](https://github.com/duttaanubhab777-code/sync/blob/main/docs/OTP_AND_MAIL_RELAY_SETUP_GUIDE.md)

## License

See the LICENSE file in the main Sync repository for the project license.
