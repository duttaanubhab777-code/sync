import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocalMedia } from "../services/nativeMedia.js";
import {
    AlertCircle,
    Loader2,
    Maximize,
    Minimize,
    Pause,
    Play,
    RotateCcw,
    RotateCw,
    Volume2,
    VolumeX
} from "lucide-react";

/* ==========================================================================
   Sync — custom media players (v2)
   - একসাথে শুধু একটাই মিডিয়া চলে (নতুন চালালে আগেরটা থেমে যায়)
   - ভয়েস মেসেজে "Can't play. Tap to retry" বাগ ফিক্স:
       * ফাঁকা src="" এড়ানো, src বদলালে error রিসেট
       * webm/ogg না চললে স্বয়ংক্রিয় Cloudinary MP3 ফরম্যাট ফলব্যাক
       * Infinity duration হ্যান্ডলিং নিরাপদ করা
   - উন্নত ভিডিও প্লেয়ার: বাফার প্রগ্রেস, ডাবল-ট্যাপ ±১০s সিক, স্পিড কন্ট্রোল,
     সময় ব্যাজ ও স্মুথ স্ক্রাব প্রিভিউ
   ========================================================================== */

// ---------- একসাথে একটাই প্লেব্যাক ----------
let activeMedia = null;

const claimPlayback = el => {
    if (activeMedia && activeMedia !== el) {
        try {
            activeMedia.pause();
        } catch {
            /* ignore */
        }
    }
    activeMedia = el;
};

const releasePlayback = el => {
    if (activeMedia === el) activeMedia = null;
};

// ---------- helpers ----------
const clamp01 = n => Math.max(0, Math.min(1, n));

const formatClock = seconds => {
    let s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
    const h = Math.floor(s / 3600);
    s -= h * 3600;
    const m = Math.floor(s / 60);
    const sec = s % 60;
    const ss = String(sec).padStart(2, "0");
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};

// webm/ogg ভয়েস কোনো ব্রাউজার/WebView/iOS-এ না চললে Cloudinary থেকে স্বয়ংক্রিয় MP3 ট্রান্সকোড URL
function toCloudinaryMp3Fallback(url) {
    if (!url || typeof url !== "string") return "";
    if (!url.includes("res.cloudinary.com") || !url.includes("/upload/")) return "";
    if (/\.mp3(\?.*)?$/i.test(url)) return "";
    const replacedExt = url.replace(/\.(webm|ogg|oga|opus|m4a)(\?.*)?$/i, ".mp3$2");
    if (replacedExt !== url) return replacedExt;
    const [head, tail] = url.split("/upload/");
    return `${head}/upload/f_mp3/${tail}`;
}

// URL থেকে একই রকম (deterministic) waveform বানায়, যাতে প্রতিবার একই দেখায়
function makeBars(seed, count = 36) {
    let h = 2166136261;
    const str = String(seed || "sync");
    for (let i = 0; i < str.length; i += 1) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    let a = h >>> 0;
    const rnd = () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const out = [];
    let prev = 0.5;
    for (let i = 0; i < count; i += 1) {
        const v = 0.22 + rnd() * 0.78;
        prev = prev * 0.32 + v * 0.68;
        out.push(Math.round(Math.max(0.2, Math.min(1, prev)) * 100) / 100);
    }
    return out;
}

// ---------- shared playback logic ----------
function useMediaCore(src, knownDuration) {
    const ref = useRef(null);
    const fixingRef = useRef(false);
    const lastRef = useRef(0);
    const rateRef = useRef(1);
    const known = Number(knownDuration) > 0 ? Number(knownDuration) : 0;

    const [playing, setPlaying] = useState(false);
    const [duration, setDuration] = useState(known);
    const [time, setTime] = useState(0);
    const [buffered, setBuffered] = useState(0);
    const [waiting, setWaiting] = useState(false);
    const [error, setError] = useState(false);
    const [rate, setRate] = useState(1);

    // knownDuration পরে আপডেট হলে (যেমন আপলোড শেষে সার্ভারের duration এলে) সিঙ্ক করা
    useEffect(() => {
        if (known > 0) setDuration(d => (d > 0 ? d : known));
    }, [known]);

    // src বদলালে (যেমন "" → url, blob → Cloudinary, অথবা MP3 ফলব্যাক) পুরনো error রিসেট
    useEffect(() => {
        setError(false);
        setWaiting(false);
        setBuffered(0);
        fixingRef.current = false;
    }, [src]);

    const syncDuration = useCallback(() => {
        const el = ref.current;
        if (!el) return;
        if (Number.isFinite(el.duration) && el.duration > 0) {
            setDuration(el.duration);
        }
    }, []);

    const syncBuffered = useCallback(() => {
        const el = ref.current;
        if (!el || !el.buffered || el.buffered.length === 0) return;
        const d = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : duration;
        if (!d) return;
        try {
            const end = el.buffered.end(el.buffered.length - 1);
            setBuffered(clamp01(end / d));
        } catch {
            /* ignore */
        }
    }, [duration]);

    const onLoadedMetadata = useCallback(() => {
        const el = ref.current;
        if (!el) return;
        el.playbackRate = rateRef.current;
        setError(false);

        // MediaRecorder-এর webm ফাইলে duration = Infinity থাকতে পারে।
        // knownDuration আগে থেকেই থাকলে আর 1e101 সিক হ্যাক দরকার নেই (প্লে-তে ঝামেলা এড়ায়)
        if (el.duration === Infinity && known <= 0) {
            fixingRef.current = true;
            let settled = false;
            const done = () => {
                if (settled) return;
                settled = true;
                clearTimeout(guard);
                el.removeEventListener("seeked", done);
                el.removeEventListener("timeupdate", done);
                fixingRef.current = false;
                if (Number.isFinite(el.duration) && el.duration > 0) {
                    setDuration(el.duration);
                }
                if (el.paused) {
                    try {
                        el.currentTime = 0;
                    } catch {
                        /* ignore */
                    }
                    lastRef.current = 0;
                    setTime(0);
                }
            };
            const guard = setTimeout(done, 1200);
            el.addEventListener("seeked", done);
            el.addEventListener("timeupdate", done);
            try {
                el.currentTime = 1e7;
            } catch {
                done();
            }
        } else {
            syncDuration();
        }
        syncBuffered();
    }, [known, syncDuration, syncBuffered]);

    useEffect(() => {
        rateRef.current = rate;
        if (ref.current) ref.current.playbackRate = rate;
    }, [rate]);

    // প্লে চলার সময় প্রতি ফ্রেমে সময় আপডেট (মসৃণ progress এর জন্য)
    useEffect(() => {
        if (!playing) return undefined;
        let id = 0;
        const tick = () => {
            const el = ref.current;
            if (el && !fixingRef.current) {
                const t = el.currentTime;
                if (Math.abs(t - lastRef.current) >= 0.03) {
                    lastRef.current = t;
                    setTime(t);
                }
            }
            id = requestAnimationFrame(tick);
        };
        id = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(id);
    }, [playing]);

    // চ্যাট বদলালে / মেসেজ সরে গেলে থামিয়ে দাও
    useEffect(
        () => () => {
            const el = ref.current;
            if (el) {
                try {
                    el.pause();
                } catch {
                    /* ignore */
                }
                releasePlayback(el);
            }
        },
        []
    );

    const effectiveDuration = useCallback(() => {
        const el = ref.current;
        if (el && Number.isFinite(el.duration) && el.duration > 0) {
            return el.duration;
        }
        return duration;
    }, [duration]);

    const toggle = useCallback(() => {
        const el = ref.current;
        if (!el || !src) return;
        if (el.paused) {
            if (fixingRef.current) {
                fixingRef.current = false;
                try {
                    el.currentTime = 0;
                } catch {
                    /* ignore */
                }
            }
            if (error) {
                setError(false);
                el.load();
            }
            setWaiting(true);
            const p = el.play();
            if (p && typeof p.catch === "function") {
                p.catch(err => {
                    setWaiting(false);
                    // দ্রুত পজ/রিলোড বা অটোপ্লে ব্লকে মিথ্যা error না দেখানো
                    if (err?.name !== "AbortError" && err?.name !== "NotAllowedError") {
                        setError(true);
                    }
                });
            }
        } else {
            el.pause();
        }
    }, [error, src]);

    const seek = useCallback(
        ratio => {
            const el = ref.current;
            const d = effectiveDuration();
            if (!el || !d) return;
            const t = clamp01(ratio) * d;
            el.currentTime = t;
            lastRef.current = t;
            setTime(t);
        },
        [effectiveDuration]
    );

    const seekBy = useCallback(
        delta => {
            const el = ref.current;
            const d = effectiveDuration();
            if (!el || !d) return;
            const t = Math.max(0, Math.min(d, el.currentTime + delta));
            el.currentTime = t;
            lastRef.current = t;
            setTime(t);
        },
        [effectiveDuration]
    );

    const cycleRate = useCallback(() => {
        setRate(r => (r === 1 ? 1.5 : r === 1.5 ? 2 : 1));
    }, []);

    const mediaProps = {
        preload: "metadata",
        onLoadedMetadata,
        onDurationChange: syncDuration,
        onProgress: syncBuffered,
        onPlay: () => {
            claimPlayback(ref.current);
            setError(false);
            setPlaying(true);
        },
        onPlaying: () => {
            setWaiting(false);
            setError(false);
            setPlaying(true);
        },
        onPause: () => {
            setPlaying(false);
            setWaiting(false);
            releasePlayback(ref.current);
        },
        onWaiting: () => setWaiting(true),
        onCanPlay: () => {
            setWaiting(false);
            setError(false);
            syncBuffered();
        },
        onTimeUpdate: () => {
            const el = ref.current;
            if (!el || fixingRef.current) return;
            setTime(el.currentTime);
        },
        onEnded: () => {
            const el = ref.current;
            setPlaying(false);
            setWaiting(false);
            if (el) el.currentTime = 0;
            lastRef.current = 0;
            setTime(0);
        },
        onError: () => {
            if (!src) return; // src লোড হওয়ার আগেই ফাঁকা ইভেন্ট উপেক্ষা
            setPlaying(false);
            setWaiting(false);
            setError(true);
        }
    };

    return {
        ref,
        mediaProps,
        playing,
        duration,
        time,
        buffered,
        waiting,
        error,
        rate,
        setError,
        toggle,
        seek,
        seekBy,
        cycleRate
    };
}

// ---------- drag / tap / keyboard দিয়ে সিক ----------
function useScrub(core, { live = false } = {}) {
    const trackRef = useRef(null);
    const [scrub, setScrub] = useState(null);

    const ratioOf = e => {
        const el = trackRef.current;
        if (!el) return 0;
        const r = el.getBoundingClientRect();
        if (!r.width) return 0;
        return clamp01((e.clientX - r.left) / r.width);
    };

    const handlers = {
        onPointerDown: e => {
            e.stopPropagation();
            if (!core.duration) return;
            if (e.pointerType === "mouse" && e.button !== 0) return;
            try {
                trackRef.current?.setPointerCapture(e.pointerId);
            } catch {
                /* ignore */
            }
            const r = ratioOf(e);
            setScrub(r);
            if (live) core.seek(r);
        },
        onPointerMove: e => {
            if (scrub === null) return;
            const r = ratioOf(e);
            setScrub(r);
            if (live) core.seek(r);
        },
        onPointerUp: e => {
            if (scrub === null) return;
            e.stopPropagation();
            core.seek(ratioOf(e));
            setScrub(null);
        },
        onPointerCancel: () => setScrub(null),
        onKeyDown: e => {
            if (e.key === "ArrowRight" || e.key === "ArrowUp") {
                e.preventDefault();
                core.seekBy(5);
            } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
                e.preventDefault();
                core.seekBy(-5);
            } else if (e.key === "Home") {
                e.preventDefault();
                core.seek(0);
            } else if (e.key === "End") {
                e.preventDefault();
                core.seek(1);
            }
        }
    };

    return { trackRef, scrub, handlers };
}

/* ==========================================================================
   Voice message player (v2)
   ========================================================================== */
export function VoicePlayer({ src: remoteSrc, duration: knownDuration }) {
    // APK-তে ফোনে সেভ করা ফাইল থেকে চলে; waveform আসল URL থেকেই বানানো, যাতে বদলে না যায়
    const [localSrc, , dropBadLocal] = useLocalMedia(remoteSrc, "audio");
    const [useMp3Fallback, setUseMp3Fallback] = useState(false);

    useEffect(() => {
        setUseMp3Fallback(false);
    }, [remoteSrc]);

    const mp3Fallback = useMemo(() => toCloudinaryMp3Fallback(remoteSrc), [remoteSrc]);
    const effectiveSrc = useMp3Fallback && mp3Fallback ? mp3Fallback : localSrc || "";

    const core = useMediaCore(effectiveSrc, knownDuration);
    const { trackRef, scrub, handlers } = useScrub(core, { live: true });
    const bars = useMemo(() => makeBars(remoteSrc), [remoteSrc]);

    const total = core.duration;
    const ratio =
        scrub !== null
            ? scrub
            : total
              ? clamp01(core.time / total)
              : 0;
    const shownTime =
        scrub !== null
            ? scrub * total
            : core.playing || core.time > 0.05
              ? core.time
              : total;
    const curBar = Math.min(bars.length - 1, Math.floor(ratio * bars.length));

    const handleAudioError = e => {
        if (!effectiveSrc) return;
        // ১) ফোনের সেভ করা ফাইল না চললে সরাসরি রিমোট URL-এ ফেরা
        if (localSrc && localSrc !== remoteSrc && !useMp3Fallback) {
            dropBadLocal();
            return;
        }
        // ২) webm/ogg না চললে স্বয়ংক্রিয় Cloudinary MP3 ভার্সনে চেষ্টা (সব ফোনে চলে)
        if (!useMp3Fallback && mp3Fallback) {
            setUseMp3Fallback(true);
            return;
        }
        core.mediaProps.onError?.(e);
    };

    const handlePlayClick = e => {
        e.stopPropagation();
        if (core.error && useMp3Fallback) {
            // রিট্রাইয়ে আবার লোড করে প্লে
            core.setError(false);
        }
        core.toggle();
    };

    return (
        <div
            className={`sync-ap ${core.playing ? "is-playing" : ""} ${
                scrub !== null ? "is-scrubbing" : ""
            } ${core.error ? "has-error" : ""}`}
            onClick={e => e.stopPropagation()}
        >
            <audio
                ref={core.ref}
                src={effectiveSrc || undefined}
                {...core.mediaProps}
                onError={handleAudioError}
            />

            <button
                type="button"
                className="sync-ap-play"
                onClick={handlePlayClick}
                aria-label={
                    core.playing ? "Pause voice message" : "Play voice message"
                }
            >
                {core.waiting ? (
                    <Loader2 className="sync-mp-spin" aria-hidden="true" />
                ) : core.error ? (
                    <AlertCircle aria-hidden="true" />
                ) : core.playing ? (
                    <Pause key="pause" aria-hidden="true" />
                ) : (
                    <Play key="play" className="is-play" aria-hidden="true" />
                )}
            </button>

            <div className="sync-ap-body">
                <div
                    ref={trackRef}
                    className="sync-ap-wave"
                    role="slider"
                    tabIndex={0}
                    aria-label="Seek voice message"
                    aria-valuemin={0}
                    aria-valuemax={Math.round(total)}
                    aria-valuenow={Math.round(ratio * total)}
                    aria-valuetext={`${formatClock(ratio * total)} of ${formatClock(total)}`}
                    {...handlers}
                >
                    {bars.map((h, i) => (
                        <i
                            key={i}
                            className={`${
                                (i + 0.5) / bars.length <= ratio ? "on" : ""
                            } ${core.playing && i === curBar ? "cur" : ""}`}
                            style={{ "--h": h }}
                        />
                    ))}
                    <b
                        className="sync-ap-thumb"
                        style={{ left: `${ratio * 100}%` }}
                    />
                    {scrub !== null && total > 0 && (
                        <span
                            className="sync-ap-tip"
                            style={{ left: `${ratio * 100}%` }}
                        >
                            {formatClock(scrub * total)}
                        </span>
                    )}
                </div>

                <div className="sync-ap-meta">
                    <span className="sync-ap-time">
                        {core.error ? (
                            "Tap play to retry"
                        ) : core.playing && total > 0 ? (
                            <>
                                {formatClock(shownTime)}
                                <em className="sync-ap-dur"> / {formatClock(total)}</em>
                            </>
                        ) : (
                            formatClock(shownTime)
                        )}
                    </span>
                    <button
                        type="button"
                        className={`sync-ap-rate ${
                            core.rate === 1 ? "is-default" : "is-fast"
                        }`}
                        onClick={e => {
                            e.stopPropagation();
                            core.cycleRate();
                        }}
                        aria-label={`Playback speed ${core.rate}x`}
                    >
                        {core.rate}×
                    </button>
                </div>
            </div>
        </div>
    );
}

/* ==========================================================================
   Video player (v2 — buffered bar, double-tap ±10s, speed control, crisp HUD)
   ========================================================================== */
export function VideoPlayer({ src: remoteSrc, duration: knownDuration, width, height }) {
    const [src, saveVideo, dropBadLocal] = useLocalMedia(remoteSrc, "video");
    const core = useMediaCore(src, knownDuration);
    const { trackRef, scrub, handlers } = useScrub(core, { live: true });
    const wrapRef = useRef(null);
    const hideTimerRef = useRef(0);
    const tapTimerRef = useRef(0);
    const lastTapRef = useRef({ time: 0, side: "" });
    const seekBadgeTimerRef = useRef(0);

    const [muted, setMuted] = useState(false);
    const [uiShown, setUiShown] = useState(true);
    const [full, setFull] = useState(false);
    const [seekFeedback, setSeekFeedback] = useState(null); // { dir: "back" | "fwd", amount: 10 }

    const portrait = Number(height) > Number(width) * 1.05;
    const ratioStyle =
        Number(width) > 0 && Number(height) > 0
            ? `${width} / ${height}`
            : "16 / 9";

    const total = core.duration;
    const ratio =
        scrub !== null
            ? scrub
            : total
              ? clamp01(core.time / total)
              : 0;
    const shownTime = scrub !== null ? scrub * total : core.time;
    const uiVisible = !core.playing || uiShown || scrub !== null;

    const poke = useCallback(() => {
        setUiShown(true);
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = setTimeout(() => setUiShown(false), 2600);
    }, []);

    useEffect(() => {
        if (core.playing) {
            poke();
        } else {
            clearTimeout(hideTimerRef.current);
            setUiShown(true);
        }
        return () => clearTimeout(hideTimerRef.current);
    }, [core.playing, poke]);

    useEffect(
        () => () => {
            clearTimeout(tapTimerRef.current);
            clearTimeout(seekBadgeTimerRef.current);
        },
        []
    );

    useEffect(() => {
        const onChange = () => {
            const fsEl =
                document.fullscreenElement || document.webkitFullscreenElement;
            setFull(fsEl === wrapRef.current);
        };
        document.addEventListener("fullscreenchange", onChange);
        document.addEventListener("webkitfullscreenchange", onChange);
        return () => {
            document.removeEventListener("fullscreenchange", onChange);
            document.removeEventListener("webkitfullscreenchange", onChange);
        };
    }, []);

    const triggerSeekFeedback = dir => {
        setSeekFeedback(prev => ({
            dir,
            amount: prev && prev.dir === dir ? prev.amount + 10 : 10,
            key: Date.now()
        }));
        clearTimeout(seekBadgeTimerRef.current);
        seekBadgeTimerRef.current = setTimeout(() => setSeekFeedback(null), 700);
    };

    // স্মার্ট ট্যাপ: পজ থাকলে প্লে, প্লে চলাকালীন ডাবল-ট্যাপে বাঁ/ডানে ±১০s সিক, সিঙ্গল ট্যাপে HUD টগল
    const handleStageClick = e => {
        e.stopPropagation();
        if (core.error) {
            core.toggle();
            return;
        }
        if (!core.playing) {
            core.toggle();
            poke();
            return;
        }

        const rect = wrapRef.current?.getBoundingClientRect();
        const rel = rect && rect.width ? (e.clientX - rect.left) / rect.width : 0.5;
        const side = rel < 0.35 ? "left" : rel > 0.65 ? "right" : "center";
        const now = Date.now();

        if (side !== "center" && lastTapRef.current.side === side && now - lastTapRef.current.time < 300) {
            clearTimeout(tapTimerRef.current);
            lastTapRef.current = { time: 0, side: "" };
            core.seekBy(side === "left" ? -10 : 10);
            triggerSeekFeedback(side === "left" ? "back" : "fwd");
            poke();
            return;
        }

        lastTapRef.current = { time: now, side };
        clearTimeout(tapTimerRef.current);
        tapTimerRef.current = setTimeout(() => {
            lastTapRef.current = { time: 0, side: "" };
            if (uiShown) {
                clearTimeout(hideTimerRef.current);
                setUiShown(false);
            } else {
                poke();
            }
        }, 230);
    };

    const toggleFullscreen = e => {
        e.stopPropagation();
        const wrap = wrapRef.current;
        const video = core.ref.current;
        const fsEl =
            document.fullscreenElement || document.webkitFullscreenElement;
        if (fsEl) {
            (document.exitFullscreen || document.webkitExitFullscreen)?.call(
                document
            );
            return;
        }
        if (wrap?.requestFullscreen) {
            wrap.requestFullscreen().catch(() => {});
        } else if (wrap?.webkitRequestFullscreen) {
            wrap.webkitRequestFullscreen();
        } else if (video?.webkitEnterFullscreen) {
            video.webkitEnterFullscreen();
        }
    };

    const stop = e => e.stopPropagation();

    return (
        <div
            ref={wrapRef}
            className={`sync-vp ${portrait ? "portrait" : ""} ${
                core.playing ? "playing" : "paused"
            } ${uiVisible ? "ui" : ""} ${full ? "is-full" : ""}`}
            style={{ aspectRatio: ratioStyle }}
            onClick={handleStageClick}
            onPointerMove={e => {
                if (e.pointerType === "mouse" && core.playing) poke();
            }}
        >
            <video
                ref={core.ref}
                src={src ? `${src}#t=0.001` : undefined}
                playsInline
                muted={muted}
                {...core.mediaProps}
                onPlay={e => {
                    core.mediaProps.onPlay?.(e);
                    saveVideo();
                }}
                onError={e => {
                    if (!src) return;
                    if (src !== remoteSrc) dropBadLocal();
                    else core.mediaProps.onError?.(e);
                }}
            />

            <div className="sync-vp-shade" />

            {/* পজ থাকা অবস্থায় উপরের কোণায় ভিডিওর মোট দৈর্ঘ্য */}
            {!core.playing && !core.error && total > 0 && (
                <span className="sync-vp-badge">{formatClock(total)}</span>
            )}

            {/* ডাবল-ট্যাপে ±১০s সিক অ্যানিমেশন */}
            {seekFeedback && (
                <span
                    key={seekFeedback.key}
                    className={`sync-vp-seek-pill ${seekFeedback.dir}`}
                    aria-hidden="true"
                >
                    {seekFeedback.dir === "back" ? (
                        <RotateCcw size={16} />
                    ) : (
                        <RotateCw size={16} />
                    )}
                    <span>
                        {seekFeedback.dir === "back" ? "−" : "+"}
                        {seekFeedback.amount}s
                    </span>
                </span>
            )}

            {core.waiting && (
                <span className="sync-vp-wait" aria-hidden="true">
                    <Loader2 className="sync-mp-spin" />
                </span>
            )}

            {core.error ? (
                <div className="sync-vp-err">
                    <AlertCircle size={22} />
                    <span>Can't play this video</span>
                    <small>Tap to retry</small>
                </div>
            ) : (
                <button
                    type="button"
                    className={`sync-vp-big ${core.playing && uiShown ? "is-hud-pause" : ""}`}
                    aria-label={core.playing ? "Pause video" : "Play video"}
                    onClick={e => {
                        e.stopPropagation();
                        core.toggle();
                        poke();
                    }}
                >
                    {core.playing ? (
                        <Pause aria-hidden="true" />
                    ) : (
                        <Play aria-hidden="true" />
                    )}
                </button>
            )}

            <div className="sync-vp-bar" onClick={stop}>
                <div
                    ref={trackRef}
                    className={`sync-vp-track ${scrub !== null ? "drag" : ""}`}
                    style={{
                        "--p": `${ratio * 100}%`,
                        "--b": `${core.buffered * 100}%`
                    }}
                    role="slider"
                    tabIndex={0}
                    aria-label="Seek video"
                    aria-valuemin={0}
                    aria-valuemax={Math.round(total)}
                    aria-valuenow={Math.round(ratio * total)}
                    aria-valuetext={`${formatClock(ratio * total)} of ${formatClock(total)}`}
                    {...handlers}
                >
                    <span className="sync-vp-buf" />
                    <span className="sync-vp-fill" />
                    <span className="sync-vp-knob" />
                    {scrub !== null && total > 0 && (
                        <span
                            className="sync-vp-tip"
                            style={{ left: `${ratio * 100}%` }}
                        >
                            {formatClock(scrub * total)}
                        </span>
                    )}
                </div>

                <div className="sync-vp-row">
                    <button
                        type="button"
                        className="sync-vp-btn"
                        onClick={e => {
                            e.stopPropagation();
                            core.toggle();
                            poke();
                        }}
                        aria-label={core.playing ? "Pause" : "Play"}
                    >
                        {core.playing ? (
                            <Pause aria-hidden="true" />
                        ) : (
                            <Play aria-hidden="true" />
                        )}
                    </button>

                    <span className="sync-vp-time">
                        {formatClock(shownTime)}
                        <em>/</em>
                        {formatClock(total)}
                    </span>

                    <button
                        type="button"
                        className={`sync-vp-rate ${core.rate !== 1 ? "is-fast" : ""}`}
                        onClick={e => {
                            e.stopPropagation();
                            core.cycleRate();
                            poke();
                        }}
                        aria-label={`Playback speed ${core.rate}x`}
                    >
                        {core.rate}×
                    </button>

                    <button
                        type="button"
                        className="sync-vp-btn"
                        onClick={e => {
                            e.stopPropagation();
                            setMuted(m => !m);
                            poke();
                        }}
                        aria-label={muted ? "Unmute" : "Mute"}
                    >
                        {muted ? (
                            <VolumeX aria-hidden="true" />
                        ) : (
                            <Volume2 aria-hidden="true" />
                        )}
                    </button>

                    <button
                        type="button"
                        className="sync-vp-btn"
                        onClick={toggleFullscreen}
                        aria-label={full ? "Exit full screen" : "Full screen"}
                    >
                        {full ? (
                            <Minimize aria-hidden="true" />
                        ) : (
                            <Maximize aria-hidden="true" />
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
