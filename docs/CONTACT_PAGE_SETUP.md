# Contact page setup

The public Contact page is available at `/contact`. Visitors can fill in their name, email address, subject and message without creating an account or signing in. The page is deliberately separate from the login and registration screens.

## Email Sender

The form sends submissions to the Email Sender API using the access key in `frontend/src/config/contact.js`. The access key already supplied for this project is kept in the frontend configuration. You can optionally override it at build time with `VITE_EMAIL_SENDER_KEY`.

The Email Sender account/key must be configured in the Email Sender service to deliver contact submissions to the Sync support inbox. The browser request sends the visitor's email as the reply-to/contact email and does not choose an arbitrary recipient.

**Important:** a key embedded in frontend code is public and can be inspected by any visitor. Only use an Email Sender key designed for public form submissions. Apply provider-side origin restrictions, quotas and rate limits if the service supports them. Never put account passwords, private API secrets or the Sync mail-relay secret in frontend code.

The form keeps pending submissions in a local outbox and retries temporary network failures. This improves resilience but does not replace server-side rate limiting or spam controls.

Signup OTP continues to use the existing server-side mail relay configured with `PYTHON_SERVICE_URL` and `MAIL_RELAY_SECRET`. Keep `MAIL_RELAY_SECRET` on the server only; it is unrelated to the public Contact form.
<<<<<<< HEAD

## Troubleshooting: form says "Message sent" but no email arrives

The browser sends the form straight to the Email Sender API, so the Sync server's Content-Security-Policy (`connect-src`) must allow that origin. `node-backend/src/app.js` now adds it automatically (default `https://email-sender-wy5o.onrender.com`). If you move Email Sender to another URL, set `EMAIL_SENDER_URL` in the Render environment and update `frontend/src/config/contact.js` to match.

Also make sure the Sync site's origin (for example `https://sync-5lfm.onrender.com`) is allowed for the access key on the Email Sender side.
=======
>>>>>>> 9e5b82c4e6af81ff0dcffbb621175906d2243d99
