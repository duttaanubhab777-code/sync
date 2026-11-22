import React, {
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState
} from "react";
import { createPortal } from "react-dom";
import {
    ArrowLeft,
    Check,
    Image as ImageIcon,
    Loader2,
    Star,
    Sun,
    SunDim
} from "lucide-react";
import {
    MIN_WALLPAPER_BRIGHTNESS,
    chooseWallpaper,
    loadWallpapers,
    setWallpaperBrightness,
    useWallpaper,
    wallpaperFullUrl,
    wallpaperThumbUrl
} from "../services/wallpaper.js";
import { pushBackHandler } from "../services/backNavigation.js";
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

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// ---------- ডানদিকের উজ্জ্বলতা slider (ওপরে = পূর্ণ উজ্জ্বলতা) ----------
function BrightnessSlider({ value, onChange }) {
    const trackRef = useRef(null);
    const dragging = useRef(false);
    const ratio = (value - MIN_WALLPAPER_BRIGHTNESS) / (100 - MIN_WALLPAPER_BRIGHTNESS);

    const update = e => {
        const el = trackRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const t = clamp(1 - (e.clientY - r.top) / r.height, 0, 1);
        onChange(
            Math.round(
                MIN_WALLPAPER_BRIGHTNESS + t * (100 - MIN_WALLPAPER_BRIGHTNESS)
            )
        );
    };

    const onKeyDown = e => {
        if (e.key === "ArrowUp" || e.key === "ArrowRight") {
            e.preventDefault();
            onChange(clamp(value + 5, MIN_WALLPAPER_BRIGHTNESS, 100));
        } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
            e.preventDefault();
            onChange(clamp(value - 5, MIN_WALLPAPER_BRIGHTNESS, 100));
        }
    };

    return (
        <div className="sync-wpx-bright">
            <span className="sync-wpx-bright-value">{value}%</span>
            <div
                ref={trackRef}
                className="sync-wpx-bright-track"
                role="slider"
                tabIndex={0}
                aria-label="Wallpaper brightness"
                aria-orientation="vertical"
                aria-valuemin={MIN_WALLPAPER_BRIGHTNESS}
                aria-valuemax={100}
                aria-valuenow={value}
                onKeyDown={onKeyDown}
                onPointerDown={e => {
                    dragging.current = true;
                    e.currentTarget.setPointerCapture?.(e.pointerId);
                    update(e);
                }}
                onPointerMove={e => dragging.current && update(e)}
                onPointerUp={() => (dragging.current = false)}
                onPointerCancel={() => (dragging.current = false)}
            >
                <span
                    className="sync-wpx-bright-fill"
                    style={{ height: `${ratio * 100}%` }}
                />
                <span
                    className="sync-wpx-bright-thumb"
                    style={{ bottom: `calc(${ratio} * (100% - 36px))` }}
                >
                    <SunDim size={18} />
                </span>
            </div>
            <button
                type="button"
                className="sync-wpx-round"
                onClick={() => onChange(100)}
                aria-label="Reset to full brightness"
                title="Full brightness"
            >
                <Sun size={20} />
            </button>
        </div>
    );
}

// ---------- swipe করার একেকটা পাতা ----------
function PreviewPage({ wallpaper, near, brightness }) {
    const full = wallpaper ? wallpaperFullUrl(wallpaper.url) : "";
    const thumb = wallpaper ? wallpaperThumbUrl(wallpaper.url) : "";
    // কাছের পাতায় পূর্ণ ছবি, দূরেরগুলোতে হালকা thumbnail (দ্রুত ও কম ডেটা)
    const src = useCachedWallpaper(near ? full : thumb);
    return (
        <div className="sync-wpx-page">
            {src ? (
                <div
                    className="sync-wpx-page-img"
                    style={{
                        backgroundImage: `url("${src}")`,
                        filter:
                            brightness < 100
                                ? `brightness(${brightness / 100})`
                                : undefined
                    }}
                />
            ) : (
                <div className="sync-wpx-page-plain" />
            )}
        </div>
    );
}

// বেশি wallpaper হলেও সর্বোচ্চ ৭টা বিন্দু দেখায়, দুই প্রান্তেরগুলো ছোট
function Dots({ count, index }) {
    const SHOW = 7;
    const start = clamp(index - 3, 0, Math.max(0, count - SHOW));
    const end = Math.min(count, start + SHOW);
    const items = [];
    for (let i = start; i < end; i += 1) {
        const edge =
            (i === start && start > 0) || (i === end - 1 && end < count);
        items.push(
            <span
                key={i}
                className={`sync-wpx-dot ${i === index ? "is-active" : ""} ${
                    edge ? "is-edge" : ""
                }`}
            />
        );
    }
    return <div className="sync-wpx-dots">{items}</div>;
}

function PreviewScreen({
    pages,
    selected,
    setSelected,
    brightness,
    setBrightness,
    saving,
    error,
    onBack,
    onSave
}) {
    const pagerRef = useRef(null);
    const index = Math.max(
        0,
        pages.findIndex(p => p.id === selected)
    );
    const time = useMemo(
        () =>
            new Date().toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit"
            }),
        []
    );

    // খুলতেই বেছে নেওয়া wallpaper-এর পাতায় যাওয়া
    useLayoutEffect(() => {
        const el = pagerRef.current;
        if (el) el.scrollLeft = index * el.clientWidth;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const onScroll = e => {
        const el = e.currentTarget;
        if (!el.clientWidth) return;
        const i = clamp(Math.round(el.scrollLeft / el.clientWidth), 0, pages.length - 1);
        if (pages[i] && pages[i].id !== selected) setSelected(pages[i].id);
    };

    const page = pages[index];

    return (
        <div className="sync-wpx sync-wpx-preview" role="dialog" aria-label="Wallpaper preview">
            <div className="sync-wpx-pager" ref={pagerRef} onScroll={onScroll}>
                {pages.map((pg, i) => (
                    <PreviewPage
                        key={pg.id}
                        wallpaper={pg.wallpaper}
                        near={Math.abs(i - index) <= 1}
                        brightness={brightness}
                    />
                ))}
            </div>

            <div className="sync-wpx-topbar">
                <button
                    type="button"
                    className="sync-wpx-icon"
                    onClick={onBack}
                    aria-label="Back"
                >
                    <ArrowLeft size={22} />
                </button>
                <h3>Preview</h3>
                <button
                    type="button"
                    className="sync-wpx-set"
                    onClick={onSave}
                    disabled={saving}
                    aria-label="Set wallpaper"
                    title="Set wallpaper"
                >
                    {saving ? (
                        <Loader2 size={22} className="spin" />
                    ) : (
                        <Check size={24} strokeWidth={3} />
                    )}
                </button>
            </div>

            <div className="sync-wpx-bubbles">
                <div className="in">
                    Swipe left or right to preview more wallpapers 🖼️✨
                    <time>{time}</time>
                </div>
                <div className="out">
                    This will replace your current chat wallpaper. Only you can
                    see it.
                    <time>{time}</time>
                </div>
            </div>

            <BrightnessSlider value={brightness} onChange={setBrightness} />

            <div className="sync-wpx-bottom">
                {error && <div className="sync-wpx-error">{error}</div>}
                <div className="sync-wpx-name">
                    {page?.id === "default" ? "Default" : page?.name}
                    {page?.sub ? <small> · {page.sub}</small> : null}
                </div>
                <Dots count={pages.length} index={index} />
            </div>
        </div>
    );
}

// ইউজার এখানে admin-দের দেওয়া wallpaper-এর মধ্য থেকে একটা বেছে নেয়:
// ১) gallery (সব wallpaper একসাথে)  →  ২) full-screen preview (swipe, উজ্জ্বলতা, ✓ দিয়ে সেট)
export default function WallpaperPicker({ onClose }) {
    const {
        wallpapers,
        defaultId,
        myChoice,
        loaded,
        brightness: savedBrightness
    } = useWallpaper();
    const [view, setView] = useState("gallery"); // "gallery" | "preview"
    const [selected, setSelected] = useState(myChoice || "default");
    const [brightness, setBrightness] = useState(savedBrightness ?? 100);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        loadWallpapers();
    }, []);

    const defaultWallpaper = useMemo(
        () => wallpapers.find(w => w._id === defaultId) || null,
        [wallpapers, defaultId]
    );

    // প্রথম পাতা "Default" (admin যা ঠিক করে সেটাই অনুসরণ), তারপর সব wallpaper
    const pages = useMemo(
        () => [
            {
                id: "default",
                name: "Default",
                sub: defaultWallpaper?.name || "",
                wallpaper: defaultWallpaper
            },
            ...wallpapers.map(w => ({ id: w._id, name: w.name, wallpaper: w }))
        ],
        [wallpapers, defaultWallpaper]
    );

    const current = myChoice || "default";

    // Android Back / Esc: preview → gallery → বন্ধ
    const viewRef = useRef(view);
    viewRef.current = view;
    useEffect(() => {
        const goBack = () => {
            if (viewRef.current === "preview") {
                setView("gallery");
                setError("");
            } else {
                onClose?.();
            }
        };
        const off = pushBackHandler(() => {
            goBack();
            return true;
        });
        const onKey = e => e.key === "Escape" && goBack();
        document.addEventListener("keydown", onKey);
        return () => {
            off();
            document.removeEventListener("keydown", onKey);
        };
    }, [onClose]);

    const openPreview = id => {
        setSelected(id);
        setError("");
        setView("preview");
    };

    const handleSave = async () => {
        if (saving) return;
        setSaving(true);
        setError("");
        try {
            if (selected !== current) {
                await chooseWallpaper(selected === "default" ? null : selected);
            }
            setWallpaperBrightness(brightness);
            onClose?.();
        } catch (err) {
            setError(err.message || "Could not change the wallpaper");
        } finally {
            setSaving(false);
        }
    };

    if (view === "preview" && pages.length > 0) {
        return createPortal(
            <PreviewScreen
                pages={pages}
                selected={selected}
                setSelected={setSelected}
                brightness={brightness}
                setBrightness={setBrightness}
                saving={saving}
                error={error}
                onBack={() => {
                    setView("gallery");
                    setError("");
                }}
                onSave={handleSave}
            />,
            document.body
        );
    }

    return createPortal(
        <div className="sync-wpx sync-wpx-gallery" role="dialog" aria-label="Chat wallpaper">
            <div className="sync-wpx-head">
                <button
                    type="button"
                    className="sync-wpx-icon plain"
                    onClick={onClose}
                    aria-label="Back"
                >
                    <ArrowLeft size={22} />
                </button>
                <h3>Chat wallpaper</h3>
            </div>

            <div className="sync-wpx-scroll">
                {!loaded && wallpapers.length === 0 ? (
                    <div className="sync-wp-empty">
                        <Loader2 size={18} className="spin" /> Loading wallpapers...
                    </div>
                ) : wallpapers.length === 0 ? (
                    <p className="sync-wp-hint">
                        No wallpapers have been added yet. Admins can add new
                        ones from the Admin panel.
                    </p>
                ) : (
                    <div className="sync-wp-grid" role="listbox">
                        {pages.map(pg => (
                            <button
                                key={pg.id}
                                type="button"
                                role="option"
                                aria-selected={current === pg.id}
                                className={`sync-wp-card ${
                                    current === pg.id ? "is-selected" : ""
                                }`}
                                onClick={() => openPreview(pg.id)}
                            >
                                <span className="sync-wp-thumb">
                                    {pg.wallpaper ? (
                                        <CachedImg
                                            url={wallpaperThumbUrl(pg.wallpaper.url)}
                                        />
                                    ) : (
                                        <span className="sync-wp-thumb-plain">
                                            <ImageIcon size={22} />
                                        </span>
                                    )}
                                    {current === pg.id && (
                                        <span className="sync-wp-check">
                                            <Check size={14} strokeWidth={3} />
                                        </span>
                                    )}
                                    {pg.id !== "default" &&
                                        pg.id === defaultId && (
                                            <span className="sync-wp-default-tag">
                                                <Star size={11} /> Default
                                            </span>
                                        )}
                                    {current === pg.id && (
                                        <span className="sync-wp-current">
                                            Current
                                        </span>
                                    )}
                                </span>
                                <span className="sync-wp-name">{pg.name}</span>
                                {pg.id === "default" && (
                                    <span className="sync-wp-sub">
                                        {pg.sub || "Sync classic"}
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>,
        document.body
    );
}
