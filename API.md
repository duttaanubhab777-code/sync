# 📡 Sync API চুক্তি

Node সার্ভার **একই Render service** থেকে API, Socket.io আর `frontend/` ফোল্ডার serve করে।
তাই frontend-এ কোনো আলাদা `NODE_URL` লাগে না, সব রিকোয়েস্ট একই origin-এ:

```js
fetch("/api/conversations", { headers: { Authorization: `Bearer ${token}` } });
const socket = io({ auth: { token } }); // <script src="/socket.io/socket.io.js"></script>
```

## সাধারণ নিয়ম

**সফল উত্তর:** `{ "statusCode": 200, "data": ..., "message": "success", "success": true }`
**ভুল উত্তর:** `{ "success": false, "statusCode": 4xx, "message": "...", "errors": [] }`

**Auth:** `Authorization: Bearer <accessToken>` (অথবা `accessToken` cookie, লগইনের পর নিজে সেট হয়)।
Access token ছোট মেয়াদের (`JWT_EXPIRES_IN`, যেমন ১৫ মিনিট)। মেয়াদ শেষে `401` এলে `POST /api/auth/refresh` ডেকে নতুন token নিয়ে আবার চেষ্টা করো।
**Socket reconnect-এর আগে অবশ্যই নতুন access token নিও।**

Rate limit: সব `/api`-তে মিনিটে ৩০০টা; register/login-এ ১৫ মিনিটে ২০টা ব্যর্থ চেষ্টা। সীমা পার হলে `429`।

Cloudinary-র ছবি/ভিডিও/ভয়েসের URL অবশ্যই `https://res.cloudinary.com/<CLOUD_NAME>/...` হতে হবে (avatar, group icon, story, media মেসেজ সবখানে)।

---

## 🟦 REST

### Health

| Method | Path      | কাজ                                              |
| ------ | --------- | ------------------------------------------------ |
| GET    | `/health` | জীবিত কিনা (কোনো auth নয়, cold start জাগাতে) |

### Auth — `/api/auth`

| Method | Path        | Auth | Body / কাজ                                                                                         |
| ------ | ----------- | ---- | -------------------------------------------------------------------------------------------------- |
| POST   | `/register` | —    | `{ username, fullName, email, phoneNumber, password, avatar? }` → `{ user, accessToken, refreshToken }` (201) |
| POST   | `/login`    | —    | `{ identifier, password }` (identifier = username / email / ফোন) → `{ user, accessToken, refreshToken }` |
| POST   | `/refresh`  | —    | cookie অথবা `{ refreshToken }` → `{ accessToken }`                                                  |
| POST   | `/logout`   | —    | cookie অথবা `{ refreshToken }` পাঠালে ওই ডিভাইসের session শেষ হয়                                   |
| GET    | `/me`       | ✅   | নিজের প্রোফাইল                                                                                      |

একসাথে সর্বোচ্চ ৫টা ডিভাইসে লগইন থাকে। ভুল পাসওয়ার্ড/ইউজার দুটোতেই একই `401 Invalid credentials`।

### Users — `/api/users` (সব ✅)

| Method | Path                | কাজ                                                                                          |
| ------ | ------------------- | -------------------------------------------------------------------------------------------- |
| GET    | `/?search=`         | কমপক্ষে ২ অক্ষর। username/নামে খোঁজে; শুধু সংখ্যা দিলে ফোন নম্বর হুবহু মিললে পাওয়া যায়। সর্বোচ্চ ২০ |
| GET    | `/:id`              | অন্যের পাবলিক প্রোফাইল (`online`, `blockedByMe` সহ)                                          |
| PATCH  | `/me`               | `{ fullName?, about?, avatar? }` (`avatar: ""` দিলে ছবি মুছে যায়)                           |
| GET    | `/blocked`          | আমার block লিস্ট                                                                              |
| POST   | `/:id/block`        | block করা                                                                                     |
| DELETE | `/:id/block`        | unblock                                                                                       |

### Conversations — `/api/conversations` (সব ✅)

| Method | Path                         | কাজ                                                                                              |
| ------ | ---------------------------- | ------------------------------------------------------------------------------------------------ |
| GET    | `/`                          | আমার চ্যাট লিস্ট (নতুন আগে)। প্রতিটায় নিজের `unread` সংখ্যা, direct-এ `partner`                |
| POST   | `/`                          | `{ partnerId }` — direct চ্যাট শুরু; আগে থাকলে সেটাই ফেরত (201 নতুন, 200 পুরনো)                   |
| POST   | `/group`                     | `{ groupName, groupDescription?, groupIcon?, memberIds: [] }` → গ্রুপ (বানানেওয়ালা admin)         |
| GET    | `/:id`                       | একটা চ্যাটের বিবরণ                                                                               |
| PATCH  | `/:id`                       | শুধু group admin: `{ groupName?, groupDescription?, groupIcon?, onlyAdminCanMessage? }`          |
| PATCH  | `/:id/members`               | শুধু group admin: `{ action: "add"｜"remove"｜"make_admin"｜"remove_admin", targetUserId }`        |
| POST   | `/:id/leave`                 | গ্রুপ ছাড়া। শেষ admin ছাড়লে সবচেয়ে পুরনো সদস্য admin হয়; শেষ সদস্য ছাড়লে গ্রুপ মুছে যায়       |
| POST   | `/:id/read`                  | `{ upToMessageId? }` — পড়া হয়েছে (socket-এর `message:seen`-এর REST বিকল্প)                       |
| GET    | `/:id/messages?before=&limit=` | ইতিহাস। `limit` ডিফল্ট ৩০ (সর্বোচ্চ ১০০)। উত্তর পুরনো → নতুন ক্রমে: `{ messages, hasMore, nextBefore }`। আরও পুরনো চাইলে `before=nextBefore` |

যে direct চ্যাটে এখনো কোনো মেসেজ যায়নি, সেটা শুধু যে শুরু করেছে তার লিস্টে দেখা যায়।
Block করা (দুই দিকেই) ইউজারের সাথে নতুন direct চ্যাট শুরু হয় না (`403`)।

### Sync — reconnect-এর পর

`GET /api/sync?after=<শেষ দেখা messageId>&since=<আগের serverTime>` (✅)

```json
{
  "messages": [],        // `after`-এর পরের নতুন মেসেজ, পুরনো → নতুন, সর্বোচ্চ ২০০
  "hasMore": false,      // true হলে শেষ messageId দিয়ে আবার ডাকো
  "updated": [],         // `since`-এর পর বদলানো পুরনো মেসেজ (tick বদল, delete for everyone)
  "serverTime": "..."    // রেখে দাও, পরের বার `since` হিসেবে পাঠাও
}
```

`after` না দিলে `messages` ফাঁকা আসে। প্রথমবার চ্যাট লিস্ট + `/messages` ব্যবহার করো। Sync-এ আসা মেসেজ নিজে থেকেই "delivered" হয়ে যায়।
Sync-এর পর চ্যাট লিস্টের `unread` সংখ্যা ঠিক করতে `GET /api/conversations` আবার ডাকো।

### Stories — `/api/stories` (সব ✅, ২৪ ঘণ্টা পরে নিজে মুছে যায়)

| Method | Path            | কাজ                                                                                          |
| ------ | --------------- | -------------------------------------------------------------------------------------------- |
| GET    | `/`             | আমার + contact-দের চলতি story, লেখক ধরে ভাগ: `[{ author, stories, hasUnseen, isMine }]`     |
| POST   | `/`             | `{ type: "text"｜"image"｜"video", caption?, backgroundColor?, media?: { url, publicId?, mime?, duration? } }` |
| POST   | `/:id/view`     | দেখা হয়েছে জানানো (লেখক `story:viewed` পায়)                                                 |
| GET    | `/:id/viewers`  | কারা দেখেছে (শুধু লেখক)                                                                       |
| DELETE | `/:id`          | মুছে ফেলা (শুধু লেখক)                                                                         |

"Contact" মানে যার সাথে আমার direct চ্যাট আছে (block সম্পর্ক বাদে)।

---

## 🟦 Socket.io

কানেকশন: `io({ auth: { token: <accessToken> } })`। ভুল/মেয়াদোত্তীর্ণ token হলে `connect_error` (`UNAUTHORIZED`)।
প্রতিটা ack-এর আকার: `{ ok: true, ... }` অথবা `{ ok: false, error: "CODE" }`।

### Client → Server

| Event               | Payload                                                          | Ack                                                      |
| ------------------- | ---------------------------------------------------------------- | -------------------------------------------------------- |
| `message:send`      | `{ conversationId, clientMsgId, type?, text?, media?, replyTo? }` | `{ ok, message, duplicate? }`                            |
| `message:delete`    | `{ messageId }` — সবার জন্য মোছা (শুধু প্রেরক)                    | `{ ok }`                                                 |
| `message:delivered` | `{ messageId }` অথবা `{ messageIds: [] }`                        | —                                                        |
| `message:seen`      | `{ conversationId, upToMessageId? }`                             | —                                                        |
| `typing:start` / `typing:stop` | `{ conversationId }`                                  | —                                                        |

`type`: `text | image | video | audio | file` (text ছাড়া বাকিতে `media.url` লাগবে)।
`clientMsgId`: ফ্রন্টএন্ডের বানানো UUID। একই id আবার পাঠালে নতুন মেসেজ হয় না, আগেরটাই ফেরত আসে।

`message:send`-এর error কোড: `INVALID_PAYLOAD`, `RATE_LIMITED` (১০ সেকেন্ডে ২০টার বেশি), `FORBIDDEN_NOT_MEMBER`, `ONLY_ADMINS_CAN_MESSAGE`, `BLOCKED`, `EMPTY_MESSAGE`, `MESSAGE_TOO_LONG`, `INVALID_MEDIA_URL`, `INVALID_REPLY`, `SERVER_ERROR`।

### Server → Client

| Event                  | Payload                                                       | কখন                                                                  |
| ---------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------- |
| `message:new`          | `{ message, conversationId }`                                 | নতুন মেসেজ (প্রেরকের যে socket থেকে পাঠানো, সেটা বাদে)               |
| `message:deleted`      | `{ messageId, conversationId }`                               | কেউ সবার জন্য মুছলে                                                  |
| `message:status_bulk`  | `{ conversationId, messageIds, status, by, at }`              | আমার পাঠানো মেসেজের status বদলালে (`delivered` / `seen`)            |
| `conversation:read`    | `{ conversationId }`                                          | আমার অন্য ডিভাইসে চ্যাট পড়া হলে (unread ০ করো)                      |
| `conversation:new`     | `{ conversation }`                                            | নতুন গ্রুপে যোগ হলে                                                  |
| `conversation:updated` | `{ conversation }`                                            | গ্রুপের নাম/সদস্য/admin বদলালে। **এতে `unread` থাকে না**, নিজেরটা রেখে দাও |
| `conversation:removed` | `{ conversationId }`                                          | গ্রুপ থেকে বাদ পড়লে বা নিজে ছাড়লে                                  |
| `typing`               | `{ conversationId, userId, fullName, isTyping }`              | অন্য কেউ টাইপ করছে                                                   |
| `presence:snapshot`    | `{ onlineUserIds: [] }`                                       | কানেক্ট হওয়ামাত্র, আমার চ্যাটের কে কে অনলাইন                        |
| `presence:update`      | `{ userId, online, lastSeen }`                                | কেউ অনলাইন/অফলাইন হলে                                                |
| `story:new`            | `{ storyId, authorId }`                                       | contact নতুন story দিলে                                              |
| `story:viewed`         | `{ storyId, viewer, viewedAt }`                               | আমার story কেউ দেখলে                                                 |
| `story:deleted`        | `{ storyId, authorId }`                                       | contact story মুছলে                                                  |

### Tick-এর হিসাব

- ✓ `sent` — সার্ভারে সেভ হয়েছে (`message:send`-এর ack)
- ✓✓ `delivered` — অপর পক্ষের ফোনে পৌঁছেছে (গ্রুপে প্রেরক বাদে **সবার** কাছে পৌঁছালে)
- 🔵 `seen` — দেখেছে (গ্রুপে **সবাই** দেখলে)

ইউজার অফলাইন থাকলে মেসেজ আগে DB-তে যায়; সে কানেক্ট করলে সার্ভার নিজেই "delivered" করে দেয়।

---

## 🟨 Python (PythonAnywhere)

| Method | Path          | Auth            | কাজ                  |
| ------ | ------------- | --------------- | -------------------- |
| GET    | `/health`     | —               | জীবিত কিনা           |
| POST   | `/media/sign` | `Bearer JWT`    | Cloudinary signature |
| POST   | `/scan` _(পরে)_ | `X-Service-Key` | ছবি স্ক্যান          |

- Node যে **access token** দেয় সেটাই Python যাচাই করবে (একই `JWT_SECRET`, payload-এ `id` আছে)। **Refresh token** দিয়ে Python-কেও ডাকা যাবে না, তাই আলাদা `tokenType: "refresh"` আছে, Python-এ access token হিসেবে `tokenType` নেই এমন token-ই মানতে হবে।
- Python-এর CORS-এ `FRONTEND_URL` হিসেবে **Render সার্ভিসের ঠিকানা** (`https://<নাম>.onrender.com`) দিতে হবে, কারণ ব্রাউজার এখান থেকেই `/media/sign` ডাকে।
