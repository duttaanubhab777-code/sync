import mongoose, { Schema } from "mongoose";

// Wallpaper-এর ক্যাটাগরি (Super Hero, Nature...)।
// order ছোট হলে আগে দেখায়। নতুন ক্যাটাগরি সবসময় শেষে যোগ হয়।
// isSystem = true মানে এটা সবার আগে থাকা বাঁধা ক্যাটাগরি (Super Hero), এটা মোছা যায় না।
const wallpaperCategorySchema = new Schema(
    {
        name: { type: String, required: true, trim: true, maxlength: 30 },
        order: { type: Number, default: 0, index: true },
        isSystem: { type: Boolean, default: false },
        createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null }
    },
    { timestamps: true }
);

export const WallpaperCategory = mongoose.model("WallpaperCategory", wallpaperCategorySchema);

// প্রথমবার চালু হলে যে ক্যাটাগরিগুলো আগে থেকে বানানো থাকবে (প্রথমটা Super Hero, বাকিগুলো এলোমেলো)
export const DEFAULT_WALLPAPER_CATEGORIES = [
    "Super Hero",
    "Nature",
    "Anime",
    "Cars & Bikes",
    "Space",
    "Dark & Minimal",
    "Love",
    "Gaming",
    "Islamic",
    "Abstract"
];
