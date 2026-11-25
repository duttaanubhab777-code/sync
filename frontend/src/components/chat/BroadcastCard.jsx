import React from "react";
import { Megaphone } from "lucide-react";
import VerifiedBadge from "../VerifiedBadge.jsx";

/**
 * অ্যাডমিন প্যানেল থেকে অফিশিয়াল Sync অ্যাকাউন্ট দিয়ে পাঠানো ব্রডকাস্ট অ্যানাউন্সমেন্ট কার্ড
 */
export default function BroadcastCard({ card }) {
    const title = card?.title || "Sync Update";
    const body = card?.body || "";
    const tag = card?.tag || "Announcement";

    return (
        <div className="sync-broadcast-card">
            <div className="sync-broadcast-head">
                <div className="sync-broadcast-brand">
                    <span className="sync-broadcast-logo">
                        <img
                            src="/logo-mark.webp"
                            alt="Sync"
                            width="22"
                            height="22"
                            draggable="false"
                        />
                    </span>
                    <span className="sync-broadcast-name">
                        Sync <VerifiedBadge variant="official" size={14} />
                    </span>
                </div>
                <span className="sync-broadcast-tag">
                    <Megaphone size={11} />
                    {tag}
                </span>
            </div>
            <h4 className="sync-broadcast-title">{title}</h4>
            {body && <p className="sync-broadcast-body">{body}</p>}
        </div>
    );
}
