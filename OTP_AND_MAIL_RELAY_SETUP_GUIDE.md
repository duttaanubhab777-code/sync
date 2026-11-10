# Sync App — OTP Account Creation ও PythonAnywhere Email Relay সম্পূর্ণ গাইড

Render-এর ফ্রি প্ল্যানে সরাসরি ইমেইল পাঠানো (SMTP Port `465` / `587`) ব্লক থাকে। তাই **Sync App**-এ নতুন অ্যাকাউন্ট খোলার সময় ৬-ডিজিটের **OTP Verification System** চালানোর জন্য **PythonAnywhere**-কে **Email Relay** হিসেবে যুক্ত করা হয়েছে।

---

## ১. পুরো সিস্টেমটা কীভাবে কাজ করে?

```text
[ইউজার (Browser)]
   │
   ├─ ১. রেজিস্টার ফর্মে নাম, ইমেইল, ফোন, পাসওয়ার্ড দিয়ে "Send verification code" চাপে
   ▼
[Node.js Backend (Render)]  ──(POST /api/auth/register/send-otp)
   │  • তথ্য যাচাই করে PendingSignup কালেকশনে সাময়িকভাবে রাখে (পাসওয়ার্ড ও OTP হ্যাশ করে)
   │  • X-Relay-Key হেডারসহ PythonAnywhere-কে ইমেইল পাঠাতে বলে
   ▼
[Flask Mail Relay (PythonAnywhere)] ──(POST /mail/send)
   │  • X-Relay-Key যাচাই করে
   │  • Gmail SMTP (Port 465 SSL / 587 STARTTLS) দিয়ে ইউজারের ইমেইলে ৬-ডিজিট OTP পাঠায়
   ▼
[ইউজার (Browser)]
   │  • ইমেইল থেকে ৬-ডিজিটের কোডটি বসিয়ে "Verify & create account" চাপে
   ▼
[Node.js Backend (Render)]  ──(POST /api/auth/register/verify-otp)
   │  • OTP মিলে গেলে আসল User অ্যাকাউন্ট তৈরি করে এবং সাথে সাথে লগইন করিয়ে চ্যাটে নিয়ে যায়!
```

---

## ২. আপনার করা ফাইলের সাথে নতুন কী কী যোগ ও সম্পূর্ণ করা হয়েছে?

আপনি ব্যাকএন্ড এবং পাইথন রিলের ফাইলগুলো চমৎকারভাবে তৈরি করেছিলেন। পুরো সিস্টেমটি যাতে শুরু থেকে শেষ পর্যন্ত নির্ভুলভাবে কাজ করে, তার জন্য নিচের বাকি কাজগুলো সম্পূর্ণ করা হয়েছে:

| অংশ | ফাইল | কী যোগ করা হয়েছে |
| :--- | :--- | :--- |
| **Frontend (React)** | `frontend/src/pages/RegisterPage.jsx` | ২-ধাপের রেজিস্ট্রেশন UI: **ধাপ ১**-এ ইউজারের তথ্য নেওয়া ও ভ্যালিডেশন, আর **ধাপ ২**-এ ৬টি আলাদা OTP বক্স (কপি-পেস্ট ও ব্যাকস্পেস সাপোর্টসহ), ১০ মিনিটের মেয়াদ টাইমার, ৬০ সেকেন্ডের **Resend code** টাইমার এবং ভুল ইমেইল সংশোধনের জন্য **Change details** বাটন। |
| **Frontend (Redux)** | `frontend/src/store/authSlice.js` | `sendSignupOtp` (`/api/auth/register/send-otp`), `resendSignupOtp` (`/api/auth/register/resend-otp`), এবং `verifySignupOtp` (`/api/auth/register/verify-otp`) থাঙ্ক ও রেট-লিমিট (`retryAfterSeconds`) হ্যান্ডলিং। |
| **Frontend (CSS)** | `frontend/src/styles/auth-shell.css` | Sync-এর ডার্ক-গ্রিন থিমের সাথে মিলিয়ে OTP ইনপুট গ্রিড, ইমেইল ব্যাজ, টাইমার ও মোবাইল রেসপনসিভ স্টাইল। |
| **Python Tests** | `python-service/tests/test_mail_relay.py` | `/mail/send`, `/mail/diag`, `X-Relay-Key` নিরাপত্তা ও রেট-লিমিটের অটোমেটেড টেস্ট। |
| **Node Tests** | `node-backend/test/otp-and-mail.test.js` | OTP জেনারেশন, HMAC হ্যাশিং, ইমেইল টেমপ্লেট ও রিলের অটোমেটেড টেস্ট। |
| **Documentation** | `OTP_AND_MAIL_RELAY_SETUP_GUIDE.md`, `docs/API.md`, `python-service/README.md` | সম্পূর্ণ বাংলা সেটআপ গাইড ও আপডেটেড API ডকুমেন্টেশন। |

---

## ৩. ধাপ ১ — Gmail থেকে ১৬-অক্ষরের App Password তৈরি করা

PythonAnywhere থেকে ইমেইল পাঠানোর জন্য আপনার সাধারণ Gmail পাসওয়ার্ড কাজ করবে না; Google-এর **App Password** লাগবে:

1. যে Gmail অ্যাকাউন্ট থেকে OTP ইমেইল পাঠাতে চান (যেমন `sync93346@gmail.com`), সেই অ্যাকাউন্টে লগইন করে [Google Account Security](https://myaccount.google.com/security)-তে যান।
2. **2-Step Verification** চালু না থাকলে সেটি **On** করুন।
3. উপরের সার্চ বারে লিখুন **App passwords** এবং সেখানে ঢুকুন।
4. App name হিসেবে লিখুন `Sync Mail Relay` এবং **Create** চাপুন।
5. স্ক্রিনে ১৬ অক্ষরের একটি কোড দেখাবে (যেমন: `abcd efgh ijkl mnop`)। এটি কপি করে রাখুন।

---

## ৪. ধাপ ২ — PythonAnywhere-এ সেটআপ (`/home/sync2026/mysite`)

আপনার স্ক্রিনশট অনুযায়ী আপনার PythonAnywhere ইউজারনেম `sync2026` এবং ফোল্ডার হলো `/home/sync2026/mysite`।

### ৪.১ ফাইল আপডেট করা
যদি আপনি ইতিমধ্যে নতুন `app.py`, `settings.py`, `verify_install.py`, `routes/mail.py`, `services/mail_service.py` ফাইলগুলো `/home/sync2026/mysite`-এ তুলে থাকেন, তাহলে আবার তোলার দরকার নেই। আর যদি একসাথে তুলতে চান, তবে প্রজেক্টের `python-service/` ফোল্ডারের ফাইলগুলো `/home/sync2026/mysite`-এ রাখুন।

### ৪.২ `config.py` ফাইলে Gmail ও Relay Secret বসানো
1. PythonAnywhere-এর **Files** ট্যাবে গিয়ে `/home/sync2026/mysite/config.py` ফাইলটিতে ক্লিক করে ওপেন করুন।
2. সেখানে আগের `JWT_SECRET` ও `CLOUDINARY_...` ভ্যারিয়েবলগুলোর নিচে এই ৩টি নতুন লাইন যোগ করুন:

```python
# --- আগের সেটিংস (যেমন আছে তেমনই থাকবে) ---
JWT_SECRET = "আপনার_রেন্ডারের_JWT_SECRET"
CLOUDINARY_CLOUD_NAME = "আপনার_cloud_name"
CLOUDINARY_API_KEY = "আপনার_api_key"
CLOUDINARY_API_SECRET = "আপনার_api_secret"
ALLOWED_ORIGINS = "https://sync-5lfm.onrender.com"

# --- নতুন যোগ করুন: Signup OTP Mail Relay ---
GMAIL_USER = "sync93346@gmail.com"
GMAIL_APP_PASSWORD = "abcd efgh ijkl mnop"
MAIL_RELAY_SECRET = "SyncRelaySecret2026Key9876543210"
```

> **গুরুত্বপূর্ণ:**
> - `GMAIL_USER`: আপনার আসল Gmail অ্যাড্রেস দিন।
> - `GMAIL_APP_PASSWORD`: ধাপ ১-এ পাওয়া ১৬ অক্ষরের App Password দিন (মাঝখানে স্পেস থাকলেও অসুবিধা নেই)।
> - `MAIL_RELAY_SECRET`: কমপক্ষে ২৪ অক্ষরের যেকোনো লম্বা গোপন টেক্সট দিন (ইংরেজি অক্ষর ও সংখ্যা মিলিয়ে)। **এই একই টেক্সট হুবহু Render-এর Environment-এও বসাতে হবে।**

3. উপরে ডানদিকে **Save** বাটন চাপুন।

### ৪.৩ WSGI ফাইল চেক করা
যেহেতু আপনার ফোল্ডারের নাম `mysite`, তাই PythonAnywhere-এর **Web** ট্যাবে গিয়ে **WSGI configuration file** লিংকে ক্লিক করে নিশ্চিত হয়ে নিন `PROJECT_HOME` ঠিক আছে:

```python
import sys

PROJECT_HOME = "/home/sync2026/mysite"

if PROJECT_HOME not in sys.path:
    sys.path.insert(0, PROJECT_HOME)

from app import app as application
```

### ৪.৪ কনসোলে চেক ও Web App Reload দেওয়া
1. PythonAnywhere-এর **Consoles** ট্যাব থেকে আপনার Bash console খুলুন এবং চালান:
   ```bash
   cd ~/mysite
   python verify_install.py
   ```
2. সব ঠিক থাকলে দেখবেন:
   - `OK       configuration is complete`
   - `OK       mail relay configuration is complete (sender: ...)`
   - `RESULT: everything looks good`
3. এবার **Web** ট্যাবে গিয়ে বড় সবুজ **Reload sync2026.pythonanywhere.com** বাটন চাপুন।

---

## ৫. ধাপ ৩ — PythonAnywhere Mail Relay কাজ করছে কিনা পরীক্ষা করা

Reload দেওয়ার পর আপনার ফোনের বা কম্পিউটারের ব্রাউজারে নিচের দুটি লিংক খুলে চেক করুন:

1. **Health Check:**
   ```text
   https://sync2026.pythonanywhere.com/health
   ```
   এখানে `"configured": true` এবং `"mailConfigured": true` দেখাবে।

2. **সরাসরি টেস্ট ইমেইল পাঠানো (`/mail/diag`):**
   ব্রাউজারে এই লিংকটি খুলুন (`<MAIL_RELAY_SECRET>` এবং `<YOUR_EMAIL>`-এর জায়গায় আপনার মান বসান):
   ```text
   https://sync2026.pythonanywhere.com/mail/diag?key=<MAIL_RELAY_SECRET>&to=<YOUR_EMAIL>
   ```
   উদাহরণ:
   `https://sync2026.pythonanywhere.com/mail/diag?key=SyncRelaySecret2026Key9876543210&to=sync93346@gmail.com`

   সব ঠিক থাকলে উত্তরে `"ok": true` এবং `"testMail": "Sent via port 465"` দেখাবে এবং আপনার ইনবক্সে একটি টেস্ট ইমেইল চলে আসবে!

---

## ৬. ধাপ ৪ — GitHub Push ও Render-এ Environment Variable সেটআপ

1. **GitHub-এ কোড Push করুন:**
   এই ZIP ফাইলের আপডেট করা প্রজেক্টটি আপনার GitHub রিপোজিটরিতে push করুন (যাতে নতুন `RegisterPage.jsx`, `authSlice.js`, `auth-shell.css` ও ব্যাকএন্ডের ফাইলগুলো Render-এ চলে যায়)।
2. **Render Dashboard-এ Environment Variable যোগ করুন:**
   - [Render Dashboard](https://dashboard.render.com)-এ আপনার **sync** সার্ভিসে যান → বাঁদিকে **Environment** ট্যাবে ক্লিক করুন।
   - নিচের ভ্যারিয়েবল দুটি যোগ/আপডেট করুন:

| Key | Value |
| :--- | :--- |
| `PYTHON_SERVICE_URL` | `https://sync2026.pythonanywhere.com` *(শেষে `/` দেবেন না)* |
| `MAIL_RELAY_SECRET` | `config.py`-তে যে `MAIL_RELAY_SECRET` দিয়েছেন **হুবহু সেটি** |

3. **Save Changes** চাপুন। Render নিজে থেকে নতুন ফ্রন্টএন্ড বিল্ড করে সার্ভার চালু করবে।
4. ডিপ্লয় শেষ হলে ব্রাউজারে `https://sync-5lfm.onrender.com/health` খুললে `"mailRelayConfigured": true` দেখতে পাবেন।

---

## ৭. সাধারণ সমস্যা ও দ্রুত সমাধান (Troubleshooting)

| সমস্যা / এরর মেসেজ | কারণ | সমাধান |
| :--- | :--- | :--- |
| `/health`-এ `"mailConfigured": false` | PythonAnywhere-এর `config.py`-তে `GMAIL_USER`, `GMAIL_APP_PASSWORD` বা `MAIL_RELAY_SECRET` ঠিকমতো বসেনি বা ২৪ অক্ষরের কম। | `cd ~/mysite && python verify_install.py` চালিয়ে দেখুন কোনটা ভুল দেখাচ্ছে, ঠিক করে Web ট্যাবে **Reload** দিন। |
| `/mail/diag`-এ `FAIL gmail_auth_failed` | সাধারণ Gmail পাসওয়ার্ড দেওয়া হয়েছে অথবা App Password ভুল। | Google Account → Security → 2-Step Verification চালু করে নতুন ১৬-অক্ষরের **App Password** বানিয়ে `config.py`-তে বসান ও **Reload** দিন। |
| রেজিস্টার করার সময় `We could not send the verification email right now (503)` | Render-এ `PYTHON_SERVICE_URL` বা `MAIL_RELAY_SECRET` সেট করা নেই, অথবা দুপাশে `MAIL_RELAY_SECRET` মেলেনি। | `https://sync-5lfm.onrender.com/health` খুলে দেখুন `mailRelayConfigured: true` কিনা এবং দুই জায়গায় `MAIL_RELAY_SECRET` হুবহু এক কিনা মিলিয়ে নিন। |
| রেজিস্টার পেজে কোড পাঠানোর ফর্ম আসছে কিন্তু OTP বক্স আসছে না | ব্রাউজারে পুরনো ক্যাশ বা গিটহাবে নতুন `frontend/` ফাইলগুলো push হয়নি। | আপডেট করা `frontend/` ফোল্ডারসহ GitHub-এ push করুন যাতে Render আবার `npm run build` চালায়, এবং ব্রাউজার হার্ড-রিফ্রেশ করুন। |
