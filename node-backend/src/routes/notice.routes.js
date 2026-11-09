import { Router } from "express";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { getPendingNotices, acknowledgeNotice } from "../controllers/notice.controller.js";

const router = Router();
router.use(verifyJWT);
router.get("/pending", getPendingNotices);
router.post("/:id/ack", acknowledgeNotice);
export default router;
