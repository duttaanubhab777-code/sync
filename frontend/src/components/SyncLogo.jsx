import React from "react";

export default function SyncLogo({ size = "auth", className = "" }) {
    return (
        <span
            className={`sync-brand-mark sync-brand-mark--${size} ${className}`.trim()}
            aria-label="Sync"
        >
            <img src="/Sync.png" alt="Sync logo" draggable="false" />
        </span>
    );
}
