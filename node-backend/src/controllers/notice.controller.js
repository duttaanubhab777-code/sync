import { Notice, NoticeAck } from "../models/notice.model.js";
import { User } from "../models/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { assertObjectId } from "../utils/helpers.js";
import { isValidCloudinaryUrl } from "../utils/cloudinary.js";
import { sendPushToAll } from "../services/push.service.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// ইউজারকে যা পাঠানো হবে (কে বানিয়েছে সেটা দরকার নেই)
const toClientNotice = n => ({
    _id: String(n._id),
    title: n.title,
    body: n.body,
    image: n.image?.url ? { url: n.image.url } : null,
    countdownTo: n.countdownTo || null,
    expiresAt: n.expiresAt,
    createdAt: n.createdAt
});

// ---------------- সব ইউজারের জন্য ----------------

// GET /api/notices/pending : আমি এখনো "OK" চাপিনি এমন সব চালু নোটিস (পুরনো আগে)
export const getPendingNotices = asyncHandler(async (req, res) => {
    const acked = await NoticeAck.find({ user: req.user._id }, { notice: 1 }).lean();
    const notices = await Notice.find({
        expiresAt: { $gt: new Date() },
        _id: { $nin: acked.map(a => a.notice) }
    })
        .sort({ createdAt: 1 })
        .limit(20)
        .lean();
    res.status(200).json(new ApiResponse(200, notices.map(toClientNotice)));
});

// POST /api/notices/:id/ack : "OK" চাপা হয়েছে
export const acknowledgeNotice = asyncHandler(async (req, res) => {
    const id = assertObjectId(req.params.id, "notice id");
    const notice = await Notice.findById(id).select("expiresAt").lean();
    // নোটিস মুছে গেলেও ফ্রন্টএন্ডকে সফল বলা হয়, যাতে popup আটকে না থাকে
    if (notice) {
        await NoticeAck.updateOne(
            { notice: id, user: req.user._id },
            { $setOnInsert: { expiresAt: notice.expiresAt } },
            { upsert: true }
        );
    }
    res.status(200).json(new ApiResponse(200, { acknowledged: true }));
});

// ---------------- শুধু Admin / Super Admin ----------------

// Cloudinary ছবি push-এ বড় আকারে দেখানোর আগে ছোট করে নেওয়া (দ্রুত লোড, ডেটা কম)
const optimizeForPush = url => {
    if (!url || !url.includes("/image/upload/")) return url || "";
    const [head, tail] = url.split("/image/upload/");
    // আগে থেকেই transformation থাকলে (যেমন w_500,...) আর হাত দেওয়া হয় না
    if (/^[a-z]{1,3}_[^/]+(,[^/]+)*\//i.test(tail)) return url;
    return `${head}/image/upload/w_1024,c_limit,q_auto/${tail}`;
};

// push notification-এর জন্য "Ends tomorrow at 11:58 PM" লাইন ডিভাইসেই (service worker) বানানো হয়,
// কারণ তখন ইউজারের নিজের timezone জানা থাকে
const buildPushPayload = notice => ({
    type: "notice",
    title: notice.title,
    body: notice.body.slice(0, 240),
    image: optimizeForPush(notice.image?.url),
    endsAt: notice.countdownTo ? new Date(notice.countdownTo).toISOString() : null,
    tag: `notice-${notice._id}`,
    requireInteraction: true,
    data: { url: "/", noticeId: String(notice._id) }
});

// POST /api/admin/notices
export const createNotice = asyncHandler(async (req, res) => {
    const { title, body, imageUrl, imagePublicId, countdownTo, showDays } = req.body || {};

    const cleanTitle = String(title ?? "").trim();
    const cleanBody = String(body ?? "").trim();
    if (!cleanTitle || cleanTitle.length > 120) {
        throw new ApiError(400, "Title is required (max 120 characters)");
    }
    if (!cleanBody || cleanBody.length > 1000) {
        throw new ApiError(400, "Message is required (max 1000 characters)");
    }

    let image = { url: "", publicId: "" };
    if (imageUrl) {
        if (!isValidCloudinaryUrl(imageUrl)) {
            throw new ApiError(400, "Notice image must be an uploaded image");
        }
        image = { url: imageUrl, publicId: String(imagePublicId || "") };
    }

    let countdown = null;
    if (countdownTo) {
        countdown = new Date(countdownTo);
        if (Number.isNaN(countdown.getTime()) || countdown.getTime() <= Date.now()) {
            throw new ApiError(400, "Countdown time must be in the future");
        }
        if (countdown.getTime() - Date.now() > 365 * DAY_MS) {
            throw new ApiError(400, "Countdown can be at most 1 year ahead");
        }
    }

    // countdown থাকলে তখনই শেষ, না থাকলে showDays (১-৩০, ডিফল্ট ৭) দিন দেখানো হবে
    const days = Math.min(Math.max(Number(showDays) || 7, 1), 30);
    const expiresAt = countdown || new Date(Date.now() + days * DAY_MS);

    const notice = await Notice.create({
        title: cleanTitle,
        body: cleanBody,
        image,
        countdownTo: countdown,
        createdBy: req.user._id,
        expiresAt
    });

    // যে পাঠিয়েছে তাকে নিজের নোটিস আবার popup করে দেখানো হবে না
    await NoticeAck.create({
        notice: notice._id,
        user: req.user._id,
        expiresAt: notice.expiresAt
    });

    // ১. এই মুহূর্তে অনলাইনে থাকা সবার কাছে real-time popup (যে পাঠিয়েছে সে বাদে)
    req.app
        .get("io")
        ?.except(`user:${req.user._id}`)
        .emit("notice:new", { notice: toClientNotice(notice) });

    // ২. অফলাইন/ব্যাকগ্রাউন্ডে থাকাদের কাছে push (যে পাঠিয়েছে সে বাদে, response আটকে রাখা হয় না)
    sendPushToAll(buildPushPayload(notice), { excludeUserId: req.user._id })
        .then(r => console.log(`[Notice] push sent ${r.sent}/${r.total}`))
        .catch(err => console.error("[Notice push]", err.message));

    res.status(201).json(new ApiResponse(201, toClientNotice(notice), "Notice published"));
});

// GET /api/admin/notices : সব নোটিস + কতজন OK চেপেছে
export const listNotices = asyncHandler(async (_req, res) => {
    const notices = await Notice.find()
        .sort({ createdAt: -1 })
        .limit(50)
        .populate("createdBy", "username fullName")
        .lean();

    const [acks, totalUsers] = await Promise.all([
        NoticeAck.aggregate([
            { $match: { notice: { $in: notices.map(n => n._id) } } },
            { $group: { _id: "$notice", count: { $sum: 1 } } }
        ]),
        User.countDocuments({ isBlocked: false })
    ]);
    const ackMap = new Map(acks.map(a => [String(a._id), a.count]));

    const now = Date.now();
    res.status(200).json(
        new ApiResponse(200, {
            totalUsers,
            notices: notices.map(n => ({
                ...toClientNotice(n),
                createdBy: n.createdBy
                    ? { username: n.createdBy.username, fullName: n.createdBy.fullName }
                    : null,
                acknowledged: ackMap.get(String(n._id)) || 0,
                active: new Date(n.expiresAt).getTime() > now
            }))
        })
    );
});

// DELETE /api/admin/notices/:id
export const deleteNotice = asyncHandler(async (req, res) => {
    const id = assertObjectId(req.params.id, "notice id");
    const notice = await Notice.findByIdAndDelete(id);
    if (!notice) throw new ApiError(404, "Notice not found");
    await NoticeAck.deleteMany({ notice: id });
    req.app.get("io")?.emit("notice:removed", { noticeId: id });
    res.status(200).json(new ApiResponse(200, null, "Notice deleted"));
});
