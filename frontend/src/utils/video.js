// চ্যাট ও story-র ভিডিও আপলোডের আগে ফোনেই ছোট করা (WhatsApp-এর মতো)।
//
// কীভাবে কাজ করে: কোনো বাড়তি লাইব্রেরি ছাড়াই ব্রাউজারের নিজস্ব <video> + canvas + MediaRecorder।
// ভিডিওটা চুপচাপ (শব্দ ছাড়া, স্ক্রিনে না দেখিয়ে) চালানো হয়, প্রতিটা ফ্রেম ছোট canvas-এ এঁকে
// নতুন bitrate-এ আবার এনকোড করা হয়, আর অডিও আলাদা পথে ধরা হয়। তাই compress-এ সময় লাগে
// প্রায় ভিডিওর দৈর্ঘ্যের সমান (১ মিনিটের ভিডিও ≈ ১ মিনিট); progress বার সেটাই দেখায়।
//
// নিয়ম: কোনো কারণে (অসমর্থিত কোডেক, ব্যাকগ্রাউন্ডে চলে যাওয়া, আটকে যাওয়া, ইউজার "Skip" চাপা ...) ব্যর্থ হলে
// বা ফল আসলের চেয়ে ছোট না হলে আসল ফাইলই ফেরত যায়। কখনো throw করে না, আপলোড আটকায় না।
//
// onProgress(pct, { current, duration }): pct ০–৯৯ (দশমিকসহ), current/duration সেকেন্ডে
// signal (AbortSignal): abort হলে compress থেমে আসল ফাইল ফেরত যায়

// আসল ফাইল ছোট/হালকা হলে আর ছোঁয়া হয় না (আবার এনকোড করলে কোয়ালিটি শুধু নষ্ট হতো)
const SKIP_BELOW_BYTES = 1.2 * 1024 * 1024;
// আপলোডের সীমা ২৫ MB; তার নিচে থাকতে লক্ষ্য ২৩ MB
// লক্ষ্য ২০ MB: এনকোডার অনেক সময় নিজের bitrate-এর চেয়ে বেশি ডেটা বানায়, তাই বাড়তি জায়গা রাখা
const TARGET_OUTPUT_BYTES = 20 * 1024 * 1024;
// আসল সীমা (media.js-এর MAX_BYTES-এর সমান) ও চলার পথে আন্দাজ করা সাইজ এর কাছাকাছি গেলে সতর্কসীমা
const HARD_LIMIT_BYTES = 25 * 1024 * 1024;
const SAFE_LIMIT_BYTES = 23.5 * 1024 * 1024;
// সাইজ বেশি হলে কম bitrate-এ সর্বোচ্চ কতবার আবার চেষ্টা
const MAX_RETRIES = 2;
const AUDIO_BPS = 128 * 1000;
const MAX_FPS = 30;
// এর চেয়ে লম্বা ভিডিও compress করতে অনেক সময় লাগবে, তাই আসলটাই যায় (২৫ MB-এ আটকালে ভুল বার্তা আসবে)
const MAX_COMPRESS_SECONDS = 10 * 60;

// লম্বা দিক (px) ও ভিডিও bitrate। ছোট ভিডিওতে উপরের ধাপ (720p), লম্বা ভিডিওতে ২৩ MB-এ ঢোকাতে নিচের ধাপ।
// আগের চেয়ে bitrate বাড়ানো হয়েছে: ব্লক/ঝাপসা ভাব কমাতে (WhatsApp-এর কাছাকাছি কোয়ালিটি)।
const TIERS = [
    { side: 1280, bps: 2_800_000 },
    { side: 960, bps: 1_700_000 },
    { side: 854, bps: 1_100_000 },
    { side: 640, bps: 650_000 }
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

// scale < 1 হলে bitrate-বাজেট কমে যায় (আগের চেষ্টায় ফাইল সীমা ছাড়ালে আবার চেষ্টার সময়)
export const pickVideoProfile = (width, height, duration, budgetScale = 1) => {
    const longSide = Math.max(width, height);
    const budgetBps = ((TARGET_OUTPUT_BYTES * 8) / Math.max(duration, 1) - AUDIO_BPS) * budgetScale;

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

// AudioContext.resume() ব্লক হলে কখনো শেষ হয় না, তাই সময়সীমা দিয়ে অপেক্ষা
const resumeWithTimeout = async (ctx, ms) => {
    try {
        await Promise.race([ctx.resume(), new Promise(r => setTimeout(r, ms))]);
    } catch {
        /* নিচে state দেখা হবে */
    }
};

// একবারের compress। সফল/ব্যর্থ হলে File ফেরত দেয়; ফাইল সীমার চেয়ে বড় হয়ে যাচ্ছে বুঝলে { retryScale } ফেরত দেয়
const compressOnce = async (file, { onProgress, signal, scale = 1, retry = 0 } = {}) => {
    let objectUrl = "";
    let video = null;
    let audioCtx = null;
    let recorder = null;
    let stream = null;
    let watchdog = null;
    let hardTimer = null;
    let onVisibility = null;
    let onAbort = null;

    const release = () => {
        clearInterval(watchdog);
        clearTimeout(hardTimer);
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
        }
        if (objectUrl) URL.revokeObjectURL(objectUrl);
    };

    try {
        if (!file || typeof document === "undefined") return file;
        if (file.size < SKIP_BELOW_BYTES) return file;
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
        video.src = objectUrl;

        // ---- অডিও: স্পিকারে না বাজিয়ে সরাসরি রেকর্ডারে ----
        // AudioContext ইউজারের ট্যাপের সবচেয়ে কাছাকাছি সময়ে (কোনো await-এর আগে) বানানো হয়,
        // নইলে অনেক ব্রাউজারে সেটা "suspended" থেকে যায় আর compress শুরুই হয় না
        audioCtx = new AudioCtx();
        const resumePromise = resumeWithTimeout(audioCtx, 2000);
        const audioSource = audioCtx.createMediaElementSource(video);
        const audioDest = audioCtx.createMediaStreamDestination();
        audioSource.connect(audioDest);

        await waitForEvent(video, "loadedmetadata", 15000);
        if (failed) return file;

        const srcW = video.videoWidth;
        const srcH = video.videoHeight;
        const duration = video.duration;
        if (!srcW || !srcH || !Number.isFinite(duration) || duration <= 0) return file;
        if (duration > MAX_COMPRESS_SECONDS) return file;

        const profile = pickVideoProfile(srcW, srcH, duration, scale);

        // আগে থেকেই ছোট ও হালকা হলে আবার এনকোড না করাই ভালো (কোয়ালিটি নষ্ট, সময় নষ্ট, সাইজও কমত না)
        // (সীমা ছাড়ানোর কারণে আবার চেষ্টার সময় এটা দেখা হয় না)
        if (retry === 0) {
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

        // ---- canvas (ভিডিও) ----
        const canvas = document.createElement("canvas");
        canvas.width = profile.width;
        canvas.height = profile.height;
        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) return file;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";

        // যেখানে সম্ভব, প্রতিটা আঁকা ফ্রেম হাতে হাতে রেকর্ডারে পাঠানো (requestFrame): ফ্রেম বাদ/দ্বিগুণ হয় না, তাই মসৃণ
        const manualFrames =
            typeof CanvasCaptureMediaStreamTrack !== "undefined" &&
            typeof CanvasCaptureMediaStreamTrack.prototype.requestFrame === "function";
        const canvasStream = canvas.captureStream(manualFrames ? 0 : MAX_FPS);
        const canvasTrack = canvasStream.getVideoTracks()[0];
        const drawFrame = () => {
            ctx.drawImage(video, 0, 0, profile.width, profile.height);
            if (manualFrames) {
                try {
                    canvasTrack.requestFrame();
                } catch {
                    /* ignore */
                }
            }
        };

        stream = new MediaStream([...canvasStream.getVideoTracks(), ...audioDest.stream.getAudioTracks()]);

        const chunks = [];
        let bytes = 0; // এ পর্যন্ত রেকর্ড হওয়া ডেটা (আউটপুট সাইজ আন্দাজের জন্য)
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
        stopped.catch(() => {}); // ব্যর্থ হলে unhandled rejection আটকানো

        if (video.readyState < 2) await waitForEvent(video, "loadeddata", 15000);
        if (failed) return file;

        let finished = false;
        const done = new Promise(resolve => {
            video.onended = () => resolve();
        });

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
            let lastTs = 0;
            const loop = ts => {
                if (finished) return;
                if (ts - lastTs >= 1000 / MAX_FPS - 2) {
                    drawFrame();
                    lastTs = ts;
                }
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

        // ---- progress রিপোর্ট + আটকে গেলে আসল ফাইলে ফিরে যাওয়া ----
        let lastTime = -1;
        let stuckTicks = 0;
        let lastPct = -1;
        const reportPct = () => {
            if (typeof onProgress !== "function") return;
            const current = Math.min(duration, video.currentTime || 0);
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
            const now = video.currentTime || 0;
            if (
                !retryScale &&
                retry < MAX_RETRIES &&
                now >= Math.max(6, duration * 0.08) &&
                now <= duration * 0.5
            ) {
                const projected = (bytes / now) * duration;
                if (projected > SAFE_LIMIT_BYTES) {
                    retryScale = scale * (TARGET_OUTPUT_BYTES / projected) * 0.9;
                    failNow("projected size too big");
                }
            }

            if (document.hidden || video.paused || video.ended) {
                stuckTicks = 0;
                return;
            }
            if (video.currentTime === lastTime) {
                stuckTicks += 1;
                if (stuckTicks >= 20) failNow("playback stalled"); // ২৫০ms × ২০ = ৫ সেকেন্ড
            } else {
                stuckTicks = 0;
                lastTime = video.currentTime;
            }
        }, 250);
        hardTimer = setTimeout(() => failNow("timeout"), duration * 3000 + 60000);

        recorder.start(500);
        drawFrame(); // শুরুতে কালো ফ্রেম এড়াতে প্রথম ফ্রেম রেকর্ডার চালুর পরপরই
        await video.play();

        // শেষ বা ব্যর্থ — যেটা আগে
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

        // শেষ ফ্রেম ও অডিওর লেজটুকু রেকর্ডারে পৌঁছাতে একটু সময় দেওয়া
        drawFrame();
        await new Promise(r => setTimeout(r, 300));
        finished = true;
        if (recorder.state !== "inactive") recorder.stop();
        await stopped;

        const blob = new Blob(chunks, { type: rec.baseMime });
        // শেষে সীমা ছাড়ালে কম bitrate-এ আবার চেষ্টা
        if (blob.size > HARD_LIMIT_BYTES && retry < MAX_RETRIES) {
            return { retryScale: scale * (TARGET_OUTPUT_BYTES / blob.size) * 0.9 };
        }
        // খালি/ভাঙা বা ছোট হয়নি — আসলটাই ভালো
        if (blob.size < 2048 || blob.size >= file.size * 0.95) return file;

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
export const compressVideoFile = async (file, { onProgress, signal } = {}) => {
    let scale = 1;
    for (let retry = 0; retry <= MAX_RETRIES; retry += 1) {
        const result = await compressOnce(file, { onProgress, signal, scale, retry });
        if (result && result.retryScale) {
            scale = result.retryScale;
            continue;
        }
        return result;
    }
    return file;
};
