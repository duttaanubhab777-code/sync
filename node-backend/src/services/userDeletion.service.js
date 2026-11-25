import { Conversation } from "../models/conversation.model.js";
import { Message } from "../models/message.model.js";
import { Notification } from "../models/notification.model.js";
import { PasswordReset } from "../models/password-reset.model.js";
import { PushSubscription } from "../models/push-subscription.model.js";
import { Story } from "../models/story.model.js";
import { User } from "../models/user.model.js";
import { Notice, NoticeAck } from "../models/notice.model.js";
import { Wallpaper } from "../models/wallpaper.model.js";
import { WallpaperCategory } from "../models/wallpaper-category.model.js";
import { deleteCloudinaryUrls } from "./cloudinaryCleanup.service.js";

const asId = value => String(value?._id ?? value);

// Permanently remove a user's private data while preserving shared group history
// written by other members.
export const permanentlyDeleteUserData = async (user, replacementAdminId) => {
    const userId = String(user._id);

    const [directConversations, relatedGroups, stories] = await Promise.all([
        Conversation.find({ type: "direct", members: user._id })
            .select("_id members")
            .lean(),
        Conversation.find({
            type: "group",
            $or: [
                { members: user._id },
                { admins: user._id },
                { createdBy: user._id },
                { pinnedBy: user._id },
                { mutedBy: user._id },
                { "lastMessage.sender": user._id },
                { "pinnedMessage.pinnedBy": user._id },
                { [`unread.${userId}`]: { $exists: true } }
            ]
        })
            .select("_id members admins createdBy groupIcon isOfficial lastMessage pinnedMessage")
            .lean(),
        Story.find({ author: user._id })
            .select("media.url")
            .lean()
    ]);

    const directIds = directConversations.map(row => row._id);
    const emptyGroupIds = [];
    const survivingGroups = [];

    for (const group of relatedGroups) {
        const remainingMembers = (group.members || []).filter(
            member => asId(member) !== userId
        );

        if (remainingMembers.length === 0) {
            emptyGroupIds.push(group._id);
            continue;
        }

        const remainingAdmins = (group.admins || []).filter(
            admin => asId(admin) !== userId
        );
        const nextCreator =
            asId(group.createdBy) === userId
                ? (remainingAdmins[0] || remainingMembers[0])
                : group.createdBy;

        const update = {
            $pull: {
                members: user._id,
                pinnedBy: user._id,
                mutedBy: user._id
            },
            $unset: { [`unread.${userId}`]: "" },
            $set: {
                admins: remainingAdmins.length
                    ? remainingAdmins
                    : group.isOfficial
                      ? []
                      : [remainingMembers[0]]
            }
        };
        if (nextCreator) update.$set.createdBy = nextCreator;

        await Conversation.updateOne({ _id: group._id }, update, {
            timestamps: false
        });
        survivingGroups.push(group._id);
    }

    // Direct conversations are private to their two participants. Remove the
    // entire conversation (including Sync welcome/broadcast DMs) for both sides.
    // In groups, only messages authored by the deleted user are removed.
    const messageDeletionFilter = {
        $or: [
            ...(directIds.length ? [{ conversationId: { $in: directIds } }] : []),
            { sender: user._id },
            ...(emptyGroupIds.length
                ? [{ conversationId: { $in: emptyGroupIds } }]
                : [])
        ]
    };

    const messagesToDelete = await Message.find(messageDeletionFilter)
        .select("_id media.url storyReply.thumbnail conversationId")
        .lean();
    const deletedMessageIds = messagesToDelete.map(message => message._id);
    const mediaUrls = [
        user.avatar,
        ...stories.map(story => story.media?.url),
        ...messagesToDelete.flatMap(message => [
            message.media?.url,
            message.storyReply?.thumbnail
        ]),
        ...relatedGroups
            .filter(group => emptyGroupIds.some(id => asId(id) === asId(group._id)))
            .map(group => group.groupIcon)
    ];

    // Remove references to the deleted account from messages that remain in
    // shared groups: reactions, poll votes, delivery/read receipts and story replies.
    if (survivingGroups.length) {
        const remainingMessageFilter = {
            conversationId: { $in: survivingGroups },
            sender: { $ne: user._id }
        };

        const storyReplyRows = await Message.find({
            ...remainingMessageFilter,
            "storyReply.authorId": user._id
        })
            .select("storyReply.thumbnail")
            .lean();
        mediaUrls.push(...storyReplyRows.map(row => row.storyReply?.thumbnail));

        await Message.updateMany(
            remainingMessageFilter,
            {
                $pull: {
                    reactions: { user: user._id },
                    seenBy: { user: user._id },
                    deliveredTo: { user: user._id }
                }
            }
        );
        await Message.updateMany(
            {
                ...remainingMessageFilter,
                "storyReply.authorId": user._id
            },
            { $unset: { storyReply: "" } }
        );
        await Message.updateMany(
            {
                ...remainingMessageFilter,
                "poll.options.votes": user._id
            },
            { $pull: { "poll.options.$[].votes": user._id } }
        );

        if (deletedMessageIds.length) {
            await Message.updateMany(
                {
                    conversationId: { $in: survivingGroups },
                    replyTo: { $in: deletedMessageIds }
                },
                { $set: { replyTo: null } }
            );
        }
    }

    // Delete user-authored/direct-chat messages before checking Cloudinary
    // references, so shared assets are retained if another record still uses them.
    const [messageResult, conversationResult, storyResult] = await Promise.all([
        Message.deleteMany(messageDeletionFilter),
        Conversation.deleteMany({
            _id: { $in: [...directIds, ...emptyGroupIds] }
        }),
        Story.deleteMany({ author: user._id })
    ]);

    // Refresh group previews/pins if they pointed at messages that were removed.
    if (survivingGroups.length) {
        for (const groupId of survivingGroups) {
            const group = relatedGroups.find(row => asId(row._id) === asId(groupId));
            const latestMessage = await Message.findOne({
                conversationId: groupId,
                deletedForEveryone: { $ne: true }
            })
                .sort({ createdAt: -1, _id: -1 })
                .select("_id text type sender createdAt media.fileName")
                .lean();

            const patch = {};
            if (
                deletedMessageIds.length &&
                group &&
                (
                    deletedMessageIds.some(id => asId(id) === asId(group.lastMessage?.messageId)) ||
                    asId(group.lastMessage?.sender) === userId
                )
            ) {
                patch.lastMessage = latestMessage
                    ? {
                          messageId: latestMessage._id,
                          text: latestMessage.text || latestMessage.media?.fileName || "",
                          type: latestMessage.type,
                          sender: latestMessage.sender,
                          createdAt: latestMessage.createdAt
                      }
                    : {
                          messageId: null,
                          text: "",
                          type: "text",
                          sender: null,
                          createdAt: null
                      };
            }

            const pinnedMessageDeleted =
                group?.pinnedMessage?.messageId &&
                deletedMessageIds.some(
                    id => asId(id) === asId(group.pinnedMessage.messageId)
                );
            const pinOwnedByDeletedUser =
                asId(group?.pinnedMessage?.pinnedBy) === userId;
            if (pinnedMessageDeleted || pinOwnedByDeletedUser) {
                patch.pinnedMessage = null;
            }

            if (Object.keys(patch).length) {
                await Conversation.updateOne(
                    { _id: groupId },
                    { $set: patch },
                    { timestamps: false }
                );
            }
        }
    }

    await Promise.all([
        PushSubscription.deleteMany({ user: user._id }),
        Notification.deleteMany({
            $or: [{ recipient: user._id }, { actor: user._id }]
        }),
        NoticeAck.deleteMany({ user: user._id }),
        PasswordReset.deleteMany({ userId: user._id }),
        Notice.updateMany(
            { createdBy: user._id },
            { $set: { createdBy: replacementAdminId } }
        ),
        Wallpaper.updateMany(
            { createdBy: user._id },
            { $set: { createdBy: replacementAdminId } }
        ),
        WallpaperCategory.updateMany(
            { createdBy: user._id },
            { $set: { createdBy: null } }
        ),
        Story.updateMany(
            {
                $or: [
                    { "viewers.user": user._id },
                    { "reactions.user": user._id }
                ]
            },
            {
                $pull: {
                    viewers: { user: user._id },
                    reactions: { user: user._id }
                }
            }
        ),
        User.updateMany(
            { blockedUser: user._id },
            { $pull: { blockedUser: user._id } }
        )
    ]);

    // Delete the account last. The Cloudinary cleanup service checks all remaining
    // DB references before destroying an asset, protecting media shared by others.
    await User.deleteOne({ _id: user._id });
    const cloudinaryDeleted = await deleteCloudinaryUrls(mediaUrls);

    return {
        deletedMessages: messageResult.deletedCount || 0,
        deletedConversations: conversationResult.deletedCount || 0,
        deletedStories: storyResult.deletedCount || 0,
        deletedGroupsUpdated: survivingGroups.length,
        cloudinaryDeleted,
        directConversations: directConversations.map(conversation => ({
            id: conversation._id,
            memberIds: (conversation.members || [])
                .map(asId)
                .filter(memberId => memberId !== userId)
        })),
        updatedGroupIds: survivingGroups
    };
};


// One-time startup repair for accounts deleted before cascading cleanup existed.
// It finds dangling User references, removes orphan DMs/messages/stories, and
// cleans their Cloudinary assets without touching valid members' group history.
export const sweepOrphanedUserData = async () => {
    const [directRows, groups, orphanMessages, orphanStories] = await Promise.all([
        Conversation.find({ type: "direct" })
            .select("_id members")
            .lean(),
        Conversation.find({ type: "group" })
            .select("_id members admins createdBy pinnedBy mutedBy unread groupIcon isOfficial lastMessage pinnedMessage")
            .lean(),
        Message.aggregate([
            {
                $lookup: {
                    from: User.collection.name,
                    localField: "sender",
                    foreignField: "_id",
                    as: "senderRecord"
                }
            },
            {
                $lookup: {
                    from: Conversation.collection.name,
                    localField: "conversationId",
                    foreignField: "_id",
                    as: "conversationRecord"
                }
            },
            {
                $match: {
                    $or: [
                        { $expr: { $eq: [{ $size: "$senderRecord" }, 0] } },
                        { $expr: { $eq: [{ $size: "$conversationRecord" }, 0] } }
                    ]
                }
            },
            {
                $project: {
                    _id: 1,
                    sender: 1,
                    conversationId: 1,
                    mediaUrl: "$media.url",
                    storyReplyThumbnail: "$storyReply.thumbnail"
                }
            }
        ]),
        Story.aggregate([
            {
                $lookup: {
                    from: User.collection.name,
                    localField: "author",
                    foreignField: "_id",
                    as: "authorRecord"
                }
            },
            { $match: { $expr: { $eq: [{ $size: "$authorRecord" }, 0] } } },
            { $project: { _id: 1, author: 1, mediaUrl: "$media.url" } }
        ]),
        Notice.find({}, { createdBy: 1 }).lean(),
        Wallpaper.find({}, { createdBy: 1 }).lean(),
        WallpaperCategory.find(
            { createdBy: { $ne: null } },
            { createdBy: 1 }
        ).lean()
    ]);

    const candidateIds = new Set();
    for (const conversation of directRows) {
        for (const member of conversation.members || []) candidateIds.add(asId(member));
    }
    for (const group of groups) {
        for (const field of ["members", "admins", "pinnedBy", "mutedBy"]) {
            for (const value of group[field] || []) candidateIds.add(asId(value));
        }
        if (group.createdBy) candidateIds.add(asId(group.createdBy));
        for (const key of Object.keys(group.unread || {})) candidateIds.add(key);
    }
    for (const message of orphanMessages) {
        if (message.sender) candidateIds.add(asId(message.sender));
    }
    for (const story of orphanStories) {
        if (story.author) candidateIds.add(asId(story.author));
    }
    for (const notice of notices) {
        if (notice.createdBy) candidateIds.add(asId(notice.createdBy));
    }
    for (const wallpaper of wallpapers) {
        if (wallpaper.createdBy) candidateIds.add(asId(wallpaper.createdBy));
    }
    for (const category of categories) {
        if (category.createdBy) candidateIds.add(asId(category.createdBy));
    }

    const validIds = new Set(
        (
            await User.find(
                { _id: { $in: [...candidateIds] } },
                { _id: 1 }
            ).lean()
        ).map(user => asId(user._id))
    );
    const orphanIds = [...candidateIds].filter(
        id => /^[a-f0-9]{24}$/i.test(id) && !validIds.has(id)
    );
    const orphanSet = new Set(orphanIds);
    let replacementAdmin = null;
    if (orphanIds.length) {
        replacementAdmin = await User.findOne(
            { role: { $in: ["admin", "superAdmin"] }, isOfficial: { $ne: true } },
            { _id: 1 }
        ).lean();
        if (!replacementAdmin) {
            replacementAdmin = await User.findOne(
                { isOfficial: true },
                { _id: 1 }
            ).lean();
        }
    }

    const orphanDirect = directRows.filter(conversation =>
        (conversation.members || []).some(member => orphanSet.has(asId(member)))
    );
    const orphanDirectIds = orphanDirect.map(conversation => conversation._id);

    const emptyGroups = [];
    const survivingGroups = [];
    const groupMediaUrls = [];

    for (const group of groups) {
        const staleRefs = new Set();
        for (const field of ["members", "admins", "pinnedBy", "mutedBy"]) {
            for (const value of group[field] || []) {
                if (orphanSet.has(asId(value))) staleRefs.add(asId(value));
            }
        }
        if (group.createdBy && orphanSet.has(asId(group.createdBy))) {
            staleRefs.add(asId(group.createdBy));
        }
        for (const key of Object.keys(group.unread || {})) {
            if (orphanSet.has(key)) staleRefs.add(key);
        }

        const remainingMembers = (group.members || []).filter(
            member => !orphanSet.has(asId(member))
        );
        if (remainingMembers.length === 0) {
            emptyGroups.push(group._id);
            if (group.groupIcon) groupMediaUrls.push(group.groupIcon);
            continue;
        }
        const hasOrphanMessage = orphanMessages.some(
            message => asId(message.conversationId) === asId(group._id)
        );
        if (staleRefs.size === 0 && !hasOrphanMessage) continue;

        const remainingAdmins = (group.admins || []).filter(
            admin => !orphanSet.has(asId(admin))
        );
        const creatorIsStale =
            group.createdBy && orphanSet.has(asId(group.createdBy));
        const update = {
            $pull: {
                members: { $in: orphanIds },
                pinnedBy: { $in: orphanIds },
                mutedBy: { $in: orphanIds }
            },
            $unset: Object.fromEntries(
                [...staleRefs].map(id => [`unread.${id}`, ""])
            ),
            $set: {
                admins: remainingAdmins.length
                    ? remainingAdmins
                    : group.isOfficial
                      ? []
                      : [remainingMembers[0]]
            }
        };
        if (creatorIsStale) {
            update.$set.createdBy = remainingAdmins[0] || remainingMembers[0];
        }
        if (staleRefs.size > 0) {
            await Conversation.updateOne({ _id: group._id }, update, {
                timestamps: false
            });
        }
        survivingGroups.push(group);
    }

    const orphanDirectMessages = orphanDirectIds.length
        ? await Message.find({ conversationId: { $in: orphanDirectIds } })
              .select("_id media.url storyReply.thumbnail")
              .lean()
        : [];
    const emptyGroupMessages = emptyGroups.length
        ? await Message.find({ conversationId: { $in: emptyGroups } })
              .select("_id media.url storyReply.thumbnail")
              .lean()
        : [];
    const deletedMessageRows = [
        ...orphanMessages,
        ...orphanDirectMessages.map(message => ({
            ...message,
            mediaUrl: message.media?.url,
            storyReplyThumbnail: message.storyReply?.thumbnail
        })),
        ...emptyGroupMessages.map(message => ({
            ...message,
            mediaUrl: message.media?.url,
            storyReplyThumbnail: message.storyReply?.thumbnail
        }))
    ];
    const deletedMessageIds = [...new Set(deletedMessageRows.map(row => asId(row._id)))];

    const mediaUrls = [
        ...deletedMessageRows.flatMap(row => [
            row.mediaUrl || row.media?.url,
            row.storyReplyThumbnail || row.storyReply?.thumbnail
        ]),
        ...orphanStories.map(story => story.mediaUrl),
        ...groupMediaUrls
    ];

    if (orphanIds.length && survivingGroups.length) {
        const groupIds = survivingGroups.map(group => group._id);
        const remainingMessages = { conversationId: { $in: groupIds } };
        const staleStoryReplies = await Message.find({
            ...remainingMessages,
            "storyReply.authorId": { $in: orphanIds }
        })
            .select("storyReply.thumbnail")
            .lean();
        mediaUrls.push(...staleStoryReplies.map(row => row.storyReply?.thumbnail));

        await Message.updateMany(
            remainingMessages,
            {
                $pull: {
                    reactions: { user: { $in: orphanIds } },
                    seenBy: { user: { $in: orphanIds } },
                    deliveredTo: { user: { $in: orphanIds } }
                }
            }
        );
        await Message.updateMany(
            {
                ...remainingMessages,
                "storyReply.authorId": { $in: orphanIds }
            },
            { $unset: { storyReply: "" } }
        );
        await Message.updateMany(
            {
                ...remainingMessages,
                "poll.options.votes": { $in: orphanIds }
            },
            { $pull: { "poll.options.$[].votes": { $in: orphanIds } } }
        );
    }

    const messagesToRemove = {
        $or: [
            ...(orphanDirectIds.length
                ? [{ conversationId: { $in: orphanDirectIds } }]
                : []),
            ...(emptyGroups.length
                ? [{ conversationId: { $in: emptyGroups } }]
                : []),
            ...(orphanMessages.length
                ? [{ _id: { $in: orphanMessages.map(message => message._id) } }]
                : [])
        ]
    };

    if (deletedMessageIds.length && survivingGroups.length) {
        await Message.updateMany(
            {
                conversationId: { $in: survivingGroups.map(group => group._id) },
                replyTo: { $in: deletedMessageRows.map(row => row._id) }
            },
            { $set: { replyTo: null } }
        );
    }

    const [messageResult, conversationResult, storyResult] = await Promise.all([
        deletedMessageIds.length ? Message.deleteMany(messagesToRemove) : Promise.resolve({ deletedCount: 0 }),
        Conversation.deleteMany({ _id: { $in: [...orphanDirectIds, ...emptyGroups] } }),
        orphanStories.length
            ? Story.deleteMany({ _id: { $in: orphanStories.map(story => story._id) } })
            : Promise.resolve({ deletedCount: 0 })
    ]);

    for (const group of survivingGroups) {
        const staleLastMessage =
            group.lastMessage?.sender &&
            orphanSet.has(asId(group.lastMessage.sender));
        const stalePinnedMessage =
            group.pinnedMessage?.pinnedBy &&
            orphanSet.has(asId(group.pinnedMessage.pinnedBy));
        const pinnedMessageRemoved =
            group.pinnedMessage?.messageId &&
            deletedMessageIds.includes(asId(group.pinnedMessage.messageId));
        const patch = {};

        if (staleLastMessage || (
            group.lastMessage?.messageId &&
            deletedMessageIds.includes(asId(group.lastMessage.messageId))
        )) {
            const latest = await Message.findOne({
                conversationId: group._id,
                deletedForEveryone: { $ne: true }
            })
                .sort({ createdAt: -1, _id: -1 })
                .select("_id text type sender createdAt media.fileName")
                .lean();
            patch.lastMessage = latest
                ? {
                      messageId: latest._id,
                      text: latest.text || latest.media?.fileName || "",
                      type: latest.type,
                      sender: latest.sender,
                      createdAt: latest.createdAt
                  }
                : { messageId: null, text: "", type: "text", sender: null, createdAt: null };
        }
        if (stalePinnedMessage || pinnedMessageRemoved) patch.pinnedMessage = null;
        if (Object.keys(patch).length) {
            await Conversation.updateOne(
                { _id: group._id },
                { $set: patch },
                { timestamps: false }
            );
        }
    }

    if (orphanIds.length) {
        await Promise.all([
            PushSubscription.deleteMany({ user: { $in: orphanIds } }),
            Notification.deleteMany({
                $or: [
                    { recipient: { $in: orphanIds } },
                    { actor: { $in: orphanIds } }
                ]
            }),
            NoticeAck.deleteMany({ user: { $in: orphanIds } }),
            PasswordReset.deleteMany({ userId: { $in: orphanIds } }),
            ...(replacementAdmin
                ? [
                      Notice.updateMany(
                          { createdBy: { $in: orphanIds } },
                          { $set: { createdBy: replacementAdmin._id } }
                      ),
                      Wallpaper.updateMany(
                          { createdBy: { $in: orphanIds } },
                          { $set: { createdBy: replacementAdmin._id } }
                      )
                  ]
                : []),
            WallpaperCategory.updateMany(
                { createdBy: { $in: orphanIds } },
                { $set: { createdBy: null } }
            ),
            Story.updateMany(
                {},
                {
                    $pull: {
                        viewers: { user: { $in: orphanIds } },
                        reactions: { user: { $in: orphanIds } }
                    }
                }
            ),
            User.updateMany(
                { blockedUser: { $in: orphanIds } },
                { $pull: { blockedUser: { $in: orphanIds } } }
            )
        ]);
    }

    const cloudinaryDeleted = await deleteCloudinaryUrls(mediaUrls);
    const summary = {
        orphanUsersFound: orphanIds.length,
        deletedMessages: messageResult.deletedCount || 0,
        deletedConversations: conversationResult.deletedCount || 0,
        deletedStories: storyResult.deletedCount || 0,
        groupsRepaired: survivingGroups.length,
        cloudinaryDeleted
    };
    if (Object.values(summary).some(value => value > 0)) {
        console.log("[Orphan cleanup] completed:", summary);
    }
    return summary;
};
