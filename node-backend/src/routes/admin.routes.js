import { Router } from "express";
import { verifyJWT, verifyAdmin, verifySuperAdmin } from "../middlewares/auth.middleware.js";
import { validate } from "../middlewares/validator.middleware.js";
import { createAdminSchema } from "../validators/auth.validator.js";
import {
    getStats,
    listUsers,
    createAdmin,
    blockUserByAdmin,
    unblockUserByAdmin,
    setUserRole,
    deleteUserByAdmin,
    listMedia,
    removeChatMedia,
    removeStoryMedia,
    listGroups,
    deleteGroupByAdmin,
    listLoginHistory,
    broadcastFromSync
} from "../controllers/admin.controller.js";
import { createNotice, listNotices, deleteNotice } from "../controllers/notice.controller.js";
import {
    adminListWallpapers,
    createWallpaper,
    renameWallpaper,
    moveWallpapers,
    setDefaultWallpaper,
    deleteWallpaper,
    createWallpaperCategory,
    renameWallpaperCategory,
    deleteWallpaperCategory
} from "../controllers/wallpaper.controller.js";

const router = Router();

// platform Admin বা Super Admin ছাড়া কেউ ঢুকতে পারবে না (group admin-ও না)
router.use(verifyJWT, verifyAdmin);

router.get("/stats", getStats);

router.get("/users", listUsers);
// শেষ ২০টা লগইন (IP ও সময় সহ): Admin ও Super Admin দুজনেই দেখতে পারবে
router.get("/login-history", listLoginHistory);
router.post("/users/:id/block", blockUserByAdmin);
router.delete("/users/:id/block", unblockUserByAdmin);
router.delete("/users/:id", deleteUserByAdmin);
// নতুন admin বানানো এবং admin বানানো/সরানো শুধু Super Admin পারবে
router.post("/admins", verifySuperAdmin, validate(createAdminSchema), createAdmin);
router.patch("/users/:id/role", verifySuperAdmin, setUserRole);

router.get("/media", listMedia);
router.delete("/media/chat/:id", removeChatMedia);
router.delete("/media/story/:id", removeStoryMedia);

router.get("/groups", listGroups);
router.delete("/groups/:id", deleteGroupByAdmin);

router.get("/notices", listNotices);
router.post("/notices", createNotice);
router.delete("/notices/:id", deleteNotice);
router.post("/broadcast", broadcastFromSync);

// চ্যাট wallpaper: Admin ও Super Admin দুজনেই যোগ/default/মোছা করতে পারবে
// "/wallpapers/default" অবশ্যই "/wallpapers/:id"-এর আগে থাকতে হবে
router.get("/wallpapers", adminListWallpapers);
router.post("/wallpapers", createWallpaper);
router.put("/wallpapers/default", setDefaultWallpaper);
router.patch("/wallpapers/move", moveWallpapers);
router.patch("/wallpapers/:id", renameWallpaper);
router.delete("/wallpapers/:id", deleteWallpaper);

// wallpaper ক্যাটাগরি: যোগ / নাম বদল / মোছা
router.post("/wallpaper-categories", createWallpaperCategory);
router.patch("/wallpaper-categories/:id", renameWallpaperCategory);
router.delete("/wallpaper-categories/:id", deleteWallpaperCategory);

export default router;
