import React from "react";
import { getInitials } from "../utils/format.js";

export default function Avatar({
    src = "",
    name = "",
    size = 44,
    online = false,
    showOnline = false,
    isGroup = false
}) {
    const initials = getInitials(name || (isGroup ? "GP" : "U"));

    return (
        <div
            className="sync-avatar-wrap"
            style={{ width: size, height: size, minWidth: size }}
        >
            {src ? (
                <img
                    src={src}
                    alt={name || "avatar"}
                    className="sync-avatar-img"
                    loading="lazy"
                />
            ) : (
                <div
                    className={`sync-avatar-fallback ${isGroup ? "is-group" : ""}`}
                    style={{ fontSize: Math.max(12, Math.floor(size * 0.38)) }}
                >
                    {initials}
                </div>
            )}
            {showOnline && (
                <span
                    className={`sync-presence-dot ${online ? "is-online" : "is-offline"}`}
                    title={online ? "Online" : "Offline"}
                />
            )}
        </div>
    );
}
