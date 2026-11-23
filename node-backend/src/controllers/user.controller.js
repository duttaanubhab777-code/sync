import { User } from "../models/user.model.js";
import { Conversation } from "../models/conversation.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { assertObjectId, escapeRegex, PUBLIC_USER_FIELDS } from "../utils/helpers.js";
import { isValidCloudinaryUrl } from "../utils/cloudinary.js";
import { normalizePhone } from "../validators/auth.validator.js";
import { isUserOnline } from "../socket/store.js";
import { cleanupInBackground } from "../services/cloudinaryCleanup.service.js";
import { publicUser } from "./auth.controller.js";

const withOnline = u => ({ ...u, online: isUserOnline(u._id) });

// GET /api/v1/users?search=
// username/নাম দিয়ে খোঁজা যায়; শুধু সংখ্যা দিলে ফোন নম্বর হুবহু মিললে তবেই পাওয়া যায়
// (ইমেইল/ফোন কখনো ফেরত দেওয়া হয় না)
export const searchUsers = asyncHandler(async (req, res) => {
    const q = String(req.query.search ?? "").trim();
    if (q.length < 2) {
        throw new ApiError(400, "Search text must be at least 2 characters");
    }
    if (q.length > 50) throw new ApiError(400, "Search text is too long");

    // আমি যাদের block করেছি আর যারা আমাকে block করেছে, দুই দলকেই বাদ
    const blockedMe = await User.find(
        { blockedUser: req.user._id },
        { _id: 1 }
    ).lean();
    const exclude = [
        req.user._id,
        ...req.user.blockedUser,
        ...blockedMe.map(u => u._id)
    ];

    const or = [];
    if (/^\+?[\d\s\-()]{6,}$/.test(q)) {
        or.push({ phoneNumber: normalizePhone(q) });
    }
    const rx = new RegExp(escapeRegex(q), "i");
    or.push({ username: rx }, { fullName: rx });

    const users = await User.find({
        _id: { $nin: exclude },
        isBlocked: false,
        $or: or
    })
        .select(PUBLIC_USER_FIELDS)
        .sort({ username: 1 })
        .limit(20)
        .lean();

    res.status(200).json(new ApiResponse(200, users.map(withOnline)));
});

// POST /api/v1/users/match-contacts   body: { phones: ["98xxxxxxxx", "+91 98xxx xxxxx", ...] }
// ফোনের contact নম্বরের সাথে মিলে যাওয়া Sync ইউজারদের ফেরত দেয় (WhatsApp-এর মতো)।
// ফেরত দেওয়া phoneNumber আসলে ক্লায়েন্টেরই পাঠানো নম্বর, তাই নতুন কোনো তথ্য ফাঁস হয় না;
// ইমেইল কখনো ফেরত দেওয়া হয় না।
const MAX_CONTACT_PHONES = 1500;
export const matchContacts = asyncHandler(async (req, res) => {
    const raw = Array.isArray(req.body?.phones) ? req.body.phones : [];
    if (raw.length > MAX_CONTACT_PHONES) {
        throw new ApiError(
            400,
            `Too many numbers (max ${MAX_CONTACT_PHONES} per request)`
        );
    }

    const phones = [
        ...new Set(
            raw
                .map(p => normalizePhone(String(p ?? "").trim()))
                .filter(p => /^[6-9]\d{9}$/.test(p))
        )
    ];
    if (phones.length === 0) {
        return res.status(200).json(new ApiResponse(200, []));
    }

    const blockedMe = await User.find(
        { blockedUser: req.user._id },
        { _id: 1 }
    ).lean();
    const exclude = [
        req.user._id,
        ...req.user.blockedUser,
        ...blockedMe.map(u => u._id)
    ];

    const users = await User.find({
        _id: { $nin: exclude },
        isBlocked: false,
        phoneNumber: { $in: phones }
    })
        .select(`${PUBLIC_USER_FIELDS} phoneNumber`)
        .lean();

    res.status(200).json(new ApiResponse(200, users.map(withOnline)));
});

// GET /api/v1/users/blocked
export const getBlockedUsers = asyncHandler(async (req, res) => {
    const me = await User.findById(req.user._id)
        .select("blockedUser")
        .populate({ path: "blockedUser", select: PUBLIC_USER_FIELDS })
        .lean();
    res.status(200).json(new ApiResponse(200, me?.blockedUser || []));
});

// GET /api/v1/users/by-username/:username
// QR code / প্রোফাইল লিংক (/u/<username>) থেকে সরাসরি চ্যাট খুলতে ব্যবহার হয়।
// শুধু public তথ্য ফেরত দেয় (ইমেইল/ফোন নয়); ব্লক সম্পর্ক থাকলে "নেই" বলা হয়।
const USERNAME_PARAM_RE = /^[a-z][a-z0-9_]{2,19}$/;
export const getUserByUsername = asyncHandler(async (req, res) => {
    const username = String(req.params.username || "").trim().toLowerCase();
    if (!USERNAME_PARAM_RE.test(username)) {
        throw new ApiError(404, "User not found");
    }
    const user = await User.findOne({ username })
        .select(`${PUBLIC_USER_FIELDS} blockedUser isBlocked`)
        .lean();

    const theyBlockedMe = user?.blockedUser?.some(
        b => String(b) === String(req.user._id)
    );
    const iBlockedThem = req.user.blockedUser.some(
        b => String(b) === String(user?._id)
    );
    if (!user || user.isBlocked || theyBlockedMe || iBlockedThem) {
        throw new ApiError(404, "User not found");
    }
    delete user.blockedUser;
    delete user.isBlocked;

    res.status(200).json(
        new ApiResponse(200, {
            ...withOnline(user),
            isSelf: String(user._id) === String(req.user._id)
        })
    );
});

// GET /api/v1/users/:id
export const getUserProfile = asyncHandler(async (req, res) => {
    const id = assertObjectId(req.params.id, "user id");
    const user = await User.findById(id)
        .select(`${PUBLIC_USER_FIELDS} blockedUser isBlocked`)
        .lean();

    // ব্লক হওয়া বা যে আমাকে block করেছে তাকে "নেই" বলা হয়
    const theyBlockedMe = user?.blockedUser?.some(
        b => String(b) === String(req.user._id)
    );
    if (!user || user.isBlocked || theyBlockedMe) {
        throw new ApiError(404, "User not found");
    }
    delete user.blockedUser;
    delete user.isBlocked;

    // ইমেইল ও ফোন নম্বর শুধু তাকেই দেখানো হয় যার সাথে আমার direct চ্যাট আছে (Info বাটনের জন্য)
    let contactDetails = {};
    const pairKey = [String(req.user._id), id].sort().join("_");
    const hasDirectChat = await Conversation.exists({
        type: "direct",
        pairKey,
        members: req.user._id
    });
    if (hasDirectChat || id === String(req.user._id)) {
        const full = await User.findById(id)
            .select("email phoneNumber")
            .lean();
        contactDetails = {
            email: full?.email || "",
            phoneNumber: full?.phoneNumber || ""
        };
    }

    const blockedByMe = req.user.blockedUser.some(b => String(b) === id);
    res.status(200).json(
        new ApiResponse(200, {
            ...withOnline(user),
            ...contactDetails,
            blockedByMe
        })
    );
});

// PATCH /api/v1/users/me   body: { fullName?, about?, avatar? }  (avatar: "" দিলে ছবি মুছে যাবে)
export const updateMyProfile = asyncHandler(async (req, res) => {
    const { fullName, about, avatar } = req.body;
    const update = {};
    if (fullName !== undefined) update.fullName = fullName;
    if (about !== undefined) update.about = about;
    if (avatar !== undefined) {
        if (avatar && !isValidCloudinaryUrl(avatar)) {
            throw new ApiError(400, "Avatar must be an uploaded image");
        }
        update.avatar = avatar;
    }

    const oldAvatar = avatar !== undefined ? req.user.avatar : "";
    const user = await User.findByIdAndUpdate(
        req.user._id,
        { $set: update },
        { new: true, runValidators: true }
    );
    // ছবি বদলালে বা সরালে পুরনোটা Cloudinary থেকে মোছা
    if (oldAvatar && oldAvatar !== user?.avatar) cleanupInBackground([oldAvatar]);
    res
        .status(200)
        .json(new ApiResponse(200, publicUser(user), "Profile updated"));
});

// POST /api/v1/users/:id/block
export const blockUser = asyncHandler(async (req, res) => {
    const id = assertObjectId(req.params.id, "user id");
    if (id === String(req.user._id)) {
        throw new ApiError(400, "You cannot block yourself");
    }
    if (!(await User.exists({ _id: id }))) {
        throw new ApiError(404, "User not found");
    }
    await User.updateOne(
        { _id: req.user._id },
        { $addToSet: { blockedUser: id } }
    );
    res.status(200).json(new ApiResponse(200, null, "User blocked"));
});

// DELETE /api/v1/users/:id/block
export const unblockUser = asyncHandler(async (req, res) => {
    const id = assertObjectId(req.params.id, "user id");
    await User.updateOne({ _id: req.user._id }, { $pull: { blockedUser: id } });
    res.status(200).json(new ApiResponse(200, null, "User unblocked"));
});
