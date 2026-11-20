# Sync Signup OTP and Mail Relay Setup

This guide explains how Sync verifies new accounts by email and how the PythonAnywhere Flask service delivers signup verification codes on behalf of the Node.js backend.

## 1. Architecture and request flow

Render hosts the Node.js application. The Node backend creates and verifies signup OTPs, while the PythonAnywhere service sends the email through Gmail SMTP.

~~~text
Browser
  |
  | POST /api/v1/auth/register/send-otp
  v
Node.js backend (Render)
  |  - validates registration details
  |  - stores a temporary pending signup
  |  - protects the OTP and password data
  |
  | POST /api/v1/mail/send + X-Relay-Key
  v
PythonAnywhere Flask mail relay
  |  - validates the shared relay secret
  |  - sends the OTP through Gmail SMTP
  v
User's email inbox

Browser
  | POST /api/v1/auth/register/verify-otp
  v
Node.js backend
  |  - verifies the OTP and expiry
  |  - creates the account after successful verification
  v
Authenticated Sync session
~~~

The OTP is generated and verified by the Node backend. The Python service is only a protected delivery relay; it does not create user accounts or verify OTPs.

## 2. Signup flow behavior

1. The user submits the required account details.
2. The backend validates the details and sends a six-digit verification code.
3. The user enters the code before it expires.
4. The backend verifies the code and creates the account.
5. The user receives an authenticated session after successful verification.

The frontend supports separate OTP input fields, paste handling, a resend cooldown, an expiry countdown, and the ability to return to the registration details.

The backend enforces resend and verification-attempt limits. A client-side timer is only a usability feature; server-side limits remain authoritative.

## 3. Gmail sender requirements

Use a dedicated Gmail account for automated signup email.

1. Sign in to the Google Account that will send Sync verification emails.
2. Open [Google Account Security](https://myaccount.google.com/security).
3. Enable 2-Step Verification if it is not already enabled.
4. Open **App passwords** from the Google Account security settings.
5. Create an app password for the Sync mail relay.
6. Store the generated app password securely. Do not commit it to GitHub or share it in screenshots.

A normal Gmail account password is not supported. Google may change the availability or location of App Password settings.

## 4. Configure the PythonAnywhere service

Deploy the Flask service by following the [PythonAnywhere deployment guide](PYTHONANYWHERE_DEPLOYMENT_GUIDE.md). After the service files and dependencies are in place, create a private config.py beside app.py.

Copy the template:

~~~bash
cd ~/sync-media-service
cp config.example.py config.py
chmod 600 config.py
~~~

Set the following values in config.py:

~~~python
# Media signing
JWT_SECRET = "<same value used by the Node backend>"
CLOUDINARY_CLOUD_NAME = "<Cloudinary cloud name>"
CLOUDINARY_API_KEY = "<Cloudinary API key>"
CLOUDINARY_API_SECRET = "<Cloudinary API secret>"
ALLOWED_ORIGINS = "https://sync-5lfm.onrender.com"

# Signup OTP mail relay
GMAIL_USER = "<dedicated Gmail sender address>"
GMAIL_APP_PASSWORD = "<Google App Password>"
MAIL_RELAY_SECRET = "<long random secret of at least 24 characters>"
~~~

Replace every placeholder with the actual value. Do not copy the placeholders literally.

### Configuration rules

| Setting | Requirement |
| --- | --- |
| JWT_SECRET | Must exactly match the Node backend's JWT_SECRET. |
| CLOUDINARY_CLOUD_NAME | Must identify the Cloudinary account used by Sync. |
| CLOUDINARY_API_KEY | Cloudinary API key for the same account. |
| CLOUDINARY_API_SECRET | Private Cloudinary secret. Keep it only in the Python service configuration. |
| ALLOWED_ORIGINS | Comma-separated list of approved browser origins. Do not use a wildcard. |
| GMAIL_USER | Dedicated Gmail sender address. |
| GMAIL_APP_PASSWORD | Google App Password, not the normal account password. |
| MAIL_RELAY_SECRET | Long random shared secret; it must match the Node backend value exactly. |

The service also supports environment variables. When both an environment variable and a value in config.py are present, the environment variable takes precedence.

Never commit config.py. The file is excluded by the Python service's .gitignore.

## 5. Configure the Node backend on Render

In the Render dashboard, open the Sync web service and select **Environment**. Add or verify these variables:

| Variable | Value |
| --- | --- |
| PYTHON_SERVICE_URL | The base URL of the PythonAnywhere app, without a trailing slash or endpoint path. |
| MAIL_RELAY_SECRET | Exactly the same value configured in PythonAnywhere. |
| JWT_SECRET | Exactly the same value configured in PythonAnywhere. |
| CLOUDINARY_CLOUD_NAME | The Cloudinary cloud name used by the Python service. |

Save the environment changes and allow Render to redeploy the service.

Do not add CLOUDINARY_API_SECRET to the Render frontend or to any VITE_* variable. The private Cloudinary API secret belongs only in the Python service configuration.

## 6. Verify the mail relay

After saving config.py, run the service's self-check from the PythonAnywhere Bash console:

~~~bash
cd ~/sync-media-service
python verify_install.py
~~~

Resolve any reported configuration problems, then reload the PythonAnywhere web app.

Open the health endpoint:

~~~text
https://<YOUR_PYTHONANYWHERE_USERNAME>.pythonanywhere.com/api/v1/health
~~~

The response should indicate that the service is healthy and that mail configuration is available. Health responses must not expose secret values.

For an owner-only SMTP diagnostic, use the /api/v1/mail/diag endpoint with the relay key as documented in [the Python service README](../python-service/README.md). Treat the relay key as a password. Prefer the X-Relay-Key request header where supported; avoid sharing diagnostic URLs because query strings can be retained in browser history and server logs.

Then check the Node health endpoint:

~~~text
https://sync-5lfm.onrender.com/health
~~~

Confirm that the mail relay is reported as configured.

Finally, test the complete registration flow with an email address you control. Request a code, verify that it arrives, and complete registration. Do not publish OTPs, app passwords, or relay secrets in logs, screenshots, issues, or pull requests.

## 7. Troubleshooting

| Symptom | Likely cause | Recommended action |
| --- | --- | --- |
| Python /api/v1/health reports mail is not configured | A Gmail setting or the relay secret is missing or invalid. | Run python verify_install.py, correct config.py, and reload the PythonAnywhere app. |
| SMTP authentication fails | A normal Gmail password was used, or the App Password is incorrect. | Generate a valid Google App Password and update GMAIL_APP_PASSWORD. |
| Registration reports that the verification email could not be sent | The Node service cannot reach the Python service, or the shared relay secret does not match. | Check PYTHON_SERVICE_URL, both MAIL_RELAY_SECRET values, Python health, and Render logs. |
| The OTP interface does not appear | The deployed frontend is outdated or browser assets are cached. | Confirm the frontend changes are deployed and refresh the page. |
| Python returns 401 for a media request | The access token is invalid, expired, or signed with a different secret. | Confirm that both services use the same JWT_SECRET; obtain a fresh access token. |

## Related documentation

- [API reference](API.md)
- [Python service README](../python-service/README.md)
- [PythonAnywhere deployment guide](PYTHONANYWHERE_DEPLOYMENT_GUIDE.md)
