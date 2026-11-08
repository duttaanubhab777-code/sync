import mongoose from "mongoose";
import mongooseAggregatePaginate from "mongoose-aggregate-paginate-v2";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import {
    getAccessSecret,
    getRefreshSecret,
    getAccessExpiry
} from "../utils/token.js";

const userSchema = new mongoose.Schema(
    {
        username: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
            index: true
        },
        fullName: {
            type: String,
            required: true,
            trim: true
        },
        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true
        },

        phoneNumber: {
            type: String, // phone number  string beacuse +91 etc
            required: true,
            unique: true,
            trim: true,
            index: true
        },
        password: {
            type: String,
            required: true
        },

        avatar: {
            type: String, //cloudnary URL
            default: ""
        },

        lastSeen: { type: Date, default: null },

        blockedUser: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "User"
            }
        ],

        ipAddress: {
            type: String,
            default: null
        },
        loginHistory: {
            type: [
                {
                    ipAddress: { type: String },
                    loginTime: { type: Date, default: Date.now }
                }
            ],
            select: false
        },
        role: {
            type: String,
            enum: ["user", "admin", "superAdmin"],
            default: "user",
            index: true
        },
        isSuperAdmin: {
            type: Boolean,
            default: false
        },
        isBlocked: {
            type: Boolean,
            default: false
        },

        //whatsapp style bio

        about: {
            type: String,
            default: "Hello ! I am using Sync 😃",
            maxlength: 140
        },

        refreshToken: {
            type: String
        }
    },
    { timestamps: true }
);

// validate এর আগেই role ঠিক করা হয়, যাতে role/isSuperAdmin কখনো অসঙ্গত না হয়
userSchema.pre("validate", function () {
    const superAdminEmail = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();

    if (this.isNew && superAdminEmail && this.email === superAdminEmail) {
        this.isSuperAdmin = true;
    }

    // Super Admin not blocked
    if (this.isSuperAdmin) {
        this.role = "superAdmin";
        this.isBlocked = false;
    }
});

userSchema.pre("save", async function () {
    // OTP দিয়ে register হলে password আগেই hash করা থাকে, তাই আবার hash করা হবে না
    if (!this.isModified("password") || this.$locals?.skipHash) return;

    this.password = await bcrypt.hash(this.password, 10);
});

userSchema.methods.isPasswordCorrect = async function (password) {
    return await bcrypt.compare(password, this.password);
};

// Node ও Python দুই সার্ভিসেই যেন একই token কাজ করে, তাই payload-এ id আর _id দুটোই আছে
userSchema.methods.generateAccessToken = function () {
    return jwt.sign(
        {
            id: this._id.toString(),
            _id: this._id.toString(),
            email: this.email,
            username: this.username,
            fullName: this.fullName
        },
        getAccessSecret(),
        { expiresIn: getAccessExpiry() }
    );
};

userSchema.methods.generateRefreshToken = function () {
    return jwt.sign(
        { id: this._id.toString(), _id: this._id.toString() },
        getRefreshSecret(),
        { expiresIn: process.env.REFRESH_TOKEN_EXPIRY || "30d" }
    );
};

// আগের বানান-ভুল নামগুলোও রাখা হলো, যাতে কোথাও পুরনো নামে কল করলে এরর না দেয়
userSchema.methods.genarateAccessToken = userSchema.methods.generateAccessToken;
userSchema.methods.genarateRefreshToken =
    userSchema.methods.generateRefreshToken;

userSchema.plugin(mongooseAggregatePaginate);

export const User = mongoose.model("User", userSchema);
