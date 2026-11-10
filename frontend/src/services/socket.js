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
import {
    fetchStories,
    recordRealtimeStoryView
} from "../store/storySlice.js";

let socket = null;
const typingTimers = new Map();

export const getSocket = () => socket;

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
        reconnectionDelayMax: 5000
    });

    socket.on("connect", () => {
        store.dispatch(setSocketStatus({ connected: true, reconnecting: false }));
        store.dispatch(syncMissedMessages());
        flushPendingQueue();
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
        const { conversationId, userId, fullName, isTyping } = payload || {};
        if (!conversationId || !userId) return;
        store.dispatch(
            setTypingStatus({ conversationId, userId, fullName, isTyping })
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
                        isTyping: false
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
        replyTo: replyToMessage
            ? {
                  _id: replyToMessage._id,
                  text: replyToMessage.text,
                  type: replyToMessage.type,
                  sender: replyToMessage.sender,
                  media: replyToMessage.media
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
        replyTo: replyToMessage?._id || null
    };

    if (!socket || !socket.connected) {
        store.dispatch(enqueuePendingMessage(wirePayload));
        return Promise.resolve({ ok: false, queued: true });
    }

    return new Promise(resolve => {
        socket.emit("message:send", wirePayload, ack => {
            if (ack?.ok && ack.message) {
                store.dispatch(
                    confirmMessageSent({
                        clientMsgId,
                        message: ack.message
                    })
                );
                store.dispatch(dequeuePendingMessage(clientMsgId));
                resolve(ack);
            } else {
                store.dispatch(
                    markMessageFailed({
                        conversationId,
                        clientMsgId,
                        error: ack?.error || "SEND_ERROR"
                    })
                );
                playSound("error");
                resolve(ack || { ok: false, error: "SEND_ERROR" });
            }
        });
    });
};

export const flushPendingQueue = () => {
    if (!socket || !socket.connected) return;
    const queue = store.getState().chat.pendingQueue || [];
    for (const item of queue) {
        socket.emit("message:send", item, ack => {
            if (ack?.ok && ack.message) {
                store.dispatch(
                    confirmMessageSent({
                        clientMsgId: item.clientMsgId,
                        message: ack.message
                    })
                );
                store.dispatch(dequeuePendingMessage(item.clientMsgId));
            }
        });
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

export const emitTypingStart = conversationId => {
    if (socket && socket.connected && conversationId) {
        socket.emit("typing:start", { conversationId });
    }
};

export const emitTypingStop = conversationId => {
    if (socket && socket.connected && conversationId) {
        socket.emit("typing:stop", { conversationId });
    }
};
