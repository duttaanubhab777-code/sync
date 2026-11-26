import { randomBytes } from "node:crypto";
import { User } from "../models/user.model.js";
import { Conversation } from "../models/conversation.model.js";
import { Message } from "../models/message.model.js";
import { Notification } from "../models/notification.model.js";
import {
    POPULATE_MEMBERS,
    serializeConversation,
    emitToUsers,
    joinConversationRoom,
    getTotalUnread
} from "./conversation.service.js";
import { sendPushToUser } from "./push.service.js";
import { idOf } from "../utils/helpers.js";

/*
 * Sync-এর অফিশিয়াল অংশ:
 *  ১. "Sync" নামে একটা সিস্টেম অ্যাকাউন্ট (verified, লগইন করা যায় না) — নতুন ইউজারকে personal welcome মেসেজ পাঠায়
 *  ২. "Sync" নামে একটা অফিশিয়াল গ্রুপ — সব ইউজার নিজে থেকে সদস্য; admin ও superAdmin-রা group admin; কেউ মুছতে পারে না
 */

export const SYNC_GROUP_KEY = "sync-official-group";
export const SYNC_LOGO = "/logo-mark.webp";
const SYNC_FULL_NAME = "Sync";
const SYNC_USERNAME_CANDIDATES = ["sync", "sync.official", "sync_official"];
const SYNC_GROUP_DESCRIPTION =
    "Official Sync community. News, updates and tips from the Sync team.";

const ADMIN_ROLES = ["admin", "superAdmin"];
const CHUNK = 500;

let syncUserId = null;
let syncGroupId = null;

// ---------- Sync সিস্টেম অ্যাকাউন্ট ----------

export const getSyncUser = async () => {
    if (syncUserId) {
        const cached = await User.findById(syncUserId);
        if (cached) return cached;
        syncUserId = null;
    }

    let user = await User.findOne({ isOfficial: true });
    if (!user) {
        // কেউ আগে "sync" username নিয়ে ফেললে পরের নামগুলো চেষ্টা করা হয়
        // pre("save") হুক নিজেই পাসওয়ার্ড hash করে নেবে, আর login-এ isOfficial আলাদা করে আটকানো আছে
        const randomPassword = randomBytes(32).toString("hex");
        for (const username of SYNC_USERNAME_CANDIDATES) {
            try {
                user = await User.create({
                    username,
                    fullName: SYNC_FULL_NAME,
                    email: "official@sync.invalid",
                    phoneNumber: "+0000000000",
                    password: randomPassword,
                    avatar: SYNC_LOGO,
                    about: "Official Sync account",
                    isOfficial: true
                });
                break;
            } catch (err) {
                if (err?.code !== 11000) throw err;
                // আরেক instance একই সময়ে বানিয়ে ফেললে সেটাই নেওয়া
                user = await User.findOne({ isOfficial: true });
                if (user) break;
            }
        }
        if (!user) throw new Error("Could not create the Sync official account");
    }

    // এক-দুবার ডাটা বদলে গেলেও ঠিক করে দেওয়া
    if (user.avatar !== SYNC_LOGO || user.isBlocked || user.fullName !== SYNC_FULL_NAME) {
        await User.updateOne(
            { _id: user._id },
            { $set: { avatar: SYNC_LOGO, isBlocked: false, fullName: SYNC_FULL_NAME } }
        );
        user.avatar = SYNC_LOGO;
        user.isBlocked = false;
        user.fullName = SYNC_FULL_NAME;
    }
    syncUserId = String(user._id);
    return user;
};

// ---------- অফিশিয়াল গ্রুপ ----------

export const getSyncGroup = async () => {
    if (syncGroupId) {
        const cached = await Conversation.findById(syncGroupId);
        if (cached) return cached;
        syncGroupId = null;
    }
    const sync = await getSyncUser();
    // upsert-এ model-এর validate চলে না, তাই খালি সদস্য নিয়েও গ্রুপ বানানো যায়
    const conv = await Conversation.findOneAndUpdate(
        { systemKey: SYNC_GROUP_KEY },
        {
            $setOnInsert: {
                type: "group",
                isOfficial: true,
                groupName: "Sync",
                groupIcon: SYNC_LOGO,
                groupDescription: SYNC_GROUP_DESCRIPTION,
                createdBy: sync._id,
                members: [],
                admins: []
            }
        },
        { upsert: true, returnDocument: "after" }
    );
    syncGroupId = String(conv._id);
    return conv;
};

const chunks = (list, size = CHUNK) => {
    const out = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
};

const currentAdminIds = async () =>
    (
        await User.find(
            {
                role: { $in: ADMIN_ROLES },
                isBlocked: { $ne: true },
                isOfficial: { $ne: true }
            },
            { _id: 1 }
        ).lean()
    ).map(u => String(u._id));

// সার্ভার চালুর সময়: সব পুরনো ইউজারকে গ্রুপে তোলা, মুছে যাওয়া ইউজার সরানো, admin তালিকা মেলানো এবং বাকি থাকা ইউজারদের একবার ওয়েলকাম মেসেজ পাঠানো
export const ensureOfficialSync = async () => {
    const [sync, group] = await Promise.all([getSyncUser(), getSyncGroup()]);
    const users = await User.find(
        { isOfficial: { $ne: true } },
        { _id: 1, fullName: 1 }
    ).lean();
    const userIds = users.map(u => String(u._id));
    const userSet = new Set(userIds);

    // যে অ্যাকাউন্ট আর নেই তাদের সরানো
    const stale = (group.members || []).map(idOf).filter(id => !userSet.has(id));
    if (stale.length > 0) {
        await Conversation.updateOne(
            { _id: group._id },
            { $pull: { members: { $in: stale }, admins: { $in: stale } } },
            { timestamps: false }
        );
    }

    for (const part of chunks(userIds)) {
        await Conversation.updateOne(
            { _id: group._id },
            { $addToSet: { members: { $each: part } } },
            { timestamps: false }
        );
    }

    const admins = await currentAdminIds();
    await Conversation.updateOne(
        { _id: group._id },
        {
            $set: {
                admins,
                isOfficial: true,
                groupName: "Sync",
                groupIcon: SYNC_LOGO
            }
        },
        { timestamps: false }
    );

    // আগে থেকে রেজিস্টার্ড যাদের এখনো ওয়েলকাম মেসেজ যায়নি, তাদের একবার করে পাঠানো (idempotent)
    const sentRows = await Message.find(
        { sender: sync._id, clientMsgId: { $regex: /^welcome:/ } },
        { clientMsgId: 1 }
    ).lean();
    const welcomed = new Set(sentRows.map(r => r.clientMsgId));
    const pendingWelcome = users.filter(
        u => !welcomed.has(`welcome:${String(u._id)}`)
    );

    let welcomedNow = 0;
    for (const batch of chunks(pendingWelcome, 20)) {
        const results = await Promise.allSettled(
            batch.map(u => sendWelcomeMessage(u))
        );
        for (const r of results) {
            if (r.status === "fulfilled") welcomedNow += 1;
            else console.error("[Sync Welcome]", r.reason?.message || r.reason);
        }
    }

    console.log(
        `[Sync Group] ready: ${userIds.length} members, ${admins.length} admins${
            welcomedNow > 0 ? `, welcomed ${welcomedNow} existing users` : ""
        }`
    );
};

// নতুন অ্যাকাউন্ট খুললেই গ্রুপের সদস্য (admin হলে group admin-ও)
export const addUserToSyncGroup = async (user, io) => {
    const group = await getSyncGroup();
    const update = { $addToSet: { members: user._id } };
    if (ADMIN_ROLES.includes(user.role) && !user.isBlocked) {
        update.$addToSet.admins = user._id;
    }
    await Conversation.updateOne({ _id: group._id }, update, {
        timestamps: false
    });
    if (io) joinConversationRoom(io, [user._id], group._id);
};

export const removeUserFromSyncGroup = async userId => {
    const group = await getSyncGroup();
    await Conversation.updateOne(
        { _id: group._id },
        {
            $pull: { members: userId, admins: userId },
            $unset: { [`unread.${userId}`]: "" }
        },
        { timestamps: false }
    );
};

// role বদলালে (admin বানানো/সরানো) গ্রুপের admin তালিকা নতুন করে মেলানো
export const refreshSyncGroupAdmins = async (io, notifyUserIds = []) => {
    const group = await getSyncGroup();
    const admins = await currentAdminIds();
    await Conversation.updateOne(
        { _id: group._id },
        { $set: { admins } },
        { timestamps: false }
    );
    if (io && notifyUserIds.length > 0) {
        const fresh = await Conversation.findById(group._id).populate(
            POPULATE_MEMBERS
        );
        emitToUsers(io, notifyUserIds, "conversation:updated", {
            conversation: serializeConversation(fresh)
        });
    }
};

// ---------- welcome মেসেজ ----------

const firstName = fullName =>
    String(fullName || "")
        .trim()
        .split(/\s+/)[0] || "there";

export const buildWelcomeText = fullName =>
    [
        `Hello ${firstName(fullName)} 👋`,
        "",
        "Welcome to Sync — we're so happy you're here! 💚",
        "",
        "Here's what you can do:",
        "💬 Chat in real time, one-to-one or in groups",
        "📸 Share photos, videos, voice notes & files",
        "✨ Post stories that disappear after 24 hours",
        "🔔 Get notified the moment someone writes to you",
        "",
        "Say hi in the Sync group and make yourself at home.",
        "— Team Sync"
    ].join("\n");

// "Sync" থেকে নতুন ইউজারকে personal (direct) welcome মেসেজ। একবারই যায় (clientMsgId দিয়ে idempotent)
export const sendWelcomeMessage = async (user, io) => {
    const sync = await getSyncUser();
    const userId = String(user._id);

    const pairKey = [String(sync._id), userId].sort().join("_");
    let conv = await Conversation.findOne({ pairKey });
    if (!conv) {
        try {
            conv = await Conversation.create({
                type: "direct",
                members: [sync._id, user._id],
                createdBy: sync._id
            });
        } catch (err) {
            if (err?.code !== 11000) throw err;
            conv = await Conversation.findOne({ pairKey });
        }
    }

    const clientMsgId = `welcome:${userId}`;
    if (await Message.exists({ sender: sync._id, clientMsgId })) return;

    let msg;
    try {
        msg = await Message.create({
            conversationId: conv._id,
            sender: sync._id,
            clientMsgId,
            type: "text",
            text: buildWelcomeText(user.fullName),
            card: { kind: "welcome", name: user.fullName },
            status: "sent"
        });
    } catch (err) {
        if (err?.code === 11000) return;
        throw err;
    }

    await Conversation.updateOne(
        { _id: conv._id },
        {
            $set: {
                lastMessage: {
                    messageId: msg._id,
                    text: `Hello ${firstName(user.fullName)} 👋 Welcome to Sync!`,
                    type: "text",
                    sender: sync._id,
                    createdAt: msg.createdAt
                }
            },
            $inc: { [`unread.${userId}`]: 1 }
        }
    );

    if (io) {
        joinConversationRoom(io, [user._id], conv._id);
        const fresh = await Conversation.findById(conv._id).populate(
            POPULATE_MEMBERS
        );
        emitToUsers(io, [user._id], "conversation:new", {
            conversation: serializeConversation(fresh, userId)
        });
    }

    // ওয়েলকাম মেসেজের জন্যও Notification ও Push পাঠানো
    const welcomePreview = `Hello ${firstName(user.fullName)} 👋 Welcome to Sync!`;
    const notifData = {
        conversationId: String(conv._id),
        messageId: String(msg._id),
        url: `/chats/${conv._id}`
    };
    await Notification.create({
        recipient: user._id,
        actor: sync._id,
        type: "message",
        title: "Sync",
        body: welcomePreview,
        data: notifData
    }).catch(err => console.error("[Welcome Notification]", err.message));

    const badgeCount = await getTotalUnread(userId).catch(() => 1);
    await sendPushToUser(userId, {
        type: "message",
        title: "Sync",
        body: welcomePreview,
        messageText: welcomePreview,
        senderName: "Sync",
        icon: "/icons/icon-192.png",
        tag: `conversation-${conv._id}`,
        data: notifData,
        badgeCount,
        chatUnread: 1
    }).catch(err => console.error("[Welcome Push]", err.message));
};

// অ্যাডমিন প্যানেল থেকে অফিশিয়াল Sync অ্যাকাউন্ট দিয়ে সব ইউজারকে পার্সোনাল ব্রডকাস্ট কার্ড পাঠানো
// broadcastKey দিলে (যেমন commit SHA) একই key দিয়ে দুবার পাঠালেও প্রতি ইউজার একটাই কার্ড পায় (idempotent)
export const sendOfficialBroadcast = async (
    { title, body, tag = "Announcement", broadcastKey = "" },
    io
) => {
    const sync = await getSyncUser();
    const cleanTitle = String(title || "").trim().slice(0, 120);
    const cleanBody = String(body || "").trim().slice(0, 1500);
    const cleanTag = String(tag || "Announcement").trim().slice(0, 40) || "Announcement";
    const broadcastId = broadcastKey
        ? `broadcast:${broadcastKey}`
        : `broadcast:${Date.now()}:${randomBytes(4).toString("hex")}`;

    const users = await User.find(
        { isOfficial: { $ne: true }, isBlocked: { $ne: true } },
        { _id: 1 }
    ).lean();

    const preview = `${cleanTitle} — ${cleanBody}`.slice(0, 140);
    let delivered = 0;

    for (const batch of chunks(users, 20)) {
        const results = await Promise.allSettled(
            batch.map(async u => {
                const userId = String(u._id);
                const pairKey = [String(sync._id), userId].sort().join("_");
                let conv = await Conversation.findOne({ pairKey });
                let isNewConv = false;
                if (!conv) {
                    try {
                        conv = await Conversation.create({
                            type: "direct",
                            members: [sync._id, u._id],
                            createdBy: sync._id
                        });
                        isNewConv = true;
                    } catch (err) {
                        if (err?.code !== 11000) throw err;
                        conv = await Conversation.findOne({ pairKey });
                    }
                }

                let msg = await Message.create({
                    conversationId: conv._id,
                    sender: sync._id,
                    clientMsgId: `${broadcastId}:${userId}`,
                    type: "text",
                    text: `${cleanTitle}

${cleanBody}`,
                    card: {
                        kind: "broadcast",
                        title: cleanTitle,
                        body: cleanBody,
                        tag: cleanTag
                    },
                    status: "sent"
                });
                msg = await msg.populate("sender", "username fullName avatar isOfficial");

                await Conversation.updateOne(
                    { _id: conv._id },
                    {
                        $set: {
                            lastMessage: {
                                messageId: msg._id,
                                text: preview.slice(0, 100),
                                type: "text",
                                sender: sync._id,
                                createdAt: msg.createdAt
                            }
                        },
                        $inc: { [`unread.${userId}`]: 1 }
                    }
                );

                if (io) {
                    if (isNewConv) {
                        joinConversationRoom(io, [u._id], conv._id);
                        const fresh = await Conversation.findById(conv._id).populate(
                            POPULATE_MEMBERS
                        );
                        emitToUsers(io, [u._id], "conversation:new", {
                            conversation: serializeConversation(fresh, userId)
                        });
                    }
                    emitToUsers(io, [u._id], "message:new", {
                        message: msg,
                        conversationId: conv._id
                    });
                }

                const notifData = {
                    conversationId: String(conv._id),
                    messageId: String(msg._id),
                    url: `/chats/${conv._id}`
                };
                await Notification.create({
                    recipient: u._id,
                    actor: sync._id,
                    type: "message",
                    title: `Sync · ${cleanTitle}`.slice(0, 120),
                    body: cleanBody.slice(0, 240),
                    data: notifData
                }).catch(() => {});

                const isMuted = (conv.mutedBy || []).some(
                    id => String(id) === userId
                );
                if (!isMuted) {
                    const badgeCount = await getTotalUnread(userId).catch(() => 1);
                    await sendPushToUser(userId, {
                        type: "message",
                        title: `Sync · ${cleanTitle}`.slice(0, 120),
                        body: cleanBody.slice(0, 160),
                        messageText: preview,
                        senderName: "Sync",
                        icon: "/icons/icon-192.png",
                        tag: `conversation-${conv._id}`,
                        data: notifData,
                        badgeCount,
                        chatUnread: 1
                    }).catch(() => {});
                }
            })
        );
        for (const r of results) {
            if (r.status === "fulfilled") delivered += 1;
        }
    }

    return { deliveredCount: delivered, totalUsers: users.length };
};

// অফিশিয়াল "Sync" গ্রুপে একই ব্রডকাস্ট কার্ড পোস্ট করা (সদস্যরা গ্রুপে কার্ডটা দেখবে)।
// DM-এ আগেই push যায়, তাই এখানে আলাদা push পাঠানো হয় না (একই খবরে দুবার নোটিফিকেশন এড়াতে)।
export const sendOfficialGroupPost = async (
    { title, body, tag = "Announcement", broadcastKey = "" },
    io
) => {
    const [sync, group] = await Promise.all([getSyncUser(), getSyncGroup()]);
    const cleanTitle = String(title || "").trim().slice(0, 120);
    const cleanBody = String(body || "").trim().slice(0, 1500);
    const cleanTag = String(tag || "Announcement").trim().slice(0, 40) || "Announcement";
    const clientMsgId = broadcastKey
        ? `broadcast-group:${broadcastKey}`
        : `broadcast-group:${Date.now()}:${randomBytes(4).toString("hex")}`;

    const memberIds = (group.members || [])
        .map(idOf)
        .filter(id => id !== String(sync._id));
    if (memberIds.length === 0) return { posted: false, reason: "no-members" };

    let msg;
    try {
        msg = await Message.create({
            conversationId: group._id,
            sender: sync._id,
            clientMsgId,
            type: "text",
            text: `${cleanTitle}

${cleanBody}`,
            card: {
                kind: "broadcast",
                title: cleanTitle,
                body: cleanBody,
                tag: cleanTag
            },
            status: "sent"
        });
    } catch (err) {
        // একই key-র পোস্ট আগেই হয়ে গেছে
        if (err?.code === 11000) return { posted: false, reason: "duplicate" };
        throw err;
    }
    msg = await msg.populate("sender", "username fullName avatar isOfficial");

    const inc = {};
    for (const id of memberIds) inc[`unread.${id}`] = 1;
    await Conversation.updateOne(
        { _id: group._id },
        {
            $set: {
                lastMessage: {
                    messageId: msg._id,
                    text: `${cleanTitle} — ${cleanBody}`.slice(0, 100),
                    type: "text",
                    sender: sync._id,
                    createdAt: msg.createdAt
                }
            },
            $inc: inc
        }
    );

    if (io) {
        emitToUsers(io, memberIds, "message:new", {
            message: msg,
            conversationId: group._id
        });
    }
    return { posted: true, memberCount: memberIds.length };
};

// নতুন অ্যাকাউন্ট হলে যা যা করতে হয়: গ্রুপে যোগ + welcome মেসেজ (একটা ব্যর্থ হলে আরেকটা আটকায় না, signup-ও আটকায় না)
export const onboardNewUser = async (user, io) => {
    const results = await Promise.allSettled([
        addUserToSyncGroup(user, io),
        sendWelcomeMessage(user, io)
    ]);
    for (const r of results) {
        if (r.status === "rejected") {
            console.error("[Onboard]", r.reason?.message || r.reason);
        }
    }
};
