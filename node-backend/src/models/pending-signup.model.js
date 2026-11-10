import mongoose from "mongoose";

// OTP যাচাই না হওয়া পর্যন্ত নতুন ইউজারের তথ্য এখানে থাকে। আসল User তৈরি হয় শুধু সঠিক OTP দিলে।
// পাসওয়ার্ড এখানেও সাদা লেখায় থাকে না (bcrypt hash), OTP-ও না (HMAC hash)।
const pendingSignupSchema = new mongoose.Schema(
    {
        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true
        },
        username: { type: String, required: true, lowercase: true, trim: true },
        fullName: { type: String, required: true, trim: true },
        phoneNumber: { type: String, required: true, trim: true },
        passwordHash: { type: String, required: true },
        avatar: { type: String, default: "" },

        otpHash: { type: String, required: true },
        otpExpiresAt: { type: Date, required: true },
        attempts: { type: Number, default: 0 },

        sendCount: { type: Number, default: 1 },
        lastSentAt: { type: Date, required: true },
        ipAddress: { type: String, default: null },

        // এই সময়ে MongoDB নিজে ডকুমেন্ট মুছে ফেলে (TTL)
        expiresAt: { type: Date, required: true }
    },
    { timestamps: true }
);

// TTL index: expiresAt পার হলেই MongoDB ডকুমেন্ট মুছে দেয় (প্রতি ~১ মিনিটে পরীক্ষা করে)
pendingSignupSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const PendingSignup = mongoose.model(
    "PendingSignup",
    pendingSignupSchema
);
