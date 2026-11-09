import { User } from "../models/user.model.js";
import { Conversation } from "../models/conversation.model.js";
import { Message } from "../models/message.model.js";
import { Story } from "../models/story.model.js";
import { Notice } from "../models/notice.model.js";
import { PushSubscription } from "../models/push-subscription.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { assertObjectId, escapeRegex, isObjectId } from "../utils/helpers.js";
import { getOnlineUserIds, isUserOnline } from "../socket/store.js";
import { emitToUsers, getContactIds } from "../services/conversation.service.js";

/*
 * নামের গোলমাল এড়াতে:
 *  - "Platform admin" = User.role === "admin" | "superAdmin"  (এই ফাইলের সব কিছু শুধু এদের জন্য)
 *  - "Group admin"    = Conversation.admins (শুধু একটা গ্রুপের ভেতরের admin, platform ক্ষমতা নেই)
 *
 * গোপনীয়তা: এখানকার কোনো API-ই মেসেজের লেখা (text/caption) ফেরত দেয় না।
 * শুধু image ও video ফাইল (সাথে কে পাঠিয়েছে, কোন চ্যাটে) দেখা যায়।
 */

const ADMIN_USER_FIELDS =
    "username fullName email phoneNumber avatar role isSuperAdmin isBlocked lastSeen createdAt";

const withOnline = u => ({ ...u, online: isUserOnline(u._id) });

// actor (যে admin কাজটা করছে) target-কে বদলাতে পারবে কিনা
const assertCanManage = (actor, target) => {
    if (String(actor._id) === String(target._id)) {
        throw new ApiError(400, "You cannot do this to your own account");
    }
    if (target.isSuperAdmin || target.role === "superAdmin") {
        throw new ApiError(403, "The Super Admin account cannot be changed");
    }
    if (target.role === "admin" && !actor.isSuperAdmin) {
        throw new ApiError(403, "Only the Super Admin can manage another admin");
    }
};

// GET /api/admin/stats
export const getStats = asyncHandler(async (_req, res) => {
    const now = new Date();
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [
        totalUsers,
        blockedUsers,
        admins,
        newThisWeek,
        groups,
        directChats,
        totalMessages,
        images,
        videos,
        activeStories,
        activeNotices,
        pushDevices
    ] = await Promise.all([
        User.countDocuments(),
        User.countDocuments({ isBlocked: true }),
        User.countDocuments({ role: { $in: ["admin", "superAdmin"] } }),
        User.countDocuments({ createdAt: { $gte: weekAgo } }),
        Conversation.countDocuments({ type: "group" }),
        Conversation.countDocuments({ type: "direct" }),
        Message.estimatedDocumentCount(),
        Message.countDocuments({ type: "image", deletedForEveryone: false }),
        Message.countDocuments({ type: "video", deletedForEveryone: false }),
        Story.countDocuments({ expiresAt: { $gt: now } }),
        Notice.countDocuments({ expiresAt: { $gt: now } }),
        PushSubscription.estimatedDocumentCount()
    ]);

    res.status(200).json(
        new ApiResponse(200, {
            users: {
                total: totalUsers,
                online: getOnlineUserIds().length,
                blocked: blockedUsers,
                admins,
                newThisWeek
            },
            chats: { groups, direct: directChats, messages: totalMessages },
            media: { images, videos, activeStories },
            notices: { active: activeNotices, pushDevices }
        })
    );
});

// GET /api/admin/users?search=&filter=all|admins|blocked&page=1&limit=20
export const listUsers = asyncHandler(async (req, res) => {
    const search = String(req.query.search ?? "").trim().slice(0, 50);
    const filter = String(req.query.filter ?? "all");
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);

    const query = {};
    if (filter === "admins") query.role = { $in: ["admin", "superAdmin"] };
    if (filter === "blocked") query.isBlocked = true;
    if (search) {
        const rx = new RegExp(escapeRegex(search), "i");
        query.$or = [
            { username: rx },
            { fullName: rx },
            { email: rx },
            { phoneNumber: rx }
        ];
    }

    const [users, total] = await Promise.all([
        User.find(query)
            .select(ADMIN_USER_FIELDS)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean(),
        User.countDocuments(query)
    ]);

    res.status(200).json(
        new ApiResponse(200, {
            users: users.map(withOnline),
            total,
            page,
            pages: Math.max(Math.ceil(total / limit), 1)
        })
    );
});

// POST /api/admin/users/:id/block   |   DELETE /api/admin/users/:id/block
const setBlocked = blocked =>
    asyncHandler(async (req, res) => {
        const id = assertObjectId(req.params.id, "user id");
        const target = await User.findById(id).select(ADMIN_USER_FIELDS);
        if (!target) throw new ApiError(404, "User not found");
        assertCanManage(req.user, target);

        const update = { $set: { isBlocked: blocked } };
        // block হলে সব ডিভাইসের login বাতিল (refresh token মুছে ফেলা)
        if (blocked) update.$set.refreshTokens = [];
        await User.updateOne({ _id: id }, update);

        if (blocked) {
            const io = req.app.get("io");
            // চলতি socket কেটে দেওয়া, আর push subscription মুছে দেওয়া
            io?.in(`user:${id}`).disconnectSockets(true);
            await PushSubscription.deleteMany({ user: id });
        }

        const fresh = await User.findById(id).select(ADMIN_USER_FIELDS).lean();
        res.status(200).json(
            new ApiResponse(
                200,
                withOnline(fresh),
                blocked ? "User blocked" : "User unblocked"
            )
        );
    });

export const blockUserByAdmin = setBlocked(true);
export const unblockUserByAdmin = setBlocked(false);

// PATCH /api/admin/users/:id/role   body: { role: "admin" | "user" }   (শুধু Super Admin)
export const setUserRole = asyncHandler(async (req, res) => {
    const id = assertObjectId(req.params.id, "user id");
    const role = req.body?.role;
    if (role !== "admin" && role !== "user") {
        throw new ApiError(400, 'Role must be "admin" or "user"');
    }
    const target = await User.findById(id).select(ADMIN_USER_FIELDS);
    if (!target) throw new ApiError(404, "User not found");
    assertCanManage(req.user, target);
    if (role === "admin" && target.isBlocked) {
        throw new ApiError(400, "Unblock this user before making them an admin");
    }

    await User.updateOne({ _id: id }, { $set: { role } });
    const fresh = await User.findById(id).select(ADMIN_USER_FIELDS).lean();
    res.status(200).json(
        new ApiResponse(
            200,
            withOnline(fresh),
            role === "admin" ? "User is now an admin" : "Admin access removed"
        )
    );
});

// ---------- Media (শুধু image ও video, কখনো লেখা নয়) ----------

const MEDIA_SENDER_FIELDS = "username fullName avatar";

const conversationLabel = conv => {
    if (!conv) return { id: null, type: "unknown", name: "Deleted chat" };
    if (conv.type === "group") {
        return { id: String(conv._id), type: "group", name: conv.groupName || "Group" };
    }
    const names = (conv.members || [])
        .map(m => (m?.username ? `@${m.username}` : null))
        .filter(Boolean);
    return { id: String(conv._id), type: "direct", name: names.join(" ↔ ") || "Direct chat" };
};

// GET /api/admin/media?source=chat|story&kind=all|image|video&before=<id>&limit=24
export const listMedia = asyncHandler(async (req, res) => {
    const source = req.query.source === "story" ? "story" : "chat";
    const kind = ["image", "video"].includes(req.query.kind) ? req.query.kind : "all";
    const limit = Math.min(Math.max(Number(req.query.limit) || 24, 1), 60);
    const before = isObjectId(req.query.before) ? req.query.before : null;
    const types = kind === "all" ? ["image", "video"] : [kind];

    if (source === "story") {
        const query = { type: { $in: types }, expiresAt: { $gt: new Date() } };
        if (before) query._id = { $lt: before };
        const stories = await Story.find(query)
            .select("author type media createdAt expiresAt") // caption ইচ্ছে করেই বাদ
            .sort({ _id: -1 })
            .limit(limit + 1)
            .populate("author", MEDIA_SENDER_FIELDS)
            .lean();
        const hasMore = stories.length > limit;
        const page = stories.slice(0, limit);
        return res.status(200).json(
            new ApiResponse(200, {
                items: page.map(s => ({
                    id: String(s._id),
                    source: "story",
                    type: s.type,
                    url: s.media?.url,
                    mime: s.media?.mime,
                    duration: s.media?.duration,
                    createdAt: s.createdAt,
                    expiresAt: s.expiresAt,
                    sender: s.author || null,
                    chat: null
                })),
                nextBefore: hasMore ? String(page[page.length - 1]._id) : null
            })
        );
    }

    const query = {
        type: { $in: types },
        deletedForEveryone: false,
        "media.url": { $exists: true, $ne: "" }
    };
    if (before) query._id = { $lt: before };

    const messages = await Message.find(query)
        .select("conversationId sender type media createdAt") // text ইচ্ছে করেই বাদ
        .sort({ _id: -1 })
        .limit(limit + 1)
        .populate("sender", MEDIA_SENDER_FIELDS)
        .lean();
    const hasMore = messages.length > limit;
    const page = messages.slice(0, limit);

    const convIds = [...new Set(page.map(m => String(m.conversationId)))];
    const convs = await Conversation.find({ _id: { $in: convIds } })
        .select("type groupName members")
        .populate("members", "username")
        .lean();
    const convMap = new Map(convs.map(c => [String(c._id), c]));

    res.status(200).json(
        new ApiResponse(200, {
            items: page.map(m => ({
                id: String(m._id),
                source: "chat",
                type: m.type,
                url: m.media?.url,
                mime: m.media?.mime,
                duration: m.media?.duration,
                createdAt: m.createdAt,
                sender: m.sender || null,
                chat: conversationLabel(convMap.get(String(m.conversationId)))
            })),
            nextBefore: hasMore ? String(page[page.length - 1]._id) : null
        })
    );
});

// DELETE /api/admin/media/chat/:id   — আপত্তিকর ছবি/ভিডিও সবার জন্য মুছে ফেলা
export const removeChatMedia = asyncHandler(async (req, res) => {
    const id = assertObjectId(req.params.id, "message id");
    const msg = await Message.findById(id);
    if (!msg || !["image", "video"].includes(msg.type)) {
        throw new ApiError(404, "Media not found");
    }
    if (!msg.deletedForEveryone) {
        msg.deletedForEveryone = true;
        msg.text = "This message was deleted";
        msg.media = undefined;
        await msg.save();

        await Conversation.updateOne(
            { _id: msg.conversationId, "lastMessage.messageId": msg._id },
            {
                $set: {
                    "lastMessage.text": "This message was deleted",
                    "lastMessage.type": "text"
                }
            }
        );

        const conv = await Conversation.findById(msg.conversationId, { members: 1 }).lean();
        if (conv) {
            emitToUsers(req.app.get("io"), conv.members, "message:deleted", {
                messageId: msg._id,
                conversationId: msg.conversationId
            });
        }
    }
    res.status(200).json(new ApiResponse(200, null, "Media removed"));
});

// DELETE /api/admin/media/story/:id
export const removeStoryMedia = asyncHandler(async (req, res) => {
    const id = assertObjectId(req.params.id, "story id");
    const story = await Story.findByIdAndDelete(id).select("author").lean();
    if (!story) throw new ApiError(404, "Story not found");

    const authorId = String(story.author);
    const contacts = await getContactIds(authorId);
    emitToUsers(req.app.get("io"), [authorId, ...contacts], "story:deleted", {
        storyId: id,
        authorId
    });
    res.status(200).json(new ApiResponse(200, null, "Story removed"));
});

// ---------- Groups ----------

// GET /api/admin/groups?search=   (গ্রুপের নাম, সদস্য সংখ্যা, group admin কারা — কোনো মেসেজ নয়)
export const listGroups = asyncHandler(async (req, res) => {
    const search = String(req.query.search ?? "").trim().slice(0, 50);
    const query = { type: "group" };
    if (search) query.groupName = new RegExp(escapeRegex(search), "i");

    const groups = await Conversation.find(query)
        .select("groupName groupIcon members admins createdBy createdAt")
        .sort({ createdAt: -1 })
        .limit(100)
        .populate("admins", "username fullName")
        .populate("createdBy", "username fullName")
        .lean();

    res.status(200).json(
        new ApiResponse(
            200,
            groups.map(g => ({
                id: String(g._id),
                name: g.groupName,
                icon: g.groupIcon || "",
                memberCount: g.members.length,
                // এরা শুধু এই গ্রুপের admin, platform admin নয়
                groupAdmins: (g.admins || []).map(a => ({
                    id: String(a._id),
                    username: a.username,
                    fullName: a.fullName
                })),
                createdBy: g.createdBy
                    ? { username: g.createdBy.username, fullName: g.createdBy.fullName }
                    : null,
                createdAt: g.createdAt
            }))
        )
    );
});
