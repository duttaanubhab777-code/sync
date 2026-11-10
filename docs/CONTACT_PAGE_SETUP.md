# Contact page configuration

The Sync contact form reads the Email Sender access key from the frontend build environment:

`VITE_EMAIL_SENDER_ACCESS_KEY`

Add the value in your frontend hosting provider's environment variables, then trigger a new frontend deployment. Do not commit the actual key to Git. The key is only used by the Contact page; signup OTP continues to use the existing server-side mail relay configured with `PYTHON_SERVICE_URL` and `MAIL_RELAY_SECRET`.
