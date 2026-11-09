"""Sync Media Service - configuration TEMPLATE (safe to commit: it has no real secrets).

HOW TO USE
  1. Copy this file and name the copy  config.py   (in the same folder).
  2. Open config.py and fill in the values between the quotes.
  3. NEVER upload config.py to GitHub. It is already listed in .gitignore.

Names must stay exactly as written (UPPERCASE). Do not add spaces inside the quotes.
"""

# ---------------------------------------------------------------------------
# REQUIRED
# ---------------------------------------------------------------------------

# Must be EXACTLY the same text as JWT_SECRET in Render (Environment tab).
# Used only to check that a login token really came from the Sync backend.
JWT_SECRET = ""

# From your Cloudinary dashboard (Settings -> API Keys).
CLOUDINARY_CLOUD_NAME = ""
CLOUDINARY_API_KEY = ""
CLOUDINARY_API_SECRET = ""  # secret: lives ONLY here, never in Render or React

# Websites allowed to call this service from the browser.
# Comma-separated, no trailing slash, no "*".
# Production only:           "https://sync-5lfm.onrender.com"
# Production + local testing: "https://sync-5lfm.onrender.com,http://localhost:5173"
ALLOWED_ORIGINS = "https://sync-5lfm.onrender.com"

# ---------------------------------------------------------------------------
# OPTIONAL - the defaults are fine, leave these lines alone if unsure
# ---------------------------------------------------------------------------

# Max signature requests per user per minute.
# RATE_LIMIT_PER_MINUTE = 30

# Max wrong/expired-token attempts per IP address per minute before a temporary block.
# AUTH_FAILURE_LIMIT_PER_MINUTE = 20

# Allowed clock difference (seconds) between Render and PythonAnywhere when checking tokens.
# JWT_LEEWAY_SECONDS = 10

# Top-level Cloudinary folder. Sub-folders: chat, voice, avatars, stories, groups.
# MEDIA_FOLDER_ROOT = "sync"

# Ask Cloudinary itself to refuse unexpected file formats for avatars, group icons,
# stories and voice messages. Off by default because it has not been tested against
# a live Cloudinary account; see PHASE_1_2_IMPLEMENTATION_REPORT.md before enabling.
# ENFORCE_ALLOWED_FORMATS = False

# Header PythonAnywhere uses to tell us the visitor's IP address (for rate limiting).
# CLIENT_IP_HEADER = "X-Real-IP"
