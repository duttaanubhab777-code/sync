import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { User } from "../models/user.model.js";
import { PendingSignup } from "../models/pending-signup.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { getRefreshSecret, hashToken } from "../utils/token.js";
import { setAuthCookies, clearAuthCookies } from "../utils/authCookies.js";
import { isValidCloudinaryUrl } from "../utils/cloudinary.js";
import {
    PENDING_SIGNUP_TTL_MS,
    generateOtp,
    hashOtp,
    isOtpMatch,
    otpCooldownMs,
    otpExpiryMs,
    otpMaxAttempts,
    otpMaxSends
} from "../utils/otp.js";
import { MailRelayError, sendOtpEmail } from "../services/mail.service.js";

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

// ---------- OTP দিয়ে register ----------
// ধাপ ১: POST /api/auth/register/send-otp   (তথ্য যাচাই -> pending সংরক্ষণ -> ইমেইলে ৬ অঙ্কের কোড)
// ধাপ ২: POST /api/auth/register/verify-otp (সঠিক কোড দিলে আসল অ্যাকাউন্ট তৈরি + লগইন)
// কোড না এলে: POST /api/auth/register/resend-otp

const secondsLeft = ms => Math.max(1, Math.ceil(ms / 1000));

// ইমেইল / ইউজারনেম / ফোন আগেই নেওয়া থাকলে 409
const assertNotRegistered = async ({ email, username, phoneNumber }) => {
    const existing = await User.findOne({
        $or: [{ email }, { username }, { phoneNumber }]
    })
        .select("email username phoneNumber")
        .lean();
    if (!existing) return;
    const field =
        existing.email === email
            ? "Email"
            : existing.username === username
              ? "Username"
              : "Phone number";
    throw new ApiError(409, `${field} is already registered`);
};

// pending-এ "কোড পাঠানোর সুযোগ" নেওয়া: cooldown ও সর্বোচ্চ-সংখ্যা এখানেই atomic ভাবে যাচাই হয়,
// তাই দুটো রিকোয়েস্ট একসাথে এলেও একটাই পাঠানো যায়।
const claimSend = async (email, fields, otp, req) => {
    const now = new Date();
    const set = {
        ...fields,
        otpHash: hashOtp(email, otp),
        otpExpiresAt: new Date(now.getTime() + otpExpiryMs()),
        attempts: 0,
        lastSentAt: now,
        ipAddress: req.ip
    };

    const updated = await PendingSignup.findOneAndUpdate(
        {
            email,
            lastSentAt: { $lte: new Date(now.getTime() - otpCooldownMs()) },
            sendCount: { $lt: otpMaxSends() }
        },
        { $set: set, $inc: { sendCount: 1 } },
        { returnDocument: "after" }
    );
    if (updated) return updated;

    try {
        return await PendingSignup.create({
            email,
            ...set,
            sendCount: 1,
            expiresAt: new Date(now.getTime() + PENDING_SIGNUP_TTL_MS)
        });
    } catch (err) {
        if (err?.code !== 11000) throw err;
    }

    // ডকুমেন্ট আছে কিন্তু আটকে গেছে: কেন, সেটা ব্যবহারকারীকে জানানো
    const current = await PendingSignup.findOne({ email })
        .select("sendCount lastSentAt expiresAt")
        .lean();
    if (!current) throw new ApiError(409, "Please try again");
    if (current.sendCount >= otpMaxSends()) {
        const wait = secondsLeft(current.expiresAt.getTime() - now.getTime());
        throw new ApiError(
            429,
            "Too many codes requested for this email. Please try again later.",
            [{ retryAfterSeconds: wait }]
        );
    }
    const wait = secondsLeft(
        current.lastSentAt.getTime() + otpCooldownMs() - now.getTime()
    );
    throw new ApiError(
        429,
        `Please wait ${wait} seconds before requesting a new code`,
        [{ retryAfterSeconds: wait }]
    );
};

// ইমেইল পাঠানো। ব্যর্থ হলে cooldown/count ফেরত দেওয়া হয়, যাতে ইউজার সাথে সাথে আবার চেষ্টা করতে পারে।
const deliverOtp = async (pending, otp) => {
    try {
        await sendOtpEmail({
            to: pending.email,
            fullName: pending.fullName,
            otp,
            minutes: Math.round(otpExpiryMs() / 60_000)
        });
    } catch (err) {
        await PendingSignup.updateOne(
            { _id: pending._id },
            { $set: { lastSentAt: new Date(0) }, $inc: { sendCount: -1 } }
        ).catch(() => {});

        if (err instanceof MailRelayError) {
            console.error(`[OTP] mail failed (${err.code}): ${err.message}`);
            if (err.status === 429) {
                throw new ApiError(
                    429,
                    "Too many emails sent to this address. Please wait a few minutes."
                );
            }
            throw new ApiError(
                503,
                "We could not send the verification email right now. Please try again in a moment."
            );
        }
        throw err;
    }
};

const otpSentResponse = (res, pending) =>
    res.status(200).json(
        new ApiResponse(
            200,
            {
                email: pending.email,
                expiresInSeconds: secondsLeft(otpExpiryMs()),
                resendAfterSeconds: secondsLeft(otpCooldownMs())
            },
            "Verification code sent to your email"
        )
    );

// POST /api/auth/register/send-otp   (পুরনো POST /api/auth/register-ও এখানেই আসে, OTP ছাড়া account বানানোর রাস্তা নেই)
export const register = asyncHandler(async (req, res) => {
    const { username, fullName, email, phoneNumber, password, avatar } =
        req.body;

    if (avatar && !isValidCloudinaryUrl(avatar)) {
        throw new ApiError(400, "Avatar must be an uploaded image");
    }
    await assertNotRegistered({ email, username, phoneNumber });

    const otp = generateOtp();
    const pending = await claimSend(
        email,
        {
            username,
            fullName,
            phoneNumber,
            avatar: avatar || "",
            passwordHash: await bcrypt.hash(password, 10)
        },
        otp,
        req
    );
    await deliverOtp(pending, otp);
    otpSentResponse(res, pending);
});

// POST /api/auth/register/resend-otp   body: { email }
export const resendOtp = asyncHandler(async (req, res) => {
    const { email } = req.body;

    const existing = await PendingSignup.findOne({ email })
        .select("username fullName phoneNumber avatar passwordHash")
        .lean();
    if (!existing) {
        throw new ApiError(
            404,
            "Signup session expired. Please fill the form again."
        );
    }
    // এর মধ্যে কেউ ওই ইমেইল/ইউজারনেম/ফোন নিয়ে নিলে নতুন কোড পাঠানো অর্থহীন
    await assertNotRegistered({
        email,
        username: existing.username,
        phoneNumber: existing.phoneNumber
    });

    const otp = generateOtp();
    const pending = await claimSend(
        email,
        {
            username: existing.username,
            fullName: existing.fullName,
            phoneNumber: existing.phoneNumber,
            avatar: existing.avatar,
            passwordHash: existing.passwordHash
        },
        otp,
        req
    );
    await deliverOtp(pending, otp);
    otpSentResponse(res, pending);
});

// POST /api/auth/register/verify-otp   body: { email, otp }
export const verifyOtp = asyncHandler(async (req, res) => {
    const { email, otp } = req.body;
    const now = new Date();
    const maxAttempts = otpMaxAttempts();

    // চেষ্টার সংখ্যা আগে বাড়ানো হয় (atomic), তাই একসাথে অনেক অনুমান পাঠিয়েও সীমা পার করা যায় না
    const pending = await PendingSignup.findOneAndUpdate(
        {
            email,
            otpExpiresAt: { $gt: now },
            attempts: { $lt: maxAttempts }
        },
        { $inc: { attempts: 1 } },
        { returnDocument: "after" }
    );

    if (!pending) {
        const current = await PendingSignup.findOne({ email })
            .select("otpExpiresAt attempts")
            .lean();
        if (!current) {
            throw new ApiError(
                404,
                "Signup session expired. Please fill the form again."
            );
        }
        if (current.otpExpiresAt <= now) {
            throw new ApiError(
                400,
                "This code has expired. Please request a new one."
            );
        }
        throw new ApiError(
            429,
            "Too many wrong attempts. Please request a new code."
        );
    }

    if (!isOtpMatch(email, otp, pending.otpHash)) {
        const left = maxAttempts - pending.attempts;
        throw new ApiError(
            400,
            left > 0
                ? `Incorrect code. ${left} attempt${left === 1 ? "" : "s"} left.`
                : "Incorrect code. Too many wrong attempts, please request a new code."
        );
    }

    // কোড একবারই ব্যবহার করা যায়: যে রিকোয়েস্ট ডকুমেন্ট মুছতে পারে, শুধু সে-ই account বানায়
    const consumed = await PendingSignup.findOneAndDelete({
        _id: pending._id,
        otpHash: pending.otpHash
    });
    if (!consumed) {
        throw new ApiError(400, "This code was already used.");
    }

    await assertNotRegistered({
        email: consumed.email,
        username: consumed.username,
        phoneNumber: consumed.phoneNumber
    });

    let user;
    try {
        user = new User({
            username: consumed.username,
            fullName: consumed.fullName,
            email: consumed.email,
            phoneNumber: consumed.phoneNumber,
            password: consumed.passwordHash, // আগেই bcrypt hash করা
            avatar: consumed.avatar || "",
            ipAddress: req.ip,
            loginHistory: [{ ipAddress: req.ip }]
        });
        user.$locals.skipHash = true; // user.model.js-এর pre-save যেন আবার hash না করে
        await user.save();
    } catch (err) {
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
