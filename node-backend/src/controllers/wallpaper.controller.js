import { Wallpaper } from "../models/wallpaper.model.js";
import { User } from "../models/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { assertObjectId, escapeRegex } from "../utils/helpers.js";
import { isValidCloudinaryUrl } from "../utils/cloudinary.js";

const MAX_WALLPAPERS = 200;

const toClient = w => ({
    _id: String(w._id),
    name: w.name,
    url: w.image?.url || "",
    width: w.image?.width || 0,
    height: w.image?.height || 0,
    isDefault: Boolean(w.isDefault),
    createdAt: w.createdAt
});

// সবাইকে জানানো হয় যে wallpaper তালিকা/default বদলেছে (client নিজে নতুন করে আনবে)
const broadcastChange = req => req.app.get("io")?.emit("wallpaper:changed", { at: Date.now() });

// একাধিক isDefault থাকলে সবচেয়ে নতুন করে সেট করাটাই জেতে
const pickDefaultId = list => {
    const defaults = list
        .filter(w => w.isDefault)
        .sort((a, b) => new Date(b.defaultSetAt || 0) - new Date(a.defaultSetAt || 0));
    return defaults[0] ? String(defaults[0]._id) : null;
};

const loadAll = () => Wallpaper.find().sort({ createdAt: -1 }).lean();

// ---------------- সব ইউজারের জন্য ----------------

// GET /api/v1/wallpapers : সব wallpaper + admin-এর default + আমার নিজের পছন্দ
export const listWallpapers = asyncHandler(async (req, res) => {
    const list = await loadAll();
    const defaultId = pickDefaultId(list);
    const ids = new Set(list.map(w => String(w._id)));
    const mine = req.user.wallpaperChoice ? String(req.user.wallpaperChoice) : null;

    res.status(200).json(
        new ApiResponse(200, {
            wallpapers: list.map(w => ({ ...toClient(w), isDefault: String(w._id) === defaultId })),
            defaultId,
            // মুছে যাওয়া wallpaper বেছে রাখলে সেটা আর নেই, তাই default-এ ফেরত
            myChoice: mine && ids.has(mine) ? mine : null
        })
    );
});

// PUT /api/v1/wallpapers/me  { wallpaperId: "<id>" | null }
// null = "Default" (admin যেটা ঠিক করবে সেটাই অনুসরণ করবে)
export const setMyWallpaper = asyncHandler(async (req, res) => {
    const { wallpaperId } = req.body || {};

    if (wallpaperId === null || wallpaperId === undefined || wallpaperId === "") {
        await User.updateOne({ _id: req.user._id }, { $set: { wallpaperChoice: null } });
        return res.status(200).json(new ApiResponse(200, { myChoice: null }, "Wallpaper set to default"));
    }

    const id = assertObjectId(wallpaperId, "wallpaper id");
    const exists = await Wallpaper.exists({ _id: id });
    if (!exists) throw new ApiError(404, "Wallpaper not found");

    await User.updateOne({ _id: req.user._id }, { $set: { wallpaperChoice: id } });
    res.status(200).json(new ApiResponse(200, { myChoice: id }, "Wallpaper updated"));
});

// ---------------- শুধু Admin / Super Admin ----------------

// GET /api/v1/admin/wallpapers : তালিকা + কতজন কোনটা ব্যবহার করছে
export const adminListWallpapers = asyncHandler(async (_req, res) => {
    const list = await Wallpaper.find()
        .sort({ createdAt: -1 })
        .populate("createdBy", "username fullName")
        .lean();
    const defaultId = pickDefaultId(list);

    const [usage, totalUsers] = await Promise.all([
        User.aggregate([
            { $match: { wallpaperChoice: { $ne: null } } },
            { $group: { _id: "$wallpaperChoice", count: { $sum: 1 } } }
        ]),
        User.countDocuments({ isBlocked: false })
    ]);
    const usageMap = new Map(usage.map(u => [String(u._id), u.count]));
    const chosenTotal = usage.reduce((sum, u) => sum + u.count, 0);

    res.status(200).json(
        new ApiResponse(200, {
            defaultId,
            // যাদের নিজের কোনো পছন্দ নেই, তারা default ফলো করছে
            followingDefault: Math.max(0, totalUsers - chosenTotal),
            wallpapers: list.map(w => ({
                ...toClient(w),
                isDefault: String(w._id) === defaultId,
                usedBy: usageMap.get(String(w._id)) || 0,
                createdBy: w.createdBy
                    ? { username: w.createdBy.username, fullName: w.createdBy.fullName }
                    : null
            }))
        })
    );
});

// POST /api/v1/admin/wallpapers  { name, imageUrl, imagePublicId, width, height, makeDefault }
export const createWallpaper = asyncHandler(async (req, res) => {
    const { name, imageUrl, imagePublicId, width, height, makeDefault } = req.body || {};

    const cleanName = String(name ?? "")
        .replace(/<[^>]*>/g, "")
        .replace(/\s+/g, " ")
        .trim();
    if (!cleanName) throw new ApiError(400, "Wallpaper name is required");
    if (cleanName.length > 40) throw new ApiError(400, "Wallpaper name can be at most 40 characters");

    if (!imageUrl || !isValidCloudinaryUrl(imageUrl) || !String(imageUrl).includes("/image/upload/")) {
        throw new ApiError(400, "Wallpaper must be an uploaded image");
    }

    if ((await Wallpaper.countDocuments()) >= MAX_WALLPAPERS) {
        throw new ApiError(400, `You can keep at most ${MAX_WALLPAPERS} wallpapers. Delete an old one first.`);
    }

    const duplicate = await Wallpaper.exists({
        name: { $regex: `^${escapeRegex(cleanName)}$`, $options: "i" }
    });
    if (duplicate) throw new ApiError(409, "A wallpaper with this name already exists");

    const num = v => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : 0);

    const wallpaper = await Wallpaper.create({
        name: cleanName,
        image: {
            url: imageUrl,
            publicId: String(imagePublicId || ""),
            width: num(width),
            height: num(height)
        },
        createdBy: req.user._id
    });

    if (makeDefault) {
        await Wallpaper.updateMany({ isDefault: true }, { $set: { isDefault: false } });
        wallpaper.isDefault = true;
        wallpaper.defaultSetAt = new Date();
        await wallpaper.save();
    }

    broadcastChange(req);
    res.status(201).json(new ApiResponse(201, toClient(wallpaper), "Wallpaper added"));
});

// PATCH /api/v1/admin/wallpapers/:id  { name }
export const renameWallpaper = asyncHandler(async (req, res) => {
    const id = assertObjectId(req.params.id, "wallpaper id");
    const cleanName = String(req.body?.name ?? "")
        .replace(/<[^>]*>/g, "")
        .replace(/\s+/g, " ")
        .trim();
    if (!cleanName || cleanName.length > 40) {
        throw new ApiError(400, "Name is required (max 40 characters)");
    }
    const clash = await Wallpaper.exists({
        _id: { $ne: id },
        name: { $regex: `^${escapeRegex(cleanName)}$`, $options: "i" }
    });
    if (clash) throw new ApiError(409, "A wallpaper with this name already exists");

    const wallpaper = await Wallpaper.findByIdAndUpdate(id, { $set: { name: cleanName } }, { new: true });
    if (!wallpaper) throw new ApiError(404, "Wallpaper not found");

    broadcastChange(req);
    res.status(200).json(new ApiResponse(200, toClient(wallpaper), "Wallpaper renamed"));
});

// PUT /api/v1/admin/wallpapers/default  { wallpaperId: "<id>" | null }
// শুধু যারা "Default" ব্যবহার করছে তাদেরটাই বদলাবে। যারা নিজে বেছে নিয়েছে তাদের কিছু বদলাবে না,
// কারণ default আলাদা করে সংরক্ষিত, ইউজারের পছন্দ User.wallpaperChoice-এ।
export const setDefaultWallpaper = asyncHandler(async (req, res) => {
    const { wallpaperId } = req.body || {};

    // সরানোর আগে যাচাই, যাতে ভুল id দিলে আগের default হারিয়ে না যায়
    if (wallpaperId === null || wallpaperId === undefined || wallpaperId === "") {
        await Wallpaper.updateMany({ isDefault: true }, { $set: { isDefault: false } });
        broadcastChange(req);
        return res.status(200).json(new ApiResponse(200, { defaultId: null }, "Default wallpaper cleared"));
    }

    const id = assertObjectId(wallpaperId, "wallpaper id");
    const wallpaper = await Wallpaper.findById(id);
    if (!wallpaper) throw new ApiError(404, "Wallpaper not found");

    await Wallpaper.updateMany({ isDefault: true }, { $set: { isDefault: false } });
    wallpaper.isDefault = true;
    wallpaper.defaultSetAt = new Date();
    await wallpaper.save();

    broadcastChange(req);
    res.status(200).json(
        new ApiResponse(200, { defaultId: String(wallpaper._id) }, `"${wallpaper.name}" is now the default wallpaper`)
    );
});

// DELETE /api/v1/admin/wallpapers/:id
export const deleteWallpaper = asyncHandler(async (req, res) => {
    const id = assertObjectId(req.params.id, "wallpaper id");
    const wallpaper = await Wallpaper.findByIdAndDelete(id);
    if (!wallpaper) throw new ApiError(404, "Wallpaper not found");

    // এটা যারা বেছে রেখেছিল তারা "Default"-এ ফিরে যাবে
    await User.updateMany({ wallpaperChoice: id }, { $set: { wallpaperChoice: null } });

    broadcastChange(req);
    res.status(200).json(new ApiResponse(200, null, "Wallpaper deleted"));
});
