# Sync Media & Mail Relay Service (Flask)

> বাংলা নির্দেশনা: প্রজেক্ট রুটের `OTP_AND_MAIL_RELAY_SETUP_GUIDE.md` এবং `docs/PYTHONANYWHERE_DEPLOYMENT_GUIDE.md` দেখো।

A lightweight Flask service designed for the PythonAnywhere free plan. It handles two jobs:
1. **`POST /media/sign`** — Creates Cloudinary signed-upload signatures locally (never receives or stores media files).
2. **`POST /mail/send` & `GET /mail/diag`** — Sends signup OTP verification emails via Gmail SMTP (`smtp.gmail.com`), because Render's free tier blocks outbound SMTP ports.

```
[Media Upload]
Browser --(Bearer access token)--> POST /media/sign  (PythonAnywhere) --> {cloudName, apiKey, timestamp, folder, signature}
Browser --(file + signature)-----> Cloudinary                         --> secure_url
Browser --(url + metadata)-------> Node.js backend (Render)           --> MongoDB

[Signup OTP Email Relay]
Browser --(signup form)----------> POST /api/auth/register/send-otp (Render Node.js)
Node.js --(X-Relay-Key header)---> POST /mail/send (PythonAnywhere)   --> Gmail SMTP (465/587) --> User Inbox
Browser --(6-digit OTP)----------> POST /api/auth/register/verify-otp --> Account Created + JWT Issued
```

## Endpoints

| Method | Path          | Auth                     | Purpose |
| ------ | ------------- | ------------------------ | ------- |
| GET    | `/health`     | none                     | `{status, service, version, timestamp, configured, mailConfigured}`. No secrets. |
| POST   | `/media/sign` | `Bearer <accessToken>`   | Returns Cloudinary signed upload parameters. |
| POST   | `/mail/send`  | `X-Relay-Key: <secret>`  | Server-to-server email relay for signup OTP codes. Rejects browser `Origin` headers. |
| GET    | `/mail/diag`  | `X-Relay-Key` or `?key=` | Owner self-test for Gmail SMTP ports (`465`/`587`) and optional `&to=you@gmail.com` test email. |

`POST /media/sign` body: `{}` or `{"purpose": "chat|voice|avatar|story|group|notice"}`. Default purpose is `chat`.

## Configuration (`config.py`)

Copy `config.example.py` to `config.py` and fill in your values (never commit `config.py`):

- **Media Signing**:
  - `JWT_SECRET` — Must match `JWT_SECRET` on Render exactly.
  - `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
  - `ALLOWED_ORIGINS` — e.g. `"https://sync-5lfm.onrender.com"`
- **Signup OTP Mail Relay**:
  - `GMAIL_USER` — Your Gmail address (e.g. `"sync93346@gmail.com"`)
  - `GMAIL_APP_PASSWORD` — 16-character Google App Password (from Google Account → Security → 2-Step Verification → App passwords)
  - `MAIL_RELAY_SECRET` — Random secret string (24+ characters); must match `MAIL_RELAY_SECRET` on Render exactly.

## Self-Check & Diagnostics

```bash
python verify_install.py
```

After reloading your PythonAnywhere Web App, verify in your browser:
- `https://<YOUR_USERNAME>.pythonanywhere.com/health` → `"configured": true, "mailConfigured": true`
- `https://<YOUR_USERNAME>.pythonanywhere.com/mail/diag?key=<MAIL_RELAY_SECRET>&to=<YOUR_EMAIL>` → sends a test email and reports port `465`/`587` status.
