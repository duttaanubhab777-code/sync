# Sync Media and Mail Relay Service

The Sync Python service is a lightweight Flask microservice designed to run independently from the Node.js application. It provides two server-side capabilities:

1. **Cloudinary upload signing** — POST /api/v1/media/sign validates a Node-issued access token and creates a short-lived Cloudinary upload signature. The browser uploads media directly to Cloudinary; this service never receives or stores the media file.
2. **Signup OTP email delivery** — POST /api/v1/mail/send accepts authenticated server-to-server requests from the Node backend and sends verification emails through Gmail SMTP.

The service is designed for the PythonAnywhere deployment used by Sync.

## Architecture

### Media upload

~~~text
Browser -- Bearer access token --> PythonAnywhere /api/v1/media/sign
Browser <-- signed parameters ---- PythonAnywhere
Browser -- file + signature -----> Cloudinary
Browser -- media URL + metadata -> Node.js backend -> MongoDB
~~~

### Signup email

~~~text
Browser -> Node.js /api/v1/auth/register/send-otp
Node.js -> PythonAnywhere /api/v1/mail/send (X-Relay-Key)
PythonAnywhere -> Gmail SMTP -> User inbox
Browser -> Node.js /api/v1/auth/register/verify-otp
~~~

## API endpoints

| Method | Path | Authentication | Purpose |
| --- | --- | --- | --- |
| GET | /api/v1/health | None | Returns service/version status and non-secret configuration indicators. |
| POST | /api/v1/media/sign | Authorization: Bearer <accessToken> | Returns signed Cloudinary upload parameters. |
| POST | /api/v1/mail/send | X-Relay-Key: <secret> | Sends a signup OTP email on behalf of the Node backend. Requests with a browser Origin header are rejected. |
| GET | /api/v1/mail/diag | X-Relay-Key or supported key query parameter | Owner diagnostic for SMTP connectivity; can optionally send a test message. |

### Media-signing request

The request body may be empty or include one of the supported upload purposes:

~~~json
{
  "purpose": "chat"
}
~~~

Supported values: chat, voice, avatar, story, group, and notice. If omitted, the service uses chat.

The signing response includes the Cloudinary cloud name, API key, timestamp, folder, signature, and purpose. It must never expose CLOUDINARY_API_SECRET or JWT_SECRET.

## Configuration

The service loads configuration from environment variables first, then from a local config.py file in this directory. Environment variables take precedence.

Create the local configuration from the safe template:

~~~bash
cp config.example.py config.py
~~~

Populate the required settings:

### Media signing

- JWT_SECRET — Must exactly match the Node backend's JWT_SECRET.
- CLOUDINARY_CLOUD_NAME
- CLOUDINARY_API_KEY
- CLOUDINARY_API_SECRET — Private; keep it only in the Python service environment/configuration.
- ALLOWED_ORIGINS — Comma-separated list of approved browser origins. Do not use *.

### Signup OTP mail relay

- GMAIL_USER — Dedicated Gmail sender address.
- GMAIL_APP_PASSWORD — Google App Password, not the normal Gmail password.
- MAIL_RELAY_SECRET — Random secret of at least 24 characters. It must match the Node backend's value exactly.

Optional settings, including SMTP mode and rate limits, are documented in config.example.py.

> [!WARNING]
> Never commit config.py, real credentials, App Passwords, or relay secrets. The real configuration file is excluded by .gitignore. Do not place private values in frontend code or VITE_* variables.

## Local development

Requirements: Python 3.10 or later and pip.

From the repository root:

~~~bash
cd python-service
python -m venv .venv
~~~

Activate the virtual environment:

~~~bash
# Windows
.venv\Scripts\activate

# macOS / Linux
source .venv/bin/activate
~~~

Install dependencies:

~~~bash
pip install -r requirements.txt
~~~

Create and populate config.py, then start the Flask development process:

~~~bash
python app.py
~~~

The local service listens on http://127.0.0.1:5001 by default. Configure the Node backend's PYTHON_SERVICE_URL and add the local frontend origin to ALLOWED_ORIGINS when testing browser uploads.

## Self-check and diagnostics

Run the configuration/dependency check:

~~~bash
python verify_install.py
~~~

After deployment and a PythonAnywhere web-app reload, verify:

~~~text
https://<YOUR_PYTHONANYWHERE_USERNAME>.pythonanywhere.com/api/v1/health
~~~

Use the owner-only /api/v1/mail/diag endpoint to investigate SMTP connectivity. Protect the relay key as a password; avoid posting diagnostic URLs containing the key in public logs, screenshots, or issue reports.

## Deployment and API documentation

- [PythonAnywhere deployment guide](../docs/PYTHONANYWHERE_DEPLOYMENT_GUIDE.md)
- [Signup OTP and mail relay setup](../docs/OTP_AND_MAIL_RELAY_SETUP_GUIDE.md)
- [Sync API reference](../docs/API.md)
