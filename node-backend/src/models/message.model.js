import mongoose, { Schema } from "mongoose";
import { pickContact, pickLocation } from "../utils/attachments.js";

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
            enum: ["text", "image", "video", "audio", "file", "location", "contact"],
            default: "text"
        },
        text: {
            type: String,
            trim: true,
            maxlength: 4000,
            default: ""
        },
        // অফিশিয়াল ওয়েলকাম মেসেজের স্পেশাল কার্ড প্যালেট দেখানোর জন্য
        card: {
            kind: { type: String, enum: ["welcome"] },
            name: { type: String, trim: true, maxlength: 100 }
        },
        media: {
            url: { type: String },
            publicId: { type: String },
            mime: { type: String },
            fileName: { type: String, trim: true, maxlength: 180 },
            bytes: { type: Number },
            width: { type: Number },
            height: { type: Number },
            duration: { type: Number }
        },
        // লোকেশন মেসেজের স্থানাঙ্ক ও ঠিকানা
        location: {
            lat: { type: Number, min: -90, max: 90 },
            lng: { type: Number, min: -180, max: 180 },
            accuracy: { type: Number, min: 0 },
            address: { type: String, trim: true, maxlength: 240 }
        },
        // কনট্যাক্ট কার্ডের নাম ও ফোন নম্বর
        contact: {
            name: { type: String, trim: true, maxlength: 100 },
            phones: [{ type: String, trim: true, maxlength: 32 }]
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

// text মেসেজে লেখা, location/contact-এ নিজস্ব ডেটা, আর মিডিয়া ধরনে media.url থাকতেই হবে
messageSchema.pre("validate", function () {
    if (this.deletedForEveryone) return;
    if (this.type === "text") {
        if (!this.text?.trim()) {
            this.invalidate("text", "Text message cannot be empty");
        }
    } else if (this.type === "location") {
        const clean = pickLocation(this.location);
        if (!clean) {
            this.invalidate(
                "location",
                "Location message requires valid latitude (-90..90) and longitude (-180..180)"
            );
        } else {
            this.location = clean;
        }
    } else if (this.type === "contact") {
        const clean = pickContact(this.contact);
        if (!clean) {
            this.invalidate(
                "contact",
                "Contact message requires a valid name and at least one valid phone number"
            );
        } else {
            this.contact = clean;
        }
    } else if (!this.media?.url) {
        this.invalidate("media.url", `${this.type} message requires media.url`);
    }
});

// চ্যাটের পুরনো মেসেজ লোড (pagination) করার ইনডেক্স
messageSchema.index({ conversationId: 1, _id: -1 });

// মিডিয়া মুছার আগে "অন্য মেসেজ একই ফাইল ব্যবহার করছে কিনা" দেখার জন্য
messageSchema.index(
    { "media.url": 1 },
    { partialFilterExpression: { "media.url": { $type: "string" } } }
);

// একই মেসেজ দুবার সেভ না হওয়ার (idempotency) ইউনিক ইনডেক্স
messageSchema.index({ sender: 1, clientMsgId: 1 }, { unique: true });

export const Message = mongoose.model("Message", messageSchema);
