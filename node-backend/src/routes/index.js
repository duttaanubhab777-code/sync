import { Router } from "express";
import authRoutes from "./auth.routes.js";
import userRoutes from "./user.routes.js";
import conversationRoutes from "./conversation.routes.js";
import storyRoutes from "./story.routes.js";
import notificationRoutes from "./notification.routes.js";
import noticeRoutes from "./notice.routes.js";
import adminRoutes from "./admin.routes.js";
import linkPreviewRoutes from "./linkPreview.routes.js";
import appUpdateRoutes from "./appUpdate.routes.js";
import wallpaperRoutes from "./wallpaper.routes.js";
import {
    syncMessages,
    deliveryAck,
    getMessageInfo,
    forwardMessage
} from "../controllers/message.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = Router();

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/conversations", conversationRoutes);
router.use("/stories", storyRoutes);
router.use("/notifications", notificationRoutes);
router.use("/notices", noticeRoutes);
router.use("/admin", adminRoutes);
router.use("/link-preview", linkPreviewRoutes);
router.use("/app", appUpdateRoutes);
router.use("/wallpapers", wallpaperRoutes);
router.get("/sync", verifyJWT, syncMessages);
router.post("/messages/delivery-ack", deliveryAck);
router.get("/messages/:id/info", verifyJWT, getMessageInfo);
router.post("/messages/:id/forward", verifyJWT, forwardMessage);

export default router;
