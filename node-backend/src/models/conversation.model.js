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
            type: String
        },

        // অফিশিয়াল Sync গ্রুপ চেনার জন্য (কেউ মুছতে বা ছাড়তে পারবে না)
        isOfficial: {
            type: Boolean,
            default: false
        },
        systemKey: {
            type: String
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

        groupDescription: {
            type: String,
            default: "",
            maxlength: 500
        },

        // group admin কারা: এটাই একমাত্র source of truth (member হলে এখানে নাম থাকবে না)
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
            messageId: { type: Schema.Types.ObjectId, ref: "Message" },
            text: { type: String, default: "" },
            type: { type: String, default: "text" },
            sender: { type: Schema.Types.ObjectId, ref: "User" },
            createdAt: { type: Date }
        },
        // চ্যাটের উপরে পিন করা মেসেজ (একবারে একটি)
        pinnedMessage: {
            messageId: { type: Schema.Types.ObjectId, ref: "Message" },
            text: { type: String, default: "" },
            type: { type: String, default: "text" },
            senderName: { type: String, default: "" },
            pinnedBy: { type: Schema.Types.ObjectId, ref: "User" },
            pinnedAt: { type: Date }
        },
        // কারা এই চ্যাট লিস্টের উপরে পিন করে রেখেছে ও কারা নোটিফিকেশন মিউট করেছে
        pinnedBy: [
            {
                type: Schema.Types.ObjectId,
                ref: "User"
            }
        ],
        mutedBy: [
            {
                type: Schema.Types.ObjectId,
                ref: "User"
            }
        ],
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

// শুধু direct চ্যাটে pairKey থাকে; group-এ থাকে না (string হলেই unique চেক হবে)
conversationSchema.index(
    { pairKey: 1 },
    { unique: true, partialFilterExpression: { pairKey: { $type: "string" } } }
);

// অফিশিয়াল সিস্টেম গ্রুপ যেন কখনো ডুপ্লিকেট না হয়
conversationSchema.index(
    { systemKey: 1 },
    { unique: true, partialFilterExpression: { systemKey: { $type: "string" } } }
);

const idOf = v => String(v?._id ?? v);

conversationSchema.pre("validate", function () {
    // members থেকে duplicate বাদ
    const seen = new Set();
    this.members = this.members.filter(m => {
        const key = idOf(m);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    if (this.type === "direct") {
        if (this.members.length !== 2) {
            this.invalidate(
                "members",
                "A direct chat must have exactly 2 members"
            );
            return;
        }
        this.pairKey = this.members.map(idOf).sort().join("_");
        // direct চ্যাটে group এর কিছু থাকবে না
        this.admins = [];
        this.groupName = "";
        this.groupIcon = "";
        this.groupDescription = "";
        this.onlyAdminCanMessage = false;
        return;
    }

    // ---------- group ----------
    this.pairKey = undefined;

    // অফিশিয়াল গ্রুপের createdBy সিস্টেম অ্যাকাউন্ট হওয়ায় তাকে সদস্য করা হয় না
    if (!this.isOfficial && this.createdBy && !seen.has(idOf(this.createdBy))) {
        this.members.push(this.createdBy);
        seen.add(idOf(this.createdBy));
    }

    if (!this.groupName?.trim()) {
        this.invalidate("groupName", "Group name is required");
    }
    if (!this.isOfficial && this.members.length < 2) {
        this.invalidate("members", "A group must have at least 2 members");
    }

    // admin হতে হলে আগে member হতে হবে (member না থাকলে admin থেকেও বাদ) + duplicate বাদ
    const adminSeen = new Set();
    this.admins = this.admins.filter(a => {
        const key = idOf(a);
        if (!seen.has(key) || adminSeen.has(key)) return false;
        adminSeen.add(key);
        return true;
    });

    // সাধারণ group-এ অন্তত একজন admin সবসময় থাকবে (অফিশিয়াল গ্রুপের admin তালিকা platform role থেকে আসে)
    if (!this.isOfficial && this.admins.length === 0 && this.members.length > 0) {
        const creatorIsMember =
            this.createdBy && seen.has(idOf(this.createdBy));
        this.admins = [creatorIsMember ? this.createdBy : this.members[0]];
    }
});

conversationSchema.methods.isMember = function (userId) {
    return this.members.some(m => idOf(m) === String(userId));
};

conversationSchema.methods.isGroupAdmin = function (userId) {
    return (
        this.type === "group" &&
        this.admins.some(a => idOf(a) === String(userId))
    );
};

// onlyAdminCanMessage চালু থাকলে শুধু group admin মেসেজ পাঠাতে পারবে
conversationSchema.methods.canSendMessage = function (userId) {
    if (!this.isMember(userId)) return false;
    if (this.type === "group" && this.onlyAdminCanMessage) {
        return this.isGroupAdmin(userId);
    }
    return true;
};

export const Conversation = mongoose.model("Conversation", conversationSchema);
