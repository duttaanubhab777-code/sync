import { Conversation } from "../../models/conversation.model.js";
import { Message } from "../../models/message.model.js";

// আমাদের অ্যাকাউন্ট এর cloudinary url কিনা টা যাচাই করা
const isValidCloudinaryUrl = url => {
    if (!url || typeof url !== "string") {
        return false;
    }
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;

    if (!cloudName) {
        return url.startsWith("https://res.cloudinary.com/");
    }
    return url.startsWith(`https://res.cloudinary.com/${cloudName}/`);
};

export const registerMessageHandlers = (io, socket) => {
    const userId = socket.user.id;
    // for 1 to 1 new messages

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

            if (!conversationId || !clientMsgId) {
                return ack?.({ ok: false, error: "INVALID_PAYLOAD" });
            }

            //find conversation and search user member of this conversation
            const conv = await Conversation.findById(conversationId);

            if (!conv || !conv.members.some(m => m.toString() === userId)) {
                return ack?.({ ok: false, error: "FORBIDDEN_NOT_MEMBER" });
            }

            // if only admin can send message
            if (
                conv.type === "group" &&
                conv.onlyAdminsCanMessage &&
                !conv.admins.some(a => a.toString() === userId)
            ) {
                return ack?.({ ok: false, error: "ONLY_ADMINS_CAN_MESSAGE" });
            }

            // check that media url is our cloudinary url

            if (type !== "text") {
                if (!media?.url || isValidCloudinaryUrl(media.url)) {
                    return ack?.({ ok: false, error: "INVALID_MEDIA_URL" });
                }
            } else if (!text.trim()) {
                return ack?.({ ok: false, error: "EMPTY_MESSAGE" });
            }

            //duplicate message check

            let msg = await Message.findOne({ sender: userId, clientMsgId })
                .populate("sender", "username fullName avatar")
                .populate("replyTo", "text type media.url");

            if (msg) {
                return ack?.({ ok: true, message: msg, duplicate: true });
            }

            // new message save in database

            msg = await Message.create({
                conversationId,
                sender: userId,
                clientMsgId,
                type,
                text: text.trim(),
                media: type !== "text" ? media : undefined,
                replyTo: replyTo || null,
                status: "sent"
            });
            msg = await msg.populate([
                { path: "sender", select: "username fullName avatar" },
                { path: "replyTo", select: "text type sender media.url" }
            ]);

            // preview unread messages

            const previewText =
                type === "text"
                    ? text.trim().slice(0, 100)
                    : `[${type.toUpperCase()}]`;

            for (const memberId of conv.members) {
                const mStr = memberId.toString();
                if (mStr !== userId) {
                    const prevUnread = conv.unread.get(mStr) || 0;
                    conv.unread.set(mStr, prevUnread + 1);
                }
            }

            conv.lastMessage = {
                messageId: msg._id,
                text: previewText,
                type,
                sender: userId,
                createdAt: msg.createdAt
            };
            await conv.save();
            // প্রে রককে প্রা প্তি স্বী কা র (Ack -> Single Tick ✓) পা ঠা নো
            ack?.({ ok: true, message: msg });
            // কনভা রসে শনে র সব সদস্যে র সব ডি ভা ইসে রি য়ে ল-টা ইমে মে সে জ পা ঠা নো
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
    // ২. মে সে জ সবা র জন্য মুছেমুছে ফে লা (Delete for Everyone)
    socket.on("message:delete", async ({ messageId }, ack) => {
        try {
            const msg = await Message.findById(messageId);
            if (!msg || msg.sender.toString() !== userId) {
                return ack?.({ ok: false, error: "NOT_ALLOWED" });
            }
            msg.deletedForEveryone = true;
            msg.text = "This message was deleted for evryone";
            msg.media = undefined;
            await msg.save();
            const conv = await Conversation.findById(msg.conversationId, {
                members: 1
            }).lean();
            if (conv) {
                const memberRooms = conv.members.map(
                    m => `user:${m.toString()}`
                );
                io.to(memberRooms).emit("message:deleted", {
                    messageId: msg._id,
                    conversationId: msg.conversationId
                });
            }
            ack?.({ ok: true });
        } catch {
            // Error handling

            ack?.({ ok: false, error: "SERVER_ERROR" });
        }
    });
};
