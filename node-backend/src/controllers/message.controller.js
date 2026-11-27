import { Conversation } from "../models/conversation.model.js";
import { Message } from "../models/message.model.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { randomUUID } from "node:crypto";
import { User } from "../models/user.model.js";
import { assertObjectId, escapeRegex, isObjectId } from "../utils/helpers.js";
import { buildLastMessagePreview } from "../utils/attachments.js";
import { isValidAckToken } from "../utils/deliveryAck.js";
import {
    POPULATE_SENDER,
    POPULATE_REPLY,
    markDelivered
} from "../services/message.service.js";
import { loadMemberConversation } from "./conversation.controller.js";
import { sendMessageCore } from "../socket/handlers/message.handler.js";

const clamp = (value, fallback, min, max) =>
    Math.min(Math.max(Number(value) || fallback, min), max);

// GET /api/v1/chats/:id/messages?before=<messageId>&limit=30
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

// GET /api/v1/messages/sync?after=<শেষ দেখা messageId>&since=<আগের serverTime>
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
            .select("conversationId status deletedForEveryone text type media location contact poll reactions editedAt updatedAt")
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

// POST /api/v1/messages/delivery-ack   body: { userId, messageId, token }
// Push notification ফোনে পৌঁছালে (অ্যাপ বন্ধ থাকলেও) ফোন এটা ডাকে, তখনই প্রেরকের ডাবল টিক হয়।
// লগইন টোকেন লাগে না; সার্ভারের দেওয়া স্বাক্ষরিত টোকেনই প্রমাণ। ভুল হলে চুপচাপ 204।
export const deliveryAck = asyncHandler(async (req, res) => {
    const { userId, messageId, token } = req.body || {};
    if (
        isObjectId(userId) &&
        isObjectId(messageId) &&
        isValidAckToken(userId, messageId, token)
    ) {
        const io = req.app.get("io");
        await markDelivered(io, String(userId), [String(messageId)]);
    }
    res.status(204).end();
});

// GET /api/v1/messages/:id/info — নিজের পাঠানো মেসেজ কখন পাঠানো / পৌঁছানো / দেখা হয়েছে (WhatsApp-এর Message info)
export const getMessageInfo = asyncHandler(async (req, res) => {
    const id = assertObjectId(req.params.id, "message id");
    const me = String(req.user._id);

    const msg = await Message.findById(id)
        .select("sender conversationId status createdAt deliveredTo seenBy")
        .populate({ path: "deliveredTo.user", select: "fullName username avatar" })
        .populate({ path: "seenBy.user", select: "fullName username avatar" })
        .lean();
    if (!msg || String(msg.sender) !== me) {
        throw new ApiError(404, "Message not found");
    }
    const conv = await loadMemberConversation(msg.conversationId, me);

    const pick = (list, timeKey) =>
        (list || [])
            .filter(x => x.user && String(x.user._id ?? x.user) !== me)
            .map(x => ({
                user: {
                    _id: String(x.user._id ?? x.user),
                    fullName: x.user.fullName || "",
                    username: x.user.username || "",
                    avatar: x.user.avatar || ""
                },
                at: x[timeKey]
            }));

    res.status(200).json(
        new ApiResponse(200, {
            messageId: String(msg._id),
            isGroup: conv.type === "group",
            status: msg.status,
            sentAt: msg.createdAt,
            deliveredTo: pick(msg.deliveredTo, "deliveredAt"),
            seenBy: pick(msg.seenBy, "seenAt")
        })
    );
});

// GET /api/v1/chats/:id/search?q=... — চ্যাটের ভেতর মেসেজ সার্চ করা
export const searchConversationMessages = asyncHandler(async (req, res) => {
    const conv = await loadMemberConversation(req.params.id, req.user._id);
    const q = String(req.query.q || "").trim();
    if (q.length < 2) {
        return res.status(200).json(new ApiResponse(200, { messages: [] }));
    }
    const rx = new RegExp(escapeRegex(q.slice(0, 80)), "i");
    const rows = await Message.find({
        conversationId: conv._id,
        hidden: { $ne: true },
        deletedForEveryone: { $ne: true },
        $or: [
            { text: rx },
            { "media.fileName": rx },
            { "poll.question": rx }
        ]
    })
        .sort({ _id: -1 })
        .limit(30)
        .populate(POPULATE_SENDER)
        .select("-__v")
        .lean();

    res.status(200).json(new ApiResponse(200, { messages: rows }));
});

const URL_EXTRACT_RE = /https?:\/\/[^\s<>"']+/gi;

// GET /api/v1/chats/:id/media?tab=media|files|links — Shared Media, Docs & Links গ্যালারি
export const getSharedMedia = asyncHandler(async (req, res) => {
    const conv = await loadMemberConversation(req.params.id, req.user._id);
    const tab = ["media", "files", "links"].includes(req.query.tab)
        ? req.query.tab
        : "media";
    const base = {
        conversationId: conv._id,
        hidden: { $ne: true },
        deletedForEveryone: { $ne: true }
    };

    if (tab === "media") {
        const items = await Message.find({
            ...base,
            type: { $in: ["image", "video"] },
            "media.url": { $exists: true, $ne: "" }
        })
            .sort({ _id: -1 })
            .limit(60)
            .populate(POPULATE_SENDER)
            .select("type media text sender createdAt")
            .lean();
        return res.status(200).json(new ApiResponse(200, { tab, items }));
    }

    if (tab === "files") {
        const items = await Message.find({
            ...base,
            type: "file",
            "media.url": { $exists: true, $ne: "" }
        })
            .sort({ _id: -1 })
            .limit(60)
            .populate(POPULATE_SENDER)
            .select("type media text sender createdAt")
            .lean();
        return res.status(200).json(new ApiResponse(200, { tab, items }));
    }

    const rows = await Message.find({
        ...base,
        type: "text",
        text: /https?:\/\//i
    })
        .sort({ _id: -1 })
        .limit(60)
        .populate(POPULATE_SENDER)
        .select("text sender createdAt")
        .lean();

    const links = [];
    for (const r of rows) {
        const matches = String(r.text || "").match(URL_EXTRACT_RE) || [];
        for (const raw of matches) {
            const href = raw.replace(/[),.!?;:]+$/, "");
            try {
                const u = new URL(href);
                if (!["http:", "https:"].includes(u.protocol)) continue;
                links.push({
                    _id: `${r._id}_${links.length}`,
                    messageId: r._id,
                    url: u.href,
                    host: u.hostname,
                    snippet: String(r.text || "").slice(0, 140),
                    sender: r.sender,
                    createdAt: r.createdAt
                });
            } catch {
                // ignore invalid URLs
            }
        }
    }
    res.status(200).json(new ApiResponse(200, { tab, items: links.slice(0, 60) }));
});

// POST /api/v1/messages/:id/forward   body: { targetConversationIds: [...] } — অন্য চ্যাটে মেসেজ ফরওয়ার্ড করা
export const forwardMessage = asyncHandler(async (req, res) => {
    const me = String(req.user._id);
    const io = req.app.get("io");
    const msgId = assertObjectId(req.params.id, "message id");
    const rawTargets = Array.isArray(req.body?.targetConversationIds)
        ? req.body.targetConversationIds
        : [];
    const targetIds = [...new Set(rawTargets.map(String))]
        .filter(isObjectId)
        .slice(0, 5);
    if (targetIds.length === 0) {
        throw new ApiError(400, "Select at least one chat to forward to");
    }

    const source = await Message.findById(msgId).lean();
    if (!source || source.deletedForEveryone || source.hidden) {
        throw new ApiError(404, "Message not found");
    }
    if (source.type === "poll" || source.card?.kind) {
        throw new ApiError(400, "This message cannot be forwarded");
    }
    await loadMemberConversation(source.conversationId, me);

    const created = [];
    for (const targetId of targetIds) {
        const targetConv = await Conversation.findById(targetId);
        if (!targetConv || !targetConv.isMember(me)) continue;
        if (!targetConv.canSendMessage(me)) continue;

        if (targetConv.type === "direct") {
            const partnerId = targetConv.members
                .map(m => m.toString())
                .find(id => id !== me);
            const partner = await User.findById(partnerId)
                .select("isOfficial blockedUser")
                .lean();
            if (partner?.isOfficial) continue;
            const blocked =
                partner?.blockedUser?.some(b => String(b) === me) ||
                req.user.blockedUser?.some(b => String(b) === partnerId);
            if (blocked) continue;
        }

        let newMsg = await Message.create({
            conversationId: targetConv._id,
            sender: req.user._id,
            clientMsgId: `fwd:${randomUUID()}`,
            type: source.type,
            text: source.text || "",
            media: source.media?.url ? source.media : undefined,
            location: source.location?.lat !== undefined ? source.location : undefined,
            contact: source.contact?.name ? source.contact : undefined,
            forwarded: true,
            status: "sent"
        });
        newMsg = await newMsg.populate(POPULATE_SENDER);

        const inc = {};
        for (const m of targetConv.members) {
            const id = m.toString();
            if (id !== me) inc[`unread.${id}`] = 1;
        }
        const preview = buildLastMessagePreview({
            type: newMsg.type,
            text: newMsg.text,
            media: newMsg.media,
            location: newMsg.location,
            contact: newMsg.contact
        });
        await Conversation.updateOne(
            { _id: targetConv._id },
            {
                $set: {
                    lastMessage: {
                        messageId: newMsg._id,
                        text: preview,
                        type: newMsg.type,
                        sender: req.user._id,
                        createdAt: newMsg.createdAt
                    }
                },
                $inc: inc
            }
        );

        const memberRooms = targetConv.members.map(m => `user:${m.toString()}`);
        io?.to(memberRooms).emit("message:new", {
            message: newMsg,
            conversationId: targetConv._id
        });
        created.push({
            conversationId: String(targetConv._id),
            messageId: String(newMsg._id)
        });
    }

    if (created.length === 0) {
        throw new ApiError(400, "Could not forward message to selected chats");
    }
    res.status(201).json(
        new ApiResponse(
            201,
            { forwarded: created },
            `Forwarded to ${created.length} chat${created.length > 1 ? "s" : ""}`
        )
    );
});

// POST /api/v1/messages
// Service Worker Background Sync ও Socket অফলাইন থাকা অবস্থায় মেসেজ পাঠানোর REST এন্ডপয়েন্ট
export const sendMessageRest = asyncHandler(async (req, res) => {
    const result = await sendMessageCore({
        io: req.app.get("io"),
        userId: req.user._id,
        senderFullName: req.user.fullName || "",
        payload: req.body || {}
    });

    if (!result.ok) {
        const status =
            result.error === "FORBIDDEN_NOT_MEMBER" ||
            result.error === "ONLY_ADMINS_CAN_MESSAGE" ||
            result.error === "BLOCKED" ||
            result.error === "OFFICIAL_ACCOUNT_READ_ONLY"
                ? 403
                : 400;
        return res.status(status).json({
            statusCode: status,
            success: false,
            error: result.error,
            message: result.error
        });
    }

    res.status(result.duplicate ? 200 : 201).json(
        new ApiResponse(result.duplicate ? 200 : 201, {
            message: result.message,
            duplicate: Boolean(result.duplicate)
        })
    );
});
