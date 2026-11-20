/* Sync Web Push service worker (v3 — WhatsApp-style conversation stacking)
 *  - চ্যাট মেসেজ ও Admin notice দুটোই দেখায়
 *  - একই চ্যাটে একাধিক মেসেজ এলে WhatsApp-এর মতো একসাথে পরপর লাইনে সাজিয়ে দেখায়
 *  - প্রেরকের প্রোফাইল ছবি (senderAvatar) বা গ্রুপ আইকন দেখায়
 *  - notice-এ বড় ছবি (image) + "Ends tomorrow at 11:58 pm" লাইন ও কাউন্টডাউন (ডিভাইসের নিজের timezone-এ)
 *  - ইউজার অ্যাপ খুলে ওই চ্যাটেই থাকলে আলাদা notification দেখায় না
 *  - notification-এ চাপলে সরাসরি ওই চ্যাটে বা নোটিসে যায়
 */
const ICON = "/icons/icon-192.png"; // Android/Chrome-এ SVG আইকন দেখায় না, তাই PNG
const BADGE = "/icons/notification-badge.png"; // স্ট্যাটাস বারের ছোট সাদা আইকন

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

const timeFmt = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true
});
const dateFmt = new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short"
});
const dayStart = d =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

// "Ends today at 9:30 pm" / "Ends tomorrow at 11:58 pm" / "Ends 12 Nov at 11:58 pm"
const endsLine = iso => {
    const end = new Date(iso);
    if (Number.isNaN(end.getTime()) || end.getTime() <= Date.now()) return "";
    const days = Math.round((dayStart(end) - dayStart(new Date())) / 86400000);
    const when =
        days <= 0 ? "today" : days === 1 ? "tomorrow" : dateFmt.format(end);
    const diffSec = Math.max(0, Math.floor((end.getTime() - Date.now()) / 1000));
    const hrs = String(Math.floor(diffSec / 3600)).padStart(2, "0");
    const mins = String(Math.floor((diffSec % 3600) / 60)).padStart(2, "0");
    const secs = String(diffSec % 60).padStart(2, "0");
    return `⏳ Ends ${when} at ${timeFmt.format(end).toLowerCase()} · ⏱ ${hrs}:${mins}:${secs}`;
};

// অ্যাপ আইকনের unread badge (PWA ইনস্টল করা থাকলে; সার্ভার badgeCount পাঠায়)
const applyBadge = async count => {
    try {
        const n = Math.max(0, Math.floor(Number(count) || 0));
        const nav = self.navigator;
        if (n > 0 && nav && typeof nav.setAppBadge === "function") {
            await nav.setAppBadge(n);
        } else if (n === 0 && nav && typeof nav.clearAppBadge === "function") {
            await nav.clearAppBadge();
        }
    } catch {
        // সব ডিভাইসে Badging API নেই, সমস্যা নেই
    }
};

self.addEventListener("push", event => {
    let payload = {};
    try {
        payload = event.data ? event.data.json() : {};
    } catch {
        payload = { body: event.data?.text() || "" };
    }

    event.waitUntil(
        (async () => {
            const type = payload.type || "message";
            const data = payload.data || {};
            const convId = data.conversationId ? String(data.conversationId) : "";

            // চ্যাট মেসেজ হলে আইকনে মোট unread সংখ্যা বসানো (notice-এ badge বদলায় না)
            if (type !== "notice" && payload.badgeCount !== undefined) {
                await applyBadge(payload.badgeCount);
            }

            // ইউজার যদি অ্যাপ খুলে ঠিক ওই চ্যাটেই থাকে, তবে চ্যাট মেসেজের আলাদা push দেখানোর দরকার নেই
            if (type !== "notice" && convId) {
                const winClients = await self.clients.matchAll({
                    type: "window",
                    includeUncontrolled: true
                });
                const viewingSameChat = winClients.some(client => {
                    if (!client.focused && client.visibilityState !== "visible") {
                        return false;
                    }
                    try {
                        const u = new URL(client.url);
                        return u.pathname === `/chats/${convId}`;
                    } catch {
                        return false;
                    }
                });
                if (viewingSameChat) return;
            }

            const tag =
                payload.tag ||
                (type === "notice" ? "sync-notice" : "sync-notification");

            let title = payload.title || "Sync";
            let body = payload.body || "You have a new notification";
            let lines = [body];

            // একই চ্যাটের আগের না-দেখা মেসেজ থাকলে WhatsApp-এর মতো একসাথে জড়ো করে দেখানো
            if (type !== "notice" && convId && self.registration.getNotifications) {
                try {
                    const existing = await self.registration.getNotifications({
                        tag
                    });
                    if (existing.length > 0) {
                        const prevLines = existing[0].data?.lines;
                        if (Array.isArray(prevLines) && prevLines.length > 0) {
                            lines = [...prevLines, body].slice(-5);
                            body = lines.join("\n");
                            title = `${payload.title || "Sync"} (${lines.length} new messages)`;
                        }
                    }
                } catch {
                    // ignore
                }
            }

            if (type === "notice" && payload.endsAt) {
                const line = endsLine(payload.endsAt);
                if (line) body = body ? `${body}\n${line}` : line;
            }

            const options = {
                body,
                icon:
                    payload.senderAvatar ||
                    payload.groupIcon ||
                    payload.icon ||
                    ICON,
                badge: BADGE,
                tag,
                renotify: true,
                requireInteraction: Boolean(
                    payload.requireInteraction || type === "notice"
                ),
                vibrate:
                    type === "notice"
                        ? [220, 100, 220, 100, 280]
                        : [180, 80, 180],
                data: {
                    ...data,
                    type,
                    lines,
                    url: data.url || (convId ? `/chats/${convId}` : "/")
                },
                timestamp: Date.now()
            };

            if (payload.image) {
                options.image = payload.image;
            }

            await self.registration.showNotification(title, options);
        })()
    );
});

self.addEventListener("notificationclick", event => {
    event.notification.close();
    const data = event.notification.data || {};
    const target = data.url || "/";

    event.waitUntil(
        (async () => {
            const windows = await self.clients.matchAll({
                type: "window",
                includeUncontrolled: true
            });
            for (const client of windows) {
                try {
                    const u = new URL(client.url);
                    if (u.origin === self.location.origin) {
                        if ("focus" in client) await client.focus();
                        client.postMessage({
                            type: "SYNC_NOTIFICATION_CLICK",
                            url: target,
                            noticeId: data.noticeId || null,
                            conversationId: data.conversationId || null
                        });
                        if (target && "navigate" in client && u.pathname !== target) {
                            await client.navigate(target);
                        }
                        return;
                    }
                } catch {
                    // ignore
                }
            }
            if (self.clients.openWindow) {
                await self.clients.openWindow(target);
            }
        })()
    );
});
