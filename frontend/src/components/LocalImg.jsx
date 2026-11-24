import React from "react";
import { useLocalMedia } from "../services/nativeMedia.js";

// <img>/<video>-এর মতো; ফোনে সেভ করা ফাইল (APK) থাকলে সেটা থেকে দেখায়, PWA/ওয়েবসাইটে সরাসরি URL (service worker cache করে)
export function LocalImg({ url, kind = "image", alt = "", ...rest }) {
    const [src] = useLocalMedia(url, kind);
    if (!src) return null;
    return <img src={src} alt={alt} {...rest} />;
}

// স্টোরির ভিডিও: Wi-Fi-তে অটো সেভ, মোবাইল ডেটায় প্লে হলে সেভ
export function LocalVideo({ url, onPlay, ...rest }) {
    const [src, save] = useLocalMedia(url, "video");
    if (!src) return null;
    return (
        <video
            src={src}
            {...rest}
            onPlay={e => {
                save();
                if (onPlay) onPlay(e);
            }}
        />
    );
}
