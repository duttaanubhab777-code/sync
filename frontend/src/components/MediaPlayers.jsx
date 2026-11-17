import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    AlertCircle,
    Loader2,
    Maximize,
    Minimize,
    Pause,
    Play,
    Volume2,
    VolumeX
} from "lucide-react";

/* ==========================================================================
   Sync — custom media players
   Chrome-এর default audio/video player-এর বদলে নিজস্ব Voice ও Video player।
   - একসাথে শুধু একটাই মিডিয়া চলে (নতুন চালালে আগেরটা থেমে যায়)
   - MediaRecorder-এর webm ফাইলের "Infinity duration" সমস্যা ঠিক করা আছে
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
        const v = 0.2 + rnd() * 0.8;
        prev = prev * 0.3 + v * 0.7;
        out.push(Math.round(Math.max(0.2, Math.min(1, prev)) * 100) / 100);
    }
    return out;
}

// ---------- shared playback logic ----------
function useMediaCore(knownDuration) {
    const ref = useRef(null);
    const fixingRef = useRef(false);
    const lastRef = useRef(0);
    const rateRef = useRef(1);
    const known = Number(knownDuration) > 0 ? Number(knownDuration) : 0;

    const [playing, setPlaying] = useState(false);
    const [duration, setDuration] = useState(known);
    const [time, setTime] = useState(0);
    const [waiting, setWaiting] = useState(false);
    const [error, setError] = useState(false);
    const [rate, setRate] = useState(1);

    const syncDuration = useCallback(() => {
        const el = ref.current;
        if (!el) return;
        if (Number.isFinite(el.duration) && el.duration > 0) {
            setDuration(el.duration);
        }
    }, []);

    const onLoadedMetadata = useCallback(() => {
        const el = ref.current;
        if (!el) return;
        el.playbackRate = rateRef.current;

        // MediaRecorder দিয়ে বানানো webm ফাইলে duration = Infinity থাকে।
        // শেষে সিক করে আবার শুরুতে ফিরলে ব্রাউজার আসল duration বের করে নেয়।
        if (el.duration === Infinity) {
            fixingRef.current = true;
            const done = () => {
                el.removeEventListener("timeupdate", done);
                fixingRef.current = false;
                if (Number.isFinite(el.duration) && el.duration > 0) {
                    setDuration(el.duration);
                }
                el.currentTime = 0;
                lastRef.current = 0;
                setTime(0);
            };
            el.addEventListener("timeupdate", done);
            el.currentTime = 1e101;
        } else {
            syncDuration();
        }
    }, [syncDuration]);

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
                if (Math.abs(t - lastRef.current) >= 0.04) {
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
        if (!el) return;
        if (el.paused) {
            if (error) {
                setError(false);
                el.load();
            }
            const p = el.play();
            if (p && typeof p.catch === "function") {
                p.catch(err => {
                    if (err?.name !== "AbortError") setError(true);
                });
            }
        } else {
            el.pause();
        }
    }, [error]);

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
        onPlay: () => {
            claimPlayback(ref.current);
            setPlaying(true);
        },
        onPlaying: () => {
            setWaiting(false);
            setPlaying(true);
        },
        onPause: () => {
            setPlaying(false);
            setWaiting(false);
            releasePlayback(ref.current);
        },
        onWaiting: () => setWaiting(true),
        onCanPlay: () => setWaiting(false),
        onTimeUpdate: () => {
            const el = ref.current;
            if (!el || fixingRef.current) return;
            setTime(el.currentTime);
        },
        onEnded: () => {
            const el = ref.current;
            setPlaying(false);
            if (el) el.currentTime = 0;
            lastRef.current = 0;
            setTime(0);
        },
        onError: () => {
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
        waiting,
        error,
        rate,
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
   Voice message player
   ========================================================================== */
export function VoicePlayer({ src, duration: knownDuration }) {
    const core = useMediaCore(knownDuration);
    const { trackRef, scrub, handlers } = useScrub(core);
    const bars = useMemo(() => makeBars(src), [src]);

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

    return (
        <div
            className={`sync-ap ${core.playing ? "is-playing" : ""} ${
                scrub !== null ? "is-scrubbing" : ""
            } ${core.error ? "has-error" : ""}`}
        >
            <audio ref={core.ref} src={src} {...core.mediaProps} />

            <button
                type="button"
                className="sync-ap-play"
                onClick={core.toggle}
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
                </div>

                <div className="sync-ap-meta">
                    <span className="sync-ap-time">
                        {core.error
                            ? "Can't play. Tap to retry"
                            : formatClock(shownTime)}
                    </span>
                    <button
                        type="button"
                        className={`sync-ap-rate ${
                            core.rate === 1 ? "is-default" : ""
                        }`}
                        onClick={core.cycleRate}
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
   Video player
   ========================================================================== */
export function VideoPlayer({ src, duration: knownDuration, width, height }) {
    const core = useMediaCore(knownDuration);
    const { trackRef, scrub, handlers } = useScrub(core, { live: true });
    const wrapRef = useRef(null);
    const hideTimerRef = useRef(0);

    const [muted, setMuted] = useState(false);
    const [uiShown, setUiShown] = useState(true);
    const [full, setFull] = useState(false);

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
        hideTimerRef.current = setTimeout(() => setUiShown(false), 2400);
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
            // iPhone Safari
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
            onClick={() => {
                core.toggle();
                poke();
            }}
            onPointerMove={e => {
                if (e.pointerType === "mouse" && core.playing) poke();
            }}
        >
            <video
                ref={core.ref}
                src={src ? `${src}#t=0.1` : undefined}
                playsInline
                muted={muted}
                {...core.mediaProps}
            />

            <div className="sync-vp-shade" />

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
                    className="sync-vp-big"
                    aria-label={core.playing ? "Pause video" : "Play video"}
                    onClick={e => {
                        e.stopPropagation();
                        core.toggle();
                        poke();
                    }}
                >
                    <Play aria-hidden="true" />
                </button>
            )}

            <div className="sync-vp-bar" onClick={stop}>
                <div
                    ref={trackRef}
                    className={`sync-vp-track ${scrub !== null ? "drag" : ""}`}
                    style={{ "--p": `${ratio * 100}%` }}
                    role="slider"
                    tabIndex={0}
                    aria-label="Seek video"
                    aria-valuemin={0}
                    aria-valuemax={Math.round(total)}
                    aria-valuenow={Math.round(ratio * total)}
                    aria-valuetext={`${formatClock(ratio * total)} of ${formatClock(total)}`}
                    {...handlers}
                >
                    <span className="sync-vp-fill" />
                    <span className="sync-vp-knob" />
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
