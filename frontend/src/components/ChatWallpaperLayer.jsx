import React, { useEffect, useState } from "react";
import {
    loadWallpapers,
    useWallpaper,
    wallpaperFullUrl
} from "../services/wallpaper.js";

// চ্যাটের পেছনের wallpaper (WhatsApp-এর মতো: পুরো জায়গা জুড়ে, কেন্দ্র ঠিক রেখে cover)।
// মেসেজ স্ক্রল করলেও wallpaper নড়ে না। ছবি পুরো লোড হলে ধীরে ফুটে ওঠে।
export default function ChatWallpaperLayer() {
    const { effective, loaded } = useWallpaper();
    const url = effective ? wallpaperFullUrl(effective.url) : "";
    const [ready, setReady] = useState(false);

    useEffect(() => {
        if (!loaded) loadWallpapers();
    }, [loaded]);

    useEffect(() => {
        setReady(false);
        if (!url) return undefined;
        const img = new Image();
        img.onload = () => setReady(true);
        img.onerror = () => setReady(false);
        img.src = url;
        return () => {
            img.onload = null;
            img.onerror = null;
        };
    }, [url]);

    if (!url) return null;

    return (
        <div
            className={`sync-wallpaper-layer ${ready ? "is-ready" : ""}`}
            style={{ backgroundImage: `url("${url}")` }}
            aria-hidden="true"
        />
    );
}
