import React, { useEffect, useState } from "react";
import {
    loadWallpapers,
    useWallpaper,
    wallpaperFullUrl
} from "../services/wallpaper.js";
import {
    peekCachedWallpaper,
    useCachedWallpaper
} from "../services/wallpaperCache.js";

// ছবি আগে থেকেই লোড/ডিকোড হয়ে আছে কিনা সিঙ্ক্রোনাসলি দেখা (HTTP cache-এ থাকলে complete = true)
const isAlreadyLoaded = src => {
    if (!src) return false;
    try {
        const img = new Image();
        img.src = src;
        return img.complete && img.naturalWidth > 0;
    } catch {
        return false;
    }
};

// চ্যাটের পেছনের wallpaper (WhatsApp-এর মতো): চ্যাট খোলার প্রথম ফ্রেমেই ছবি থাকে।
// - ডিভাইসে সেভ করা ছবি (blob) বা ব্রাউজারে cache করা ছবি হলে কোনো fade/delay ছাড়াই
// - একেবারে নতুন ছবি হলে তবেই হালকা fade-in
export default function ChatWallpaperLayer() {
    const { effective, loaded } = useWallpaper();
    const url = effective ? wallpaperFullUrl(effective.url) : "";
    const src = useCachedWallpaper(url);
    const isLocal = Boolean(src) && src === peekCachedWallpaper(url);
    const [ready, setReady] = useState(() => isLocal || isAlreadyLoaded(src));

    useEffect(() => {
        if (!loaded) loadWallpapers();
    }, [loaded]);

    useEffect(() => {
        if (!src) {
            setReady(false);
            return undefined;
        }
        if (isLocal || isAlreadyLoaded(src)) {
            setReady(true);
            return undefined;
        }
        let alive = true;
        const img = new Image();
        img.onload = () => alive && setReady(true);
        img.onerror = () => alive && setReady(false);
        img.src = src;
        return () => {
            alive = false;
            img.onload = null;
            img.onerror = null;
        };
    }, [src, isLocal]);

    if (!src) return null;

    // পুরো সিঙ্ক্রোনাস রেন্ডারে ready ধরা হয়, যাতে প্রথম paint-এই দেখা যায়
    const instant = ready || isLocal;

    return (
        <div
            className={`sync-wallpaper-layer ${instant ? "is-ready is-instant" : ""}`}
            style={{ backgroundImage: `url("${src}")` }}
            aria-hidden="true"
        />
    );
}
