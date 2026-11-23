import { Wallpaper } from "../models/wallpaper.model.js";
import { WallpaperCategory, DEFAULT_WALLPAPER_CATEGORIES } from "../models/wallpaper-category.model.js";
import { User } from "../models/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { assertObjectId, escapeRegex } from "../utils/helpers.js";
import { isValidCloudinaryUrl } from "../utils/cloudinary.js";
import { cleanupInBackground } from "../services/cloudinaryCleanup.service.js";

const MAX_WALLPAPERS = 200;

const toClient = w => ({
    _id: String(w._id),
    name: w.name,
    url: w.image?.url || "",
    width: w.image?.width || 0,
    height: w.image?.height || 0,
    isDefault: Boolean(w.isDefault),
    category: w.category ? String(w.category._id ?? w.category) : null,
    createdAt: w.createdAt
});

const MAX_CATEGORIES = 30;

const cleanText = v =>
    String(v ?? "")
        .replace(/<[^>]*>/g, "")
        .replace(/\s+/g, " ")
        .trim();

// প্রথমবার ক্যাটাগরি তালিকা চাইলে আগে থেকে ঠিক করা ক্যাটাগরিগুলো বানিয়ে দেওয়া (Super Hero সবার আগে)
let seeding = null;
const seedDefaults = async () => {
    if ((await WallpaperCategory.estimatedDocumentCount()) > 0) return;
    if (!seeding) {
        seeding = WallpaperCategory.bulkWrite(
            DEFAULT_WALLPAPER_CATEGORIES.map((name, i) => ({
                updateOne: {
                    filter: { name },
                    update: { $setOnInsert: { name, order: i, isSystem: i === 0 } },
                    upsert: true
                }
            }))
        ).finally(() => {
            seeding = null;
        });
    }
    await seeding;
};

// এখন প্রতিটা wallpaper-এর একটা ক্যাটাগরি থাকা বাধ্যতামূলক।
// আগের আপলোড করা (ক্যাটাগরি ছাড়া) wallpaper পেলে সেগুলো "Uncategorized" নামের একটা আসল ক্যাটাগরিতে রাখা হয়;
// admin সেগুলো গুছিয়ে সরিয়ে ফেললে ক্যাটাগরিটা মুছে দিতে পারবে। আর কোনো wallpaper ক্যাটাগরি ছাড়া থাকবে না।
const adoptOrphans = async () => {
    const ids = (await WallpaperCategory.find().select("_id").lean()).map(c => c._id);
    if (!(await Wallpaper.exists({ category: { $nin: ids } }))) return;

    const last = await WallpaperCategory.findOne().sort({ order: -1 }).select("order").lean();
    const holder = await WallpaperCategory.findOneAndUpdate(
        { name: /^uncategorized$/i },
        { $setOnInsert: { name: "Uncategorized", order: (last?.order ?? -1) + 1, isSystem: false } },
        { upsert: true, new: true }
    );
    await Wallpaper.updateMany({ category: { $nin: ids } }, { $set: { category: holder._id } });
};

const ensureCategories = async () => {
    await seedDefaults();
    await adoptOrphans();
};

// ক্যাটাগরি + প্রতিটায় কয়টা wallpaper
const buildCategoryStats = async list => {
    await ensureCategories();
    const cats = await WallpaperCategory.find().sort({ order: 1, createdAt: 1 }).lean();
    const counts = new Map();
    for (const w of list) {
        if (w.category) counts.set(String(w.category), (counts.get(String(w.category)) || 0) + 1);
    }
    return {
        total: list.length,
        categories: cats.map(c => ({
            _id: String(c._id),
            name: c.name,
            isSystem: Boolean(c.isSystem),
            count: counts.get(String(c._id)) || 0
        }))
    };
};

// দেওয়া categoryId সত্যিই আছে কিনা যাচাই। ক্যাটাগরি বাধ্যতামূলক, খালি দেওয়া যাবে না
const resolveCategoryId = async raw => {
    if (raw === null || raw === undefined || raw === "") throw new ApiError(400, "Please choose a category");
    const id = assertObjectId(raw, "category id");
    const exists = await WallpaperCategory.exists({ _id: id });
    if (!exists) throw new ApiError(404, "Category not found");
    return id;
};

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
    await ensureCategories(); // ক্যাটাগরি ছাড়া পুরোনো wallpaper থাকলে আগে সেগুলো ঠিক করে নেওয়া
    const list = await loadAll();
    const defaultId = pickDefaultId(list);
    const ids = new Set(list.map(w => String(w._id)));
    const mine = req.user.wallpaperChoice ? String(req.user.wallpaperChoice) : null;
    const stats = await buildCategoryStats(list);

    res.status(200).json(
        new ApiResponse(200, {
            wallpapers: list.map(w => ({
                ...toClient(w),
                category: w.category ? String(w.category) : null,
                isDefault: String(w._id) === defaultId
            })),
            categories: stats.categories,
            total: stats.total,
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
    await ensureCategories();
    const list = await Wallpaper.find()
        .sort({ createdAt: -1 })
        .populate("createdBy", "username fullName")
        .lean();
    const defaultId = pickDefaultId(list);
    const stats = await buildCategoryStats(list);

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
            categories: stats.categories,
            total: stats.total,
            // যাদের নিজের কোনো পছন্দ নেই, তারা default ফলো করছে
            followingDefault: Math.max(0, totalUsers - chosenTotal),
            wallpapers: list.map(w => ({
                ...toClient(w),
                category: w.category ? String(w.category) : null,
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
    const { name, imageUrl, imagePublicId, width, height, makeDefault, categoryId } = req.body || {};

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
    const category = await resolveCategoryId(categoryId);

    const wallpaper = await Wallpaper.create({
        name: cleanName,
        category,
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

// PATCH /api/v1/admin/wallpapers/:id  { name?, categoryId? }
// নাম বদলানো এবং/অথবা অন্য ক্যাটাগরিতে নেওয়া (ক্যাটাগরি বাধ্যতামূলক, খালি করা যাবে না)
export const renameWallpaper = asyncHandler(async (req, res) => {
    const id = assertObjectId(req.params.id, "wallpaper id");
    const body = req.body || {};
    const hasName = body.name !== undefined;
    const hasCategory = Object.prototype.hasOwnProperty.call(body, "categoryId");
    if (!hasName && !hasCategory) throw new ApiError(400, "Nothing to update");

    const $set = {};
    if (hasName) {
        const cleanName = cleanText(body.name);
        if (!cleanName || cleanName.length > 40) {
            throw new ApiError(400, "Name is required (max 40 characters)");
        }
        const clash = await Wallpaper.exists({
            _id: { $ne: id },
            name: { $regex: `^${escapeRegex(cleanName)}$`, $options: "i" }
        });
        if (clash) throw new ApiError(409, "A wallpaper with this name already exists");
        $set.name = cleanName;
    }
    if (hasCategory) $set.category = await resolveCategoryId(body.categoryId);

    const wallpaper = await Wallpaper.findByIdAndUpdate(id, { $set }, { new: true });
    if (!wallpaper) throw new ApiError(404, "Wallpaper not found");

    broadcastChange(req);
    res.status(200).json(new ApiResponse(200, toClient(wallpaper), "Wallpaper updated"));
});

// PATCH /api/v1/admin/wallpapers/move  { ids: [...], categoryId: "<id>" }
// একসাথে অনেকগুলো wallpaper এক ক্যাটাগরিতে সরানো (আগের ৫১টা গুছাতে এটাই কাজে লাগবে)
export const moveWallpapers = asyncHandler(async (req, res) => {
    const { ids, categoryId } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) throw new ApiError(400, "Select at least one wallpaper");
    if (ids.length > 500) throw new ApiError(400, "Too many wallpapers selected at once");
    const cleanIds = [...new Set(ids.map(v => assertObjectId(v, "wallpaper id")))];
    const category = await resolveCategoryId(categoryId);

    const result = await Wallpaper.updateMany({ _id: { $in: cleanIds } }, { $set: { category } });

    broadcastChange(req);
    res.status(200).json(
        new ApiResponse(200, { moved: result.modifiedCount ?? 0 }, "Wallpapers moved")
    );
});

// ---------------- ক্যাটাগরি (শুধু Admin / Super Admin) ----------------

const cleanCategoryName = raw => {
    const name = cleanText(raw);
    if (!name) throw new ApiError(400, "Category name is required");
    if (name.length > 30) throw new ApiError(400, "Category name can be at most 30 characters");
    return name;
};

// POST /api/v1/admin/wallpaper-categories  { name }  : নতুন ক্যাটাগরি সবসময় শেষে যোগ হয়
export const createWallpaperCategory = asyncHandler(async (req, res) => {
    await ensureCategories();
    const name = cleanCategoryName(req.body?.name);

    if ((await WallpaperCategory.countDocuments()) >= MAX_CATEGORIES) {
        throw new ApiError(400, `You can have at most ${MAX_CATEGORIES} categories`);
    }
    const dup = await WallpaperCategory.exists({
        name: { $regex: `^${escapeRegex(name)}$`, $options: "i" }
    });
    if (dup) throw new ApiError(409, "A category with this name already exists");

    const last = await WallpaperCategory.findOne().sort({ order: -1 }).select("order").lean();
    const category = await WallpaperCategory.create({
        name,
        order: (last?.order ?? -1) + 1,
        createdBy: req.user._id
    });

    broadcastChange(req);
    res.status(201).json(
        new ApiResponse(
            201,
            { _id: String(category._id), name: category.name, isSystem: false, count: 0 },
            "Category added"
        )
    );
});

// PATCH /api/v1/admin/wallpaper-categories/:id  { name }
export const renameWallpaperCategory = asyncHandler(async (req, res) => {
    const id = assertObjectId(req.params.id, "category id");
    const name = cleanCategoryName(req.body?.name);

    const clash = await WallpaperCategory.exists({
        _id: { $ne: id },
        name: { $regex: `^${escapeRegex(name)}$`, $options: "i" }
    });
    if (clash) throw new ApiError(409, "A category with this name already exists");

    const category = await WallpaperCategory.findByIdAndUpdate(id, { $set: { name } }, { new: true });
    if (!category) throw new ApiError(404, "Category not found");

    broadcastChange(req);
    res.status(200).json(new ApiResponse(200, { _id: String(category._id), name: category.name }, "Category renamed"));
});

// DELETE /api/v1/admin/wallpaper-categories/:id
// ক্যাটাগরিতে wallpaper থাকলে মোছা যাবে না (আগে সেগুলো অন্য ক্যাটাগরিতে সরাতে হবে), কারণ ক্যাটাগরি ছাড়া wallpaper থাকতে পারে না
export const deleteWallpaperCategory = asyncHandler(async (req, res) => {
    const id = assertObjectId(req.params.id, "category id");
    const category = await WallpaperCategory.findById(id);
    if (!category) throw new ApiError(404, "Category not found");
    if (category.isSystem) throw new ApiError(400, `"${category.name}" is the first category and cannot be deleted`);

    const inside = await Wallpaper.countDocuments({ category: id });
    if (inside > 0) {
        throw new ApiError(
            400,
            `"${category.name}" still has ${inside} wallpaper${inside === 1 ? "" : "s"}. Move ${
                inside === 1 ? "it" : "them"
            } to another category first.`
        );
    }

    await WallpaperCategory.deleteOne({ _id: id });

    broadcastChange(req);
    res.status(200).json(new ApiResponse(200, null, "Category deleted"));
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
    cleanupInBackground([wallpaper.image?.url]);

    // এটা যারা বেছে রেখেছিল তারা "Default"-এ ফিরে যাবে
    await User.updateMany({ wallpaperChoice: id }, { $set: { wallpaperChoice: null } });

    broadcastChange(req);
    res.status(200).json(new ApiResponse(200, null, "Wallpaper deleted"));
});
