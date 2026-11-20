// অ্যাপ আইকনের unread badge (WhatsApp-এর মতো)।
// - Android অ্যাপ: native bridge (SyncNativeNotif.setBadge) দিয়ে লঞ্চার আইকনে সংখ্যা বসে
// - PWA / ব্রাউজার: Badging API (navigator.setAppBadge) + ট্যাবের টাইটেলে "(3) Sync"
const BASE_TITLE = "Sync";
let lastCount = null;

const clamp = n => Math.max(0, Math.min(99999, Math.floor(Number(n) || 0)));

export function setAppBadge(count) {
    const n = clamp(count);
    if (n === lastCount) return;
    lastCount = n;

    // Android অ্যাপের ভেতরে
    try {
        const bridge = window.SyncNativeNotif;
        if (bridge && typeof bridge.setBadge === "function") bridge.setBadge(n);
    } catch {
        // ignore
    }

    // PWA / ব্রাউজার (সব ডিভাইসে সাপোর্ট নেই, তাই try/catch)
    try {
        if (n > 0 && typeof navigator.setAppBadge === "function") {
            navigator.setAppBadge(n).catch(() => {});
        } else if (n === 0 && typeof navigator.clearAppBadge === "function") {
            navigator.clearAppBadge().catch(() => {});
        }
    } catch {
        // ignore
    }

    // ট্যাব / উইন্ডোর টাইটেল
    try {
        document.title = n > 0 ? `(${n > 99 ? "99+" : n}) ${BASE_TITLE}` : BASE_TITLE;
    } catch {
        // ignore
    }
}

export const clearAppBadge = () => setAppBadge(0);

// লগআউটের পর আবার একই সংখ্যা এলেও যেন আপডেট হয়
export const resetAppBadgeCache = () => {
    lastCount = null;
};
