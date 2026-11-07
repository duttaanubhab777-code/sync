import { addUserConnection, removeUserConnection } from "../store.js";
import { User } from "../../models/user.model.js";
import { Conversation } from "../../conversation.model.js";

export const registerPresenceHandlers = (io, socket) => {
    const userId = socket.user.id;

    // if user connected then online count increase

    const { isFirstConnection } = addUserConnection(userId);
    if (isFirstConnection) {
        // জানানো যে অনলাইন এসেছে
        Conversation.find({ members: userId }, { _id: 1 })
            .lean()
            .then(convs => {
                const rooms = convs.map(c => `conv:${c._id.toString()}`);
                if (rooms.length > 0) {
                    io.to(rooms).emit("presence:update", {
                        userId,
                        online: true,
                        lastSeen: null
                    });
                }
            })
            .catch(() => {});
    }

    // Typing start and typing end
    socket.on("typing:start", ({ conversationId }) => {
        if (!conversationId) return;
        socket.to(`conv:${conversationId}`).emit("typing", {
            conversationId,
            userId,
            fullName: socket.user.fullName,
            isTyping: true
        });
    });
    socket.on("typing:stop", ({ conversationId }) => {
        if (!conversationId) return;
        socket.to(`conv:${conversationId}`).emit("typing", {
            conversationId,
            userId,
            fullName: socket.user.fullName,
            isTyping: false
        });
    });

    // user cut app and ofline
    socket.on("disconnect", async () => {
        const { isCompletelyOffline } = removeUserConnection(userId);
        if (isCompletelyOffline) {
            const now = new Date();
            await User.findByIdAndUpdate(userId, { lastSeen: now }).catch(
                () => {}
            );
            const convs = await Conversation.find(
                { members: userId },
                { _id: 1 }
            )
                .lean()
                .catch(() => []);
            const rooms = convs.map(c => `conv:${c._id.toString()}`);
            if (rooms.length > 0) {
                io.to(rooms).emit("presence:update", {
                    userId,
                    online: false,
                    lastSeen: now
                });
            }
        }
    });
};
