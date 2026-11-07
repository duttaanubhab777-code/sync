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
        } catch (error) {
            //Error handler
        }
    });
};
