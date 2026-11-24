// Sync PWA service worker (v6)
// - App shell precache (logo + icons), পরের বার অফলাইনেও UI খুলবে
// - Vite এর hashed /assets/* ফাইল: cache-first (immutable)
// - HTML: network-first (৪ সেকেন্ডের বেশি লাগলে cached shell), তাই ধীর নেটে অ্যাপ আটকে থাকে না
// - Cloudinary ছবি (প্রোফাইল ছবি, চ্যাটের ছবি, স্টোরি ছবি, wallpaper): একবার নামলে ডিভাইসে থাকে (সংখ্যার সীমা নেই)
// - /api ও /socket.io কখনো cache হয় না
// - ভিডিও/অডিও cache হয় না (বড় ফাইল + Range request), সেগুলো ব্রাউজারের নিজস্ব cache চালায়
//
// গুরুত্বপূর্ণ: নিচের "স্থায়ী" cache (images, wallpapers) ভার্সন বাড়ালেও মোছা হয় না।
// শুধু shell/assets পুরনো ভার্সন মোছা হয়। ইউজার নিজে ব্রাউজার/অ্যাপ ডেটা মুছলে তবেই ছবি যায়।
const VERSION = "v6";
const SHELL_CACHE = `sync-shell-${VERSION}`;
const ASSET_CACHE = `sync-assets-${VERSION}`;
const IMAGE_CACHE = "sync-images-v1"; // স্থায়ী
const PERSISTENT_CACHES = [IMAGE_CACHE, "sync-wallpapers-v1"]; // কখনো মোছা হবে না
// ছবির সংখ্যার সীমা নেই (WhatsApp-এর মতো সব সেভ থাকে)। শুধু ডিভাইসের স্টোরেজ quota-র
// এই অংশ ভরলে তবেই সবচেয়ে পুরনো ছবিগুলো সরানো হয়, যাতে ব্রাউজার পুরো cache একসাথে না মোছে।
const QUOTA_LIMIT = 0.8;
const TRIM_BATCH = 50;
const NAV_TIMEOUT_MS = 4000;

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
            .catch(() => {})
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
                            (key.startsWith("sync-shell-") ||
                                key.startsWith("sync-assets-")) &&
                            key !== SHELL_CACHE &&
                            key !== ASSET_CACHE &&
                            !PERSISTENT_CACHES.includes(key)
                    )
                    .map(key => caches.delete(key))
            );
            await self.clients.claim();
        })()
    );
});

// Android APK-তে ছবি/ভিডিও ফোনের Data স্টোরেজে ফাইল হিসেবে সেভ হয় (nativeMedia.js), তাই সেখানে
// এখানে আবার cache করা হয় না (দুবার জায়গা নিত)। PWA/ওয়েবসাইটে এই cache-ই ব্যবহার হয়।
const IN_APK = /SyncApp\//.test((self.navigator && self.navigator.userAgent) || "");

const isCloudinaryImage = url =>
    url.hostname === "res.cloudinary.com" && url.pathname.includes("/image/");

let trimming = false;
const overQuota = async () => {
    try {
        const est = await navigator.storage.estimate();
        if (!est || !est.quota) return false;
        return est.usage / est.quota > QUOTA_LIMIT;
    } catch {
        return false;
    }
};
const trimImages = async () => {
    if (trimming) return;
    trimming = true;
    try {
        const cache = await caches.open(IMAGE_CACHE);
        // কোটা ভরা থাকলে পুরনো থেকে ৫০টা করে সরানো, যতক্ষণ না জায়গা হয়
        while (await overQuota()) {
            const keys = await cache.keys();
            if (!keys.length) break;
            await Promise.all(keys.slice(0, TRIM_BATCH).map(k => cache.delete(k)));
        }
    } catch {
        /* ignore */
    } finally {
        trimming = false;
    }
};

const imageResponse = async request => {
    // সব cache-এ খোঁজা (wallpaper cache-এ পেজ নিজে যেগুলো রেখেছে সেগুলোও পাওয়া যাবে)
    const hit = await caches.match(request.url);
    if (hit) return hit;
    try {
        // no-cors <img> রিকোয়েস্ট opaque হয় (কোটায় ~৭MB ধরে); CORS দিয়ে আনলে আসল সাইজ
        const response = await fetch(request.url, {
            mode: "cors",
            credentials: "omit"
        });
        if (response && response.ok) {
            const copy = response.clone();
            caches
                .open(IMAGE_CACHE)
                .then(cache => cache.put(request.url, copy))
                .then(trimImages)
                .catch(() => {});
        }
        return response;
    } catch {
        // CORS ব্যর্থ হলে সাধারণ ভাবে আনা (cache ছাড়া)
        return fetch(request);
    }
};

self.addEventListener("fetch", event => {
    const request = event.request;
    if (request.method !== "GET") return;

    const url = new URL(request.url);

    // Cloudinary ছবি: ডিভাইসে সেভ, cache-first
    if (!IN_APK && isCloudinaryImage(url) && request.destination !== "video") {
        if (request.headers.has("range")) return;
        event.respondWith(imageResponse(request));
        return;
    }

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

    // পেজ নেভিগেশন: network-first, ধীর হলে cached shell
    if (request.mode === "navigate") {
        event.respondWith(
            (async () => {
                const fromCache = async () =>
                    (await caches.match("/index.html")) ||
                    (await caches.match("/"));
                const network = fetch(request).then(response => {
                    if (response && response.ok) {
                        const copy = response.clone();
                        caches
                            .open(SHELL_CACHE)
                            .then(cache => cache.put("/index.html", copy));
                    }
                    return response;
                });
                const cached = await fromCache();
                if (!cached) return network;
                try {
                    return await Promise.race([
                        network,
                        new Promise((_, reject) =>
                            setTimeout(reject, NAV_TIMEOUT_MS)
                        )
                    ]);
                } catch {
                    network.catch(() => {});
                    return cached;
                }
            })()
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
