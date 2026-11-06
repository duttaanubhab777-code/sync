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
        // টেক্সট স্ট্যাটাস বা ছবির ক্যাপশন

        caption: {
            type: String,
            trim: true,
            maxlength: 700,
            default: ""
        },
        // টেক্সট স্ট্যাটাসের ব্যাকগ্রাউন্ড রঙ (যেমন "#0F4C3A")
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
        // কারা কারা স্ট্যাটাস দেখেছে এবং কখন দেখেছে
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
// text স্ট্যাটাসে লেখা, image/video স্ট্যাটাসে media.url লাগবে
storySchema.pre("validate", function () {
    if (this.type === "text") {
        if (!this.caption?.trim()) {
            this.invalidate("caption", "Text story needs some text");
        }
    } else if (!this.media?.url) {
        this.invalidate("media.url", `${this.type} story requires media.url`);
    }
});

// MongoDB TTL Index: expiresAt সময়ে পৌঁ ছা লে ই ডকুমে ন্টটি স্বয়ং ক্রি য়ভা বে মুছেমুছে যা বে !
storySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const Story = mongoose.model("Story", storySchema);
