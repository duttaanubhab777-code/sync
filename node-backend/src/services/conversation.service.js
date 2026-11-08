import { Conversation } from "../models/conversation.model.js";
import { PUBLIC_USER_FIELDS, idOf } from "../utils/helpers.js";
import { isUserOnline } from "../socket/store.js";

export const POPULATE_MEMBERS = { path: "members", select: PUBLIC_USER_FIELDS };

// meId দিলে সেই ইউজারের নিজের unread সংখ্যা ও (direct চ্যাটে) partner যোগ হয়।
// meId না দিলে "সবার জন্য এক" payload হয় (socket broadcast-এ এটাই ব্যবহার করো)।
export const serializeConversation = (conv, meId) => {
    const o =
        typeof conv.toObject === "function"
            ? conv.toObject({ flattenMaps: true })
            : conv;

    const members = (o.members || []).map(m =>
        m && m._id ? { ...m, online: isUserOnline(m._id) } : m
    );

    const out = {
        _id: o._id,
        type: o.type,
        members,
        groupName: o.groupName || "",
        groupIcon: o.groupIcon || "",
        groupDescription: o.groupDescription || "",
        admins: (o.admins || []).map(String),
        createdBy: o.createdBy ? String(o.createdBy) : null,
        onlyAdminCanMessage: Boolean(o.onlyAdminCanMessage),
        lastMessage: o.lastMessage?.messageId ? o.lastMessage : null,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt
    };

    if (meId) {
        const unread =
            o.unread instanceof Map ? Object.fromEntries(o.unread) : o.unread;
        out.unread = Number(unread?.[String(meId)] || 0);
        if (o.type === "direct") {
            out.partner =
                members.find(m => idOf(m) !== String(meId)) || null;
        }
    }
    return out;
};

// নির্দিষ্ট ইউজারদের সব ডিভাইসে ইভেন্ট পাঠানো
// (খালি তালিকায় io.to([]) সবাইকে পাঠিয়ে দেয়, তাই আগে থামানো হয়)
export const emitToUsers = (io, userIds, event, payload) => {
    const rooms = [...new Set(userIds.map(id => `user:${idOf(id)}`))];
    if (rooms.length === 0) return;
    io.to(rooms).emit(event, payload);
};

// নতুন চ্যাটে ঢুকলে এই ইউজারদের চলতি socket গুলো conv রুমে ঢোকানো (typing/presence এর জন্য)
export const joinConversationRoom = (io, userIds, conversationId) => {
    const rooms = userIds.map(id => `user:${idOf(id)}`);
    if (rooms.length === 0) return;
    io.in(rooms).socketsJoin(`conv:${conversationId}`);
};

export const leaveConversationRoom = (io, userIds, conversationId) => {
    const rooms = userIds.map(id => `user:${idOf(id)}`);
    if (rooms.length === 0) return;
    io.in(rooms).socketsLeave(`conv:${conversationId}`);
};

// আমার সব direct চ্যাটের অপর পক্ষের id (এদেরকেই "contact" ধরা হয়)
export const getContactIds = async userId => {
    const convs = await Conversation.find(
        { type: "direct", members: userId },
        { members: 1 }
    ).lean();
    const set = new Set();
    for (const c of convs) {
        for (const m of c.members) {
            if (String(m) !== String(userId)) set.add(String(m));
        }
    }
    return [...set];
};
