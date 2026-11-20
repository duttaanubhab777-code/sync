import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
    EllipsisVertical,
    Volume2,
    VolumeX,
    Download,
    Mail,
    LogOut
} from "lucide-react";
import { isSoundEnabled, setSoundEnabled } from "../services/sounds.js";

// নেভবার-এ জায়গা বাঁচাতে সব কম-দরকারি জিনিস এই এক ⋮ মেনুতে।
// মোবাইলে নিচ থেকে উঠে আসা sheet, ডেস্কটপে বাটনের নিচে ছোট popover।
// Portal ব্যবহার করা হয়েছে, কারণ sidebar-এর `contain: paint` fixed-লেয়ারকে কেটে দেয়।
export default function MoreMenu({ onSignOut, hasUpdate = false, className = "" }) {
    const navigate = useNavigate();
    const btnRef = useRef(null);
    const [open, setOpen] = useState(false);
    const [closing, setClosing] = useState(false);
    const [pos, setPos] = useState({ top: 0, right: 0 });
    const [soundOn, setSoundOn] = useState(isSoundEnabled());

    const close = useCallback(() => {
        setClosing(true);
        setTimeout(() => {
            setOpen(false);
            setClosing(false);
        }, 150);
    }, []);

    const toggle = () => {
        if (open) {
            close();
            return;
        }
        const r = btnRef.current?.getBoundingClientRect();
        if (r) {
            setPos({
                top: Math.round(r.bottom + 8),
                right: Math.max(8, Math.round(window.innerWidth - r.right))
            });
        }
        setSoundOn(isSoundEnabled());
        setOpen(true);
    };

    useEffect(() => {
        if (!open) return undefined;
        const onKey = e => e.key === "Escape" && close();
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [open, close]);

    const go = path => {
        close();
        setTimeout(() => navigate(path), 120);
    };

    const toggleSound = () => {
        const next = !soundOn;
        setSoundEnabled(next);
        setSoundOn(next);
    };

    return (
        <>
            <button
                ref={btnRef}
                type="button"
                className={`sync-more-btn ${open ? "is-open" : ""} ${className}`}
                onClick={toggle}
                aria-label="More options"
                aria-haspopup="menu"
                aria-expanded={open}
                title="More"
            >
                <EllipsisVertical size={20} />
                {hasUpdate && <span className="sync-update-dot" />}
            </button>

            {open &&
                createPortal(
                    <div className={`sync-more-layer ${closing ? "is-closing" : ""}`}>
                        <div className="sync-more-scrim" onClick={close} />
                        <div
                            className="sync-more-panel"
                            role="menu"
                            style={{ "--mm-top": `${pos.top}px`, "--mm-right": `${pos.right}px` }}
                        >
                            <span className="sync-more-grab" aria-hidden="true" />

                            <button type="button" role="menuitem" className="sync-more-item" onClick={toggleSound}>
                                <span className="sync-more-ico">
                                    {soundOn ? <Volume2 size={18} /> : <VolumeX size={18} />}
                                </span>
                                <span className="sync-more-text">Message sounds</span>
                                <span className={`sync-more-switch ${soundOn ? "on" : ""}`} aria-hidden="true">
                                    <i />
                                </span>
                            </button>

                            <button type="button" role="menuitem" className="sync-more-item" onClick={() => go("/updates")}>
                                <span className="sync-more-ico">
                                    <Download size={18} />
                                    {hasUpdate && <span className="sync-update-dot" />}
                                </span>
                                <span className="sync-more-text">App updates</span>
                                {hasUpdate && <span className="sync-more-tag">New</span>}
                            </button>

                            <button type="button" role="menuitem" className="sync-more-item" onClick={() => go("/contact")}>
                                <span className="sync-more-ico">
                                    <Mail size={18} />
                                </span>
                                <span className="sync-more-text">Contact Sync</span>
                            </button>

                            <span className="sync-more-sep" aria-hidden="true" />

                            <button
                                type="button"
                                role="menuitem"
                                className="sync-more-item is-danger"
                                onClick={() => {
                                    close();
                                    setTimeout(() => onSignOut?.(), 120);
                                }}
                            >
                                <span className="sync-more-ico">
                                    <LogOut size={18} />
                                </span>
                                <span className="sync-more-text">Sign out</span>
                            </button>
                        </div>
                    </div>,
                    document.body
                )}
        </>
    );
}
