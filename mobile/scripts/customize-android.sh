#!/usr/bin/env bash
# `npx cap add android` এর পর চালানো হয় (GitHub Actions থেকে)।
# অ্যাপের permission, আইকন, splash, Firebase (google-services.json), WhatsApp-style push notification
# ও version এখানে সেট হয়, তাই android/ ফোল্ডার repo তে রাখতে হয় না।
set -euo pipefail
cd "$(dirname "$0")/.."   # mobile/

APP=android/app/src/main
RES="$APP/res"
MANIFEST="$APP/AndroidManifest.xml"
GRADLE=android/app/build.gradle
ICON=../assets/icons/maskable-512.png
BADGE_ICON=../assets/icons/notification-badge.png
LOGO=assets/logo-mark.png
ICON_BG="#E0F8EC"
SPLASH_BG="#031512"
NOTIF_COLOR="#00ED64"
VERSION_CODE="${VERSION_CODE:-1}"

# ImageMagick: নতুন ভার্সনে `magick`, পুরনোতে `convert`
IM="$(command -v magick || command -v convert || true)"
if [ -z "$IM" ]; then
    echo "ImageMagick পাওয়া যায়নি (apt install imagemagick)" >&2
    exit 1
fi

# ---------- 0. Firebase google-services.json বসানো ----------
if [ -f "google-services.json" ]; then
    cp -f "google-services.json" "android/app/google-services.json"
    echo "google-services.json copied to android/app/google-services.json"
else
    echo "WARNING: mobile/google-services.json পাওয়া যায়নি!" >&2
fi

# ---------- 1. Permissions ও Firebase Messaging Service (AndroidManifest.xml) ----------
python3 - "$MANIFEST" <<'PY'
import sys
path = sys.argv[1]
s = open(path, encoding="utf-8").read()

if 'xmlns:tools=' not in s:
    s = s.replace(
        '<manifest xmlns:android="http://schemas.android.com/apk/res/android"',
        '<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools"',
        1
    )

perms = [
    "android.permission.INTERNET",
    "android.permission.ACCESS_NETWORK_STATE",
    "android.permission.CAMERA",
    "android.permission.ACCESS_FINE_LOCATION",
    "android.permission.ACCESS_COARSE_LOCATION",
    "android.permission.RECORD_AUDIO",
    "android.permission.MODIFY_AUDIO_SETTINGS",
    "android.permission.POST_NOTIFICATIONS",
    "android.permission.VIBRATE",
    "android.permission.WAKE_LOCK",
    "android.permission.RECEIVE_BOOT_COMPLETED",
    # অ্যাপ আইকনের unread badge সংখ্যা (বিভিন্ন কোম্পানির লঞ্চারের জন্য)
    "com.sec.android.provider.badge.permission.READ",
    "com.sec.android.provider.badge.permission.WRITE",
    "com.htc.launcher.permission.READ_SETTINGS",
    "com.htc.launcher.permission.UPDATE_SHORTCUT",
    "com.sonyericsson.home.permission.BROADCAST_BADGE",
    "com.sonymobile.home.permission.PROVIDER_INSERT_BADGE",
    "com.anddoes.launcher.permission.UPDATE_COUNT",
    "com.majeur.launcher.permission.UPDATE_BADGE",
    "com.huawei.android.launcher.permission.CHANGE_BADGE",
    "com.huawei.android.launcher.permission.READ_SETTINGS",
    "com.huawei.android.launcher.permission.WRITE_SETTINGS",
    "android.permission.READ_APP_BADGE",
    "com.oppo.launcher.permission.READ_SETTINGS",
    "com.oppo.launcher.permission.WRITE_SETTINGS",
    "me.everything.badger.permission.BADGE_COUNT_READ",
    "me.everything.badger.permission.BADGE_COUNT_WRITE",
]
feats = ["android.hardware.camera", "android.hardware.microphone", "android.hardware.location.gps"]
add = ""
for p in perms:
    if f'android:name="{p}"' not in s:
        add += f'    <uses-permission android:name="{p}" />\n'
for f in feats:
    if f'android:name="{f}"' not in s:
        add += f'    <uses-feature android:name="{f}" android:required="false" />\n'
s = s.replace("</manifest>", add + "</manifest>", 1)

app_extras = """
        <meta-data
            android:name="com.google.firebase.messaging.default_notification_icon"
            android:resource="@drawable/ic_stat_sync" />
        <meta-data
            android:name="com.google.firebase.messaging.default_notification_color"
            android:resource="@color/sync_notif_color" />
        <meta-data
            android:name="com.google.firebase.messaging.default_notification_channel_id"
            android:value="sync_messages_v3" />

        <service
            android:name="com.capacitorjs.plugins.pushnotifications.MessagingService"
            tools:node="remove" />

        <service
            android:name=".SyncMessagingService"
            android:exported="false">
            <intent-filter>
                <action android:name="com.google.firebase.MESSAGING_EVENT" />
            </intent-filter>
        </service>
"""
if "SyncMessagingService" not in s:
    s = s.replace("</application>", app_extras + "    </application>", 1)

open(path, "w", encoding="utf-8").write(s)
PY

# ---------- 2. App icon (adaptive + legacy) এবং Notification status bar icon ----------
mkdir -p "$RES/mipmap-anydpi-v26" "$RES/values" "$RES/drawable"

for pair in mdpi:48:108:24 hdpi:72:162:36 xhdpi:96:216:48 xxhdpi:144:324:72 xxxhdpi:192:432:96; do
    IFS=: read -r density legacy adaptive notif_px <<<"$pair"
    mkdir -p "$RES/mipmap-$density" "$RES/drawable-$density"
    "$IM" "$ICON" -resize "${legacy}x${legacy}" "$RES/mipmap-$density/ic_launcher.png"
    cp "$RES/mipmap-$density/ic_launcher.png" "$RES/mipmap-$density/ic_launcher_round.png"
    "$IM" "$ICON" -resize "${adaptive}x${adaptive}" "$RES/mipmap-$density/sync_icon_fg.png"
    if [ -f "$BADGE_ICON" ]; then
        "$IM" "$BADGE_ICON" -resize "${notif_px}x${notif_px}" "$RES/drawable-$density/ic_stat_sync.png"
    else
        "$IM" "$ICON" -resize "${notif_px}x${notif_px}" "$RES/drawable-$density/ic_stat_sync.png"
    fi
done

if [ -f "$BADGE_ICON" ]; then
    cp "$BADGE_ICON" "$RES/drawable/ic_stat_sync.png"
else
    "$IM" "$ICON" -resize 96x96 "$RES/drawable/ic_stat_sync.png"
fi

cat > "$RES/values/sync_icon.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="sync_icon_bg">$ICON_BG</color>
    <color name="sync_notif_color">$NOTIF_COLOR</color>
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

# ---------- 2b. Native Java Classes: MainActivity.java ও SyncMessagingService.java ----------
JAVA_DIR="$APP/java/com/sync/chat"
# ---------- নোটিফিকেশন সাউন্ড (res/raw) ----------
# নাম শুধু lowercase [a-z0-9_]; sounds.js এর notify/done চাইম থেকে রেন্ডার করা
mkdir -p "$RES/raw"
for f in sync_notify sync_notice; do
    if [ -f "assets/sounds/$f.ogg" ]; then
        cp -f "assets/sounds/$f.ogg" "$RES/raw/$f.ogg"
    else
        echo "ERROR: mobile/assets/sounds/$f.ogg পাওয়া যায়নি" >&2
        exit 1
    fi
done
echo "Notification sounds copied to $RES/raw"

mkdir -p "$JAVA_DIR"

cat > "$JAVA_DIR/MainActivity.java" <<'JAVA'
package com.sync.chat;

import android.content.Intent;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    public static volatile boolean isAppInForeground = false;
    public static volatile String activeConversationId = "";
    private static volatile String pendingTargetUrl = "";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        SyncMessagingService.ensureChannels(this);
        captureNotificationIntent(getIntent());
        super.onCreate(savedInstanceState);
        registerSyncBackHandler();

        try {
            if (this.bridge != null && this.bridge.getWebView() != null) {
                WebView webView = this.bridge.getWebView();
                webView.addJavascriptInterface(new SyncNativeNotifBridge(), "SyncNativeNotif");
            }
        } catch (Exception ignored) {
        }
    }

    // ফোনের Back বাটন: আগে ওয়েব অংশকে সামলাতে দেয় (পপআপ বন্ধ / আগের পেজে ফেরা)।
    // একদম হোম পেজে থাকলে অ্যাপ বন্ধ না করে শুধু মিনিমাইজ করে (WhatsApp-এর মতো)।
    // (@capacitor/app প্লাগিন নেই, তাই আগে Back চাপলেই পুরো অ্যাপ বন্ধ হয়ে যেত)
    private void registerSyncBackHandler() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                final WebView webView = (MainActivity.this.bridge != null)
                    ? MainActivity.this.bridge.getWebView()
                    : null;
                if (webView == null) {
                    MainActivity.this.moveTaskToBack(true);
                    return;
                }
                final String js = "(function(){try{return typeof window.__syncHandleBack==='function'"
                    + "?(window.__syncHandleBack()?'handled':'root'):'none';}catch(e){return 'none';}})()";
                webView.evaluateJavascript(js, value -> {
                    String v = value == null ? "" : value.replace("\"", "");
                    if ("handled".equals(v)) return;
                    if ("none".equals(v) && webView.canGoBack()) {
                        webView.goBack();
                        return;
                    }
                    MainActivity.this.moveTaskToBack(true);
                });
            }
        });
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        captureNotificationIntent(intent);
        dispatchPendingUrlToWebView();
    }

    @Override
    public void onResume() {
        super.onResume();
        isAppInForeground = true;
        if (activeConversationId != null && !activeConversationId.isEmpty()) {
            SyncMessagingService.clearConversationNotifications(this, activeConversationId);
        }
        dispatchPendingUrlToWebView();
    }

    @Override
    public void onPause() {
        isAppInForeground = false;
        super.onPause();
    }

    private void captureNotificationIntent(Intent intent) {
        if (intent == null) return;
        String convId = intent.getStringExtra("sync_conv_id");
        if (convId == null || convId.isEmpty()) {
            convId = intent.getStringExtra("conversationId");
        }
        if (convId != null && !convId.isEmpty()) {
            SyncMessagingService.clearConversationNotifications(this, convId);
        }

        String targetUrl = intent.getStringExtra("sync_target_url");
        if (targetUrl == null || targetUrl.isEmpty()) {
            targetUrl = intent.getStringExtra("url");
        }
        if ((targetUrl == null || targetUrl.isEmpty()) && convId != null && !convId.isEmpty()) {
            targetUrl = "/chats/" + convId;
        }
        if (targetUrl != null && !targetUrl.isEmpty() && targetUrl.startsWith("/")) {
            pendingTargetUrl = targetUrl;
        }
    }

    private void dispatchPendingUrlToWebView() {
        final String url = pendingTargetUrl;
        if (url == null || url.isEmpty()) return;
        try {
            if (this.bridge != null && this.bridge.getWebView() != null) {
                final WebView webView = this.bridge.getWebView();
                final String escaped = url.replace("\\", "\\\\").replace("'", "\\'");
                webView.post(() -> {
                    String js = "window.__SYNC_INITIAL_NAV__='" + escaped + "';"
                        + "window.dispatchEvent(new CustomEvent('sync:native-navigate',{detail:{url:'" + escaped + "'}}));";
                    webView.evaluateJavascript(js, null);
                });
            }
        } catch (Exception ignored) {
        }
    }

    public class SyncNativeNotifBridge {
        @JavascriptInterface
        public String consumeInitialUrl() {
            String url = pendingTargetUrl;
            pendingTargetUrl = "";
            return url != null ? url : "";
        }

        // ওয়েব অংশ মোট unread পাঠায় → লঞ্চার আইকনে badge (০ হলে মুছে যায়)
        @JavascriptInterface
        public void setBadge(int count) {
            BadgeHelper.set(MainActivity.this, count);
        }

        @JavascriptInterface
        public void clearBadge() {
            BadgeHelper.set(MainActivity.this, 0);
        }

        @JavascriptInterface
        public void setActiveChat(String conversationId) {
            String clean = conversationId != null ? conversationId.trim() : "";
            activeConversationId = clean;
            if (!clean.isEmpty()) {
                SyncMessagingService.clearConversationNotifications(MainActivity.this, clean);
            }
        }
    }
}
JAVA

cat > "$JAVA_DIR/BadgeHelper.java" <<'JAVA'
package com.sync.chat;

import android.content.Context;
import android.content.SharedPreferences;
import me.leolin.shortcutbadger.ShortcutBadger;

// অ্যাপ আইকনের unread সংখ্যা (WhatsApp-এর মতো)। Samsung, Xiaomi, Oppo/Realme, Vivo, Huawei, Sony ইত্যাদির লঞ্চারে কাজ করে।
// Pixel/AOSP লঞ্চারে সংখ্যা আসে নোটিফিকেশনের number থেকে (SyncMessagingService এ বসানো হয়)।
public final class BadgeHelper {
    private static final String PREFS = "sync_badge";
    private static final String KEY = "count";

    private BadgeHelper() {}

    public static void set(Context context, int count) {
        if (context == null) return;
        int safe = Math.max(0, count);
        try {
            SharedPreferences prefs = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            prefs.edit().putInt(KEY, safe).apply();
        } catch (Exception ignored) {
        }
        try {
            if (safe > 0) {
                ShortcutBadger.applyCount(context.getApplicationContext(), safe);
            } else {
                ShortcutBadger.removeCount(context.getApplicationContext());
            }
        } catch (Throwable ignored) {
            // কিছু লঞ্চার badge সাপোর্ট করে না, সমস্যা নেই
        }
    }

    public static int get(Context context) {
        try {
            return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt(KEY, 0);
        } catch (Exception e) {
            return 0;
        }
    }
}
JAVA

cat > "$JAVA_DIR/SyncMessagingService.java" <<'JAVA'
package com.sync.chat;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.PorterDuff;
import android.graphics.PorterDuffXfermode;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.service.notification.StatusBarNotification;
import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.Person;
import androidx.core.graphics.drawable.IconCompat;
import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

public class SyncMessagingService extends MessagingService {
    public static final String CHANNEL_MESSAGES = "sync_messages_v3";
    public static final String CHANNEL_NOTICES = "sync_notices_v3";
    private static final String PREFS_NAME = "sync_whatsapp_notif_stack";
    private static final String GROUP_KEY_CHATS = "com.sync.chat.CHATS_GROUP";
    private static final int SUMMARY_NOTIFICATION_ID = 777000;
    private static final int MAX_STACKED_MESSAGES = 6;
    private static final int SYNC_GREEN = 0xFF00ED64;
    private static final int SYNC_DARK_BG = 0xFF0B2B24;

    public static Uri soundUri(Context context, String rawName) {
        return Uri.parse("android.resource://" + context.getPackageName() + "/raw/" + rawName);
    }

    public static void ensureChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        // Sync-এর নিজস্ব চাইম (res/raw/sync_notify.ogg ও sync_notice.ogg)
        Uri messageSoundUri = soundUri(context, "sync_notify");
        Uri noticeSoundUri = soundUri(context, "sync_notice");

        // পুরনো চ্যানেলের সাউন্ড লক হয়ে থাকে, তাই v2 চ্যানেল মুছে v3 বানানো হয়
        nm.deleteNotificationChannel("sync_messages_v2");
        nm.deleteNotificationChannel("sync_notices_v2");

        AudioAttributes audioAttr = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_COMMUNICATION_INSTANT)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();

        NotificationChannel msgChannel = new NotificationChannel(
            CHANNEL_MESSAGES,
            "Chats & Messages",
            NotificationManager.IMPORTANCE_HIGH
        );
        msgChannel.setDescription("WhatsApp-style instant notifications for direct and group messages");
        msgChannel.enableLights(true);
        msgChannel.setLightColor(SYNC_GREEN);
        msgChannel.enableVibration(true);
        msgChannel.setVibrationPattern(new long[]{0, 200, 90, 200});
        msgChannel.setShowBadge(true);
        msgChannel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        msgChannel.setSound(messageSoundUri, audioAttr);
        nm.createNotificationChannel(msgChannel);

        NotificationChannel noticeChannel = new NotificationChannel(
            CHANNEL_NOTICES,
            "Admin Notices & Announcements",
            NotificationManager.IMPORTANCE_HIGH
        );
        noticeChannel.setDescription("Important platform announcements and notices from Sync");
        noticeChannel.enableLights(true);
        noticeChannel.setLightColor(SYNC_GREEN);
        noticeChannel.enableVibration(true);
        noticeChannel.setVibrationPattern(new long[]{0, 240, 100, 240, 100, 300});
        noticeChannel.setShowBadge(true);
        noticeChannel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        noticeChannel.setSound(noticeSoundUri, audioAttr);
        nm.createNotificationChannel(noticeChannel);
    }

    public static void clearConversationNotifications(Context context, String conversationId) {
        if (context == null || conversationId == null || conversationId.isEmpty()) return;
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit().remove("conv_" + conversationId).apply();

            String tag = "conversation-" + conversationId;
            NotificationManagerCompat nm = NotificationManagerCompat.from(context);
            nm.cancel(tag, tag.hashCode());
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onNewToken(@NonNull String token) {
        super.onNewToken(token);
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);
        ensureChannels(this);

        Map<String, String> data = remoteMessage.getData();
        String type = valueOr(data, "type", "message");
        String conversationId = valueOr(data, "conversationId", "");
        String messageId = valueOr(data, "messageId", "");
        String noticeId = valueOr(data, "noticeId", "");
        String storyId = valueOr(data, "storyId", "");

        String title = valueOr(data, "title", "");
        String body = valueOr(data, "body", "");
        if (remoteMessage.getNotification() != null) {
            if (title.isEmpty() && remoteMessage.getNotification().getTitle() != null) {
                title = remoteMessage.getNotification().getTitle();
            }
            if (body.isEmpty() && remoteMessage.getNotification().getBody() != null) {
                body = remoteMessage.getNotification().getBody();
            }
        }
        if (title.isEmpty()) title = "Sync";
        if (body.isEmpty()) body = "You have a new message";

        // ইউজার যদি অ্যাপ খুলে ঠিক ওই চ্যাটেই থাকে, তবে চ্যাটের উপরে বাড়তি পপআপ দেখানো হবে না
        if (
            !"notice".equals(type) &&
            MainActivity.isAppInForeground &&
            !conversationId.isEmpty() &&
            conversationId.equals(MainActivity.activeConversationId)
        ) {
            clearConversationNotifications(this, conversationId);
            return;
        }

        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ActivityCompat.checkSelfPermission(this, android.Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
        ) {
            return;
        }

        // সার্ভার থেকে আসা মোট unread (badgeCount) ও এই চ্যাটের unread (chatUnread)
        int badgeCount = parseCount(valueOr(data, "badgeCount", ""), -1);
        int chatUnread = parseCount(valueOr(data, "chatUnread", ""), 0);
        if (!"notice".equals(type) && badgeCount >= 0) {
            BadgeHelper.set(this, badgeCount);
        }

        String senderName = valueOr(data, "senderName", title);
        String messageText = valueOr(data, "messageText", body);
        String senderAvatarUrl = valueOr(data, "senderAvatar", "");
        String groupIconUrl = valueOr(data, "groupIcon", "");
        String imageUrl = valueOr(data, "image", "");
        String tag = valueOr(
            data,
            "tag",
            !conversationId.isEmpty()
                ? "conversation-" + conversationId
                : !noticeId.isEmpty()
                  ? "notice-" + noticeId
                  : "sync-msg-" + System.currentTimeMillis()
        );
        String targetUrl = valueOr(
            data,
            "url",
            !conversationId.isEmpty()
                ? "/chats/" + conversationId
                : !storyId.isEmpty()
                  ? "/stories"
                  : "/"
        );

        PendingIntent contentIntent = buildLaunchPendingIntent(
            data,
            tag,
            targetUrl,
            conversationId,
            noticeId,
            messageId
        );

        if ("notice".equals(type)) {
            showNoticeNotification(title, body, imageUrl, tag, contentIntent);
        } else {
            boolean isGroup = "group_message".equals(type);
            showWhatsAppChatNotification(
                title,
                body,
                messageText,
                senderName,
                senderAvatarUrl,
                groupIconUrl,
                imageUrl,
                conversationId,
                messageId,
                tag,
                isGroup,
                chatUnread,
                contentIntent
            );
        }
    }

    private void showWhatsAppChatNotification(
        String title,
        String fallbackBody,
        String messageText,
        String senderName,
        String senderAvatarUrl,
        String groupIconUrl,
        String imageUrl,
        String conversationId,
        String messageId,
        String tag,
        boolean isGroup,
        int chatUnread,
        PendingIntent contentIntent
    ) {
        Bitmap senderCircle = loadAvatarOrInitials(senderAvatarUrl, senderName);
        Bitmap largeIcon = isGroup && !groupIconUrl.isEmpty()
            ? loadAvatarOrInitials(groupIconUrl, title)
            : senderCircle;
        Bitmap photoBitmap = loadRemoteBitmap(imageUrl, 1024);

        JSONArray history = appendAndLoadStack(conversationId, messageId, senderName, messageText);
        int msgCount = history.length();

        Person mePerson = new Person.Builder()
            .setName("You")
            .build();

        NotificationCompat.MessagingStyle messagingStyle =
            new NotificationCompat.MessagingStyle(mePerson)
                .setGroupConversation(isGroup);
        if (isGroup) {
            messagingStyle.setConversationTitle(title);
        }

        for (int i = 0; i < msgCount; i++) {
            JSONObject item = history.optJSONObject(i);
            if (item == null) continue;
            String mSender = item.optString("sender", senderName);
            String mText = item.optString("text", messageText);
            long mTime = item.optLong("time", System.currentTimeMillis());

            Bitmap personBmp = mSender.equals(senderName)
                ? senderCircle
                : createInitialsCircleBitmap(mSender);
            Person senderPerson = new Person.Builder()
                .setName(mSender)
                .setIcon(IconCompat.createWithBitmap(personBmp))
                .build();

            messagingStyle.addMessage(new NotificationCompat.MessagingStyle.Message(mText, mTime, senderPerson));
        }

        String summaryLine = msgCount > 1 ? (msgCount + " new messages") : fallbackBody;

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_MESSAGES)
            .setSmallIcon(R.drawable.ic_stat_sync)
            .setColor(SYNC_GREEN)
            .setContentTitle(title)
            .setContentText(fallbackBody)
            .setSubText(msgCount > 1 ? summaryLine : null)
            .setLargeIcon(largeIcon)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setDefaults(NotificationCompat.DEFAULT_VIBRATE | NotificationCompat.DEFAULT_LIGHTS)
            .setSound(soundUri(this, "sync_notify"))
            .setAutoCancel(true)
            .setOnlyAlertOnce(false)
            .setWhen(System.currentTimeMillis())
            .setShowWhen(true)
            .setGroup(GROUP_KEY_CHATS)
            .setContentIntent(contentIntent);

        // লঞ্চারের সংখ্যা: প্রতিটা চ্যাটের নোটিফিকেশনে ওই চ্যাটের unread (যোগ করলে মোট হয়)
        if (chatUnread > 0) {
            builder.setNumber(chatUnread);
            builder.setBadgeIconType(NotificationCompat.BADGE_ICON_LARGE);
        }

        if (photoBitmap != null && msgCount <= 1) {
            NotificationCompat.BigPictureStyle picStyle = new NotificationCompat.BigPictureStyle()
                .bigPicture(photoBitmap)
                .bigLargeIcon((Bitmap) null)
                .setBigContentTitle(title)
                .setSummaryText(fallbackBody);
            builder.setStyle(picStyle);
        } else {
            builder.setStyle(messagingStyle);
        }

        int notifId = tag.hashCode();
        NotificationManagerCompat nm = NotificationManagerCompat.from(this);
        try {
            nm.notify(tag, notifId, builder.build());
            updateChatSummaryNotification(nm, contentIntent);
        } catch (SecurityException ignored) {
        }
    }

    private void showNoticeNotification(
        String title,
        String body,
        String imageUrl,
        String tag,
        PendingIntent contentIntent
    ) {
        Bitmap banner = loadRemoteBitmap(imageUrl, 1280);
        Bitmap largeLogo = createInitialsCircleBitmap("Sync");

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_NOTICES)
            .setSmallIcon(R.drawable.ic_stat_sync)
            .setColor(SYNC_GREEN)
            .setContentTitle(title)
            .setContentText(body)
            .setLargeIcon(largeLogo)
            .setCategory(NotificationCompat.CATEGORY_RECOMMENDATION)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setDefaults(NotificationCompat.DEFAULT_VIBRATE | NotificationCompat.DEFAULT_LIGHTS)
            .setSound(soundUri(this, "sync_notice"))
            .setAutoCancel(true)
            .setWhen(System.currentTimeMillis())
            .setShowWhen(true)
            .setContentIntent(contentIntent);

        if (banner != null) {
            builder.setStyle(
                new NotificationCompat.BigPictureStyle()
                    .bigPicture(banner)
                    .bigLargeIcon((Bitmap) null)
                    .setBigContentTitle(title)
                    .setSummaryText(body)
            );
        } else {
            builder.setStyle(
                new NotificationCompat.BigTextStyle()
                    .bigText(body)
                    .setBigContentTitle(title)
            );
        }

        NotificationManagerCompat nm = NotificationManagerCompat.from(this);
        try {
            nm.notify(tag, tag.hashCode(), builder.build());
        } catch (SecurityException ignored) {
        }
    }

    private void updateChatSummaryNotification(
        NotificationManagerCompat nm,
        PendingIntent contentIntent
    ) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        try {
            NotificationManager sysNm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (sysNm == null) return;
            StatusBarNotification[] active = sysNm.getActiveNotifications();
            int chatNotifCount = 0;
            for (StatusBarNotification sbn : active) {
                if (sbn.getId() != SUMMARY_NOTIFICATION_ID && GROUP_KEY_CHATS.equals(sbn.getNotification().getGroup())) {
                    chatNotifCount++;
                }
            }
            if (chatNotifCount < 2) return;

            Notification summary = new NotificationCompat.Builder(this, CHANNEL_MESSAGES)
                .setSmallIcon(R.drawable.ic_stat_sync)
                .setColor(SYNC_GREEN)
                .setContentTitle("Sync")
                .setContentText(chatNotifCount + " active chats")
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setGroup(GROUP_KEY_CHATS)
                .setGroupSummary(true)
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(contentIntent)
                .build();
            nm.notify(SUMMARY_NOTIFICATION_ID, summary);
        } catch (Exception ignored) {
        }
    }

    private PendingIntent buildLaunchPendingIntent(
        Map<String, String> data,
        String tag,
        String targetUrl,
        String conversationId,
        String noticeId,
        String messageId
    ) {
        Intent intent = new Intent(this, MainActivity.class);
        intent.setAction(Intent.ACTION_MAIN);
        intent.addCategory(Intent.CATEGORY_LAUNCHER);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);

        if (data != null) {
            for (Map.Entry<String, String> entry : data.entrySet()) {
                if (entry.getKey() != null && entry.getValue() != null) {
                    intent.putExtra(entry.getKey(), entry.getValue());
                }
            }
        }
        intent.putExtra("sync_target_url", targetUrl);
        intent.putExtra("sync_conv_id", conversationId);
        intent.putExtra("sync_notice_id", noticeId);
        intent.putExtra("google.message_id", !messageId.isEmpty() ? messageId : tag);

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return PendingIntent.getActivity(this, tag.hashCode(), intent, flags);
    }

    private JSONArray appendAndLoadStack(
        String conversationId,
        String messageId,
        String senderName,
        String messageText
    ) {
        JSONArray result = new JSONArray();
        try {
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String key = "conv_" + (conversationId.isEmpty() ? "default" : conversationId);
            String raw = prefs.getString(key, "[]");
            JSONArray existing = new JSONArray(raw);

            JSONArray filtered = new JSONArray();
            for (int i = 0; i < existing.length(); i++) {
                JSONObject obj = existing.optJSONObject(i);
                if (obj == null) continue;
                if (!messageId.isEmpty() && messageId.equals(obj.optString("id", ""))) {
                    continue;
                }
                filtered.put(obj);
            }

            JSONObject current = new JSONObject();
            current.put("id", messageId);
            current.put("sender", senderName);
            current.put("text", messageText);
            current.put("time", System.currentTimeMillis());
            filtered.put(current);

            int start = Math.max(0, filtered.length() - MAX_STACKED_MESSAGES);
            for (int i = start; i < filtered.length(); i++) {
                result.put(filtered.getJSONObject(i));
            }

            prefs.edit().putString(key, result.toString()).apply();
        } catch (Exception e) {
            try {
                JSONObject fallback = new JSONObject();
                fallback.put("sender", senderName);
                fallback.put("text", messageText);
                fallback.put("time", System.currentTimeMillis());
                result.put(fallback);
            } catch (Exception ignored) {
            }
        }
        return result;
    }

    private Bitmap loadAvatarOrInitials(String url, String name) {
        Bitmap remote = loadRemoteBitmap(url, 256);
        if (remote != null) {
            return cropCircleBitmap(remote, 192);
        }
        return createInitialsCircleBitmap(name);
    }

    private Bitmap loadRemoteBitmap(String urlStr, int maxDim) {
        if (urlStr == null || !urlStr.startsWith("https://")) return null;
        HttpURLConnection conn = null;
        try {
            URL url = new URL(urlStr);
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(4500);
            conn.setReadTimeout(4500);
            conn.setInstanceFollowRedirects(true);
            conn.setDoInput(true);
            conn.connect();
            if (conn.getResponseCode() != HttpURLConnection.HTTP_OK) return null;
            try (InputStream is = conn.getInputStream()) {
                Bitmap bmp = BitmapFactory.decodeStream(is);
                if (bmp == null) return null;
                if (bmp.getWidth() > maxDim || bmp.getHeight() > maxDim) {
                    float ratio = Math.min(
                        (float) maxDim / bmp.getWidth(),
                        (float) maxDim / bmp.getHeight()
                    );
                    int w = Math.max(1, Math.round(bmp.getWidth() * ratio));
                    int h = Math.max(1, Math.round(bmp.getHeight() * ratio));
                    return Bitmap.createScaledBitmap(bmp, w, h, true);
                }
                return bmp;
            }
        } catch (Exception e) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private Bitmap cropCircleBitmap(Bitmap src, int size) {
        Bitmap scaled = Bitmap.createScaledBitmap(src, size, size, true);
        Bitmap output = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(output);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        Rect rect = new Rect(0, 0, size, size);
        RectF rectF = new RectF(rect);

        canvas.drawARGB(0, 0, 0, 0);
        canvas.drawOval(rectF, paint);
        paint.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.SRC_IN));
        canvas.drawBitmap(scaled, rect, rect, paint);
        return output;
    }

    private Bitmap createInitialsCircleBitmap(String name) {
        int size = 192;
        Bitmap output = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(output);

        Paint bgPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        bgPaint.setColor(SYNC_DARK_BG);
        canvas.drawCircle(size / 2f, size / 2f, size / 2f, bgPaint);

        Paint ringPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        ringPaint.setStyle(Paint.Style.STROKE);
        ringPaint.setStrokeWidth(6f);
        ringPaint.setColor(0x5500ED64);
        canvas.drawCircle(size / 2f, size / 2f, (size / 2f) - 4f, ringPaint);

        String initials = extractInitials(name);
        Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        textPaint.setColor(SYNC_GREEN);
        textPaint.setTextSize(72f);
        textPaint.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        textPaint.setTextAlign(Paint.Align.CENTER);

        Paint.FontMetrics fm = textPaint.getFontMetrics();
        float y = (size / 2f) - ((fm.ascent + fm.descent) / 2f);
        canvas.drawText(initials, size / 2f, y, textPaint);
        return output;
    }

    private String extractInitials(String name) {
        if (name == null || name.trim().isEmpty()) return "S";
        String[] parts = name.trim().split("\\s+");
        StringBuilder sb = new StringBuilder();
        for (String p : parts) {
            if (!p.isEmpty()) {
                sb.append(Character.toUpperCase(p.charAt(0)));
                if (sb.length() >= 2) break;
            }
        }
        return sb.length() > 0 ? sb.toString() : "S";
    }

    private static int parseCount(String raw, int fallback) {
        if (raw == null || raw.isEmpty()) return fallback;
        try {
            return Math.max(0, Integer.parseInt(raw.trim()));
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private static String valueOr(Map<String, String> map, String key, String fallback) {
        if (map == null) return fallback;
        String val = map.get(key);
        return (val != null && !val.isEmpty()) ? val : fallback;
    }
}
JAVA

# ---------- 3. Splash screen (PWA-র মতো: গাঢ় ব্যাকগ্রাউন্ডে গোল লোগো) ----------
TMP="$(mktemp -d)"
CIRCLE_PX=640

"$IM" "$ICON" -resize "${CIRCLE_PX}x${CIRCLE_PX}" -alpha set \
    \( -size "${CIRCLE_PX}x${CIRCLE_PX}" xc:none -fill white -draw "circle 320,320 320,1.5" \) \
    -compose DstIn -composite "$TMP/circle.png"

mkdir -p "$RES/drawable-nodpi"
"$IM" -size 960x960 xc:none "$TMP/circle.png" -gravity center -composite "$RES/drawable-nodpi/sync_splash_icon.png"

cat > "$RES/values/sync_splash.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="sync_splash_bg">$SPLASH_BG</color>
</resources>
XML

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
patch("AppTheme.NoActionBar", [("android:windowBackground", "@color/sync_splash_bg")])
open(path, "w", encoding="utf-8").write(s)
print("splash theme patched")
PY

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

# ---------- 4b. Firebase Messaging dependency ----------
# SyncMessagingService, Capacitor-এর MessagingService (FirebaseMessagingService) কে extend করে ও RemoteMessage ব্যবহার করে।
# push-notifications plugin firebase-messaging কে `implementation` দিয়ে নেয়, তাই app module এ তা দেখা যায় না
# (compileDebugJavaWithJavac: "cannot access FirebaseMessagingService"). তাই app এ সরাসরি যোগ করা হলো।
python3 - "$GRADLE" <<'PY'
import re, sys
path = sys.argv[1]
s = open(path, encoding="utf-8").read()
if "ShortcutBadger" in s:
    print("dependencies already present"); sys.exit(0)
m = re.search(r"^dependencies\s*\{", s, re.M)
if not m:
    print("dependencies block not found", file=sys.stderr); sys.exit(1)
dep = "\n    implementation 'com.google.firebase:firebase-messaging:24.1.0'\n    implementation 'androidx.core:core:1.15.0'\n    implementation 'me.leolin:ShortcutBadger:1.1.22@aar'"
s = s[:m.end()] + dep + s[m.end():]
open(path, "w", encoding="utf-8").write(s)
print("firebase-messaging dependency added")
PY

# ---------- 5. Signing: repo-র debug.keystore স্পষ্টভাবে বসানো ----------
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
s = s[:m.start()] + signing + s[m.start():]
m = re.search(r"buildTypes\s*\{", s)
inject = "\n        debug {\n            signingConfig signingConfigs.syncfixed\n        }"
s = s[:m.end()] + inject + s[m.end():]
open(path, "w", encoding="utf-8").write(s)
print("signing configured with fixed keystore")
PY

echo "Android project customised with WhatsApp-style FCM notifications (versionCode ${VERSION_CODE})"
