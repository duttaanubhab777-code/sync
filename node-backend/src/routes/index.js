import { Router } from "express";
import authRoutes from "./auth.routes.js";
import userRoutes from "./user.routes.js";
import conversationRoutes from "./conversation.routes.js";
import storyRoutes from "./story.routes.js";
import { syncMessages } from "../controllers/message.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = Router();

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/conversations", conversationRoutes);
router.use("/stories", storyRoutes);
router.get("/sync", verifyJWT, syncMessages);

export default router;
