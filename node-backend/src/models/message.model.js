import mongoose, { Schema } from "mongoose";

const messageSchema = new Schema(
    {
        conversationId: {
            type: Schema.Types.ObjectId,
            ref: "Conversation",
            required: true
        },
        sender: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        // ফ্রন্টএন্ড থেকে পাঠানো ইউনিক আইডি (নেটওয়ার্ক সমস্যায় একই মেসেজ দুবার সেভ হওয়া ঠেকাতে)
        clientMsgId: {
            type: String,
            required: true
        },
        type: {
            type: String,
            enum: ["text", "image", "video", "audio", "file"],
            default: "text"
        },
        text: {
            type: String,
            trim: true,
            maxlength: 4000,
            default: ""
        },
        media: {
            url: { type: String },
            publicId: { type: String },
            mime: { type: String },
            bytes: { type: Number },
            width: { type: Number },
            height: { type: Number },
            duration: { type: Number }
        },

        //whatsapp style swipe reply to feature

        replyTo: {
            type: Schema.Types.ObjectId,
            ref: "Message",
            default: null
        },
        // story-তে reply করলে সেই story-র একটা ছোট snapshot (story মুছে গেলেও চ্যাটে দেখা যাবে)
        storyReply: {
            storyId: { type: Schema.Types.ObjectId },
            authorId: { type: Schema.Types.ObjectId, ref: "User" },
            type: { type: String, enum: ["text", "image", "video"] },
            caption: { type: String, maxlength: 160 },
            backgroundColor: { type: String },
            thumbnail: { type: String }
        },
        status: {
            type: String,
            enum: ["sent", "delivered", "seen"],
            default: "sent"
        },

        deliveredTo: [
            {
                user: { type: Schema.Types.ObjectId, ref: "User" },
                deliveredAt: { type: Date, default: Date.now }
            }
        ],
        seenBy: [
            {
                user: { type: Schema.Types.ObjectId, ref: "User" },
                seenAt: { type: Date, default: Date.now }
            }
        ],
        // "Delete for everyone" করলে মেসেজ মুছে না ফেলে এই ফ্ল্যাগ অন হবে
        deletedForEveryone: {
            type: Boolean,
            default: false
        },
        hidden: {
            type: Boolean,
            default: false
        }
    },
    { timestamps: true }
);

// text মেসেজে লেখা, আর বাকি সব ধরনে media.url থাকতেই হবে
messageSchema.pre("validate", function () {
    if (this.deletedForEveryone) return;
    if (this.type === "text") {
        if (!this.text?.trim()) {
            this.invalidate("text", "Text message cannot be empty");
        }
    } else if (!this.media?.url) {
        this.invalidate("media.url", `${this.type} message requires media.url`);
    }
});

// চ্যাটের পুরনো মেসেজ লোড (pagination) করার ইনডেক্স
messageSchema.index({ conversationId: 1, _id: -1 });

// একই মেসেজ দুবার সেভ না হওয়ার (idempotency) ইউনিক ইনডেক্স
messageSchema.index({ sender: 1, clientMsgId: 1 }, { unique: true });

export const Message = mongoose.model("Message", messageSchema);
