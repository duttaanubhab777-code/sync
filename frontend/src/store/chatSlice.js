import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import {
    api,
    extractErrorMessage,
    LAST_MSG_ID_KEY,
    LAST_SERVER_TIME_KEY
} from "../services/api.js";

const saveLastMsgId = id => {
    if (!id || String(id).startsWith("temp_")) return;
    const current = localStorage.getItem(LAST_MSG_ID_KEY);
    if (!current || String(id) > current) {
        localStorage.setItem(LAST_MSG_ID_KEY, String(id));
    }
};

export const fetchConversations = createAsyncThunk(
    "chat/fetchConversations",
    async (_, { rejectWithValue }) => {
        try {
            const res = await api.get("/api/conversations");
            return res.data?.data || [];
        } catch (err) {
            return rejectWithValue(
                extractErrorMessage(err, "Failed to load conversations")
            );
        }
    }
);

export const startDirectChat = createAsyncThunk(
    "chat/startDirectChat",
    async (partnerId, { rejectWithValue }) => {
        try {
            const res = await api.post("/api/conversations", { partnerId });
            return res.data?.data;
        } catch (err) {
            return rejectWithValue(
                extractErrorMessage(err, "Could not start conversation")
            );
        }
    }
);

export const createGroupChat = createAsyncThunk(
    "chat/createGroupChat",
    async (payload, { rejectWithValue }) => {
        try {
            const res = await api.post("/api/conversations/group", payload);
            return res.data?.data;
        } catch (err) {
            return rejectWithValue(
                extractErrorMessage(err, "Could not create group")
            );
        }
    }
);

export const updateGroupDetails = createAsyncThunk(
    "chat/updateGroupDetails",
    async ({ conversationId, ...updates }, { rejectWithValue }) => {
        try {
            const res = await api.patch(
                `/api/conversations/${conversationId}`,
                updates
            );
            return res.data?.data;
        } catch (err) {
            return rejectWithValue(
                extractErrorMessage(err, "Could not update group")
            );
        }
    }
);

export const updateGroupMember = createAsyncThunk(
    "chat/updateGroupMember",
    async ({ conversationId, action, targetUserId }, { rejectWithValue }) => {
        try {
            const res = await api.patch(
                `/api/conversations/${conversationId}/members`,
                { action, targetUserId }
            );
            return res.data?.data;
        } catch (err) {
            return rejectWithValue(
                extractErrorMessage(err, "Could not update group members")
            );
        }
    }
);

export const leaveGroupChat = createAsyncThunk(
    "chat/leaveGroupChat",
    async (conversationId, { rejectWithValue }) => {
        try {
            await api.post(`/api/conversations/${conversationId}/leave`);
            return conversationId;
        } catch (err) {
            return rejectWithValue(
                extractErrorMessage(err, "Could not leave group")
            );
        }
    }
);

export const fetchMessages = createAsyncThunk(
    "chat/fetchMessages",
    async ({ conversationId, before = null, limit = 30 }, { rejectWithValue }) => {
        try {
            const params = new URLSearchParams({ limit: String(limit) });
            if (before) params.set("before", before);
            const res = await api.get(
                `/api/conversations/${conversationId}/messages?${params.toString()}`
            );
            return {
                conversationId,
                prepend: Boolean(before),
                ...(res.data?.data || {
                    messages: [],
                    hasMore: false,
                    nextBefore: null
                })
            };
        } catch (err) {
            return rejectWithValue(
                extractErrorMessage(err, "Failed to load messages")
            );
        }
    }
);

export const syncMissedMessages = createAsyncThunk(
    "chat/syncMissedMessages",
    async (_, { dispatch, rejectWithValue }) => {
        try {
            let after = localStorage.getItem(LAST_MSG_ID_KEY) || "";
            const since = localStorage.getItem(LAST_SERVER_TIME_KEY) || "";

            if (!after && !since) {
                await dispatch(fetchConversations());
                return null;
            }

            let allNewMessages = [];
            let allUpdated = [];
            let latestServerTime = "";
            let safetyCounter = 0;

            while (safetyCounter < 10) {
                safetyCounter += 1;
                const params = new URLSearchParams();
                if (after) params.set("after", after);
                if (since && safetyCounter === 1) params.set("since", since);

                const res = await api.get(`/api/sync?${params.toString()}`);
                const data = res.data?.data || {};
                const batch = data.messages || [];
                const updated = data.updated || [];

                allNewMessages = allNewMessages.concat(batch);
                if (safetyCounter === 1) allUpdated = updated;
                if (data.serverTime) latestServerTime = data.serverTime;

                if (batch.length > 0) {
                    after = batch[batch.length - 1]._id;
                    saveLastMsgId(after);
                }

                if (!data.hasMore || batch.length === 0) break;
            }

            if (latestServerTime) {
                localStorage.setItem(LAST_SERVER_TIME_KEY, latestServerTime);
            }

            await dispatch(fetchConversations());

            return {
                messages: allNewMessages,
                updated: allUpdated
            };
        } catch (err) {
            return rejectWithValue(extractErrorMessage(err, "Sync failed"));
        }
    }
);

const initialState = {
    conversations: [],
    conversationsLoading: false,
    activeConversationId: null,
    messagesByConv: {},
    onlineUsers: {},
    lastSeenByUser: {},
    typingByConv: {},
    replyingToByConv: {},
    socketConnected: false,
    reconnecting: false,
    pendingQueue: [],
    error: null
};

const ensureConvBucket = (state, convId) => {
    const key = String(convId);
    if (!state.messagesByConv[key]) {
        state.messagesByConv[key] = {
            items: [],
            hasMore: false,
            nextBefore: null,
            loading: false,
            loadedOnce: false
        };
    }
    return state.messagesByConv[key];
};

const sortConversations = convs => {
    convs.sort((a, b) => {
        const tA = new Date(
            a.lastMessage?.createdAt || a.updatedAt || a.createdAt || 0
        ).getTime();
        const tB = new Date(
            b.lastMessage?.createdAt || b.updatedAt || b.createdAt || 0
        ).getTime();
        return tB - tA;
    });
};

const chatSlice = createSlice({
    name: "chat",
    initialState,
    reducers: {
        setActiveConversation(state, action) {
            state.activeConversationId = action.payload
                ? String(action.payload)
                : null;
        },
        setSocketStatus(state, action) {
            const { connected, reconnecting = false } = action.payload || {};
            state.socketConnected = Boolean(connected);
            state.reconnecting = Boolean(reconnecting);
        },
        setReplyTo(state, action) {
            const { conversationId, message } = action.payload;
            state.replyingToByConv[String(conversationId)] = message || null;
        },
        addOptimisticMessage(state, action) {
            const msg = action.payload;
            const convId = String(msg.conversationId);
            const bucket = ensureConvBucket(state, convId);
            const exists = bucket.items.some(
                m => m.clientMsgId && m.clientMsgId === msg.clientMsgId
            );
            if (!exists) {
                bucket.items.push(msg);
            }

            const conv = state.conversations.find(
                c => String(c._id) === convId
            );
            if (conv) {
                conv.lastMessage = {
                    messageId: msg._id,
                    text:
                        msg.type === "text"
                            ? msg.text.slice(0, 100)
                            : `[${String(msg.type).toUpperCase()}]`,
                    type: msg.type,
                    sender: msg.sender?._id || msg.sender,
                    createdAt: msg.createdAt
                };
                conv.updatedAt = msg.createdAt;
                sortConversations(state.conversations);
            }
        },
        enqueuePendingMessage(state, action) {
            const payload = action.payload;
            if (
                !state.pendingQueue.some(
                    p => p.clientMsgId === payload.clientMsgId
                )
            ) {
                state.pendingQueue.push(payload);
            }
        },
        dequeuePendingMessage(state, action) {
            const clientMsgId = action.payload;
            state.pendingQueue = state.pendingQueue.filter(
                p => p.clientMsgId !== clientMsgId
            );
        },
        confirmMessageSent(state, action) {
            const { clientMsgId, message } = action.payload;
            const convId = String(message.conversationId);
            const bucket = ensureConvBucket(state, convId);
            const idx = bucket.items.findIndex(
                m =>
                    m.clientMsgId === clientMsgId ||
                    String(m._id) === String(message._id)
            );
            if (idx !== -1) {
                bucket.items[idx] = { ...message, optimistic: false, failed: false };
            } else {
                bucket.items.push(message);
            }
            saveLastMsgId(message._id);

            const conv = state.conversations.find(
                c => String(c._id) === convId
            );
            if (conv) {
                conv.lastMessage = {
                    messageId: message._id,
                    text:
                        message.type === "text"
                            ? message.text.slice(0, 100)
                            : `[${String(message.type).toUpperCase()}]`,
                    type: message.type,
                    sender: message.sender?._id || message.sender,
                    createdAt: message.createdAt
                };
                conv.updatedAt = message.createdAt;
                sortConversations(state.conversations);
            }
        },
        markMessageFailed(state, action) {
            const { conversationId, clientMsgId, error } = action.payload;
            const bucket = ensureConvBucket(state, conversationId);
            const msg = bucket.items.find(m => m.clientMsgId === clientMsgId);
            if (msg) {
                msg.optimistic = false;
                msg.failed = true;
                msg.errorCode = error || "SEND_FAILED";
            }
        },
        receiveNewMessage(state, action) {
            const { message, conversationId, currentUserId } = action.payload;
            const convId = String(conversationId || message.conversationId);
            const bucket = ensureConvBucket(state, convId);

            const existingIdx = bucket.items.findIndex(
                m =>
                    String(m._id) === String(message._id) ||
                    (m.clientMsgId && m.clientMsgId === message.clientMsgId)
            );
            if (existingIdx !== -1) {
                bucket.items[existingIdx] = message;
            } else {
                bucket.items.push(message);
            }
            saveLastMsgId(message._id);

            const conv = state.conversations.find(
                c => String(c._id) === convId
            );
            const senderId = String(message.sender?._id ?? message.sender);
            const isMine =
                currentUserId && String(currentUserId) === senderId;
            const isActive = state.activeConversationId === convId;

            if (conv) {
                conv.lastMessage = {
                    messageId: message._id,
                    text:
                        message.type === "text"
                            ? message.text.slice(0, 100)
                            : `[${String(message.type).toUpperCase()}]`,
                    type: message.type,
                    sender: senderId,
                    createdAt: message.createdAt
                };
                conv.updatedAt = message.createdAt;
                if (!isMine && !isActive) {
                    conv.unread = Number(conv.unread || 0) + 1;
                }
                sortConversations(state.conversations);
            }
        },
        applyMessageDeleted(state, action) {
            const { messageId, conversationId } = action.payload;
            const convId = String(conversationId);
            const bucket = state.messagesByConv[convId];
            if (bucket) {
                const msg = bucket.items.find(
                    m => String(m._id) === String(messageId)
                );
                if (msg) {
                    msg.deletedForEveryone = true;
                    msg.text = "This message was deleted";
                    msg.media = null;
                }
            }
            const conv = state.conversations.find(
                c => String(c._id) === convId
            );
            if (
                conv &&
                String(conv.lastMessage?.messageId) === String(messageId)
            ) {
                conv.lastMessage.text = "This message was deleted";
                conv.lastMessage.type = "text";
            }
        },
        applyStatusBulk(state, action) {
            const { conversationId, messageIds = [], status } =
                action.payload || {};
            const convId = String(conversationId);
            const bucket = state.messagesByConv[convId];
            if (!bucket) return;
            const idSet = new Set(messageIds.map(String));
            const rank = { sent: 0, delivered: 1, seen: 2 };
            for (const m of bucket.items) {
                if (idSet.has(String(m._id))) {
                    if ((rank[status] ?? 0) > (rank[m.status] ?? 0)) {
                        m.status = status;
                    }
                }
            }
        },
        applyConversationRead(state, action) {
            const convId = String(
                action.payload?.conversationId || action.payload
            );
            const conv = state.conversations.find(
                c => String(c._id) === convId
            );
            if (conv) {
                conv.unread = 0;
            }
        },
        upsertConversation(state, action) {
            const { conversation, currentUserId } = action.payload;
            if (!conversation?._id) return;
            const convId = String(conversation._id);
            const idx = state.conversations.findIndex(
                c => String(c._id) === convId
            );

            const enriched = { ...conversation };
            if (
                enriched.type === "direct" &&
                !enriched.partner &&
                currentUserId
            ) {
                enriched.partner =
                    (enriched.members || []).find(
                        m => String(m?._id ?? m) !== String(currentUserId)
                    ) || null;
            }

            if (idx !== -1) {
                const prevUnread = state.conversations[idx].unread ?? 0;
                const prevPartner = state.conversations[idx].partner;
                state.conversations[idx] = {
                    ...state.conversations[idx],
                    ...enriched,
                    unread:
                        enriched.unread !== undefined
                            ? enriched.unread
                            : prevUnread,
                    partner: enriched.partner || prevPartner || null
                };
            } else {
                state.conversations.unshift({
                    ...enriched,
                    unread: enriched.unread ?? 0
                });
            }
            sortConversations(state.conversations);
        },
        removeConversation(state, action) {
            const convId = String(
                action.payload?.conversationId || action.payload
            );
            state.conversations = state.conversations.filter(
                c => String(c._id) !== convId
            );
            if (state.activeConversationId === convId) {
                state.activeConversationId = null;
            }
        },
        setPresenceSnapshot(state, action) {
            const ids = action.payload?.onlineUserIds || [];
            for (const id of ids) {
                state.onlineUsers[String(id)] = true;
            }
        },
        setPresenceUpdate(state, action) {
            const { userId, online, lastSeen } = action.payload || {};
            if (!userId) return;
            const key = String(userId);
            state.onlineUsers[key] = Boolean(online);
            if (lastSeen) {
                state.lastSeenByUser[key] = lastSeen;
            }
            for (const c of state.conversations) {
                if (c.partner && String(c.partner._id) === key) {
                    c.partner.online = Boolean(online);
                    if (lastSeen) c.partner.lastSeen = lastSeen;
                }
                if (Array.isArray(c.members)) {
                    for (const m of c.members) {
                        if (m && String(m._id) === key) {
                            m.online = Boolean(online);
                            if (lastSeen) m.lastSeen = lastSeen;
                        }
                    }
                }
            }
        },
        setTypingStatus(state, action) {
            const { conversationId, userId, fullName, isTyping } =
                action.payload || {};
            if (!conversationId || !userId) return;
            const cKey = String(conversationId);
            if (!state.typingByConv[cKey]) {
                state.typingByConv[cKey] = {};
            }
            if (isTyping) {
                state.typingByConv[cKey][String(userId)] = fullName || "Someone";
            } else {
                delete state.typingByConv[cKey][String(userId)];
            }
        },
        resetChatState() {
            return initialState;
        }
    },
    extraReducers: builder => {
        builder
            .addCase(fetchConversations.pending, state => {
                state.conversationsLoading = true;
            })
            .addCase(fetchConversations.fulfilled, (state, action) => {
                state.conversationsLoading = false;
                state.conversations = action.payload;
                for (const c of action.payload) {
                    if (c.partner?._id) {
                        state.onlineUsers[String(c.partner._id)] = Boolean(
                            c.partner.online
                        );
                        if (c.partner.lastSeen) {
                            state.lastSeenByUser[String(c.partner._id)] =
                                c.partner.lastSeen;
                        }
                    }
                    for (const m of c.members || []) {
                        if (m?._id) {
                            state.onlineUsers[String(m._id)] = Boolean(m.online);
                            if (m.lastSeen) {
                                state.lastSeenByUser[String(m._id)] = m.lastSeen;
                            }
                        }
                    }
                    if (c.lastMessage?.messageId) {
                        saveLastMsgId(c.lastMessage.messageId);
                    }
                }
            })
            .addCase(fetchConversations.rejected, (state, action) => {
                state.conversationsLoading = false;
                state.error = action.payload;
            })
            .addCase(startDirectChat.fulfilled, (state, action) => {
                const conv = action.payload;
                if (!conv) return;
                const idx = state.conversations.findIndex(
                    c => String(c._id) === String(conv._id)
                );
                if (idx !== -1) {
                    state.conversations[idx] = conv;
                } else {
                    state.conversations.unshift(conv);
                }
                state.activeConversationId = String(conv._id);
            })
            .addCase(createGroupChat.fulfilled, (state, action) => {
                const conv = action.payload;
                if (!conv) return;
                state.conversations.unshift(conv);
                state.activeConversationId = String(conv._id);
            })
            .addCase(updateGroupDetails.fulfilled, (state, action) => {
                const conv = action.payload;
                if (!conv) return;
                const idx = state.conversations.findIndex(
                    c => String(c._id) === String(conv._id)
                );
                if (idx !== -1) {
                    state.conversations[idx] = {
                        ...state.conversations[idx],
                        ...conv
                    };
                }
            })
            .addCase(updateGroupMember.fulfilled, (state, action) => {
                const conv = action.payload;
                if (!conv) return;
                const idx = state.conversations.findIndex(
                    c => String(c._id) === String(conv._id)
                );
                if (idx !== -1) {
                    state.conversations[idx] = {
                        ...state.conversations[idx],
                        ...conv
                    };
                }
            })
            .addCase(leaveGroupChat.fulfilled, (state, action) => {
                const convId = String(action.payload);
                state.conversations = state.conversations.filter(
                    c => String(c._id) !== convId
                );
                if (state.activeConversationId === convId) {
                    state.activeConversationId = null;
                }
            })
            .addCase(fetchMessages.pending, (state, action) => {
                const convId = String(action.meta.arg.conversationId);
                const bucket = ensureConvBucket(state, convId);
                bucket.loading = true;
            })
            .addCase(fetchMessages.fulfilled, (state, action) => {
                const {
                    conversationId,
                    prepend,
                    messages = [],
                    hasMore = false,
                    nextBefore = null
                } = action.payload;
                const convId = String(conversationId);
                const bucket = ensureConvBucket(state, convId);
                bucket.loading = false;
                bucket.loadedOnce = true;
                bucket.hasMore = hasMore;
                bucket.nextBefore = nextBefore;

                if (prepend) {
                    const existingIds = new Set(
                        bucket.items.map(m => String(m._id))
                    );
                    const older = messages.filter(
                        m => !existingIds.has(String(m._id))
                    );
                    bucket.items = [...older, ...bucket.items];
                } else {
                    bucket.items = messages;
                }

                if (messages.length > 0) {
                    saveLastMsgId(messages[messages.length - 1]._id);
                }
            })
            .addCase(fetchMessages.rejected, (state, action) => {
                const convId = String(action.meta.arg.conversationId);
                const bucket = ensureConvBucket(state, convId);
                bucket.loading = false;
            })
            .addCase(syncMissedMessages.fulfilled, (state, action) => {
                if (!action.payload) return;
                const { messages = [], updated = [] } = action.payload;

                for (const m of messages) {
                    const convId = String(m.conversationId);
                    const bucket = state.messagesByConv[convId];
                    if (bucket) {
                        const idx = bucket.items.findIndex(
                            x => String(x._id) === String(m._id)
                        );
                        if (idx === -1) bucket.items.push(m);
                        else bucket.items[idx] = m;
                    }
                    saveLastMsgId(m._id);
                }

                for (const u of updated) {
                    const convId = String(u.conversationId);
                    const bucket = state.messagesByConv[convId];
                    if (bucket) {
                        const msg = bucket.items.find(
                            x => String(x._id) === String(u._id)
                        );
                        if (msg) {
                            msg.status = u.status || msg.status;
                            msg.deletedForEveryone = Boolean(
                                u.deletedForEveryone
                            );
                            if (u.deletedForEveryone) {
                                msg.text = "This message was deleted";
                                msg.media = null;
                            }
                        }
                    }
                }
            });
    }
});

export const {
    setActiveConversation,
    setSocketStatus,
    setReplyTo,
    addOptimisticMessage,
    enqueuePendingMessage,
    dequeuePendingMessage,
    confirmMessageSent,
    markMessageFailed,
    receiveNewMessage,
    applyMessageDeleted,
    applyStatusBulk,
    applyConversationRead,
    upsertConversation,
    removeConversation,
    setPresenceSnapshot,
    setPresenceUpdate,
    setTypingStatus,
    resetChatState
} = chatSlice.actions;

export default chatSlice.reducer;
