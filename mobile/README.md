# Sync — Android app (Capacitor)

এই ফোল্ডারটা Sync-এর Android অ্যাপ বানায়। অ্যাপটা আলাদা কোনো সার্ভার চায় না: ভেতরে শুধু একটা native র‍্যাপার থাকে, আর সব কিছু লাইভ সাইট (`https://sync-5lfm.onrender.com`) থেকে লোড হয়।

## WhatsApp-এর মতো Push Notification (Firebase Cloud Messaging)

অ্যাপ বন্ধ (killed) বা ব্যাকগ্রাউন্ডে থাকলেও WhatsApp-এর মতো তাৎক্ষণিক নোটিফিকেশন আসে:
- **গোল প্রোফাইল ছবি (Circular Avatar)**: প্রেরকের প্রোফাইল ছবি গোল করে দেখায়; প্রোফাইল ছবি না থাকলে প্রেরকের নামের আদ্যক্ষর (Initials) দিয়ে গোল ব্যাজ তৈরি হয়।
- **মেসেজ স্ট্যাকিং (`MessagingStyle`)**: একই চ্যাটে পরপর একাধিক মেসেজ এলে আলাদা আলাদা কার্ড না বানিয়ে একটি কার্ডের ভেতর পরপর সাজিয়ে দেখায় (`3 new messages`)।
- **গ্রুপ চ্যাট ও ছবির প্রিভিউ**: গ্রুপ চ্যাটে গ্রুপের নাম ও কে কোন মেসেজ পাঠিয়েছে তা আলাদাভাবে দেখায়; ছবির মেসেজ বা Admin Notice-এ বড় ছবির প্রিভিউ (`BigPictureStyle`) দেখায়।
- **ট্যাপ করলে সরাসরি চ্যাটে**: নোটিফিকেশনে ট্যাপ করলে অ্যাপ খুলে সরাসরি ওই নির্দিষ্ট চ্যাটে (`/chats/<id>`) চলে যায় এবং ওই চ্যাটের না-দেখা নোটিফিকেশন স্ট্যাক মুছে যায়।

### Render-এ Firebase Secret কীভাবে বসাবে

Firebase Console → **Project settings** → **Service accounts** → **Generate new private key** থেকে যে `.json` ফাইলটা ডাউনলোড করেছ, সেটার মান Render Dashboard → তোমার `sync` সার্ভিস → **Environment** ট্যাবে নিচের যেকোনো একটা উপায়ে বসাও:

**উপায় ১ (সবচেয়ে সহজ — মাত্র ১টি ভ্যারিয়েবল):**
- `FIREBASE_SERVICE_ACCOUNT_JSON` = ডাউনলোড করা `.json` ফাইলটা টেক্সট এডিটরে খুলে পুরো `{ ... }` লেখাটা হুবহু কপি করে এক লাইনে বা যেভাবে আছে সেভাবেই পেস্ট করে দাও।

**উপায় ২ (অথবা ৩টি আলাদা ভ্যারিয়েবল):**
ওই ডাউনলোড করা JSON ফাইলের ভেতর থেকে এই ৩টি ফিল্ড কপি করে Render-এ বসাও:
- `FIREBASE_PROJECT_ID` = `sync-34886`
- `FIREBASE_CLIENT_EMAIL` = JSON-এর `"client_email"` এর মান (যেমন `firebase-adminsdk-xxxxx@sync-34886.iam.gserviceaccount.com`)
- `FIREBASE_PRIVATE_KEY` = JSON-এর `"private_key"` এর মান (`-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n`)

## আপডেট কীভাবে যায়

| কী বদলালে | কী করতে হবে |
|---|---|
| UI, চ্যাট, বাগফিক্স (`frontend/`) | কিছুই না। GitHub-এ push করলে Render ডিপ্লয় করে, অ্যাপ পরের বার খুললেই নতুন ভার্সন পায় |
| ব্যাকএন্ড (`node-backend/`) | কিছুই না। Render ডিপ্লয় করে |
| `mobile/` ফোল্ডার (permission, আইকন, নতুন native প্লাগইন, `google-services.json`) | push করলে GitHub Actions নতুন APK বানায় |

## APK পাওয়ার উপায়

1. এই ফোল্ডারটা repo তে push করো।
2. GitHub → **Actions** → **Build Android APK** চলে (প্রথমবার ~৫-১০ মিনিট)। হাতে চালাতে চাইলে **Run workflow** চাপো।
3. শেষ হলে repo-এর **Releases** পেজে **Sync Android (latest)** থেকে `Sync.apk` ডাউনলোড করে ইনস্টল করো। (Chrome "unknown source" অনুমতি চাইতে পারে।)

প্রতিবার একই signing key ব্যবহার হয় (`debug.keystore`), তাই নতুন APK আগেরটার ওপর আপডেট হিসেবে বসে, আনইনস্টল করতে হয় না।

## ফাইলগুলো

- `capacitor.config.json` — অ্যাপের নাম, লাইভ URL, স্ট্যাটাস বার, পুশ ও splash সেটিং
- `google-services.json` — Firebase Android কনফিগারেশন (`com.sync.chat`, প্রজেক্ট `sync-34886`)
- `www/offline.html` — ইন্টারনেট না থাকলে "No internet" স্ক্রিন, আর Render সার্ভার ঘুমিয়ে থাকলে সার্ভার-বুট লগ দেখায়
- `scripts/customize-android.sh` — permission, আইকন, splash, `google-services.json`, এবং WhatsApp-style `SyncMessagingService.java` ও `MainActivity.java` সেট করে
- `debug.keystore` — signing key (শুধু সরাসরি APK শেয়ারের জন্য)
