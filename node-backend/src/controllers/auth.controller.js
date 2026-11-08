import jwt from "jsonwebtoken";
import { User } from "../models/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { getRefreshSecret, hashToken } from "../utils/token.js";
import { setAuthCookies, clearAuthCookies } from "../utils/authCookies.js";
import { isValidCloudinaryUrl } from "../utils/cloudinary.js";

const MAX_DEVICES = 5; // একসাথে সর্বোচ্চ কয়টা ডিভাইসে লগইন থাকবে
const MAX_LOGIN_HISTORY = 20;

// পাসওয়ার্ড, token, IP ছাড়া ইউজার ফেরত দেওয়া
export const publicUser = user => {
    const o = typeof user.toObject === "function" ? user.toObject() : { ...user };
    delete o.password;
    delete o.refreshTokens;
    delete o.loginHistory;
    delete o.ipAddress;
    delete o.__v;
    return o;
};

const issueTokens = async user => {
    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();
    await User.updateOne(
        { _id: user._id },
        {
            $push: {
                refreshTokens: {
                    $each: [hashToken(refreshToken)],
                    $slice: -MAX_DEVICES
                }
            }
        }
    );
    return { accessToken, refreshToken };
};

const readRefreshToken = req =>
    req.cookies?.refreshToken || req.body?.refreshToken || null;

// POST /api/auth/register
export const register = asyncHandler(async (req, res) => {
    const { username, fullName, email, phoneNumber, password, avatar } =
        req.body;

    if (avatar && !isValidCloudinaryUrl(avatar)) {
        throw new ApiError(400, "Avatar must be an uploaded image");
    }

    const existing = await User.findOne({
        $or: [{ email }, { username }, { phoneNumber }]
    })
        .select("email username phoneNumber")
        .lean();
    if (existing) {
        const field =
            existing.email === email
                ? "Email"
                : existing.username === username
                  ? "Username"
                  : "Phone number";
        throw new ApiError(409, `${field} is already registered`);
    }

    let user;
    try {
        user = await User.create({
            username,
            fullName,
            email,
            phoneNumber,
            password,
            avatar: avatar || "",
            ipAddress: req.ip,
            loginHistory: [{ ipAddress: req.ip }]
        });
    } catch (err) {
        // দুজন একসাথে একই তথ্যে register করলে unique index আটকায়
        if (err?.code === 11000) {
            throw new ApiError(409, "Account already exists with these details");
        }
        throw err;
    }

    const tokens = await issueTokens(user);
    setAuthCookies(res, tokens);
    res.status(201).json(
        new ApiResponse(
            201,
            { user: publicUser(user), ...tokens },
            "Registered successfully"
        )
    );
});

// POST /api/auth/login   body: { identifier: username | email | phone, password }
export const login = asyncHandler(async (req, res) => {
    const { identifier, password } = req.body;

    const user = await User.findOne({
        $or: [
            { email: identifier },
            { username: identifier },
            { phoneNumber: identifier }
        ]
    });
    // কোনটা ভুল সেটা বলা হয় না (user আছে কিনা জানতে না পারে)
    if (!user || !(await user.isPasswordCorrect(password))) {
        throw new ApiError(401, "Invalid credentials");
    }
    if (user.isBlocked) {
        throw new ApiError(403, "Your account has been blocked");
    }

    await User.updateOne(
        { _id: user._id },
        {
            $set: { ipAddress: req.ip },
            $push: {
                loginHistory: {
                    $each: [{ ipAddress: req.ip, loginTime: new Date() }],
                    $slice: -MAX_LOGIN_HISTORY
                }
            }
        }
    );

    const tokens = await issueTokens(user);
    setAuthCookies(res, tokens);
    res.status(200).json(
        new ApiResponse(
            200,
            { user: publicUser(user), ...tokens },
            "Logged in successfully"
        )
    );
});

// POST /api/auth/refresh   (cookie অথবা body.refreshToken) -> নতুন access token
export const refresh = asyncHandler(async (req, res) => {
    const token = readRefreshToken(req);
    if (!token) throw new ApiError(401, "Refresh token is missing");

    let decoded;
    try {
        decoded = jwt.verify(token, getRefreshSecret());
    } catch {
        clearAuthCookies(res);
        throw new ApiError(401, "Invalid or expired refresh token");
    }
    if (decoded.tokenType !== "refresh") {
        throw new ApiError(401, "Invalid refresh token");
    }

    const user = await User.findById(decoded.id || decoded._id).select(
        "+refreshTokens"
    );
    if (!user || !user.refreshTokens.includes(hashToken(token))) {
        clearAuthCookies(res);
        throw new ApiError(401, "Session expired, please login again");
    }
    if (user.isBlocked) {
        throw new ApiError(403, "Your account has been blocked");
    }

    const accessToken = user.generateAccessToken();
    setAuthCookies(res, { accessToken });
    res.status(200).json(
        new ApiResponse(200, { accessToken }, "Token refreshed")
    );
});

// POST /api/auth/logout
// access token মেয়াদ শেষ হয়ে গেলেও লগআউট যেন কাজ করে, তাই verifyJWT লাগে না
export const logout = asyncHandler(async (req, res) => {
    const token = readRefreshToken(req);
    if (token) {
        try {
            const decoded = jwt.verify(token, getRefreshSecret());
            await User.updateOne(
                { _id: decoded.id || decoded._id },
                { $pull: { refreshTokens: hashToken(token) } }
            );
        } catch {
            // token আগেই অকেজো, কিছু করার নেই
        }
    }
    clearAuthCookies(res);
    res.status(200).json(new ApiResponse(200, null, "Logged out"));
});

// GET /api/auth/me
export const getMe = asyncHandler(async (req, res) => {
    res.status(200).json(new ApiResponse(200, publicUser(req.user)));
});
