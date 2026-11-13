import { Router } from "express";
import { getLinkPreviewHandler } from "../controllers/linkPreview.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { linkPreviewLimiter } from "../middlewares/rateLimit.middleware.js";

const router = Router();
router.use(verifyJWT);
router.get("/", linkPreviewLimiter, getLinkPreviewHandler);

export default router;
