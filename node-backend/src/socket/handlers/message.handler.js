import { Conversation } from "../../models/conversation.model.js";
import { Message } from "../../models/message.model.js";
import { User } from "../../models/user.model.js";
import { isValidCloudinaryUrl, pickMedia } from "../../utils/cloudinary.js";
import {
    buildLastMessagePreview,
    pickContact,
    pickLocation
} from "../../utils/attachments.js";
import { isObjectId } from "../../utils/helpers.js";
import { cleanupInBackground } from "../../services/cloudinaryCleanup.service.js";
import { Notification } from "../../models/notification.model.js";
import { sendPushToUser } from "../../services/push.service.js";
import { makeAckToken, ackUrl } from "../../utils/deliveryAck.js";
import { getTotalUnread } from "../../services/conversation.service.js";

const ALLOWED_TYPES = [
    "text",
    "image",
    "video",
    "audio",
    "file",
    "location",
    "contact",
    "poll"
];
const EDIT_WINDOW_MS = 15 * 60 * 1000; // পাঠানোর ১৫ মিনিটের মধ্যে মেসেজ এডিট করা যাবে
const MAX_TEXT = 4000;

// একটা socket থেকে ১০ সেকেন্ডে সর্বোচ্চ ২০টা মেসেজ (spam/flood ঠেকাতে)
const RATE_WINDOW_MS = 10_000;
const RATE_MAX = 20;

const POPULATE_SENDER = { path: "sender", select: "username fullName avatar isOfficial" };
const POPULATE_REPLY = {
    path: "replyTo",
    select: "text type sender media.url media.fileName location contact deletedForEveryone"
};

const MEDIA_PREVIEW = {
    image: "📷 Photo",
    video: "🎥 Video",
    audio: "🎤 Voice message",
    file: "📎 Attachment",
    location: "📍 Location",
    contact: "👤 Contact",
    poll: "📊 Poll"
};

const optimizePushImage = url => {
    if (!url || !url.includes("/image/upload/")) return "";
    const [head, tail] = url.split("/image/upload/");
    if (/^[a-z]{1,3}_[^/]+(,[^/]+)*\//i.test(tail)) return url;
    return `${head}/image/upload/w_720,c_limit,q_auto/${tail}`;
};

const optimizePushAvatar = url => {
    if (!url || !url.includes("/image/upload/")) return "";
    const [head, tail] = url.split("/image/upload/");
    if (/^[a-z]{1,3}_[^/]+(,[^/]+)*\//i.test(tail)) return url;
    return `${head}/image/upload/w_192,h_192,c_fill,g_face,q_auto,f_png/${tail}`;
};

const buildPushPreview = ({ type, cleanText, msg }) => {
    if (type === "text") return cleanText.slice(0, 160);
    if (type === "poll") {
        return `📊 Poll: ${String(msg.poll?.question || "").slice(0, 140)}`;
    }
    if (type === "contact") {
        const label = msg.contact?.name
            ? `👤 Contact: ${msg.contact.name}`
            : MEDIA_PREVIEW.contact;
        return cleanText
            ? `${label} — ${cleanText.slice(0, 100)}`
            : label.slice(0, 160);
    }
    if (type === "location") {
        const label = msg.location?.address
            ? `📍 Location: ${msg.location.address}`
            : MEDIA_PREVIEW.location;
        return cleanText
            ? `${label} — ${cleanText.slice(0, 100)}`
            : label.slice(0, 160);
    }
    if (type === "file") {
        const label = msg.media?.fileName
            ? `📎 ${msg.media.fileName}`
            : MEDIA_PREVIEW.file;
        return cleanText
            ? `${label}: ${cleanText.slice(0, 110)}`
            : label.slice(0, 160);
    }
    return cleanText
        ? `${MEDIA_PREVIEW[type] || "Attachment"}: ${cleanText.slice(0, 120)}`
        : MEDIA_PREVIEW[type] || `Sent a ${type}`;
};

async function notifyRecipients({
    conv,
    msg,
    type,
    cleanText,
    senderId,
    senderName
}) {
    const recipients = conv.members
        .map(m => m.toString())
        .filter(id => id !== String(senderId));
    if (recipients.length === 0) return;

    const isGroup = conv.type === "group";
    const basePreview = buildPushPreview({ type, cleanText, msg });

    const cleanSenderName = senderName || "New message";
    const title = isGroup ? conv.groupName || "Group chat" : cleanSenderName;
    const body = isGroup
        ? `${senderName || "Someone"}: ${basePreview}`
        : basePreview;
    const targetUrl = `/chats/${conv._id}`;
    const data = {
        conversationId: String(conv._id),
        messageId: String(msg._id),
        url: targetUrl
    };
    const senderAvatar = optimizePushAvatar(msg.sender?.avatar);
    const groupIcon = isGroup ? optimizePushAvatar(conv.groupIcon) : "";
    const pushPayload = {
        type: isGroup ? "group_message" : "message",
        title,
        body,
        messageText: basePreview,
        senderName: cleanSenderName,
        senderAvatar,
        groupIcon,
        icon: senderAvatar || groupIcon || "/icons/icon-192.png",
        image: type === "image" ? optimizePushImage(msg.media?.url) : "",
        tag: `conversation-${conv._id}`,
        data
    };

    // unread সংখ্যা এই মেসেজ যোগ হওয়ার পরের (আগেই updateOne হয়ে গেছে)
    const freshConv = await Conversation.findById(conv._id, {
        unread: 1,
        mutedBy: 1
    })
        .lean()
        .catch(() => null);
    const mutedSet = new Set(
        (freshConv?.mutedBy || []).map(id => String(id))
    );

    const safeTitle = String(title || "Sync").slice(0, 120);
    const safeBody = String(body || "New message").slice(0, 240);

    const results = await Promise.allSettled(
        recipients.map(async recipientId => {
            // Notification.create কোনো কারণে ব্যর্থ হলেও যেন Push Notification বন্ধ না হয়
            await Notification.create({
                recipient: recipientId,
                actor: senderId,
                type: isGroup ? "group_message" : "message",
                title: safeTitle,
                body: safeBody,
                data
            }).catch(err =>
                console.error("[Notification.create]", err.message)
            );

            // অ্যাপ আইকনের badge: মোট না-পড়া (badgeCount) ও এই চ্যাটের না-পড়া (chatUnread)
            const badgeCount = await getTotalUnread(recipientId).catch(
                () => 0
            );
            const chatUnread = Math.max(
                0,
                Math.floor(Number(freshConv?.unread?.[recipientId]) || 0)
            );
            // push পৌঁছালেই ফোন এই টোকেন দিয়ে "delivered" জানাবে (অ্যাপ বন্ধ থাকলেও)
            const pushData = { ...data, ackUserId: String(recipientId) };
            try {
                pushData.ackToken = makeAckToken(recipientId, msg._id);
                const url = ackUrl();
                if (url) pushData.ackUrl = url;
            } catch {
                // secret না থাকলে ack ছাড়াই push যাবে
            }
            // ইউজার এই চ্যাট মিউট করে রাখলে পুশ নোটিফিকেশন যাবে না
            if (!mutedSet.has(String(recipientId))) {
                await sendPushToUser(recipientId, {
                    ...pushPayload,
                    data: pushData,
                    badgeCount,
                    chatUnread
                });
            }
        })
    );

    for (const r of results) {
        if (r.status === "rejected") {
            console.error(
                "[Message notify recipient]",
                r.reason?.message || r.reason
            );
        }
    }
}

// Socket.IO এবং REST (Service Worker Background Sync) দুটোর জন্য একটাই মেসেজ পাঠানোর কোর লজিক
export async function sendMessageCore({
    io,
    userId,
    senderFullName = "",
    payload,
    excludeSocketId = null,
    onAck = null
}) {
    const uid = String(userId);
    const {
        conversationId,
        clientMsgId,
        type = "text",
        text = "",
        media = null,
        location = null,
        contact = null,
        poll = null,
        replyTo = null
    } = payload || {};

    if (
        !isObjectId(conversationId) ||
        typeof clientMsgId !== "string" ||
        !clientMsgId ||
        clientMsgId.length > 100 ||
        typeof text !== "string" ||
        !ALLOWED_TYPES.includes(type)
    ) {
        return { ok: false, error: "INVALID_PAYLOAD" };
    }

    // আগে duplicate চেক: নেটওয়ার্ক রিট্রাই/SW সিঙ্ক হলে নতুন করে সেভ না করে আগেরটাই ফেরত দেওয়া
    let msg = await Message.findOne({ sender: uid, clientMsgId })
        .populate(POPULATE_SENDER)
        .populate(POPULATE_REPLY);
    if (msg) {
        return { ok: true, message: msg, duplicate: true };
    }

    const conv = await Conversation.findById(conversationId);
    if (!conv || !conv.isMember(uid)) {
        return { ok: false, error: "FORBIDDEN_NOT_MEMBER" };
    }
    if (!conv.canSendMessage(uid)) {
        return { ok: false, error: "ONLY_ADMINS_CAN_MESSAGE" };
    }
    if (conv.type === "direct") {
        const partnerId = conv.members
            .map(m => m.toString())
            .find(id => id !== uid);
        const partner = await User.findById(partnerId)
            .select("isOfficial blockedUser")
            .lean();
        if (partner?.isOfficial) {
            return { ok: false, error: "OFFICIAL_ACCOUNT_READ_ONLY" };
        }
        const blocked =
            partner?.blockedUser?.some(b => String(b) === uid) ||
            (await User.exists({
                _id: uid,
                blockedUser: partnerId
            }));
        if (blocked) return { ok: false, error: "BLOCKED" };
    }

    const cleanText = text.trim();
    let cleanMedia;
    let cleanLocation;
    let cleanContact;
    let cleanPoll;

    if (type === "text") {
        if (!cleanText) return { ok: false, error: "EMPTY_MESSAGE" };
    } else if (type === "location") {
        cleanLocation = pickLocation(location);
        if (!cleanLocation) return { ok: false, error: "INVALID_LOCATION" };
    } else if (type === "contact") {
        cleanContact = pickContact(contact);
        if (!cleanContact) return { ok: false, error: "INVALID_CONTACT" };
    } else if (type === "poll") {
        const question = String(poll?.question || "").trim().slice(0, 200);
        const rawOpts = Array.isArray(poll?.options) ? poll.options : [];
        const cleanOpts = rawOpts
            .map(o => String(typeof o === "string" ? o : o?.text || "").trim().slice(0, 100))
            .filter(Boolean)
            .slice(0, 6);
        if (!question || cleanOpts.length < 2) {
            return { ok: false, error: "INVALID_POLL" };
        }
        cleanPoll = {
            question,
            allowMultiple: Boolean(poll?.allowMultiple),
            options: cleanOpts.map((optText, i) => ({
                id: `opt_${i}`,
                text: optText,
                votes: []
            }))
        };
    } else {
        cleanMedia = pickMedia(media);
        if (!cleanMedia?.url || !isValidCloudinaryUrl(cleanMedia.url)) {
            return { ok: false, error: "INVALID_MEDIA_URL" };
        }
    }
    if (cleanText.length > MAX_TEXT) {
        return { ok: false, error: "MESSAGE_TOO_LONG" };
    }

    let replyId = null;
    if (replyTo) {
        if (!isObjectId(replyTo)) return { ok: false, error: "INVALID_REPLY" };
        const target = await Message.exists({ _id: replyTo, conversationId });
        if (!target) return { ok: false, error: "INVALID_REPLY" };
        replyId = replyTo;
    }

    try {
        msg = await Message.create({
            conversationId,
            sender: uid,
            clientMsgId,
            type,
            text: cleanText,
            media: cleanMedia,
            location: cleanLocation,
            contact: cleanContact,
            poll: cleanPoll,
            replyTo: replyId,
            status: "sent"
        });
    } catch (err) {
        if (err?.code === 11000) {
            const existing = await Message.findOne({ sender: uid, clientMsgId })
                .populate(POPULATE_SENDER)
                .populate(POPULATE_REPLY);
            return { ok: true, message: existing, duplicate: true };
        }
        throw err;
    }
    msg = await msg.populate([POPULATE_SENDER, POPULATE_REPLY]);

    const inc = {};
    for (const m of conv.members) {
        const id = m.toString();
        if (id !== uid) inc[`unread.${id}`] = 1;
    }
    const lastMessageText =
        type === "poll"
            ? `📊 ${cleanPoll.question}`.slice(0, 100)
            : buildLastMessagePreview({
                  type,
                  text: cleanText,
                  media: cleanMedia,
                  location: cleanLocation,
                  contact: cleanContact
              });
    await Conversation.updateOne(
        { _id: conv._id },
        {
            $set: {
                lastMessage: {
                    messageId: msg._id,
                    text: lastMessageText,
                    type,
                    sender: uid,
                    createdAt: msg.createdAt
                }
            },
            $inc: inc
        }
    );

    const result = { ok: true, message: msg };
    onAck?.(result);

    if (io) {
        const memberRooms = conv.members.map(m => `user:${m.toString()}`);
        const emitter = excludeSocketId
            ? io.to(memberRooms).except(excludeSocketId)
            : io.to(memberRooms);
        emitter.emit("message:new", {
            message: msg,
            conversationId
        });
    }

    notifyRecipients({
        conv,
        msg,
        type,
        cleanText,
        senderId: uid,
        senderName: msg.sender?.fullName || senderFullName
    }).catch(err => console.error("[Message notify]", err.message));

    return result;
}

export const registerMessageHandlers = (io, socket) => {
    const userId = socket.user.id;
    let sentAt = [];

    const isRateLimited = () => {
        const now = Date.now();
        sentAt = sentAt.filter(t => now - t < RATE_WINDOW_MS);
        if (sentAt.length >= RATE_MAX) return true;
        sentAt.push(now);
        return false;
    };

    // ১. নতুন মেসেজ পাঠানো (১-টু-১ ও গ্রুপ দুটোর জন্যই)
    socket.on("message:send", async (payload, ack) => {
        try {
            if (isRateLimited()) {
                return ack?.({ ok: false, error: "RATE_LIMITED" });
            }
            let acked = false;
            const res = await sendMessageCore({
                io,
                userId,
                senderFullName: socket.user.fullName,
                payload,
                excludeSocketId: socket.id,
                onAck: r => {
                    acked = true;
                    ack?.(r);
                }
            });
            if (!acked) ack?.(res);
        } catch (error) {
            console.error("[Socket message:send Error]:", error.message);
            ack?.({ ok: false, error: "SERVER_ERROR" });
        }
    });

    // ২. সবার জন্য মেসেজ মুছে ফেলা (Delete for Everyone)
    socket.on("message:delete", async (payload, ack) => {
        try {
            const { messageId } = payload || {};
            if (!isObjectId(messageId)) {
                return ack?.({ ok: false, error: "INVALID_PAYLOAD" });
            }
            const msg = await Message.findById(messageId);
            if (!msg || msg.sender.toString() !== userId) {
                return ack?.({ ok: false, error: "NOT_ALLOWED" });
            }
            if (msg.deletedForEveryone) return ack?.({ ok: true });

            const oldMediaUrl = msg.media?.url;
            msg.deletedForEveryone = true;
            msg.text = "This message was deleted";
            msg.media = undefined;
            msg.location = undefined;
            msg.contact = undefined;
            await msg.save();
            // DB থেকে লিংক সরার পর Cloudinary থেকেও ফাইলটা মুছে ফেলা
            cleanupInBackground([oldMediaUrl]);

            // এটা যদি চ্যাটের শেষ মেসেজ হয়, চ্যাট লিস্টের প্রিভিউও বদলে দেওয়া
            await Conversation.updateOne(
                { _id: msg.conversationId, "lastMessage.messageId": msg._id },
                {
                    $set: {
                        "lastMessage.text": "This message was deleted",
                        "lastMessage.type": "text"
                    }
                }
            );

            const conv = await Conversation.findById(msg.conversationId, {
                members: 1
            }).lean();
            if (conv) {
                const memberRooms = conv.members.map(m => `user:${m.toString()}`);
                io.to(memberRooms).emit("message:deleted", {
                    messageId: msg._id,
                    conversationId: msg.conversationId
                });
            }
            ack?.({ ok: true });
        } catch (err) {
            console.error("[Socket message:delete Error]:", err.message);
            ack?.({ ok: false, error: "SERVER_ERROR" });
        }
    });

    // ৩. মেসেজে ইমোজি রিঅ্যাকশন দেওয়া/সরানো (টগল)
    socket.on("message:react", async (payload, ack) => {
        try {
            const { messageId, emoji } = payload || {};
            const cleanEmoji = String(emoji || "").trim();
            if (
                !isObjectId(messageId) ||
                !cleanEmoji ||
                cleanEmoji.length > 16
            ) {
                return ack?.({ ok: false, error: "INVALID_PAYLOAD" });
            }
            const msg = await Message.findById(messageId);
            if (!msg || msg.deletedForEveryone) {
                return ack?.({ ok: false, error: "NOT_FOUND" });
            }
            const conv = await Conversation.findById(msg.conversationId, {
                members: 1
            }).lean();
            if (!conv || !conv.members.some(m => String(m) === userId)) {
                return ack?.({ ok: false, error: "FORBIDDEN" });
            }

            const existingIdx = (msg.reactions || []).findIndex(
                r => String(r.user) === userId
            );
            if (existingIdx !== -1) {
                if (msg.reactions[existingIdx].emoji === cleanEmoji) {
                    msg.reactions.splice(existingIdx, 1);
                } else {
                    msg.reactions[existingIdx].emoji = cleanEmoji;
                    msg.reactions[existingIdx].createdAt = new Date();
                }
            } else {
                msg.reactions.push({
                    emoji: cleanEmoji,
                    user: userId,
                    createdAt: new Date()
                });
            }
            await msg.save();

            const reactions = msg.reactions.map(r => ({
                emoji: r.emoji,
                user: String(r.user),
                createdAt: r.createdAt
            }));
            const memberRooms = conv.members.map(m => `user:${m.toString()}`);
            io.to(memberRooms).emit("message:reacted", {
                conversationId: String(msg.conversationId),
                messageId: String(msg._id),
                reactions
            });
            ack?.({ ok: true, reactions });
        } catch (err) {
            console.error("[Socket message:react Error]:", err.message);
            ack?.({ ok: false, error: "SERVER_ERROR" });
        }
    });

    // ৪. নিজের পাঠানো টেক্সট মেসেজ এডিট করা (১৫ মিনিটের মধ্যে)
    socket.on("message:edit", async (payload, ack) => {
        try {
            const { messageId, text } = payload || {};
            const cleanText = String(text || "").trim();
            if (
                !isObjectId(messageId) ||
                !cleanText ||
                cleanText.length > MAX_TEXT
            ) {
                return ack?.({ ok: false, error: "INVALID_PAYLOAD" });
            }
            const msg = await Message.findById(messageId);
            if (
                !msg ||
                msg.sender.toString() !== userId ||
                msg.deletedForEveryone ||
                msg.type !== "text" ||
                msg.card?.kind
            ) {
                return ack?.({ ok: false, error: "NOT_ALLOWED" });
            }
            if (Date.now() - new Date(msg.createdAt).getTime() > EDIT_WINDOW_MS) {
                return ack?.({ ok: false, error: "EDIT_WINDOW_EXPIRED" });
            }

            msg.text = cleanText;
            msg.editedAt = new Date();
            await msg.save();

            await Conversation.updateOne(
                { _id: msg.conversationId, "lastMessage.messageId": msg._id },
                { $set: { "lastMessage.text": cleanText.slice(0, 100) } }
            );

            const conv = await Conversation.findById(msg.conversationId, {
                members: 1
            }).lean();
            if (conv) {
                const memberRooms = conv.members.map(m => `user:${m.toString()}`);
                io.to(memberRooms).emit("message:edited", {
                    conversationId: String(msg.conversationId),
                    messageId: String(msg._id),
                    text: msg.text,
                    editedAt: msg.editedAt
                });
            }
            ack?.({ ok: true, text: msg.text, editedAt: msg.editedAt });
        } catch (err) {
            console.error("[Socket message:edit Error]:", err.message);
            ack?.({ ok: false, error: "SERVER_ERROR" });
        }
    });

    // ৫. গ্রুপ পোলে ভোট দেওয়া/বদলানো
    socket.on("poll:vote", async (payload, ack) => {
        try {
            const { messageId, optionId } = payload || {};
            if (!isObjectId(messageId) || typeof optionId !== "string" || !optionId) {
                return ack?.({ ok: false, error: "INVALID_PAYLOAD" });
            }
            const msg = await Message.findById(messageId);
            if (!msg || msg.deletedForEveryone || msg.type !== "poll" || !msg.poll) {
                return ack?.({ ok: false, error: "NOT_FOUND" });
            }
            const conv = await Conversation.findById(msg.conversationId, {
                members: 1
            }).lean();
            if (!conv || !conv.members.some(m => String(m) === userId)) {
                return ack?.({ ok: false, error: "FORBIDDEN" });
            }

            const targetOpt = msg.poll.options.find(o => o.id === optionId);
            if (!targetOpt) {
                return ack?.({ ok: false, error: "INVALID_OPTION" });
            }

            const alreadyVoted = targetOpt.votes.some(v => String(v) === userId);
            if (alreadyVoted) {
                targetOpt.votes = targetOpt.votes.filter(v => String(v) !== userId);
            } else {
                if (!msg.poll.allowMultiple) {
                    for (const opt of msg.poll.options) {
                        opt.votes = opt.votes.filter(v => String(v) !== userId);
                    }
                }
                targetOpt.votes.push(userId);
            }
            await msg.save();

            const pollData = {
                question: msg.poll.question,
                allowMultiple: Boolean(msg.poll.allowMultiple),
                options: msg.poll.options.map(o => ({
                    id: o.id,
                    text: o.text,
                    votes: (o.votes || []).map(String)
                }))
            };
            const memberRooms = conv.members.map(m => `user:${m.toString()}`);
            io.to(memberRooms).emit("poll:updated", {
                conversationId: String(msg.conversationId),
                messageId: String(msg._id),
                poll: pollData
            });
            ack?.({ ok: true, poll: pollData });
        } catch (err) {
            console.error("[Socket poll:vote Error]:", err.message);
            ack?.({ ok: false, error: "SERVER_ERROR" });
        }
    });
};
