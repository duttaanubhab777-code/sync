import mongoose, { Schema } from "mongoose";
const storySchema = new Schema(
    {
        author: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },
        type: {
            type: String,
            enum: ["text", "image", "video"],
            required: true
        },
        // টে ক্সট স্ট্যা টা স বা ছবি র ক্যা পশন

        caption: {
            type: String,
            trim: true,
            maxlength: 700,
            default: ""
        },
        // টে ক্সট স্ট্যা টা সে র ব্যা কগ্রা উন্ড রঙ (যে মন "#0F4C3A")
        backgroundColor: {
            type: String,
            default: "#0F4C3A"
        },
        media: {
            url: { type: String, default: "" },
            publicId: { type: String, default: "" },
            mime: { type: String, default: "" },
            duration: { type: Number, default: 0 }
        },
        // কা রা কা রা আমা র স্ট্যা টা স দে খে ছে এবং কখন দে খে ছে
        viewers: [
            {
                user: { type: Schema.Types.ObjectId, ref: "User" },
                viewedAt: { type: Date, default: Date.now }
            }
        ],
        // ঠিক ২৪ ঘণ্টা পরে র সময় এখা নে সে ট থা কবে
        expiresAt: {
            type: Date,
            required: true,
            default: () => new Date(Date.now() + 24 * 60 * 60 * 1000)
        }
    },
    { timestamps: true }
);
// MongoDB TTL Index: expiresAt সময়ে পৌঁ ছা লে ই ডকুমে ন্টটি স্বয়ং ক্রি য়ভা বে মুছেমুছে যা বে !
storySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const Story = mongoose.model("Story", storySchema);
