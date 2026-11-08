import { User } from "../models/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { assertObjectId, escapeRegex, PUBLIC_USER_FIELDS } from "../utils/helpers.js";
import { isValidCloudinaryUrl } from "../utils/cloudinary.js";
import { normalizePhone } from "../validators/auth.validator.js";
import { isUserOnline } from "../socket/store.js";
import { publicUser } from "./auth.controller.js";

const withOnline = u => ({ ...u, online: isUserOnline(u._id) });

// GET /api/users?search=
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

// GET /api/users/blocked
export const getBlockedUsers = asyncHandler(async (req, res) => {
    const me = await User.findById(req.user._id)
        .select("blockedUser")
        .populate({ path: "blockedUser", select: PUBLIC_USER_FIELDS })
        .lean();
    res.status(200).json(new ApiResponse(200, me?.blockedUser || []));
});

// GET /api/users/:id
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

    const blockedByMe = req.user.blockedUser.some(b => String(b) === id);
    res
        .status(200)
        .json(new ApiResponse(200, { ...withOnline(user), blockedByMe }));
});

// PATCH /api/users/me   body: { fullName?, about?, avatar? }  (avatar: "" দিলে ছবি মুছে যাবে)
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

    const user = await User.findByIdAndUpdate(
        req.user._id,
        { $set: update },
        { new: true, runValidators: true }
    );
    res
        .status(200)
        .json(new ApiResponse(200, publicUser(user), "Profile updated"));
});

// POST /api/users/:id/block
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

// DELETE /api/users/:id/block
export const unblockUser = asyncHandler(async (req, res) => {
    const id = assertObjectId(req.params.id, "user id");
    await User.updateOne({ _id: req.user._id }, { $pull: { blockedUser: id } });
    res.status(200).json(new ApiResponse(200, null, "User unblocked"));
});
