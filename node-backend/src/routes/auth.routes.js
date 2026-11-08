import { Router } from "express";
import {
    register,
    login,
    refresh,
    logout,
    getMe
} from "../controllers/auth.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { validate } from "../middlewares/validator.middleware.js";
import { authLimiter } from "../middlewares/rateLimit.middleware.js";
import { registerSchema, loginSchema } from "../validators/auth.validator.js";

const router = Router();

router.post("/register", authLimiter, validate(registerSchema), register);
router.post("/login", authLimiter, validate(loginSchema), login);
router.post("/refresh", refresh);
router.post("/logout", logout);
router.get("/me", verifyJWT, getMe);

export default router;
