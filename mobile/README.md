# Sync — Android app (Capacitor)

এই ফোল্ডারটা Sync-এর Android অ্যাপ বানায়। অ্যাপটা আলাদা কোনো সার্ভার চায় না: ভেতরে শুধু একটা native র‍্যাপার থাকে, আর সব কিছু লাইভ সাইট (`https://sync-5lfm.onrender.com`) থেকে লোড হয়।

## আপডেট কীভাবে যায়

| কী বদলালে | কী করতে হবে |
|---|---|
| UI, চ্যাট, বাগফিক্স (`frontend/`) | কিছুই না। GitHub-এ push করলে Render ডিপ্লয় করে, অ্যাপ পরের বার খুললেই নতুন ভার্সন পায় |
| ব্যাকএন্ড (`node-backend/`) | কিছুই না। Render ডিপ্লয় করে |
| `mobile/` ফোল্ডার (permission, আইকন, নতুন native প্লাগইন) | push করলে GitHub Actions নতুন APK বানায় |

## APK পাওয়ার উপায়

1. এই ফোল্ডারটা repo তে push করো।
2. GitHub → **Actions** → **Build Android APK** চলে (প্রথমবার ~৫-১০ মিনিট)। হাতে চালাতে চাইলে **Run workflow** চাপো।
3. শেষ হলে repo-এর **Releases** পেজে **Sync Android (latest)** থেকে `Sync.apk` ডাউনলোড করে ইনস্টল করো। (Chrome "unknown source" অনুমতি চাইতে পারে।)

প্রতিবার একই signing key ব্যবহার হয় (`debug.keystore`), তাই নতুন APK আগেরটার ওপর আপডেট হিসেবে বসে, আনইনস্টল করতে হয় না।

## ফাইলগুলো

- `capacitor.config.json` — অ্যাপের নাম, লাইভ URL, স্ট্যাটাস বার ও splash সেটিং
- `www/offline.html` — ইন্টারনেট না থাকলে "No internet" স্ক্রিন, আর Render সার্ভার ঘুমিয়ে থাকলে সার্ভার-বুট লগ (ধাপে ধাপে স্টার্টআপ, প্রগ্রেস বার, ping ms) দেখায়। `/health` সত্যিই 200 দিলে তবেই অ্যাপ খোলে। ইন্টারনেট ও সার্ভার আলাদা করে ping করে, তাই "offline" আর "সার্ভার জাগছে" গুলিয়ে যায় না
- `scripts/customize-android.sh` — permission, আইকন, splash, version সেট করে
- `debug.keystore` — signing key (শুধু সরাসরি APK শেয়ারের জন্য)

## অ্যাপ-ভেতরের আপডেট (Update popup ও Updates পেজ)

- প্রতিটি APK নিজের build নম্বর জানে (User-Agent এ `SyncApp/1.0.<build>`, GitHub Actions বসায়)।
- অ্যাপ খুললে backend (`GET /api/app/updates`) GitHub Releases থেকে সর্বশেষ ভার্সন ও "What's new" আনে। নতুন ভার্সন থাকলে ৫ সেকেন্ডের কাউন্টডাউন সহ **Update available** পপআপ আসে। বাটন চাপলে ব্রাউজার APK নামায়, নামা শেষে ফাইলে ট্যাপ করে Install করলেই পুরনোর ওপর আপডেট হয়।
- পপআপ এড়িয়ে গেলে বা "Later" দিলে **Profile → App updates** বা উপরের Download আইকন (নতুন ভার্সন থাকলে সবুজ ডট) থেকে `/updates` পেজে যাওয়া যায়: সেখানে বর্তমান ভার্সন, কী কী বদলেছে ও আগের সব ভার্সনের ইতিহাস থাকে।
- প্রতি build-এর আলাদা release হয় (`android-v1.0.<build>`), আর সবসময় সর্বশেষটার লিংক: `https://github.com/duttaanubhab777-code/sync/releases/latest/download/Sync.apk`
- repo-র নাম আলাদা হলে Render এ `GITHUB_REPO=owner/repo` সেট করো (private repo হলে `GITHUB_TOKEN`ও)।
- Android নিজেই শেষ "Install" ট্যাপটা চায়, চুপচাপ নিজে নিজে ইনস্টল হওয়া সম্ভব নয়।

## অ্যাপ খোলার Splash

Android 12+ এর সিস্টেম splash ও পুরনো ফোনের splash.png দুটোই PWA-র মতো: গাঢ় ব্যাকগ্রাউন্ডে গোল লোগো। ওয়েব পেজ আঁকা হলে (`main.jsx`) বা offline পেজ খুললে splash নিজে সরে যায়; কিছু না হলে `launchShowDuration` (৩ সেকেন্ড) পর যায়।

## Play Store-এ দিতে চাইলে

`debug.keystore` Play Store-এর জন্য নয়। তখন আলাদা একটা release keystore বানিয়ে GitHub Secrets-এ রাখতে হবে এবং `assembleRelease` বিল্ডে যেতে হবে।

## Test note
Update popup test build.
Update popup test build for v1.0.12.
