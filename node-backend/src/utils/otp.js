import crypto from "node:crypto";

// OTP-র সব নিয়ম এক জায়গায়। মান বদলাতে চাইলে .env-এ দিলেই হবে (নইলে নিচের ডিফল্ট)।
export const OTP_LENGTH = 6;

const intFromEnv = (name, fallback, min, max) => {
    const n = Number.parseInt(process.env[name] ?? "", 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(Math.max(n, min), max);
};

// কোড কত মিনিট চলবে
export const otpExpiryMs = () =>
    intFromEnv("OTP_EXPIRES_MINUTES", 10, 3, 30) * 60_000;

// একই ইমেইলে পরপর কোড পাঠানোর মাঝে কমপক্ষে কত সেকেন্ড
export const otpCooldownMs = () =>
    intFromEnv("OTP_RESEND_COOLDOWN_SECONDS", 60, 15, 600) * 1000;

// একটা signup চেষ্টায় (এক ঘণ্টার মধ্যে) সর্বোচ্চ কতবার কোড পাঠানো যাবে
export const otpMaxSends = () => intFromEnv("OTP_MAX_SENDS", 5, 2, 20);

// ভুল কোড দিলে কতবার চেষ্টা করা যাবে (তারপর নতুন কোড লাগবে)
export const otpMaxAttempts = () => intFromEnv("OTP_MAX_ATTEMPTS", 5, 3, 10);

// pending signup কতক্ষণ থাকবে (এরপর MongoDB TTL নিজে মুছে ফেলে)
export const PENDING_SIGNUP_TTL_MS = 60 * 60_000;

// crypto.randomInt নিরাপদ (Math.random নয়)। শুরুর 0 থাকলেও ৬ অঙ্ক থাকে।
export const generateOtp = () =>
    String(crypto.randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, "0");

// OTP ডাটাবেসে সাদা লেখায় রাখা হয় না: HMAC-SHA256(secret, email:otp)
const otpSecret = () => {
    const secret =
        process.env.OTP_SECRET ||
        process.env.JWT_SECRET ||
        process.env.ACCESS_TOKEN_SECRET;
    if (!secret) throw new Error("JWT_SECRET (or OTP_SECRET) is not set");
    return secret;
};

export const hashOtp = (email, otp) =>
    crypto
        .createHmac("sha256", otpSecret())
        .update(`${String(email).toLowerCase()}:${String(otp)}`)
        .digest("hex");

export const isOtpMatch = (email, otp, expectedHash) => {
    if (!expectedHash) return false;
    const a = Buffer.from(hashOtp(email, otp), "hex");
    const b = Buffer.from(String(expectedHash), "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
};
