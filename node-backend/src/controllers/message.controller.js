import { Conversation } from "../models/conversation.model.js";
import { Message } from "../models/message.model.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { assertObjectId } from "../utils/helpers.js";
import {
    POPULATE_SENDER,
    POPULATE_REPLY,
    markDelivered
} from "../services/message.service.js";
import { loadMemberConversation } from "./conversation.controller.js";

const clamp = (value, fallback, min, max) =>
    Math.min(Math.max(Number(value) || fallback, min), max);

// GET /api/conversations/:id/messages?before=<messageId>&limit=30
// পুরনো মেসেজ পেছনের দিকে পেজ করে আনা। উত্তরে মেসেজ পুরনো -> নতুন ক্রমে থাকে।
// hasMore true হলে nextBefore পরের রিকোয়েস্টে `before` হিসেবে দাও।
export const getMessages = asyncHandler(async (req, res) => {
    const conv = await loadMemberConversation(req.params.id, req.user._id);
    const limit = clamp(req.query.limit, 30, 1, 100);

    const filter = { conversationId: conv._id, hidden: { $ne: true } };
    if (req.query.before) {
        filter._id = { $lt: assertObjectId(req.query.before, "before") };
    }

    const rows = await Message.find(filter)
        .sort({ _id: -1 })
        .limit(limit + 1)
        .populate(POPULATE_SENDER)
        .populate(POPULATE_REPLY)
        .select("-__v")
        .lean();

    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();
    rows.reverse();

    res.status(200).json(
        new ApiResponse(200, {
            messages: rows,
            hasMore,
            nextBefore: hasMore ? rows[0]._id : null
        })
    );
});

// GET /api/sync?after=<শেষ দেখা messageId>&since=<আগের serverTime>
// reconnect-এর পর মিস হওয়া জিনিস ফেরত দেয়:
//   messages — `after`-এর পরের সব নতুন মেসেজ (পুরনো -> নতুন, সর্বোচ্চ ২০০টা; hasMore true হলে আবার ডাকো)
//   updated  — `since`-এর পর বদলানো পুরনো মেসেজ (tick বদল, "delete for everyone")
//   serverTime — এটা রেখে দিয়ে পরের বার `since` হিসেবে পাঠাও (ফোনের ঘড়ির ভুল এড়াতে)
// `after` না দিলে messages ফাঁকা আসে (প্রথমবার চ্যাট লিস্ট + /messages ব্যবহার করো)
export const syncMessages = asyncHandler(async (req, res) => {
    const me = String(req.user._id);
    const io = req.app.get("io");
    const serverTime = new Date();
    const LIMIT = 200;

    const afterId = req.query.after
        ? assertObjectId(req.query.after, "after")
        : null;
    let since = null;
    if (req.query.since) {
        since = new Date(String(req.query.since));
        if (Number.isNaN(since.getTime())) {
            throw new ApiError(400, "Invalid since");
        }
    }

    const convIds = (
        await Conversation.find({ members: me }, { _id: 1 }).lean()
    ).map(c => c._id);

    let messages = [];
    let hasMore = false;
    if (afterId && convIds.length > 0) {
        const rows = await Message.find({
            conversationId: { $in: convIds },
            hidden: { $ne: true },
            _id: { $gt: afterId }
        })
            .sort({ _id: 1 })
            .limit(LIMIT + 1)
            .populate(POPULATE_SENDER)
            .populate(POPULATE_REPLY)
            .select("-__v")
            .lean();
        hasMore = rows.length > LIMIT;
        if (hasMore) rows.pop();
        messages = rows;

        // যে মেসেজগুলো পেলাম, সেগুলো "delivered" (প্রেরকরা ডাবল টিক দেখবে)
        const incoming = messages
            .filter(m => String(m.sender?._id ?? m.sender) !== me)
            .map(m => m._id);
        markDelivered(io, me, incoming).catch(err =>
            console.error("[sync markDelivered]", err.message)
        );
    }

    let updated = [];
    if (since && convIds.length > 0) {
        const filter = {
            conversationId: { $in: convIds },
            updatedAt: { $gt: since }
        };
        // `after`-এর পরের মেসেজ আগেই messages-এ আছে, তাই এখানে শুধু পুরনোগুলো
        if (afterId) filter._id = { $lte: afterId };
        updated = await Message.find(filter)
            .sort({ updatedAt: 1 })
            .limit(300)
            .select("conversationId status deletedForEveryone text type media updatedAt")
            .lean();
    }

    res.status(200).json(
        new ApiResponse(200, {
            messages,
            hasMore,
            updated,
            serverTime: serverTime.toISOString()
        })
    );
});
