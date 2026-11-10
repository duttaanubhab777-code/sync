# Contact page setup

The Contact page already uses the Email Sender access key in `frontend/src/config/contact.js`. The optional frontend build variable is `VITE_EMAIL_SENDER_KEY`; set it in the frontend host to override the fallback key, then redeploy.

The contact form is a browser-facing form access key (not the Sync authentication relay secret). Signup OTP continues to use the existing server-side mail relay configured with `PYTHON_SERVICE_URL` and `MAIL_RELAY_SECRET`. Do not put `MAIL_RELAY_SECRET` in frontend code.
