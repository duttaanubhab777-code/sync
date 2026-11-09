import { useState } from "react";

const decodeBase64Url = value => {
    const padding = "=".repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
    return Uint8Array.from(atob(base64), char => char.charCodeAt(0));
};

/**
 * Place this button in the signed-in user's Settings or Notifications screen.
 * Permission is requested only after an explicit user click.
 */
export default function EnableNotifications() {
    const [state, setState] = useState("idle");

    const enable = async () => {
        try {
            if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
                setState("unsupported");
                return;
            }
            if (!window.isSecureContext) {
                setState("secure-context");
                return;
            }
            setState("working");
            const permission = await Notification.requestPermission();
            if (permission !== "granted") {
                setState("denied");
                return;
            }

            const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
            const configResponse = await fetch("/api/notifications/push-config", { credentials: "include" });
            if (!configResponse.ok) throw new Error("Could not load notification configuration");
            const config = (await configResponse.json()).data;
            if (!config?.enabled || !config.publicKey) throw new Error("Push notifications are not configured");

            let subscription = await registration.pushManager.getSubscription();
            if (!subscription) {
                subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: decodeBase64Url(config.publicKey)
                });
            }

            const response = await fetch("/api/notifications/push-subscriptions", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(subscription)
            });
            if (!response.ok) throw new Error("Could not save this device");
            setState("enabled");
        } catch (error) {
            console.error("[Sync notifications]", error);
            setState("error");
        }
    };

    const labels = {
        idle: "Enable notifications",
        working: "Enabling…",
        enabled: "Notifications enabled",
        denied: "Permission denied — enable it in browser settings",
        unsupported: "Push notifications are not supported by this browser",
        "secure-context": "Notifications require HTTPS",
        error: "Could not enable notifications. Please try again."
    };

    return (
        <button className="sync-notification-enable" type="button" onClick={enable} disabled={state === "working" || state === "enabled"} aria-live="polite">
            {labels[state]}
        </button>
    );
}
