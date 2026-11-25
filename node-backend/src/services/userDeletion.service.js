import { Conversation } from "../models/conversation.model.js";
import { Message } from "../models/message.model.js";
import { Notification } from "../models/notification.model.js";
import { PasswordReset } from "../models/password-reset.model.js";
import { PushSubscription } from "../models/push-subscription.model.js";
import { Story } from "../models/story.model.js";
import { User } from "../models/user.model.js";
import { NoticeAck } from "../models/notice.model.js";
import { deleteCloudinaryUrls } from "./cloudinaryCleanup.service.js";

const asId = value => String(value?._id ?? value);

// Permanently remove a user's private data while preserving shared group history
// written by other members.
export const permanentlyDeleteUserData = async user => {
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
            .select("_id members admins createdBy groupIcon lastMessage pinnedMessage")
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
                admins: user._id,
                pinnedBy: user._id,
                mutedBy: user._id
            },
            $unset: { [`unread.${userId}`]: "" }
        };
        if (nextCreator) update.$set = { createdBy: nextCreator };

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
