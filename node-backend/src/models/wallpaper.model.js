import mongoose, { Schema } from "mongoose";

// Admin / Super Admin-এর আপলোড করা চ্যাট wallpaper।
// "default" আলাদা কোনো collection-এ নয়, wallpaper-এর isDefault ফ্ল্যাগেই থাকে।
// ইউজারের নিজের পছন্দ থাকে User.wallpaperChoice-এ (null মানে "default ফলো করছে")।
const wallpaperSchema = new Schema(
    {
        name: { type: String, required: true, trim: true, maxlength: 40 },
        image: {
            url: { type: String, required: true },
            publicId: { type: String, default: "" },
            width: { type: Number, default: 0 },
            height: { type: Number, default: 0 }
        },
        // কোন ক্যাটাগরিতে আছে। null মানে এখনো ক্যাটাগরি দেওয়া হয়নি (আগের আপলোড করা wallpaper-গুলো)
        category: { type: Schema.Types.ObjectId, ref: "WallpaperCategory", default: null, index: true },
        isDefault: { type: Boolean, default: false, index: true },
        // কখন default করা হয়েছে, যাতে কোনো কারণে একাধিক isDefault থাকলেও সবচেয়ে নতুনটা জেতে
        defaultSetAt: { type: Date, default: null },
        createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true }
    },
    { timestamps: true }
);

wallpaperSchema.index({ createdAt: -1 });

export const Wallpaper = mongoose.model("Wallpaper", wallpaperSchema);
