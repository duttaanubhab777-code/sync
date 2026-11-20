# Contact Page Configuration

The public Contact page is available at /contact. Visitors can submit their name, email address, subject, and message without creating an account or signing in. The Contact page is independent of the authentication and signup flows.

## Email delivery

The frontend submits contact requests to the separately hosted Email Sender API. Its client configuration is maintained in:

~~~text
frontend/src/config/contact.js
~~~

The API key used by the browser can optionally be overridden at build time with VITE_EMAIL_SENDER_KEY. The Email Sender service must be configured to deliver submissions to the Sync support inbox. The visitor's email address is used as the reply-to/contact address; the browser does not select an arbitrary recipient.

> [!IMPORTANT]
> Any credential included in frontend code is public and can be inspected by visitors. Use only a key explicitly intended for public form submissions. Apply provider-side origin restrictions, quotas, and rate limits where supported. Never place account passwords, private API secrets, or MAIL_RELAY_SECRET in frontend code.

## Reliability and abuse protection

The form keeps pending submissions in a local outbox and retries temporary network failures. This improves resilience, but it does not replace server-side validation, rate limiting, or spam prevention.

Signup OTP delivery is a separate server-to-server workflow. The Node backend calls the Python mail relay using PYTHON_SERVICE_URL and MAIL_RELAY_SECRET. Keep the relay secret on the server only.

## Troubleshooting

### The form reports success, but no email arrives

The browser sends the request directly to the Email Sender API. The Sync server's Content Security Policy must therefore allow the Email Sender origin in connect-src.

The Node application adds the configured Email Sender origin automatically. The default service URL is:

~~~text
https://email-sender-wy5o.onrender.com
~~~

If the Email Sender service moves:

1. Set EMAIL_SENDER_URL in the Render environment to the new service origin.
2. Update the matching origin in frontend/src/config/contact.js.
3. Deploy the updated application.
4. Confirm that the Sync website's origin is permitted by the Email Sender key/service configuration.

Also check the Email Sender service logs and delivery configuration. A successful browser request does not necessarily mean the destination inbox accepted or delivered the message.
