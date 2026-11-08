import { Story } from "../models/story.model.js";
import { User } from "../models/user.model.js";
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

const toPublicStory = (s, me) => ({
    _id: s._id,
    type: s.type,
    caption: s.caption,
    backgroundColor: s.backgroundColor,
    media: s.media?.url ? s.media : null,
    createdAt: s.createdAt,
    expiresAt: s.expiresAt,
    viewCount: s.viewers?.length || 0,
    seen: (s.viewers || []).some(v => String(v.user) === me)
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

    const viewers = (story.viewers || [])
        .filter(v => v.user)
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
