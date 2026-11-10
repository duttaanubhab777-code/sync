import { Router } from "express";
import {
    register,
    resendOtp,
    verifyOtp,
    login,
    refresh,
    logout,
    getMe
} from "../controllers/auth.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { validate } from "../middlewares/validator.middleware.js";
import {
    authLimiter,
    otpSendLimiter,
    otpVerifyLimiter
} from "../middlewares/rateLimit.middleware.js";
import {
    registerSchema,
    loginSchema,
    verifyOtpSchema,
    resendOtpSchema
} from "../validators/auth.validator.js";

const router = Router();

// OTP দিয়ে register: send-otp -> verify-otp (কোড না এলে resend-otp)
router.post(
    "/register/send-otp",
    otpSendLimiter,
    validate(registerSchema),
    register
);
router.post(
    "/register/resend-otp",
    otpSendLimiter,
    validate(resendOtpSchema),
    resendOtp
);
router.post(
    "/register/verify-otp",
    otpVerifyLimiter,
    validate(verifyOtpSchema),
    verifyOtp
);
// পুরনো ফ্রন্টএন্ডের জন্য alias: এটাও এখন শুধু OTP পাঠায়, সরাসরি account বানায় না
router.post("/register", otpSendLimiter, validate(registerSchema), register);
router.post("/login", authLimiter, validate(loginSchema), login);
router.post("/refresh", refresh);
router.post("/logout", logout);
router.get("/me", verifyJWT, getMe);

export default router;
