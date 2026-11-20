import { useEffect, useState, useCallback, useRef } from "react";
import { useSelector } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";
import { Bell, BellRing, BellOff, Loader2 } from "lucide-react";
import { api } from "../../services/api.js";

const FCM_TOKEN_STORAGE_KEY = "sync_fcm_token";

const decodeBase64Url = value => {
    const padding = "=".repeat((4 - (value.length % 4)) % 4);
    const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
    return Uint8Array.from(atob(base64), char => char.charCodeAt(0));
};

// Android Capacitor অ্যাপের ভেতরে চলছে কিনা এবং PushNotifications প্লাগিন আছে কিনা
export const getNativePushPlugin = () => {
    if (typeof window === "undefined") return null;
    const cap = window.Capacitor;
    if (!cap) return null;
    if (typeof cap.isNativePlatform === "function" && !cap.isNativePlatform()) {
        return null;
    }
    return cap.Plugins?.PushNotifications || null;
};

// সাইন-আউট করার সময় বর্তমান ডিভাইসের FCM বা Web Push সাবস্ক্রিপশন সার্ভার থেকে মুছে ফেলা
export const unsubscribeDevicePush = async () => {
    try {
        const savedFcmToken = localStorage.getItem(FCM_TOKEN_STORAGE_KEY);
        if (savedFcmToken) {
            await api
                .delete("/api/v1/notifications/push-subscriptions", {
                    data: { token: savedFcmToken }
                })
                .catch(() => {});
            localStorage.removeItem(FCM_TOKEN_STORAGE_KEY);
        }

        if ("serviceWorker" in navigator && "PushManager" in window) {
            const reg = await navigator.serviceWorker.getRegistration();
            const sub = await reg?.pushManager?.getSubscription();
            if (sub?.endpoint) {
                await api
                    .delete("/api/v1/notifications/push-subscriptions", {
                        data: { endpoint: sub.endpoint }
                    })
                    .catch(() => {});
            }
        }
    } catch {
        // সাইন-আউট যেন কখনো আটকে না যায়
    }
};

/**
 * Sync Push Notification button & auto-sync controller.
 * - Android APK (Capacitor): Uses native Firebase Cloud Messaging (`PushNotifications` plugin)
 *   + `window.SyncNativeNotif` bridge for WhatsApp-style stacked notifications and deep-linking.
 * - Web / PWA: Automatically registers `/sw.js` and syncs Web Push subscription.
 */
export default function EnableNotifications() {
    const navigate = useNavigate();
    const location = useLocation();
    const userId = useSelector(state => state.auth.user?._id);
    const [state, setState] = useState("idle");
    const listenersBoundRef = useRef(false);

    // ১. Android Native FCM রেজিস্ট্রেশন ও টোকেন সিঙ্ক
    const syncNativePush = useCallback(async (askPermission = true) => {
        const pushPlugin = getNativePushPlugin();
        if (!pushPlugin) return false;

        try {
            let perm = await pushPlugin.checkPermissions();
            if (
                (perm?.receive === "prompt" ||
                    perm?.receive === "prompt-with-rationale") &&
                askPermission
            ) {
                setState("working");
                perm = await pushPlugin.requestPermissions();
            }

            if (perm?.receive === "denied") {
                setState("denied");
                return true;
            }
            if (perm?.receive !== "granted") {
                setState("idle");
                return true;
            }

            setState("working");
            await pushPlugin.register();

            // যদি আগে থেকেই টোকেন পাওয়া থাকে, সাথে সাথে সার্ভারে পাঠিয়ে রাখা
            const cachedToken = localStorage.getItem(FCM_TOKEN_STORAGE_KEY);
            if (cachedToken) {
                await api.post("/api/v1/notifications/push-subscriptions", {
                    provider: "fcm",
                    token: cachedToken,
                    platform: "android"
                });
                setState("enabled");
            }
            return true;
        } catch (err) {
            console.error("[Sync Android Push]", err);
            setState("error");
            return true;
        }
    }, []);

    // ২. ব্রাউজার / PWA Web Push রেজিস্ট্রেশন
    const syncWebSubscription = useCallback(async (askPermission = false) => {
        try {
            if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
                setState("unsupported");
                return;
            }
            if (!window.isSecureContext) {
                setState("secure-context");
                return;
            }

            let permission = Notification.permission;
            if (permission === "default" && askPermission) {
                setState("working");
                permission = await Notification.requestPermission();
            }

            if (permission === "denied") {
                setState("denied");
                return;
            }
            if (permission !== "granted") {
                setState("idle");
                return;
            }

            setState("working");
            const registration = await navigator.serviceWorker.register(
                "/sw.js",
                { scope: "/", updateViaCache: "none" }
            );
            registration.update().catch(() => {});
            await navigator.serviceWorker.ready;

            const configRes = await api.get("/api/v1/notifications/push-config");
            const config = configRes.data?.data;
            if (!config?.webPushEnabled || !config.publicKey) {
                setState("error");
                return;
            }

            let subscription = await registration.pushManager.getSubscription();
            if (!subscription) {
                subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: decodeBase64Url(config.publicKey)
                });
            }

            const subJson =
                typeof subscription.toJSON === "function"
                    ? subscription.toJSON()
                    : subscription;

            await api.post("/api/v1/notifications/push-subscriptions", subJson);
            setState("enabled");
        } catch (error) {
            console.error("[Sync notifications]", error);
            setState("error");
        }
    }, []);

    const handleEnableClick = useCallback(() => {
        if (getNativePushPlugin()) {
            syncNativePush(true);
        } else {
            syncWebSubscription(true);
        }
    }, [syncNativePush, syncWebSubscription]);

    // ৩. Android Native Push ইভেন্ট লিসেনার (টোকেন পাওয়া ও নোটিফিকেশনে ট্যাপ করলে চ্যাটে যাওয়া)
    useEffect(() => {
        if (!userId) return;
        const pushPlugin = getNativePushPlugin();
        if (!pushPlugin || listenersBoundRef.current) return;
        listenersBoundRef.current = true;

        let regHandle = null;
        let errHandle = null;
        let actionHandle = null;

        (async () => {
            try {
                regHandle = await pushPlugin.addListener(
                    "registration",
                    async token => {
                        const value = token?.value;
                        if (!value) return;
                        try {
                            localStorage.setItem(FCM_TOKEN_STORAGE_KEY, value);
                            await api.post(
                                "/api/v1/notifications/push-subscriptions",
                                {
                                    provider: "fcm",
                                    token: value,
                                    platform: "android"
                                }
                            );
                            setState("enabled");
                        } catch (e) {
                            console.error("[Sync FCM token save failed]", e);
                            setState("error");
                        }
                    }
                );

                errHandle = await pushPlugin.addListener(
                    "registrationError",
                    err => {
                        console.error("[Sync FCM registration error]", err);
                        setState("error");
                    }
                );

                actionHandle = await pushPlugin.addListener(
                    "pushNotificationActionPerformed",
                    action => {
                        const data = action?.notification?.data || {};
                        const targetUrl =
                            data.url ||
                            (data.conversationId
                                ? `/chats/${data.conversationId}`
                                : data.storyId
                                  ? "/stories"
                                  : "/");
                        if (targetUrl) navigate(targetUrl);
                    }
                );
            } catch (e) {
                console.error("[Sync native push listener error]", e);
            }
        })();

        return () => {
            listenersBoundRef.current = false;
            regHandle?.remove?.();
            errHandle?.remove?.();
            actionHandle?.remove?.();
        };
    }, [userId, navigate]);

    // ৪. লগইন হওয়ামাত্র Android-এ স্বয়ংক্রিয়ভাবে পারমিশন চাওয়া ও রেজিস্টার করা, আর ব্রাউজারে আগে পারমিশন থাকলে সিঙ্ক করা
    useEffect(() => {
        if (!userId) return;
        if (getNativePushPlugin()) {
            syncNativePush(true);
            return;
        }
        if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
            setState("unsupported");
            return;
        }
        if (Notification.permission === "granted") {
            syncWebSubscription(false);
        } else if (Notification.permission === "denied") {
            setState("denied");
        } else {
            setState("idle");
        }
    }, [userId, syncNativePush, syncWebSubscription]);

    // ৫. Android নোটিফিকেশনে ট্যাপ করে অ্যাপ খুললে (ঠান্ডা অবস্থায় বা ব্যাকগ্রাউন্ড থেকে) সরাসরি ওই চ্যাটে নিয়ে যাওয়া
    useEffect(() => {
        if (!userId) return;

        const consumePendingNavigation = () => {
            try {
                const nativeBridge = window.SyncNativeNotif;
                if (
                    nativeBridge &&
                    typeof nativeBridge.consumeInitialUrl === "function"
                ) {
                    const pendingUrl = nativeBridge.consumeInitialUrl();
                    if (pendingUrl && typeof pendingUrl === "string") {
                        navigate(pendingUrl);
                        return;
                    }
                }
                if (window.__SYNC_INITIAL_NAV__) {
                    const target = window.__SYNC_INITIAL_NAV__;
                    delete window.__SYNC_INITIAL_NAV__;
                    navigate(target);
                }
            } catch {
                // ignore
            }
        };

        consumePendingNavigation();

        const onNativeNavigate = event => {
            const url = event?.detail?.url;
            if (url && typeof url === "string") {
                navigate(url);
            } else {
                consumePendingNavigation();
            }
        };

        window.addEventListener("sync:native-navigate", onNativeNavigate);
        return () =>
            window.removeEventListener(
                "sync:native-navigate",
                onNativeNavigate
            );
    }, [userId, navigate]);

    // ৬. ইউজার যে চ্যাটটা খুলে দেখছে, Android-এ সেই চ্যাটের নোটিফিকেশন ও স্ট্যাক সাথে সাথে মুছে দেওয়া (WhatsApp-এর মতো)
    useEffect(() => {
        const match = /^\/chats\/([^/]+)/.exec(location.pathname || "");
        const activeConvId = match ? match[1] : "";
        try {
            if (
                window.SyncNativeNotif &&
                typeof window.SyncNativeNotif.setActiveChat === "function"
            ) {
                window.SyncNativeNotif.setActiveChat(activeConvId);
            }
        } catch {
            // ignore
        }
    }, [location.pathname]);

    // ৭. সার্ভিস ওয়ার্কার থেকে ক্লিক মেসেজ এলে সরাসরি চ্যাটে বা নোটিসে নিয়ে যাওয়া
    useEffect(() => {
        if (!("serviceWorker" in navigator)) return;
        const onMessage = event => {
            const data = event.data;
            if (data?.type === "SYNC_NOTIFICATION_CLICK" && data.url) {
                navigate(data.url);
            }
        };
        navigator.serviceWorker.addEventListener("message", onMessage);
        return () =>
            navigator.serviceWorker.removeEventListener("message", onMessage);
    }, [navigate]);

    const labels = {
        idle: "Enable push notifications",
        working: "Enabling notifications…",
        enabled: "Notifications active on this device",
        denied: "Notifications blocked — allow in app or browser settings",
        unsupported: "Push notifications are not supported by this browser",
        "secure-context": "Notifications require HTTPS",
        error: "Tap to retry enabling notifications"
    };

    return (
        <button
            className={`sync-notification-enable is-${state}`}
            type="button"
            onClick={handleEnableClick}
            disabled={state === "working"}
            aria-label={labels[state]}
            title={labels[state]}
            aria-live="polite"
        >
            {state === "working" ? (
                <Loader2 size={18} className="spin" />
            ) : state === "enabled" ? (
                <BellRing size={18} />
            ) : state === "denied" ? (
                <BellOff size={18} />
            ) : (
                <Bell size={18} />
            )}
            {state === "idle" && <span className="sync-notif-pulse" />}
            <span className="sync-notification-sr-only">{labels[state]}</span>
        </button>
    );
}
