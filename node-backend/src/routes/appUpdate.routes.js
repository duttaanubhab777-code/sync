import { Router } from "express";
import {
    getAppUpdates,
    notifyAppUpdate
} from "../controllers/appUpdate.controller.js";

const router = Router();
// লগইন ছাড়াই চলে: আপডেট পপআপ লগইন পেজেও দেখানো যায়
router.get("/", getAppUpdates);
// শুধু GitHub Actions ডাকে (গোপন secret লাগে)
router.post("/notify", notifyAppUpdate);
export default router;
