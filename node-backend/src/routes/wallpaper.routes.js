import { Router } from "express";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { listWallpapers, setMyWallpaper } from "../controllers/wallpaper.controller.js";

const router = Router();
router.use(verifyJWT);

router.get("/", listWallpapers);
router.put("/me", setMyWallpaper);

export default router;
