"""PythonAnywhere WSGI file for the Sync Media Service.

This file is NOT run from the python-service folder. You copy its contents
into PythonAnywhere's WSGI configuration file (Web tab -> "WSGI configuration
file" link), replacing everything that was there. See PYTHONANYWHERE_DEPLOYMENT_GUIDE.md.

Change ONLY the username in PROJECT_HOME below.
"""
import sys

# Folder on PythonAnywhere that contains app.py (and config.py).
PROJECT_HOME = "/home/<YOUR_PYTHONANYWHERE_USERNAME>/sync-media-service"

if PROJECT_HOME not in sys.path:
    sys.path.insert(0, PROJECT_HOME)

# PythonAnywhere looks for a variable named "application".
from app import app as application  # noqa: E402
