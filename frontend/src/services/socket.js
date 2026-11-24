import { io } from "socket.io-client";
import { getStoredToken, refreshAccessToken } from "./api.js";
import { store } from "../store/index.js";
import { playSound } from "./sounds.js";
import { updateUserRole } from "../store/authSlice.js";
import {
    addOptimisticMessage,
    applyConversationRead,
    applyMessageDeleted,
    applyStatusBulk,
    confirmMessageSent,
    dequeuePendingMessage,
    enqueuePendingMessage,
    fetchConversations,
    hydratePendingQueue,
    markMessageFailed,
    receiveNewMessage,
    removeConversation,
    setPresenceSnapshot,
    setPresenceUpdate,
    setSocketStatus,
    setTypingStatus,
    syncMissedMessages,
    upsertConversation
} from "../store/chatSlice.js";
import { handleWallpaperChanged } from "./wallpaper.js";
import {
    fetchStories,
    recordRealtimeStoryView,
    recordRealtimeStoryReaction
} from "../store/storySlice.js";

let socket = null;
const typingTimers = new Map();

export const getSocket = () => socket;

// ---- অফলাইনে পাঠানো মেসেজের queue ডিভাইসে রাখা (অ্যাপ বন্ধ/রিলোড হলেও হারাবে না) ----
const PENDING_KEY = "sync_pending_queue_v1";

const persistPendingQueue = () => {
    try {
        const state = store.getState();
        const userId = state.auth.user?._id;
        const queue = state.chat.pendingQueue || [];
        if (!userId || queue.length === 0) {
            localStorage.removeItem(PENDING_KEY);
            return;
        }
        localStorage.setItem(PENDING_KEY, JSON.stringify({ userId, queue }));
    } catch {
        /* storage ভরা/বন্ধ: মেমোরির queue দিয়েই চলবে */
    }
};

export const clearPersistedPendingQueue = () => {
    try {
        localStorage.removeItem(PENDING_KEY);
    } catch {
        /* ignore */
    }
};

const loadPersistedPendingQueue = () => {
    try {
        const raw = localStorage.getItem(PENDING_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);
        const userId = store.getState().auth.user?._id;
        if (!userId || String(data?.userId) !== String(userId)) return;
        if (Array.isArray(data.queue) && data.queue.length > 0) {
            store.dispatch(hydratePendingQueue(data.queue));
        }
    } catch {
        /* নষ্ট ডেটা উপেক্ষা */
    }
};

// ack-এর জন্য সময়সীমা সহ emit: নেট মাঝপথে গেলে ack কখনো আসত না, মেসেজ চিরকাল "sending" থাকত
export const emitWithAck = (event, payload, timeoutMs = 20000) =>
    new Promise(resolve => {
        if (!socket || !socket.connected) {
            return resolve({ ok: false, error: "OFFLINE", retryable: true });
        }
        socket.timeout(timeoutMs).emit(event, payload, (err, ack) => {
            if (err) return resolve({ ok: false, error: "TIMEOUT", retryable: true });
            resolve(ack || { ok: false, error: "NO_ACK", retryable: true });
        });
    });

// সার্ভার যে ব্যর্থতায় আবার চেষ্টা করা অর্থহীন (যেমন ব্লক, সদস্য নয়, ভুল ডেটা)
const PERMANENT_SEND_ERRORS = new Set([
    "INVALID_PAYLOAD",
    "FORBIDDEN_NOT_MEMBER",
    "ONLY_ADMINS_CAN_MESSAGE",
    "BLOCKED",
    "EMPTY_MESSAGE",
    "INVALID_LOCATION",
    "INVALID_CONTACT",
    "INVALID_MEDIA_URL",
    "MESSAGE_TOO_LONG",
    "INVALID_REPLY"
]);
export const isPermanentSendError = code => PERMANENT_SEND_ERRORS.has(String(code || ""));

let networkListenersAttached = false;
// নেট ফিরলে বা অ্যাপ সামনে এলে অপেক্ষা না করে সাথে সাথে socket জোড়া লাগানো
const attachNetworkListeners = () => {
    if (networkListenersAttached) return;
    networkListenersAttached = true;
    const reconnectNow = () => {
        if (socket && !socket.connected) {
            socket.auth = { token: getStoredToken() };
            socket.connect();
        }
    };
    window.addEventListener("online", reconnectNow);
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") reconnectNow();
    });
};

export const connectSocket = () => {
    const token = getStoredToken();
    if (!token) return null;

    if (socket) {
        socket.auth = { token };
        if (!socket.connected) socket.connect();
        return socket;
    }

    const baseUrl = (import.meta.env.VITE_API_BASE_URL || "").replace(
        /\/+$/,
        ""
    );

    socket = io(baseUrl || undefined, {
        auth: { token },
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: Infinity,
        timeout: 15000
    });

    loadPersistedPendingQueue();
    attachNetworkListeners();

    socket.on("connect", () => {
        store.dispatch(setSocketStatus({ connected: true, reconnecting: false }));
        store.dispatch(syncMissedMessages());
        flushPendingQueue();
        window.dispatchEvent(new CustomEvent("sync:socket-connect"));
    });

    socket.on("disconnect", () => {
        store.dispatch(setSocketStatus({ connected: false, reconnecting: true }));
    });

    socket.on("connect_error", async err => {
        store.dispatch(setSocketStatus({ connected: false, reconnecting: true }));
        if (err?.message === "UNAUTHORIZED") {
            try {
                const freshToken = await refreshAccessToken();
                if (socket && freshToken) {
                    socket.auth = { token: freshToken };
                    socket.connect();
                }
            } catch {
                // refresh failure triggers sync:unauthorized
            }
        }
    });

    socket.on("message:new", payload => {
        const { message, conversationId } = payload || {};
        if (!message) return;

        const state = store.getState();
        const myId = state.auth.user?._id;
        const activeConvId = state.chat.activeConversationId;

        const convExists = state.chat.conversations.some(
            c => String(c._id) === String(conversationId || message.conversationId)
        );
        if (!convExists) {
            store.dispatch(fetchConversations());
        }

        store.dispatch(
            receiveNewMessage({
                message,
                conversationId: conversationId || message.conversationId,
                currentUserId: myId
            })
        );

        const senderId = String(message.sender?._id ?? message.sender);
        if (myId && senderId !== String(myId)) {
            const cId = String(conversationId || message.conversationId);
            if (activeConvId === cId && document.visibilityState === "visible") {
                playSound("receive");
                emitMessageSeen(cId, message._id);
            } else {
                playSound("notify");
                socket.emit("message:delivered", { messageId: message._id });
            }
        }
    });

    socket.on("message:deleted", payload => {
        if (!payload?.messageId) return;
        store.dispatch(applyMessageDeleted(payload));
    });

    socket.on("message:status_bulk", payload => {
        if (!payload?.conversationId) return;
        store.dispatch(applyStatusBulk(payload));
    });

    socket.on("conversation:read", payload => {
        if (!payload?.conversationId) return;
        store.dispatch(applyConversationRead(payload));
    });

    socket.on("conversation:new", payload => {
        if (!payload?.conversation) return;
        const myId = store.getState().auth.user?._id;
        store.dispatch(
            upsertConversation({
                conversation: payload.conversation,
                currentUserId: myId
            })
        );
    });

    socket.on("conversation:updated", payload => {
        if (!payload?.conversation) return;
        const myId = store.getState().auth.user?._id;
        store.dispatch(
            upsertConversation({
                conversation: payload.conversation,
                currentUserId: myId
            })
        );
    });

    socket.on("conversation:removed", payload => {
        if (!payload?.conversationId) return;
        store.dispatch(removeConversation(payload));
    });

    socket.on("typing", payload => {
        const { conversationId, userId, fullName, isTyping, activity } =
            payload || {};
        if (!conversationId || !userId) return;
        store.dispatch(
            setTypingStatus({
                conversationId,
                userId,
                fullName,
                isTyping,
                activity
            })
        );

        const timerKey = `${conversationId}:${userId}`;
        if (typingTimers.has(timerKey)) {
            clearTimeout(typingTimers.get(timerKey));
            typingTimers.delete(timerKey);
        }
        if (isTyping) {
            const t = setTimeout(() => {
                store.dispatch(
                    setTypingStatus({
                        conversationId,
                        userId,
                        fullName,
                        isTyping: false,
                        activity
                    })
                );
                typingTimers.delete(timerKey);
            }, 4500);
            typingTimers.set(timerKey, t);
        }
    });

    socket.on("presence:snapshot", payload => {
        store.dispatch(setPresenceSnapshot(payload));
    });

    socket.on("presence:update", payload => {
        store.dispatch(setPresenceUpdate(payload));
    });

    socket.on("story:new", () => {
        store.dispatch(fetchStories());
    });

    socket.on("story:deleted", () => {
        store.dispatch(fetchStories());
    });

    socket.on("story:viewed", payload => {
        store.dispatch(recordRealtimeStoryView(payload));
    });

    socket.on("story:reacted", payload => {
        store.dispatch(recordRealtimeStoryReaction(payload));
        if (payload?.emoji) playSound("notify");
    });

    // রিয়েল-টাইমে নতুন নোটিস বা ডিলিট হওয়া নোটিস
    socket.on("notice:new", payload => {
        if (!payload?.notice) return;
        window.dispatchEvent(
            new CustomEvent("sync:notice-new", { detail: payload.notice })
        );
    });

    socket.on("notice:removed", payload => {
        if (!payload?.noticeId) return;
        window.dispatchEvent(
            new CustomEvent("sync:notice-removed", { detail: payload.noticeId })
        );
    });

    // admin wallpaper যোগ/default/মোছা করলে সবার তালিকা নিজে থেকে নতুন হয়
    socket.on("wallpaper:changed", () => handleWallpaperChanged());

    // রিয়েল-টাইমে রোল আপডেট বা ব্লক হলে সাথে সাথে কার্যকর
    socket.on("user:role_updated", payload => {
        if (!payload) return;
        store.dispatch(updateUserRole(payload));
    });

    socket.on("user:blocked", () => {
        window.dispatchEvent(new CustomEvent("sync:unauthorized"));
    });

    return socket;
};

export const disconnectSocket = () => {
    if (socket) {
        socket.removeAllListeners();
        socket.disconnect();
        socket = null;
    }
    store.dispatch(setSocketStatus({ connected: false, reconnecting: false }));
};

export const sendSocketMessage = payload => {
    const {
        conversationId,
        clientMsgId,
        type = "text",
        text = "",
        media = null,
        location = null,
        contact = null,
        replyToMessage = null
    } = payload;

    const state = store.getState();
    const me = state.auth.user;

    const optimisticMsg = {
        _id: `temp_${clientMsgId}`,
        conversationId,
        clientMsgId,
        sender: {
            _id: me?._id,
            username: me?.username,
            fullName: me?.fullName,
            avatar: me?.avatar
        },
        type,
        text,
        media,
        location,
        contact,
        replyTo: replyToMessage
            ? {
                  _id: replyToMessage._id,
                  text: replyToMessage.text,
                  type: replyToMessage.type,
                  sender: replyToMessage.sender,
                  media: replyToMessage.media,
                  location: replyToMessage.location,
                  contact: replyToMessage.contact
              }
            : null,
        status: "sent",
        optimistic: true,
        failed: false,
        createdAt: new Date().toISOString()
    };

    store.dispatch(addOptimisticMessage(optimisticMsg));
    playSound("send");

    const wirePayload = {
        conversationId,
        clientMsgId,
        type,
        text,
        media,
        location,
        contact,
        replyTo: replyToMessage?._id || null
    };

    const queueForLater = () => {
        store.dispatch(enqueuePendingMessage(wirePayload));
        persistPendingQueue();
        return { ok: false, queued: true };
    };

    if (!socket || !socket.connected) {
        return Promise.resolve(queueForLater());
    }

    return emitWithAck("message:send", wirePayload).then(ack => {
        if (ack?.ok && ack.message) {
            store.dispatch(confirmMessageSent({ clientMsgId, message: ack.message }));
            store.dispatch(dequeuePendingMessage(clientMsgId));
            persistPendingQueue();
            return ack;
        }
        // নেট সমস্যা/টাইমআউট: ব্যর্থ না দেখিয়ে queue-তে রাখা, নেট এলে নিজে যাবে
        if (ack?.retryable || !isPermanentSendError(ack?.error)) {
            return queueForLater();
        }
        store.dispatch(
            markMessageFailed({
                conversationId,
                clientMsgId,
                error: ack?.error || "SEND_ERROR"
            })
        );
        playSound("error");
        return ack;
    });
};

let flushing = false;
export const flushPendingQueue = async () => {
    if (flushing || !socket || !socket.connected) return;
    flushing = true;
    try {
        const queue = [...(store.getState().chat.pendingQueue || [])];
        for (const item of queue) {
            if (!socket || !socket.connected) break;
            const ack = await emitWithAck("message:send", item);
            if (ack?.ok && ack.message) {
                store.dispatch(
                    confirmMessageSent({
                        clientMsgId: item.clientMsgId,
                        message: ack.message
                    })
                );
                store.dispatch(dequeuePendingMessage(item.clientMsgId));
            } else if (!ack?.retryable && isPermanentSendError(ack?.error)) {
                store.dispatch(
                    markMessageFailed({
                        conversationId: item.conversationId,
                        clientMsgId: item.clientMsgId,
                        error: ack?.error || "SEND_ERROR"
                    })
                );
                store.dispatch(dequeuePendingMessage(item.clientMsgId));
            } else if (ack?.retryable) {
                break; // নেট আবার গেছে; পরের বার connect হলে আবার চলবে
            }
        }
    } finally {
        flushing = false;
        persistPendingQueue();
    }
};

export const deleteSocketMessage = messageId => {
    return new Promise(resolve => {
        if (!socket || !socket.connected) {
            return resolve({ ok: false, error: "OFFLINE" });
        }
        socket.emit("message:delete", { messageId }, ack => {
            resolve(ack || { ok: false });
        });
    });
};

export const emitMessageSeen = (conversationId, upToMessageId = null) => {
    if (!conversationId) return;
    store.dispatch(applyConversationRead({ conversationId }));
    if (socket && socket.connected) {
        socket.emit("message:seen", { conversationId, upToMessageId });
    }
};

// activity: "typing" (লেখা হচ্ছে) অথবা "recording" (ভয়েস রেকর্ড হচ্ছে)
export const emitTypingStart = (conversationId, activity = "typing") => {
    if (socket && socket.connected && conversationId) {
        socket.emit("typing:start", { conversationId, activity });
    }
};

export const emitTypingStop = conversationId => {
    if (socket && socket.connected && conversationId) {
        socket.emit("typing:stop", { conversationId });
    }
};
