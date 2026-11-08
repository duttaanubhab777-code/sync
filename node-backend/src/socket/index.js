import { Server } from "socket.io";
import { corsOptions } from "../app.js";
import { verifySocketToken } from "../middlewares/auth.middleware.js";
import { Conversation } from "../models/conversation.model.js";
import { registerMessageHandlers } from "./handlers/message.handler.js";
import { registerPresenceHandlers } from "./handlers/presence.handler.js";
import { registerStatusHandlers } from "./handlers/status.handler.js";

export const initSocket = httpServer => {
    const io = new Server(httpServer, {
        cors: corsOptions,
        pingTimeout: 25000,
        pingInterval: 10000
    });

    // ১. প্রতিটা কানেকশনে JWT token যাচাই
    io.use(verifySocketToken);

    // ২. ইউজার সফলভাবে কানেক্ট হলে
    io.on("connection", socket => {
        const userId = socket.user.id;

        // নিজের ব্যক্তিগত রুমে ঢোকা (এর ফলে তার সব ডিভাইসে মেসেজ যায়)
        socket.join(`user:${userId}`);

        // handler গুলো আগে (await ছাড়াই) বসানো হয়, নইলে কানেক্ট হওয়ার সাথে সাথে
        // client যে event পাঠায় সেগুলো হারিয়ে যেতে পারে
        registerPresenceHandlers(io, socket);
        registerMessageHandlers(io, socket);
        registerStatusHandlers(io, socket);

        // ৩. ইউজার যেসব চ্যাট/গ্রুপের সদস্য, সেসব রুমে ঢোকানো (typing ও presence এর জন্য)
        Conversation.find({ members: userId }, { _id: 1 })
            .lean()
            .then(convs => {
                for (const c of convs) socket.join(`conv:${c._id.toString()}`);
            })
            .catch(err =>
                console.error(
                    "[Socket] Failed to join conversation rooms:",
                    err.message
                )
            );
    });

    return io;
};
