#!/usr/bin/env bash
# `npx cap add android` এর পর চালানো হয় (GitHub Actions থেকে)।
# অ্যাপের permission, আইকন, splash ও version এখানে সেট হয়, তাই android/ ফোল্ডার repo তে রাখতে হয় না।
set -euo pipefail
cd "$(dirname "$0")/.."   # mobile/

APP=android/app/src/main
RES="$APP/res"
MANIFEST="$APP/AndroidManifest.xml"
GRADLE=android/app/build.gradle
ICON=../assets/icons/maskable-512.png
LOGO=assets/logo-mark.png
ICON_BG="#E0F8EC"
SPLASH_BG="#031512"
VERSION_CODE="${VERSION_CODE:-1}"

# ImageMagick: নতুন ভার্সনে `magick`, পুরনোতে `convert`
IM="$(command -v magick || command -v convert || true)"
if [ -z "$IM" ]; then
    echo "ImageMagick পাওয়া যায়নি (apt install imagemagick)" >&2
    exit 1
fi

# ---------- 1. Permissions (ভয়েস রেকর্ড, ভিডিও/ভয়েস কল, নোটিফিকেশন) ----------
python3 - "$MANIFEST" <<'PY'
import sys
path = sys.argv[1]
s = open(path, encoding="utf-8").read()
perms = [
    "android.permission.INTERNET",
    "android.permission.ACCESS_NETWORK_STATE",
    "android.permission.CAMERA",
    "android.permission.RECORD_AUDIO",
    "android.permission.MODIFY_AUDIO_SETTINGS",
    "android.permission.POST_NOTIFICATIONS",
    "android.permission.VIBRATE",
]
feats = ["android.hardware.camera", "android.hardware.microphone"]
add = ""
for p in perms:
    if f'android:name="{p}"' not in s:
        add += f'    <uses-permission android:name="{p}" />\n'
for f in feats:
    if f'android:name="{f}"' not in s:
        add += f'    <uses-feature android:name="{f}" android:required="false" />\n'
s = s.replace("</manifest>", add + "</manifest>", 1)
open(path, "w", encoding="utf-8").write(s)
PY

# ---------- 2. App icon (adaptive + পুরনো ফোনের জন্য legacy) ----------
mkdir -p "$RES/mipmap-anydpi-v26" "$RES/values"

for pair in mdpi:48:108 hdpi:72:162 xhdpi:96:216 xxhdpi:144:324 xxxhdpi:192:432; do
    IFS=: read -r density legacy adaptive <<<"$pair"
    mkdir -p "$RES/mipmap-$density"
    "$IM" "$ICON" -resize "${legacy}x${legacy}" "$RES/mipmap-$density/ic_launcher.png"
    cp "$RES/mipmap-$density/ic_launcher.png" "$RES/mipmap-$density/ic_launcher_round.png"
    "$IM" "$ICON" -resize "${adaptive}x${adaptive}" "$RES/mipmap-$density/sync_icon_fg.png"
done

cat > "$RES/values/sync_icon.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="sync_icon_bg">$ICON_BG</color>
</resources>
XML

for name in ic_launcher ic_launcher_round; do
    cat > "$RES/mipmap-anydpi-v26/$name.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/sync_icon_bg" />
    <foreground android:drawable="@mipmap/sync_icon_fg" />
</adaptive-icon>
XML
done

# ---------- 3. Splash screen (PWA-র মতো: গাঢ় ব্যাকগ্রাউন্ডে গোল লোগো) ----------
# শুধু windowBackground সাদা থাকায় অ্যাপ খুললে সাদা স্ক্রিন দেখাত। এখন Android 12+ এর সিস্টেম splash-এর
# ব্যাকগ্রাউন্ড ও আইকন, আর পুরনো ফোনের splash.png সবই PWA splash-এর মতো (গোল লোগো, গাঢ় ব্যাকগ্রাউন্ড)।
TMP="$(mktemp -d)"
CIRCLE_PX=640

# maskable আইকন গোল করে কাটা (PWA splash-এ Chrome ঠিক এটাই দেখায়)
"$IM" "$ICON" -resize "${CIRCLE_PX}x${CIRCLE_PX}" -alpha set \
    \( -size "${CIRCLE_PX}x${CIRCLE_PX}" xc:none -fill white -draw "circle 320,320 320,1.5" \) \
    -compose DstIn -composite "$TMP/circle.png"

# Android 12+ সিস্টেম splash আইকন: স্বচ্ছ 960px ক্যানভাসে গোল লোগো (সিস্টেম মাঝের 2/3 অংশ দেখায়)
mkdir -p "$RES/drawable-nodpi"
"$IM" -size 960x960 xc:none "$TMP/circle.png" -gravity center -composite "$RES/drawable-nodpi/sync_splash_icon.png"

cat > "$RES/values/sync_splash.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="sync_splash_bg">$SPLASH_BG</color>
</resources>
XML

# থিমে splash ব্যাকগ্রাউন্ড ও আইকন বসানো (Theme.SplashScreen না থাকলে কিছু বদলায় না, বিল্ড ভাঙে না)
python3 - "$RES/values/styles.xml" <<'PY'
import re, sys
path = sys.argv[1]
try:
    s = open(path, encoding="utf-8").read()
except FileNotFoundError:
    print("styles.xml not found, skipping splash theme"); sys.exit(0)

def patch(style_name, items):
    global s
    pat = re.compile(r'(<style\s+name="%s"[^>]*>)(.*?)(</style>)' % re.escape(style_name), re.S)
    m = pat.search(s)
    if not m:
        print("style %s not found, skipped" % style_name); return
    body = m.group(2)
    add = ""
    for name, value in items:
        if 'name="%s"' % name not in body:
            add += '\n        <item name="%s">%s</item>' % (name, value)
    if add:
        s = s[:m.start()] + m.group(1) + add + body + m.group(3) + s[m.end():]

if "Theme.SplashScreen" in s:
    patch("AppTheme.NoActionBarLaunch", [
        ("windowSplashScreenBackground", "@color/sync_splash_bg"),
        ("windowSplashScreenAnimatedIcon", "@drawable/sync_splash_icon"),
        ("android:windowBackground", "@color/sync_splash_bg"),
    ])
else:
    print("Theme.SplashScreen not found, splash theme unchanged")
# splash-এর পরে WebView আঁকার আগের মুহূর্তেও সাদা ঝলক যেন না আসে
patch("AppTheme.NoActionBar", [("android:windowBackground", "@color/sync_splash_bg")])
open(path, "w", encoding="utf-8").write(s)
print("splash theme patched")
PY

# পুরনো ফোন ও manual show() এর জন্য splash.png: গাঢ় ব্যাকগ্রাউন্ডে গোল লোগো
"$IM" "$TMP/circle.png" -resize 500x500 "$TMP/circle-small.png"
"$IM" -size 1080x1920 "xc:$SPLASH_BG" -depth 8 "$TMP/circle-small.png" -gravity center -composite "$TMP/splash-port.png"
"$IM" -size 1920x1080 "xc:$SPLASH_BG" -depth 8 "$TMP/circle-small.png" -gravity center -composite "$TMP/splash-land.png"

FOUND=0
while IFS= read -r f; do
    FOUND=1
    case "$f" in
        *land*) cp "$TMP/splash-land.png" "$f" ;;
        *)      cp "$TMP/splash-port.png" "$f" ;;
    esac
done < <(find "$RES" -type f -name 'splash.png')

if [ "$FOUND" -eq 0 ]; then
    mkdir -p "$RES/drawable"
    cp "$TMP/splash-port.png" "$RES/drawable/splash.png"
fi
rm -rf "$TMP"

# ---------- 4. Version (প্রতি বিল্ডে বাড়ে, তাই নতুন APK পুরনোটার ওপর ইনস্টল হয়) ----------
sed -i -E "s/versionCode [0-9]+/versionCode ${VERSION_CODE}/" "$GRADLE"
sed -i -E "s/versionName \"[^\"]*\"/versionName \"1.0.${VERSION_CODE}\"/" "$GRADLE"

# ---------- 5. Signing: repo-র debug.keystore স্পষ্টভাবে বসানো ----------
# আগে শুধু ~/.android/debug.keystore-এ কপি করা হতো আর Gradle নিজে থেকে সেটা নেবে ধরে নেওয়া হতো।
# সেটা না নিলে প্রতি build-এ runner-এর আলাদা random key দিয়ে sign হতো, ফলে ফোনে
# "App not installed as package conflicts with an existing package" আসত। এখন build.gradle-এই key বলে দেওয়া হয়।
python3 - "$GRADLE" "$(pwd)/debug.keystore" <<'PY'
import re, sys
path, keystore = sys.argv[1], sys.argv[2]
s = open(path, encoding="utf-8").read()
if "syncfixed" in s:
    print("signing already configured"); sys.exit(0)

signing = (
    "    signingConfigs {\n"
    "        syncfixed {\n"
    "            storeFile file('%s')\n"
    "            storePassword 'android'\n"
    "            keyAlias 'androiddebugkey'\n"
    "            keyPassword 'android'\n"
    "        }\n"
    "    }\n"
) % keystore

m = re.search(r"^(\s*)buildTypes\s*\{", s, re.M)
if not m:
    print("buildTypes block not found", file=sys.stderr); sys.exit(1)
# signingConfigs buildTypes-এর আগে, আর buildTypes-এর ভেতরে debug ও release দুটোতেই এই key
s = s[:m.start()] + signing + s[m.start():]
m = re.search(r"buildTypes\s*\{", s)
inject = "\n        debug {\n            signingConfig signingConfigs.syncfixed\n        }"
s = s[:m.end()] + inject + s[m.end():]
open(path, "w", encoding="utf-8").write(s)
print("signing configured with fixed keystore")
PY

echo "Android project customised (versionCode ${VERSION_CODE})"
