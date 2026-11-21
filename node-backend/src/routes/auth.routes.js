import { Router } from "express";
import {
    register,
    checkUsername,
    resendOtp,
    verifyOtp,
    login,
    forgotPasswordSendOtp,
    forgotPasswordReset,
    changePassword,
    refresh,
    logout,
    getMe
} from "../controllers/auth.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { validate } from "../middlewares/validator.middleware.js";
import {
    authLimiter,
    otpSendLimiter,
    otpVerifyLimiter,
    usernameCheckLimiter
} from "../middlewares/rateLimit.middleware.js";
import {
    registerSchema,
    loginSchema,
    verifyOtpSchema,
    resendOtpSchema,
    forgotPasswordSendSchema,
    forgotPasswordResetSchema,
    changePasswordSchema
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
// register ফর্মে username ফাঁকা আছে কিনা (লগইন লাগে না)
router.get("/username-available", usernameCheckLimiter, checkUsername);
// পুরনো ফ্রন্টএন্ডের জন্য alias: এটাও এখন শুধু OTP পাঠায়, সরাসরি account বানায় না
router.post("/register", otpSendLimiter, validate(registerSchema), register);
router.post("/login", authLimiter, validate(loginSchema), login);
// পাসওয়ার্ড ভুলে গেলে: কোড পাঠানো -> কোড + নতুন পাসওয়ার্ড দিয়ে রিসেট
router.post(
    "/forgot-password/send-otp",
    otpSendLimiter,
    validate(forgotPasswordSendSchema),
    forgotPasswordSendOtp
);
router.post(
    "/forgot-password/reset",
    otpVerifyLimiter,
    validate(forgotPasswordResetSchema),
    forgotPasswordReset
);
// লগইন করা অবস্থায় পাসওয়ার্ড বদলানো (ভুল বর্তমান পাসওয়ার্ডের চেষ্টা authLimiter-এ গোনা হয়)
router.post(
    "/change-password",
    verifyJWT,
    authLimiter,
    validate(changePasswordSchema),
    changePassword
);
router.post("/refresh", refresh);
router.post("/logout", logout);
router.get("/me", verifyJWT, getMe);

export default router;
