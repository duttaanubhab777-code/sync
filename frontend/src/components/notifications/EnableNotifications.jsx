import { useEffect, useState, useCallback } from "react";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { Bell, BellRing, BellOff, Loader2 } from "lucide-react";
import { api } from "../../services/api.js";

const decodeBase64Url = value => {
    const padding = "=".repeat((4 - (value.length % 4)) % 4);
    const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
    return Uint8Array.from(atob(base64), char => char.charCodeAt(0));
};

/**
 * Sync Web Push Notification button & auto-sync controller.
 * - Automatically registers /sw.js and syncs subscription if permission is already granted.
 * - Uses authenticated `api` client so Bearer token is always sent.
 */
export default function EnableNotifications() {
    const navigate = useNavigate();
    const userId = useSelector(state => state.auth.user?._id);
    const [state, setState] = useState("idle");

    const syncSubscription = useCallback(async (askPermission = false) => {
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

            const configRes = await api.get("/api/notifications/push-config");
            const config = configRes.data?.data;
            if (!config?.enabled || !config.publicKey) {
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

            await api.post("/api/notifications/push-subscriptions", subJson);
            setState("enabled");
        } catch (error) {
            console.error("[Sync notifications]", error);
            setState("error");
        }
    }, []);

    // লগইন থাকলে এবং আগে থেকে permission দেওয়া থাকলে নিজে থেকেই subscription সিঙ্ক করে নেওয়া
    useEffect(() => {
        if (!userId) return;
        if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
            setState("unsupported");
            return;
        }
        if (Notification.permission === "granted") {
            syncSubscription(false);
        } else if (Notification.permission === "denied") {
            setState("denied");
        } else {
            setState("idle");
        }
    }, [userId, syncSubscription]);

    // সার্ভিস ওয়ার্কার থেকে ক্লিক মেসেজ এলে সরাসরি চ্যাটে বা নোটিসে নিয়ে যাওয়া
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
        denied: "Notifications blocked — allow in browser site settings",
        unsupported: "Push notifications are not supported by this browser",
        "secure-context": "Notifications require HTTPS",
        error: "Tap to retry enabling notifications"
    };

    return (
        <button
            className={`sync-notification-enable is-${state}`}
            type="button"
            onClick={() => syncSubscription(true)}
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
