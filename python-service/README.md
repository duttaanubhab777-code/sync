# Sync Media Service (Flask)

> বাংলা নির্দেশনা: প্রজেক্ট রুটের `PYTHONANYWHERE_DEPLOYMENT_GUIDE.md` দেখো।

A tiny Flask service for PythonAnywhere (free plan). It **only creates Cloudinary signed-upload
signatures**. It never receives, stores or forwards media files and makes no outgoing requests.

```
Browser --(Bearer access token)--> POST /media/sign  (this service) --> {cloudName, apiKey, timestamp, folder, signature}
Browser --(file + signature)-----> Cloudinary                        --> secure_url
Browser --(url + metadata)-------> Node.js backend (Render)          --> MongoDB
```

## Endpoints

| Method | Path          | Auth          | Purpose |
| ------ | ------------- | ------------- | ------- |
| GET    | `/health`     | none          | `{status, service, version, timestamp, configured}`. No secrets. |
| POST   | `/media/sign` | Bearer access token | Returns the signed upload parameters. |

`POST /media/sign` body: `{}` (what the current frontend sends) or `{"purpose": "chat|voice|avatar|story|group"}`.
Default purpose is `chat`.

| purpose | Cloudinary folder |
| ------- | ----------------- |
| chat (default) | `sync/chat` |
| voice  | `sync/voice` |
| avatar | `sync/avatars` |
| story  | `sync/stories` |
| group  | `sync/groups` |

Status codes: `200` ok, `400` bad body/purpose, `401` missing/invalid/expired/refresh token
(the frontend refreshes its token on 401 and retries once), `403` origin not allowed, `413` body too big,
`429` rate limited, `503` service not configured / SDK unavailable.

## Security summary

* JWT: HS256 only, same `JWT_SECRET` as the Node backend, `exp` required, small clock-skew leeway (10 s),
  refresh tokens (`tokenType: "refresh"`) refused, user id must be a 24-hex Mongo id.
* CORS: explicit allow-list (`ALLOWED_ORIGINS`), never `*`; plain `http` only for localhost; unknown browser origins get 403.
* Rate limits (in memory, fine for one PythonAnywhere worker): per user (`RATE_LIMIT_PER_MINUTE`) and per IP for failed auth.
* Fails closed: missing/invalid configuration -> `/media/sign` answers 503; `/health` still works and reports `configured: false`.
* No debug mode, no stack traces in responses, secrets are never logged or returned.
* What it cannot enforce: file *size* (Cloudinary signed uploads cannot cap size; the frontend limit is 25 MB and the
  Cloudinary account/plan limits apply) and, unless `ENFORCE_ALLOWED_FORMATS` is on, file *type*.

## Configuration

Copy `config.example.py` to `config.py` and fill it in (never commit `config.py`). Environment variables with the
same names override `config.py`. Required: `JWT_SECRET`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`,
`CLOUDINARY_API_SECRET`. Recommended: `ALLOWED_ORIGINS`. Optional values are documented inside `config.example.py`.

## Local development

```bash
python -m venv venv && source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp config.example.py config.py                       # fill in values
python verify_install.py                             # self-check
python app.py                                        # http://127.0.0.1:5001/health
python -m unittest discover -s . -t . -p "test_*.py" # run tests (pytest also works)
```

To allow the Vite dev server, set `ALLOWED_ORIGINS = "https://sync-5lfm.onrender.com,http://localhost:5173"`.

## Layout

```
app.py                 Flask app factory + WSGI `app` object (no app.run on import)
settings.py            config loading/validation (no secrets in logs)
config.example.py      template; copy to config.py
pythonanywhere_wsgi.py contents to paste into PythonAnywhere's WSGI file
verify_install.py      beginner-friendly self-check
routes/                health.py, media.py
services/              cloudinary_service.py (signing via the official SDK)
utils/                 jwt_utils.py, security.py, responses.py
tests/                 unittest suite
```
