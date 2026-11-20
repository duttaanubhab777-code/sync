import { useSyncExternalStore } from "react";
import { api, extractErrorMessage } from "./api.js";
import {
    prefetchWallpapers,
    pruneWallpaperCache,
    resolveWallpaper as resolveWallpaperImage
} from "./wallpaperCache.js";

// চ্যাট wallpaper-এর ক্লায়েন্ট স্টোর (সবাই একই state দেখে, তাই Redux ছাড়াই হালকাভাবে)।
// - wallpapers : admin-দের আপলোড করা সব wallpaper
// - defaultId  : admin যেটা default করেছে
// - myChoice   : আমি যেটা বেছেছি (null = "Default", অর্থাৎ admin-এর default ফলো করছি)
const CACHE_KEY = "sync_wallpaper_cache_v1";

const readCache = () => {
    try {
        const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
        if (raw && Array.isArray(raw.wallpapers)) {
            return { ...raw, loaded: false };
        }
    } catch {
        /* ignore */
    }
    return null;
};

let state = readCache() || {
    wallpapers: [],
    defaultId: null,
    myChoice: null,
    loaded: false
};

const listeners = new Set();

const setState = next => {
    state = { ...state, ...next };
    try {
        localStorage.setItem(
            CACHE_KEY,
            JSON.stringify({
                wallpapers: state.wallpapers,
                defaultId: state.defaultId,
                myChoice: state.myChoice
            })
        );
    } catch {
        /* storage full / private mode */
    }
    listeners.forEach(fn => fn());
};

const subscribe = fn => {
    listeners.add(fn);
    return () => listeners.delete(fn);
};

// ঠিক কোন wallpaper এখন দেখানো হবে: আমার পছন্দ (যদি এখনো থাকে), নাহলে admin-এর default, নাহলে কিছু না
export const resolveWallpaper = s => {
    const chosen = s.myChoice && s.wallpapers.find(w => w._id === s.myChoice);
    if (chosen) return chosen;
    return s.wallpapers.find(w => w._id === s.defaultId) || null;
};

let inflight = null;
let lastLoadOk = false;

// তালিকা আসার পর: বর্তমান wallpaper আগে, তারপর বাকি সব (ফুল + thumbnail) ডিভাইসে নামিয়ে রাখা
const warmCache = () => {
    const list = state.wallpapers;
    if (!list.length) return;
    const current = resolveWallpaper(state);
    const def = list.find(w => w._id === state.defaultId);
    const ordered = [current, def, ...list].filter(Boolean);
    const fulls = ordered.map(w => wallpaperFullUrl(w.url));
    const thumbs = list.map(w => wallpaperThumbUrl(w.url));
    const keep = new Set([...fulls, ...thumbs]);
    pruneWallpaperCache(keep).finally(() => {
        prefetchWallpapers([fulls[0], ...thumbs, ...fulls]);
    });
};

export const loadWallpapers = async () => {
    if (inflight) return inflight;
    inflight = (async () => {
        try {
            const res = await api.get("/api/v1/wallpapers");
            const d = res.data?.data || {};
            setState({
                wallpapers: Array.isArray(d.wallpapers) ? d.wallpapers : [],
                defaultId: d.defaultId || null,
                myChoice: d.myChoice || null,
                loaded: true
            });
            lastLoadOk = true;
            warmCache();
        } catch {
            // নেট না থাকলে আগের cache দিয়েই চলবে (নেট ফিরলে নিচের listener আবার চেষ্টা করবে)
            lastLoadOk = false;
            setState({ loaded: true });
            // আগের সেভ করা তালিকা থাকলে অন্তত তার ছবিগুলো নিশ্চিত করা
            warmCache();
        } finally {
            inflight = null;
        }
    })();
    return inflight;
};

// নেট ফিরলে বা অ্যাপ আবার সামনে এলে, আগের লোড ব্যর্থ হয়ে থাকলে আবার আনা
if (typeof window !== "undefined") {
    const retryIfNeeded = () => {
        if (document.visibilityState === "hidden") return;
        if (!lastLoadOk) loadWallpapers();
    };
    window.addEventListener("online", retryIfNeeded);
    document.addEventListener("visibilitychange", retryIfNeeded);
}

// আমার wallpaper বদলানো। id = null মানে "Default"
export const chooseWallpaper = async id => {
    const previous = state.myChoice;
    setState({ myChoice: id || null }); // সাথে সাথে বদলে দেখানো
    try {
        await api.put("/api/v1/wallpapers/me", { wallpaperId: id || null });
    } catch (err) {
        setState({ myChoice: previous });
        throw new Error(extractErrorMessage(err, "Could not change the wallpaper"));
    }
};

// socket-এ admin কিছু বদলালে
export const handleWallpaperChanged = () => {
    loadWallpapers();
};

export const useWallpaper = () => {
    const snap = useSyncExternalStore(subscribe, () => state);
    return {
        ...snap,
        effective: resolveWallpaper(snap)
    };
};

// ---------- Cloudinary ছবি হালকা করে আনা (দ্রুত লোড, ডেটা কম) ----------
// আগে থেকেই transformation থাকলে হাত দেওয়া হয় না
const withTransform = (url, transform) => {
    if (!url || !url.includes("/image/upload/")) return url || "";
    const [head, tail] = url.split("/image/upload/");
    if (/^[a-z]{1,3}_[^/]+(,[^/]+)*\//i.test(tail)) return url;
    return `${head}/image/upload/${transform}/${tail}`;
};

// চ্যাটের পেছনে পূর্ণ আকারে (ফোনে ১০৮০px চওড়া যথেষ্ট, ডেস্কটপে বড়)
export const wallpaperFullUrl = url => {
    // screen.width ধরে ঠিক করা, যাতে উইন্ডো resize করলে URL বদলে আবার ডাউনলোড না হয়
    const screenW =
        typeof window !== "undefined" && window.screen
            ? Math.max(window.screen.width || 0, window.innerWidth || 0)
            : 0;
    const wide = screenW > 900 ? 1600 : 1080;
    return withTransform(url, `f_auto,q_auto,w_${wide},c_limit`);
};

// picker-এর ছোট thumbnail (ফোনের মতো লম্বা আকার)
export const wallpaperThumbUrl = url =>
    withTransform(url, "f_auto,q_auto,w_360,h_640,c_fill,g_auto");

// অ্যাপ চালু হওয়া মাত্র (চ্যাট খোলার আগেই) বর্তমান wallpaper ডিভাইসের সেভ করা কপি থেকে
// মেমোরিতে তুলে রাখা, যাতে চ্যাটে ঢুকলে এক মুহূর্তও দেরি না হয়।
if (typeof window !== "undefined") {
    try {
        const current = resolveWallpaper(state);
        if (current) {
            const full = wallpaperFullUrl(current.url);
            resolveWallpaperImage(full);
            // বাকিগুলো পরে, ব্যাকগ্রাউন্ডে
            prefetchWallpapers(
                [full, ...state.wallpapers.map(w => wallpaperFullUrl(w.url))]
            );
        }
    } catch {
        /* ignore */
    }
}
