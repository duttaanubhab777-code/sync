import { Story } from "../models/story.model.js";
import { User } from "../models/user.model.js";
import { Conversation } from "../models/conversation.model.js";
import { Message } from "../models/message.model.js";
import { Notification } from "../models/notification.model.js";
import { sendPushToUser } from "../services/push.service.js";
import crypto from "node:crypto";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { assertObjectId, PUBLIC_USER_FIELDS } from "../utils/helpers.js";
import { isValidCloudinaryUrl, pickMedia } from "../utils/cloudinary.js";
import { emitToUsers, getContactIds } from "../services/conversation.service.js";

const send = (res, status, data, message) =>
    res.status(status).json(new ApiResponse(status, data, message));

// যাদের story আমি দেখতে পারি = আমার contact (direct চ্যাটের অপর পক্ষ), block সম্পর্ক বাদে
const visibleAuthorIds = async me => {
    const contacts = await getContactIds(me);
    if (contacts.length === 0) return [];
    const myBlocked = new Set((await User.findById(me).select("blockedUser").lean())?.blockedUser?.map(String) || []);
    const blockedMe = await User.find(
        { _id: { $in: contacts }, blockedUser: me },
        { _id: 1 }
    ).lean();
    const blockedMeSet = new Set(blockedMe.map(u => String(u._id)));
    return contacts.filter(id => !myBlocked.has(id) && !blockedMeSet.has(id));
};

// react-গুলোর সারাংশ: { "❤": 3, "😂": 1 }
const summarizeReactions = reactions => {
    const out = {};
    for (const r of reactions || []) {
        if (!r?.emoji) continue;
        out[r.emoji] = (out[r.emoji] || 0) + 1;
    }
    return out;
};

const toPublicStory = (s, me) => ({
    _id: s._id,
    type: s.type,
    caption: s.caption,
    backgroundColor: s.backgroundColor,
    media: s.media?.url ? s.media : null,
    createdAt: s.createdAt,
    expiresAt: s.expiresAt,
    viewCount: s.viewers?.length || 0,
    seen: (s.viewers || []).some(v => String(v.user) === me),
    reactionCount: (s.reactions || []).length,
    reactionSummary: summarizeReactions(s.reactions),
    myReaction:
        (s.reactions || []).find(r => String(r.user) === me)?.emoji || null
});

// POST /api/stories   body: { type, caption?, backgroundColor?, media? }  (২৪ ঘণ্টা পরে নিজে মুছে যায়)
export const createStory = asyncHandler(async (req, res) => {
    const me = String(req.user._id);
    const { type, caption, backgroundColor, media } = req.body;

    let cleanMedia;
    if (type === "text") {
        if (!caption) throw new ApiError(400, "Text story needs some text");
    } else {
        cleanMedia = pickMedia(media);
        if (!cleanMedia?.url || !isValidCloudinaryUrl(cleanMedia.url)) {
            throw new ApiError(400, "Invalid media URL");
        }
    }

    const story = await Story.create({
        author: me,
        type,
        caption,
        backgroundColor,
        media: cleanMedia
    });

    const contacts = await visibleAuthorIds(me);
    emitToUsers(req.app.get("io"), contacts, "story:new", {
        storyId: story._id,
        authorId: me
    });
    send(res, 201, toPublicStory(story.toObject(), me), "Story posted");
});

// GET /api/stories   — আমার + contact-দের চলতি story, লেখক ধরে ভাগ করা
// [{ author, stories: [...], hasUnseen, isMine }]  (আমারটা প্রথমে, তারপর না-দেখা আগে)
export const getStoryFeed = asyncHandler(async (req, res) => {
    const me = String(req.user._id);
    const authors = [me, ...(await visibleAuthorIds(me))];

    const stories = await Story.find({
        author: { $in: authors },
        expiresAt: { $gt: new Date() }
    })
        .sort({ createdAt: 1 })
        .populate({ path: "author", select: PUBLIC_USER_FIELDS })
        .lean();

    const byAuthor = new Map();
    for (const s of stories) {
        if (!s.author) continue; // লেখকের অ্যাকাউন্ট মুছে গেলে
        const key = String(s.author._id);
        if (!byAuthor.has(key)) {
            byAuthor.set(key, {
                author: s.author,
                stories: [],
                hasUnseen: false,
                isMine: key === me
            });
        }
        const group = byAuthor.get(key);
        const pub = toPublicStory(s, me);
        group.stories.push(pub);
        if (!pub.seen && !group.isMine) group.hasUnseen = true;
    }

    const groups = [...byAuthor.values()].sort((a, b) => {
        if (a.isMine !== b.isMine) return a.isMine ? -1 : 1;
        if (a.hasUnseen !== b.hasUnseen) return a.hasUnseen ? -1 : 1;
        const lastA = a.stories[a.stories.length - 1].createdAt;
        const lastB = b.stories[b.stories.length - 1].createdAt;
        return new Date(lastB) - new Date(lastA);
    });
    send(res, 200, groups);
});

// POST /api/stories/:id/view   — story দেখা হয়েছে (লেখক রিয়েল-টাইমে জানতে পারে)
export const viewStory = asyncHandler(async (req, res) => {
    const me = String(req.user._id);
    const id = assertObjectId(req.params.id, "story id");

    const story = await Story.findOne({
        _id: id,
        expiresAt: { $gt: new Date() }
    })
        .select("author")
        .lean();
    if (!story) throw new ApiError(404, "Story not found");

    const authorId = String(story.author);
    if (authorId === me) return send(res, 200, null, "OK");

    if (!(await visibleAuthorIds(me)).includes(authorId)) {
        throw new ApiError(404, "Story not found");
    }

    const result = await Story.updateOne(
        { _id: id, "viewers.user": { $ne: me } },
        { $push: { viewers: { user: me, viewedAt: new Date() } } }
    );
    if (result.modifiedCount > 0) {
        emitToUsers(req.app.get("io"), [authorId], "story:viewed", {
            storyId: id,
            viewer: {
                _id: me,
                username: req.user.username,
                fullName: req.user.fullName,
                avatar: req.user.avatar
            },
            viewedAt: new Date()
        });
    }
    send(res, 200, null, "OK");
});

// GET /api/stories/:id/viewers   — শুধু লেখক দেখতে পারবে
export const getStoryViewers = asyncHandler(async (req, res) => {
    const id = assertObjectId(req.params.id, "story id");
    const story = await Story.findOne({
        _id: id,
        author: req.user._id,
        expiresAt: { $gt: new Date() }
    })
        .populate({ path: "viewers.user", select: PUBLIC_USER_FIELDS })
        .lean();
    if (!story) throw new ApiError(404, "Story not found");

    const reactionByUser = new Map(
        (story.reactions || []).map(r => [String(r.user), r.emoji])
    );
    const viewers = (story.viewers || [])
        .filter(v => v.user)
        .map(v => ({
            ...v,
            reaction: reactionByUser.get(String(v.user._id)) || null
        }))
        .sort((a, b) => new Date(b.viewedAt) - new Date(a.viewedAt));
    send(res, 200, viewers);
});

// DELETE /api/stories/:id   — শুধু লেখক
export const deleteStory = asyncHandler(async (req, res) => {
    const me = String(req.user._id);
    const id = assertObjectId(req.params.id, "story id");

    const result = await Story.deleteOne({ _id: id, author: me });
    if (result.deletedCount === 0) throw new ApiError(404, "Story not found");

    const contacts = await visibleAuthorIds(me);
    emitToUsers(req.app.get("io"), contacts, "story:deleted", {
        storyId: id,
        authorId: me
    });
    send(res, 200, null, "Story deleted");
});


// ---------- react / reply ----------

// story দেখার অনুমতি আছে কিনা যাচাই করে story ফেরত দেয় (নিজের story-তে react/reply চলবে না)
const loadReachableStory = async (me, id) => {
    const story = await Story.findOne({
        _id: id,
        expiresAt: { $gt: new Date() }
    }).lean();
    if (!story) throw new ApiError(404, "Story not found");

    const authorId = String(story.author);
    if (authorId === me) {
        throw new ApiError(400, "You cannot react or reply to your own story");
    }
    if (!(await visibleAuthorIds(me)).includes(authorId)) {
        throw new ApiError(404, "Story not found");
    }
    return { story, authorId };
};

const storyThumbnail = story => {
    const url = story.media?.url;
    if (!url) return "";
    if (story.type === "image" && url.includes("/image/upload/")) {
        return url.replace(
            "/image/upload/",
            "/image/upload/w_240,h_240,c_fill,q_auto/"
        );
    }
    if (story.type === "video" && url.includes("/video/upload/")) {
        return url
            .replace(
                "/video/upload/",
                "/video/upload/so_0,w_240,h_240,c_fill,q_auto,f_jpg/"
            )
            .replace(/\.[a-z0-9]+(\?.*)?$/i, ".jpg");
    }
    return "";
};

// POST /api/stories/:id/react   body: { emoji }   (emoji খালি/null হলে react সরে যায়)
export const reactToStory = asyncHandler(async (req, res) => {
    const me = String(req.user._id);
    const id = assertObjectId(req.params.id, "story id");
    const emoji = (req.body.emoji || "").trim();

    const { authorId } = await loadReachableStory(me, id);
    const io = req.app.get("io");
    const now = new Date();

    // react দিতে গেলে "দেখা" হিসেবেও গণ্য হবে
    const viewedNow = await Story.updateOne(
        { _id: id, "viewers.user": { $ne: me } },
        { $push: { viewers: { user: me, viewedAt: now } } }
    );
    const actor = {
        _id: me,
        username: req.user.username,
        fullName: req.user.fullName,
        avatar: req.user.avatar
    };
    if (viewedNow.modifiedCount > 0) {
        emitToUsers(io, [authorId], "story:viewed", {
            storyId: id,
            viewer: actor,
            viewedAt: now
        });
    }

    let changed = false;
    if (!emoji) {
        const r = await Story.updateOne(
            { _id: id },
            { $pull: { reactions: { user: me } } }
        );
        changed = r.modifiedCount > 0;
    } else {
        const updated = await Story.updateOne(
            {
                _id: id,
                reactions: {
                    $elemMatch: { user: req.user._id, emoji: { $ne: emoji } }
                }
            },
            {
                $set: {
                    "reactions.$.emoji": emoji,
                    "reactions.$.reactedAt": now
                }
            }
        );
        changed = updated.modifiedCount > 0;
        if (!changed) {
            const pushed = await Story.updateOne(
                { _id: id, "reactions.user": { $ne: me } },
                { $push: { reactions: { user: me, emoji, reactedAt: now } } }
            );
            changed = pushed.modifiedCount > 0;
        }
    }

    const fresh = await Story.findById(id).select("reactions").lean();
    const reactionCount = fresh?.reactions?.length || 0;
    const reactionSummary = summarizeReactions(fresh?.reactions);

    if (changed) {
        emitToUsers(io, [authorId], "story:reacted", {
            storyId: id,
            user: actor,
            emoji: emoji || null,
            reactedAt: now,
            reactionCount,
            reactionSummary
        });

        if (emoji) {
            const title = req.user.fullName || "Someone";
            const body = `Reacted ${emoji} to your story`;
            Promise.allSettled([
                Notification.create({
                    recipient: authorId,
                    actor: me,
                    type: "message",
                    title,
                    body,
                    data: { storyId: id, url: "/stories" }
                }),
                sendPushToUser(authorId, {
                    type: "message",
                    title,
                    body,
                    icon: req.user.avatar || "/icons/icon-192.png",
                    tag: `story-react-${id}`,
                    data: { storyId: id, url: "/stories" }
                })
            ]).catch(() => {});
        }
    }

    send(res, 200, { myReaction: emoji || null, reactionCount }, "OK");
});

// POST /api/stories/:id/reply   body: { text }  — story-র লেখকের সাথে direct চ্যাটে মেসেজ হয়ে যায়
export const replyToStory = asyncHandler(async (req, res) => {
    const me = String(req.user._id);
    const id = assertObjectId(req.params.id, "story id");
    const text = req.body.text;

    const { story, authorId } = await loadReachableStory(me, id);

    const pairKey = [me, authorId].sort().join("_");
    const conv = await Conversation.findOne({ type: "direct", pairKey });
    if (!conv) throw new ApiError(404, "Chat not found");

    let msg = await Message.create({
        conversationId: conv._id,
        sender: me,
        clientMsgId: `story_${id}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
        type: "text",
        text,
        storyReply: {
            storyId: story._id,
            authorId: story.author,
            type: story.type,
            caption: (story.caption || "").slice(0, 160),
            backgroundColor: story.backgroundColor,
            thumbnail: storyThumbnail(story)
        },
        status: "sent"
    });
    msg = await msg.populate([
        { path: "sender", select: "username fullName avatar" },
        {
            path: "replyTo",
            select: "text type sender media.url deletedForEveryone"
        }
    ]);

    await Conversation.updateOne(
        { _id: conv._id },
        {
            $set: {
                lastMessage: {
                    messageId: msg._id,
                    text: text.slice(0, 100),
                    type: "text",
                    sender: me,
                    createdAt: msg.createdAt
                }
            },
            $inc: { [`unread.${authorId}`]: 1 }
        }
    );

    emitToUsers(req.app.get("io"), [me, authorId], "message:new", {
        message: msg,
        conversationId: String(conv._id)
    });

    const title = req.user.fullName || "New message";
    const body = `Replied to your story: ${text.slice(0, 120)}`;
    const data = {
        conversationId: String(conv._id),
        messageId: String(msg._id),
        url: `/chats/${conv._id}`
    };
    Promise.allSettled([
        Notification.create({
            recipient: authorId,
            actor: me,
            type: "message",
            title,
            body,
            data
        }),
        sendPushToUser(authorId, {
            type: "message",
            title,
            body,
            icon: req.user.avatar || "/icons/icon-192.png",
            tag: `conversation-${conv._id}`,
            data
        })
    ]).catch(() => {});

    send(res, 201, msg, "Reply sent");
});
