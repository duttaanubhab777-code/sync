import { useEffect, useState } from "react";

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

// ডিভাইসে সেভ করা কপি (থাকলে) দেয়; না থাকলে নামিয়ে সেভ করে। ব্যর্থ হলে "" ফেরত।
export const resolveWallpaper = url => {
    if (!url) return Promise.resolve("");
    const hit = mem.get(url);
    if (hit) return Promise.resolve(hit);
    if (pending.has(url)) return pending.get(url);

    const job = (async () => {
        try {
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
            URL.revokeObjectURL(objectUrl);
            mem.delete(url);
        }
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

// React hook: ছবির URL দিলে ডিভাইসে-সেভ করা কপির src দেয়।
// নতুন ছবি আসার সময় আগের ছবি ধরে রাখে (ফাঁকা ঝলক হয় না); ব্যর্থ হলে সরাসরি URL।
export const useCachedWallpaper = url => {
    const [src, setSrc] = useState(() => peekCachedWallpaper(url));
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        if (!url) {
            setSrc("");
            return undefined;
        }
        const hit = peekCachedWallpaper(url);
        if (hit) {
            setSrc(hit);
            return undefined;
        }
        let cancelled = false;
        resolveWallpaper(url).then(local => {
            if (cancelled) return;
            // ডাউনলোড ব্যর্থ হলে সরাসরি URL, আর কিছুক্ষণ পরে আবার চেষ্টা
            setSrc(local || url);
        });
        return () => {
            cancelled = true;
        };
    }, [url, attempt]);

    // সরাসরি URL-এ আটকে থাকলে, নেট ফিরলে/অ্যাপ সামনে এলে সেভ করা কপির জন্য আবার চেষ্টা
    useEffect(() => {
        if (!url || !src || src !== url) return undefined;
        const retry = () => {
            if (document.visibilityState === "hidden") return;
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
    }, [url, src]);

    return src;
};
