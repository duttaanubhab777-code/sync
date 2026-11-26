import mongoose, { Schema } from "mongoose";

// GitHub commit থেকে যাওয়া অ্যানাউন্সমেন্টের হিসাব: একই commit দুবার ঘোষণা হয় না
const commitAnnouncementSchema = new Schema(
    {
        sha: { type: String, required: true, unique: true, index: true },
        // একাধিক commit জুড়ে একটা সারাংশ গেলে বাকি SHA গুলোও এখানে থাকে
        subject: { type: String, default: "", maxlength: 200 },
        tag: { type: String, default: "Update", maxlength: 40 },
        deliveredCount: { type: Number, default: 0 },
        groupPosted: { type: Boolean, default: false },
        announcedAt: { type: Date, default: Date.now }
    },
    { timestamps: false }
);

export const CommitAnnouncement =
    mongoose.models.CommitAnnouncement ||
    mongoose.model("CommitAnnouncement", commitAnnouncementSchema);
