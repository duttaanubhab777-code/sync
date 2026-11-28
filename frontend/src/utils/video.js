// চ্যাট ও story-র ভিডিও আপলোডের আগে ফোনেই স্মুথভাবে ছোট করা (WhatsApp-এর মতো, ফ্রেম ড্রপ/ল্যাগ ছাড়া)।
//
// কীভাবে কাজ করে: কোনো বাড়তি লাইব্রেরি ছাড়াই ব্রাউজারের নিজস্ব <video> + canvas + MediaRecorder।
// ফ্রেম ড্রপ ও ল্যাগ দূর করতে:
//   - রেজোলিউশন হালকা (480p থেকে শুরু) ও medium smoothing + desynchronized canvas, যাতে মোবাইল GPU/CPU সহজে ৩০fps ধরে রাখতে পারে
//   - captureStream(30) (স্থির CFR ক্লক) ও ≤30fps ভিডিওতে কোনো ফ্রেম বাদ না দেওয়া (শুধু >40fps হলে 30fps-এ নামানো)
//   - ধীর সফটওয়্যার VP9-এর বদলে দ্রুত হার্ডওয়্যার H.264 / VP8 কোডেক আগে বেছে নেওয়া
//   - ব্যাকগ্রাউন্ডে (ট্যাব লুকালে/অ্যাপ মিনিমাইজ করলে) কমপ্রেশন বন্ধ না করে in-DOM ভিডিও + সাইলেন্ট AudioContext
//     + Web Worker 30fps টাইমার দিয়ে স্মুথভাবে চালিয়ে যাওয়া
//
// নিয়ম: কোনো কারণে (অসমর্থিত কোডেক, ইউজার "Send original" চাপা ...) ব্যর্থ হলে বা ফল আসলের চেয়ে
// ছোট না হলে আসল ফাইলই ফেরত যায়। কখনো throw করে না, আপলোড আটকায় না।
//
// Trim: trim = { start, end } (সেকেন্ডে) দিলে শুধু ওই অংশটুকুই এনকোড হয় (WhatsApp-এর মতো ভিডিও ছাঁটা)।
// trim থাকলে ফাইল যত ছোটই হোক এনকোড হয়; কোনো কারণে ছাঁটা না গেলে আসল (না-ছাঁটা) ফাইল ফেরত না দিয়ে error throw করে,
// কারণ ইউজার যে অংশ বেছেছে তার বদলে পুরো ভিডিও পোস্ট হয়ে যাওয়া ভুল।
//
// onProgress(pct, { current, duration }): pct ০–৯৯ (দশমিকসহ), current/duration সেকেন্ডে (trim হলে ছাঁটা অংশের হিসাবে)
// signal (AbortSignal): abort হলে compress থেমে আসল ফাইল ফেরত যায়

// আসল ফাইল খুব ছোট হলে আর ছোঁয়া হয় না (আবার এনকোড করলে কোয়ালিটি শুধু নষ্ট হতো)
const SKIP_BELOW_BYTES = 1.2 * 1024 * 1024;
// আপলোডের সীমা ২৫ MB; তার নিচে নিরাপদে থাকতে লক্ষ্য ১৯ MB
const TARGET_OUTPUT_BYTES = 19 * 1024 * 1024;
const HARD_LIMIT_BYTES = 25 * 1024 * 1024;
const SAFE_LIMIT_BYTES = 23 * 1024 * 1024;
// সাইজ বেশি হলে কম bitrate-এ সর্বোচ্চ কতবার আবার চেষ্টা
const MAX_RETRIES = 2;
const AUDIO_BPS = 96 * 1000;
const TARGET_FPS = 30;
// এর চেয়ে লম্বা ভিডিও compress করতে অনেক সময় লাগবে, তাই আসলটাই যায়
const MAX_COMPRESS_SECONDS = 10 * 60;
// একটা স্টোরিতে সর্বোচ্চ কত সেকেন্ড বাছা যাবে (২ মিনিট)। আসল ভিডিও যত লম্বাই হোক, বাছাইয়ের কোনো সীমা নেই — এখান থেকে ২ মিনিটের একটা অংশ ছাঁটা হয়
export const STORY_VIDEO_MAX_SECONDS = 120;
// চ্যাটে ভিডিও ছাঁটার সময় সর্বোচ্চ কত সেকেন্ডের অংশ বাছা যাবে (compress সীমার সমান: ১০ মিনিট)
export const CHAT_VIDEO_MAX_SECONDS = MAX_COMPRESS_SECONDS;
// এর চেয়ে ছোট অংশ বাছা যায় না
export const TRIM_MIN_SECONDS = 1;

// হালকা রেজোলিউশন + স্থির bitrate: কোয়ালিটি কিছুটা কম হলেও ফ্রেম একদম স্মুথ (ল্যাগ/ফ্রেম ড্রপ ছাড়া)
const TIERS = [
    { side: 854, bps: 1_350_000 }, // 480p — ফোনে পরিষ্কার, এনকোড খুব দ্রুত
    { side: 640, bps: 850_000 },   // 360p — মাঝারি/লম্বা ভিডিওর জন্য খুব স্মুথ
    { side: 480, bps: 520_000 },   // লম্বা ভিডিও ২৫ MB-এ আনতে
    { side: 360, bps: 320_000 }
];

// দ্রুত হার্ডওয়্যার H.264 ও VP8 আগে; ধীর সফটওয়্যার VP9 সবার শেষে (VP9 মোবাইলে ফ্রেম ড্রপ করে)
const pickRecorderType = () => {
    if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return null;
    const candidates = [
        ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "mp4"],
        ["video/mp4;codecs=avc1,mp4a.40.2", "mp4"],
        ["video/mp4", "mp4"],
        ["video/webm;codecs=h264,opus", "webm"],
        ["video/webm;codecs=vp8,opus", "webm"],
        ["video/webm;codecs=vp8", "webm"],
        ["video/webm", "webm"],
        ["video/webm;codecs=vp9,opus", "webm"]
    ];
    for (const [mime, ext] of candidates) {
        try {
            if (MediaRecorder.isTypeSupported(mime)) {
                return { mime, ext, baseMime: mime.split(";")[0] };
            }
        } catch {
            /* পরেরটা */
        }
    }
    return null;
};

// এই ব্রাউজার/WebView-এ ভিডিও ছাঁটা (এনকোড) সম্ভব কিনা; না হলে UI trim এডিটর দেখায় না
export const canTrimVideo = () => {
    try {
        if (typeof document === "undefined") return false;
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        return Boolean(
            pickRecorderType() &&
                AudioCtx &&
                typeof HTMLCanvasElement !== "undefined" &&
                typeof HTMLCanvasElement.prototype.captureStream === "function"
        );
    } catch {
        return false;
    }
};

const even = n => Math.max(2, Math.round(n / 2) * 2);

// scale < 1 হলে bitrate-বাজেট কমে যায় (আগের চেষ্টায় ফাইল সীমা ছাড়ালে আবার চেষ্টার সময়)
export const pickVideoProfile = (width, height, duration, budgetScale = 1) => {
    const longSide = Math.max(width, height);
    const budgetBps = ((TARGET_OUTPUT_BYTES * 8) / Math.max(duration, 1) - AUDIO_BPS) * budgetScale;

    const tier = TIERS.find(t => t.bps <= budgetBps) || TIERS[TIERS.length - 1];
    const videoBps = Math.max(180_000, Math.min(tier.bps, budgetBps));
    const side = Math.min(tier.side, longSide); // কখনো বড় করা হয় না
    const scale = side / longSide;
    return {
        width: even(width * scale),
        height: even(height * scale),
        videoBps: Math.round(videoBps),
        tierSide: tier.side
    };
};

// ব্যাকগ্রাউন্ড ট্যাবেও ৩০fps-এ ফ্রেম আঁকতে ইনলাইন Web Worker টাইমার
// (মেইন থ্রেডের setInterval/rAF ব্যাকগ্রাউন্ডে ১fps-এ নেমে যায়, Worker টাইমার নামে না)
const createBgTimer = (intervalMs, onTick) => {
    let worker = null;
    let workerUrl = "";
    let fallbackId = null;
    try {
        if (typeof Worker !== "undefined" && typeof Blob !== "undefined") {
            const code =
                "let id=null;onmessage=e=>{if(id){clearInterval(id);id=null;}if(e.data>0){id=setInterval(()=>postMessage(0),e.data);}};";
            workerUrl = URL.createObjectURL(new Blob([code], { type: "application/javascript" }));
            worker = new Worker(workerUrl);
            worker.onmessage = onTick;
            worker.postMessage(intervalMs);
            return () => {
                try {
                    worker.postMessage(0);
                    worker.terminate();
                } catch {
                    /* ignore */
                }
                if (workerUrl) URL.revokeObjectURL(workerUrl);
            };
        }
    } catch {
        /* CSP বা অসমর্থিত হলে setInterval fallback */
    }
    fallbackId = setInterval(onTick, intervalMs);
    return () => clearInterval(fallbackId);
};

const waitForEvent = (target, okEvent, timeoutMs) =>
    new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error("timeout"));
        }, timeoutMs);
        const onOk = () => {
            cleanup();
            resolve();
        };
        const onErr = () => {
            cleanup();
            reject(new Error("media error"));
        };
        const cleanup = () => {
            clearTimeout(timer);
            target.removeEventListener(okEvent, onOk);
            target.removeEventListener("error", onErr);
        };
        target.addEventListener(okEvent, onOk);
        target.addEventListener("error", onErr);
    });

// AudioContext.resume() ব্লক হলে কখনো শেষ হয় না, তাই সময়সীমা দিয়ে অপেক্ষা
const resumeWithTimeout = async (ctx, ms) => {
    try {
        await Promise.race([ctx.resume(), new Promise(r => setTimeout(r, ms))]);
    } catch {
        /* নিচে state দেখা হবে */
    }
};

// একবারের compress। সফল/ব্যর্থ হলে File ফেরত দেয়; ফাইল সীমার চেয়ে বড় হয়ে যাচ্ছে বুঝলে { retryScale } ফেরত দেয়
const compressOnce = async (
    file,
    { onProgress, signal, scale = 1, retry = 0, force = false, trim = null } = {}
) => {
    let objectUrl = "";
    let video = null;
    let audioCtx = null;
    let recorder = null;
    let stream = null;
    let watchdog = null;
    let hardTimer = null;
    let stopBgTimer = null;
    let onVisibility = null;
    let onAbort = null;

    const release = () => {
        clearInterval(watchdog);
        clearTimeout(hardTimer);
        if (stopBgTimer) {
            stopBgTimer();
            stopBgTimer = null;
        }
        if (onVisibility) document.removeEventListener("visibilitychange", onVisibility);
        if (onAbort && signal) signal.removeEventListener("abort", onAbort);
        try {
            if (recorder && recorder.state !== "inactive") recorder.stop();
        } catch {
            /* ignore */
        }
        try {
            stream?.getTracks().forEach(t => t.stop());
        } catch {
            /* ignore */
        }
        try {
            audioCtx?.close();
        } catch {
            /* ignore */
        }
        if (video) {
            try {
                video.pause();
            } catch {
                /* ignore */
            }
            video.removeAttribute("src");
            try {
                video.load();
            } catch {
                /* ignore */
            }
            try {
                video.remove();
            } catch {
                /* ignore */
            }
        }
        if (objectUrl) URL.revokeObjectURL(objectUrl);
    };

    try {
        if (!file || typeof document === "undefined") return file;
        if (!force && file.size < SKIP_BELOW_BYTES) return file;
        if (signal?.aborted) return file;

        const rec = pickRecorderType();
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!rec || !AudioCtx || typeof HTMLCanvasElement.prototype.captureStream !== "function") {
            return file;
        }

        let failed = null;
        const failNow = reason => {
            if (!failed) failed = new Error(reason);
        };
        if (signal) {
            onAbort = () => failNow("skipped");
            signal.addEventListener("abort", onAbort, { once: true });
        }

        objectUrl = URL.createObjectURL(file);
        video = document.createElement("video");
        video.preload = "auto";
        video.playsInline = true;
        video.setAttribute("playsinline", "");
        video.setAttribute("webkit-playsinline", "");
        video.setAttribute("aria-hidden", "true");
        // DOM-এ যুক্ত রাখলে (অদৃশ্য ১×১px) ব্যাকগ্রাউন্ডেও ব্রাউজার ভিডিও ডিকোডার বন্ধ করে না
        video.style.cssText =
            "position:fixed;top:-2px;left:-2px;width:1px;height:1px;opacity:0.001;pointer-events:none;z-index:-1;";
        if (document.body) document.body.appendChild(video);
        video.src = objectUrl;

        // ---- অডিও: স্পিকারে শব্দ না করে সরাসরি রেকর্ডারে + সাইলেন্ট keep-alive ----
        // silentGain(0) → destination যুক্ত রাখলে Chrome/WebView ব্যাকগ্রাউন্ড ট্যাবেও মিডিয়া চালু রাখে
        audioCtx = new AudioCtx();
        const resumePromise = resumeWithTimeout(audioCtx, 2000);
        const audioSource = audioCtx.createMediaElementSource(video);
        const audioDest = audioCtx.createMediaStreamDestination();
        audioSource.connect(audioDest);
        try {
            const silentGain = audioCtx.createGain();
            silentGain.gain.value = 0;
            audioSource.connect(silentGain);
            silentGain.connect(audioCtx.destination);
        } catch {
            /* না হলে শুধু audioDest-ই যথেষ্ট */
        }

        await waitForEvent(video, "loadedmetadata", 15000);
        if (failed) return file;

        const srcW = video.videoWidth;
        const srcH = video.videoHeight;
        const fullDuration = video.duration;
        if (!srcW || !srcH || !Number.isFinite(fullDuration) || fullDuration <= 0) return file;

        // trim থাকলে শুধু [trimStart, trimEnd] অংশ; duration = ছাঁটা অংশের দৈর্ঘ্য
        const trimStart = trim ? Math.min(Math.max(0, Number(trim.start) || 0), fullDuration - 0.2) : 0;
        const trimEnd = trim
            ? Math.min(fullDuration, Math.max(trimStart + 0.2, Number(trim.end) || fullDuration))
            : fullDuration;
        const duration = trim ? trimEnd - trimStart : fullDuration;
        if (duration > MAX_COMPRESS_SECONDS) return file;

        const profile = pickVideoProfile(srcW, srcH, duration, scale);

        // আগে থেকেই খুব ছোট ও হালকা হলে আবার এনকোড না করাই ভালো (তবে >25MB হলে অবশ্যই কমপ্রেস)
        if (retry === 0 && !force && !trim && file.size <= HARD_LIMIT_BYTES) {
            const srcBps = (file.size * 8) / duration;
            const targetTotalBps = profile.videoBps + AUDIO_BPS;
            const alreadySmall =
                Math.max(srcW, srcH) <= profile.tierSide && srcBps <= targetTotalBps * 1.15;
            const wouldNotShrink = srcBps <= targetTotalBps * 0.9;
            if (alreadySmall || wouldNotShrink) return file;
        }

        await resumePromise;
        if (audioCtx.state !== "running") await resumeWithTimeout(audioCtx, 1500);
        if (audioCtx.state !== "running") return file;
        if (failed) return file;

        // ---- canvas (ভিডিও): desynchronized + medium smoothing = শূন্য ফ্রেম ড্রপ ----
        const canvas = document.createElement("canvas");
        canvas.width = profile.width;
        canvas.height = profile.height;
        const ctx =
            canvas.getContext("2d", { alpha: false, desynchronized: true }) ||
            canvas.getContext("2d", { alpha: false });
        if (!ctx) return file;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "medium";

        // স্থির ৩০fps CFR স্ট্রিম: captureStream(0)+requestFrame-এর মতো VFR জ্যাম/ল্যাগ হয় না
        const canvasStream = canvas.captureStream(TARGET_FPS);
        let lastFrameTime = -1;
        const drawFrame = (forceDraw = false) => {
            if (!video || video.readyState < 2) return;
            const cur = video.currentTime;
            // একই ফ্রেম দুবার আঁকা এড়ানো (তবে প্রথম/শেষ ফ্রেমে forceDraw = true)
            if (!forceDraw && cur === lastFrameTime) return;
            ctx.drawImage(video, 0, 0, profile.width, profile.height);
            lastFrameTime = cur;
        };

        stream = new MediaStream([
            ...canvasStream.getVideoTracks(),
            ...audioDest.stream.getAudioTracks()
        ]);

        const chunks = [];
        let bytes = 0;
        let retryScale = 0;
        recorder = new MediaRecorder(stream, {
            mimeType: rec.mime,
            videoBitsPerSecond: profile.videoBps,
            audioBitsPerSecond: AUDIO_BPS
        });
        recorder.ondataavailable = e => {
            if (e.data && e.data.size > 0) {
                chunks.push(e.data);
                bytes += e.data.size;
            }
        };

        const stopped = new Promise((resolve, reject) => {
            recorder.onstop = resolve;
            recorder.onerror = () => reject(new Error("recorder error"));
        });
        stopped.catch(() => {});

        if (video.readyState < 2) await waitForEvent(video, "loadeddata", 15000);
        if (failed) return file;

        // ছাঁটার শুরুর বিন্দুতে সরে যাওয়া (রেকর্ডার চালুর আগে, যাতে শুরুর অংশ রেকর্ড না হয়)
        if (trim && trimStart > 0.05) {
            video.currentTime = trimStart;
            await waitForEvent(video, "seeked", 10000);
            if (video.readyState < 2) await waitForEvent(video, "canplay", 10000);
            if (failed) return file;
        }

        let finished = false;
        let pausedByBrowser = false;
        let finishClip = () => {};
        const done = new Promise(resolve => {
            video.onended = () => resolve();
            finishClip = resolve;
        });
        // শেষ বিন্দু ছুঁলেই থামা (rVFC / rAF / watchdog / ব্যাকগ্রাউন্ড টাইমার — যেটাই আগে ধরে)
        const reachedTrimEnd = t => Boolean(trim) && t >= trimEnd - 0.01;
        video.addEventListener("timeupdate", () => {
            if (reachedTrimEnd(video.currentTime)) finishClip();
        });

        // ---- স্মুথ ফ্রেম লুপ: ফোরগ্রাউন্ডে rVFC/rAF, ব্যাকগ্রাউন্ডে Worker 30fps টাইমার ----
        // >40fps (যেমন 60fps) ভিডিও হলে প্রতি ২য় ফ্রেম নেওয়া হয়; ≤30fps ভিডিওতে একটাও ফ্রেম বাদ পড়ে না!
        let lastDrawnMediaTime = -1;
        const HIGH_FPS_GAP = 0.025; // 40fps সীমা — 30fps (0.033s) সবসময় পাস করে

        if (typeof video.requestVideoFrameCallback === "function") {
            const tick = (_now, meta) => {
                if (finished) return;
                const t = meta?.mediaTime ?? video.currentTime;
                if (reachedTrimEnd(t)) {
                    finishClip();
                    return;
                }
                if (lastDrawnMediaTime < 0 || t - lastDrawnMediaTime >= HIGH_FPS_GAP || t < lastDrawnMediaTime) {
                    drawFrame(true);
                    lastDrawnMediaTime = t;
                }
                video.requestVideoFrameCallback(tick);
            };
            video.requestVideoFrameCallback(tick);
        } else {
            const loop = () => {
                if (finished) return;
                if (reachedTrimEnd(video.currentTime)) {
                    finishClip();
                    return;
                }
                if (!document.hidden) drawFrame(false);
                requestAnimationFrame(loop);
            };
            requestAnimationFrame(loop);
        }

        // ব্যাকগ্রাউন্ডে rVFC/rAF থামলে Worker টাইমার ৩৩ms পর পর নতুন ফ্রেম ক্যানভাসে আঁকে
        const syncBgLoop = () => {
            if (finished) return;
            if (document.hidden) {
                if (!stopBgTimer) {
                    stopBgTimer = createBgTimer(Math.round(1000 / TARGET_FPS), () => {
                        if (finished) return;
                        if (reachedTrimEnd(video.currentTime)) {
                            finishClip();
                            return;
                        }
                        if (video.paused && !video.ended && !pausedByBrowser) {
                            video.play().catch(() => {});
                        }
                        drawFrame(false);
                    });
                }
            } else {
                if (stopBgTimer) {
                    stopBgTimer();
                    stopBgTimer = null;
                }
                if (pausedByBrowser) {
                    pausedByBrowser = false;
                    try {
                        if (recorder.state === "paused") recorder.resume();
                        video.play().catch(() => {});
                    } catch {
                        /* ignore */
                    }
                }
            }
        };
        onVisibility = syncBgLoop;
        document.addEventListener("visibilitychange", onVisibility);
        if (document.hidden) syncBgLoop();

        // ---- progress রিপোর্ট + আটকে গেলে নিরাপদ হ্যান্ডলিং ----
        let lastTime = -1;
        let stuckTicks = 0;
        let lastPct = -1;
        const reportPct = () => {
            if (typeof onProgress !== "function") return;
            const current = Math.min(duration, Math.max(0, (video.currentTime || 0) - trimStart));
            const pct = Math.min(99, Math.round((current / duration) * 1000) / 10);
            if (pct !== lastPct) {
                lastPct = pct;
                onProgress(pct, { current, duration, retry });
            }
        };
        if (typeof onProgress === "function") onProgress(0, { current: 0, duration, retry });

        watchdog = setInterval(() => {
            reportPct();

            // এনকোডার bitrate ছাড়িয়ে বড় ফাইল বানালে অর্ধেকের আগেই ধরে কম bitrate-এ নতুন করে শুরু
            if (reachedTrimEnd(video.currentTime || 0)) finishClip();
            const now = Math.max(0, (video.currentTime || 0) - trimStart);
            if (
                !retryScale &&
                retry < MAX_RETRIES &&
                now >= Math.max(6, duration * 0.08) &&
                now <= duration * 0.55
            ) {
                const projected = (bytes / now) * duration;
                if (projected > SAFE_LIMIT_BYTES) {
                    retryScale = scale * (TARGET_OUTPUT_BYTES / projected) * 0.88;
                    failNow("projected size too big");
                }
            }

            if (video.ended || pausedByBrowser) {
                stuckTicks = 0;
                return;
            }
            if (video.currentTime === lastTime) {
                stuckTicks += 1;
                // ব্যাকগ্রাউন্ডে কোনো OS/Safari সত্যিই প্লেব্যাক থামিয়ে দিলে পজ করে রাখি (ফিরলেই চলবে)
                if (document.hidden && stuckTicks >= 16) {
                    pausedByBrowser = true;
                    stuckTicks = 0;
                    try {
                        video.pause();
                        if (recorder.state === "recording") recorder.pause();
                    } catch {
                        /* ignore */
                    }
                } else if (!document.hidden && stuckTicks >= 24) {
                    failNow("playback stalled"); // ৬ সেকেন্ড আটকে থাকলে
                }
            } else {
                stuckTicks = 0;
                lastTime = video.currentTime;
            }
        }, 250);
        hardTimer = setTimeout(() => failNow("timeout"), duration * 3500 + 90000);

        // 2000ms timeslice: কম GC পজ = কোনো ফ্রেম ড্রপ নয়
        recorder.start(2000);
        drawFrame(true); // শুরুতে কালো ফ্রেম এড়াতে প্রথম ফ্রেম
        await video.play();

        await new Promise(resolve => {
            const poll = setInterval(() => {
                if (failed) {
                    clearInterval(poll);
                    resolve();
                }
            }, 200);
            done.then(() => {
                clearInterval(poll);
                resolve();
            });
        });
        if (retryScale) return { retryScale };
        if (failed) throw failed;

        // ছাঁটা অংশ শেষ: ভিডিও থামানো, যাতে শেষ বিন্দুর পরের শব্দ/ফ্রেম রেকর্ডে না ঢোকে
        if (trim) {
            try {
                video.pause();
            } catch {
                /* ignore */
            }
        }
        // শেষ ফ্রেম ও অডিওর লেজটুকু রেকর্ডারে পৌঁছাতে একটু সময় দেওয়া
        drawFrame(true);
        await new Promise(r => setTimeout(r, 250));
        finished = true;
        if (recorder.state !== "inactive") recorder.stop();
        await stopped;

        const blob = new Blob(chunks, { type: rec.baseMime });
        // শেষে সীমা ছাড়ালে কম bitrate-এ আবার চেষ্টা
        if (blob.size > HARD_LIMIT_BYTES && retry < MAX_RETRIES) {
            return { retryScale: scale * (TARGET_OUTPUT_BYTES / blob.size) * 0.88 };
        }
        // খালি/ভাঙা বা ছোট হয়নি — আসলটাই ভালো (তবে >25MB হলে ছোটটা যতটুকু হয়েছে সেটাই)
        // trim হলে ছাঁটা ফাইলই ফেরত যায় (ছোট না হলেও); না হলে কলার আসল ফাইল দেখে ব্যর্থতা ধরে
        if (blob.size < 2048) return file;
        if (!trim && blob.size >= file.size * 0.95 && file.size <= HARD_LIMIT_BYTES) {
            return file;
        }

        if (typeof onProgress === "function") onProgress(100, { current: duration, duration, retry });
        const baseName = String(file.name || "video").replace(/\.[^./\\]+$/, "") || "video";
        return new File([blob], `${baseName}.${rec.ext}`, {
            type: rec.baseMime,
            lastModified: Date.now()
        });
    } catch {
        return file;
    } finally {
        release();
    }
};

// সীমার (২৫ MB) মধ্যে না ঢুকলে নিজে থেকে কম bitrate-এ আবার চেষ্টা করে (সর্বোচ্চ MAX_RETRIES বার)।
export const compressVideoFile = async (file, { onProgress, signal, force = false, trim = null } = {}) => {
    const hasTrim =
        Boolean(trim) && Number.isFinite(Number(trim.start)) && Number.isFinite(Number(trim.end)) && trim.end > trim.start;
    const effectiveTrim = hasTrim ? { start: Number(trim.start), end: Number(trim.end) } : null;
    // trim থাকলে ছোট ফাইলও এনকোড হতে হবে
    const forceNow = force || hasTrim;

    let scale = 1;
    for (let retry = 0; retry <= MAX_RETRIES; retry += 1) {
        const result = await compressOnce(file, {
            onProgress,
            signal,
            scale,
            retry,
            force: forceNow,
            trim: effectiveTrim
        });
        if (result && result.retryScale) {
            scale = result.retryScale;
            continue;
        }
        // ছাঁটা যায়নি (আসল ফাইলই ফিরেছে): না-ছাঁটা ভিডিও পোস্ট না করে ব্যর্থ বলা (বাতিল হলে চুপচাপ)
        if (hasTrim && result === file && !signal?.aborted) {
            throw new Error("Couldn't trim this video. Tap to retry.");
        }
        return result;
    }
    if (hasTrim) throw new Error("Couldn't trim this video. Tap to retry.");
    return file;
};
