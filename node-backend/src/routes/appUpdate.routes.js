import { Router } from "express";
import { getAppUpdates } from "../controllers/appUpdate.controller.js";

const router = Router();
// লগইন ছাড়াই চলে: আপডেট পপআপ লগইন পেজেও দেখানো যায়
router.get("/updates", getAppUpdates);
export default router;
