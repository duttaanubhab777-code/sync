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
        // "Delete for everyone" করলে মে সে জ না মুছেমুছে ফ্ল্যা গ অন হবে
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

// চ্যাটের পুরনো মেসেজ লোড (pagination) করার ইনডেক্স
messageSchema.index({ conversationId: 1, _id: -1 });

// একই মেসেজ দুবার সেভ না হওয়ার (idempotency) ইউনিক ইনডেক্স
messageSchema.index({ sender: 1, clientMsgId: 1 }, { unique: true });

export const Message = mongoose.model("Message", messageSchema);
