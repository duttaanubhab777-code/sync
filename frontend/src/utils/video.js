// চ্যাট ও story-র ভিডিও আপলোডের আগে ফোনেই ছোট করা (WhatsApp-এর মতো)।
//
// কীভাবে কাজ করে: কোনো বাড়তি লাইব্রেরি ছাড়াই ব্রাউজারের নিজস্ব <video> + canvas + MediaRecorder।
// ভিডিওটা চুপচাপ (শব্দ ছাড়া, স্ক্রিনে না দেখিয়ে) চালানো হয়, প্রতিটা ফ্রেম ছোট canvas-এ এঁকে
// নতুন bitrate-এ আবার এনকোড করা হয়, আর অডিও আলাদা পথে ধরা হয়। তাই compress-এ সময় লাগে
// প্রায় ভিডিওর দৈর্ঘ্যের সমান (১ মিনিটের ভিডিও ≈ ১ মিনিট); progress বার সেটাই দেখায়।
//
// নিয়ম: কোনো কারণে (অসমর্থিত কোডেক, ব্যাকগ্রাউন্ডে চলে যাওয়া, আটকে যাওয়া ...) ব্যর্থ হলে বা
// ফল আসলের চেয়ে ছোট না হলে আসল ফাইলই ফেরত যায়। কখনো throw করে না, আপলোড আটকায় না।

// আসল ফাইল ছোট/হালকা হলে আর ছোঁয়া হয় না (আবার এনকোড করলে কোয়ালিটি শুধু নষ্ট হতো)
const SKIP_BELOW_BYTES = 1.2 * 1024 * 1024;
// আপলোডের সীমা ২৫ MB; তার নিচে থাকতে লক্ষ্য ২৩ MB
const TARGET_OUTPUT_BYTES = 23 * 1024 * 1024;
const AUDIO_BPS = 96 * 1000;
const MAX_FPS = 30;
// এর চেয়ে লম্বা ভিডিও compress করতে অনেক সময় লাগবে, তাই আসলটাই যায় (২৫ MB-এ আটকালে ভুল বার্তা আসবে)
const MAX_COMPRESS_SECONDS = 10 * 60;

// লম্বা দিক (px) ও ভিডিও bitrate। ছোট ভিডিওতে উপরের ধাপ (720p), লম্বা ভিডিওতে ২৩ MB-এ ঢোকাতে নিচের ধাপ।
const TIERS = [
    { side: 1280, bps: 1_800_000 },
    { side: 960, bps: 1_100_000 },
    { side: 854, bps: 700_000 },
    { side: 640, bps: 450_000 }
];

// iOS/Safari-তেও চলে বলে MP4 আগে, না পারলে WebM
const pickRecorderType = () => {
    if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return null;
    const candidates = [
        ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "mp4"],
        ["video/mp4;codecs=avc1,mp4a.40.2", "mp4"],
        ["video/mp4", "mp4"],
        ["video/webm;codecs=vp9,opus", "webm"],
        ["video/webm;codecs=vp8,opus", "webm"],
        ["video/webm", "webm"]
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

const even = n => Math.max(2, Math.round(n / 2) * 2);

export const pickVideoProfile = (width, height, duration) => {
    const longSide = Math.max(width, height);
    const budgetBps = (TARGET_OUTPUT_BYTES * 8) / Math.max(duration, 1) - AUDIO_BPS;

    let tier = TIERS.find(t => t.bps <= budgetBps) || TIERS[TIERS.length - 1];
    const videoBps = Math.max(200_000, Math.min(tier.bps, budgetBps));
    const side = Math.min(tier.side, longSide); // কখনো বড় করা হয় না
    const scale = side / longSide;
    return {
        width: even(width * scale),
        height: even(height * scale),
        videoBps: Math.round(videoBps),
        tierSide: tier.side
    };
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

export const compressVideoFile = async (file, { onProgress } = {}) => {
    let objectUrl = "";
    let video = null;
    let audioCtx = null;
    let recorder = null;
    let stream = null;
    let watchdog = null;
    let hardTimer = null;
    let onVisibility = null;

    const release = () => {
        clearInterval(watchdog);
        clearTimeout(hardTimer);
        if (onVisibility) document.removeEventListener("visibilitychange", onVisibility);
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
        }
        if (objectUrl) URL.revokeObjectURL(objectUrl);
    };

    try {
        if (!file || typeof document === "undefined") return file;
        if (file.size < SKIP_BELOW_BYTES) return file;

        const rec = pickRecorderType();
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!rec || !AudioCtx || typeof HTMLCanvasElement.prototype.captureStream !== "function") {
            return file;
        }

        objectUrl = URL.createObjectURL(file);
        video = document.createElement("video");
        video.preload = "auto";
        video.playsInline = true;
        video.setAttribute("playsinline", "");
        video.src = objectUrl;

        await waitForEvent(video, "loadedmetadata", 15000);

        const srcW = video.videoWidth;
        const srcH = video.videoHeight;
        const duration = video.duration;
        if (!srcW || !srcH || !Number.isFinite(duration) || duration <= 0) return file;
        if (duration > MAX_COMPRESS_SECONDS) return file;

        const profile = pickVideoProfile(srcW, srcH, duration);

        // আগে থেকেই ছোট ও হালকা (প্রায় লক্ষ্য bitrate-এর মধ্যে) হলে আবার এনকোড না করাই ভালো
        const srcBps = (file.size * 8) / duration;
        const alreadySmall =
            Math.max(srcW, srcH) <= profile.tierSide && srcBps <= (profile.videoBps + AUDIO_BPS) * 1.15;
        if (alreadySmall) return file;

        // ---- canvas (ভিডিও) ----
        const canvas = document.createElement("canvas");
        canvas.width = profile.width;
        canvas.height = profile.height;
        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) return file;
        ctx.imageSmoothingQuality = "high";
        const drawFrame = () => ctx.drawImage(video, 0, 0, profile.width, profile.height);

        // ---- অডিও: স্পিকারে না বাজিয়ে সরাসরি রেকর্ডারে ----
        audioCtx = new AudioCtx();
        try {
            await audioCtx.resume();
        } catch {
            /* নিচে state দেখা হবে */
        }
        const audioSource = audioCtx.createMediaElementSource(video);
        const audioDest = audioCtx.createMediaStreamDestination();
        audioSource.connect(audioDest);
        if (audioCtx.state !== "running") return file;

        stream = new MediaStream([
            ...canvas.captureStream(MAX_FPS).getVideoTracks(),
            ...audioDest.stream.getAudioTracks()
        ]);

        const chunks = [];
        recorder = new MediaRecorder(stream, {
            mimeType: rec.mime,
            videoBitsPerSecond: profile.videoBps,
            audioBitsPerSecond: AUDIO_BPS
        });
        recorder.ondataavailable = e => {
            if (e.data && e.data.size > 0) chunks.push(e.data);
        };

        const stopped = new Promise((resolve, reject) => {
            recorder.onstop = resolve;
            recorder.onerror = () => reject(new Error("recorder error"));
        });
        stopped.catch(() => {}); // ব্যর্থ হলে unhandled rejection আটকানো

        // প্রথম ফ্রেম আগেই এঁকে রাখা, যাতে শুরুতে কালো ফ্রেম না থাকে
        if (video.readyState < 2) await waitForEvent(video, "loadeddata", 15000);
        drawFrame();

        let finished = false;
        let failed = null;
        const done = new Promise(resolve => {
            video.onended = () => resolve();
        });
        const failNow = reason => {
            failed = new Error(reason);
        };

        // ---- ফ্রেম আঁকার লুপ ----
        let lastDrawn = -1;
        const minGap = 1 / (MAX_FPS + 2);
        if (typeof video.requestVideoFrameCallback === "function") {
            const tick = (_now, meta) => {
                if (finished) return;
                const t = meta?.mediaTime ?? video.currentTime;
                if (t - lastDrawn >= minGap || t < lastDrawn) {
                    drawFrame();
                    lastDrawn = t;
                }
                video.requestVideoFrameCallback(tick);
            };
            video.requestVideoFrameCallback(tick);
        } else {
            const loop = () => {
                if (finished) return;
                drawFrame();
                requestAnimationFrame(loop);
            };
            requestAnimationFrame(loop);
        }

        // ---- অ্যাপ ব্যাকগ্রাউন্ডে গেলে থামিয়ে রাখা (নইলে ফ্রেম হারাত), ফিরলে চালু ----
        onVisibility = () => {
            if (finished) return;
            if (document.hidden) {
                try {
                    video.pause();
                    if (recorder.state === "recording") recorder.pause();
                } catch {
                    /* ignore */
                }
            } else {
                try {
                    if (recorder.state === "paused") recorder.resume();
                    video.play().catch(() => failNow("resume failed"));
                } catch {
                    /* ignore */
                }
            }
        };
        document.addEventListener("visibilitychange", onVisibility);

        // ---- আটকে গেলে আসল ফাইলে ফিরে যাওয়া ----
        let lastTime = -1;
        let stuckTicks = 0;
        let lastPct = -1;
        const reportPct = () => {
            if (typeof onProgress !== "function") return;
            const pct = Math.min(99, Math.floor((video.currentTime / duration) * 100));
            if (pct !== lastPct) {
                lastPct = pct;
                onProgress(pct);
            }
        };
        if (typeof onProgress === "function") onProgress(0);
        watchdog = setInterval(() => {
            reportPct();
            if (document.hidden || video.paused || video.ended) {
                stuckTicks = 0;
                return;
            }
            if (video.currentTime === lastTime) {
                stuckTicks += 1;
                if (stuckTicks >= 10) failNow("playback stalled");
            } else {
                stuckTicks = 0;
                lastTime = video.currentTime;
            }
        }, 500);
        hardTimer = setTimeout(() => failNow("timeout"), duration * 3000 + 60000);

        recorder.start(500);
        await video.play();

        // শেষ বা ব্যর্থ — যেটা আগে
        await new Promise(resolve => {
            const poll = setInterval(() => {
                if (failed) {
                    clearInterval(poll);
                    resolve();
                }
            }, 300);
            done.then(() => {
                clearInterval(poll);
                resolve();
            });
        });
        if (failed) throw failed;

        // শেষ ফ্রেম ও অডিওর লেজটুকু রেকর্ডারে পৌঁছাতে একটু সময় দেওয়া
        drawFrame();
        await new Promise(r => setTimeout(r, 250));
        finished = true;
        if (recorder.state !== "inactive") recorder.stop();
        await stopped;

        const blob = new Blob(chunks, { type: rec.baseMime });
        // খালি/ভাঙা বা ছোট হয়নি — আসলটাই ভালো
        if (blob.size < 2048 || blob.size >= file.size * 0.95) return file;

        if (typeof onProgress === "function") onProgress(100);
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
