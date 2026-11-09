/* Sync Web Push service worker */
self.addEventListener("push", event => {
    let payload = {};
    try { payload = event.data ? event.data.json() : {}; } catch { payload = { body: event.data?.text() || "" }; }
    const title = payload.title || "Sync";
    const options = {
        body: payload.body || "You have a new notification",
        icon: "/sync-notification-icon.svg",
        badge: "/sync-notification-icon.svg",
        tag: payload.tag || "sync-notification",
        renotify: true,
        data: payload.data || {},
        timestamp: Date.now()
    };
    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", event => {
    event.notification.close();
    const target = event.notification.data?.url || "/";
    event.waitUntil((async () => {
        const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
        for (const client of windows) {
            if ("focus" in client) {
                await client.focus();
                if (target && "navigate" in client) await client.navigate(target);
                return;
            }
        }
        if (clients.openWindow) await clients.openWindow(target);
    })());
});
