# Phase 1 & 2 Implementation Report — Python Media Service + Cloudinary Integration

Scope: only Phase 1 (Flask media service) and Phase 2 (Cloudinary signed uploads). No notification, PWA, chat, UI or other features were touched.

---

## 1. Audit findings (from the actual source, not the docs)

| Area | What the code really does | Consequence for the design |
| --- | --- | --- |
| `frontend/src/services/media.js` | `POST {pythonUrl}/media/sign` with body `{}` and `Authorization: Bearer <access token>`. Reads `signRes.data?.data \|\| signRes.data` → `cloudName, apiKey, timestamp, folder, signature`. Uploads to `https://api.cloudinary.com/v1_1/<cloud>/auto/upload` sending only `file, api_key, timestamp, folder, signature`. 25 MB client limit. On HTTP **401** it refreshes the token once and retries. | Response keeps exactly those fields. Auth failures **must be 401** (a 403 would break the refresh-and-retry path). Only `folder` and `timestamp` are signed, because only those are sent. |
| `frontend/src/services/api.js`, `store/authSlice.js` | Python URL comes from `VITE_PYTHON_SERVICE_URL` or, at runtime, from the Node `/health` response (`pythonServiceUrl`), cached in `localStorage`. | `VITE_PYTHON_SERVICE_URL` is **not needed**. Only Render's `PYTHON_SERVICE_URL` is. |
| `node-backend/src/utils/token.js`, `models/user.model.js` | Access token: HS256 (jsonwebtoken default), secret `JWT_SECRET` (fallback `ACCESS_TOKEN_SECRET`), payload `id`, `_id`, `email`, `username`, `fullName`, `iat`, `exp` (default 15 m on Render), **no `tokenType`**. Refresh token: separate secret `REFRESH_TOKEN_SECRET`, `tokenType: "refresh"`. | Python verifies HS256 + `exp`, refuses any token carrying `tokenType` other than "access", requires a 24-hex user id. |
| `node-backend/src/app.js` | `/health` returns `pythonServiceUrl` and `cloudinaryCloudName`; CSP `connect-src` opens `PYTHON_SERVICE_URL`'s origin and `https://api.cloudinary.com`; `img-src`/`media-src` allow `res.cloudinary.com`. | Setting `PYTHON_SERVICE_URL` on Render (and a redeploy) is what lets the browser reach PythonAnywhere. |
| `node-backend/src/utils/cloudinary.js` | `isValidCloudinaryUrl` required `https`, host `res.cloudinary.com`, path prefix `/<cloud>/`, but **accepted any cloud when `CLOUDINARY_CLOUD_NAME` was unset** and accepted `/image/fetch/...`-style paths. Used for messages (socket), stories, avatar, group icon. | Hardened (see §3). |
| `SERVICE_KEY` | Appears only in `render.yaml`, `.env.example` and README. **Never read by any code.** | Not required. Removed from `render.yaml`/`.env.example` so the owner is not asked for it. |
| Upload call sites | Profile avatar, group icon (create + edit), story image/video, chat attachment (`<input type=file>` with **no `accept`**, so any file → message type `file`), voice (`MediaRecorder`, `audio/webm`). | Folder scheme per purpose; chat attachments must stay unrestricted. |
| `python-service/*` | `app.py`, `config.example.py`, `requirements.txt` were empty (0 bytes). Folders held only `.gitkeep` and an unused `public/temp/`. | Built from scratch; `public/temp/` and the `.gitkeep` files removed. |
| README / API.md | Describe the Python service as a plan; README sketch used `CLOUD_NAME/API_KEY/API_SECRET/FRONTEND_URL/SERVICE_KEY` and folder `sync/chat`. | Docs updated to the real names; `sync/chat` kept as the default folder. |

---

## 2. Phase 1 — Python Media Service (`python-service/`)

```
app.py                    app factory, CORS, security headers, JSON error handlers; module-level `app` for WSGI; app.run only under __main__
settings.py               env + config.py loading, validation, secrets excluded from repr/logs, never raises on missing config
config.example.py         template (no secrets); copy to config.py (git-ignored)
requirements.txt          Flask, PyJWT, cloudinary (all pure Python, no Redis/Celery/Gunicorn)
pythonanywhere_wsgi.py    contents to paste into PythonAnywhere's WSGI file
verify_install.py         beginner self-check (prints OK/PROBLEM, no secrets, no network)
routes/health.py          GET /health
routes/media.py           POST /media/sign
services/cloudinary_service.py   folder mapping + signing through cloudinary.utils.api_sign_request
utils/jwt_utils.py        Bearer parsing, HS256 verification, claim checks
utils/security.py         origin normalisation, client-IP lookup, in-memory sliding-window rate limiter
utils/responses.py        JSON shape identical to Node's ApiResponse/ApiError
tests/                    69 unittest tests
.gitignore, README.md
```

### Endpoints
* `GET /health` — no auth; `{ok, status, service, version, timestamp, configured}`. `configured` is a yes/no only; no secrets or config values.
* `POST /media/sign` — checks, in order: browser `Origin` allow-list (403) → configuration complete (503) → IP failed-attempt block (429) → Bearer HS256 token (401) → per-user rate limit (429) → body validation (400/413) → local signature (200). Response `data`: `cloudName, apiKey, timestamp, folder, signature` plus informational `purpose` (and `allowedFormats` only when that option is on). `Cache-Control: no-store`.

### JWT
HS256 only (`alg: none` and other algorithms rejected), `exp` required, 10 s clock-skew leeway (configurable 0–60), `tokenType` present and ≠ "access" rejected, `id`/`_id` must be a 24-hex string and equal if both present. All failures are **401** with a `message` field (what the frontend displays).

### CORS
Explicit allow-list from `ALLOWED_ORIGINS` (default `https://sync-5lfm.onrender.com`). Wildcards, paths and plain `http` for non-localhost are rejected at load time. Preflight answered with `Authorization, Content-Type`; no credentials header. Local dev origin only if listed. A browser request from any other origin gets 403 and no CORS headers.

### Other security
Strict body validation (empty body or `{}` or `{"purpose": <known>}`; unknown keys → 400; 8 KB body cap → 413); client cannot choose the folder; rate limits (per user, plus per-IP for failed auth, in memory, thread-safe, bounded); fail-closed 503 when config is missing/invalid; `DEBUG` forced off; JSON errors without stack traces; secrets never logged (`Settings` repr hides them, config problems list names only, a broken `config.py` logs only the exception type).

### PythonAnywhere free-plan fit
Plain WSGI Flask; no background process, Celery, Redis, WebSockets or Gunicorn; no `app.run` on import; no disk writes; no outgoing network calls (signing is local).

---

## 3. Phase 2 — Cloudinary integration

* Signing uses the official SDK: `cloudinary.utils.api_sign_request(params, api_secret)`, imported lazily so the app (and `/health`) still start if the package is missing (then `/media/sign` → 503 and the Error log says why).
* The browser still uploads straight to Cloudinary; the API secret exists only in PythonAnywhere's `config.py`.
* Folder structure (default `sync/chat` matches the README): `sync/chat`, `sync/voice`, `sync/avatars`, `sync/stories`, `sync/groups`. Root configurable via `MEDIA_FOLDER_ROOT`.
* Existing 25 MB frontend limit preserved. Cloudinary account limits may be lower; see §6.
* Optional `ENFORCE_ALLOWED_FORMATS` (default **off**): signs an `allowed_formats` list for avatar/group/story/voice so Cloudinary itself rejects other formats; chat attachments are intentionally unrestricted because the app allows any file there. **Not validated against a live Cloudinary account** (e.g. which `format` value Cloudinary reports for iOS `audio/mp4` voice notes), hence off by default.

### Changes to existing code (all minimal, all documented)

| File | Change | Why |
| --- | --- | --- |
| `node-backend/src/utils/cloudinary.js` | `isValidCloudinaryUrl` now: rejects URLs with credentials/ports; requires `/<cloud>/(image\|video\|raw)/upload/`; **in production, rejects everything if `CLOUDINARY_CLOUD_NAME` is unset** (was: accept any cloud). Local dev without the variable still accepts `…/upload/…` URLs. | Closes the "any Cloudinary account / `fetch` URL" gap. **Owner impact:** `CLOUDINARY_CLOUD_NAME` must be set on Render (it already is declared in `render.yaml`). |
| `node-backend/test/cloudinary-url.test.js` | New, 5 tests (`node --test`). | Verifies the above. |
| `frontend/src/services/media.js` | Optional 3rd argument `{purpose}` sent as `/media/sign` body; appends `allowed_formats` if the server returned it; surfaces Cloudinary's own error message instead of "Request failed with status code 400". Default behaviour unchanged. | Folders per media type; diagnosability. |
| `frontend/src/pages/ProfilePage.jsx`, `components/Modals.jsx` (×2), `pages/StoriesPage.jsx`, `pages/ChatPage.jsx` (voice only) | Pass `purpose` (`avatar`, `group`, `story`, `voice`). | Folder per type. Chat attachments use the default `chat`. |
| `render.yaml`, `node-backend/.env.example` | Removed unused `SERVICE_KEY`; corrected comment. | Owner must not configure unused secrets. |
| `README.md`, `API.md` | Python env/deploy sections and `/media/sign` contract corrected. | Docs matched to real code. |

Not changed: message/profile/story logic, auth, sockets, PWA, UI, database models.

---

## 4. Test results

Environment limits: the sandbox has **no internet**, so `pip install cloudinary`/`pytest` and `npm install` were impossible.

### ✅ Passed (executed here)

| Test | Result |
| --- | --- |
| Python unit tests (`python -m unittest discover -s . -t . -p "test_*.py"` in `python-service/`) | **69/69 passed** |
| — app import without config, no server started on import (subprocess import) | passed |
| — `/health` (no auth, no secret leakage, works when unconfigured) | passed |
| — JWT: valid; missing/garbage/wrong scheme; wrong secret; expired (401 + "expired"); small skew tolerated; **refresh token rejected** (right secret and refresh secret); `alg=none`; HS512; no `exp`; bad/mismatched user id; never 403 for auth | passed |
| — token hand-built with **Node's `crypto`** in Node's token shape verifies; Node-built refresh-style token rejected | passed |
| — signature equals independent SHA-1 reference for every purpose, with/without `allowed_formats` | passed (see caveat below) |
| — invalid/missing configuration → 503 (each required value, bad key/name/secret formats), SDK failure/missing package → 503 without details | passed |
| — CORS: allowed preflight, refused origin (preflight and actual), look-alike origins, localhost only when configured, wildcard/http configs ignored, default origin, no wildcard header, no credentials header | passed |
| — rate limiting per user / per IP failures / successes not counted | passed |
| — input validation (unknown purpose/fields, non-object, invalid JSON, oversize 413) | passed |
| — `pythonanywhere_wsgi.py` exposes a working `application` (placeholder path substituted) | passed |
| Mutation check: breaking the refresh-token rule and the CORS origin echo made tests fail, restoring made them pass | done |
| Live local HTTP run (werkzeug server): `/health`, preflight, valid sign (fields match media.js), expired/refresh/no-token → 401, foreign origin → 403 | passed |
| Node `node --test` (`isValidCloudinaryUrl`, `pickMedia`) | **5/5 passed** |
| `node --check` on **all** `node-backend/src/**/*.js` | passed |
| Syntax parse of changed frontend files (`media.js`, `ProfilePage`, `StoriesPage`, `ChatPage`, `Modals`) via esbuild | passed |
| Python files parse with Python 3.9 grammar (PythonAnywhere runs 3.9–3.13) | passed |
| `verify_install.py` with missing and with complete configuration | behaves as designed |

### ⚠️ Passed with a caveat — real Cloudinary SDK
The real `cloudinary` package could not be installed here. The signing tests ran against a **stand-in that implements Cloudinary's documented algorithm** (sorted `k=v` joined by `&`, + secret, SHA-1). They prove our parameters, folder and wiring are right, **not** that the real SDK returns the same string. The tests detect and use the real SDK automatically when present, and `python verify_install.py` (run on PythonAnywhere after `pip install`) performs this exact comparison against the real SDK.

### ❌ Not run / could not run
| Item | Why |
| --- | --- |
| `npm --prefix frontend run build` (Vite production build) | no network → `node_modules` cannot be installed (`npm ci --offline` fails: not cached). Only syntax parsing was possible. **Run the build on Render/your PC.** |
| Node backend start / auth flow / sockets | needs MongoDB and installed packages |

### 🔑 Requires live credentials / services (not tested)
Real Cloudinary signature acceptance, real uploads of image/video/audio, profile picture, chat media, story media, group icon; Cloudinary account size limits; `ENFORCE_ALLOWED_FORMATS=true` behaviour; Render environment wiring and CSP; real browser CORS between Render and PythonAnywhere.

### 🌐 Requires the PythonAnywhere deployment (not tested)
WSGI configuration on PythonAnywhere, virtualenv/Python version, `pip install` there, the real `X-Real-IP` header behaviour behind PythonAnywhere's proxy, free-plan expiry button.

No deployment or upload result is claimed anywhere in this project.

---

## 5. Known limitations / honest notes

1. **File size cannot be enforced by a signed upload.** Cloudinary enforces size only through account limits or upload presets. The 25 MB check stays in the frontend (bypassable); Cloudinary plan limits are the real cap. File *type* is enforced only if `ENFORCE_ALLOWED_FORMATS` is on.
2. **Blocked users:** the Python service cannot query MongoDB, so a blocked user whose access token is still valid (≤15 min) can still obtain a signature. Node still refuses to attach/store anything for blocked users on its own endpoints.
3. **Rate limiting is per process, in memory.** Fine for one PythonAnywhere worker; it resets on Reload. The per-IP failure limit relies on `X-Real-IP` (configurable via `CLIENT_IP_HEADER`) — PythonAnywhere's proxy header behaviour was assumed from its documentation, not verified; if the header is absent it falls back to the socket address.
4. Cloudinary free-plan per-file limits (images are commonly lower than 25 MB) were **not verified** against the owner's account.
5. `JWT_SECRET` only: the Node fallback name `ACCESS_TOKEN_SECRET` is not read by Python (the brief requires `JWT_SECRET`). If Render uses `ACCESS_TOKEN_SECRET` instead, copy its value into `JWT_SECRET` in `config.py`.
6. Free PythonAnywhere web apps need periodic manual extension; covered in the guide.

---

## 6. Owner checklist (details in `PYTHONANYWHERE_DEPLOYMENT_GUIDE.md`, Bengali)

1. Upload `sync-media-service-upload.zip` to PythonAnywhere, unzip, create virtualenv, `pip install -r requirements.txt`.
2. Copy `config.example.py` → `config.py`, fill `JWT_SECRET` (same as Render), Cloudinary cloud name/key/secret, `ALLOWED_ORIGINS`.
3. Web tab: manual config, virtualenv path, WSGI file, Force HTTPS, Reload; open `/health`.
4. Push the updated project to GitHub; on Render set `PYTHON_SERVICE_URL=https://<user>.pythonanywhere.com` and make sure `JWT_SECRET` and `CLOUDINARY_CLOUD_NAME` are set. No `SERVICE_KEY`, no `VITE_PYTHON_SERVICE_URL`.
5. Test as in the guide, Part F.
