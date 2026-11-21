import mongoose, { Schema } from "mongoose";

// কোন Android build-এর আপডেট নোটিফিকেশন সর্বশেষ পাঠানো হয়েছে (একই build দুবার পাঠানো ঠেকাতে)।
// একটাই ডকুমেন্ট থাকে (key = "android")।
const appUpdateStateSchema = new Schema(
    {
        key: { type: String, required: true, unique: true },
        lastNotifiedBuild: { type: Number, default: 0 },
        lastNotifiedAt: { type: Date, default: null },
        lastResult: {
            sent: { type: Number, default: 0 },
            total: { type: Number, default: 0 }
        }
    },
    { timestamps: true }
);

export const AppUpdateState = mongoose.model(
    "AppUpdateState",
    appUpdateStateSchema
);
