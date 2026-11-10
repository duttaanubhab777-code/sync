"""Quick self-check for the Sync Media + Mail Service. Run it in a PythonAnywhere Bash console:

    cd ~/sync-media-service
    workon sync-media-env        # (only if the virtualenv is not already active)
    python verify_install.py

It prints OK / PROBLEM lines. It never prints secret values and never contacts the internet.
(To really test Gmail login, open the /mail/diag URL described in config.example.py after reloading the web app.)
"""
import hashlib
import sys

problems = 0


def ok(text):
    print("OK       " + text)


def bad(text):
    global problems
    problems += 1
    print("PROBLEM  " + text)


print("Python " + sys.version.split()[0])

for module in ("flask", "jwt", "cloudinary"):
    try:
        __import__(module)
        ok("package '%s' is installed" % module)
    except ImportError:
        bad("package '%s' is NOT installed -> run: pip install -r requirements.txt" % module)

try:
    from settings import load_settings
except Exception as exc:  # noqa: BLE001
    bad("cannot import settings.py (%s). Are you inside the sync-media-service folder?" % type(exc).__name__)
    sys.exit(1)

settings = load_settings()
if settings.is_configured:
    ok("configuration is complete (cloud name: %s)" % settings.cloud_name)
else:
    for item in settings.problems:
        bad("config: " + item + "  -> edit config.py")
for item in settings.warnings:
    print("WARNING  " + item)
ok("allowed origins: " + (", ".join(settings.allowed_origins) or "NONE (browsers will be blocked)"))

# --- mail relay (needed for the signup OTP emails) ---
if settings.mail_configured:
    ok("mail relay configuration is complete (sender: %s)" % settings.gmail_user)
else:
    for item in settings.mail_problems:
        bad("mail relay: " + item + "  -> edit config.py (see config.example.py)")

try:
    from cloudinary import utils as cloudinary_utils

    params = {"folder": "sync/chat", "timestamp": 1700000000}
    sdk_value = cloudinary_utils.api_sign_request(params, "test-secret")
    expected = hashlib.sha1(b"folder=sync/chat&timestamp=1700000000test-secret").hexdigest()
    if sdk_value == expected:
        ok("Cloudinary SDK signing works locally and matches the documented algorithm")
    else:
        bad("Cloudinary SDK produced an unexpected signature (SDK version issue?)")
except ImportError:
    pass  # already reported above
except Exception as exc:  # noqa: BLE001
    bad("Cloudinary SDK signing failed (%s)" % type(exc).__name__)

try:
    import app  # noqa: F401

    ok("app.py imports correctly (this is what PythonAnywhere loads)")
except Exception as exc:  # noqa: BLE001
    bad("app.py failed to import (%s)" % type(exc).__name__)

print("")
print("RESULT: everything looks good" if problems == 0 else "RESULT: %d problem(s) found, fix them and run again" % problems)
sys.exit(0 if problems == 0 else 1)
