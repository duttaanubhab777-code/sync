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

// চ্যাটের পেছনের wallpaper (WhatsApp-এর মতো: পুরো জায়গা জুড়ে, কেন্দ্র ঠিক রেখে cover)।
// ছবি ডিভাইসে সেভ করা থাকে, তাই চ্যাট খুললেই তাৎক্ষণিক দেখায় (নেট লাগে না)।
export default function ChatWallpaperLayer() {
    const { effective, loaded } = useWallpaper();
    const url = effective ? wallpaperFullUrl(effective.url) : "";
    const src = useCachedWallpaper(url);
    const isLocal = Boolean(src) && src === peekCachedWallpaper(url);
    const [ready, setReady] = useState(isLocal);

    useEffect(() => {
        if (!loaded) loadWallpapers();
    }, [loaded]);

    useEffect(() => {
        if (!src) {
            setReady(false);
            return undefined;
        }
        // ডিভাইসে থাকা ছবি সাথে সাথে দেখানো; সরাসরি URL হলে পুরো লোড হলে ফুটিয়ে তোলা
        if (isLocal) {
            setReady(true);
            return undefined;
        }
        setReady(false);
        const img = new Image();
        img.onload = () => setReady(true);
        img.onerror = () => setReady(false);
        img.src = src;
        return () => {
            img.onload = null;
            img.onerror = null;
        };
    }, [src, isLocal]);

    if (!src) return null;

    return (
        <div
            className={`sync-wallpaper-layer ${ready ? "is-ready" : ""}`}
            style={{ backgroundImage: `url("${src}")` }}
            aria-hidden="true"
        />
    );
}
