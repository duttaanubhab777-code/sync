import { Conversation } from "../models/conversation.model.js";
import { Message } from "../models/message.model.js";
import { User } from "../models/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { assertObjectId, idOf } from "../utils/helpers.js";
import { isValidCloudinaryUrl } from "../utils/cloudinary.js";
import {
    POPULATE_MEMBERS,
    serializeConversation,
    joinConversationRoom,
    leaveConversationRoom,
    emitToUsers
} from "../services/conversation.service.js";
import { markSeen } from "../services/message.service.js";

const MAX_GROUP_MEMBERS = 256;

const send = (res, status, data, message) =>
    res.status(status).json(new ApiResponse(status, data, message));

// চ্যাট খোঁজা; সদস্য না হলে "নেই" বলা হয় (অন্যের চ্যাটের আইডি আছে কিনা জানা যাবে না)
export const loadMemberConversation = async (idParam, userId) => {
    const id = assertObjectId(idParam, "conversation id");
    const conv = await Conversation.findById(id);
    if (!conv || !conv.isMember(userId)) {
        throw new ApiError(404, "Conversation not found");
    }
    return conv;
};

const requireGroupAdmin = (conv, userId) => {
    if (conv.type !== "group") {
        throw new ApiError(400, "This action is only for groups");
    }
    if (!conv.isGroupAdmin(userId)) {
        throw new ApiError(403, "Only group admins can do this");
    }
};

const checkIcon = icon => {
    if (icon && !isValidCloudinaryUrl(icon)) {
        throw new ApiError(400, "Group icon must be an uploaded image");
    }
};

// GET /api/conversations   — আমার চ্যাট লিস্ট (নতুন মেসেজ আগে)
// একজনের শুরু করা direct চ্যাটে মেসেজ না যাওয়া পর্যন্ত অপর পক্ষের লিস্টে দেখানো হয় না
export const listConversations = asyncHandler(async (req, res) => {
    const me = String(req.user._id);
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 200);

    const convs = await Conversation.find({
        members: me,
        $or: [
            { type: "group" },
            { "lastMessage.messageId": { $exists: true } },
            { createdBy: me }
        ]
    })
        .sort({ updatedAt: -1 })
        .limit(limit)
        .populate(POPULATE_MEMBERS);

    send(
        res,
        200,
        convs.map(c => serializeConversation(c, me))
    );
});

// POST /api/conversations   body: { partnerId }  — direct চ্যাট শুরু (আগে থাকলে সেটাই ফেরত)
export const getOrCreateDirect = asyncHandler(async (req, res) => {
    const me = String(req.user._id);
    const io = req.app.get("io");
    const { partnerId } = req.body;

    if (partnerId === me) {
        throw new ApiError(400, "You cannot start a chat with yourself");
    }
    const partner = await User.findById(partnerId)
        .select("blockedUser isBlocked")
        .lean();
    if (!partner || partner.isBlocked) {
        throw new ApiError(404, "User not found");
    }
    const iBlocked = req.user.blockedUser.some(b => String(b) === partnerId);
    const theyBlocked = partner.blockedUser?.some(b => String(b) === me);
    if (iBlocked || theyBlocked) {
        // কে block করেছে তা বলা হয় না
        throw new ApiError(403, "You can't message this user");
    }

    const pairKey = [me, partnerId].sort().join("_");
    let conv = await Conversation.findOne({ pairKey });
    let created = false;
    if (!conv) {
        try {
            conv = await Conversation.create({
                type: "direct",
                members: [me, partnerId],
                createdBy: me
            });
            created = true;
        } catch (err) {
            // একই মুহূর্তে দুজন শুরু করলে pairKey unique index একটাকে আটকায়
            if (err?.code !== 11000) throw err;
            conv = await Conversation.findOne({ pairKey });
        }
    }
    if (created) joinConversationRoom(io, [me, partnerId], conv._id);

    await conv.populate(POPULATE_MEMBERS);
    send(res, created ? 201 : 200, serializeConversation(conv, me));
});

// POST /api/conversations/group
export const createGroup = asyncHandler(async (req, res) => {
    const me = String(req.user._id);
    const io = req.app.get("io");
    const { groupName, groupDescription, groupIcon, memberIds } = req.body;
    checkIcon(groupIcon);

    const others = [...new Set(memberIds)].filter(id => id !== me);
    if (others.length === 0) {
        throw new ApiError(400, "Add at least one more member");
    }
    if (others.length + 1 > MAX_GROUP_MEMBERS) {
        throw new ApiError(400, "Too many members");
    }
    const found = await User.countDocuments({
        _id: { $in: others },
        isBlocked: false
    });
    if (found !== others.length) {
        throw new ApiError(400, "Some users were not found");
    }

    const conv = await Conversation.create({
        type: "group",
        groupName,
        groupDescription,
        groupIcon,
        members: [me, ...others],
        admins: [me],
        createdBy: me
    });
    await conv.populate(POPULATE_MEMBERS);

    const everyone = [me, ...others];
    joinConversationRoom(io, everyone, conv._id);
    emitToUsers(
        io,
        everyone.filter(id => id !== me),
        "conversation:new",
        { conversation: serializeConversation(conv) }
    );
    send(res, 201, serializeConversation(conv, me), "Group created");
});

// GET /api/conversations/:id
export const getConversation = asyncHandler(async (req, res) => {
    const me = String(req.user._id);
    const conv = await loadMemberConversation(req.params.id, me);
    await conv.populate(POPULATE_MEMBERS);
    send(res, 200, serializeConversation(conv, me));
});

// PATCH /api/conversations/:id   (শুধু group admin)
export const updateGroup = asyncHandler(async (req, res) => {
    const me = String(req.user._id);
    const io = req.app.get("io");
    const conv = await loadMemberConversation(req.params.id, me);
    requireGroupAdmin(conv, me);

    const { groupName, groupDescription, groupIcon, onlyAdminCanMessage } =
        req.body;
    if (groupIcon !== undefined) checkIcon(groupIcon);

    if (groupName !== undefined) conv.groupName = groupName;
    if (groupDescription !== undefined) conv.groupDescription = groupDescription;
    if (groupIcon !== undefined) conv.groupIcon = groupIcon;
    if (onlyAdminCanMessage !== undefined) {
        conv.onlyAdminCanMessage = onlyAdminCanMessage;
    }
    await conv.save();
    await conv.populate(POPULATE_MEMBERS);

    emitToUsers(io, conv.members.map(idOf), "conversation:updated", {
        conversation: serializeConversation(conv)
    });
    send(res, 200, serializeConversation(conv, me), "Group updated");
});

// PATCH /api/conversations/:id/members   body: { action, targetUserId }  (শুধু group admin)
// action: add | remove | make_admin | remove_admin
export const updateMembers = asyncHandler(async (req, res) => {
    const me = String(req.user._id);
    const io = req.app.get("io");
    const conv = await loadMemberConversation(req.params.id, me);
    requireGroupAdmin(conv, me);

    const { action } = req.body;
    const target = String(req.body.targetUserId);
    const targetIsMember = conv.isMember(target);

    if (action === "add") {
        if (targetIsMember) throw new ApiError(409, "Already a member");
        if (conv.members.length >= MAX_GROUP_MEMBERS) {
            throw new ApiError(400, "Group is full");
        }
        if (!(await User.exists({ _id: target, isBlocked: false }))) {
            throw new ApiError(404, "User not found");
        }
        conv.members.push(target);
    } else {
        if (!targetIsMember) {
            throw new ApiError(404, "User is not a member of this group");
        }
        if (action === "remove") {
            if (target === me) {
                throw new ApiError(
                    400,
                    "Use the leave endpoint to leave the group"
                );
            }
            if (conv.members.length <= 2) {
                throw new ApiError(400, "A group must have at least 2 members");
            }
            conv.members = conv.members.filter(m => idOf(m) !== target);
            conv.admins = conv.admins.filter(a => idOf(a) !== target);
            conv.unread.delete(target);
        } else if (action === "make_admin") {
            if (conv.isGroupAdmin(target)) {
                throw new ApiError(409, "Already an admin");
            }
            conv.admins.push(target);
        } else if (action === "remove_admin") {
            if (!conv.isGroupAdmin(target)) {
                throw new ApiError(409, "User is not an admin");
            }
            if (conv.admins.length <= 1) {
                throw new ApiError(400, "A group needs at least one admin");
            }
            conv.admins = conv.admins.filter(a => idOf(a) !== target);
        }
    }

    await conv.save();
    await conv.populate(POPULATE_MEMBERS);

    const shared = serializeConversation(conv);
    const memberIds = conv.members.map(idOf);

    if (action === "add") {
        joinConversationRoom(io, [target], conv._id);
        emitToUsers(io, [target], "conversation:new", { conversation: shared });
        emitToUsers(
            io,
            memberIds.filter(id => id !== target),
            "conversation:updated",
            { conversation: shared }
        );
    } else if (action === "remove") {
        leaveConversationRoom(io, [target], conv._id);
        emitToUsers(io, [target], "conversation:removed", {
            conversationId: conv._id
        });
        emitToUsers(io, memberIds, "conversation:updated", {
            conversation: shared
        });
    } else {
        emitToUsers(io, memberIds, "conversation:updated", {
            conversation: shared
        });
    }
    send(res, 200, serializeConversation(conv, me), "Members updated");
});

// POST /api/conversations/:id/leave   — গ্রুপ ছাড়া
// শেষ সদস্য ছাড়লে গ্রুপ ও তার মেসেজ মুছে যায়; শেষ admin ছাড়লে সবচেয়ে পুরনো সদস্য admin হয়
export const leaveGroup = asyncHandler(async (req, res) => {
    const me = String(req.user._id);
    const io = req.app.get("io");
    const conv = await loadMemberConversation(req.params.id, me);
    if (conv.type !== "group") {
        throw new ApiError(400, "You can only leave a group");
    }

    const conversationId = conv._id;
    conv.members = conv.members.filter(m => idOf(m) !== me);
    conv.admins = conv.admins.filter(a => idOf(a) !== me);
    conv.unread.delete(me);

    leaveConversationRoom(io, [me], conversationId);
    emitToUsers(io, [me], "conversation:removed", { conversationId });

    if (conv.members.length === 0) {
        await Message.deleteMany({ conversationId });
        await Conversation.deleteOne({ _id: conversationId });
        return send(res, 200, null, "Left the group");
    }
    if (conv.admins.length === 0) conv.admins = [conv.members[0]];

    // সদস্য ১ জন হয়ে গেলে model-এর "কমপক্ষে ২ জন" নিয়মে আটকাবে, তাই validation বাদ
    await conv.save({ validateBeforeSave: false });
    await conv.populate(POPULATE_MEMBERS);
    emitToUsers(io, conv.members.map(idOf), "conversation:updated", {
        conversation: serializeConversation(conv)
    });
    send(res, 200, null, "Left the group");
});

// POST /api/conversations/:id/read   body: { upToMessageId? }  — Socket-এর message:seen এর REST বিকল্প
export const markConversationRead = asyncHandler(async (req, res) => {
    const me = String(req.user._id);
    const conv = await loadMemberConversation(req.params.id, me);
    await markSeen(
        req.app.get("io"),
        me,
        conv._id,
        req.body?.upToMessageId || null
    );
    send(res, 200, null, "Marked as read");
});
