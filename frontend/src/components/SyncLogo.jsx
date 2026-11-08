import React from "react";

// size: mini | bar | nav | auth | splash | hero | stage | cover
// glow: লোগোর পেছনে নরম আলো (বক্স/ব্যাকগ্রাউন্ড নয়)
// spin: লোডিং স্প্ল্যাশে লোগো ঘোরে
export default function SyncLogo({
    size = "auth",
    glow = false,
    spin = false,
    className = ""
}) {
    const classes = [
        "sync-brand-mark",
        `sync-brand-mark--${size}`,
        glow ? "has-glow" : "",
        spin ? "is-spinning" : "",
        className
    ]
        .filter(Boolean)
        .join(" ");

    return (
        <span className={classes} role="img" aria-label="Sync">
            <img
                src="/logo-mark.webp"
                alt=""
                width="128"
                height="128"
                draggable="false"
                decoding="async"
            />
        </span>
    );
}
