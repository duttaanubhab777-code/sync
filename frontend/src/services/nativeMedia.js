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

// ডিভাইসে সেভ করা ফাইল (থাকলে) — নেটে যায় না। না থাকলে বা নষ্ট হলে "" ফেরত।
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
            throw new Error("incomplete");
        }
        const src = toSrc(entry.u);
        if (!src) throw new Error("no src");
        verified.set(url, src);
        return src;
    } catch {
        await dropEntry(url, false);
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
    await fs.downloadFile({ url, path: file, directory: DATA, recursive: true });
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
    loadIndex()[url] = { f: file, u: uri, k: kind, t: Date.now(), b: bytes };
    saveIndex();
    const src = toSrc(uri);
    if (src) verified.set(url, src);
    return src;
};

// ডিভাইসে সেভ করা কপি দেয়; না থাকলে নামিয়ে সেভ করে। ব্যর্থ হলে "" ফেরত (তখন সরাসরি URL চলে)।
export const ensureLocalMedia = (url, kind = "image") => {
    if (!getFs() || !url || !/^https?:\/\//i.test(url)) return Promise.resolve("");
    if (pending.has(url)) return pending.get(url);
    const job = (async () => {
        const stored = await lookupLocalMedia(url);
        if (stored) return stored;
        for (let attempt = 0; attempt < 3; attempt += 1) {
            const src = await enqueue(() => downloadOnce(url, kind));
            if (src) return src;
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

// React hook: url দিলে দেখানোর মতো src দেয়।
// - PWA/ওয়েবসাইট (বা পুরনো APK): সরাসরি url (service worker cache করে)
// - APK: আগে ডিভাইসের সেভ করা ফাইল খোঁজে (কয়েক ms) — থাকলে সেটাই, নেট লাগে না।
//   না থাকলে url দেখায় আর সেভ করে রাখে, পরের বার ফাইল থেকে চলে।
// ফেরত: [src, saveNow] — ভিডিওতে মোবাইল ডেটায় প্লে চাপলে saveNow() ডাকলে সেভ শুরু হয়।
export const useLocalMedia = (url, kind = "image") => {
    const native = hasNativeStore();
    const [state, setState] = useState({ url: "", src: "" });

    useEffect(() => {
        if (!native || !url) return undefined;
        let cancelled = false;
        (async () => {
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
    }, [native, url, kind]);

    const saveNow = useCallback(() => {
        if (native && url) ensureLocalMedia(url, kind);
    }, [native, url, kind]);

    if (!url) return ["", saveNow];
    if (!native) return [url, saveNow];
    return [state.url === url ? state.src : peekLocalMedia(url), saveNow];
};
