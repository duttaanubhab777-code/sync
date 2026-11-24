// Sync PWA service worker (v6)
// - App shell precache (logo + icons), পরের বার অফলাইনেও UI খুলবে
// - Vite এর hashed /assets/* ফাইল: cache-first (immutable)
// - HTML: network-first (৪ সেকেন্ডের বেশি লাগলে cached shell), তাই ধীর নেটে অ্যাপ আটকে থাকে না
// - Cloudinary ছবি (প্রোফাইল ছবি, চ্যাটের ছবি, স্টোরি ছবি, wallpaper): একবার নামলে ডিভাইসে থাকে (সংখ্যার সীমা নেই)
// - /api ও /socket.io কখনো cache হয় না
// - Cloudinary ভিডিও/ভয়েস: পুরো ফাইল একবার নেমে ডিভাইসে থাকে; Range (seek) রিকোয়েস্ট cache থেকেই মেটানো হয়
//
// গুরুত্বপূর্ণ: নিচের "স্থায়ী" cache (images, wallpapers) ভার্সন বাড়ালেও মোছা হয় না।
// শুধু shell/assets পুরনো ভার্সন মোছা হয়। ইউজার নিজে ব্রাউজার/অ্যাপ ডেটা মুছলে তবেই ছবি যায়।
const VERSION = "v6";
const SHELL_CACHE = `sync-shell-${VERSION}`;
const ASSET_CACHE = `sync-assets-${VERSION}`;
const IMAGE_CACHE = "sync-images-v1"; // স্থায়ী
const MEDIA_CACHE = "sync-media-v1"; // স্থায়ী (ভিডিও/ভয়েস)
const PERSISTENT_CACHES = [IMAGE_CACHE, MEDIA_CACHE, "sync-wallpapers-v1", "sync-meta-v1"]; // কখনো মোছা হবে না
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

// Android APK-তে প্লাগিন থাকলে ছবি/ভিডিও ফোনের Data স্টোরেজে ফাইল হিসেবে সেভ হয় (nativeMedia.js)।
// তখন পেজ আমাদের জানায় (NATIVE_STORE মেসেজ) আর এখানে আবার cache করা হয় না (দুবার জায়গা নিত)।
// প্লাগিন না থাকলে (পুরনো APK) বা PWA/ওয়েবসাইটে এই cache-ই কাজ করে।
const NATIVE_FLAG = "/__native_store__";
const META_CACHE = "sync-meta-v1";
let nativeStore = null;
const hasNativeStore = async () => {
    if (nativeStore === null) {
        try {
            const c = await caches.open(META_CACHE);
            nativeStore = Boolean(await c.match(NATIVE_FLAG));
        } catch {
            nativeStore = false;
        }
    }
    return nativeStore;
};
self.addEventListener("message", event => {
    const type = event.data && event.data.type;
    if (type !== "NATIVE_STORE" && type !== "NO_NATIVE_STORE") return;
    const on = type === "NATIVE_STORE";
    nativeStore = on;
    event.waitUntil(
        caches
            .open(META_CACHE)
            .then(c =>
                on
                    ? c.put(NATIVE_FLAG, new Response("1"))
                    : c.delete(NATIVE_FLAG)
            )
            .catch(() => {})
    );
});

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
        // কোটা ভরা থাকলে আগে পুরনো ভিডিও, তারপর পুরনো ছবি সরানো (৫০টা করে), যতক্ষণ না জায়গা হয়
        while (await overQuota()) {
            let removed = 0;
            for (const name of [MEDIA_CACHE, IMAGE_CACHE]) {
                const cache = await caches.open(name);
                const keys = await cache.keys();
                if (!keys.length) continue;
                const batch = keys.slice(0, TRIM_BATCH);
                await Promise.all(batch.map(k => cache.delete(k)));
                removed += batch.length;
                break;
            }
            if (!removed) break;
        }
    } catch {
        /* ignore */
    } finally {
        trimming = false;
    }
};

const isCloudinaryMedia = url =>
    url.hostname === "res.cloudinary.com" && url.pathname.includes("/video/");

// cache-এ থাকা পূর্ণ ফাইল থেকে Range রিকোয়েস্টের উত্তর (ভিডিও seek/স্ট্রিমের জন্য দরকার)
const serveRange = async (request, cached) => {
    const range = request.headers.get("range");
    if (!range) return cached;
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (!m) return cached;
    const blob = await cached.blob();
    const size = blob.size;
    let start = m[1] === "" ? Math.max(0, size - Number(m[2])) : Number(m[1]);
    let end = m[1] === "" || m[2] === "" ? size - 1 : Number(m[2]);
    end = Math.min(end, size - 1);
    if (start > end || start >= size) {
        return new Response(null, {
            status: 416,
            headers: { "Content-Range": `bytes */${size}` }
        });
    }
    return new Response(blob.slice(start, end + 1), {
        status: 206,
        headers: {
            "Content-Type": cached.headers.get("Content-Type") || "video/mp4",
            "Content-Range": `bytes ${start}-${end}/${size}`,
            "Content-Length": String(end - start + 1),
            "Accept-Ranges": "bytes"
        }
    });
};

const inflightMedia = new Map();
const fetchFullMedia = url => {
    if (inflightMedia.has(url)) return inflightMedia.get(url);
    const job = (async () => {
        try {
            const res = await fetch(url, { mode: "cors", credentials: "omit" });
            if (!res || res.status !== 200) return;
            const cache = await caches.open(MEDIA_CACHE);
            await cache.put(url, res);
            await trimImages();
        } catch {
            /* ignore */
        } finally {
            inflightMedia.delete(url);
        }
    })();
    inflightMedia.set(url, job);
    return job;
};

const mediaResponse = async (event, request) => {
    const cache = await caches.open(MEDIA_CACHE);
    const cached = await cache.match(request.url);
    if (cached) return serveRange(request, cached);
    if (!request.headers.has("range")) {
        // পুরো ফাইল চাওয়া হলে (যেমন আগে-নামানো): একবারই নামিয়ে ব্রাউজারকে দেওয়া ও cache-এ রাখা
        try {
            const res = await fetch(request.url, {
                mode: "cors",
                credentials: "omit"
            });
            if (res && res.status === 200) {
                const copy = res.clone();
                event.waitUntil(
                    cache
                        .put(request.url, copy)
                        .then(trimImages)
                        .catch(() => {})
                );
            }
            return res;
        } catch {
            return fetch(request);
        }
    }
    // প্লেয়ার Range চাইছে: এখনকার প্লে নেট থেকেই চলুক, পাশাপাশি পুরো ফাইল cache করা শুরু
    // (পরের বার নেট লাগবে না)
    event.waitUntil(fetchFullMedia(request.url));
    return fetch(request);
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
    if (isCloudinaryImage(url)) {
        if (request.headers.has("range")) return;
        event.respondWith(
            hasNativeStore().then(native =>
                native ? fetch(request) : imageResponse(request)
            )
        );
        return;
    }
    if (isCloudinaryMedia(url)) {
        event.respondWith(
            hasNativeStore().then(native =>
                native ? fetch(request) : mediaResponse(event, request)
            )
        );
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
