import jwt from "jsonwebtoken";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { getAccessSecret } from "../utils/token.js";
import { User } from "../models/user.model.js";

// ---------- সাধারণ REST API-এর জন্য ----------
export const verifyJWT = asyncHandler(async (req, res, next) => {
    const token =
        req.cookies?.accessToken ||
        req.header("Authorization")?.replace("Bearer ", "").trim();

    if (!token) {
        throw new ApiError(401, "Unauthorised request");
    }

    let decoded;
    try {
        decoded = jwt.verify(token, getAccessSecret());
    } catch (error) {
        throw new ApiError(401, "Invalid or expired access token");
    }

    const user = await User.findById(decoded.id || decoded._id).select(
        "-password -refreshToken"
    );

    if (!user) {
        throw new ApiError(401, "Invalid access token");
    }

    // block করা ইউজারের পুরনো token দিয়েও আর ঢোকা যাবে না
    if (user.isBlocked) {
        throw new ApiError(403, "Your account has been blocked");
    }

    req.user = user;
    next();
});

// ---------- Socket.IO কানেকশনের সময় ----------
// token যাচাইয়ের পর DB থেকে দেখা হয় ইউজার এখনো আছে কিনা আর block হয়েছে কিনা
export const verifySocketToken = async (socket, next) => {
    try {
        const token =
            socket.handshake.auth?.token ||
            socket.handshake.headers?.authorization
                ?.replace("Bearer ", "")
                .trim();
        if (!token) return next(new Error("UNAUTHORIZED"));

        const decoded = jwt.verify(token, getAccessSecret());
        const userId = String(decoded.id || decoded._id);

        const user = await User.findById(userId)
            .select("username fullName isBlocked")
            .lean();
        if (!user || user.isBlocked) return next(new Error("UNAUTHORIZED"));

        socket.user = {
            id: userId,
            username: user.username,
            fullName: user.fullName
        };
        next();
    } catch {
        next(new Error("UNAUTHORIZED"));
    }
};

export const verifyAdmin = asyncHandler(async (req, res, next) => {
    if (!req.user) {
        throw new ApiError(401, "Unauthorized request");
    }
    if (req.user.role !== "admin" && req.user.role !== "superAdmin") {
        throw new ApiError(
            403,
            "Access denied! Only admins can perform this action."
        );
    }
    next();
});

export const verifySuperAdmin = asyncHandler(async (req, res, next) => {
    if (!req.user?.isSuperAdmin) {
        throw new ApiError(
            403,
            "Access denied! Only the Super Admin can perform this action."
        );
    }
    next();
});
