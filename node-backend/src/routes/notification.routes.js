import { Router } from "express";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import {
    getNotifications, markNotificationRead, markAllNotificationsRead,
    getPushConfig, subscribePush, unsubscribePush
} from "../controllers/notification.controller.js";

const router = Router();
router.use(verifyJWT);
router.get("/", getNotifications);
router.patch("/read-all", markAllNotificationsRead);
router.patch("/:id/read", markNotificationRead);
router.get("/push-config", getPushConfig);
router.post("/push-subscriptions", subscribePush);
router.delete("/push-subscriptions", unsubscribePush);
export default router;
