import { Router } from "express";
import authRoutes from "./auth.routes.js";
import userRoutes from "./user.routes.js";
import chatRoutes from "./conversation.routes.js";
import messageRoutes from "./message.routes.js";
import storyRoutes from "./story.routes.js";
import notificationRoutes from "./notification.routes.js";
import noticeRoutes from "./notice.routes.js";
import adminRoutes from "./admin.routes.js";
import linkPreviewRoutes from "./linkPreview.routes.js";
import updateRoutes from "./appUpdate.routes.js";
import commitRoutes from "./commit.routes.js";
import wallpaperRoutes from "./wallpaper.routes.js";

const router = Router();

// Frontend page route-এর সাথে একই নাম: /chats, /stories, /updates, /admin, /login → /auth/login
router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/chats", chatRoutes);
router.use("/messages", messageRoutes);
router.use("/stories", storyRoutes);
router.use("/notifications", notificationRoutes);
router.use("/notices", noticeRoutes);
router.use("/admin", adminRoutes);
router.use("/link-preview", linkPreviewRoutes);
router.use("/updates", updateRoutes);
router.use("/commits", commitRoutes);
router.use("/wallpapers", wallpaperRoutes);

export default router;
