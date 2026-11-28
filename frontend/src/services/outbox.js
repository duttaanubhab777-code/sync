// চ্যাট ও স্টোরির ছবি/ভিডিও/ফাইল/ভয়েস/টেক্সট পাঠানোর WhatsApp-এর মতো background queue ("outbox")।
//
// বৈশিষ্ট্য:
//   - চ্যাট ও স্টোরি দুটোরই কমপ্রেশন, আপলোড ও পাঠানো পেজের বাইরে (এই module-এ) চলে
//   - ট্যাব/অ্যাপ ব্যাকগ্রাউন্ডে গেলেও ভিডিও কমপ্রেশন ও আপলোড থামে না (স্মুথভাবে চলতে থাকে)
//   - নেট গেলে error না দেখিয়ে অপেক্ষা করে, নেট এলে নিজে থেকে বাকিটা (যে chunk-এ থেমেছিল সেখান থেকে) চালায়
//   - ফাইল, chunk অবস্থা ও auth মেটা IndexedDB-তে রাখা হয়:
//       * ট্যাব কেটে দিলে Service Worker Background Sync ("sync-outbox") ব্যাকগ্রাউন্ডে আপলোড ও পাঠানো শেষ করে
//       * অ্যাপ বন্ধ/ক্র্যাশ হলেও পরের বার খুললে নিজে থেকে বাকিটা চালায়
//   - স্টোরির ভিডিও শুধু ২৫ MB-এর বেশি হলেই কমপ্রেস হয়; চ্যাটে ২৫ MB-এর কম ভিডিওতেই শুধু "Send original" চলে
//   - Android অ্যাপে কমপ্রেশন/আপলোড চলাকালীন foreground service চালু থাকে
//   - সার্ভার clientMsgId / clientStoryId দিয়ে duplicate আটকায়, তাই রিট্রাইয়ে দুবার যায় না
import { store } from "../store/index.js";
import {
    addOptimisticMessage,
    confirmMessageSent,
    markMessageFailed,
    markMessageRetrying,
    removeLocalMessage
} from "../store/chatSlice.js";
import { fetchStories } from "../store/storySlice.js";
import {
    api,
    getStoredRefreshToken,
    getStoredToken,
    PY_URL_KEY
} from "./api.js";
import {
    detectMessageTypeFromFile,
    isCancelError,
    clearSignatureCache,
    prepareMediaFile,
    prewarmUploadSignature,
    SEND_ORIGINAL_MAX_BYTES,
    STORY_VIDEO_COMPRESS_THRESHOLD,
    uploadPreparedFile
} from "./media.js";
import { emitWithAck, getSocket, isPermanentSendError } from "./socket.js";
import { playSound } from "./sounds.js";
import { generateClientMsgId } from "../utils/format.js";

// ---------------------------------------------------------------------------
// IndexedDB (v2: "jobs" + "meta")। Service Worker-ও এই একই DB পড়ে।
// ---------------------------------------------------------------------------
const DB_NAME = "sync-outbox";
const DB_VERSION = 2;
const STORE_JOBS = "jobs";
const STORE_META = "meta";
const BG_SYNC_TAG = "sync-outbox";
let dbPromise = null;

const openDb = () => {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(resolve => {
        try {
            if (typeof indexedDB === "undefined") return resolve(null);
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE_JOBS)) {
                    db.createObjectStore(STORE_JOBS, { keyPath: "id" });
                }
                if (!db.objectStoreNames.contains(STORE_META)) {
                    db.createObjectStore(STORE_META, { keyPath: "key" });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
            req.onblocked = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
    return dbPromise;
};

const withStore = async (storeName, mode, run) => {
    try {
        const db = await openDb();
        if (!db) return null;
        return await new Promise(resolve => {
            let result = null;
            const tx = db.transaction(storeName, mode);
            const os = tx.objectStore(storeName);
            const req = run(os);
            if (req) {
                req.onsuccess = () => {
                    result = req.result;
                };
            }
            tx.oncomplete = () => resolve(result);
            tx.onerror = () => resolve(null);
            tx.onabort = () => resolve(null);
        });
    } catch {
        return null;
    }
};

const dbPut = job => withStore(STORE_JOBS, "readwrite", os => os.put(job));
const dbDelete = id => withStore(STORE_JOBS, "readwrite", os => os.delete(id));
const dbAll = async () => (await withStore(STORE_JOBS, "readonly", os => os.getAll())) || [];
const dbClearJobs = () => withStore(STORE_JOBS, "readwrite", os => os.clear());
const dbPutMeta = rec => withStore(STORE_META, "readwrite", os => os.put(rec));
const dbClearMeta = () => withStore(STORE_META, "readwrite", os => os.clear());

// Service Worker localStorage পড়তে পারে না, তাই টোকেন ও URL-গুলো IndexedDB meta-তে রাখা
const syncAuthMeta = () => {
    try {
        const me = store.getState().auth.user;
        const accessToken = getStoredToken();
        if (!me?._id || !accessToken) return;
        const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");
        const pyBaseUrl = (
            import.meta.env.VITE_PYTHON_SERVICE_URL ||
            localStorage.getItem(PY_URL_KEY) ||
            ""
        ).replace(/\/+$/, "");
        dbPutMeta({
            key: "auth",
            userId: String(me._id),
            accessToken,
            refreshToken: getStoredRefreshToken() || "",
            apiBaseUrl,
            pyBaseUrl,
            updatedAt: Date.now()
        });
    } catch {
        /* ignore */
    }
};

// ব্রাউজার সমর্থন করলে Background Sync রেজিস্টার করা (ট্যাব কেটে দিলেও নেট এলেই SW চালাবে)
const registerBackgroundSync = async () => {
    try {
        if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
        const reg = await navigator.serviceWorker.ready;
        if (reg && "sync" in reg && typeof reg.sync.register === "function") {
            await reg.sync.register(BG_SYNC_TAG);
        }
    } catch {
        /* সব ব্রাউজারে Background Sync নেই, pagehide message ও reopen resume কাজ করবে */
    }
};

const notifySwBackgroundTakeover = () => {
    try {
        if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
        const sw = navigator.serviceWorker.controller;
        if (sw) sw.postMessage({ type: "SYNC_OUTBOX_BG" });
    } catch {
        /* ignore */
    }
};

// ---------------------------------------------------------------------------
// অবস্থা (UI-র জন্য useSyncExternalStore)
// ---------------------------------------------------------------------------
// entry = { job, stage, pct, info, error, ctrl, compressCtrl, cancelled, previewUrl, running }
// stage: "queued" | "compressing" | "uploading" | "sending" | "failed"
const entries = new Map();
let snapshot = [];
const listeners = new Set();
let lastKeepAlive = null;

const toView = e => ({
    id: e.job.id,
    kind: e.job.kind || "chat",
    conversationId: e.job.conversationId || "",
    storyType: e.job.storyType || e.job.type || "",
    caption: e.job.caption || "",
    stage: e.stage,
    pct: e.pct,
    info: e.info,
    error: e.error,
    name: e.job.fileName || (e.job.kind === "story" ? "Story" : ""),
    size: e.job.originalSize || 0,
    file: e.job.file || null
});

const emit = () => {
    snapshot = [...entries.values()].map(toView);
    listeners.forEach(l => {
        try {
            l();
        } catch {
            /* ignore */
        }
    });
    updateKeepAlive();
};

export const subscribeOutbox = listener => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};
export const getOutboxSnapshot = () => snapshot;

// ---------------------------------------------------------------------------
// Android: কমপ্রেশন/আপলোড চলাকালীন foreground service (native bridge থাকলে)
// ---------------------------------------------------------------------------
const ACTIVE_STAGES = new Set(["queued", "compressing", "uploading", "sending"]);

function updateKeepAlive() {
    const active = [...entries.values()].filter(e => ACTIVE_STAGES.has(e.stage));
    const compressing = active.some(e => e.stage === "compressing");
    const stories = active.filter(e => e.job.kind === "story").length;
    const key = active.length
        ? `on:${active.length}:${compressing ? "c" : "u"}:${stories}`
        : "off";
    if (key === lastKeepAlive) return;
    lastKeepAlive = key;
    try {
        const bridge = typeof window !== "undefined" ? window.SyncNativeNotif : null;
        if (bridge && typeof bridge.setUploadActive === "function") {
            let text = "";
            if (active.length === 1) {
                if (compressing) text = "Compressing video in background…";
                else if (stories === 1) text = "Posting story in background…";
                else text = "Sending 1 file…";
            } else if (active.length > 1) {
                text = compressing
                    ? `Processing ${active.length} items in background…`
                    : `Sending ${active.length} items…`;
            }
            bridge.setUploadActive(active.length > 0, text);
        }
    } catch {
        /* native bridge না থাকলে/ব্যর্থ হলে সমস্যা নেই */
    }
}

// ---------------------------------------------------------------------------
// ছোট সহায়ক
// ---------------------------------------------------------------------------
const safeObjectUrl = blob => {
    if (!blob) return "";
    try {
        return URL.createObjectURL(blob);
    } catch {
        return "";
    }
};
const revoke = url => {
    if (!url) return;
    try {
        URL.revokeObjectURL(url);
    } catch {
        /* ignore */
    }
};
const clone = v => {
    try {
        return v == null ? v : JSON.parse(JSON.stringify(v));
    } catch {
        return null;
    }
};
const isOnline = () => typeof navigator === "undefined" || navigator.onLine !== false;

const sleep = (ms, signal) =>
    new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(Object.assign(new Error("cancelled"), { cancelled: true }));
        const t = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(t);
            reject(Object.assign(new Error("cancelled"), { cancelled: true }));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
    });

const waitForOnline = (signal, maxMs = Infinity) =>
    new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(Object.assign(new Error("cancelled"), { cancelled: true }));
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
            reject(Object.assign(new Error("cancelled"), { cancelled: true }));
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

const friendlyError = code => {
    switch (String(code || "")) {
        case "BLOCKED":
            return "You can't send messages in this chat.";
        case "FORBIDDEN_NOT_MEMBER":
            return "You are no longer a member of this chat.";
        case "ONLY_ADMINS_CAN_MESSAGE":
            return "Only admins can send messages in this group.";
        case "INVALID_MEDIA_URL":
            return "The uploaded file was rejected. Please try again.";
        default:
            return "Could not send. Tap to retry.";
    }
};

const buildOptimistic = (job, previewUrl) => {
    const me = store.getState().auth.user;
    return {
        _id: `temp_${job.id}`,
        conversationId: job.conversationId,
        clientMsgId: job.id,
        sender: {
            _id: me?._id,
            username: me?.username,
            fullName: me?.fullName,
            avatar: me?.avatar
        },
        type: job.type,
        text: job.caption || "",
        media: {
            url: previewUrl,
            mime: job.fileType,
            fileName: job.fileName,
            bytes: job.originalSize,
            ...(job.duration > 0 ? { duration: job.duration } : {})
        },
        location: null,
        contact: null,
        replyTo: job.replyTo || null,
        status: "sent",
        optimistic: true,
        failed: false,
        uploadLocal: true,
        createdAt: new Date(job.createdAt).toISOString()
    };
};

const persist = job => dbPut({ ...job });

const setStage = (entry, stage, extra = {}) => {
    entry.stage = stage;
    Object.assign(entry, extra);
    emit();
};

const setProgress = (entry, pct, info) => {
    entry.pct = pct;
    entry.info = info;
    emit();
};

// ---------------------------------------------------------------------------
// ১টা করে কমপ্রেশন লক (CPU/GPU-তে চাপ না ফেলে স্মুথ ৩০fps ধরে রাখতে)
// ---------------------------------------------------------------------------
let compressChain = Promise.resolve();
const withCompressLock = fn => {
    const run = compressChain.then(fn, fn);
    compressChain = run.catch(() => {});
    return run;
};

// ---------------------------------------------------------------------------
// Job চালানো (Chat + Story)
// ---------------------------------------------------------------------------
const compressPhase = async (entry, signal) => {
    const { job } = entry;
    const file = job.file;
    if (!file) return null;

    return withCompressLock(async () => {
        if (entry.cancelled || signal?.aborted) {
            throw Object.assign(new Error("cancelled"), { cancelled: true });
        }
        setStage(entry, "compressing", {
            pct: 0,
            info: {
                phase: "compressing",
                file: job.file,
                name: job.fileName,
                total: job.file.size,
                originalSize: job.file.size,
                willCompress: true,
                trimming: Boolean(job.options?.trim)
            }
        });

        // ব্যাকগ্রাউন্ডে গেলেও আর abort করা হয় না — video.js নিজেই ব্যাকগ্রাউন্ডে স্মুথভাবে কমপ্রেস করে
        const ctrl = new AbortController();
        entry.compressCtrl = ctrl;
        const onOuterAbort = () => ctrl.abort();
        signal?.addEventListener("abort", onOuterAbort, { once: true });
        try {
            return await prepareMediaFile(
                file,
                (pct, info) =>
                    setProgress(entry, info?.compressPct ?? pct, {
                        file: job.file,
                        name: job.fileName,
                        trimming: Boolean(job.options?.trim),
                        ...info
                    }),
                {
                    compress: true,
                    forceCompress: Boolean(job.options?.forceCompress),
                    trim: job.options?.trim || null,
                    compressSignal: ctrl.signal
                }
            );
        } finally {
            signal?.removeEventListener("abort", onOuterAbort);
            entry.compressCtrl = null;
        }
    });
};

// চ্যাট মেসেজ পাঠানো: Socket.IO চালু থাকলে সকেট, নইলে REST POST /api/v1/messages (দুই পথেই clientMsgId ইডেম্পোটেন্ট)
const sendChatPhase = async (entry, signal) => {
    const { job } = entry;
    const wire = {
        conversationId: job.conversationId,
        clientMsgId: job.id,
        type: job.type,
        text: job.caption || "",
        media: job.media,
        location: null,
        contact: null,
        replyTo: job.replyToId || null
    };
    let hardFailures = 0;
    for (;;) {
        if (signal.aborted) throw Object.assign(new Error("cancelled"), { cancelled: true });
        if (!isOnline()) {
            setProgress(entry, 99, {
                phase: "waiting",
                waitReason: "offline",
                file: job.file,
                name: job.fileName
            });
            await waitForOnline(signal);
            await sleep(600, signal);
        }

        const s = getSocket();
        if (s && s.connected) {
            const ack = await emitWithAck("message:send", wire, 15000);
            if (ack?.ok && ack.message) {
                store.dispatch(confirmMessageSent({ clientMsgId: job.id, message: ack.message }));
                return;
            }
            if (isPermanentSendError(ack?.error)) {
                throw Object.assign(new Error(friendlyError(ack.error)), { permanent: true });
            }
            if (!ack?.retryable) {
                hardFailures += 1;
                if (hardFailures >= 6) {
                    throw Object.assign(new Error(friendlyError(ack?.error)), { permanent: true });
                }
            }
        } else {
            // Socket সংযুক্ত না থাকলেও নেট থাকলে REST দিয়ে সাথে সাথে পাঠিয়ে দেওয়া
            try {
                const res = await api.post("/api/v1/messages", wire, { timeout: 20000 });
                const msg = res.data?.data?.message || res.data?.data;
                if (msg) {
                    store.dispatch(confirmMessageSent({ clientMsgId: job.id, message: msg }));
                    return;
                }
            } catch (err) {
                const code = err?.response?.data?.error || err?.response?.data?.message;
                const status = err?.response?.status || 0;
                if (isPermanentSendError(code) || (status >= 400 && status < 500 && status !== 408 && status !== 429 && status !== 401)) {
                    throw Object.assign(new Error(friendlyError(code) || err?.response?.data?.message || "Could not send."), {
                        permanent: true
                    });
                }
                if (isOnline()) hardFailures += 1;
            }
        }

        setProgress(entry, 99, {
            phase: "waiting",
            waitReason: isOnline() ? "retry" : "offline",
            file: job.file,
            name: job.fileName
        });
        await sleep(Math.min(10000, 1200 * Math.max(1, hardFailures)), signal);
    }
};

// স্টোরি পোস্ট করা (অফলাইন/নেটওয়ার্ক এরর হলে নিজে থেকে রিট্রাই)
const sendStoryPhase = async (entry, signal) => {
    const { job } = entry;
    const payload = {
        type: job.storyType || job.type || "text",
        caption: job.caption || "",
        backgroundColor: job.backgroundColor || "#0F4C3A",
        clientStoryId: job.id
    };
    if (job.media) payload.media = job.media;

    let hardFailures = 0;
    for (;;) {
        if (signal.aborted) throw Object.assign(new Error("cancelled"), { cancelled: true });
        if (!isOnline()) {
            setProgress(entry, 99, {
                phase: "waiting",
                waitReason: "offline",
                file: job.file,
                name: job.fileName || "Story"
            });
            await waitForOnline(signal);
            await sleep(600, signal);
        }

        try {
            await api.post("/api/v1/stories", payload, { timeout: 25000 });
            store.dispatch(fetchStories());
            return;
        } catch (err) {
            const status = err?.response?.status || 0;
            const retryable =
                !err?.response || status === 408 || status === 429 || status >= 500;
            if (!retryable) {
                throw Object.assign(
                    new Error(err?.response?.data?.message || "Could not post story."),
                    { permanent: true }
                );
            }
            if (isOnline()) {
                hardFailures += 1;
                if (hardFailures >= 20) {
                    throw new Error("Could not post story. Tap to retry.");
                }
            }
            setProgress(entry, 99, {
                phase: "waiting",
                waitReason: isOnline() ? "retry" : "offline",
                file: job.file,
                name: job.fileName || "Story"
            });
            await sleep(Math.min(12000, 1500 * Math.max(1, hardFailures)), signal);
        }
    }
};

const finishSuccess = entry => {
    const { job } = entry;
    entries.delete(job.id);
    dbDelete(job.id);
    const url = entry.previewUrl;
    setTimeout(() => revoke(url), 1500);
    emit();
};

const finishFailed = (entry, err) => {
    const { job } = entry;
    const message = (err && err.message) || "Could not send. Tap to retry.";
    job.error = message;
    job.stage = "failed";
    job.retryable = !err?.permanent;
    persist(job);
    if (job.kind !== "story") {
        store.dispatch(
            markMessageFailed({
                conversationId: job.conversationId,
                clientMsgId: job.id,
                error: message
            })
        );
    }
    playSound("error");
    setStage(entry, "failed", { error: message, pct: 0, info: null });
};

const runEntry = async entry => {
    const { job } = entry;
    const ctrl = new AbortController();
    entry.ctrl = ctrl;
    entry.running = true;
    entry.error = "";
    syncAuthMeta();

    try {
        const needsUpload = Boolean(job.file) && !job.media;
        if (needsUpload) {
            let file = job.prepared || job.file;

            // কমপ্রেশন চলাকালীনই আপলোড signature আগেভাগে এনে রাখা (০ms-এ আপলোড শুরু)
            prewarmUploadSignature(job.options?.purpose || (job.kind === "story" ? "story" : "chat"));
            if (!job.prepared && !job.compressDone && job.options?.compress) {
                const out = await compressPhase(entry, ctrl.signal);
                if (entry.cancelled || ctrl.signal.aborted) {
                    throw Object.assign(new Error("cancelled"), { cancelled: true });
                }
                file = out;
                // compress হয়ে গেলে আবার করতে হয় না (retry/restart-এও)
                job.prepared = out !== job.file ? out : null;
                job.compressDone = true;
                job.chunkState = null;
                await persist(job);
            }

            setStage(entry, "uploading", {
                pct: job.chunkState?.offset && file.size
                    ? Math.floor((job.chunkState.offset / file.size) * 100)
                    : 0,
                info: {
                    phase: "uploading",
                    file: job.file,
                    name: job.fileName,
                    total: file.size,
                    originalSize: job.file.size,
                    compressedSize: file.size,
                    willCompress: Boolean(job.options?.compress)
                }
            });

            const media = await uploadPreparedFile(
                file,
                (pct, info) => setProgress(entry, pct, { file: job.file, name: job.fileName, ...info }),
                {
                    purpose: job.options?.purpose,
                    persistent: true,
                    signal: ctrl.signal,
                    initialChunkState: job.chunkState || null,
                    onChunkCommitted: chunkState => {
                        job.chunkState = chunkState;
                        persist(job);
                    }
                },
                { originalSize: job.file.size, willCompress: Boolean(job.options?.compress) }
            );
            if (!media.duration && job.duration > 0) media.duration = job.duration;
            job.media = media;
            job.chunkState = null;
            job.stage = "sending";
            await persist(job); // আপলোড হয়ে গেছে: অ্যাপ বন্ধ হলেও আবার আপলোড লাগবে না
        }

        setStage(entry, "sending", {
            pct: 100,
            info: { phase: "processing", file: job.file, name: job.fileName || "Story" }
        });

        if (job.kind === "story") {
            await sendStoryPhase(entry, ctrl.signal);
        } else {
            await sendChatPhase(entry, ctrl.signal);
        }
        finishSuccess(entry);
    } catch (err) {
        if (entry.cancelled || isCancelError(err) || err?.cancelled) {
            return;
        }
        finishFailed(entry, err);
    } finally {
        entry.ctrl = null;
        entry.running = false;
        activeWorkers = Math.max(0, activeWorkers - 1);
        emit();
        pump();
    }
};

// সর্বোচ্চ ২টি job একসাথে চলবে (যেমন ১টা বড় ভিডিও আপলোড হওয়ার পাশাপাশি ১টা ছবি/স্টোরিও চলে যাবে)
// কমপ্রেশন আলাদা লক দিয়ে ১টা করে চলে যাতে ফ্রেম ড্রপ না হয়
const MAX_CONCURRENT_JOBS = 3;
let activeWorkers = 0;

const pump = () => {
    while (activeWorkers < MAX_CONCURRENT_JOBS) {
        const next = [...entries.values()].find(e => e.stage === "queued" && !e.running);
        if (!next) break;
        activeWorkers += 1;
        next.running = true;
        runEntry(next);
    }
};

// ---------------------------------------------------------------------------
// বাইরের API
// ---------------------------------------------------------------------------
const makeEntry = (job, previewUrl) => ({
    job,
    stage: job.stage === "failed" ? "failed" : "queued",
    pct: 0,
    info: null,
    error: job.error || "",
    ctrl: null,
    compressCtrl: null,
    cancelled: false,
    running: false,
    previewUrl
});

// চ্যাটের মিডিয়া ফাইল পাঠানোর লাইনে দেওয়া। সাথে সাথে চ্যাটে প্রিভিউ বসে, বাকিটা background-এ।
export const enqueueMediaMessage = ({
    file,
    conversationId,
    caption = "",
    replyToMessage = null,
    asDocument = false,
    purpose,
    type,
    duration = 0
}) => {
    const me = store.getState().auth.user;
    const id = generateClientMsgId();
    const msgType = type || detectMessageTypeFromFile(file);
    const replyTo = replyToMessage
        ? clone({
              _id: replyToMessage._id,
              text: replyToMessage.text,
              type: replyToMessage.type,
              sender: replyToMessage.sender,
              media: replyToMessage.media,
              location: replyToMessage.location,
              contact: replyToMessage.contact
          })
        : null;

    const job = {
        id,
        kind: "chat",
        userId: String(me?._id || ""),
        conversationId: String(conversationId),
        type: msgType,
        caption: caption || "",
        replyTo,
        replyToId: replyToMessage?._id || null,
        options: {
            compress: !asDocument && (msgType === "image" || msgType === "video"),
            forceCompress: !asDocument && msgType === "video" && file.size >= SEND_ORIGINAL_MAX_BYTES,
            purpose: purpose || "chat"
        },
        file,
        fileName: file.name || "",
        fileType: file.type || "",
        originalSize: file.size,
        duration: Number(duration) > 0 ? Number(duration) : 0,
        prepared: null,
        compressDone: false,
        chunkState: null,
        media: null,
        stage: "queued",
        retryable: true,
        error: "",
        createdAt: Date.now()
    };

    const previewUrl = safeObjectUrl(file);
    const entry = makeEntry(job, previewUrl);
    entries.set(id, entry);

    store.dispatch(addOptimisticMessage(buildOptimistic(job, previewUrl)));
    playSound("send");

    syncAuthMeta();
    persist(job);
    registerBackgroundSync();
    emit();
    pump();
    return id;
};

// স্টোরি (টেক্সট / ছবি / ভিডিও) ব্যাকগ্রাউন্ড কিউতে দেওয়া।
// নিয়ম: স্টোরির ভিডিও ২৫ MB-এর বেশি হলেই কেবল স্মুথ কমপ্রেশন হবে; ২৫ MB বা কম হলে সরাসরি আপলোড।
export const enqueueStoryUpload = ({
    type = "text",
    caption = "",
    backgroundColor = "#0F4C3A",
    file = null,
    // ভিডিও স্টোরির ছাঁটা অংশ: { start, end } সেকেন্ডে (না দিলে পুরো ভিডিও)
    trim = null
}) => {
    const me = store.getState().auth.user;
    const id = generateClientMsgId();
    const detected = file ? detectMessageTypeFromFile(file) : "text";
    const storyType =
        type === "text" || !file ? "text" : detected === "video" ? "video" : "image";

    const hasTrim =
        storyType === "video" &&
        Boolean(trim) &&
        Number.isFinite(Number(trim.start)) &&
        Number.isFinite(Number(trim.end)) &&
        Number(trim.end) > Number(trim.start);
    const trimRange = hasTrim ? { start: Number(trim.start), end: Number(trim.end) } : null;

    // ছাঁটা ভিডিও সাইজ যাই হোক এনকোড হয় (ছাঁটতে এনকোড লাগে)
    const shouldCompress =
        storyType === "image"
            ? true
            : storyType === "video"
              ? hasTrim || Boolean(file && file.size > STORY_VIDEO_COMPRESS_THRESHOLD)
              : false;

    const job = {
        id,
        kind: "story",
        userId: String(me?._id || ""),
        conversationId: "",
        type: storyType,
        storyType,
        caption: String(caption || "").trim(),
        backgroundColor: backgroundColor || "#0F4C3A",
        options: {
            compress: shouldCompress,
            forceCompress: storyType === "video" && shouldCompress,
            trim: trimRange,
            purpose: "story"
        },
        duration: trimRange ? trimRange.end - trimRange.start : 0,
        file: file || null,
        fileName: file?.name || "Text Story",
        fileType: file?.type || "",
        originalSize: file?.size || 0,
        prepared: null,
        compressDone: !shouldCompress,
        chunkState: null,
        media: null,
        stage: "queued",
        retryable: true,
        error: "",
        createdAt: Date.now()
    };

    const previewUrl = safeObjectUrl(file);
    const entry = makeEntry(job, previewUrl);
    entries.set(id, entry);

    playSound("send");
    syncAuthMeta();
    persist(job);
    registerBackgroundSync();
    emit();
    pump();
    return id;
};

export const retryUpload = id => {
    const entry = entries.get(id);
    if (!entry || entry.stage !== "failed") return;
    entry.cancelled = false;
    entry.job.error = "";
    entry.job.stage = entry.job.media ? "sending" : "queued";
    syncAuthMeta();
    persist(entry.job);
    registerBackgroundSync();
    if (entry.job.kind !== "story") {
        store.dispatch(
            markMessageRetrying({
                conversationId: entry.job.conversationId,
                clientMsgId: id
            })
        );
    }
    setStage(entry, "queued", { error: "", pct: 0, info: null });
    pump();
};

export const cancelUpload = id => {
    const entry = entries.get(id);
    if (!entry) return;
    entry.cancelled = true;
    try {
        entry.compressCtrl?.abort();
        entry.ctrl?.abort();
    } catch {
        /* ignore */
    }
    entries.delete(id);
    dbDelete(id);
    revoke(entry.previewUrl);
    if (entry.job.kind !== "story") {
        store.dispatch(
            removeLocalMessage({
                conversationId: entry.job.conversationId,
                clientMsgId: id
            })
        );
    }
    emit();
};

// চ্যাটের ভিডিও compress চলাকালীন "Send original":
// কঠোর নিয়ম — ভিডিও ২৫ MB-এর কম হলেই কেবল compress বাদ দিয়ে আসল ফাইল আপলোড করা যাবে।
export const skipCompression = id => {
    const entry = entries.get(id);
    if (!entry?.compressCtrl) return;
    if (entry.job.kind === "story") return;
    if (Number(entry.job.originalSize || 0) >= SEND_ORIGINAL_MAX_BYTES) return;
    entry.compressCtrl.abort();
};

// অ্যাপ চালুর সময় (লগইন করা অবস্থায়): আগের অসমাপ্ত চ্যাট ও স্টোরি আপলোড আবার চালু
let started = false;
export const startOutbox = async () => {
    const me = store.getState().auth.user;
    if (!me?._id || started) return;
    started = true;
    syncAuthMeta();
    prewarmUploadSignature("chat");
    prewarmUploadSignature("story");

    try {
        navigator.storage?.persist?.();
    } catch {
        /* ignore */
    }

    const saved = await dbAll();
    for (const job of saved) {
        if (!job?.id) continue;
        // টেক্সট স্টোরি বাদে বাকি সব job-এ file বা media থাকতে হবে
        const isTextStory = job.kind === "story" && job.storyType === "text";
        if (!isTextStory && !job.file && !job.media) {
            dbDelete(job.id);
            continue;
        }
        // অন্য ইউজারের (আগের লগইন) job মুছে ফেলা
        if (String(job.userId) !== String(me._id)) {
            dbDelete(job.id);
            continue;
        }
        if (entries.has(job.id)) continue;

        const previewUrl = safeObjectUrl(job.file);
        const entry = makeEntry(job, previewUrl);
        entries.set(job.id, entry);

        if (job.kind !== "story") {
            store.dispatch(addOptimisticMessage(buildOptimistic(job, previewUrl)));
            if (entry.stage === "failed") {
                store.dispatch(
                    markMessageFailed({
                        conversationId: job.conversationId,
                        clientMsgId: job.id,
                        error: job.error || "SEND_FAILED"
                    })
                );
            }
        }
    }
    emit();
    pump();
};

// লগআউটে সব বাতিল ও মুছে ফেলা (অন্য ইউজারের ফাইল/টোকেন যেন না থাকে)
export const resetOutbox = async () => {
    started = false;
    for (const entry of entries.values()) {
        entry.cancelled = true;
        try {
            entry.compressCtrl?.abort();
            entry.ctrl?.abort();
        } catch {
            /* ignore */
        }
        revoke(entry.previewUrl);
    }
    entries.clear();
    clearSignatureCache();
    await Promise.all([dbClearJobs(), dbClearMeta()]);
    emit();
};

export const hasActiveUploads = () => [...entries.values()].some(e => ACTIVE_STAGES.has(e.stage));

// নেট ফিরলে / অ্যাপ সামনে এলে / ট্যাব বন্ধ হলে ব্যাকগ্রাউন্ড সিঙ্ক ও রিট্রাই
if (typeof window !== "undefined") {
    const nudge = () => {
        syncAuthMeta();
        // নেট ফিরলে সাময়িক কারণে ব্যর্থ হওয়া job-গুলোও নিজে থেকে আবার চেষ্টা করবে
        if (isOnline()) {
            let revived = false;
            for (const entry of entries.values()) {
                if (entry.stage === "failed" && entry.job.retryable !== false) {
                    entry.job.error = "";
                    entry.job.stage = entry.job.media ? "sending" : "queued";
                    persist(entry.job);
                    if (entry.job.kind !== "story") {
                        store.dispatch(
                            markMessageRetrying({
                                conversationId: entry.job.conversationId,
                                clientMsgId: entry.job.id
                            })
                        );
                    }
                    entry.stage = "queued";
                    entry.error = "";
                    revived = true;
                }
            }
            if (revived) emit();
        }
        if (entries.size) pump();
    };

    window.addEventListener("online", nudge);
    window.addEventListener("sync:socket-connect", nudge);
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") nudge();
    });

    // ইউজার ট্যাব কেটে দিলে বা পেজ ছাড়লে Service Worker-কে ব্যাকগ্রাউন্ডে কাজ শেষ করতে বলা
    const onPageExit = () => {
        if (!hasActiveUploads()) return;
        syncAuthMeta();
        registerBackgroundSync();
        notifySwBackgroundTakeover();
    };
    window.addEventListener("pagehide", onPageExit);
    window.addEventListener("beforeunload", onPageExit);

    // Service Worker ব্যাকগ্রাউন্ডে কোনো job শেষ করলে UI সাথে সাথে আপডেট করা
    if ("serviceWorker" in navigator) {
        navigator.serviceWorker.addEventListener("message", event => {
            const msg = event.data;
            if (!msg || msg.type !== "SYNC_OUTBOX_DONE" || !msg.id) return;
            const entry = entries.get(msg.id);
            if (entry) {
                entry.cancelled = true;
                try {
                    entry.compressCtrl?.abort();
                    entry.ctrl?.abort();
                } catch {
                    /* ignore */
                }
                entries.delete(msg.id);
                revoke(entry.previewUrl);
                emit();
            }
            if (msg.kind === "story") {
                store.dispatch(fetchStories());
            } else if (msg.message) {
                store.dispatch(
                    confirmMessageSent({ clientMsgId: msg.id, message: msg.message })
                );
            }
        });
    }
}
