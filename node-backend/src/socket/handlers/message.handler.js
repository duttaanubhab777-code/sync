import { Conversation } from "../../models/conversation.model.js";
import { Message } from "../../models/message.model.js";
import { User } from "../../models/user.model.js";
import { isValidCloudinaryUrl, pickMedia } from "../../utils/cloudinary.js";
import { isObjectId } from "../../utils/helpers.js";

const ALLOWED_TYPES = ["text", "image", "video", "audio", "file"];
const MAX_TEXT = 4000;

// একটা socket থেকে ১০ সেকেন্ডে সর্বোচ্চ ২০টা মেসেজ (spam/flood ঠেকাতে)
const RATE_WINDOW_MS = 10_000;
const RATE_MAX = 20;

const POPULATE_SENDER = { path: "sender", select: "username fullName avatar" };
const POPULATE_REPLY = {
    path: "replyTo",
    select: "text type sender media.url deletedForEveryone"
};

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
            const {
                conversationId,
                clientMsgId,
                type = "text",
                text = "",
                media = null,
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
                return ack?.({ ok: false, error: "INVALID_PAYLOAD" });
            }

            if (isRateLimited()) {
                return ack?.({ ok: false, error: "RATE_LIMITED" });
            }

            // আগে duplicate চেক: নেটওয়ার্ক রিট্রাই হলে নতুন করে সেভ না করে আগেরটাই ফেরত দেওয়া
            let msg = await Message.findOne({ sender: userId, clientMsgId })
                .populate(POPULATE_SENDER)
                .populate(POPULATE_REPLY);
            if (msg) {
                return ack?.({ ok: true, message: msg, duplicate: true });
            }

            // কনভারসেশন আছে কিনা, ইউজার সদস্য কিনা, গ্রুপে "শুধু admin" চালু আছে কিনা
            const conv = await Conversation.findById(conversationId);
            if (!conv || !conv.isMember(userId)) {
                return ack?.({ ok: false, error: "FORBIDDEN_NOT_MEMBER" });
            }
            if (!conv.canSendMessage(userId)) {
                return ack?.({ ok: false, error: "ONLY_ADMINS_CAN_MESSAGE" });
            }
            // direct চ্যাটে কেউ কাউকে block করে থাকলে মেসেজ যাবে না
            if (conv.type === "direct") {
                const partnerId = conv.members
                    .map(m => m.toString())
                    .find(id => id !== userId);
                const blocked = await User.exists({
                    $or: [
                        { _id: userId, blockedUser: partnerId },
                        { _id: partnerId, blockedUser: userId }
                    ]
                });
                if (blocked) return ack?.({ ok: false, error: "BLOCKED" });
            }

            const cleanText = text.trim();
            let cleanMedia;
            if (type === "text") {
                if (!cleanText) return ack?.({ ok: false, error: "EMPTY_MESSAGE" });
            } else {
                cleanMedia = pickMedia(media);
                if (!cleanMedia?.url || !isValidCloudinaryUrl(cleanMedia.url)) {
                    return ack?.({ ok: false, error: "INVALID_MEDIA_URL" });
                }
            }
            if (cleanText.length > MAX_TEXT) {
                return ack?.({ ok: false, error: "MESSAGE_TOO_LONG" });
            }

            // reply করলে ওই মেসেজ একই চ্যাটের কিনা দেখা
            let replyId = null;
            if (replyTo) {
                if (!isObjectId(replyTo)) {
                    return ack?.({ ok: false, error: "INVALID_REPLY" });
                }
                const target = await Message.exists({
                    _id: replyTo,
                    conversationId
                });
                if (!target) return ack?.({ ok: false, error: "INVALID_REPLY" });
                replyId = replyTo;
            }

            try {
                msg = await Message.create({
                    conversationId,
                    sender: userId,
                    clientMsgId,
                    type,
                    text: cleanText,
                    media: cleanMedia,
                    replyTo: replyId,
                    status: "sent"
                });
            } catch (err) {
                // দুটো একই মেসেজ একসাথে এলে unique index একটাকে আটকায়, তখন আগেরটাই ফেরত দিই
                if (err?.code === 11000) {
                    const existing = await Message.findOne({
                        sender: userId,
                        clientMsgId
                    })
                        .populate(POPULATE_SENDER)
                        .populate(POPULATE_REPLY);
                    return ack?.({ ok: true, message: existing, duplicate: true });
                }
                throw err;
            }
            msg = await msg.populate([POPULATE_SENDER, POPULATE_REPLY]);

            // চ্যাট লিস্টের প্রিভিউ আর বাকিদের unread সংখ্যা এক query-তে atomic ভাবে আপডেট
            // (conv.save() না করে updateOne, যাতে দুটো মেসেজ একসাথে এলে একটা আরেকটাকে ওভাররাইট না করে)
            const inc = {};
            for (const m of conv.members) {
                const id = m.toString();
                if (id !== userId) inc[`unread.${id}`] = 1;
            }
            await Conversation.updateOne(
                { _id: conv._id },
                {
                    $set: {
                        lastMessage: {
                            messageId: msg._id,
                            text:
                                type === "text"
                                    ? cleanText.slice(0, 100)
                                    : `[${type.toUpperCase()}]`,
                            type,
                            sender: userId,
                            createdAt: msg.createdAt
                        }
                    },
                    $inc: inc
                }
            );

            // প্রেরককে প্রাপ্তিস্বীকার (Ack -> Single Tick ✓)
            ack?.({ ok: true, message: msg });

            // সব সদস্যের সব ডিভাইসে রিয়েল-টাইম মেসেজ (যে socket থেকে পাঠানো হলো সেটা বাদে)
            const memberRooms = conv.members.map(m => `user:${m.toString()}`);
            io.to(memberRooms).except(socket.id).emit("message:new", {
                message: msg,
                conversationId
            });
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

            msg.deletedForEveryone = true;
            msg.text = "This message was deleted";
            msg.media = undefined;
            await msg.save();

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
};
