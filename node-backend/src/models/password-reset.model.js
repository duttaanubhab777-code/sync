import mongoose from "mongoose";

// "Forgot password" চলাকালীন OTP এখানে থাকে। OTP সাদা লেখায় রাখা হয় না (HMAC hash)।
// ইমেইল-প্রতি একটাই ডকুমেন্ট; মেয়াদ শেষে MongoDB TTL নিজে মুছে ফেলে।
const passwordResetSchema = new mongoose.Schema(
    {
        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },

        otpHash: { type: String, required: true },
        otpExpiresAt: { type: Date, required: true },
        attempts: { type: Number, default: 0 },

        sendCount: { type: Number, default: 1 },
        lastSentAt: { type: Date, required: true },
        ipAddress: { type: String, default: null },

        expiresAt: { type: Date, required: true }
    },
    { timestamps: true }
);

passwordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const PasswordReset = mongoose.model(
    "PasswordReset",
    passwordResetSchema
);
