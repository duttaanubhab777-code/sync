// চ্যাটের ছবি/ভিডিও/ফাইল/ভয়েস পাঠানোর background queue ("outbox")।
//
// আগে আপলোড ChatPage-এর ভেতরে চলত: চ্যাট ছেড়ে গেলে, অ্যাপ ব্যাকগ্রাউন্ডে গেলে বা নেট কেটে গেলে
// আপলোড ব্যর্থ হতো। এখন:
//   - ফাইল বাছাই করলেই চ্যাটে মেসেজ (প্রিভিউ সহ) বসে যায়, ইউজার চাইলে অন্য কাজ/চ্যাটে চলে যেতে পারে
//   - আপলোড ও পাঠানো পেজের বাইরে (এই module-এ) চলে, তাই পেজ বদলালেও থামে না
//   - নেট গেলে error না দেখিয়ে অপেক্ষা করে, নেট এলে নিজে থেকে বাকিটা চালায় (media.js-এ resume/retry)
//   - ফাইল ও অবস্থা IndexedDB-তে রাখা হয়: অ্যাপ বন্ধ/ক্র্যাশ হলেও পরের বার খুললে নিজে থেকে চলতে থাকে
//   - Android অ্যাপে আপলোড চলাকালীন foreground service চালু থাকে, যাতে অ্যাপ minimize করলেও OS মেরে না ফেলে
//   - সার্ভার clientMsgId দিয়ে duplicate আটকায়, তাই আবার পাঠালেও একই মেসেজ দুবার যায় না
import { store } from "../store/index.js";
import {
    addOptimisticMessage,
    confirmMessageSent,
    markMessageFailed,
    markMessageRetrying,
    removeLocalMessage
} from "../store/chatSlice.js";
import {
    detectMessageTypeFromFile,
    isCancelError,
    MAX_VIDEO_BYTES,
    prepareMediaFile,
    uploadPreparedFile
} from "./media.js";
import { emitWithAck, getSocket, isPermanentSendError } from "./socket.js";
import { playSound } from "./sounds.js";
import { generateClientMsgId } from "../utils/format.js";

// ---------------------------------------------------------------------------
// IndexedDB (ফাইল সহ job রাখার জায়গা)। না পেলে শুধু মেমোরিতে চলে, কিছু ভাঙে না।
// ---------------------------------------------------------------------------
const DB_NAME = "sync-outbox";
const STORE = "jobs";
let dbPromise = null;

const openDb = () => {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(resolve => {
        try {
            if (typeof indexedDB === "undefined") return resolve(null);
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = () => {
                if (!req.result.objectStoreNames.contains(STORE)) {
                    req.result.createObjectStore(STORE, { keyPath: "id" });
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

const withStore = async (mode, run) => {
    try {
        const db = await openDb();
        if (!db) return null;
        return await new Promise(resolve => {
            let result = null;
            const tx = db.transaction(STORE, mode);
            const os = tx.objectStore(STORE);
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

const dbPut = job => withStore("readwrite", os => os.put(job));
const dbDelete = id => withStore("readwrite", os => os.delete(id));
const dbAll = async () => (await withStore("readonly", os => os.getAll())) || [];
const dbClear = () => withStore("readwrite", os => os.clear());

// ---------------------------------------------------------------------------
// অবস্থা (UI-র জন্য useSyncExternalStore)
// ---------------------------------------------------------------------------
// entry = { job, stage, pct, info, error, ctrl, compressCtrl, cancelled, previewUrl }
// stage: "queued" | "compressing" | "uploading" | "sending" | "failed"
const entries = new Map();
let snapshot = [];
const listeners = new Set();
let lastKeepAlive = null;

const toView = e => ({
    id: e.job.id,
    conversationId: e.job.conversationId,
    stage: e.stage,
    pct: e.pct,
    info: e.info,
    error: e.error,
    name: e.job.fileName,
    size: e.job.originalSize,
    file: e.job.file
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
// Android: আপলোড চলাকালীন foreground service (native bridge থাকলে)
// ---------------------------------------------------------------------------
const ACTIVE_STAGES = new Set(["queued", "compressing", "uploading", "sending"]);

function updateKeepAlive() {
    const active = [...entries.values()].filter(e => ACTIVE_STAGES.has(e.stage));
    const key = active.length ? `on:${active.length}` : "off";
    if (key === lastKeepAlive) return;
    lastKeepAlive = key;
    try {
        const bridge = typeof window !== "undefined" ? window.SyncNativeNotif : null;
        if (bridge && typeof bridge.setUploadActive === "function") {
            bridge.setUploadActive(
                active.length > 0,
                active.length === 1 ? "Sending 1 file…" : `Sending ${active.length} files…`
            );
        }
    } catch {
        /* native bridge না থাকলে/ব্যর্থ হলে সমস্যা নেই */
    }
}

// ---------------------------------------------------------------------------
// ছোট সহায়ক
// ---------------------------------------------------------------------------
const safeObjectUrl = blob => {
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
        // আপলোড শেষ হওয়া পর্যন্ত ফোনের ফাইল থেকেই প্রিভিউ দেখানো হয়
        media: {
            url: previewUrl,
            mime: job.fileType,
            fileName: job.fileName,
            bytes: job.originalSize
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

const persist = job => {
    // Blob সহ পুরো job; ব্যর্থ হলে (কোটা ভরা ইত্যাদি) চুপচাপ মেমোরির উপর ভরসা
    return dbPut({ ...job });
};

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
// Job চালানো
// ---------------------------------------------------------------------------
const waitForSocket = async signal => {
    for (;;) {
        const s = getSocket();
        if (s && s.connected) return;
        if (signal?.aborted) throw Object.assign(new Error("cancelled"), { cancelled: true });
        if (s && !s.connected && navigator.onLine !== false) {
            try {
                s.connect();
            } catch {
                /* ignore */
            }
        }
        await new Promise((resolve, reject) => {
            const done = () => {
                clearTimeout(t);
                window.removeEventListener("sync:socket-connect", done);
                window.removeEventListener("online", done);
                signal?.removeEventListener("abort", onAbort);
                resolve();
            };
            const onAbort = () => {
                clearTimeout(t);
                window.removeEventListener("sync:socket-connect", done);
                window.removeEventListener("online", done);
                reject(Object.assign(new Error("cancelled"), { cancelled: true }));
            };
            const t = setTimeout(done, 3000);
            window.addEventListener("sync:socket-connect", done);
            window.addEventListener("online", done);
            signal?.addEventListener("abort", onAbort, { once: true });
        });
    }
};

const compressPhase = async entry => {
    const { job } = entry;
    const file = job.file;
    const kind = detectMessageTypeFromFile(file);

    // ভিডিও compress ভিডিও চালিয়ে করতে হয়, ব্যাকগ্রাউন্ডে সেটা চলে না।
    // তাই অ্যাপ ব্যাকগ্রাউন্ডে গেলে compress বাদ দিয়ে আসল ফাইলই আপলোড হয় (ইউজারকে অপেক্ষা করতে হয় না)।
    const canSkipInBackground = kind === "video" && file.size <= MAX_VIDEO_BYTES;
    if (canSkipInBackground && document.hidden) return file;

    const ctrl = new AbortController();
    entry.compressCtrl = ctrl;
    const onVisibility = () => {
        if (document.hidden && canSkipInBackground) ctrl.abort();
    };
    document.addEventListener("visibilitychange", onVisibility);
    try {
        return await prepareMediaFile(
            file,
            (pct, info) => setProgress(entry, pct, { file, name: job.fileName, ...info }),
            { compress: true, compressSignal: ctrl.signal }
        );
    } finally {
        document.removeEventListener("visibilitychange", onVisibility);
        entry.compressCtrl = null;
    }
};

const sendPhase = async (entry, signal) => {
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
        await waitForSocket(signal);
        const ack = await emitWithAck("message:send", wire, 20000);
        if (ack?.ok && ack.message) {
            store.dispatch(confirmMessageSent({ clientMsgId: job.id, message: ack.message }));
            return;
        }
        if (isPermanentSendError(ack?.error)) {
            throw new Error(friendlyError(ack.error));
        }
        if (!ack?.retryable) {
            hardFailures += 1;
            if (hardFailures >= 6) throw new Error(friendlyError(ack?.error));
        }
        await sleep(ack?.error === "RATE_LIMITED" ? 3000 : Math.min(8000, 1000 * (hardFailures + 1)), signal);
    }
};

const finishSuccess = entry => {
    const { job } = entry;
    entries.delete(job.id);
    dbDelete(job.id);
    // সার্ভারের মেসেজ বসে গেছে; একটু পরে লোকাল প্রিভিউ ছাড়া
    const url = entry.previewUrl;
    setTimeout(() => revoke(url), 1500);
    emit();
};

const finishFailed = (entry, err) => {
    const { job } = entry;
    const message =
        (err && err.message) || "Could not send. Tap to retry.";
    job.error = message;
    job.stage = "failed";
    persist(job);
    store.dispatch(
        markMessageFailed({
            conversationId: job.conversationId,
            clientMsgId: job.id,
            error: message
        })
    );
    playSound("error");
    setStage(entry, "failed", { error: message, pct: 0, info: null });
};

const runEntry = async entry => {
    const { job } = entry;
    const ctrl = new AbortController();
    entry.ctrl = ctrl;
    entry.error = "";
    try {
        if (!job.media) {
            let file = job.prepared || job.file;

            if (!job.prepared && !job.compressDone && job.options?.compress) {
                setStage(entry, "compressing", { pct: 0, info: { phase: "compressing", file: job.file, name: job.fileName, total: job.file.size } });
                const out = await compressPhase(entry);
                if (entry.cancelled) throw Object.assign(new Error("cancelled"), { cancelled: true });
                file = out;
                // compress হয়ে গেলে আবার করতে হয় না (retry/restart-এও)
                job.prepared = out !== job.file ? out : null;
                job.compressDone = true;
                await persist(job);
            }

            setStage(entry, "uploading", { pct: 0, info: { phase: "uploading", file: job.file, name: job.fileName, total: file.size } });
            const media = await uploadPreparedFile(
                file,
                (pct, info) => setProgress(entry, pct, { file: job.file, name: job.fileName, ...info }),
                { purpose: job.options?.purpose, persistent: true, signal: ctrl.signal },
                { originalSize: job.file.size, willCompress: Boolean(job.options?.compress) }
            );
            job.media = media;
            job.stage = "sending";
            await persist(job); // আপলোড হয়ে গেছে: অ্যাপ বন্ধ হলেও আবার আপলোড লাগবে না
        }

        setStage(entry, "sending", { pct: 100, info: { phase: "done", file: job.file, name: job.fileName } });
        await sendPhase(entry, ctrl.signal);
        finishSuccess(entry);
    } catch (err) {
        if (entry.cancelled || isCancelError(err) || err?.cancelled) {
            if (entry.cancelled) return; // cancel নিজেই সব পরিষ্কার করেছে
            // অন্য কারণে abort (যেমন logout): কিছু করার নেই
            return;
        }
        finishFailed(entry, err);
    } finally {
        entry.ctrl = null;
    }
};

let running = false;
const pump = async () => {
    if (running) return;
    running = true;
    try {
        for (;;) {
            const next = [...entries.values()].find(e => e.stage === "queued");
            if (!next) break;
            await runEntry(next);
        }
    } finally {
        running = false;
        emit();
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
    previewUrl
});

// ফাইলটা পাঠানোর লাইনে দেওয়া। সাথে সাথে চ্যাটে মেসেজ (প্রিভিউ সহ) বসে, বাকিটা background-এ।
export const enqueueMediaMessage = ({
    file,
    conversationId,
    caption = "",
    replyToMessage = null,
    asDocument = false,
    purpose,
    type
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
        userId: String(me?._id || ""),
        conversationId: String(conversationId),
        type: msgType,
        caption: caption || "",
        replyTo,
        replyToId: replyToMessage?._id || null,
        options: {
            compress: !asDocument && (msgType === "image" || msgType === "video"),
            purpose
        },
        file,
        fileName: file.name || "",
        fileType: file.type || "",
        originalSize: file.size,
        prepared: null,
        compressDone: false,
        media: null,
        stage: "queued",
        error: "",
        createdAt: Date.now()
    };

    const previewUrl = safeObjectUrl(file);
    const entry = makeEntry(job, previewUrl);
    entries.set(id, entry);

    store.dispatch(addOptimisticMessage(buildOptimistic(job, previewUrl)));
    playSound("send");

    persist(job);
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
    persist(entry.job);
    store.dispatch(
        markMessageRetrying({
            conversationId: entry.job.conversationId,
            clientMsgId: id
        })
    );
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
    store.dispatch(
        removeLocalMessage({
            conversationId: entry.job.conversationId,
            clientMsgId: id
        })
    );
    emit();
};

// ভিডিও compress চলাকালীন "Send original": compress থামিয়ে আসল ফাইল আপলোড
export const skipCompression = id => {
    const entry = entries.get(id);
    if (entry?.compressCtrl) entry.compressCtrl.abort();
};

// অ্যাপ চালুর সময় (লগইন করা অবস্থায়): আগের অসমাপ্ত আপলোড আবার চালু
let started = false;
export const startOutbox = async () => {
    const me = store.getState().auth.user;
    if (!me?._id || started) return;
    started = true;

    try {
        // ব্রাউজারকে বলা: এই ডেটা নিজে থেকে মুছো না (সমর্থন থাকলে)
        navigator.storage?.persist?.();
    } catch {
        /* ignore */
    }

    const saved = await dbAll();
    for (const job of saved) {
        if (!job?.id || !job.file) {
            if (job?.id) dbDelete(job.id);
            continue;
        }
        // অন্য ইউজারের (আগের লগইন) job আর এই ইউজারের চ্যাটে নয়
        if (String(job.userId) !== String(me._id)) {
            dbDelete(job.id);
            continue;
        }
        if (entries.has(job.id)) continue;

        const previewUrl = safeObjectUrl(job.file);
        const entry = makeEntry(job, previewUrl);
        entries.set(job.id, entry);
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
    emit();
    pump();
};

// লগআউটে সব বাতিল ও মুছে ফেলা (অন্য ইউজারের ফাইল যেন না যায়)
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
    await dbClear();
    emit();
};

export const hasActiveUploads = () => [...entries.values()].some(e => ACTIVE_STAGES.has(e.stage));

// অ্যাপ সামনে এলে/নেট ফিরলে আটকে থাকা queue আবার ঠেলে দেওয়া
if (typeof window !== "undefined") {
    const nudge = () => {
        if (entries.size) pump();
    };
    window.addEventListener("online", nudge);
    window.addEventListener("sync:socket-connect", nudge);
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") nudge();
    });
}
