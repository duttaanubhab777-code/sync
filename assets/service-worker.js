// Sync PWA service worker (v7)
// - App shell precache (logo + icons), পরের বার অফলাইনেও UI খুলবে
// - Vite এর hashed /assets/* ফাইল: cache-first (immutable)
// - HTML: network-first (৪ সেকেন্ডের বেশি লাগলে cached shell), তাই ধীর নেটে অ্যাপ আটকে থাকে না
// - Cloudinary ছবি (প্রোফাইল ছবি, চ্যাটের ছবি, স্টোরি ছবি, wallpaper): একবার নামলে ডিভাইসে থাকে (সংখ্যার সীমা নেই)
// - /api ও /socket.io কখনো cache হয় না
// - Cloudinary ভিডিও/ভয়েস: পুরো ফাইল একবার নেমে ডিভাইসে থাকে; Range (seek) রিকোয়েস্ট cache থেকেই মেটানো হয়
// - Background Sync ("sync-outbox") + ট্যাব বন্ধ হ্যান্ডঅফ: ট্যাব কেটে দিলেও বা নেট ফিরলে
//   IndexedDB-র বাকি চ্যাট মিডিয়া ও স্টোরি ব্যাকগ্রাউন্ডে আপলোড ও পোস্ট করে (WhatsApp-এর মতো)
//
// গুরুত্বপূর্ণ: নিচের "স্থায়ী" cache (images, wallpapers) ভার্সন বাড়ালেও মোছা হয় না।
// শুধু shell/assets পুরনো ভার্সন মোছা হয়। ইউজার নিজে ব্রাউজার/অ্যাপ ডেটা মুছলে তবেই ছবি যায়।
const VERSION = "v7";
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

// ---------------------------------------------------------------------------
// Background Outbox Runner (ট্যাব কেটে দিলেও বা অফলাইন থেকে অনলাইনে এলে ব্যাকগ্রাউন্ডে পাঠানো)
// ---------------------------------------------------------------------------
const OUTBOX_DB = "sync-outbox";
const OUTBOX_DB_VER = 2;
const OUTBOX_JOBS = "jobs";
const OUTBOX_META = "meta";
const SW_CHUNK_THRESHOLD = 10 * 1024 * 1024;
const SW_CHUNK_SIZE = 6 * 1024 * 1024;
let swOutboxRunning = false;

const openOutboxDb = () =>
    new Promise(resolve => {
        try {
            const req = indexedDB.open(OUTBOX_DB, OUTBOX_DB_VER);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(OUTBOX_JOBS)) {
                    db.createObjectStore(OUTBOX_JOBS, { keyPath: "id" });
                }
                if (!db.objectStoreNames.contains(OUTBOX_META)) {
                    db.createObjectStore(OUTBOX_META, { keyPath: "key" });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
        } catch {
            resolve(null);
        }
    });

const idbRun = async (storeName, mode, fn) => {
    const db = await openOutboxDb();
    if (!db) return null;
    return new Promise(resolve => {
        let out = null;
        try {
            const tx = db.transaction(storeName, mode);
            const os = tx.objectStore(storeName);
            const req = fn(os);
            if (req) req.onsuccess = () => (out = req.result);
            tx.oncomplete = () => {
                db.close();
                resolve(out);
            };
            tx.onerror = () => {
                db.close();
                resolve(null);
            };
            tx.onabort = () => {
                db.close();
                resolve(null);
            };
        } catch {
            db.close();
            resolve(null);
        }
    });
};

const swDetectKind = file => {
    const mime = String(file?.type || "").toLowerCase();
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("video/")) return "video";
    if (mime.startsWith("audio/")) return "audio";
    const name = String(file?.name || "").toLowerCase();
    if (/\.(jpe?g|png|webp|gif|heic|heif|avif)$/.test(name)) return "image";
    if (/\.(mp4|mov|webm|m4v|3gp|ogv|mkv)$/.test(name)) return "video";
    if (/\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|weba)$/.test(name)) return "audio";
    return "file";
};

const swRefreshToken = async auth => {
    const base = auth.apiBaseUrl || "";
    const res = await fetch(`${base}/api/v1/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(auth.refreshToken ? { refreshToken: auth.refreshToken } : {})
    });
    if (!res.ok) throw new Error("REFRESH_FAILED");
    const json = await res.json();
    const newAccessToken = json?.data?.accessToken;
    if (!newAccessToken) throw new Error("NO_TOKEN");
    auth.accessToken = newAccessToken;
    auth.updatedAt = Date.now();
    await idbRun(OUTBOX_META, "readwrite", os => os.put(auth));
    return newAccessToken;
};

const swFetchWithAuth = async (url, init, auth) => {
    const run = token =>
        fetch(url, {
            ...init,
            headers: {
                ...(init.headers || {}),
                Authorization: `Bearer ${token}`
            }
        });
    let res = await run(auth.accessToken);
    if (res.status === 401) {
        const fresh = await swRefreshToken(auth);
        res = await run(fresh);
    }
    return res;
};

const swUploadToCloudinary = async (job, auth) => {
    const file = job.prepared || job.file;
    if (!file) return null;
    if (!auth.pyBaseUrl) throw new Error("NO_PY_URL");

    const purpose = job.options?.purpose || (job.kind === "story" ? "story" : "chat");
    const getSign = async () => {
        const res = await swFetchWithAuth(
            `${auth.pyBaseUrl}/api/v1/media/sign`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ purpose })
            },
            auth
        );
        if (!res.ok) throw new Error(`SIGN_HTTP_${res.status}`);
        const body = await res.json();
        return body?.data || body;
    };

    const detected = swDetectKind(file);
    const resourceEndpoint = detected === "file" ? "raw" : "auto";
    const total = file.size;
    const useChunks = total > SW_CHUNK_THRESHOLD;

    const canResume =
        useChunks &&
        job.chunkState &&
        job.chunkState.uploadId &&
        job.chunkState.signData &&
        Number(job.chunkState.offset) > 0 &&
        Number(job.chunkState.offset) < total &&
        Number(job.chunkState.total) === total;

    let signData = canResume ? job.chunkState.signData : await getSign();
    let uploadId =
        canResume
            ? job.chunkState.uploadId
            : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    let offset = canResume ? Number(job.chunkState.offset) : 0;

    const uploadUrl = `https://api.cloudinary.com/v1_1/${signData.cloudName}/${resourceEndpoint}/upload`;
    const appendFields = fd => {
        fd.append("api_key", signData.apiKey);
        fd.append("timestamp", String(signData.timestamp));
        if (signData.folder) fd.append("folder", signData.folder);
        if (signData.allowedFormats) fd.append("allowed_formats", signData.allowedFormats);
        fd.append("signature", signData.signature);
    };

    let data = null;
    if (!useChunks) {
        const fd = new FormData();
        appendFields(fd);
        fd.append("file", file, job.fileName || file.name || "file");
        const res = await fetch(uploadUrl, { method: "POST", body: fd });
        if (!res.ok) throw new Error(`CLOUD_HTTP_${res.status}`);
        data = await res.json();
    } else {
        while (offset < total) {
            const end = Math.min(offset + SW_CHUNK_SIZE, total);
            const isLast = end >= total;
            const part = file.slice(offset, end);
            const fd = new FormData();
            appendFields(fd);
            fd.append("file", part, job.fileName || file.name || "file");
            const res = await fetch(uploadUrl, {
                method: "POST",
                headers: {
                    "X-Unique-Upload-Id": uploadId,
                    "Content-Range": `bytes ${offset}-${end - 1}/${total}`
                },
                body: fd
            });
            if (!res.ok) {
                // signature মেয়াদোত্তীর্ণ হলে chunkState মুছে ফেলা যাতে পরের রিট্রাই নতুন করে শুরু হয়
                if (res.status === 400 || res.status === 401) {
                    job.chunkState = null;
                    await idbRun(OUTBOX_JOBS, "readwrite", os => os.put(job));
                }
                throw new Error(`CLOUD_CHUNK_HTTP_${res.status}`);
            }
            if (isLast) data = await res.json();
            offset = end;
            if (!isLast) {
                job.chunkState = { uploadId, offset, total, signData };
                await idbRun(OUTBOX_JOBS, "readwrite", os => os.put(job));
            }
        }
    }

    return {
        url: data.secure_url,
        publicId: data.public_id,
        mime: file.type || `${data.resource_type}/${data.format || "bin"}`,
        fileName: job.fileName || file.name || "",
        bytes: data.bytes,
        width: data.width,
        height: data.height,
        duration: data.duration
    };
};

const notifyClientsDone = async payload => {
    try {
        const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        for (const c of wins) {
            c.postMessage({ type: "SYNC_OUTBOX_DONE", ...payload });
        }
    } catch {
        /* ignore */
    }
};

const processOutboxInSW = async ({ force = false } = {}) => {
    if (swOutboxRunning) return;
    swOutboxRunning = true;
    try {
        // কোনো ট্যাব খোলা ও দৃশ্যমান থাকলে পেজের নিজের outbox.js-ই কাজ করছে — দুজন একসাথে না চালানো
        if (!force) {
            const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
            const hasVisibleWindow = wins.some(w => w.visibilityState === "visible");
            if (hasVisibleWindow) return;
        } else {
            // pagehide-এর পর ট্যাব বন্ধ হতে একটু সময় দেওয়া
            await new Promise(r => setTimeout(r, 900));
            const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
            const hasVisibleWindow = wins.some(w => w.visibilityState === "visible");
            if (hasVisibleWindow) return;
        }

        const auth = await idbRun(OUTBOX_META, "readonly", os => os.get("auth"));
        if (!auth?.accessToken || !auth?.userId) return;

        const jobs = (await idbRun(OUTBOX_JOBS, "readonly", os => os.getAll())) || [];
        const pending = jobs.filter(
            j =>
                j &&
                j.id &&
                String(j.userId) === String(auth.userId) &&
                (j.stage !== "failed" || j.retryable !== false)
        );
        if (!pending.length) return;

        let hadRetryableError = false;
        const apiBase = auth.apiBaseUrl || "";

        for (const job of pending) {
            try {
                if (!job.media && job.file) {
                    const media = await swUploadToCloudinary(job, auth);
                    job.media = media;
                    job.chunkState = null;
                    job.stage = "sending";
                    await idbRun(OUTBOX_JOBS, "readwrite", os => os.put(job));
                }

                if (job.kind === "story") {
                    const payload = {
                        type: job.storyType || job.type || "text",
                        caption: job.caption || "",
                        backgroundColor: job.backgroundColor || "#0F4C3A",
                        clientStoryId: job.id
                    };
                    if (job.media) payload.media = job.media;
                    const res = await swFetchWithAuth(
                        `${apiBase}/api/v1/stories`,
                        {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(payload)
                        },
                        auth
                    );
                    if (!res.ok) {
                        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
                            job.stage = "failed";
                            job.retryable = false;
                            await idbRun(OUTBOX_JOBS, "readwrite", os => os.put(job));
                            continue;
                        }
                        throw new Error(`STORY_HTTP_${res.status}`);
                    }
                    await idbRun(OUTBOX_JOBS, "readwrite", os => os.delete(job.id));
                    await notifyClientsDone({ id: job.id, kind: "story" });
                } else {
                    const wire = {
                        conversationId: job.conversationId,
                        clientMsgId: job.id,
                        type: job.type,
                        text: job.caption || "",
                        media: job.media,
                        location: null,
                        contact: null,
                        replyTo: job.replyToId || null
                    };
                    const res = await swFetchWithAuth(
                        `${apiBase}/api/v1/messages`,
                        {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(wire)
                        },
                        auth
                    );
                    if (!res.ok) {
                        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
                            job.stage = "failed";
                            job.retryable = false;
                            await idbRun(OUTBOX_JOBS, "readwrite", os => os.put(job));
                            continue;
                        }
                        throw new Error(`MSG_HTTP_${res.status}`);
                    }
                    const json = await res.json().catch(() => ({}));
                    const message = json?.data?.message || json?.data || null;
                    await idbRun(OUTBOX_JOBS, "readwrite", os => os.delete(job.id));
                    await notifyClientsDone({ id: job.id, kind: "chat", message });
                }
            } catch {
                hadRetryableError = true;
            }
        }

        // ব্যর্থ হলে throw করি যাতে ব্রাউজারের Background Sync নেট এলেই আবার রিট্রাই করে
        if (hadRetryableError) {
            throw new Error("RETRY_OUTBOX");
        }
    } finally {
        swOutboxRunning = false;
    }
};

self.addEventListener("sync", event => {
    if (event.tag === "sync-outbox") {
        event.waitUntil(processOutboxInSW({ force: false }));
    }
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
    if (type === "SYNC_OUTBOX_BG") {
        event.waitUntil(processOutboxInSW({ force: true }).catch(() => {}));
        return;
    }
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
    event.waitUntil(fetchFullMedia(request.url));
    return fetch(request);
};

const imageResponse = async request => {
    const hit = await caches.match(request.url);
    if (hit) return hit;
    try {
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
        return fetch(request);
    }
};

self.addEventListener("fetch", event => {
    const request = event.request;
    if (request.method !== "GET") return;

    const url = new URL(request.url);

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
