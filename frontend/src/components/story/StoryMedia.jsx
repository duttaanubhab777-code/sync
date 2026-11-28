import React, { useEffect, useRef, useState } from "react";
import { ImageOff, Loader2 } from "lucide-react";
import { useLocalMedia } from "../../services/nativeMedia.js";

/* ==========================================================================
   Sync — Story media (text / image / video)
   - image/text: নিজস্ব টাইমার, ভিডিও: ভিডিওর সময়ই প্রগ্রেস
   - pause হলে সব থামে (টাইমার, ভিডিও, Ken-Burns zoom)
   - প্রগ্রেস সরাসরি onProgress(p) দিয়ে বাইরে যায় (re-render ছাড়াই)
   ========================================================================== */

const IMAGE_MS = 6500;
const FAIL_MS = 2600;

const textDuration = text => {
    const words = String(text || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean).length;
    return Math.min(12000, Math.max(5000, 3500 + words * 350));
};

const clock = s => {
    const n = Number.isFinite(s) && s > 0 ? Math.floor(s) : 0;
    return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
};

function useLatest(value) {
    const ref = useRef(value);
    ref.current = value;
    return ref;
}

// image / text-এর জন্য টাইমার (pause হলে জমা সময় ধরে রাখে)
function useTimedProgress({ active, paused, duration, onProgress, onDone }) {
    const elapsed = useRef(0);
    const cbs = useLatest({ onProgress, onDone });

    useEffect(() => {
        if (!active || paused) return undefined;
        let raf = 0;
        let last = performance.now();
        let finished = false;
        const tick = now => {
            elapsed.current += Math.min(now - last, 100);
            last = now;
            const p = Math.min(1, elapsed.current / duration);
            cbs.current.onProgress?.(p, elapsed.current);
            if (p >= 1) {
                if (!finished) {
                    finished = true;
                    cbs.current.onDone?.();
                }
                return;
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [active, paused, duration, cbs]);
}

/* ---------------------------- Text ---------------------------- */
function TextStory({ story, paused, onProgress, onDone }) {
    const text = String(story.caption || "");
    useTimedProgress({
        active: true,
        paused,
        duration: textDuration(text),
        onProgress,
        onDone
    });

    const tokens = text.split(/(\s+)/);
    const wordCount = tokens.filter((t, i) => i % 2 === 0 && t).length;
    const animateWords = wordCount <= 45;
    let wi = 0;

    return (
        <>
            <div className="sync-sv-backdrop" aria-hidden="true">
                <i className="sync-sv-orb o1" />
                <i className="sync-sv-orb o2" />
            </div>
            <div className="sync-sv-media">
                <div
                    className={`sync-sv-text ${
                        text.length > 180 ? "sm" : ""
                    } ${animateWords ? "" : "fade"}`}
                >
                    {animateWords
                        ? tokens.map((t, i) => {
                              if (i % 2 === 1 || !t) return t;
                              const delay = 120 + wi * 70;
                              wi += 1;
                              return (
                                  <span
                                      key={i}
                                      className="sync-sv-word"
                                      style={{ animationDelay: `${delay}ms` }}
                                  >
                                      {t}
                                  </span>
                              );
                          })
                        : text}
                </div>
            </div>
        </>
    );
}

/* ---------------------------- Image ---------------------------- */
function ImageStory({ story, paused, onProgress, onDone }) {
    const [src, , onSrcError] = useLocalMedia(story.media.url, "story");
    const [loaded, setLoaded] = useState(false);
    const [failed, setFailed] = useState(false);
    const errCount = useRef(0);

    useTimedProgress({
        active: loaded || failed,
        paused,
        duration: failed ? FAIL_MS : IMAGE_MS,
        onProgress,
        onDone
    });

    const handleError = () => {
        errCount.current += 1;
        if (errCount.current >= 3) setFailed(true);
        else onSrcError?.();
    };

    const showPaused = paused || !loaded;

    return (
        <>
            {src && !failed && (
                <div className="sync-sv-backdrop" aria-hidden="true">
                    <img src={src} alt="" />
                </div>
            )}
            <div className="sync-sv-media">
                <div className="sync-sv-stack">
                    <div
                        className={`sync-sv-frame kb ${
                            loaded ? "loaded" : "loading"
                        } ${showPaused ? "is-paused" : ""} ${
                            story.caption ? "has-caption" : ""
                        }`}
                        style={{ "--sv-dur": `${IMAGE_MS}ms` }}
                    >
                        {!loaded && !failed && (
                            <div className="sync-sv-skeleton" />
                        )}
                        {failed ? (
                            <div className="sync-sv-failed">
                                <ImageOff size={34} />
                                <span>Couldn’t load this photo</span>
                            </div>
                        ) : (
                            src && (
                                <img
                                    src={src}
                                    alt={story.caption || "story"}
                                    draggable={false}
                                    onLoad={() => setLoaded(true)}
                                    onError={handleError}
                                />
                            )
                        )}
                    </div>
                    {story.caption && loaded && (
                        <div className="sync-sv-caption">{story.caption}</div>
                    )}
                </div>
            </div>
        </>
    );
}

/* ---------------------------- Video ---------------------------- */
function VideoStory({
    story,
    paused,
    muted,
    onProgress,
    onDone,
    onAutoplayBlocked
}) {
    const [src, save, onSrcError] = useLocalMedia(story.media.url, "video");
    const vref = useRef(null);
    const timeRef = useRef(null);
    const [ready, setReady] = useState(false);
    const [buffering, setBuffering] = useState(true);
    const [failed, setFailed] = useState(false);
    const errCount = useRef(0);
    const cbs = useLatest({ onProgress, onDone, onAutoplayBlocked });

    // ভিডিও ফেইল করলে অল্প পরে পরের স্টোরিতে
    useTimedProgress({
        active: failed,
        paused,
        duration: FAIL_MS,
        onProgress,
        onDone
    });

    // মিউট
    useEffect(() => {
        if (vref.current) vref.current.muted = muted;
    }, [muted, src]);

    // play / pause
    useEffect(() => {
        const v = vref.current;
        if (!v || !src || failed) return;
        if (paused) {
            v.pause();
            return;
        }
        const p = v.play();
        if (p && typeof p.catch === "function") {
            p.catch(err => {
                if (err && err.name === "NotAllowedError") {
                    // সাউন্ডসহ অটোপ্লে আটকালে মিউট করে চালানো
                    v.muted = true;
                    cbs.current.onAutoplayBlocked?.();
                    v.play().catch(() => {});
                }
            });
        }
    }, [paused, src, failed, cbs]);

    // প্রগ্রেস = ভিডিওর currentTime / duration
    useEffect(() => {
        if (paused || failed) return undefined;
        let raf = 0;
        let lastSec = -1;
        const tick = () => {
            const v = vref.current;
            if (v && Number.isFinite(v.duration) && v.duration > 0) {
                cbs.current.onProgress?.(
                    Math.min(1, v.currentTime / v.duration),
                    v.currentTime * 1000
                );
                const sec = Math.floor(v.currentTime);
                if (sec !== lastSec && timeRef.current) {
                    lastSec = sec;
                    timeRef.current.textContent = `${clock(
                        v.currentTime
                    )} / ${clock(v.duration)}`;
                }
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [paused, failed, cbs]);

    const handleError = () => {
        errCount.current += 1;
        if (errCount.current >= 3) setFailed(true);
        else onSrcError?.();
    };

    return (
        <>
            <div className="sync-sv-media">
                <div className="sync-sv-stack">
                    <div
                        className={`sync-sv-frame video ${
                            ready ? "loaded" : "loading"
                        } ${story.caption ? "has-caption" : ""}`}
                    >
                        {!ready && !failed && (
                            <div className="sync-sv-skeleton" />
                        )}
                        {failed ? (
                            <div className="sync-sv-failed">
                                <ImageOff size={34} />
                                <span>Couldn’t load this video</span>
                            </div>
                        ) : (
                            src && (
                                <video
                                    ref={vref}
                                    src={src}
                                    playsInline
                                    preload="auto"
                                    disablePictureInPicture
                                    controlsList="nodownload noplaybackrate"
                                    onLoadedData={() => setReady(true)}
                                    onCanPlay={() => setBuffering(false)}
                                    onPlaying={() => setBuffering(false)}
                                    onWaiting={() => setBuffering(true)}
                                    onPlay={() => save?.()}
                                    onEnded={() => cbs.current.onDone?.()}
                                    onError={handleError}
                                />
                            )
                        )}
                        {ready && !failed && (
                            <div className="sync-sv-time" ref={timeRef}>
                                0:00
                            </div>
                        )}
                        {!failed && (buffering || !ready) && src && (
                            <div className="sync-sv-buffer">
                                <Loader2 size={26} className="spin" />
                            </div>
                        )}
                    </div>
                    {story.caption && (
                        <div className="sync-sv-caption">{story.caption}</div>
                    )}
                </div>
            </div>
        </>
    );
}

/* ---------------------------- Empty ---------------------------- */
function EmptyStory({ paused, onProgress, onDone }) {
    useTimedProgress({
        active: true,
        paused,
        duration: 2500,
        onProgress,
        onDone
    });
    return null;
}

export default function StoryMedia({
    story,
    paused,
    muted,
    onProgress,
    onDone,
    onAutoplayBlocked
}) {
    if (story.type === "text") {
        return (
            <TextStory
                story={story}
                paused={paused}
                onProgress={onProgress}
                onDone={onDone}
            />
        );
    }
    if (!story.media?.url) {
        return (
            <EmptyStory
                paused={paused}
                onProgress={onProgress}
                onDone={onDone}
            />
        );
    }
    if (story.type === "video") {
        return (
            <VideoStory
                story={story}
                paused={paused}
                muted={muted}
                onProgress={onProgress}
                onDone={onDone}
                onAutoplayBlocked={onAutoplayBlocked}
            />
        );
    }
    return (
        <ImageStory
            story={story}
            paused={paused}
            onProgress={onProgress}
            onDone={onDone}
        />
    );
}
