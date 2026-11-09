import mongoose, { Schema } from "mongoose";

// Admin/Super Admin-এর পাঠানো নোটিস (সবাইকে popup হিসেবে দেখানো হয়)
const noticeSchema = new Schema(
    {
        title: { type: String, required: true, trim: true, maxlength: 120 },
        body: { type: String, required: true, trim: true, maxlength: 1000 },
        // ঐচ্ছিক ছবি (Cloudinary URL)
        image: {
            url: { type: String, default: "" },
            publicId: { type: String, default: "" }
        },
        // ঐচ্ছিক: popup-এ live countdown দেখাবে (যেমন "অফার শেষ হবে ...")
        countdownTo: { type: Date, default: null },
        // কে পাঠিয়েছে (platform admin / super admin)
        createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
        // এই সময়ের পর নোটিস আর কাউকে দেখানো হবে না (TTL index দিয়ে নিজে থেকে মুছেও যায়)
        expiresAt: { type: Date, required: true, index: true }
    },
    { timestamps: true }
);

noticeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
noticeSchema.index({ createdAt: -1 });

export const Notice = mongoose.model("Notice", noticeSchema);

// কে কোন নোটিসে "OK" চেপেছে। আলাদা collection, তাই নোটিসের document ফুলে যায় না
const noticeAckSchema = new Schema(
    {
        notice: { type: Schema.Types.ObjectId, ref: "Notice", required: true },
        user: { type: Schema.Types.ObjectId, ref: "User", required: true },
        // নোটিসের সাথেই মেয়াদ শেষে মুছে যাবে
        expiresAt: { type: Date, required: true }
    },
    { timestamps: true }
);

noticeAckSchema.index({ notice: 1, user: 1 }, { unique: true });
noticeAckSchema.index({ user: 1 });
noticeAckSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const NoticeAck = mongoose.model("NoticeAck", noticeAckSchema);
