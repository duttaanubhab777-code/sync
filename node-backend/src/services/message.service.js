import { Conversation } from "../models/conversation.model.js";
import { Message } from "../models/message.model.js";
import { isObjectId } from "../utils/helpers.js";

export const POPULATE_SENDER = {
    path: "sender",
    select: "username fullName avatar"
};
export const POPULATE_REPLY = {
    path: "replyTo",
    select: "text type sender media.url deletedForEveryone"
};

const RANK = { sent: 0, delivered: 1, seen: 2 };

// দেওয়া মেসেজগুলোর status (sent → delivered → seen) নতুন করে হিসাব করে DB-তে লেখে,
// তারপর প্রেরকদের রিয়েল-টাইমে জানায়।
// গ্রুপে "delivered"/"seen" হয় তখনই, যখন প্রেরক বাদে সব সদস্য পেয়ে/দেখে ফেলেছে।
const refreshStatuses = async (io, messageIds, byUserId) => {
    if (messageIds.length === 0) return;

    const msgs = await Message.find(
        { _id: { $in: messageIds } },
        {
            sender: 1,
            conversationId: 1,
            status: 1,
            "deliveredTo.user": 1,
            "seenBy.user": 1
        }
    ).lean();

    const convIds = [...new Set(msgs.map(m => String(m.conversationId)))];
    const convs = await Conversation.find(
        { _id: { $in: convIds } },
        { members: 1 }
    ).lean();
    const membersOf = new Map(
        convs.map(c => [String(c._id), c.members.map(String)])
    );

    const upgrades = new Map(); // নতুন status -> [message]
    for (const m of msgs) {
        const senderId = String(m.sender);
        const others = (membersOf.get(String(m.conversationId)) || []).filter(
            id => id !== senderId
        );
        if (others.length === 0) continue;

        const seen = new Set((m.seenBy || []).map(s => String(s.user)));
        const delivered = new Set(
            (m.deliveredTo || []).map(d => String(d.user))
        );

        let next = "sent";
        if (others.every(id => seen.has(id))) next = "seen";
        else if (others.every(id => seen.has(id) || delivered.has(id)))
            next = "delivered";

        if (RANK[next] > RANK[m.status]) {
            if (!upgrades.has(next)) upgrades.set(next, []);
            upgrades.get(next).push(m);
        }
    }

    const now = new Date();
    for (const [status, list] of upgrades) {
        await Message.updateMany(
            { _id: { $in: list.map(m => m._id) } },
            { $set: { status } }
        );

        // (প্রেরক, চ্যাট) ধরে ভাগ করে একটা করে ইভেন্ট
        const groups = new Map();
        for (const m of list) {
            const key = `${m.sender}|${m.conversationId}`;
            if (!groups.has(key)) {
                groups.set(key, {
                    sender: String(m.sender),
                    conversationId: m.conversationId,
                    messageIds: []
                });
            }
            groups.get(key).messageIds.push(m._id);
        }
        for (const g of groups.values()) {
            io.to(`user:${g.sender}`).emit("message:status_bulk", {
                conversationId: g.conversationId,
                messageIds: g.messageIds,
                status,
                by: byUserId,
                at: now
            });
        }
    }
};

// userId-র ফোনে মেসেজ পৌঁছে গেছে (Double Tick)
export const markDelivered = async (io, userId, messageIds) => {
    const ids = [...new Set((messageIds || []).map(String))]
        .filter(isObjectId)
        .slice(0, 500);
    if (ids.length === 0) return;

    // অন্যের পাঠানো আর আমার জন্য এখনো delivered হয়নি এমন মেসেজ
    const msgs = await Message.find(
        {
            _id: { $in: ids },
            sender: { $ne: userId },
            "deliveredTo.user": { $ne: userId }
        },
        { conversationId: 1 }
    ).lean();
    if (msgs.length === 0) return;

    // ইউজার সত্যিই ওই চ্যাটের সদস্য কিনা
    const convIds = [...new Set(msgs.map(m => String(m.conversationId)))];
    const myConvs = await Conversation.find(
        { _id: { $in: convIds }, members: userId },
        { _id: 1 }
    ).lean();
    const allowedConv = new Set(myConvs.map(c => String(c._id)));
    const allowed = msgs
        .filter(m => allowedConv.has(String(m.conversationId)))
        .map(m => m._id);
    if (allowed.length === 0) return;

    await Message.updateMany(
        { _id: { $in: allowed }, "deliveredTo.user": { $ne: userId } },
        { $push: { deliveredTo: { user: userId, deliveredAt: new Date() } } }
    );
    await refreshStatuses(io, allowed, userId);
};

// userId এই চ্যাটের মেসেজ দেখেছে (Blue Tick) + তার unread সংখ্যা ০
export const markSeen = async (
    io,
    userId,
    conversationId,
    upToMessageId = null
) => {
    if (!isObjectId(conversationId)) return;

    const conv = await Conversation.findOne(
        { _id: conversationId, members: userId },
        { _id: 1 }
    ).lean();
    if (!conv) return;

    // timestamps: false — "দেখা" হলে যেন চ্যাট লিস্টের ক্রম বদলে না যায়
    await Conversation.updateOne(
        { _id: conv._id },
        { $set: { [`unread.${userId}`]: 0 } },
        { timestamps: false }
    );
    // ইউজারের অন্য ডিভাইসেও unread ০ করার জন্য
    io.to(`user:${userId}`).emit("conversation:read", {
        conversationId: conv._id
    });

    const filter = {
        conversationId: conv._id,
        sender: { $ne: userId },
        "seenBy.user": { $ne: userId }
    };
    if (upToMessageId && isObjectId(upToMessageId)) {
        filter._id = { $lte: upToMessageId };
    }
    const unseen = await Message.find(filter, { _id: 1 })
        .sort({ _id: -1 })
        .limit(1000)
        .lean();
    if (unseen.length === 0) return;

    const ids = unseen.map(m => m._id);
    const now = new Date();
    // দেখা মানেই পাওয়া, তাই delivered-ও ভরে দেওয়া
    await Message.updateMany(
        { _id: { $in: ids }, "deliveredTo.user": { $ne: userId } },
        { $push: { deliveredTo: { user: userId, deliveredAt: now } } }
    );
    await Message.updateMany(
        { _id: { $in: ids }, "seenBy.user": { $ne: userId } },
        { $push: { seenBy: { user: userId, seenAt: now } } }
    );
    await refreshStatuses(io, ids, userId);
};
