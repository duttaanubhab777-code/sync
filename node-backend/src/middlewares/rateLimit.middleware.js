import rateLimit from "express-rate-limit";

// সীমা পার হলে সব এরর যে আকারে যায়, সেই আকারেই JSON ফেরত দেওয়া
const tooMany = message => (_req, res) =>
    res
        .status(429)
        .json({ success: false, statusCode: 429, message, errors: [] });

// সব /api রিকোয়েস্টের জন্য: প্রতি IP-তে মিনিটে ৩০০টা
export const apiLimiter = rateLimit({
    windowMs: 60_000,
    limit: 300,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: tooMany("Too many requests, please slow down")
});

// register/login-এ পাসওয়ার্ড অনুমান ঠেকাতে: ১৫ মিনিটে ২০টা ব্যর্থ চেষ্টা (সফল হলে গোনা হয় না)
export const authLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 20,
    skipSuccessfulRequests: true,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: tooMany("Too many attempts, try again after some time")
});

// OTP ইমেইল পাঠানো: সফল হলেও গোনা হয় (ইমেইল-বোমা ঠেকাতে), প্রতি IP-তে ১৫ মিনিটে ১০টা
export const otpSendLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: tooMany("Too many code requests, try again after some time")
});

// OTP যাচাই: প্রতি IP-তে ১৫ মিনিটে ৩০টা ব্যর্থ চেষ্টা (ইমেইল-প্রতি সীমা controller-এ আলাদা আছে)
export const otpVerifyLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 30,
    skipSuccessfulRequests: true,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: tooMany("Too many attempts, try again after some time")
});
