import mongoose, { Schema } from "mongoose";

const conversationSchema = new Schema(
    {
        type: {
            type: String,
            enum: ["direct", "group"],
            default: "direct"
        },
        members: [
            {
                type: Schema.Types.ObjectId,
                ref: "User",
                required: true
            }
        ],
        // একই দুজনের মধ্যে যেন ভুল করে দুটো আলাদা direct chat তৈরি না হয় (যেমন: "userIdA_userIdB")
        pairKey: {
            type: String,
            unique: true,
            sparse: true
        },

        //whatsapp group style feature

        groupName: {
            type: String,
            trim: true,
            maxlength: 100,
            default: ""
        },

        groupIcon: {
            type: String, //cloudinary URL
            default: ""
        },

        groupDrescription: {
            type: String,
            default: "",
            maxlength: 500
        },

        groupRole: {
            type: String,

            enum: ["member", "groupAdmin"],
            default: "member",
            index: true
        },

        admins: [
            {
                type: Schema.Types.ObjectId,
                ref: "User"
            }
        ],

        createdBy: {
            type: Schema.Types.ObjectId,
            ref: "User"
        },

        onlyAdminCanMessage: {
            type: Boolean,
            default: false
        },

        // চ্যাট লিস্টে শেষ মেসেজের প্রিভিউ দ্রুত দেখানোর জন্য
        lastMessage: {
            text: { type: String, default: "" },
            type: { type: String, default: "text" },
            sender: { type: Schema.Types.ObjectId, ref: "User" },
            createdAt: { type: Date }
        },
        // কোন ইউজারের কটা মেসেজ এখনো দেখা হয়নি (userId -> সংখ্যা)
        unread: {
            type: Map,
            of: Number,
            default: {}
        }
    },
    { timestamps: true }
);

// ইউজারের চ্যাট লিস্ট দ্রুত লোড করার জন্য ইনডেক্স
conversationSchema.index({ members: 1, updatedAt: -1 });

export const Conversation = mongoose.model("Conversation", conversationSchema);
