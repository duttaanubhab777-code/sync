import { Conversation } from "../../models/conversation.model.js";
import { Message } from "../../models/message.model.js";
import { markDelivered, markSeen } from "../../services/message.service.js";

export const registerStatusHandlers = (io, socket) => {
    const userId = socket.user.id;

    // মেসেজ ফোনে পৌঁছেছে (Double Tick)
    // payload: { messageId } অথবা একসাথে অনেকগুলো { messageIds: [...] }
    socket.on("message:delivered", async payload => {
        try {
            const { messageId, messageIds } = payload || {};
            await markDelivered(
                io,
                userId,
                Array.isArray(messageIds) ? messageIds : [messageId]
            );
        } catch (err) {
            console.error("[Socket message:delivered Error]:", err.message);
        }
    });

    // চ্যাট খুলে মেসেজ দেখা হয়েছে (Blue Tick) + unread ০
    // payload: { conversationId, upToMessageId? }
    socket.on("message:seen", async payload => {
        try {
            const { conversationId, upToMessageId } = payload || {};
            await markSeen(io, userId, conversationId, upToMessageId);
        } catch (err) {
            console.error("[Socket message:seen Error]:", err.message);
        }
    });

    // কানেক্ট হওয়ামাত্র: অফলাইন থাকার সময় আসা মেসেজগুলো delivered করা,
    // যাতে প্রেরকের এক টিক ✓ ডাবল টিক ✓✓ হয়ে যায়
    (async () => {
        try {
            const convs = await Conversation.find(
                { members: userId },
                { _id: 1 }
            ).lean();
            if (convs.length === 0) return;

            const pending = await Message.find(
                {
                    conversationId: { $in: convs.map(c => c._id) },
                    sender: { $ne: userId },
                    "deliveredTo.user": { $ne: userId }
                },
                { _id: 1 }
            )
                .sort({ _id: -1 })
                .limit(500)
                .lean();
            await markDelivered(
                io,
                userId,
                pending.map(m => m._id)
            );
        } catch (err) {
            console.error("[Socket delivered-on-connect Error]:", err.message);
        }
    })();
};
