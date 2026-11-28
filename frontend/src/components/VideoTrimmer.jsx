import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Play, Scissors, Volume2, VolumeX, X } from "lucide-react";
import { pushBackHandler } from "../services/backNavigation.js";
import { STORY_VIDEO_MAX_SECONDS, TRIM_MIN_SECONDS } from "../utils/video.js";

// WhatsApp-এর মতো ভিডিও trim এডিটর (স্টোরি শেয়ারের আগে)।
//   - নিচে ফিল্মস্ট্রিপ, দুই পাশে হ্যান্ডেল টেনে শুরু/শেষ বেছে নেওয়া; মাঝের অংশ ধরে টানলে পুরো উইন্ডো সরে
//   - বাছা অংশ লুপে চলে; হ্যান্ডেল টানার সময় ওই বিন্দুর ফ্রেম দেখায় ও সময়ের বাবল ভাসে
//   - সর্বোচ্চ maxSeconds (ডিফল্ট ২ মিনিট), সর্বনিম্ন ১s; সীমায় ঠেকলে পিল হলুদ হয়ে কেঁপে ওঠে
// এডিটর শুধু start/end বেছে দেয়; আসল ছাঁটা হয় আপলোড কিউতে (utils/video.js)।
//
// props: file, initial ({start,end}), maxSeconds, onCancel(), onDone({ start, end, total, trimmed })

const THUMBS = 10;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

const clock = sec => {
    const s = Math.max(0, Number(sec) || 0);
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

// 120 -> "2 minutes", 30 -> "30 seconds"
const maxLabel = sec =>
    sec >= 60 && sec % 60 === 0
        ? `${sec / 60} minute${sec / 60 > 1 ? "s" : ""}`
        : `${sec} seconds`;

const lenLabel = sec => {
    const s = Math.max(0, Number(sec) || 0);
    if (s >= 60) return clock(s);
    return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
};

const once = (target, evt, ms) =>
    new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error("timeout"));
        }, ms);
        const ok = () => {
            cleanup();
            resolve();
        };
        const bad = () => {
            cleanup();
            reject(new Error("media error"));
        };
        const cleanup = () => {
            clearTimeout(timer);
            target.removeEventListener(evt, ok);
            target.removeEventListener("error", bad);
        };
        target.addEventListener(evt, ok);
        target.addEventListener("error", bad);
    });

export default function VideoTrimmer({
    file,
    initial = null,
    maxSeconds = STORY_VIDEO_MAX_SECONDS,
    onCancel,
    onDone
}) {
    const [url, setUrl] = useState("");
    const [duration, setDuration] = useState(0);
    const [range, setRange] = useState(null);
    const [playing, setPlaying] = useState(false);
    const [muted, setMuted] = useState(false);
    const [thumbs, setThumbs] = useState([]);
    const [dragKind, setDragKind] = useState(null);
    const [limitHit, setLimitHit] = useState(false);
    const [error, setError] = useState("");
    const [leaving, setLeaving] = useState(false);
    const [hint, setHint] = useState(true);

    const videoRef = useRef(null);
    const stripRef = useRef(null);
    const playheadRef = useRef(null);
    const rangeRef = useRef(null);
    const durRef = useRef(0);
    const dragRef = useRef(null);
    const seekRef = useRef(null);
    const leaveTimer = useRef(null);
    const cbRef = useRef({ onCancel, onDone });
    cbRef.current = { onCancel, onDone };
    rangeRef.current = range;
    durRef.current = duration;

    // ---- ফাইল → object URL ----
    useEffect(() => {
        if (!file) return undefined;
        const u = URL.createObjectURL(file);
        setUrl(u);
        return () => URL.revokeObjectURL(u);
    }, [file]);

    // ---- বন্ধ (সুন্দর slide-down) ----
    const leaveThen = useCallback(fn => {
        if (leaveTimer.current) return;
        try {
            videoRef.current?.pause();
        } catch {
            /* ignore */
        }
        setLeaving(true);
        leaveTimer.current = setTimeout(() => {
            leaveTimer.current = null;
            fn();
        }, 210);
    }, []);
    useEffect(() => () => clearTimeout(leaveTimer.current), []);

    const cancel = useCallback(() => leaveThen(() => cbRef.current.onCancel?.()), [leaveThen]);

    // ফোনের Back বাটন ও Esc: এডিটর বন্ধ
    useEffect(() => {
        const off = pushBackHandler(() => {
            cancel();
            return true;
        });
        return off;
    }, [cancel]);

    // ---- প্লে ----
    const play = useCallback(async () => {
        const v = videoRef.current;
        if (!v) return;
        const r = rangeRef.current;
        if (r && (v.currentTime < r.start - 0.05 || v.currentTime >= r.end - 0.05)) {
            v.currentTime = r.start;
        }
        try {
            await v.play();
        } catch {
            // সাউন্ডসহ অটোপ্লে ব্লক হলে মিউট করে চালানো
            if (!v.muted) {
                v.muted = true;
                setMuted(true);
                try {
                    await v.play();
                } catch {
                    /* ইউজার ট্যাপ করলে চলবে */
                }
            }
        }
    }, []);

    const togglePlay = () => {
        const v = videoRef.current;
        if (!v || !rangeRef.current) return;
        if (v.paused) play();
        else v.pause();
    };

    useEffect(() => {
        const v = videoRef.current;
        if (v) v.muted = muted;
    }, [muted, url]);

    // ---- মেটাডেটা: শুরুর রেঞ্জ ঠিক করা ----
    const onLoadedMetadata = e => {
        const v = e.currentTarget;
        const d = v.duration;
        if (!Number.isFinite(d) || d <= 0) {
            setError("This video can't be edited. Try another one.");
            return;
        }
        setDuration(d);
        let s = 0;
        let en = Math.min(d, maxSeconds);
        if (initial && Number.isFinite(initial.start) && Number.isFinite(initial.end) && initial.end > initial.start) {
            s = clamp(initial.start, 0, Math.max(0, d - TRIM_MIN_SECONDS));
            en = clamp(initial.end, Math.min(d, s + TRIM_MIN_SECONDS), Math.min(d, s + maxSeconds));
        }
        const r = { start: s, end: en };
        rangeRef.current = r;
        setRange(r);
        v.currentTime = s;
    };

    const onLoadedData = () => {
        if (rangeRef.current) play();
    };

    // ---- ফ্রেম লুপ: seek (frame-এ ১বার), লুপ, প্লেহেড ----
    useEffect(() => {
        let raf = 0;
        let lastLeft = "";
        let lastOpacity = "";
        const tick = () => {
            const v = videoRef.current;
            const r = rangeRef.current;
            const d = durRef.current;
            if (v && r && d) {
                if (seekRef.current != null) {
                    if (!v.seeking) {
                        try {
                            v.currentTime = seekRef.current;
                        } catch {
                            /* ignore */
                        }
                        seekRef.current = null;
                    }
                } else if (!dragRef.current && !v.paused && v.currentTime >= r.end - 0.04) {
                    v.currentTime = r.start; // বাছা অংশ লুপে
                }
                const ph = playheadRef.current;
                if (ph) {
                    const left = `${clamp(v.currentTime / d, 0, 1) * 100}%`;
                    const inRange = v.currentTime >= r.start - 0.08 && v.currentTime <= r.end + 0.08;
                    const opacity = inRange && !dragRef.current ? "1" : "0";
                    if (left !== lastLeft) {
                        ph.style.left = left;
                        lastLeft = left;
                    }
                    if (opacity !== lastOpacity) {
                        ph.style.opacity = opacity;
                        lastOpacity = opacity;
                    }
                }
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, []);

    // ---- ফিল্মস্ট্রিপের থাম্বনেইল (আলাদা লুকানো ভিডিও থেকে, একটা একটা করে) ----
    useEffect(() => {
        if (!url || !duration) return undefined;
        let cancelled = false;
        const tv = document.createElement("video");
        tv.muted = true;
        tv.preload = "auto";
        tv.playsInline = true;
        tv.setAttribute("playsinline", "");
        tv.src = url;
        const canvas = document.createElement("canvas");
        const CW = 72;
        const CH = 96;
        canvas.width = CW;
        canvas.height = CH;
        const ctx = canvas.getContext("2d");

        (async () => {
            try {
                await once(tv, "loadeddata", 12000);
            } catch {
                return;
            }
            const vw = tv.videoWidth;
            const vh = tv.videoHeight;
            if (!vw || !vh || !ctx) return;
            const scale = Math.max(CW / vw, CH / vh);
            const sw = CW / scale;
            const sh = CH / scale;
            for (let i = 0; i < THUMBS; i += 1) {
                if (cancelled) return;
                const t = Math.min(Math.max(0, duration - 0.1), ((i + 0.5) * duration) / THUMBS);
                try {
                    tv.currentTime = t;
                    await once(tv, "seeked", 4000);
                    ctx.drawImage(tv, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, CW, CH);
                    const data = canvas.toDataURL("image/jpeg", 0.68);
                    if (cancelled) return;
                    setThumbs(prev => {
                        const next = prev.slice();
                        next[i] = data;
                        return next;
                    });
                } catch {
                    /* এই ফ্রেম বাদ — প্লেসহোল্ডারই থাকবে */
                }
            }
        })();

        return () => {
            cancelled = true;
            try {
                tv.removeAttribute("src");
                tv.load();
            } catch {
                /* ignore */
            }
        };
    }, [url, duration]);

    // ---- হ্যান্ডেল / উইন্ডো টানা ----
    const applyRange = (s, en, kind, hit) => {
        const r = { start: s, end: en };
        rangeRef.current = r;
        setRange(r);
        setLimitHit(hit);
        seekRef.current = kind === "end" ? Math.max(s, en - 0.15) : s;
    };

    const beginDrag = kind => e => {
        if (!rangeRef.current) return;
        if (e.pointerType === "mouse" && e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const rect = stripRef.current?.getBoundingClientRect();
        if (!rect || !rect.width) return;
        const r = rangeRef.current;
        dragRef.current = { kind, id: e.pointerId, width: rect.width, x0: e.clientX, s0: r.start, e0: r.end };
        try {
            e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
            /* ignore */
        }
        try {
            videoRef.current?.pause();
        } catch {
            /* ignore */
        }
        setDragKind(kind);
        setHint(false);
    };

    const moveDrag = e => {
        const d = dragRef.current;
        if (!d || d.id !== e.pointerId) return;
        const total = durRef.current;
        const dt = ((e.clientX - d.x0) / d.width) * total;
        if (d.kind === "start") {
            const lo = Math.max(0, d.e0 - maxSeconds);
            const hi = d.e0 - TRIM_MIN_SECONDS;
            const want = d.s0 + dt;
            applyRange(clamp(want, lo, hi), d.e0, "start", want < lo - 0.001);
        } else if (d.kind === "end") {
            const lo = d.s0 + TRIM_MIN_SECONDS;
            const hi = Math.min(total, d.s0 + maxSeconds);
            const want = d.e0 + dt;
            applyRange(d.s0, clamp(want, lo, hi), "end", want > d.s0 + maxSeconds + 0.001);
        } else {
            const len = d.e0 - d.s0;
            const s = clamp(d.s0 + dt, 0, Math.max(0, total - len));
            applyRange(s, s + len, "window", false);
        }
    };

    const endDrag = e => {
        const d = dragRef.current;
        if (!d || d.id !== e.pointerId) return;
        dragRef.current = null;
        setDragKind(null);
        setLimitHit(false);
        const r = rangeRef.current;
        if (r) seekRef.current = r.start;
        play(); // নতুন অংশ আবার শুরু থেকে চলে
    };

    // কিবোর্ড (ডেস্কটপ): হ্যান্ডেলে ← → = ০.১s, Shift = ১s
    const nudge = kind => e => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        const r = rangeRef.current;
        if (!r) return;
        const step = (e.shiftKey ? 1 : 0.1) * (e.key === "ArrowLeft" ? -1 : 1);
        const total = durRef.current;
        setHint(false);
        if (kind === "start") {
            const s = clamp(r.start + step, Math.max(0, r.end - maxSeconds), r.end - TRIM_MIN_SECONDS);
            applyRange(s, r.end, "start", false);
        } else {
            const en = clamp(r.end + step, r.start + TRIM_MIN_SECONDS, Math.min(total, r.start + maxSeconds));
            applyRange(r.start, en, "end", false);
        }
    };

    useEffect(() => {
        const onKey = e => {
            if (e.key === "Escape") cancel();
            else if (e.key === " " && e.target === document.body) {
                e.preventDefault();
                togglePlay();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [cancel]);

    const sel = range || { start: 0, end: 0 };
    const sPct = duration ? (sel.start / duration) * 100 : 0;
    const ePct = duration ? (sel.end / duration) * 100 : 0;
    const len = Math.max(0, sel.end - sel.start);
    const isFull = Boolean(duration) && sel.start <= 0.05 && sel.end >= duration - 0.05;

    const done = () => {
        if (!range) return;
        const out = {
            start: range.start,
            end: range.end,
            total: duration,
            trimmed: !isFull
        };
        leaveThen(() => cbRef.current.onDone?.(out));
    };

    const bubbleAt = dragKind === "end" ? ePct : sPct;
    const bubbleTime = dragKind === "end" ? sel.end : sel.start;

    return createPortal(
        <div
            className={`sync-trim ${leaving ? "is-leaving" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label="Trim video"
        >
            <div className="sync-trim-glow" aria-hidden="true" />

            <header className="sync-trim-head">
                <button type="button" className="sync-trim-iconbtn" onClick={cancel} aria-label="Close">
                    <X size={22} />
                </button>
                <div className="sync-trim-title">
                    <Scissors size={16} />
                    <span>Trim video</span>
                </div>
                <button
                    type="button"
                    className="sync-trim-iconbtn"
                    onClick={() => setMuted(m => !m)}
                    aria-label={muted ? "Unmute" : "Mute"}
                >
                    <span key={muted ? "off" : "on"} className="sync-trim-swap">
                        {muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
                    </span>
                </button>
            </header>

            <div className="sync-trim-stage" onClick={togglePlay}>
                {url && !error && (
                    <video
                        ref={videoRef}
                        src={url}
                        playsInline
                        preload="auto"
                        onLoadedMetadata={onLoadedMetadata}
                        onLoadedData={onLoadedData}
                        onPlay={() => setPlaying(true)}
                        onPause={() => setPlaying(false)}
                        onError={() => setError("This video can't be played here. Try another one.")}
                    />
                )}
                <div className={`sync-trim-playbadge ${range && !playing && !dragKind ? "show" : ""}`}>
                    <Play size={30} />
                </div>
                {!range && !error && (
                    <div className="sync-trim-loading" aria-label="Loading video">
                        <span className="sync-trim-spinner" />
                    </div>
                )}
                {error && <div className="sync-trim-error">{error}</div>}
            </div>

            <section className="sync-trim-panel">
                <div className="sync-trim-readout">
                    <div className={`sync-trim-len ${limitHit ? "is-limit" : ""}`}>
                        <b>{lenLabel(len)}</b>
                        <span>{limitHit ? `Max ${clock(maxSeconds)}` : duration ? `of ${clock(duration)}` : ""}</span>
                    </div>
                    <div className="sync-trim-range">
                        {clock(sel.start)} – {clock(sel.end)}
                    </div>
                </div>

                <div className="sync-trim-track">
                    <div className="sync-trim-strip" ref={stripRef}>
                        <div className="sync-trim-thumbs">
                            {Array.from({ length: THUMBS }).map((_, i) => (
                                <span key={i} className={`sync-trim-cell ${thumbs[i] ? "on" : ""}`}>
                                    {thumbs[i] && <img src={thumbs[i]} alt="" draggable={false} />}
                                </span>
                            ))}
                        </div>

                        <div className="sync-trim-dim l" style={{ width: `${sPct}%` }} />
                        <div className="sync-trim-dim r" style={{ width: `${Math.max(0, 100 - ePct)}%` }} />

                        <div
                            className={`sync-trim-frame ${dragKind ? "is-drag" : ""} ${limitHit ? "is-limit" : ""}`}
                            style={{ left: `${sPct}%`, width: `${Math.max(0, ePct - sPct)}%` }}
                        >
                            <div
                                className="sync-trim-window"
                                onPointerDown={beginDrag("window")}
                                onPointerMove={moveDrag}
                                onPointerUp={endDrag}
                                onPointerCancel={endDrag}
                            />
                            <div
                                className={`sync-trim-handle start ${dragKind === "start" ? "active" : ""}`}
                                role="slider"
                                tabIndex={0}
                                aria-label="Trim start"
                                aria-valuemin={0}
                                aria-valuemax={Math.round(duration)}
                                aria-valuenow={Math.round(sel.start)}
                                onPointerDown={beginDrag("start")}
                                onPointerMove={moveDrag}
                                onPointerUp={endDrag}
                                onPointerCancel={endDrag}
                                onKeyDown={nudge("start")}
                            />
                            <div
                                className={`sync-trim-handle end ${dragKind === "end" ? "active" : ""}`}
                                role="slider"
                                tabIndex={0}
                                aria-label="Trim end"
                                aria-valuemin={0}
                                aria-valuemax={Math.round(duration)}
                                aria-valuenow={Math.round(sel.end)}
                                onPointerDown={beginDrag("end")}
                                onPointerMove={moveDrag}
                                onPointerUp={endDrag}
                                onPointerCancel={endDrag}
                                onKeyDown={nudge("end")}
                            />
                        </div>

                        <div className="sync-trim-playhead" ref={playheadRef} aria-hidden="true" />

                        <div
                            className={`sync-trim-bubble ${dragKind === "start" || dragKind === "end" ? "show" : ""}`}
                            style={{ left: `${bubbleAt}%` }}
                            aria-hidden="true"
                        >
                            {clock(bubbleTime)}
                        </div>
                    </div>
                </div>

                <p className={`sync-trim-hint ${hint ? "show" : ""}`}>
                    Drag the handles to pick up to {maxLabel(maxSeconds)}
                </p>

                <div className="sync-trim-actions">
                    <button type="button" className="sync-btn ghost" onClick={cancel}>
                        Cancel
                    </button>
                    <button type="button" className="sync-trim-done" disabled={!range} onClick={done}>
                        <Check size={19} strokeWidth={2.6} />
                        <span>Done</span>
                        <em>{lenLabel(len)}</em>
                    </button>
                </div>
            </section>
        </div>,
        document.body
    );
}
