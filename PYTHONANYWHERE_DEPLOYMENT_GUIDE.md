# PythonAnywhere-এ Sync Media Service চালু করার সম্পূর্ণ গাইড (শুরু থেকে শেষ)

এই গাইডটি এমন একজনের জন্য লেখা, যে আগে কখনো PythonAnywhere-এ আলাদা Flask সার্ভিস চালু করেনি।
প্রতিটা ধাপ ধরে ধরে করুন। কোনো ধাপ বাদ দেবেন না।

> **একনজরে কাজের ক্রম**
>
> 1. PythonAnywhere-এ `python-service`-এর ফাইল তুলুন, প্যাকেজ ইনস্টল করুন, `config.py` ভরুন, Web App চালু করুন। (Part C, D)
> 2. `https://<YOUR_PYTHONANYWHERE_USERNAME>.pythonanywhere.com/health` খুলে দেখুন সব ঠিক আছে। (Part C-র শেষে)
> 3. আপডেট করা প্রজেক্ট GitHub-এ push করুন আর Render-এ `PYTHON_SERVICE_URL` বসান। (Part E)
> 4. ছবি, ভিডিও, ভয়েস আপলোড টেস্ট করুন। (Part F)
>
> কিছু ভুল হলে Part G (সমস্যা সমাধান) দেখুন।

**কিছু শব্দের মানে (শুরুতেই জেনে নিন):**

| শব্দ | সহজ মানে |
| --- | --- |
| **Console / Bash console** | PythonAnywhere-এর ভেতরের কালো কমান্ড-স্ক্রিন। এখানে কমান্ড লিখে Enter চাপতে হয়। |
| **Virtualenv** | এই প্রজেক্টের জন্য আলাদা একটা "প্যাকেজের বাক্স", যাতে অন্য কিছুর সাথে গোলমাল না হয়। |
| **WSGI ফাইল** | PythonAnywhere-কে বলে দেয় আপনার Flask অ্যাপ কোথায় আছে। |
| **Reload** | কোড বা কনফিগ বদলালে অ্যাপটাকে নতুন করে চালু করা। এটা না করলে পুরনো কোডই চলতে থাকে। |
| **JWT / access token** | লগইন করা ইউজারের "পরিচয়পত্র"। Node ব্যাকএন্ড এটা বানায়, Python সার্ভিস শুধু যাচাই করে। |
| **Signature** | Cloudinary-র জন্য একটা "অনুমতি-সিল"। এটা থাকলেই Cloudinary ফাইল নেয়। |

---

## Part A — পুরো ব্যবস্থাটা কীভাবে কাজ করে

### কেন PythonAnywhere লাগছে?

ছবি, ভিডিও, ভয়েস Cloudinary-তে রাখা হয়। Cloudinary-তে ফাইল তুলতে একটা **signature** (অনুমতি-সিল) লাগে,
আর সেই সিল বানাতে Cloudinary-র **API Secret** (গোপন চাবি) লাগে।
এই গোপন চাবি কখনো ব্রাউজারে (React) পাঠানো যায় না, কারণ যে কেউ সেটা দেখে ফেলতে পারবে।
তাই একটা ছোট আলাদা সার্ভার দরকার, যেটা চাবিটা নিজের কাছে লুকিয়ে রেখে শুধু সিল বানিয়ে দেবে। সেই সার্ভারই **Sync Media Service**, আর সেটা চলবে PythonAnywhere-এ।

### কে কী করবে

| সার্ভিস | কাজ |
| --- | --- |
| **Render** (আগের মতোই) | ওয়েবসাইট (React) দেখানো, লগইন, চ্যাট, গল্প (stories), MongoDB-তে তথ্য রাখা। এটা বদলাচ্ছে না। |
| **PythonAnywhere** (নতুন) | শুধু একটা কাজ: লগইন করা ইউজারকে Cloudinary-র signature বানিয়ে দেওয়া। কোনো ছবি/ভিডিও এখানে আসে না, জমাও থাকে না। |
| **Cloudinary** | আসল ছবি, ভিডিও, ভয়েস ফাইল জমা রাখা। ব্রাউজার সরাসরি এখানে ফাইল পাঠায়। |
| **MongoDB Atlas** | শুধু ফাইলের ঠিকানা (URL) আর ছোট তথ্য জমা রাখে, ফাইল নয়। |

### ছবি আপলোডের সময় কী ঘটে

```
 ┌─────────────┐  ১. "আপলোড করব, সিল দিন" (সাথে লগইন-টোকেন)   ┌──────────────────────┐
 │             │ ───────────────────────────────────────────▶ │   PythonAnywhere     │
 │  ব্রাউজার   │                                              │  (Sync Media Service)│
 │ (আপনার ফোন/ │ ◀─────────────────────────────────────────── │  টোকেন যাচাই করে     │
 │  কম্পিউটার) │  ২. signature (সিল) ফেরত                     │  সিল বানায়          │
 │             │                                              └──────────────────────┘
 │             │  ৩. ফাইল + সিল সরাসরি পাঠায়                  ┌──────────────────────┐
 │             │ ───────────────────────────────────────────▶ │     Cloudinary       │
 │             │ ◀─────────────────────────────────────────── │   ফাইল জমা রাখে      │
 │             │  ৪. ফাইলের ঠিকানা (secure URL) ফেরত           └──────────────────────┘
 │             │
 │             │  ৫. শুধু ঠিকানা আর ছোট তথ্য পাঠায়             ┌──────────────────────┐
 │             │ ───────────────────────────────────────────▶ │  Render (Node.js)    │ ──▶ MongoDB Atlas
 └─────────────┘                                              │  ঠিকানা যাচাই করে    │
                                                              └──────────────────────┘
```

মনে রাখার মতো তিনটা কথা:

1. **ফাইল কখনো PythonAnywhere দিয়ে যায় না।** তাই ফ্রি প্ল্যানের সীমা নিয়ে চিন্তা কম।
2. PythonAnywhere নিজে বাইরের কোনো সাইটকে ডাকে না (ফ্রি প্ল্যানে এটা সীমিত থাকে), শুধু ব্রাউজারের ডাক গ্রহণ করে।
3. **JWT_SECRET** Render আর PythonAnywhere দুই জায়গায় **হুবহু এক** হতে হবে, না হলে Python সার্ভিস লগইন-টোকেন চিনতে পারবে না।

---

## Part B — কোন ফাইল আপলোড করতে হবে

### সংক্ষেপে উত্তর

| প্রশ্ন | উত্তর |
| --- | --- |
| পুরো Sync ZIP কি PythonAnywhere-এ তুলতে হবে? | **না।** একদম না। |
| শুধু `python-service/` ফোল্ডারই কি যথেষ্ট? | **হ্যাঁ।** শুধু এর ভেতরের ফাইলগুলো লাগবে। |
| Frontend (React) বা Node ফোল্ডার তুলতে হবে? | **না।** ওগুলো Render-এই থাকবে। |
| `config.py` কি নিজে বানাতে হবে? | **হ্যাঁ।** `config.example.py` কপি করে PythonAnywhere-এ বসেই বানাবেন। |

### PythonAnywhere-এ যে ফাইলগুলো যাবে

আলাদা একটা ফোল্ডারে (`sync-media-service`) এগুলো রাখবেন:

```
sync-media-service/
├── app.py
├── settings.py
├── config.example.py          ← এটা কপি করে config.py বানাবেন
├── requirements.txt
├── verify_install.py          ← নিজে নিজে চেক করার ছোট স্ক্রিপ্ট
├── pythonanywhere_wsgi.py     ← (শুধু কপি করার জন্য, Part C ধাপ ১৫-তে লাগবে)
├── routes/
│   ├── __init__.py
│   ├── health.py
│   └── media.py
├── services/
│   ├── __init__.py
│   └── cloudinary_service.py
└── utils/
    ├── __init__.py
    ├── jwt_utils.py
    ├── security.py
    └── responses.py
```

`tests/` ফোল্ডার, `README.md` আর `.gitignore` তোলা না তুললে কিছু আসে যায় না।

### সবচেয়ে সহজ উপায়: একটা ZIP আপলোড

আপনাকে `sync-media-service-upload.zip` নামে আলাদা একটা ছোট ZIP দেওয়া হয়েছে। এতে উপরের সব ফাইল আগে থেকেই সাজানো আছে (প্রজেক্ট ZIP-এর `python-service/` ফোল্ডারেরই কাজের অংশ)।
এটা একবার আপলোড করে `unzip` কমান্ড দিলেই সব ফাইল জায়গামতো বসে যাবে। (Part C-তে দেখানো আছে।)

### কোন ফাইল গোপন রাখবেন

| ফাইল | অবস্থা |
| --- | --- |
| `config.py` | 🔒 **সবচেয়ে গোপন।** এতে আসল চাবি থাকে। কখনো GitHub-এ, ZIP-এ, স্ক্রিনশটে বা কাউকে পাঠানোর ফাইলে দেবেন না। এটা শুধু PythonAnywhere-এ থাকবে। `.gitignore`-এ আগে থেকেই লেখা আছে, তাই Git ভুল করে তুলবে না। |
| `config.example.py` | ✅ নিরাপদ। এতে শুধু ফাঁকা ঘর আছে। GitHub-এ থাকতে পারে। |
| বাকি সব `.py` ফাইল | ✅ নিরাপদ, কোনো চাবি নেই। |

> ⚠️ কখনো `JWT_SECRET` বা `CLOUDINARY_API_SECRET` কোনো React ফাইলে, `VITE_...` ভ্যারিয়েবলে বা GitHub-এ লিখবেন না।
> ভুল করে কোথাও প্রকাশ হয়ে গেলে Cloudinary ড্যাশবোর্ডে গিয়ে নতুন API Secret বানান আর `config.py` বদলে Reload দিন।

---

## Part C — PythonAnywhere-এ ধাপে ধাপে সেটআপ

নিচে `<YOUR_PYTHONANYWHERE_USERNAME>` লেখা জায়গায় আপনার PythonAnywhere ইউজারনেম বসাবেন (ছোট হাতের অক্ষরে, ফাঁকা ছাড়া, `<` `>` চিহ্ন বাদ দিয়ে)।
উদাহরণ: ইউজারনেম `rahim123` হলে `/home/<YOUR_PYTHONANYWHERE_USERNAME>/sync-media-service` হবে `/home/rahim123/sync-media-service`।

### ধাপ ১ — লগইন

`https://www.pythonanywhere.com` খুলে **Log in** চাপুন, ইউজারনেম ও পাসওয়ার্ড দিন।

### ধাপ ২ — Dashboard

লগইনের পর যে পাতা আসে সেটাই **Dashboard**। উপরে ডানদিকে কয়েকটা ট্যাব দেখবেন: **Dashboard, Consoles, Files, Web, Tasks, Databases**। আমরা Files, Consoles আর Web ব্যবহার করব।

### ধাপ ৩ — Files ট্যাবে যান

উপরের **Files** ট্যাবে ক্লিক করুন। বাঁদিকে `/home/<YOUR_PYTHONANYWHERE_USERNAME>` ফোল্ডার খোলা থাকবে।

### ধাপ ৪ — Media Service-এর ফোল্ডার বানান

1. "**Enter new directory name**" লেখা ঘরে লিখুন: `sync-media-service`
2. পাশের **New directory** বাটন চাপুন।
3. নতুন তৈরি `sync-media-service` লেখায় ক্লিক করে ফোল্ডারটার ভেতরে ঢুকুন।
   উপরে পথ দেখাবে: `/home/<YOUR_PYTHONANYWHERE_USERNAME>/sync-media-service`

### ধাপ ৫ — ফাইল আপলোড করুন

**সহজ উপায় (প্রস্তাবিত):**

1. ফোল্ডারের ভেতরে থেকে ডানদিকের **Upload a file** বাটন চাপুন।
2. আপনার কম্পিউটার থেকে `sync-media-service-upload.zip` বেছে নিন। আপলোড শেষ হলে ফাইলের তালিকায় ZIP-টা দেখা যাবে।
3. ধাপ ৬-এ কনসোল খুলে ZIP খুলে ফেলবেন (নিচে)।

**বিকল্প উপায় (ZIP না থাকলে):** Part B-র তালিকার প্রতিটা ফাইল একে একে আপলোড করুন।
PythonAnywhere একসাথে পুরো ফোল্ডার আপলোড করতে দেয় না, তাই `routes`, `services`, `utils` নামে তিনটা সাব-ফোল্ডার আগে "New directory" দিয়ে বানিয়ে ওই ফোল্ডারের ভেতরে ঢুকে সংশ্লিষ্ট ফাইলগুলো আপলোড করুন।
(ZIP পদ্ধতি অনেক সহজ, সম্ভব হলে সেটাই করুন।)

### ধাপ ৬ — Bash console খুলুন

1. উপরের **Consoles** ট্যাবে যান।
2. "Start a new console" অংশে **Bash** চাপুন।
3. একটা কালো স্ক্রিন আসবে, শেষে `$` চিহ্ন থাকবে। এখানে কমান্ড লিখে **Enter** চাপবেন।

> কমান্ড কপি করে পেস্ট করাই সবচেয়ে নিরাপদ। প্রতিটা কমান্ড আলাদাভাবে চালান, আর একটা শেষ না হওয়া পর্যন্ত অপেক্ষা করুন।

**প্রথমে ZIP খুলুন** (ধাপ ৫-এ সহজ উপায় নিলে):

```bash
cd ~/sync-media-service && unzip -o sync-media-service-upload.zip && rm sync-media-service-upload.zip && ls
```

এই কমান্ড কী করে:
- `cd ~/sync-media-service` → আপনার তৈরি ফোল্ডারে ঢোকে।
- `unzip -o sync-media-service-upload.zip` → ZIP খুলে ফাইলগুলো বের করে (`-o` মানে একই নামের ফাইল থাকলে বদলে দাও)।
- `rm sync-media-service-upload.zip` → খোলা হয়ে গেছে, তাই ZIP-টা মুছে ফেলে।
- `ls` → ফোল্ডারে কী কী আছে তার তালিকা দেখায়।

শেষে তালিকায় `app.py`, `settings.py`, `routes`, `services`, `utils`, `requirements.txt` ইত্যাদি দেখলে ঠিক আছে।

### ধাপ ৭ — Virtualenv বানান (প্যাকেজের আলাদা বাক্স)

আগে ধাপ ১৩-র জন্য একটা কথা: Web ট্যাবে আপনি যে **Python ভার্সন** বেছে নেবেন (ধাপ ১২), virtualenv-ও সেই একই ভার্সনে বানাতে হবে। এই গাইডে **Python 3.10** ধরা হয়েছে।
আপনার অ্যাকাউন্টে কোন ভার্সন আছে দেখতে চাইলে:

```bash
ls /usr/bin/python3*
```

`python3.10` দেখা গেলে নিচের কমান্ড যেমন আছে তেমনই চালান। না থাকলে (যেমন শুধু `python3.11` বা `python3.12` আছে) কমান্ডের `3.10` বদলে ওই ভার্সন লিখুন, আর ধাপ ১২-তেও সেই ভার্সনই বেছে নিন।

```bash
mkvirtualenv --python=/usr/bin/python3.10 sync-media-env
```

কী করে: `sync-media-env` নামে একটা আলাদা প্যাকেজ-বাক্স বানায় এবং সেটা চালু করে দেয়।
সফল হলে লাইনের শুরুতে `(sync-media-env)` লেখা দেখা যাবে। এটা দেখা গেলে বুঝবেন বাক্সটা এখন চালু আছে।

### ধাপ ৮ — প্যাকেজ ইনস্টল করুন

```bash
cd ~/sync-media-service
pip install -r requirements.txt
```

কী করে: `requirements.txt` ফাইলে যে প্যাকেজগুলোর (Flask, PyJWT, cloudinary) নাম লেখা আছে, সেগুলো নামিয়ে ইনস্টল করে।
কয়েক মিনিট লাগতে পারে। শেষে `Successfully installed ...` লেখা আসবে। লাল রঙে `ERROR` এলে Part G-র "Missing dependencies" দেখুন।

> এখন যদি কখনো কনসোল বন্ধ করে নতুন করে খোলেন, তাহলে `(sync-media-env)` আর দেখা যাবে না।
> তখন আবার চালু করতে লিখুন: `workon sync-media-env`

### ধাপ ৯ — `config.py` বানান আর Flask অ্যাপের চাবিগুলো বসান

এটাই সবচেয়ে গুরুত্বপূর্ণ ধাপ। বিস্তারিত **Part D**-তে আছে। এখনই Part D-র ধাপগুলো সেরে এসে এখানে ফিরে আসুন।

### ধাপ ১০ — নিজে নিজে চেক করুন

Part D শেষ হলে কনসোলে লিখুন:

```bash
cd ~/sync-media-service
python verify_install.py
```

এটা কিছু `OK` আর `PROBLEM` লাইন দেখাবে (কোনো গোপন চাবি প্রিন্ট করে না)।
শেষে `RESULT: everything looks good` দেখলে ঠিক আছে। `PROBLEM` এলে লেখাটা পড়ে ঠিক করে আবার চালান।

### ধাপ ১১ — Web ট্যাবে যান এবং নতুন Web App বানান

1. উপরের **Web** ট্যাবে ক্লিক করুন।
2. **Add a new web app** বাটন চাপুন।
3. ফ্রি অ্যাকাউন্টে ডোমেইন ঠিক করাই থাকে: `<YOUR_PYTHONANYWHERE_USERNAME>.pythonanywhere.com`। **Next** চাপুন।

### ধাপ ১২ — Manual configuration আর Python ভার্সন

1. "Select a Python Web framework" পাতায় **Manual configuration (including virtualenvs)** বেছে নিন। 
   ⚠️ **Flask** লেখা অপশন বেছে নেবেন না, কারণ ওটা নিজের একটা নমুনা অ্যাপ বানিয়ে ফেলে।
2. পরের পাতায় **Python 3.10** (অথবা ধাপ ৭-এ আপনি যে ভার্সন ব্যবহার করেছেন) বেছে **Next** চাপুন।
3. শেষ পাতায় **Next** দিয়ে শেষ করুন। এখন আপনি Web ট্যাবের কনফিগ পাতায় থাকবেন।

### ধাপ ১৩ — Virtualenv-এর পথ বসান

পাতায় নিচে নামলে **Virtualenv** নামে একটা অংশ পাবেন:

1. "**Enter path to a virtualenv, if desired**" লেখায় ক্লিক করুন।
2. এই পথটা লিখে ✔ (টিক) চিহ্নে ক্লিক করুন:

```
/home/<YOUR_PYTHONANYWHERE_USERNAME>/.virtualenvs/sync-media-env
```

### ধাপ ১৪ — Source code ফোল্ডার ঠিক করুন

একই পাতায় **Code** অংশে:

1. **Source code** → ক্লিক করে এই পথ দিন: `/home/<YOUR_PYTHONANYWHERE_USERNAME>/sync-media-service`
2. **Working directory** → একই পথ দিন: `/home/<YOUR_PYTHONANYWHERE_USERNAME>/sync-media-service`

এতে অ্যাপ বুঝবে তার ফাইলগুলো কোথায়।

### ধাপ ১৫ — WSGI ফাইল সম্পাদনা করুন

**Code** অংশেই "**WSGI configuration file**" লেখার পাশে একটা লিংক আছে, যেমন `/var/www/<YOUR_PYTHONANYWHERE_USERNAME>_pythonanywhere_com_wsgi.py`।

1. ওই লিংকে ক্লিক করুন। এডিটর খুলবে।
2. ভেতরে আগে থেকে যা লেখা আছে সবটুকু **মুছে ফেলুন** (Ctrl+A, তারপর Delete)।
3. নিচের কোডটুকু হুবহু পেস্ট করুন, আর শুধু ইউজারনেম বদলান:

```python
import sys

# আপনার Media Service ফোল্ডারের পথ (শুধু ইউজারনেম বদলান)
PROJECT_HOME = "/home/<YOUR_PYTHONANYWHERE_USERNAME>/sync-media-service"

if PROJECT_HOME not in sys.path:
    sys.path.insert(0, PROJECT_HOME)

# PythonAnywhere "application" নামের ভ্যারিয়েবল খোঁজে
from app import app as application
```

4. উপরে ডানদিকের সবুজ **Save** বাটন চাপুন।

> `<` আর `>` চিহ্ন সরিয়ে দিতে ভুলবেন না। শেষ ফল এমন হবে: `"/home/rahim123/sync-media-service"`।

### ধাপ ১৬ — অ্যাপের সাথে WSGI যুক্ত হয়েছে কিনা

ধাপ ১৪ ও ১৫ ঠিকভাবে করলেই WSGI ফাইল আপনার Flask অ্যাপের (`app.py`-এর `app`) সাথে যুক্ত হয়ে যায়। আলাদা কিছু করতে হবে না।
Web ট্যাবে ফিরে গিয়ে ওপরের **Code** অংশে তিনটা পথই ঠিক আছে কিনা আবার দেখে নিন।

**HTTPS চালু করুন:** একই পাতায় নিচের দিকে **Security** অংশে "**Force HTTPS**" টগলটা **Enabled** করুন।

### ধাপ ১৭ — Reload

পাতার উপরের দিকে বড় সবুজ বাটন: **Reload <YOUR_PYTHONANYWHERE_USERNAME>.pythonanywhere.com**। এটা চাপুন।
কয়েক সেকেন্ড অপেক্ষা করুন।

### ✅ প্রথম পরীক্ষা

ব্রাউজারে নতুন ট্যাবে খুলুন:

```
https://<YOUR_PYTHONANYWHERE_USERNAME>.pythonanywhere.com/health
```

এমন কিছু দেখলে সফল:

```json
{"configured": true, "ok": true, "service": "sync-media-service", "status": "ok", "timestamp": "2026-...", "version": "1.0.0"}
```

- `"configured": true` → `config.py` ঠিকঠাক ভরা হয়েছে।
- `"configured": false` → সার্ভিস চলছে, কিন্তু `config.py`-তে কিছু অনুপস্থিত বা ভুল। Part D আবার দেখুন, তারপর `python verify_install.py` চালান।
- লাল Error পাতা বা "Something went wrong" → Part G দেখুন।

> **ফ্রি প্ল্যানের একটা নিয়ম:** PythonAnywhere ফ্রি অ্যাকাউন্টের Web App কিছুদিন পর পর নিজে বন্ধ হয়ে যেতে পারে, যদি না আপনি মেয়াদ বাড়ান।
> Web ট্যাবে "**Run until ... from today**" ধরনের একটা বাটন থাকে, সেটাতে ক্লিক করলেই মেয়াদ বাড়ে। PythonAnywhere সাধারণত ইমেইলেও মনে করিয়ে দেয়।
> বাটনের নাম বা সময় PythonAnywhere বদলাতে পারে, তাই Web ট্যাবে যা লেখা আছে সেটাই মানুন। এটা ভুলে গেলে ছবি/ভিডিও আপলোড হঠাৎ বন্ধ হয়ে যাবে।

---

## Part D — গোপন চাবি আর কনফিগারেশন

### কোন তথ্য কোথায় বসবে

| নাম | কী | কোথায় থেকে পাবেন | কোথায় বসবে |
| --- | --- | --- | --- |
| `JWT_SECRET` | লগইন-টোকেনের গোপন চাবি | **Render** → আপনার সার্ভিস → **Environment** → `JWT_SECRET` | PythonAnywhere `config.py` **এবং** Render (দুই জায়গায় **হুবহু এক**) |
| `CLOUDINARY_CLOUD_NAME` | আপনার Cloudinary অ্যাকাউন্টের নাম | Cloudinary → Dashboard | `config.py` **এবং** Render (দুই জায়গায় এক) |
| `CLOUDINARY_API_KEY` | Cloudinary-র পাবলিক চাবি | Cloudinary → Settings → **API Keys** | শুধু `config.py` |
| `CLOUDINARY_API_SECRET` | Cloudinary-র **গোপন** চাবি | Cloudinary → Settings → **API Keys** (Secret দেখতে চোখের আইকনে ক্লিক) | শুধু `config.py` (**আর কোথাও নয়**) |
| `ALLOWED_ORIGINS` | কোন ওয়েবসাইট এই সার্ভিস ডাকতে পারবে | নিচে দেখুন | শুধু `config.py` |

কোন মান কোথায় মিলতে হবে, এক নজরে:

| মান | Render | PythonAnywhere `config.py` | React / GitHub |
| --- | :---: | :---: | :---: |
| `JWT_SECRET` | ✅ আছে | ✅ **একই মান** | ❌ কখনো না |
| `CLOUDINARY_CLOUD_NAME` | ✅ আছে | ✅ **একই মান** | ❌ দরকার নেই |
| `CLOUDINARY_API_KEY` | ❌ লাগে না | ✅ | ❌ |
| `CLOUDINARY_API_SECRET` | ❌ লাগে না | ✅ | ❌ কখনো না |
| `ALLOWED_ORIGINS` | ❌ লাগে না | ✅ | ❌ |
| `PYTHON_SERVICE_URL` | ✅ (Part E) | ❌ | ❌ |

### `config.py` বানানোর ধাপ

**ধাপ ১ — কপি করুন।** Bash console-এ:

```bash
cd ~/sync-media-service
cp config.example.py config.py
chmod 600 config.py
```

কী করে:
- `cp config.example.py config.py` → টেমপ্লেটের একটা কপি বানায়, নাম `config.py`।
- `chmod 600 config.py` → ফাইলটা শুধু আপনিই পড়তে পারবেন, এমন নিয়ম বেঁধে দেয়।

**ধাপ ২ — ফাইলটা খুলুন।** **Files** ট্যাবে `sync-media-service` ফোল্ডারে গিয়ে `config.py` নামের ফাইলে ক্লিক করুন। এডিটর খুলবে।

**ধাপ ৩ — ঘরগুলো ভরুন।** কোটেশন (`" "`) চিহ্নের **ভেতরে** মান বসান। কোটেশন মুছবেন না, ফাঁকা (space) রাখবেন না:

```python
JWT_SECRET = "এখানে Render-এর JWT_SECRET হুবহু বসান"

CLOUDINARY_CLOUD_NAME = "আপনার-cloud-name"
CLOUDINARY_API_KEY = "আপনার-api-key (শুধু সংখ্যা)"
CLOUDINARY_API_SECRET = "আপনার-api-secret"

ALLOWED_ORIGINS = "https://sync-5lfm.onrender.com"
```

কয়েকটা সতর্কতা:
- মান কপি করার সময় শুরুতে বা শেষে ফাঁকা জায়গা (space) বা নতুন লাইন চলে এলে সমস্যা হতে পারে। সার্ভিস নিজে এগুলো ছেঁটে নেয়, তবুও সাবধানে কপি করুন।
- `JWT_SECRET`-এর এক অক্ষর আলাদা হলেও সব টোকেন অচল হবে (Part G দেখুন)।
- Render-এ `JWT_SECRET` কী আছে মনে না থাকলে: Render Dashboard → আপনার সার্ভিস → **Environment** → `JWT_SECRET`-এর মান দেখান/কপি করুন। এটা **বদলাবেন না**, নাহলে সবাই লগআউট হয়ে যাবে। শুধু কপি করে `config.py`-তে বসান।

**ধাপ ৪ — সেভ করুন।** এডিটরের উপরের **Save** বাটন চাপুন।

**ধাপ ৫ — চেক করুন।** Bash console-এ:

```bash
python verify_install.py
```

`configuration is complete` লাইন দেখলে `config.py` ঠিক আছে। এরপর Web ট্যাবে **Reload** দিন।

### `ALLOWED_ORIGINS` নিয়ে

- শুধু Render-এর সাইট থেকে ব্যবহার হলে (এটাই দরকার): `"https://sync-5lfm.onrender.com"` (শেষে `/` দেবেন না)।
- নিজের কম্পিউটারে টেস্ট করতে চাইলে কমা দিয়ে যোগ করুন: `"https://sync-5lfm.onrender.com,http://localhost:5173"`।
- `*` (সবাইকে অনুমতি) **দেবেন না**। এটা কাজ করবেও না, সার্ভিস নিজেই এটা বাতিল করে।
- সাইটের ঠিকানা বদলালে এখানেও বদলাতে হবে।

### সার্ভিস নিজে থেকে যা সামলায় (আপনাকে কিছু করতে হবে না)

- ভুল বা মেয়াদ-শেষ টোকেনে 401 দেয়।
- রিফ্রেশ-টোকেন দিয়ে ঢুকতে দেয় না।
- অন্য ওয়েবসাইট থেকে ডাকলে 403 দেয়।
- কিছু বেশি ঘন ঘন চাইলে 429 দেয়।
- `config.py` অসম্পূর্ণ থাকলে ভুল সিল না বানিয়ে 503 দেয়।

---

## Part E — PythonAnywhere-কে Render-এর সাথে যুক্ত করা

### ধাপ ১ — PythonAnywhere-এর পাবলিক URL

আপনার Media Service-এর ঠিকানা:

```
https://<YOUR_PYTHONANYWHERE_USERNAME>.pythonanywhere.com
```

(Web ট্যাবের একদম উপরেও ঠিকানাটা লেখা থাকে।) শেষে `/` বা `/health` যোগ করবেন না। ব্রাউজারে `.../health` খুলে আগে নিশ্চিত হয়ে নিন সেটা `"ok"` দেখাচ্ছে।

### ধাপ ২ — আপডেট করা প্রজেক্ট GitHub-এ তুলুন

এই আপডেটে কিছু ছোট বদল আছে `frontend/` আর `node-backend/`-এ, আর `render.yaml`-এ। Render-এ এগুলো পৌঁছাতে হলে আপডেট করা প্রজেক্ট আপনার GitHub রিপোজিটরিতে push করতে হবে। Render নিজে থেকে সেটা দেখে নতুন করে বানাবে (`autoDeploy` চালু আছে)।

> **সতর্কতা:** `python-service/config.py` কখনো GitHub-এ যাবে না। PythonAnywhere-এ এটা আপনি নিজে বানিয়েছেন, আর আপনার কম্পিউটারের প্রজেক্টে এই ফাইল নেই, ফলে ভুল হওয়ার সুযোগ নেই। তবু push-এর আগে একবার দেখে নিন GitHub-এ `config.py` নামে কোনো ফাইল নেই।

### ধাপ ৩ — Render-এ `PYTHON_SERVICE_URL` বসান

1. `https://dashboard.render.com` খুলে লগইন করুন।
2. আপনার সার্ভিস **sync**-এ ক্লিক করুন।
3. বাঁদিকের মেনু থেকে **Environment** বেছে নিন।
4. **Add Environment Variable** চাপুন।
5. Key: `PYTHON_SERVICE_URL`  
   Value: `https://<YOUR_PYTHONANYWHERE_USERNAME>.pythonanywhere.com`
6. **Save Changes** (বা **Save, rebuild, and deploy**) চাপুন।

আরও দেখে নিন Render-এ এই দুটো আগে থেকেই আছে:
- `JWT_SECRET` → এটা PythonAnywhere-এ যা দিয়েছেন তার সাথে হুবহু এক।
- `CLOUDINARY_CLOUD_NAME` → আপনার Cloudinary cloud name, হুবহু এক। **এটা না থাকলে এখন থেকে Node সার্ভার আপলোড-করা সব ছবি/ভিডিওর ঠিকানা বাতিল করে দেবে** (নিরাপত্তার কারণে, Part G দেখুন)।

### `VITE_PYTHON_SERVICE_URL` কি লাগবে?

**না, লাগবে না।** ফ্রন্টএন্ড সাইট চালু হওয়ার সময় Render-এর `/health` থেকে `PYTHON_SERVICE_URL` নিজেই জেনে নেয়, তাই আলাদা ভ্যারিয়েবল লাগে না।
শুধু `PYTHON_SERVICE_URL` একবার Render-এ বসালেই চলবে। একই জিনিস দুই জায়গায় বসাবেন না।

### `SERVICE_KEY` কি লাগবে?

**না।** কোড খুঁজে দেখা গেছে, Node ব্যাকএন্ড বা Python সার্ভিস কোথাও `SERVICE_KEY` পড়ে না (পুরনো পরিকল্পনায় ভবিষ্যতের `/scan` ফিচারের জন্য ছিল)।
তাই এটা কোথাও বসাতে হবে না। আমরা `render.yaml` আর `.env.example` থেকে এটা সরিয়ে দিয়েছি, যাতে Render আপনাকে অকারণে এর মান জিজ্ঞেস না করে।

### Render কখন নতুন করে চালু (redeploy) হবে

- ধাপ ২-এ GitHub push করলে → Render নিজে নতুন বিল্ড শুরু করে।
- ধাপ ৩-এ Environment বদলে Save করলে → Render নিজে নতুন করে চালু করে।
- দুটোই এক ধাপে সামলাতে চাইলে আগে GitHub push করুন, তারপর Environment-এ `PYTHON_SERVICE_URL` বসিয়ে Save করুন।
- Render-এর Logs-এ `Your service is live` লেখা এলে (সাধারণত কয়েক মিনিট) ব্যবহারের জন্য প্রস্তুত। Render-এর ফ্রি প্ল্যানে অনেকক্ষণ ব্যবহার না হলে সাইট ঘুমিয়ে যায়, প্রথম খোলায় একটু সময় লাগতে পারে। এটা স্বাভাবিক।

### সঠিক জোড়া লেগেছে কিনা দেখুন

ব্রাউজারে খুলুন: `https://sync-5lfm.onrender.com/health`

ফলাফলে থাকা উচিত:

```json
"pythonServiceUrl": "https://<YOUR_PYTHONANYWHERE_USERNAME>.pythonanywhere.com",
"cloudinaryCloudName": "আপনার-cloud-name"
```

দুটো ফাঁকা বা ভুল দেখালে Render Environment-এর মান ঠিক করুন।

---

## Part F — পরীক্ষা (Testing)

আগে Part E সম্পূর্ণ করুন, আর Sync সাইটে নিজের অ্যাকাউন্টে লগইন করে নিন।

### ১. `/health`

ব্রাউজারে `https://<YOUR_PYTHONANYWHERE_USERNAME>.pythonanywhere.com/health` খুলুন।

**সফল ফল:** `"status": "ok"` আর `"configured": true`।

### ব্রাউজার কনসোল দিয়ে নিরাপত্তা-পরীক্ষা (ধাপ ২–৪-এর জন্য)

1. Sync সাইটে (`https://sync-5lfm.onrender.com`) লগইন করা অবস্থায় থাকুন।
2. কিবোর্ডে **F12** চাপুন (মোবাইলে সুবিধা হবে না, কম্পিউটারে করুন) → **Console** ট্যাব।
3. Chrome পেস্ট করতে দিতে না চাইলে আগে লিখুন `allow pasting` আর Enter চাপুন।
4. নিচের কোড পেস্ট করে Enter চাপুন, আর `<YOUR_PYTHONANYWHERE_USERNAME>` বদলে দিন:

```javascript
const PY = "https://<YOUR_PYTHONANYWHERE_USERNAME>.pythonanywhere.com";
const check = async (token, label) => {
  const r = await fetch(PY + "/media/sign", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: "{}",
  });
  console.log(label, "→", r.status, await r.json());
};
```

### ২. ভুল JWT অবশ্যই ফেরত আসবে

```javascript
check("abc.def.ghi", "ভুল টোকেন");
```

**সফল ফল:** `401` আর `"message": "Invalid access token"`।

### ৩. মেয়াদ-শেষ JWT

Node-এর access token ১৫ মিনিট পর অচল হয়। পরীক্ষা করতে:

```javascript
window.oldToken = localStorage.getItem("sync_access_token");
```

এরপর ১৫ মিনিট (একটু বেশি, ১৬ মিনিট ধরুন) অপেক্ষা করে চালান:

```javascript
check(window.oldToken, "মেয়াদ-শেষ টোকেন");
```

**সফল ফল:** `401` আর `"message": "Access token has expired"`।

এর সাথে আরেকটা বাস্তব পরীক্ষা: লগইন করে ১৫ মিনিটের বেশি বসে থেকে একটা ছবি পাঠান। অ্যাপ নিজে টোকেন নবায়ন করে (এই 401-ই এর ইশারা) আর আপলোড সফল হবে। এটাই প্রমাণ করে 401 ঠিক কাজ করছে।

### ৪. রিফ্রেশ-টোকেন গ্রহণ করা হবে না

```javascript
check(localStorage.getItem("sync_refresh_token"), "রিফ্রেশ টোকেন");
```

**সফল ফল:** `401`। (Python সার্ভিস রিফ্রেশ-টোকেন দিয়ে কখনো সিল বানাবে না।)

### ৫. সঠিক JWT দিয়ে signature তৈরি

```javascript
check(localStorage.getItem("sync_access_token"), "সঠিক টোকেন");
```

**সফল ফল:** `200`, আর এমন কিছু:

```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "cloudName": "আপনার-cloud-name",
    "apiKey": "123456789012345",
    "timestamp": 1760000000,
    "folder": "sync/chat",
    "signature": "ab12cd34...",
    "purpose": "chat"
  },
  "message": "Upload signature created"
}
```

লক্ষ্য করুন: কোথাও `api_secret` বা `JWT_SECRET` নেই। থাকলে সঙ্গে সঙ্গে আমাকে/ডেভেলপারকে জানান।

কনসোলে CORS বা "Refused to connect" লিখে এলে Part G-র "CORS" অংশ দেখুন।

### ৬. ছবি আপলোড

1. Sync-এ যেকোনো চ্যাট খুলুন।
2. 📎 (ক্লিপ) আইকন চেপে একটা ছোট ছবি (JPG/PNG) বাছুন।
3. **সফল ফল:** প্রগ্রেস দেখিয়ে ছবিটা চ্যাটে মেসেজ হিসেবে দেখা যায়।
4. Cloudinary → **Media Library** → ফোল্ডার `sync` → `chat`-এ ছবিটা থাকার কথা।

### ৭. ভিডিও আপলোড

আগের মতোই 📎 দিয়ে একটা ছোট ভিডিও (MP4, কয়েক MB) বাছুন। চ্যাটে ভিডিও প্লেয়ার দেখা যাবে, Cloudinary-র `sync/chat`-এ থাকবে।

### ৮. অডিও / ভয়েস মেসেজ

চ্যাটে 🎤 (মাইক) চেপে কয়েক সেকেন্ড রেকর্ড করে পাঠান (ব্রাউজার মাইক্রোফোনের অনুমতি চাইবে, **Allow** দিন)। চ্যাটে ভয়েস মেসেজ বাজবে, ফাইল থাকবে Cloudinary-র `sync/voice` ফোল্ডারে।

### ৯. প্রোফাইল ছবি বদলানো

প্রোফাইল পাতায় গিয়ে ছবি বদলান। নতুন ছবি দেখা গেলে সফল। Cloudinary-তে `sync/avatars`-এ থাকবে।

### ১০. চ্যাট মিডিয়া

ধাপ ৬, ৭, ৮ ই চ্যাট মিডিয়ার পরীক্ষা। অন্য একজন ইউজার (বা অন্য ব্রাউজার) দিয়ে লগইন করে দেখুন সে ছবিটা দেখতে পাচ্ছে কিনা।

### ১১. গল্প (Story) মিডিয়া

**Stories** পাতায় গিয়ে নতুন গল্পে একটা ছবি বা ভিডিও দিন। সফল হলে গল্প প্রকাশিত হবে, Cloudinary-র `sync/stories`-এ ফাইলটা থাকবে।

### (বোনাস) গ্রুপ আইকন

নতুন গ্রুপ বানানোর সময় বা গ্রুপের তথ্য বদলে আইকন দিন। ফাইল `sync/groups`-এ যাবে।

> ⚠️ **ফাইলের আকার:** অ্যাপ সর্বোচ্চ **২৫ MB** পর্যন্ত নেয় (আগের মতোই)। কিন্তু Cloudinary অ্যাকাউন্টেরও নিজস্ব সীমা আছে, বিশেষ করে ফ্রি প্ল্যানে ছবির সীমা ২৫ MB-র চেয়ে ছোট হতে পারে।
> আপনার অ্যাকাউন্টের আসল সীমা Cloudinary-র নিজস্ব ডকুমেন্ট বা Dashboard-এ দেখে নিন। সীমার বেশি হলে Cloudinary নিজেই আপলোড ফেরত দেয়, আর স্ক্রিনে তার কারণ লেখা দেখা যায় (যেমন "File size too large")। এতে আমাদের কোডের কোনো ভুল নেই।

---

## Part G — সমস্যা সমাধান

### আগে দেখুন: PythonAnywhere-এর Error log কীভাবে পড়বেন

1. PythonAnywhere → **Web** ট্যাব।
2. নিচে নামুন, **Log files** অংশ পাবেন।
3. তিনটা লিংক আছে:
   - **Error log** → `...error.log`। **সবচেয়ে কাজের।** এখানে আমাদের অ্যাপের ভুলের বার্তা আসে।
   - **Server log** → অ্যাপ চালু/বন্ধের তথ্য।
   - **Access log** → কে কোন ঠিকানা ডাকল।
4. **Error log**-এ ক্লিক করুন, একদম **নিচের** লাইনগুলো পড়ুন (সবচেয়ে নতুন)। "Reload"-এর পর নতুন লাইন যোগ হয়।

আমাদের সার্ভিস `Configuration problem: ... is missing` এর মতো পরিষ্কার লাইন লেখে। কোনো গোপন চাবির মান কখনো লেখে না।

### সমস্যার তালিকা

| লক্ষণ | সম্ভাব্য কারণ | কী করবেন |
| --- | --- | --- |
| **404** (`Not found`) | ঠিকানাটা ভুল। যেমন `/media/sign`-এর জায়গায় `/media/sing`, অথবা URL-এ অতিরিক্ত পথ। | URL মিলিয়ে নিন। `.../health` খুলে দেখুন। Render-এর `PYTHON_SERVICE_URL`-এ শেষে `/health` বা অন্য পথ থাকলে মুছুন। |
| **401** | টোকেন নেই, ভুল, মেয়াদ-শেষ বা রিফ্রেশ-টোকেন। | সাধারণত স্বাভাবিক (অ্যাপ নিজে নবায়ন করে)। বারবার ঘটলে নিচে "ভুল JWT secret" দেখুন। |
| **403** (`Origin not allowed`) | যে সাইট থেকে ডাকা হচ্ছে সেটা `ALLOWED_ORIGINS`-এ নেই। | `config.py`-তে `ALLOWED_ORIGINS` ঠিক করুন (`https://sync-5lfm.onrender.com`, শেষে `/` নয়, `http` নয়), Save → **Reload**। |
| **429** | অল্প সময়ে অনেকবার চাওয়া, বা কয়েকবার ভুল টোকেন। | ১ মিনিট অপেক্ষা করুন। |
| **500** | সার্ভারের ভেতরে অপ্রত্যাশিত ভুল। | **Error log** দেখুন, সবার নিচের লাইনগুলো। |
| **503** | `config.py` অসম্পূর্ণ, বা `cloudinary` প্যাকেজ নেই। | `python verify_install.py` চালান, `PROBLEM` লাইনগুলো ঠিক করুন, **Reload** দিন। |

### CORS এরর

ব্রাউজার কনসোলে "blocked by CORS policy" লিখে এলে বুঝবেন ব্রাউজার Python সার্ভিসের উত্তর পড়তে পারেনি। কারণগুলো:

1. `ALLOWED_ORIGINS` ভুল বা অসম্পূর্ণ → ঠিক করে Reload।
2. **আসল সমস্যা অন্য, কিন্তু CORS-এর মতো দেখাচ্ছে:** যদি অ্যাপ চালুই না হয় (WSGI ভুল, প্যাকেজ নেই) তাহলে PythonAnywhere-এর নিজস্ব এরর পাতা আসে, যাতে CORS হেডার থাকে না। ব্রাউজার তখনও "CORS" বলে। তাই CORS দেখলে আগে `https://<YOUR_PYTHONANYWHERE_USERNAME>.pythonanywhere.com/health` সরাসরি খুলে দেখুন। সেটা না চললে Error log দেখুন।
3. কনসোলে `Refused to connect ... Content Security Policy` লিখে এলে বুঝবেন Render-এ `PYTHON_SERVICE_URL` বসেনি (বা ভুল), আর Render-এর নতুন করে চালু হওয়া বাকি। Part E ধাপ ৩ ও `https://sync-5lfm.onrender.com/health` দেখুন।

### Invalid signature (Cloudinary-র উত্তর)

আপলোড করার সময় লাল বার্তায় `Invalid Signature ...` এলে:
- `config.py`-তে `CLOUDINARY_API_SECRET` ভুল (এক অক্ষরও আলাদা, বা শুরু/শেষে ফাঁকা জায়গা)। Cloudinary → Settings → API Keys থেকে আবার কপি করুন, Save, **Reload**।
- অন্য একটা Cloudinary অ্যাকাউন্টের Key আর অন্যটার Secret মিশে গেছে। তিনটাই (cloud name, key, secret) একই অ্যাকাউন্টের কিনা দেখুন।
- `ENFORCE_ALLOWED_FORMATS` চালু করে থাকলে পুরনো ফ্রন্টএন্ড (Render-এ নতুন কোড পৌঁছায়নি) `allowed_formats` পাঠায় না। Render-এ নতুন ফ্রন্টএন্ড deploy হয়েছে কিনা দেখুন, অথবা অপশনটা বন্ধ রাখুন।

### Invalid API key

Cloudinary-র উত্তরে `Invalid api_key ...` বা `Must supply api_key`: `CLOUDINARY_API_KEY` ভুল বা অন্য অ্যাকাউন্টের। শুধু সংখ্যা হওয়ার কথা। ঠিক করে Save → **Reload**।

### Cloudinary upload failure (অন্যান্য)

স্ক্রিনে Cloudinary-র আসল বার্তা এখন দেখানো হয়। কয়েকটা চেনা বার্তা:
- `File size too large` → আপনার Cloudinary প্ল্যানের সীমার চেয়ে বড় ফাইল।
- `Stale request` / সময় সংক্রান্ত → আপনার সিল বানানোর পর অনেকক্ষণ বসে থেকে আপলোড করেছেন। আবার চেষ্টা করুন।
- `Invalid image file` → ফাইলটা নষ্ট, বা ছবির ফরম্যাট Cloudinary বোঝে না।

### PythonAnywhere WSGI import error

Error log-এ `ModuleNotFoundError: No module named 'app'` বা `ImportError`:
- WSGI ফাইলের `PROJECT_HOME` পথ ভুল (ইউজারনেমে বানান ভুল, `<` `>` রয়ে গেছে)। Part C ধাপ ১৫ আবার দেখুন।
- `app.py` ঠিক ফোল্ডারে নেই (ZIP খোলার পর `ls ~/sync-media-service` চালিয়ে দেখুন, সরাসরি `app.py` দেখা যাওয়া উচিত, কোনো উপ-ফোল্ডারের ভেতরে নয়)।
- ঠিক করে WSGI ফাইল **Save** → Web ট্যাবে **Reload**।

### Missing dependencies

Error log-এ `No module named 'flask'`, `'jwt'` বা `'cloudinary'`:
- Web ট্যাবে **Virtualenv** পথ ভুল বা খালি (Part C ধাপ ১৩)।
- অন্য ভার্সনের virtualenv ব্যবহার হচ্ছে। Web ট্যাবের Python ভার্সন আর virtualenv-এর ভার্সন একই হতে হবে।
- ইনস্টল হয়নি। কনসোলে:

```bash
workon sync-media-env
cd ~/sync-media-service
pip install -r requirements.txt
```

তারপর Web ট্যাবে **Reload**।

### ভুল JWT secret

লক্ষণ: লগইন ঠিক আছে, চ্যাট ঠিক চলছে, কিন্তু প্রতিটা আপলোডে `401` ("Invalid access token")। কারণটা ব্রাউজারে দেখা যায় না, কিন্তু PythonAnywhere-এর Error log-এ `Auth rejected: bad_signature` লেখা থাকবে।

- `config.py`-র `JWT_SECRET` আর Render-এর `JWT_SECRET` হুবহু মেলে কিনা দেখুন (এক অক্ষর, ফাঁকা জায়গা, বড়/ছোট হাতের অক্ষরও ধরা পড়ে)।
- Render-এ `JWT_SECRET` সম্প্রতি বদলালে PythonAnywhere-এও বদলে **Reload** দিন।

### ভুল Python service URL

লক্ষণ: আপলোডে "Unable to obtain an upload signature" বা "The Python media service URL is not configured"।
- Render-এর `PYTHON_SERVICE_URL`-এ ইউজারনেমে বানান ভুল, `http` বদলে `https` লিখতে হবে, শেষে বাড়তি পথ নেই কিনা দেখুন।
- `https://sync-5lfm.onrender.com/health`-এ `pythonServiceUrl` ঠিক আছে কিনা দেখুন।
- Render নতুন করে চালু হয়েছে কিনা দেখুন (Environment বদলানোর পর)।
- ব্রাউজারে পুরনো ঠিকানা মনে রাখলে একবার সাইট রিফ্রেশ করুন (সাইট খোলার সময় নিজে নতুন ঠিকানা নেয়)।

### Cloudinary ঠিকানা বাতিল হচ্ছে (আপলোড সফল, কিন্তু মেসেজ/ছবি সেভ হচ্ছে না)

লক্ষণ: Cloudinary-তে ফাইল আছে, কিন্তু অ্যাপে `Invalid media URL` / `INVALID_MEDIA_URL` আসে।
- Render-এ `CLOUDINARY_CLOUD_NAME` নেই বা Cloudinary-র cloud name-এর সাথে মেলে না। এই মান মিলিয়ে নিন (অক্ষর, বড়-ছোট হাত)। Production-এ এটা না থাকলে Node এখন সব Cloudinary ঠিকানা বাতিল করে। এটাই নিরাপদ আচরণ।

---

## Part H — সার্ভিস আপডেট করা

### Python সার্ভিসের ফাইল বদলালে

1. PythonAnywhere → **Files** → `sync-media-service` ফোল্ডারে যান।
2. নতুন ফাইলটা **Upload a file** দিয়ে তুলুন (একই নামের পুরনো ফাইল বদলে যাবে)।
   ZIP হলে একই কনসোল-কমান্ড চালান: `cd ~/sync-media-service && unzip -o <zip-এর-নাম>.zip`
3. ⚠️ **`config.py` মুছবেন না বা বদলে দেবেন না।** নতুন ZIP-এ `config.py` নেই, তাই ZIP খুললে সেটা অক্ষত থাকে। 
4. নতুন প্যাকেজ যোগ হয়ে থাকলে: `workon sync-media-env`, তারপর `pip install -r requirements.txt`।
5. **Web** ট্যাবে সবুজ **Reload** বাটন চাপুন। (Reload ছাড়া পুরনো কোডই চলতে থাকবে।)

### কোন বদলে কী করতে হবে

| কী বদলালেন | PythonAnywhere **Reload** | Render redeploy |
| --- | :---: | :---: |
| Python সার্ভিসের কোড (`.py` ফাইল) | ✅ লাগবে | ❌ লাগবে না |
| `config.py`-র মান (Cloudinary key, `ALLOWED_ORIGINS` ইত্যাদি) | ✅ লাগবে | ❌ লাগবে না |
| `JWT_SECRET` বদলানো | ✅ Reload | ✅ Render-এও একই মান বসাতে হবে (Environment Save করলে নিজে redeploy) |
| `CLOUDINARY_CLOUD_NAME` বদলানো | ✅ Reload | ✅ Render-এও একই মান |
| PythonAnywhere ইউজারনেম/URL বদলানো | ❌ | ✅ `PYTHON_SERVICE_URL` বদলে Save |
| ফ্রন্টএন্ড (`frontend/`) বা Node (`node-backend/`) কোড | ❌ | ✅ GitHub push করলে নিজে redeploy |
| Render Environment-এর যেকোনো মান | ❌ | ✅ Save করলে নিজে redeploy |

---

## Part I — শেষ চেকলিস্ট

প্রতিটা বাক্সে নিজে টিক দিন:

**PythonAnywhere**
- [ ] `sync-media-service` ফোল্ডারে `app.py`, `settings.py`, `routes`, `services`, `utils` আছে
- [ ] virtualenv `sync-media-env` বানানো হয়েছে আর `pip install -r requirements.txt` সফল হয়েছে
- [ ] `config.py` বানানো হয়েছে, চারটা চাবি ও `ALLOWED_ORIGINS` ভরা আছে
- [ ] `python verify_install.py` শেষে `everything looks good` বলেছে
- [ ] Web ট্যাবে Manual configuration, Python ভার্সন, Virtualenv পথ, Source code/Working directory ঠিক আছে
- [ ] WSGI ফাইলে আমাদের কোড বসানো (ইউজারনেম বদলানো, `<` `>` নেই)
- [ ] Force HTTPS চালু, **Reload** দেওয়া হয়েছে
- [ ] `https://<YOUR_PYTHONANYWHERE_USERNAME>.pythonanywhere.com/health` দেখাচ্ছে `"status": "ok"`, `"configured": true`

**Render**
- [ ] আপডেট করা প্রজেক্ট GitHub-এ push করেছি (আর `config.py` GitHub-এ নেই)
- [ ] `PYTHON_SERVICE_URL = https://<YOUR_PYTHONANYWHERE_USERNAME>.pythonanywhere.com` বসানো
- [ ] `JWT_SECRET` Render আর `config.py`-তে হুবহু এক
- [ ] `CLOUDINARY_CLOUD_NAME` Render আর `config.py`-তে হুবহু এক
- [ ] Render নতুন করে চালু হয়েছে (`Your service is live`)
- [ ] `https://sync-5lfm.onrender.com/health`-এ `pythonServiceUrl` আর `cloudinaryCloudName` ঠিক দেখাচ্ছে
- [ ] `SERVICE_KEY` বা `VITE_PYTHON_SERVICE_URL` বসাইনি (দরকার নেই)

**পরীক্ষা**
- [ ] ভুল টোকেনে 401, সঠিক টোকেনে 200 (Part F ২–৫)
- [ ] ছবি, ভিডিও, ভয়েস আপলোড হয়েছে
- [ ] প্রোফাইল ছবি আর Story-তে আপলোড হয়েছে
- [ ] Cloudinary Media Library-তে `sync/chat`, `sync/voice`, `sync/avatars`, `sync/stories`-এ ফাইল দেখা যাচ্ছে

**নিরাপত্তা**
- [ ] `CLOUDINARY_API_SECRET` শুধু PythonAnywhere-এর `config.py`-তে আছে, আর কোথাও নেই
- [ ] কোনো স্ক্রিনশটে বা মেসেজে `config.py`-র মান কাউকে পাঠাইনি
- [ ] PythonAnywhere Web ট্যাবে মেয়াদ বাড়ানোর বাটনের কথা মনে রেখেছি

সবগুলোতে টিক পড়লে আপনার Media Service সম্পূর্ণ চালু। 🎉
