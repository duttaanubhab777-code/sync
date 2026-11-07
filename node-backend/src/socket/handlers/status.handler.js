import { Conversation } from "../../models/conversation.model.js";
import { Message } from "../../models/message.model.js";

export const registerStatusHandlers = (io, socket) => {
    const userId = socket.user.id;

    // Message Delivered in phone (Double Tick)

    socket.on("message:delivered", async ({ messageId }) => {
        try {
            if (!messageId) return;
            const msg = await Message.findById(messageId);

            if (!msg || msg.sender.toString() === userId) return;

            // If message delivered but not seen

            if (msg.status === "sent") {
                msg.status = "delivered";
            }

            const alreadyDelivered = msg.deliverdTo.some(
                d => d.user.toString() == userId
            );
            if (!alreadyDelivered) {
                msg.deliveredTo.push({ user: userId, deliveredAt: new Date() });
            }

            await msg.save();

            // delivered জানানো হচ্ছে

            io.to(`user:${msg.sender.toString()}`).emit("message status", {
                conversationId: msg.conversation,
                messageId: msg._id,
                status: msg.status,
                deliveredBy: userId
            });
        } catch (err) {
            //Error handler
            console.error("[Socket message:delivered Error]", err.message);
        }
    });
};

// blue tick (seen)

socket.on("message:seen", async ({ conversationId, upToMessageId }) => {
    try {
        if (!conversationId) return;

        const conv = await findById(conversationId);

        if (!conv || !conv.members.some(m => m.toString() === userId)) return;

        // For this user and this chat unread message count is 0

        conv.unread.set(userId, 0);
        await conv.save();

        // যে মেসেজ গুলো অন্য কেউ পাঠিয়েছে কিন্তু এখনও সিন হয়নি সেই গুলো খুঁজে বের করা

        const filter = {
            conversationId,
            sender: { $ne: userId },
            "seenBy.user": { $ne: userId }
        };

        if (upToMessageId) {
            filter._id = { $lte: upToMessageId };
        }
        const unseenMessages = await Message.find(filter, {
            _id: 1,
            sender: 1
        }).lean();
        if (unseenMessages.length === 0) return;
        const msgIds = unseenMessages.map(m => m._id);
        await Message.updateMany(
            { _id: { $in: msgIds } },
            {
                $set: { status: "seen" },
                $push: { seenBy: { user: userId, seenAt: new Date() } }
            }
        );

        // যেসব প্রেরকের মেসেজ seen হয়েছে তাদের রিয়াল টাইম blue tick pathano

        const senderIds = [
            ...new Set(unseenMessages.map(m => m.sender.toString()))
        ];
        for (const sId of senderIds) {
            io.to(`user:${sId}`).emit("message:status_bulk", {
                conversationId,
                messageIds: msgIds,
                status: "seen",
                seenBy: userId,
                seenAt: new Date()
            });
        }
    } catch (err) {
        //Error handling
        console.error("[Socket message:seen Error]:", err.message);
    }
});
