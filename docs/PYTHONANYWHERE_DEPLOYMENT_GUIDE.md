# Deploy the Sync Python Service on PythonAnywhere

This guide covers deployment of the Flask microservice in the Sync repository. The Python service handles Cloudinary upload signing and signup OTP email delivery. The Node.js application remains hosted separately on Render.

> **Important:** Deploy only the contents of the repository's python-service directory. Do not upload the entire Sync monorepo to PythonAnywhere.

## Contents

- [1. Understand the deployment](#1-understand-the-deployment)
- [2. Prepare the service files](#2-prepare-the-service-files)
- [3. Create the PythonAnywhere web app](#3-create-the-pythonanywhere-web-app)
- [4. Configure the service](#4-configure-the-service)
- [5. Connect Render to PythonAnywhere](#5-connect-render-to-pythonanywhere)
- [6. Verify the deployment](#6-verify-the-deployment)
- [7. Troubleshooting](#7-troubleshooting)
- [8. Updating the service](#8-updating-the-service)
- [9. Deployment checklist](#9-deployment-checklist)

## 1. Understand the deployment

| Component | Hosting | Responsibility |
| --- | --- | --- |
| React frontend and Node.js backend | Render | User interface, authentication, messaging, API, Socket.IO, and MongoDB access. |
| Sync Python service | PythonAnywhere | Validates access tokens, signs Cloudinary upload requests, and sends signup OTP emails. |
| Cloudinary | Cloudinary | Stores uploaded images, videos, and audio files. |
| MongoDB Atlas | MongoDB Atlas | Stores application records and media URLs, not uploaded file bytes. |

### Media upload flow

1. The browser requests a signature from the Python service using its Node-issued access token.
2. The Python service validates the token and signs the Cloudinary upload parameters.
3. The browser uploads the file directly to Cloudinary.
4. The browser sends the resulting media URL and metadata to the Node backend.
5. The Node backend validates the Cloudinary URL and stores the metadata.

The Python service does not receive or store the uploaded file.

### Signup email flow

1. The Node backend creates a pending signup and generates an OTP.
2. Node calls the Python mail relay using the shared MAIL_RELAY_SECRET.
3. The Python service sends the email through Gmail SMTP.
4. The Node backend verifies the OTP and creates the account.

## 2. Prepare the service files

Create a deployment folder on PythonAnywhere, for example:

~~~text
/home/<YOUR_PYTHONANYWHERE_USERNAME>/sync-media-service
~~~

Upload the contents of the repository's python-service directory into this folder. The deployed directory should contain:

~~~text
sync-media-service/
├── app.py
├── settings.py
├── config.example.py
├── requirements.txt
├── verify_install.py
├── pythonanywhere_wsgi.py
├── routes/
├── services/
├── tests/
└── utils/
~~~

The exact contents should match the current python-service directory in GitHub. Do not upload a local virtual environment, cache folders, or a real config.py file.

### Protect configuration files

| File | Handling |
| --- | --- |
| config.example.py | Safe template; may be stored in GitHub. |
| config.py | Contains private credentials. Create it on PythonAnywhere and never commit or share it. |
| .venv, __pycache__, *.pyc | Do not upload. These are generated locally. |

Never put JWT_SECRET or CLOUDINARY_API_SECRET in React code, a VITE_* variable, screenshots, or public documentation.

## 3. Create the PythonAnywhere web app

### 3.1 Sign in and create a web app

1. Open [PythonAnywhere](https://www.pythonanywhere.com/) and sign in.
2. Open the **Web** tab.
3. Select **Add a new web app**.
4. Confirm the PythonAnywhere hostname shown for your account.
5. Select **Manual configuration** rather than the preconfigured Flask project option.
6. Choose a Python version supported by your account. Use the same Python version when creating the virtual environment.

PythonAnywhere may change its dashboard labels and available Python versions. Follow the options currently shown in your account.

### 3.2 Create the deployment directory

Open the **Files** tab and create:

~~~text
/home/<YOUR_PYTHONANYWHERE_USERNAME>/sync-media-service
~~~

Upload the files listed in Section 2 into this directory, preserving the routes, services, and utils subdirectories.

### 3.3 Create a virtual environment

Open the **Consoles** tab and start a Bash console. Check the Python versions available to your account:

~~~bash
ls /usr/bin/python3*
~~~

Choose a version supported by your PythonAnywhere web app. The example below uses Python 3.10; replace it if your selected version differs:

~~~bash
mkvirtualenv --python=/usr/bin/python3.10 sync-media-env
~~~

Install the service dependencies:

~~~bash
cd ~/sync-media-service
pip install -r requirements.txt
~~~

If you open a new Bash console later, activate the environment again:

~~~bash
workon sync-media-env
~~~

### 3.4 Configure the web app paths

In the PythonAnywhere **Web** tab, configure:

- **Source code:** /home/<YOUR_PYTHONANYWHERE_USERNAME>/sync-media-service
- **Working directory:** /home/<YOUR_PYTHONANYWHERE_USERNAME>/sync-media-service
- **Virtualenv:** /home/<YOUR_PYTHONANYWHERE_USERNAME>/.virtualenvs/sync-media-env

Use your actual PythonAnywhere username in each path.

### 3.5 Configure the WSGI file

In the Web tab, open the link next to **WSGI configuration file**. Replace the sample content with the following and change only the username:

~~~python
import sys

PROJECT_HOME = "/home/<YOUR_PYTHONANYWHERE_USERNAME>/sync-media-service"

if PROJECT_HOME not in sys.path:
    sys.path.insert(0, PROJECT_HOME)

from app import app as application
~~~

Save the file. Ensure that the path points to the directory containing app.py.

Enable **Force HTTPS** in the Web tab if the option is available, then reload the web app.

## 4. Configure the service

### 4.1 Create config.py

Open a Bash console and run:

~~~bash
cd ~/sync-media-service
cp config.example.py config.py
chmod 600 config.py
~~~

Open config.py from the PythonAnywhere Files tab and populate the required settings:

~~~python
JWT_SECRET = "<same value used by the Node backend>"

CLOUDINARY_CLOUD_NAME = "<Cloudinary cloud name>"
CLOUDINARY_API_KEY = "<Cloudinary API key>"
CLOUDINARY_API_SECRET = "<Cloudinary API secret>"

ALLOWED_ORIGINS = "https://sync-5lfm.onrender.com"

GMAIL_USER = "<dedicated Gmail sender address>"
GMAIL_APP_PASSWORD = "<Google App Password>"
MAIL_RELAY_SECRET = "<long random secret of at least 24 characters>"
~~~

Replace the placeholders with your actual values. Do not publish or commit this file.

### 4.2 Configuration reference

| Setting | Purpose | Where it must be configured |
| --- | --- | --- |
| JWT_SECRET | Verifies access tokens issued by Node. | Python config and Render; values must match exactly. |
| CLOUDINARY_CLOUD_NAME | Identifies the Cloudinary account. | Python config and the Node/Render environment; values must match. |
| CLOUDINARY_API_KEY | Cloudinary API key. | Python config only. |
| CLOUDINARY_API_SECRET | Signs Cloudinary upload parameters. | Python config only. Keep private. |
| ALLOWED_ORIGINS | Browser origins permitted to call the service. | Python config. |
| GMAIL_USER | Sender address for OTP emails. | Python config. |
| GMAIL_APP_PASSWORD | Google App Password used for SMTP authentication. | Python config. |
| MAIL_RELAY_SECRET | Authenticates Node-to-Python mail requests. | Python config and Render; values must match exactly. |

The service reads environment variables first and falls back to config.py. Do not change the setting names.

### 4.3 Create a Gmail App Password

1. Sign in to the dedicated Gmail account used by Sync.
2. Open [Google Account Security](https://myaccount.google.com/security).
3. Enable 2-Step Verification.
4. Open **App passwords** and create one for the mail relay.
5. Store the generated password securely and use it as GMAIL_APP_PASSWORD.

A regular Gmail password will not work. Google may change the availability or location of App Password settings.

### 4.4 Run the configuration check

From the PythonAnywhere Bash console:

~~~bash
cd ~/sync-media-service
workon sync-media-env
python verify_install.py
~~~

Resolve any reported problems. The check should not print secret values.

Return to the Web tab and reload the application after changing config.py or installing dependencies.

## 5. Connect Render to PythonAnywhere

Open the Render dashboard and select the Sync web service. Under **Environment**, add or verify:

| Variable | Value |
| --- | --- |
| PYTHON_SERVICE_URL | https://<YOUR_PYTHONANYWHERE_USERNAME>.pythonanywhere.com |
| JWT_SECRET | The same value used in Python config.py. |
| CLOUDINARY_CLOUD_NAME | The Cloudinary cloud name used by the Python service. |
| MAIL_RELAY_SECRET | The same value used in Python config.py. |

Do not add a trailing slash, /health, or another endpoint path to PYTHON_SERVICE_URL.

Save the environment changes and allow Render to redeploy.

### Variables that are not required

- VITE_PYTHON_SERVICE_URL is not required by the current integration.
- SERVICE_KEY is not used by the current Python media/mail service.
- CLOUDINARY_API_SECRET must not be placed in Render frontend variables or exposed to the browser.

## 6. Verify the deployment

### 6.1 Python service health

Open:

~~~text
https://<YOUR_PYTHONANYWHERE_USERNAME>.pythonanywhere.com/health
~~~

Confirm that the service reports a healthy status and that the media/mail configuration indicators are enabled. The endpoint must not expose credentials.

### 6.2 Node service health

Open:

~~~text
https://sync-5lfm.onrender.com/health
~~~

Confirm that the response reports the expected Python service URL, Cloudinary cloud name, and mail-relay configuration status.

### 6.3 Test the application

Sign in to Sync and perform normal user-facing checks:

1. Send an image in a conversation.
2. Send a short video if the Cloudinary account supports it.
3. Record and send a voice message.
4. Update a profile avatar.
5. Publish a story containing media.
6. Create or update a group icon.
7. Register a test account using an email address you control and verify that the OTP arrives.

Check the Cloudinary Media Library for the expected Sync folders. File-size and format limits are determined by both the application and the Cloudinary account.

Do not paste real access tokens, OTPs, App Passwords, or relay secrets into public issues or screenshots.

## 7. Troubleshooting

| Symptom | Likely cause | Action |
| --- | --- | --- |
| Python /health returns an error page | Incorrect WSGI path, missing dependency, or web-app configuration issue. | Review the PythonAnywhere Error log and confirm the source-code and virtualenv paths. |
| HTTP 401 from /media/sign | Missing, invalid, or expired access token; JWT secrets may not match. | Sign in again and verify that JWT_SECRET matches exactly in both services. |
| HTTP 403 or an origin error | The browser origin is not in ALLOWED_ORIGINS. | Add the exact HTTPS origin, save config.py, and reload the PythonAnywhere app. |
| HTTP 429 | A rate limit has been reached. | Wait before retrying and review the relevant service logs. |
| HTTP 503 from /media/sign | Required media configuration is incomplete. | Run python verify_install.py and correct the reported settings. |
| OTP email is not delivered | Gmail App Password, mail-relay secret, or Python service URL is incorrect. | Verify GMAIL_USER, GMAIL_APP_PASSWORD, MAIL_RELAY_SECRET, and PYTHON_SERVICE_URL. |
| Cloudinary reports an invalid signature | The Cloudinary cloud name, API key, or API secret does not belong to the same account. | Recheck the values in Python config.py and reload the service. |
| Cloudinary rejects the file | File type, file size, or account quota is outside the provider's limits. | Check the Cloudinary response and account limits. |
| Node rejects a Cloudinary URL | CLOUDINARY_CLOUD_NAME is missing or does not match the uploaded asset's account. | Correct the Node/Render environment value and redeploy. |

### Read PythonAnywhere logs

1. Open the **Web** tab.
2. Find the **Log files** section.
3. Open the **Error log** and inspect the latest entries.
4. Review the Server log if the application fails to start.

The service is designed to avoid logging secret values. Do not share unredacted logs if they contain personal or account information.

## 8. Updating the service

When Python service code changes:

1. Upload the updated files from the repository's python-service directory.
2. Preserve the existing config.py file.
3. If requirements.txt changed, activate the virtual environment and run pip install -r requirements.txt.
4. Reload the PythonAnywhere web app.

Do not overwrite or delete config.py when uploading an updated service package.

| Change | PythonAnywhere reload | Render redeploy |
| --- | --- | --- |
| Python service source code | Required | Not required |
| Python config.py values | Required | Not required, unless a matching Node environment value also changes |
| JWT_SECRET | Required | Required; keep both values identical |
| CLOUDINARY_CLOUD_NAME | Required | Required if the Node value changes |
| MAIL_RELAY_SECRET | Required | Required; keep both values identical |
| PYTHON_SERVICE_URL | Not required | Required |
| Node backend or frontend source | Not required | Required |

## 9. Deployment checklist

### PythonAnywhere

- [ ] The service files are uploaded to the correct directory.
- [ ] The virtual environment uses the same Python version selected for the web app.
- [ ] Dependencies are installed successfully.
- [ ] config.py exists and contains the required settings.
- [ ] config.py is not committed to GitHub.
- [ ] verify_install.py completes without configuration errors.
- [ ] The WSGI file imports app as application from the correct directory.
- [ ] The web app has been reloaded.
- [ ] The /health endpoint reports a healthy service.

### Render

- [ ] PYTHON_SERVICE_URL points to the PythonAnywhere base URL.
- [ ] JWT_SECRET matches the Python service value.
- [ ] CLOUDINARY_CLOUD_NAME matches the Cloudinary account.
- [ ] MAIL_RELAY_SECRET matches the Python service value.
- [ ] The latest deployment is healthy.

### Functional checks

- [ ] Image upload works.
- [ ] Video upload works where supported by the Cloudinary account.
- [ ] Voice-message upload works.
- [ ] Avatar and story uploads work.
- [ ] Signup OTP email delivery and verification work.

### Security

- [ ] CLOUDINARY_API_SECRET exists only in the private Python service configuration.
- [ ] GMAIL_APP_PASSWORD and MAIL_RELAY_SECRET are never exposed in frontend code.
- [ ] No private config file or real credential is committed to GitHub.
- [ ] Public screenshots and logs contain no tokens, OTPs, or secrets.

---

For endpoint details, see the [API reference](API.md) and the [Python service README](../python-service/README.md).
