import { Router } from "express";
import { announceCommitMessages } from "../controllers/commitAnnounce.controller.js";

const router = Router();
// শুধু GitHub Actions ডাকে: প্রতিটা commit মেসেজ Sync DM + অফিশিয়াল গ্রুপে অ্যানাউন্সমেন্ট হয়
router.post("/announce", announceCommitMessages);
export default router;
