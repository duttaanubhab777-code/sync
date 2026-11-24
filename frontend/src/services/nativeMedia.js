import { useCallback, useEffect, useState } from "react";

// Android অ্যাপে (APK) চ্যাটের ছবি/ভিডিও/ভয়েস, স্টোরি ও wallpaper ফোনের নিজস্ব Data স্টোরেজে ফাইল হিসেবে সেভ রাখা
// (WhatsApp-এর মতো): একবার নামলে আর কখনো নেট লাগে না, অ্যাপ বন্ধ/ট্যাব ক্লিয়ার করলেও থাকে।
//
// - শুধু APK-তে (@capacitor/filesystem প্লাগিন থাকলে) চলে। PWA/ওয়েবসাইটে এটা কিছুই করে না,
//   সেখানে service worker-এর Cache Storage ব্যবহার হয় (public/service-worker.js)।
// - ফাইল যায় অ্যাপের private Data ফোল্ডারে (Directory.Data), কোনো storage permission লাগে না।
// - কোন URL কোন ফাইল তার তালিকা localStorage-এ থাকে।
// - ছবি ও ভয়েস: সবসময় অটো সেভ। ভিডিও: Wi-Fi/ইথারনেটে অটো সেভ, মোবাইল ডেটায় প্লে চাপলে সেভ
//   (যাতে ডেটা অযথা খরচ না হয়)।
const INDEX_KEY = "sync_native_media_v1";
const DIR = "media";
const DATA = "DATA"; // Directory.Data
const WORKERS = 3;

const capacitor = () =>
    typeof window !== "undefined" ? window.Capacitor : undefined;

let pluginRef;
const getFs = () => {
    if (pluginRef !== undefined) return pluginRef;
    pluginRef = null;
    const cap = capacitor();
    if (!cap || !cap.isNativePlatform?.()) return pluginRef;
    if (cap.Plugins?.Filesystem) {
        pluginRef = cap.Plugins.Filesystem;
    } else {
        try {
            if (
                typeof cap.registerPlugin === "function" &&
                cap.isPluginAvailable?.("Filesystem")
            ) {
                pluginRef = cap.registerPlugin("Filesystem");
            }
        } catch {
            /* ignore */
        }
    }
    return pluginRef;
};

// APK-তে ও প্লাগিন আছে (পুরনো APK-তে নেই, তখন সবকিছু আগের মতো চলে)
export const hasNativeStore = () => Boolean(getFs());

// ---------- তালিকা (url -> { f: ফাইলপাথ, u: file uri, k: ধরন, t: সময়, b: bytes }) ----------
let index = null;
const loadIndex = () => {
    if (index) return index;
    try {
        const raw = JSON.parse(localStorage.getItem(INDEX_KEY) || "{}");
        index = raw && typeof raw === "object" ? raw : {};
    } catch {
        index = {};
    }
    return index;
};
let saveTimer = null;
const saveIndex = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        try {
            localStorage.setItem(INDEX_KEY, JSON.stringify(loadIndex()));
        } catch {
            /* ignore */
        }
    }, 300);
};

// দুটো ভিন্ন 32-bit hash জুড়ে ফাইলের নাম (collision প্রায় অসম্ভব)
const hashUrl = str => {
    let h1 = 0x811c9dc5;
    let h2 = 5381;
    for (let i = 0; i < str.length; i += 1) {
        const c = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
        h2 = (Math.imul(h2, 33) + c) >>> 0;
    }
    return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
};

const DEFAULT_EXT = { image: "jpg", video: "mp4", audio: "m4a", wallpaper: "jpg", story: "jpg" };
const extOf = (url, kind) => {
    try {
        const last = new URL(url).pathname.split("/").pop() || "";
        const m = last.match(/\.([a-z0-9]{2,5})$/i);
        if (m) return m[1].toLowerCase();
    } catch {
        /* ignore */
    }
    return DEFAULT_EXT[kind] || "bin";
};

// ---------- লগ ও ডায়াগনস্টিক (Profile > "Saved media" কার্ডে দেখা যায়) ----------
const LOG_KEY = "sync_native_media_log";
export const logMedia = msg => {
    try {
        const arr = JSON.parse(localStorage.getItem(LOG_KEY) || "[]");
        arr.push(`${new Date().toLocaleTimeString()} ${String(msg).slice(0, 160)}`);
        localStorage.setItem(LOG_KEY, JSON.stringify(arr.slice(-25)));
    } catch {
        /* ignore */
    }
};
const errText = e => (e && (e.message || e.errorMessage || e.code)) || String(e);

// ফোনের ফাইল WebView-তে দেখানোর দুটো উপায়:
//  "url"  : Capacitor-এর convertFileSrc লিংক (দ্রুত, ভিডিও seek চলে)
//  "blob" : ফাইল পড়ে blob: লিংক (convertFileSrc কাজ না করলে ফলব্যাক; বড় ভিডিওতে নয়)
// "url" ব্যর্থ হলে নিজে থেকে "blob"-এ বদলে মনে রাখে।
const MODE_KEY = "sync_native_media_mode";
let fileSrcMode = "url";
try {
    if (localStorage.getItem(MODE_KEY) === "blob") fileSrcMode = "blob";
} catch {
    /* ignore */
}
let modeSwitchedAt = 0;
const MAX_BLOB_BYTES = 40 * 1024 * 1024;
const MIME = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
    avif: "image/avif", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", "3gp": "video/3gpp",
    m4a: "audio/mp4", mp3: "audio/mpeg", ogg: "audio/ogg", aac: "audio/aac", wav: "audio/wav"
};
const blobs = new Map(); // url -> blob: object URL

const b64ToBlob = (b64, type) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type });
};

const toSrc = uri => {
    const cap = capacitor();
    try {
        return cap && cap.convertFileSrc ? cap.convertFileSrc(uri) : "";
    } catch {
        return "";
    }
};

// এই সেশনে যাচাই হয়ে গেছে (ফাইল সত্যিই আছে) — বারবার stat করা লাগে না
const verified = new Map(); // url -> src
const pending = new Map(); // url -> Promise<src>

export const peekLocalMedia = url => (url ? verified.get(url) || "" : "");

const dropEntry = async (url, deleteFile = true) => {
    const idx = loadIndex();
    const entry = idx[url];
    verified.delete(url);
    if (!entry) return;
    delete idx[url];
    saveIndex();
    if (deleteFile) {
        try {
            await getFs()?.deleteFile({ path: entry.f, directory: DATA });
        } catch {
            /* ignore */
        }
    }
};

// ফোনের ফাইল চালাতে না পারলে (নষ্ট/URL কাজ করছে না) তালিকা থেকে বাদ দেওয়া, যাতে সরাসরি URL-এ ফিরে যায়
export const dropLocalMedia = url => dropEntry(url, true);

// entry থেকে দেখানোর মতো src বানানো (mode অনুযায়ী)। বড় ভিডিও blob mode-এ "" (তখন সরাসরি URL)।
const srcFor = async (url, entry) => {
    if (fileSrcMode === "url") return toSrc(entry.u);
    const have = blobs.get(url);
    if (have) return have;
    if ((entry.b || 0) > MAX_BLOB_BYTES) return "";
    const r = await getFs().readFile({ path: entry.f, directory: DATA });
    const ext = String(entry.f).split(".").pop().toLowerCase();
    const blob = b64ToBlob(r.data, MIME[ext] || "application/octet-stream");
    const objectUrl = URL.createObjectURL(blob);
    blobs.set(url, objectUrl);
    return objectUrl;
};

// ডিভাইসে সেভ করা ফাইল (থাকলে) — নেটে যায় না।
// না থাকলে বা নষ্ট হলে "" ফেরত।
export const lookupLocalMedia = async url => {
    const fs = getFs();
    if (!fs || !url) return "";
    const hit = verified.get(url);
    if (hit) return hit;
    const entry = loadIndex()[url];
    if (!entry) return "";
    try {
        const stat = await fs.stat({ path: entry.f, directory: DATA });
        if (!stat || (entry.b && stat.size && stat.size < entry.b * 0.9)) {
            throw new Error("incomplete file");
        }
    } catch (e) {
        logMedia(`missing file, will re-download: ${errText(e)}`);
        await dropEntry(url, false);
        return "";
    }
    try {
        const src = await srcFor(url, entry);
        if (src) verified.set(url, src);
        return src;
    } catch (e) {
        logMedia(`cannot open file: ${errText(e)}`);
        return "";
    }
};

// ---------- ডাউনলোড queue ----------
const queue = [];
let active = 0;
const pump = () => {
    while (active < WORKERS && queue.length) {
        const job = queue.shift();
        active += 1;
        job().finally(() => {
            active -= 1;
            pump();
        });
    }
};
const enqueue = fn =>
    new Promise(resolve => {
        queue.push(() => fn().then(resolve, () => resolve("")));
        pump();
    });

const downloadOnce = async (url, kind) => {
    const fs = getFs();
    const file = `${DIR}/${hashUrl(url)}.${extOf(url, kind)}`;
    try {
        await fs.downloadFile({ url, path: file, directory: DATA, recursive: true });
    } catch (e) {
        logMedia(`download failed: ${errText(e)}`);
        throw e;
    }
    const { uri } = await fs.getUri({ path: file, directory: DATA });
    let bytes = 0;
    try {
        const st = await fs.stat({ path: file, directory: DATA });
        bytes = Number(st?.size) || 0;
    } catch {
        /* ignore */
    }
    if (!bytes) {
        try {
            await fs.deleteFile({ path: file, directory: DATA });
        } catch {
            /* ignore */
        }
        throw new Error("empty download");
    }
    const entry = { f: file, u: uri, k: kind, t: Date.now(), b: bytes };
    loadIndex()[url] = entry;
    saveIndex();
    logMedia(`saved ${kind} ${Math.round(bytes / 1024)}KB`);
    let src = "";
    try {
        src = await srcFor(url, entry);
    } catch (e) {
        logMedia(`saved but cannot open: ${errText(e)}`);
    }
    if (src) verified.set(url, src);
    // সেভ হয়েছে কিন্তু এখন দেখানোর src নেই (বড় ভিডিও, blob mode) — সেভ সফল ধরা হয়, "ok" ফেরত
    return src || "saved";
};

// ডিভাইসে সেভ করা কপি দেয়; না থাকলে নামিয়ে সেভ করে। ব্যর্থ হলে "" ফেরত (তখন সরাসরি URL চলে)।
export const ensureLocalMedia = (url, kind = "image") => {
    if (!getFs() || !url || !/^https?:\/\//i.test(url)) return Promise.resolve("");
    if (pending.has(url)) return pending.get(url);
    const job = (async () => {
        const had = Boolean(loadIndex()[url]);
        const stored = await lookupLocalMedia(url);
        if (stored) return stored;
        // ফাইল আছে কিন্তু এই অবস্থায় দেখানো যাচ্ছে না (যেমন বড় ভিডিও): আবার নামানো হবে না
        if (had && loadIndex()[url]) return "";
        for (let attempt = 0; attempt < 3; attempt += 1) {
            const src = await enqueue(() => downloadOnce(url, kind));
            if (src) return src === "saved" ? "" : src;
            await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
        }
        return "";
    })().finally(() => pending.delete(url));
    pending.set(url, job);
    return job;
};

// keep-এ নেই এমন (এই ধরনের) ফাইল মুছে জায়গা খালি করা। olderThanMs দিলে শুধু তার চেয়ে পুরনোগুলো।
export const pruneLocalMedia = async (kind, keepUrls, olderThanMs = 0) => {
    if (!getFs()) return;
    const keep = keepUrls instanceof Set ? keepUrls : new Set(keepUrls || []);
    const now = Date.now();
    const idx = loadIndex();
    for (const url of Object.keys(idx)) {
        const e = idx[url];
        if (e.k !== kind || keep.has(url)) continue;
        if (olderThanMs && now - e.t < olderThanMs) continue;
        // eslint-disable-next-line no-await-in-loop
        await dropEntry(url);
    }
};

// ভিডিও অটো সেভ করা যাবে কিনা (Wi-Fi/ইথারনেট হলে)
const onUnmetered = () => {
    try {
        const t = navigator.connection && navigator.connection.type;
        return t === "wifi" || t === "ethernet";
    } catch {
        return false;
    }
};

// স্টোরি ২৪ ঘণ্টায় মেয়াদ শেষ হয়, তাই ২ দিনের পুরনো স্টোরি ফাইল অ্যাপ খুললে মুছে যায়
if (typeof window !== "undefined") {
    setTimeout(() => {
        pruneLocalMedia("story", [], 2 * 24 * 60 * 60 * 1000).catch(() => {});
    }, 8000);
}

const giveUp = new Set(); // এই সেশনে যেগুলো ফোনের ফাইল থেকে চলেনি, শুধু সেগুলোর জন্য সরাসরি URL

// React hook: url দিলে দেখানোর মতো src দেয়।
// - PWA/ওয়েবসাইট (বা পুরনো APK): সরাসরি url (service worker cache করে)
// - APK: আগে ডিভাইসের সেভ করা ফাইল খোঁজে (কয়েক ms) — থাকলে সেটাই, নেট লাগে না।
//   না থাকলে url দেখায় আর সেভ করে রাখে, পরের বার ফাইল থেকে চলে।
// ফেরত: [src, saveNow, onError] — ভিডিওতে মোবাইল ডেটায় প্লে চাপলে saveNow() ডাকলে সেভ শুরু হয়।
// onError: ফোনের ফাইল চলেনি। প্রথমে "blob" mode-এ চেষ্টা, তাও না হলে শুধু ওই ফাইলের জন্য সরাসরি URL
// (ফাইল মুছে বারবার নামানো হয় না)।
export const useLocalMedia = (url, kind = "image") => {
    const native = hasNativeStore();
    const [state, setState] = useState({ url: "", src: "" });
    const [tick, setTick] = useState(0);

    useEffect(() => {
        if (!native || !url) return undefined;
        let cancelled = false;
        (async () => {
            if (giveUp.has(url)) {
                setState({ url, src: url });
                return;
            }
            const stored = await lookupLocalMedia(url);
            if (cancelled) return;
            if (stored) {
                setState({ url, src: stored });
                return;
            }
            setState({ url, src: url });
            if (kind !== "video" || onUnmetered()) ensureLocalMedia(url, kind);
        })();
        return () => {
            cancelled = true;
        };
    }, [native, url, kind, tick]);

    const saveNow = useCallback(() => {
        if (native && url && !giveUp.has(url)) ensureLocalMedia(url, kind);
    }, [native, url, kind]);

    const onError = useCallback(() => {
        if (!native || !url) return;
        if (!giveUp.has(url) && state.src !== url) {
            // ফোনের ফাইল (src) চলেনি
            if (fileSrcMode === "url") {
                fileSrcMode = "blob";
                modeSwitchedAt = Date.now();
                try {
                    localStorage.setItem(MODE_KEY, "blob");
                } catch {
                    /* ignore */
                }
                verified.clear();
                logMedia("convertFileSrc failed → switching to blob mode");
                setTick(n => n + 1);
                return;
            }
            if (Date.now() - modeSwitchedAt < 4000) {
                setTick(n => n + 1);
                return;
            }
            giveUp.add(url);
            verified.delete(url);
            logMedia("local file failed in blob mode, using remote for this item");
            setState({ url, src: url });
        }
    }, [native, url, state.src]);

    if (!url) return ["", saveNow, onError];
    if (!native) return [url, saveNow, onError];
    return [state.url === url ? state.src : peekLocalMedia(url), saveNow, onError];
};

// ---------- ডায়াগনস্টিক (Profile-এর "Saved media" কার্ড) ----------
export const getMediaDiagnostics = () => {
    const idx = loadIndex();
    const urls = Object.keys(idx);
    let bytes = 0;
    const kinds = {};
    for (const u of urls) {
        bytes += idx[u].b || 0;
        kinds[idx[u].k] = (kinds[idx[u].k] || 0) + 1;
    }
    let log = [];
    try {
        log = JSON.parse(localStorage.getItem(LOG_KEY) || "[]");
    } catch {
        /* ignore */
    }
    return {
        plugin: hasNativeStore(),
        mode: fileSrcMode,
        files: urls.length,
        kinds,
        mb: Math.round((bytes / 1048576) * 10) / 10,
        log
    };
};

export const testNativeSave = async () => {
    if (!hasNativeStore()) return "Filesystem plugin not available (install the new APK)";
    const url = `${window.location.origin}/icons/icon-192.png?t=${Date.now()}`;
    try {
        const src = await ensureLocalMedia(url, "image");
        if (!src) return "download or open failed — see log";
        const ok = await new Promise(resolve => {
            const img = new Image();
            img.onload = () => resolve(true);
            img.onerror = () => resolve(false);
            img.src = src;
        });
        return ok
            ? `OK: saved and displayed (mode: ${fileSrcMode})`
            : `saved, but WebView cannot display it (mode: ${fileSrcMode})`;
    } catch (e) {
        return `error: ${errText(e)}`;
    }
};

export const clearNativeMedia = async () => {
    const idx = loadIndex();
    for (const u of Object.keys(idx)) {
        // eslint-disable-next-line no-await-in-loop
        await dropEntry(u, true);
    }
    blobs.clear();
    giveUp.clear();
};

// ---------- আগে থেকে নামিয়ে রাখা (যেমন স্টোরি তালিকা আসা মাত্র) ----------
// খুললে তাৎক্ষণিক দেখায়, দ্বিতীয়বার নেট লাগে না।
// - APK: ফোনের Data স্টোরেজে ফাইল হিসেবে সেভ
// - PWA/ওয়েবসাইট: fetch করলে service worker নিজে cache-এ রেখে দেয়
// Data Saver চালু থাকলে কিছু নামায় না; ভিডিও শুধু Wi-Fi/ইথারনেটে (বা ডেস্কটপে যেখানে ধরন জানা যায় না)।
const prefetched = new Set();
export const prefetchMedia = items => {
    try {
        const conn = navigator.connection;
        if (conn && conn.saveData) return;
        const unknown = !conn || !conn.type;
        const videoOk = onUnmetered() || (!hasNativeStore() && unknown);
        for (const item of items || []) {
            const url = item && item.url;
            const kind = (item && item.kind) || "image";
            if (!url || !/^https?:\/\//i.test(url) || prefetched.has(url)) continue;
            if (kind === "video" && !videoOk) continue;
            prefetched.add(url);
            if (hasNativeStore()) {
                ensureLocalMedia(url, kind);
            } else {
                fetch(url, { mode: "cors", credentials: "omit" })
                    .then(r => r.blob())
                    .catch(() => prefetched.delete(url));
            }
        }
    } catch {
        /* ignore */
    }
};
