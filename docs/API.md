# Sync API Reference

This document describes the HTTP interfaces exposed by the Sync Node.js application and its PythonAnywhere service. The Node service serves the frontend, REST API, and Socket.IO from the same origin, so production clients do not need a separate Node API URL.

~~~js
fetch("/api/v1/conversations", {
  headers: { Authorization: "Bearer " + accessToken },
});
const socket = io({ auth: { token: accessToken } });
~~~

## API conventions

### Response format

Successful responses use this envelope:

~~~json
{
  "statusCode": 200,
  "data": {},
  "message": "success",
  "success": true
}
~~~

Error responses use this envelope:

~~~json
{
  "success": false,
  "statusCode": 400,
  "message": "A human-readable error message",
  "errors": []
}
~~~

### Authentication

Send the short-lived access token in the Authorization header using the Bearer scheme. The authentication flow may also maintain an access-token cookie. When an access token expires, call POST /api/v1/auth/refresh and retry the original request with the new access token. Obtain a fresh access token before reconnecting a Socket.IO client.

### Rate limits

The current application limits include:

- General /api/v1 traffic: 300 requests per minute.
- Failed registration/login attempts: 20 per 15 minutes.
- OTP send requests: 10 per 15 minutes.
- Failed OTP verification attempts: 30 per 15 minutes.

A request that exceeds its applicable limit receives HTTP 429 Too Many Requests. These values are implementation settings and may change.

### Media URLs

Media URLs accepted by the Node API must belong to the configured Cloudinary account and use the secure Cloudinary delivery host:

~~~text
https://res.cloudinary.com/<CLOUD_NAME>/...
~~~

This validation applies to avatars, group icons, stories, and message attachments.

---

## Node.js REST API

### Health

| Method | Path | Description |
| --- | --- | --- |
| GET | /health | Reports service health and integration status, including database connectivity, the configured Python service URL, Cloudinary cloud name, and mail-relay configuration. |

### Authentication — /api/v1/auth

| Method | Path | Authentication | Request body / behavior |
| --- | --- | --- | --- |
| POST | /register/send-otp | Public | { username, fullName, email, phoneNumber, password, avatar? }. Validates registration details, creates a pending signup, and sends a six-digit email verification code. |
| POST | /register/resend-otp | Public | { email }. Sends a replacement code when the resend cooldown permits it. |
| POST | /register/verify-otp | Public | { email, otp }. Verifies the code, creates the account, and returns the user and authentication tokens. |
| POST | /register | Public | Compatibility alias for /register/send-otp; it does not bypass email verification. |
| POST | /login | Public | { identifier, password }, where identifier can be a username, email address, or phone number. |
| POST | /refresh | Refresh session | Accepts the refresh cookie or { refreshToken } and returns a new access token. |
| POST | /logout | Refresh session | Accepts the refresh cookie or { refreshToken } and terminates the current device session. |
| GET | /me | Required | Returns the authenticated user's profile. |

A user can have up to five active device sessions. Invalid usernames and incorrect passwords return the same 401 Invalid credentials response.

### Users — /api/v1/users

All routes in this section require authentication.

| Method | Path | Description |
| --- | --- | --- |
| GET | /?search=<query> | Searches usernames and display names. The query must contain at least two characters. Numeric queries can match a phone number exactly. Results are limited to 20 users. |
| GET | /:id | Returns another user's public profile, including relevant online and block-status information. |
| PATCH | /me | Updates { fullName?, about?, avatar? }. Set avatar to an empty string to remove the current avatar. |
| GET | /blocked | Returns the authenticated user's block list. |
| POST | /:id/block | Blocks the specified user. |
| DELETE | /:id/block | Unblocks the specified user. |

### Conversations — /api/v1/conversations

All routes in this section require authentication.

| Method | Path | Description |
| --- | --- | --- |
| GET | / | Returns the user's conversations, newest first, including unread counts and the direct-chat partner where applicable. |
| POST | / | Accepts { partnerId } and creates or returns the existing direct conversation. |
| POST | /group | Accepts { groupName, groupDescription?, groupIcon?, memberIds: [] } and creates a group. The creator becomes a group admin. |
| GET | /:id | Returns the details of a conversation. |
| PATCH | /:id | Group-admin only. Updates { groupName?, groupDescription?, groupIcon?, onlyAdminCanMessage? }. |
| PATCH | /:id/members | Group-admin only. Accepts { action, targetUserId }; supported actions are add, remove, make_admin, and remove_admin. |
| POST | /:id/leave | Leaves a group. If the last admin leaves, the oldest remaining member becomes an admin. The group is removed when its final member leaves. |
| POST | /:id/read | Accepts { upToMessageId? } and marks messages as read. This is the REST alternative to the Socket.IO message:seen event. |
| GET | /:id/messages?before=<cursor>&limit=<n> | Returns paginated message history. The default page size is 30 and the maximum is 100. Results are ordered oldest to newest and include messages, hasMore, and nextBefore. Use nextBefore to request the preceding page. |

---

## Python service — PythonAnywhere

| Method | Path | Authentication | Description |
| --- | --- | --- | --- |
| GET | /health | None | Returns service status and configuration indicators without exposing secrets. |
| POST | /media/sign | Authorization: Bearer <accessToken> | Validates a Node-issued access token and returns signed Cloudinary upload parameters. |
| POST | /mail/send | X-Relay-Key: <secret> | Accepts server-to-server signup OTP mail requests from the Node backend. Browser-origin requests are rejected. |
| GET | /mail/diag | X-Relay-Key or supported key query parameter | Owner diagnostic endpoint for checking Gmail SMTP connectivity and optionally sending a test email. |

### Media-signing request

The request body may be empty or specify an upload purpose:

~~~json
{
  "purpose": "chat"
}
~~~

Supported purposes are chat, voice, avatar, story, group, and notice. The default purpose is chat.

The response contains the Cloudinary cloud name, API key, timestamp, target folder, signature, and purpose. It must never contain the Cloudinary API secret or the JWT signing secret.

### Related documentation

- [Python service setup and diagnostics](../python-service/README.md)
- [PythonAnywhere deployment guide](PYTHONANYWHERE_DEPLOYMENT_GUIDE.md)
- [Signup OTP and mail-relay setup](OTP_AND_MAIL_RELAY_SETUP_GUIDE.md)
- [Contact page configuration](CONTACT_PAGE_SETUP.md)
