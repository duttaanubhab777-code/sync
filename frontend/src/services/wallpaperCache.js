import { useEffect, useState } from "react";
import {
    ensureLocalMedia,
    hasNativeStore,
    lookupLocalMedia,
    pruneLocalMedia
} from "./nativeMedia.js";

// Wallpaper ছবি ডিভাইসে স্থায়ীভাবে জমিয়ে রাখা (Android অ্যাপ + PWA + ওয়েবসাইট — সব জায়গায় একই কোড)।
//
// কেন আগে সমস্যা হতো: ছবি প্রতিবার চ্যাট খোলার সময় নেটওয়ার্ক থেকে আনা হতো। নেট ধীর/অস্থির হলে
// লোড ব্যর্থ হতো আর কোনো retry ছিল না, তাই কখনো আসত কখনো আসত না।
//
// এখন: ছবি একবার Cache Storage-এ সেভ হয় (ব্রাউজার/WebView ডেটা মুছলে তবেই যায়)।
// পরের বার চ্যাট খুললে নেট ছাড়াই, তাৎক্ষণিক দেখায়। Cache Storage না থাকলে বা fetch ব্যর্থ হলে
// সরাসরি URL-এ ফলব্যাক করে।
const CACHE_NAME = "sync-wallpapers-v1";

// url -> blob: object URL (এই সেশনে মেমোরিতে, তাই দ্বিতীয়বার একেবারে সাথে সাথে)
const mem = new Map();
// একই ছবি একসাথে দুবার আনা বন্ধ
const pending = new Map();

const hasCacheApi = () =>
    typeof caches !== "undefined" && typeof caches.open === "function";

const sleep = ms => new Promise(r => setTimeout(r, ms));

export const peekCachedWallpaper = url => (url ? mem.get(url) || "" : "");

const fromResponse = async res => {
    const blob = await res.blob();
    if (!blob || blob.size < 64) throw new Error("empty image");
    if (blob.type && !blob.type.startsWith("image/")) {
        throw new Error("not an image");
    }
    const objectUrl = URL.createObjectURL(blob);
    return objectUrl;
};

const download = async url => {
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            const res = await fetch(url, { credentials: "omit" });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const copy = res.clone();
            const objectUrl = await fromResponse(res);
            if (hasCacheApi()) {
                try {
                    const cache = await caches.open(CACHE_NAME);
                    await cache.put(url, copy);
                } catch {
                    /* জায়গা নেই / private mode: মেমোরি থেকেই চলবে */
                }
            }
            return objectUrl;
        } catch (err) {
            lastErr = err;
            await sleep(700 * (attempt + 1));
        }
    }
    throw lastErr;
};

// ব্রাউজার/WebView যেন low-storage হলেও আমাদের cache নিজে থেকে মুছে না ফেলে
let persistAsked = false;
export const requestPersistentStorage = () => {
    if (persistAsked) return;
    persistAsked = true;
    try {
        if (navigator.storage && navigator.storage.persist) {
            navigator.storage.persist().catch(() => {});
        }
    } catch {
        /* ignore */
    }
};

// শুধু ডিভাইসে সেভ করা কপি খোঁজে (নেটে যায় না)। না থাকলে "" ফেরত।
export const lookupStoredWallpaper = async url => {
    if (!url) return "";
    const hit = mem.get(url);
    if (hit) return hit;
    // APK: ফোনের Data স্টোরেজে ফাইল হিসেবে সেভ (Cache Storage নয়)
    if (hasNativeStore()) {
        const local = await lookupLocalMedia(url);
        if (local) mem.set(url, local);
        return local;
    }
    if (!hasCacheApi()) return "";
    try {
        const cache = await caches.open(CACHE_NAME);
        const stored = await cache.match(url);
        if (!stored) return "";
        const objectUrl = await fromResponse(stored);
        mem.set(url, objectUrl);
        return objectUrl;
    } catch {
        try {
            const cache = await caches.open(CACHE_NAME);
            await cache.delete(url);
        } catch {
            /* ignore */
        }
        return "";
    }
};

// ডিভাইসে সেভ করা কপি (থাকলে) দেয়; না থাকলে নামিয়ে সেভ করে। ব্যর্থ হলে "" ফেরত।
export const resolveWallpaper = url => {
    if (!url) return Promise.resolve("");
    const hit = mem.get(url);
    if (hit) return Promise.resolve(hit);
    if (pending.has(url)) return pending.get(url);

    const job = (async () => {
        try {
            if (hasNativeStore()) {
                const local = await ensureLocalMedia(url, "wallpaper");
                if (local) mem.set(url, local);
                return local;
            }
            if (hasCacheApi()) {
                try {
                    const cache = await caches.open(CACHE_NAME);
                    const stored = await cache.match(url);
                    if (stored) {
                        const objectUrl = await fromResponse(stored);
                        mem.set(url, objectUrl);
                        return objectUrl;
                    }
                } catch {
                    /* সেভ করা কপি নষ্ট: নতুন করে নামানো হবে */
                    try {
                        const cache = await caches.open(CACHE_NAME);
                        await cache.delete(url);
                    } catch {
                        /* ignore */
                    }
                }
            }
            const objectUrl = await download(url);
            mem.set(url, objectUrl);
            return objectUrl;
        } catch {
            return "";
        } finally {
            pending.delete(url);
        }
    })();
    pending.set(url, job);
    return job;
};

// মুছে ফেলা/বদলে যাওয়া wallpaper-এর পুরনো কপি পরিষ্কার
export const pruneWallpaperCache = async keepUrls => {
    const keep = keepUrls instanceof Set ? keepUrls : new Set(keepUrls);
    for (const [url, objectUrl] of mem.entries()) {
        if (!keep.has(url)) {
            if (objectUrl.startsWith("blob:")) URL.revokeObjectURL(objectUrl);
            mem.delete(url);
        }
    }
    if (hasNativeStore()) {
        await pruneLocalMedia("wallpaper", keep);
        return;
    }
    if (!hasCacheApi()) return;
    try {
        const cache = await caches.open(CACHE_NAME);
        const keys = await cache.keys();
        await Promise.all(
            keys.filter(req => !keep.has(req.url)).map(req => cache.delete(req))
        );
    } catch {
        /* ignore */
    }
};

// ব্যাকগ্রাউন্ডে সব ছবি নামিয়ে রাখা। urls আগে-দরকারি ক্রমে দিতে হবে।
let prefetchRun = 0;
export const prefetchWallpapers = async urls => {
    const conn = typeof navigator !== "undefined" ? navigator.connection : null;
    const saveData = Boolean(conn && conn.saveData);
    const run = ++prefetchRun;
    const list = [...new Set(urls.filter(Boolean))];
    // Data Saver চালু থাকলে শুধু প্রথমটা (বর্তমান wallpaper)
    const queue = saveData ? list.slice(0, 1) : list;
    let i = 0;
    const worker = async () => {
        while (i < queue.length && run === prefetchRun) {
            const url = queue[i];
            i += 1;
            await resolveWallpaper(url);
        }
    };
    await Promise.all([worker(), worker()]);
};

// React hook: ছবির URL দিলে দেখানোর মতো src দেয়।
// - মেমোরিতে থাকলে blob (একদম তাৎক্ষণিক)
// - না থাকলে আগে ডিভাইসের সেভ করা কপি খোঁজে (কয়েক ms, নেট লাগে না) — পেলে সেটাই দেখায়
// - ডিভাইসে একেবারেই না থাকলে তবেই নেট থেকে URL দেখায় আর ব্যাকগ্রাউন্ডে সেভ করে রাখে
// আগে অ্যাপ খুললেই সরাসরি URL দেখানো হতো, তাই প্রতিবার নতুন করে নামত। এখন আর হয় না।
export const useCachedWallpaper = url => {
    const [resolved, setResolved] = useState({ url: "", src: "" });
    const [attempt, setAttempt] = useState(0);

    const hit = peekCachedWallpaper(url);
    const src = !url ? "" : hit || (resolved.url === url ? resolved.src : "");

    useEffect(() => {
        if (!url || peekCachedWallpaper(url)) return undefined;
        let cancelled = false;
        requestPersistentStorage();
        (async () => {
            const stored = await lookupStoredWallpaper(url);
            if (cancelled) return;
            if (stored) {
                setResolved({ url, src: stored });
                return;
            }
            // ডিভাইসে নেই: নেট থেকে দেখাও, সাথে সাথে সেভ করো
            setResolved({ url, src: url });
            resolveWallpaper(url);
        })();
        return () => {
            cancelled = true;
        };
    }, [url, attempt]);

    // সেভ করা কপি না পেলে, নেট ফিরলে/অ্যাপ সামনে এলে আবার চেষ্টা
    useEffect(() => {
        if (!url || peekCachedWallpaper(url)) return undefined;
        const retry = () => {
            if (document.visibilityState === "hidden") return;
            if (peekCachedWallpaper(url)) return;
            setAttempt(n => n + 1);
        };
        const timer = setTimeout(retry, 8000);
        window.addEventListener("online", retry);
        document.addEventListener("visibilitychange", retry);
        return () => {
            clearTimeout(timer);
            window.removeEventListener("online", retry);
            document.removeEventListener("visibilitychange", retry);
        };
    }, [url, attempt]);

    return src;
};
