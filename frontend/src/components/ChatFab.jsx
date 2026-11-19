import React, { useEffect, useRef, useState } from "react";
import { MessageSquarePlus, UserPlus, Users, X } from "lucide-react";

// WhatsApp-স্টাইল floating বাটন (শুধু মোবাইলে দেখায়, CSS দিয়ে)।
// চাপলে "New chat" আর "New group" ওপরে উঠে আসে। লিস্ট নিচে স্ক্রল করলে ছোট হয়ে লুকায়, ওপরে স্ক্রল করলে ফিরে আসে।
// স্ক্রলের সময় re-render হয় না (শুধু classList বদলায়), তাই lag হয় না।
export default function ChatFab({ onNewChat, onNewGroup, scrollRef }) {
    const rootRef = useRef(null);
    const [open, setOpen] = useState(false);

    useEffect(() => {
        const el = scrollRef?.current;
        const root = rootRef.current;
        if (!el || !root) return undefined;
        let last = el.scrollTop;
        const onScroll = () => {
            const y = el.scrollTop;
            const dy = y - last;
            if (Math.abs(dy) < 6) return;
            root.classList.toggle("is-hidden", dy > 0 && y > 60);
            last = y;
        };
        el.addEventListener("scroll", onScroll, { passive: true });
        return () => el.removeEventListener("scroll", onScroll);
    }, [scrollRef]);

    useEffect(() => {
        if (!open) return undefined;
        const onKey = e => e.key === "Escape" && setOpen(false);
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [open]);

    const pick = fn => {
        setOpen(false);
        setTimeout(() => fn?.(), 110);
    };

    return (
        <div ref={rootRef} className={`sync-fab-root ${open ? "is-open" : ""}`}>
            <div className="sync-fab-scrim" onClick={() => setOpen(false)} />

            <div className="sync-fab-actions" aria-hidden={!open}>
                <button
                    type="button"
                    className="sync-fab-mini"
                    style={{ "--d": "55ms" }}
                    onClick={() => pick(onNewGroup)}
                    tabIndex={open ? 0 : -1}
                >
                    <span className="sync-fab-label">New group</span>
                    <span className="sync-fab-ico">
                        <Users size={20} />
                    </span>
                </button>
                <button
                    type="button"
                    className="sync-fab-mini"
                    style={{ "--d": "0ms" }}
                    onClick={() => pick(onNewChat)}
                    tabIndex={open ? 0 : -1}
                >
                    <span className="sync-fab-label">New chat</span>
                    <span className="sync-fab-ico">
                        <UserPlus size={20} />
                    </span>
                </button>
            </div>

            <button
                type="button"
                className="sync-fab-main"
                onClick={() => setOpen(v => !v)}
                aria-label={open ? "Close menu" : "New chat or group"}
                aria-expanded={open}
            >
                <MessageSquarePlus size={26} className="i-plus" />
                <X size={26} className="i-close" />
            </button>
        </div>
    );
}
