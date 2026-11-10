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

Rate limit: সব `/api`-তে মিনিটে ৩০০টা; register/login-এ ১৫ মিনিটে ২০টা ব্যর্থ চেষ্টা; OTP পাঠাতে ১৫ মিনিটে ১০টা এবং যাচাইয়ে ১৫ মিনিটে ৩০টা ব্যর্থ চেষ্টা। সীমা পার হলে `429`।

Cloudinary-র ছবি/ভিডিও/ভয়েসের URL অবশ্যই `https://res.cloudinary.com/<CLOUD_NAME>/...` হতে হবে (avatar, group icon, story, media মেসেজ সবখানে)।

---

## 🟦 REST

### Health

| Method | Path      | কাজ                                              |
| ------ | --------- | ------------------------------------------------ |
| GET    | `/health` | জীবিত কিনা (`dbConnected`, `pythonServiceUrl`, `cloudinaryCloudName`, `mailRelayConfigured`) |

### Auth — `/api/auth`

| Method | Path                   | Auth | Body / কাজ                                                                                         |
| ------ | ---------------------- | ---- | -------------------------------------------------------------------------------------------------- |
| POST   | `/register/send-otp`   | —    | `{ username, fullName, email, phoneNumber, password, avatar? }` → ইমেইলে ৬-সংখ্যার OTP পাঠায় এবং `{ email, expiresInSeconds, resendAfterSeconds }` ফেরত দেয় (200) |
| POST   | `/register/resend-otp` | —    | `{ email }` → কুলডাউন শেষে নতুন ৬-সংখ্যার OTP পাঠায় এবং `{ email, expiresInSeconds, resendAfterSeconds }` ফেরত দেয় (200) |
| POST   | `/register/verify-otp` | —    | `{ email, otp }` → OTP সঠিক হলে আসল অ্যাকাউন্ট তৈরি করে `{ user, accessToken, refreshToken }` ফেরত দেয় (201) |
| POST   | `/register`            | —    | `/register/send-otp`-এরই alias (OTP ছাড়া সরাসরি অ্যাকাউন্ট তৈরি হয় না)                          |
| POST   | `/login`               | —    | `{ identifier, password }` (identifier = username / email / ফোন) → `{ user, accessToken, refreshToken }` |
| POST   | `/refresh`             | —    | cookie অথবা `{ refreshToken }` → `{ accessToken }`                                                  |
| POST   | `/logout`              | —    | cookie অথবা `{ refreshToken }` পাঠালে ওই ডিভাইসের session শেষ হয়                                   |
| GET    | `/me`                  | ✅   | নিজের প্রোফাইল                                                                                      |

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

---

## 🟨 Python (PythonAnywhere)

| Method | Path          | Auth                     | কাজ                                      |
| ------ | ------------- | ------------------------ | ---------------------------------------- |
| GET    | `/health`     | —                        | জীবিত কিনা (`configured`, `mailConfigured`) |
| POST   | `/media/sign` | `Bearer JWT`             | Cloudinary signed-upload signature       |
| POST   | `/mail/send`  | `X-Relay-Key`            | Node ব্যাকএন্ডের হয়ে Gmail SMTP দিয়ে OTP ইমেইল পাঠানো |
| GET    | `/mail/diag`  | `X-Relay-Key` বা `?key=` | মেইল রিলে ও SMTP পোর্ট (465/587) পরীক্ষা |
