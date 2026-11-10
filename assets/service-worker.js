// Sync PWA service worker
// - App shell precache (logo + icons), পরের বার অফলাইনেও UI খুলবে
// - Vite এর hashed /assets/* ফাইল: cache-first (immutable)
// - HTML: network-first, নেট না থাকলে cached shell
// - /api ও /socket.io কখনো cache হয় না
const VERSION = "v4";
const SHELL_CACHE = `sync-shell-${VERSION}`;
const ASSET_CACHE = `sync-assets-${VERSION}`;

const APP_SHELL = [
    "/",
    "/index.html",
    "/manifest.webmanifest",
    "/logo-mark.webp",
    "/icons/icon-192.png",
    "/icons/icon-512.png",
    "/icons/favicon-32.png",
    "/icons/notification-badge.png"
];

self.addEventListener("install", event => {
    event.waitUntil(
        caches
            .open(SHELL_CACHE)
            .then(cache => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", event => {
    event.waitUntil(
        (async () => {
            const keys = await caches.keys();
            await Promise.all(
                keys
                    .filter(
                        key =>
                            key.startsWith("sync-") &&
                            key !== SHELL_CACHE &&
                            key !== ASSET_CACHE
                    )
                    .map(key => caches.delete(key))
            );
            await self.clients.claim();
        })()
    );
});

self.addEventListener("fetch", event => {
    const request = event.request;
    if (request.method !== "GET") return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;
    if (
        url.pathname.startsWith("/api/") ||
        url.pathname.startsWith("/socket.io/") ||
        url.pathname === "/health" ||
        url.pathname === "/sw.js" ||
        url.pathname === "/service-worker.js"
    ) {
        return;
    }

    // পেজ নেভিগেশন: network-first
    if (request.mode === "navigate") {
        event.respondWith(
            fetch(request)
                .then(response => {
                    if (response && response.ok) {
                        const copy = response.clone();
                        caches
                            .open(SHELL_CACHE)
                            .then(cache => cache.put("/index.html", copy));
                    }
                    return response;
                })
                .catch(
                    async () =>
                        (await caches.match("/index.html")) ||
                        (await caches.match("/"))
                )
        );
        return;
    }

    // Vite hashed ফাইল (js/css/font): একবার cache হলে আর নেট লাগে না
    if (url.pathname.startsWith("/assets/")) {
        event.respondWith(
            caches.open(ASSET_CACHE).then(async cache => {
                const cached = await cache.match(request);
                if (cached) return cached;
                const response = await fetch(request);
                if (response && response.ok) cache.put(request, response.clone());
                return response;
            })
        );
        return;
    }

    // লোগো, আইকন, manifest: stale-while-revalidate
    const isStatic =
        url.pathname.startsWith("/icons/") ||
        url.pathname === "/logo-mark.webp" ||
        url.pathname === "/Sync.png" ||
        url.pathname === "/manifest.webmanifest";

    if (isStatic) {
        event.respondWith(
            caches.open(SHELL_CACHE).then(async cache => {
                const cached = await cache.match(request);
                const network = fetch(request)
                    .then(response => {
                        if (response && response.ok) {
                            cache.put(request, response.clone());
                        }
                        return response;
                    })
                    .catch(() => cached);
                return cached || network;
            })
        );
    }
});

importScripts("/sw.js");
