import { addUserConnection, removeUserConnection, isUserOnline } from "../store.js";
import { User } from "../../models/user.model.js";
import { Conversation } from "../../models/conversation.model.js";

export const registerPresenceHandlers = (io, socket) => {
    const userId = socket.user.id;

    // ১. কানেক্ট হলে অনলাইন কাউন্টার বাড়ানো
    const { isFirstConnection } = addUserConnection(userId);

    Conversation.find({ members: userId }, { members: 1 })
        .lean()
        .then(convs => {
            // নিজের জন্য: আমার চ্যাটের কোন কোন মানুষ এখন অনলাইনে (নতুন ফোন/ট্যাব খুললে কাজে লাগে)
            const onlineUserIds = new Set();
            for (const c of convs) {
                for (const m of c.members) {
                    const id = m.toString();
                    if (id !== userId && isUserOnline(id)) onlineUserIds.add(id);
                }
            }
            socket.emit("presence:snapshot", {
                onlineUserIds: [...onlineUserIds]
            });

            // অন্যদের জন্য: আমি এইমাত্র অনলাইনে এলাম
            if (isFirstConnection && convs.length > 0) {
                const rooms = convs.map(c => `conv:${c._id.toString()}`);
                socket.to(rooms).emit("presence:update", {
                    userId,
                    online: true,
                    lastSeen: null
                });
            }
        })
        .catch(() => {});

    // ২. typing শুরু ও শেষ
    // socket.rooms.has(...) দিয়ে দেখা হয় ইউজার সত্যিই ওই চ্যাটের সদস্য কিনা (নইলে যে কেউ অন্যের চ্যাটে typing পাঠাতে পারত)
    const emitTyping = (conversationId, isTyping) => {
        if (!conversationId) return;
        const room = `conv:${conversationId}`;
        if (!socket.rooms.has(room)) return;
        socket.to(room).emit("typing", {
            conversationId,
            userId,
            fullName: socket.user.fullName,
            isTyping
        });
    };
    socket.on("typing:start", ({ conversationId } = {}) =>
        emitTyping(conversationId, true)
    );
    socket.on("typing:stop", ({ conversationId } = {}) =>
        emitTyping(conversationId, false)
    );

    // ৩. অ্যাপ বন্ধ বা ইন্টারনেট কেটে গেলে
    socket.on("disconnect", async () => {
        const { isCompletelyOffline } = removeUserConnection(userId);
        if (!isCompletelyOffline) return;

        const now = new Date();
        await User.findByIdAndUpdate(userId, { lastSeen: now }).catch(() => {});
        const convs = await Conversation.find({ members: userId }, { _id: 1 })
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
    });
};
