import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Image as ImageIcon, Loader2, Star, X } from "lucide-react";
import {
    chooseWallpaper,
    loadWallpapers,
    useWallpaper,
    wallpaperFullUrl,
    wallpaperThumbUrl
} from "../services/wallpaper.js";
import { useCachedWallpaper } from "../services/wallpaperCache.js";

// ডিভাইসে সেভ করা ছবি দেখায় (নেট ছাড়াই), নাহলে সরাসরি URL
export function CachedImg({ url, alt = "", ...rest }) {
    const src = useCachedWallpaper(url);
    if (!src) return <span className="sync-wp-thumb-plain" />;
    return <img src={src} alt={alt} draggable="false" {...rest} />;
}

// ছোট ফোনের মতো preview: wallpaper + কয়েকটা নমুনা মেসেজ, যাতে আসলে কেমন দেখাবে বোঝা যায়
export function WallpaperPreview({ url, className = "" }) {
    const isRemote = Boolean(url) && !url.startsWith("blob:") && !url.startsWith("data:");
    const cached = useCachedWallpaper(isRemote ? url : "");
    const shown = isRemote ? cached : url;
    return (
        <div className={`sync-wp-preview ${className}`}>
            {shown ? (
                <div
                    className="sync-wp-preview-img"
                    style={{ backgroundImage: `url("${shown}")` }}
                />
            ) : (
                <div className="sync-wp-preview-plain" />
            )}
            <div className="sync-wp-preview-bubbles">
                <span className="in">Hey! How does it look?</span>
                <span className="out">Looks great 😍</span>
                <span className="in">Nice pick</span>
            </div>
        </div>
    );
}

// ইউজার এখানে admin-দের দেওয়া wallpaper-এর মধ্য থেকে একটা বেছে নেয়
export default function WallpaperPicker({ onClose }) {
    const { wallpapers, defaultId, myChoice, loaded } = useWallpaper();
    // "default" অথবা কোনো wallpaper-এর id
    const [selected, setSelected] = useState(myChoice || "default");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [touched, setTouched] = useState(false);

    useEffect(() => {
        loadWallpapers();
    }, []);

    // তালিকা আসার পর ইউজার নিজে কিছু না ছুঁলে বর্তমান পছন্দ দেখানো
    useEffect(() => {
        if (!touched) setSelected(myChoice || "default");
    }, [myChoice, touched]);

    // অনেক নিচের wallpaper বর্তমান পছন্দ হলেও খুলতেই সেটা চোখের সামনে আনা
    const gridRef = useRef(null);
    const scrolledRef = useRef(false);
    useEffect(() => {
        if (!loaded || scrolledRef.current) return;
        const el = gridRef.current?.querySelector(".sync-wp-card.is-selected");
        if (el) {
            scrolledRef.current = true;
            el.scrollIntoView({ block: "center" });
        }
    }, [loaded, wallpapers.length]);

    useEffect(() => {
        const onKey = e => e.key === "Escape" && onClose?.();
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [onClose]);

    const defaultWallpaper = useMemo(
        () => wallpapers.find(w => w._id === defaultId) || null,
        [wallpapers, defaultId]
    );

    // সব wallpaper-ই তালিকায় থাকে (default-টাও), যাতে কেউ চাইলে সেটাকে নিজের জন্য "আটকে" রাখতে পারে।
    // আলাদা "Default" কার্ড মানে: admin যা ঠিক করবে সেটাই অনুসরণ করা
    const others = wallpapers;

    const previewWallpaper =
        selected === "default"
            ? defaultWallpaper
            : wallpapers.find(w => w._id === selected) || defaultWallpaper;

    const current = myChoice || "default";
    const unchanged = selected === current;

    const handleSave = async () => {
        if (unchanged || saving) return;
        setSaving(true);
        setError("");
        try {
            await chooseWallpaper(selected === "default" ? null : selected);
            onClose?.();
        } catch (err) {
            setError(err.message || "Could not change the wallpaper");
        } finally {
            setSaving(false);
        }
    };

    const pick = id => {
        setTouched(true);
        setSelected(id);
        setError("");
    };

    return createPortal(
        <div className="sync-modal-backdrop" onClick={onClose}>
            <div
                className="sync-modal-card sync-wp-modal"
                role="dialog"
                aria-label="Chat wallpaper"
                onClick={e => e.stopPropagation()}
            >
                <div className="sync-modal-header">
                    <h3>Chat wallpaper</h3>
                    <button
                        type="button"
                        className="sync-icon-btn"
                        onClick={onClose}
                        aria-label="Close"
                    >
                        <X size={19} />
                    </button>
                </div>

                {/* প্রিভিউ সবসময় ওপরে স্থির, তাই যত নিচের wallpaper-ই বাছো না কেন দেখা যাবে */}
                <div className="sync-wp-stage">
                    <WallpaperPreview
                        className="compact"
                        url={
                            previewWallpaper
                                ? wallpaperFullUrl(previewWallpaper.url)
                                : ""
                        }
                    />
                    <div className="sync-wp-stage-name">
                        {selected === "default"
                            ? `Default${
                                  defaultWallpaper
                                      ? ` · ${defaultWallpaper.name}`
                                      : ""
                              }`
                            : previewWallpaper?.name || ""}
                    </div>
                </div>

                <div className="sync-wp-scroll">
                    {!loaded && wallpapers.length === 0 ? (
                        <div className="sync-wp-empty">
                            <Loader2 size={18} className="spin" /> Loading
                            wallpapers...
                        </div>
                    ) : (
                        <div className="sync-wp-grid" role="listbox" ref={gridRef}>
                            <button
                                type="button"
                                role="option"
                                aria-selected={selected === "default"}
                                className={`sync-wp-card ${
                                    selected === "default" ? "is-selected" : ""
                                }`}
                                onClick={() => pick("default")}
                            >
                                <span className="sync-wp-thumb">
                                    {defaultWallpaper ? (
                                        <CachedImg
                                            url={wallpaperThumbUrl(
                                                defaultWallpaper.url
                                            )}
                                            />
                                    ) : (
                                        <span className="sync-wp-thumb-plain">
                                            <ImageIcon size={22} />
                                        </span>
                                    )}
                                    {selected === "default" && (
                                        <span className="sync-wp-check">
                                            <Check size={14} strokeWidth={3} />
                                        </span>
                                    )}
                                    {current === "default" && (
                                        <span className="sync-wp-current">
                                            Current
                                        </span>
                                    )}
                                </span>
                                <span className="sync-wp-name">Default</span>
                                <span className="sync-wp-sub">
                                    {defaultWallpaper
                                        ? defaultWallpaper.name
                                        : "Sync classic"}
                                </span>
                            </button>

                            {others.map(w => (
                                <button
                                    key={w._id}
                                    type="button"
                                    role="option"
                                    aria-selected={selected === w._id}
                                    className={`sync-wp-card ${
                                        selected === w._id ? "is-selected" : ""
                                    }`}
                                    onClick={() => pick(w._id)}
                                >
                                    <span className="sync-wp-thumb">
                                        <CachedImg
                                            url={wallpaperThumbUrl(w.url)}
                                            />
                                        {selected === w._id && (
                                            <span className="sync-wp-check">
                                                <Check
                                                    size={14}
                                                    strokeWidth={3}
                                                />
                                            </span>
                                        )}
                                        {w._id === defaultId && (
                                            <span className="sync-wp-default-tag">
                                                <Star size={11} /> Default
                                            </span>
                                        )}
                                        {current === w._id && (
                                            <span className="sync-wp-current">
                                                Current
                                            </span>
                                        )}
                                    </span>
                                    <span className="sync-wp-name">
                                        {w.name}
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}

                    {loaded && wallpapers.length === 0 && (
                        <p className="sync-wp-hint">
                            No wallpapers have been added yet. Admins can add
                            new ones from the Admin panel.
                        </p>
                    )}
                    {selected === "default" && wallpapers.length > 0 && (
                        <p className="sync-wp-hint">
                            “Default” follows the wallpaper chosen by the admins,
                            so it updates automatically when they change it.
                        </p>
                    )}

                    {error && <div className="sync-alert error">{error}</div>}
                </div>

                    <div className="sync-modal-footer sync-wp-footer">
                        <button
                            type="button"
                            className="sync-btn ghost"
                            onClick={onClose}
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            className="sync-btn primary"
                            disabled={unchanged || saving}
                            onClick={handleSave}
                        >
                            {saving ? "Saving..." : "Set wallpaper"}
                        </button>
                    </div>
            </div>
        </div>,
        document.body
    );
}
