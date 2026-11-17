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
LOGO=../assets/logo-mark.webp
ICON_BG="#E0F8EC"
SPLASH_BG="#031512"
VERSION_CODE="${VERSION_CODE:-1}"

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
    convert "$ICON" -resize "${legacy}x${legacy}" "$RES/mipmap-$density/ic_launcher.png"
    cp "$RES/mipmap-$density/ic_launcher.png" "$RES/mipmap-$density/ic_launcher_round.png"
    convert "$ICON" -resize "${adaptive}x${adaptive}" "$RES/mipmap-$density/sync_icon_fg.png"
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

# ---------- 3. Splash screen (গাঢ় ব্যাকগ্রাউন্ডে Sync লোগো) ----------
TMP="$(mktemp -d)"
convert -size 1080x1920 "xc:$SPLASH_BG" -depth 8 \( "$LOGO" -resize 420x420 \) -gravity center -composite "$TMP/splash-port.png"
convert -size 1920x1080 "xc:$SPLASH_BG" -depth 8 \( "$LOGO" -resize 420x420 \) -gravity center -composite "$TMP/splash-land.png"

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

echo "Android project customised (versionCode ${VERSION_CODE})"
