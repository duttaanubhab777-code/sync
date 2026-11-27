import axios from "axios";
import { getStoredToken, PY_URL_KEY, refreshAccessToken } from "./api.js";
import { compressMediaFile } from "../utils/compress.js";

// ---------------------------------------------------------------------------
// আপলোড ইঞ্জিন: নেট চলে গেলে/ধীর হলে নিজে থেকে অপেক্ষা করে আবার চেষ্টা করে (error দেখায় না)।
//   - নেট নেই (offline)  : "online" ইভেন্ট আসা পর্যন্ত অপেক্ষা, তারপর যেখানে থেমেছিল সেখান থেকে
//   - বড় ফাইল (>10MB)   : ৬MB-এর chunk-এ আপলোড; প্রতিটা chunk সেভ হয়, তাই নেট গেলে/অ্যাপ বন্ধ হলেও
//                          আটকে যাওয়া chunk থেকেই আবার শুরু হয়
//   - আটকে যাওয়া (stall) : ২৫ সেকেন্ড কোনো বাইট না গেলে request থামিয়ে আবার চেষ্টা
//   - signature পুরনো    : নতুন signature এনে আবার শুরু
// persistent: true (চ্যাট ও স্টোরির background queue) হলে নেট না আসা পর্যন্ত অনির্দিষ্টকাল অপেক্ষা করে।
// false (প্রোফাইল ছবি ইত্যাদি) হলে অল্প সময় অপেক্ষা করে তারপর স্পষ্ট বার্তা সহ ব্যর্থ হয়।
// ---------------------------------------------------------------------------

const MAX_BYTES = 25 * 1024 * 1024;
// চ্যাটে ভিডিও ২৫ MB-এর কম হলেই কেবল "Send original" বোতাম দেখাবে
export const SEND_ORIGINAL_MAX_BYTES = 25 * 1024 * 1024;
// স্টোরিতে ভিডিও ২৫ MB-এর বেশি হলেই কেবল কমপ্রেস হবে (≤25MB হলে সরাসরি আপলোড)
export const STORY_VIDEO_COMPRESS_THRESHOLD = 25 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const maxBytesFor = file =>
    detectMessageTypeFromFile(file) === "video" ? MAX_VIDEO_BYTES : MAX_BYTES;

export const CHUNK_THRESHOLD = 10 * 1024 * 1024;
export const CHUNK_SIZE = 6 * 1024 * 1024; // Cloudinary: শেষেরটা বাদে প্রতিটা chunk >= 5MB
const STALL_MS = 25 * 1000;
const NON_PERSISTENT_MAX_ATTEMPTS = 6;
const NON_PERSISTENT_ONLINE_WAIT_MS = 3 * 60 * 1000;
const PERSISTENT_MAX_ATTEMPTS = 40; // অনলাইন থাকা অবস্থায় বারবার ব্যর্থ হলে তবেই হাল ছাড়া

class UploadError extends Error {
    constructor(message, { retryable = false, offline = false, resign = false, status = 0 } = {}) {
        super(message);
        this.name = "UploadError";
        this.retryable = retryable;
        this.offline = offline;
        this.resign = resign;
        this.status = status;
    }
}

const abortError = () => {
    const e = new Error("Upload cancelled");
    e.name = "AbortError";
    e.cancelled = true;
    return e;
};

export const isCancelError = err => Boolean(err && (err.cancelled || err.name === "AbortError"));

const isOnline = () => typeof navigator === "undefined" || navigator.onLine !== false;

const sleep = (ms, signal) =>
    new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(abortError());
        const t = setTimeout(() => {
            cleanup();
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(t);
            cleanup();
            reject(abortError());
        };
        const cleanup = () => signal?.removeEventListener("abort", onAbort);
        signal?.addEventListener("abort", onAbort);
    });

// নেট ফিরলে (বা maxMs পেরোলে) resolve। সময় পেরোলে false, নেট এলে true
const waitForOnline = (signal, maxMs = Infinity) =>
    new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(abortError());
        if (isOnline()) return resolve(true);
        let timer = null;
        const cleanup = () => {
            window.removeEventListener("online", onOnline);
            signal?.removeEventListener("abort", onAbort);
            if (timer) clearTimeout(timer);
        };
        const onOnline = () => {
            cleanup();
            resolve(true);
        };
        const onAbort = () => {
            cleanup();
            reject(abortError());
        };
        window.addEventListener("online", onOnline);
        signal?.addEventListener("abort", onAbort);
        if (Number.isFinite(maxMs)) {
            timer = setTimeout(() => {
                cleanup();
                resolve(false);
            }, maxMs);
        }
    });

const backoffMs = attempt => {
    const base = Math.min(30000, 1500 * 2 ** Math.max(0, attempt - 1));
    return base + Math.floor(Math.random() * 600);
};

// মসৃণ progress: ব্রাউজার অনেক সময় বড় লাফে জানায়, তাই আসল গতি মেপে বারকে 0→100 মসৃণভাবে বাড়ানো হয়।
// chunk বা retry-তে বার কখনো পিছনে যায় না (shown শুধু বাড়ে)।
const createTracker = (total, onProgress, initialLoaded = 0) => {
    let loaded = Math.max(0, Math.min(initialLoaded, total));
    let realPct = total > 0 ? Math.min(99, (loaded / total) * 100) : 0;
    let shown = realPct;
    let speed = 0;
    let lastT = performance.now();
    let lastLoaded = loaded;
    let sendDone = false;
    let finished = false;
    let lastEmitted = -1;
    let phase = "uploading";
    let extra = {};

    const emit = (ph = phase) => {
        if (typeof onProgress !== "function") return;
        phase = ph;
        const pct = Math.min(100, Math.floor(shown));
        const remaining = Math.max(0, total - loaded);
        onProgress(pct, {
            precise: Math.min(100, shown),
            loaded: Math.min(loaded, total),
            total,
            speed,
            eta: speed > 1024 ? Math.ceil(remaining / speed) : null,
            phase,
            ...extra
        });
        lastEmitted = shown;
    };

    const timer = setInterval(() => {
        if (finished || phase === "waiting") return;
        if (shown < realPct) {
            shown = Math.min(realPct, shown + Math.max((realPct - shown) * 0.3, 0.6));
        } else if (!sendDone && speed > 0 && total > 0) {
            const lead = Math.min(realPct + 6, 98);
            shown = Math.max(shown, Math.min(lead, shown + ((speed * 0.1) / total) * 100 * 0.6));
        } else if (sendDone && shown < 99) {
            shown = Math.min(99, shown + 0.4);
        }
        if (Math.abs(shown - lastEmitted) >= 0.25) {
            emit(sendDone ? "processing" : "uploading");
        }
    }, 100);

    return {
        emit,
        setExtra(e) {
            extra = e || {};
        },
        bytes(absLoaded) {
            const now = performance.now();
            loaded = Math.max(0, Math.min(absLoaded, total));
            const dt = (now - lastT) / 1000;
            if (dt >= 0.15) {
                const instant = (loaded - lastLoaded) / dt;
                if (instant >= 0) speed = speed ? speed * 0.65 + instant * 0.35 : instant;
                lastT = now;
                lastLoaded = loaded;
            }
            if (total > 0) realPct = Math.min(99, (loaded / total) * 100);
        },
        // retry-র পর নতুন অফসেট থেকে শুরু
        reset(absLoaded) {
            loaded = absLoaded;
            lastLoaded = absLoaded;
            lastT = performance.now();
            speed = 0;
            realPct = Math.min(99, total > 0 ? (absLoaded / total) * 100 : 0);
            sendDone = false;
            extra = {};
        },
        sent() {
            sendDone = true;
            loaded = total;
            realPct = 99;
        },
        stop() {
            finished = true;
            clearInterval(timer);
        },
        finish() {
            finished = true;
            clearInterval(timer);
            return new Promise(resolve => {
                const done = () => {
                    shown = 100;
                    loaded = total;
                    extra = {};
                    emit("done");
                    resolve();
                };
                if (shown >= 96) return done();
                const ramp = setInterval(() => {
                    shown = Math.min(100, shown + Math.max((100 - shown) * 0.45, 1.5));
                    if (shown >= 99.5) {
                        clearInterval(ramp);
                        done();
                    } else {
                        emit("processing");
                    }
                }, 40);
            });
        }
    };
};

// একটাই XHR request (পুরো ফাইল অথবা একটা chunk)।
// tracker-এ absLoaded = baseLoaded + এই request-এ যত বাইট গেছে।
const sendRequest = ({ url, formData, headers, signal, tracker, baseLoaded, partLength, isLast }) =>
    new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(abortError());
        const xhr = new XMLHttpRequest();
        xhr.open("POST", url);
        Object.entries(headers || {}).forEach(([k, v]) => xhr.setRequestHeader(k, v));

        let settled = false;
        let lastActivity = Date.now();
        let stallWatch = null;
        let reason = "";

        const cleanup = () => {
            clearInterval(stallWatch);
            signal?.removeEventListener("abort", onAbort);
            window.removeEventListener("offline", onOffline);
        };
        const fail = err => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(err);
        };
        const onAbort = () => {
            reason = "cancel";
            try {
                xhr.abort();
            } catch {
                /* ignore */
            }
        };
        // নেট বন্ধ হলে ঝুলে না থেকে সাথে সাথে থামিয়ে অপেক্ষায় যাওয়া
        const onOffline = () => {
            reason = "offline";
            try {
                xhr.abort();
            } catch {
                /* ignore */
            }
        };
        signal?.addEventListener("abort", onAbort);
        window.addEventListener("offline", onOffline);

        stallWatch = setInterval(() => {
            if (Date.now() - lastActivity > STALL_MS) {
                reason = "stall";
                try {
                    xhr.abort();
                } catch {
                    /* ignore */
                }
            }
        }, 5000);

        xhr.upload.onprogress = evt => {
            lastActivity = Date.now();
            const sent = Math.min(evt.loaded, partLength);
            tracker.bytes(baseLoaded + sent);
        };
        xhr.upload.onload = () => {
            lastActivity = Date.now();
            if (isLast) tracker.sent();
        };
        xhr.onprogress = () => {
            lastActivity = Date.now();
        };

        xhr.onload = () => {
            if (settled) return;
            let body = null;
            try {
                body = JSON.parse(xhr.responseText);
            } catch {
                body = null;
            }
            const status = xhr.status;
            if (status >= 200 && status < 300 && (body || !isLast)) {
                settled = true;
                cleanup();
                return resolve(body || {});
            }
            const msg = body?.error?.message || `Upload failed (HTTP ${status})`;
            const staleSig = /signature|timestamp|stale|expired/i.test(msg);
            fail(
                new UploadError(msg, {
                    status,
                    retryable: status === 408 || status === 429 || status >= 500 || staleSig,
                    resign: staleSig
                })
            );
        };
        xhr.onerror = () =>
            fail(
                new UploadError("Network error while uploading.", {
                    retryable: true,
                    offline: !isOnline()
                })
            );
        xhr.ontimeout = () =>
            fail(new UploadError("Upload timed out.", { retryable: true }));
        xhr.onabort = () => {
            if (reason === "cancel" || signal?.aborted) return fail(abortError());
            if (reason === "offline") {
                return fail(new UploadError("Network lost.", { retryable: true, offline: true }));
            }
            return fail(
                new UploadError("Upload stalled.", { retryable: true, offline: !isOnline() })
            );
        };

        xhr.send(formData);
    });

// ব্যর্থতা কোন ধরনের: "cancel" | "retry" (নেট/সার্ভার সাময়িক) | "fatal" (আবার চেষ্টায় লাভ নেই)
const classifyError = err => {
    if (isCancelError(err)) return "cancel";
    if (err instanceof UploadError) return err.retryable ? "retry" : "fatal";
    if (err?.response) {
        const st = err.response.status;
        return st === 408 || st === 429 || st >= 500 ? "retry" : "fatal";
    }
    if (err?.code === "ERR_NETWORK" || err?.code === "ECONNABORTED") return "retry";
    return "fatal";
};

// retry/অপেক্ষার লুপ। attemptFn(attemptNo) সফল হলে ফল ফেরত; retryable ব্যর্থতায় অপেক্ষা করে আবার
const runWithRetry = async (attemptFn, { persistent, signal, onWait, onResign }) => {
    const maxAttempts = persistent ? PERSISTENT_MAX_ATTEMPTS : NON_PERSISTENT_MAX_ATTEMPTS;
    let failures = 0;
    for (;;) {
        if (signal?.aborted) throw abortError();

        if (!isOnline()) {
            onWait?.({ reason: "offline", attempt: failures, retryIn: null });
            const back = await waitForOnline(
                signal,
                persistent ? Infinity : NON_PERSISTENT_ONLINE_WAIT_MS
            );
            if (!back) {
                throw new Error("No internet connection. Please check your network and try again.");
            }
            // নেট ফিরলেও সংযোগ স্থির হতে একটু সময় দেওয়া
            await sleep(800, signal);
        }

        try {
            return await attemptFn(failures);
        } catch (err) {
            if (classifyError(err) !== "retry") throw err;

            if (err?.resign) onResign?.();

            // offline কারণে ব্যর্থ হলে চেষ্টা গোনা হয় না: শুধু নেটের অপেক্ষা
            if (!(err?.offline || !isOnline())) failures += 1;
            if (failures >= maxAttempts) {
                throw new Error(
                    "Upload failed after several attempts. Please check your connection and try again."
                );
            }
            const retryIn = err?.offline || !isOnline() ? 0 : backoffMs(failures);
            onWait?.({
                reason: err?.offline || !isOnline() ? "offline" : "retry",
                attempt: failures,
                retryIn
            });
            if (retryIn) await sleep(retryIn, signal);
        }
    }
};

const newUploadId = () =>
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}${Math.random()
        .toString(36)
        .slice(2, 10)}`;

// Python সার্ভিস থেকে আপলোডের signature আনা (401 হলে token refresh করে আবার চেষ্টা)
const fetchUploadSignature = async options => {
    const pyBaseUrl = (
        import.meta.env.VITE_PYTHON_SERVICE_URL ||
        localStorage.getItem(PY_URL_KEY) ||
        ""
    ).replace(/\/+$/, "");

    if (!pyBaseUrl) {
        throw new Error(
            "The Python media service URL is not configured. Set PYTHON_SERVICE_URL in your deployment environment."
        );
    }

    const signBody = options?.purpose ? { purpose: options.purpose } : {};
    const sign = token =>
        axios.post(`${pyBaseUrl}/api/v1/media/sign`, signBody, {
            headers: { Authorization: `Bearer ${token}` },
            timeout: 20000
        });

    let signRes;
    try {
        signRes = await sign(getStoredToken());
    } catch (err) {
        if (err.response?.status === 401) {
            signRes = await sign(await refreshAccessToken());
        } else if (!err.response) {
            // নেটওয়ার্ক সমস্যা: retry লুপ আবার চেষ্টা করবে
            throw new UploadError("Network error while preparing the upload.", {
                retryable: true,
                offline: !isOnline()
            });
        } else if (err.response.status >= 500 || err.response.status === 429) {
            throw new UploadError("The media service is busy. Retrying...", {
                retryable: true,
                status: err.response.status
            });
        } else {
            throw new Error(
                err.response?.data?.message ||
                    "Unable to obtain an upload signature from the media service."
            );
        }
    }

    const signData = signRes.data?.data || signRes.data;
    const { cloudName, apiKey, signature } = signData || {};
    if (!cloudName || !apiKey || !signature) {
        throw new Error("Invalid upload signature from Python service");
    }
    return signData;
};

const buildFields = (signData, resourceEndpoint) => {
    const fields = {
        api_key: signData.apiKey,
        timestamp: String(signData.timestamp)
    };
    if (signData.folder) fields.folder = signData.folder;
    // সার্ভার যদি allowed_formats সই করে থাকে (ENFORCE_ALLOWED_FORMATS চালু), ঠিক সেটাই পাঠাতে হবে
    if (signData.allowedFormats) fields.allowed_formats = signData.allowedFormats;
    fields.signature = signData.signature;
    return {
        url: `https://api.cloudinary.com/v1_1/${signData.cloudName}/${resourceEndpoint}/upload`,
        fields
    };
};

// একটা ফাইল Cloudinary-তে তোলা (retry + resumable chunk সহ)। ফেরত: Cloudinary-র JSON
const uploadFileResilient = async (
    file,
    { purpose, persistent, signal, onProgress, initialChunkState, onChunkCommitted }
) => {
    const total = file.size;
    const detectedType = detectMessageTypeFromFile(file);
    // ডকুমেন্টের জন্য /raw/upload ব্যবহার করলে PDF/ZIP/DOCX আসল ফাইল হিসেবে নিরাপদে ডেলিভার হয়
    const resourceEndpoint = detectedType === "file" ? "raw" : "auto";
    const useChunks = total > CHUNK_THRESHOLD;

    // আগের সেভ করা chunk state (অ্যাপ বন্ধ/রিলোড হলেও যে chunk-এ থেমেছিল সেখান থেকে শুরু)
    const canResume =
        useChunks &&
        initialChunkState &&
        initialChunkState.uploadId &&
        initialChunkState.signData &&
        Number(initialChunkState.offset) > 0 &&
        Number(initialChunkState.offset) < total &&
        Number(initialChunkState.total) === total;

    let signData = canResume ? initialChunkState.signData : null;
    let uploadId = canResume ? initialChunkState.uploadId : newUploadId();
    let offset = canResume ? Number(initialChunkState.offset) : 0;

    const tracker = createTracker(total, onProgress, offset);

    const handleWait = info => {
        tracker.setExtra({
            waitReason: info.reason,
            waitAttempt: info.attempt,
            waitRetryIn: info.retryIn
        });
        tracker.emit("waiting");
    };
    const resumeEmit = () => {
        tracker.setExtra({});
        tracker.reset(useChunks ? offset : 0);
        tracker.emit("uploading");
    };

    try {
        tracker.emit("uploading");
        const result = await runWithRetry(
            async () => {
                if (!signData) signData = await fetchUploadSignature({ purpose });
                const { url, fields } = buildFields(signData, resourceEndpoint);
                resumeEmit();

                if (!useChunks) {
                    const fd = new FormData();
                    Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
                    fd.append("file", file);
                    return sendRequest({
                        url,
                        formData: fd,
                        headers: {},
                        signal,
                        tracker,
                        baseLoaded: 0,
                        partLength: total,
                        isLast: true
                    });
                }

                let last = null;
                while (offset < total) {
                    const end = Math.min(offset + CHUNK_SIZE, total);
                    const isLast = end >= total;
                    const part = file.slice(offset, end);
                    const fd = new FormData();
                    Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
                    fd.append("file", part, file.name || "file");
                    last = await sendRequest({
                        url,
                        formData: fd,
                        headers: {
                            "X-Unique-Upload-Id": uploadId,
                            "Content-Range": `bytes ${offset}-${end - 1}/${total}`
                        },
                        signal,
                        tracker,
                        baseLoaded: offset,
                        partLength: end - offset,
                        isLast
                    });
                    offset = end; // এই chunk নিশ্চিত, retry বা restart হলে এখান থেকেই চলবে
                    tracker.bytes(offset);
                    if (!isLast && typeof onChunkCommitted === "function") {
                        onChunkCommitted({ uploadId, offset, total, signData });
                    }
                }
                return last;
            },
            {
                persistent,
                signal,
                onWait: handleWait,
                onResign: () => {
                    // signature পুরনো: নতুন signature ও নতুন upload id নিয়ে শুরু থেকে
                    signData = null;
                    uploadId = newUploadId();
                    offset = 0;
                    if (typeof onChunkCommitted === "function") onChunkCommitted(null);
                }
            }
        );
        await tracker.finish();
        return result;
    } catch (err) {
        tracker.stop();
        throw err;
    }
};

// ছবি/ভিডিও ফোনেই ছোট করা। ফেরত: যে ফাইল আপলোড হবে (ব্যর্থ বা বাতিল হলে আসলটাই)
// options.compressSignal: abort করলে আসল ফাইলই যায় (ভিডিওর "Send original")
export const prepareMediaFile = async (file, onProgress, options = {}) => {
    const originalSize = file.size;
    const originalKind = detectMessageTypeFromFile(file);
    const willCompress =
        options?.compress === true && (originalKind === "image" || originalKind === "video");
    const report = (pct, info) => {
        if (typeof onProgress !== "function") return;
        onProgress(pct, { originalSize, compressedSize: file.size, willCompress, ...info });
    };

    if (!willCompress) {
        report(0, { phase: "preparing", total: originalSize });
        return file;
    }
    report(0, { phase: "compressing", total: originalSize });
    const out = await compressMediaFile(file, {
        signal: options?.compressSignal,
        force: Boolean(options?.forceCompress),
        onProgress: (compressPct, detail) =>
            report(0, {
                phase: "compressing",
                total: originalSize,
                compressPct,
                compressCurrent: detail?.current,
                compressDuration: detail?.duration,
                compressRetry: detail?.retry || 0
            })
    });
    return out;
};

// compress হয়ে যাওয়া (বা আসল) ফাইল আপলোড; ফল সরাসরি মেসেজে বা স্টোরিতে বসানোর মতো
export const uploadPreparedFile = async (file, onProgress, options = {}, sizes = {}) => {
    if (!file) throw new Error("No file selected");
    const maxBytes = maxBytesFor(file);
    if (file.size > maxBytes) {
        throw new Error(`File is too large (max ${Math.round(maxBytes / (1024 * 1024))} MB)`);
    }
    const originalSize = sizes.originalSize ?? file.size;
    const compressedSize = file.size;
    const willCompress = Boolean(sizes.willCompress);
    const report = (pct, info) => {
        if (typeof onProgress !== "function") return;
        onProgress(pct, { originalSize, compressedSize, willCompress, ...info });
    };

    report(0, { phase: "uploading", total: file.size });
    const data = await uploadFileResilient(file, {
        purpose: options?.purpose,
        persistent: options?.persistent === true,
        signal: options?.signal,
        initialChunkState: options?.initialChunkState || null,
        onChunkCommitted: options?.onChunkCommitted,
        onProgress: (pct, info) => report(pct, info)
    });

    return {
        url: data.secure_url,
        publicId: data.public_id,
        mime: file.type || `${data.resource_type}/${data.format || "bin"}`,
        fileName: file.name || "",
        bytes: data.bytes,
        width: data.width,
        height: data.height,
        duration: data.duration
    };
};

// options.purpose (ঐচ্ছিক): "chat" (ডিফল্ট) | "voice" | "avatar" | "story" | "group"
// options.compress === true হলে ছবি/ভিডিও আপলোডের আগে ফোনেই ছোট করা হয়।
// options.compressSignal / options.signal (AbortSignal, ঐচ্ছিক)।
// options.persistent === true হলে নেট না আসা পর্যন্ত অপেক্ষা করে (চ্যাট ও স্টোরির background queue)।
export const uploadMediaToCloudinary = async (file, onProgress, options = {}) => {
    if (!file) throw new Error("No file selected");
    const originalSize = file.size;
    const originalKind = detectMessageTypeFromFile(file);
    const willCompress =
        options?.compress === true && (originalKind === "image" || originalKind === "video");

    const prepared = await prepareMediaFile(file, onProgress, options);
    return uploadPreparedFile(prepared, onProgress, options, { originalSize, willCompress });
};

export const detectMessageTypeFromFile = file => {
    const mime = (file?.type || "").toLowerCase();
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("video/")) return "video";
    if (mime.startsWith("audio/")) return "audio";

    // কিছু Android WebView ফাইল পিকারে MIME খালি থাকে, তাই এক্সটেনশন fallback
    const name = (file?.name || "").toLowerCase();
    if (/\.(jpe?g|png|webp|gif|heic|heif|avif)$/.test(name)) return "image";
    if (/\.(mp4|mov|webm|m4v|3gp|ogv|mkv)$/.test(name)) return "video";
    if (/\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|weba)$/.test(name)) return "audio";
    return "file";
};
