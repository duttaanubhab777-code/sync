import mongoose from "mongoose";
import { ApiError } from "./ApiError.js";

export const isObjectId = v => mongoose.isValidObjectId(v) && String(v).length === 24;

export const assertObjectId = (v, name = "id") => {
    if (!isObjectId(v)) throw new ApiError(400, `Invalid ${name}`);
    return String(v);
};

// ইউজারের লেখা সার্চ টেক্সট regex-এ বসানোর আগে escape করা (regex injection আটকাতে)
export const escapeRegex = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const idOf = v => String(v?._id ?? v);

// ২৪ ঘণ্টা (মিলিসেকেন্ডে)
export const DAY_MS = 24 * 60 * 60 * 1000;

// user populate-এ যেসব ফিল্ড দেখানো হবে
export const PUBLIC_USER_FIELDS = "username fullName avatar about lastSeen";
