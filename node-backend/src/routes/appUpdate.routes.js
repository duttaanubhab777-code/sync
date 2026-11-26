import { Router } from "express";
import {
    getAppUpdates,
    notifyAppUpdate
} from "../controllers/appUpdate.controller.js";
import { announceCommitMessages } from "../controllers/commitAnnounce.controller.js";

const router = Router();
// লগইন ছাড়াই চলে: আপডেট পপআপ লগইন পেজেও দেখানো যায়
router.get("/updates", getAppUpdates);
// শুধু GitHub Actions ডাকে (গোপন secret লাগে)
router.post("/updates/notify", notifyAppUpdate);
// শুধু GitHub Actions ডাকে: প্রতিটা commit মেসেজ Sync DM + অফিশিয়াল গ্রুপে অ্যানাউন্সমেন্ট হয়
router.post("/commits/announce", announceCommitMessages);
export default router;
