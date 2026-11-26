# Android অ্যাপ আপডেট নোটিফিকেশন ("Update Now")

নতুন APK release হলে শুধু **Android অ্যাপের** ব্যবহারকারীদের ফোনে নোটিফিকেশন যায়।
নোটিফিকেশনে **Update Now** ও **Later** বাটন থাকে। (Notice সিস্টেম আগের মতোই আলাদা, কোনো বদল নেই।)

## কীভাবে কাজ করে
1. GitHub Actions নতুন APK বানিয়ে Release দেয় (`android-v1.0.<build>`)।
2. সার্ভার নতুন build ধরে (নিচের দুই উপায়ে) ও শুধু Android (FCM) ডিভাইসে `type = app_update` push পাঠায়।
   - **GitHub Actions ping**: workflow শেষে `POST /api/v1/updates/notify` (secret সহ) → সাথে সাথে যায়।
   - **সার্ভারের নিজস্ব খোঁজা**: প্রতি ৫ মিনিটে GitHub Releases দেখে (secret না দিলেও কাজ করে)।
3. একই build একবারই যায় (`AppUpdateState` collection-এ মনে রাখা হয়)। সার্ভার প্রথমবার চালু হলে পুরনো release-এর জন্য পাঠায় না।
4. ফোনে "Update Now" চাপলে APK ডাউনলোড হয় (progress নোটিফিকেশন সহ)। শেষে **Update ready to install** নোটিফিকেশন আসে (অ্যাপ খোলা থাকলে সরাসরি ইনস্টলার খোলে)।
5. প্রথমবার ফোন একবার "Install unknown apps → Sync" অনুমতি চাইবে। শেষে সিস্টেমের **Install** বাটন চাপতে হয় (Android-এর নিয়মে এটা বাদ দেওয়া যায় না)।

## সেটআপ
- Render (backend) এ: `FIREBASE_*` আগের মতোই থাকতে হবে। চাইলে `APP_UPDATE_NOTIFY_SECRET` দাও।
- GitHub repo → Settings → Secrets → Actions: `APP_UPDATE_NOTIFY_SECRET` (Render-এর মানের সাথে এক)। চাইলে `SYNC_API_URL` (ডিফল্ট `https://sync-5lfm.onrender.com`)।
- এই ফিচারসহ **নতুন APK একবার হাতে ইনস্টল** করতে হবে। এর পর থেকে সব আপডেট নোটিফিকেশন থেকেই হবে।
- পুরনো APK-তে (এই ফিচার ছাড়া) নোটিফিকেশন সাধারণ মেসেজের মতো দেখায়, চাপলে অ্যাপের Updates পেজ খোলে।
