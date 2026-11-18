import { useEffect, useSyncExternalStore } from "react";
import { api } from "./api.js";

// Android অ্যাপ User-Agent-এ "SyncApp/1.0.<build>" যোগ করে (build নম্বর GitHub Actions বসায়)।
// পুরনো APK-তে শুধু "SyncApp/1.0" থাকে, তাই build = 0 ধরে আপডেট দেখানো হয়।
const UA = typeof navigator !== "undefined" ? navigator.userAgent : "";
export const isAndroidApp = /SyncApp\//.test(UA);
export const installedBuild = (() => {
    const m = /SyncApp\/1\.0\.(\d+)/.exec(UA);
    return m ? Number(m[1]) : 0;
})();

const CACHE_MS = 60 * 1000; // আগে ৫ মিনিট ছিল, তাই নতুন ভার্সন দেরিতে ধরা পড়ত

let state = { status: "idle", data: null, error: "" };
let lastAt = 0;
let inflight = null;
const listeners = new Set();

const emit = patch => {
    state = { ...state, ...patch };
    listeners.forEach(fn => fn());
};
const subscribe = fn => {
    listeners.add(fn);
    return () => listeners.delete(fn);
};
const getSnapshot = () => state;

export function loadUpdates(force = false) {
    if (inflight) return inflight;
    if (!force && state.data && Date.now() - lastAt < CACHE_MS) {
        return Promise.resolve(state.data);
    }
    if (!state.data) emit({ status: "loading", error: "" });
    inflight = api
        .get("/api/app/updates", {
            // force হলে সার্ভারের ক্যাশ ভেঙে সরাসরি GitHub থেকে সর্বশেষ release আনে;
            // `_` প্রতিবার আলাদা, যাতে কোনো ক্যাশ (ব্রাউজার/প্রক্সি) পুরনো জবাব না দেয়
            params: force
                ? { fresh: 1, _: Date.now() }
                : { _: Math.floor(Date.now() / 60000) }
        })
        .then(res => {
            lastAt = Date.now();
            emit({ status: "ready", data: res.data?.data || null, error: "" });
        })
        .catch(() => {
            emit({
                status: state.data ? "ready" : "error",
                error: "Could not check for updates. Please try again."
            });
        })
        .finally(() => {
            inflight = null;
        });
    return inflight;
}

export function useAppUpdates({ autoLoad = true } = {}) {
    const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

    useEffect(() => {
        if (autoLoad) loadUpdates();
    }, [autoLoad]);

    // অ্যাপ ব্যাকগ্রাউন্ড থেকে ফিরলে আবার চেক (অ্যাপ অনেকক্ষণ খোলা থাকলে নতুন release ধরা পড়ে)
    useEffect(() => {
        if (!autoLoad) return;
        const onVisible = () => {
            if (document.visibilityState === "visible") loadUpdates();
        };
        document.addEventListener("visibilitychange", onVisible);
        return () =>
            document.removeEventListener("visibilitychange", onVisible);
    }, [autoLoad]);

    const latest = s.data?.latest || null;
    return {
        status: s.status,
        error: s.error,
        latest,
        history: s.data?.history || [],
        latestDownloadUrl: s.data?.latestDownloadUrl || "",
        releasesUrl: s.data?.releasesUrl || "",
        isAndroidApp,
        installedBuild,
        hasUpdate: Boolean(
            isAndroidApp && latest && latest.build > installedBuild
        ),
        refresh: () => loadUpdates(true)
    };
}

// অ্যাপের ভেতর থেকে অন্য হোস্টের লিংক Android-এ সিস্টেম ব্রাউজারে খোলে (Capacitor তাই করে),
// ব্রাউজার APK নামায়, নামা শেষে ইউজার ফাইলে ট্যাপ করে Install করে।
export function openDownload(url) {
    if (!url) return;
    if (isAndroidApp) {
        window.location.href = url;
    } else {
        window.open(url, "_blank", "noopener");
    }
}

const dateFmt = new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric"
});
export const formatReleaseDate = iso => {
    if (!iso) return "";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : dateFmt.format(d);
};
export const formatSize = bytes =>
    bytes > 0 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : "";
