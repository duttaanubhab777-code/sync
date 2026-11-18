import mongoose, { Schema } from "mongoose";

const pushSubscriptionSchema = new Schema(
    {
        user: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },
        provider: {
            type: String,
            enum: ["webpush", "fcm"],
            default: "webpush"
        },
        platform: {
            type: String,
            default: "web"
        },
        endpoint: {
            type: String,
            required: true,
            unique: true
        },
        fcmToken: {
            type: String,
            default: null
        },
        keys: {
            p256dh: { type: String, default: "" },
            auth: { type: String, default: "" }
        },
        expirationTime: {
            type: Number,
            default: null
        }
    },
    { timestamps: true }
);

pushSubscriptionSchema.index({ user: 1, updatedAt: -1 });
export const PushSubscription = mongoose.model(
    "PushSubscription",
    pushSubscriptionSchema
);
