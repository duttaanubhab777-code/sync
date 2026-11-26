import { Router } from "express";
import {
    syncMessages,
    deliveryAck,
    getMessageInfo,
    forwardMessage
} from "../controllers/message.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = Router();

// অফলাইনে মিস হওয়া মেসেজ/আপডেট ফেরত আনা (Socket reconnect-এর পর)
router.get("/sync", verifyJWT, syncMessages);
// push notification থেকে আসা signed delivery acknowledgement (JWT লাগে না, নিজস্ব signed token আছে)
router.post("/delivery-ack", deliveryAck);
router.get("/:id/info", verifyJWT, getMessageInfo);
router.post("/:id/forward", verifyJWT, forwardMessage);

export default router;
