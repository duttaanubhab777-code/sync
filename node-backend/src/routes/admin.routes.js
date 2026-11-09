import { Router } from "express";
import { verifyJWT, verifyAdmin, verifySuperAdmin } from "../middlewares/auth.middleware.js";
import {
    getStats,
    listUsers,
    blockUserByAdmin,
    unblockUserByAdmin,
    setUserRole,
    listMedia,
    removeChatMedia,
    removeStoryMedia,
    listGroups
} from "../controllers/admin.controller.js";
import { createNotice, listNotices, deleteNotice } from "../controllers/notice.controller.js";

const router = Router();

// platform Admin বা Super Admin ছাড়া কেউ ঢুকতে পারবে না (group admin-ও না)
router.use(verifyJWT, verifyAdmin);

router.get("/stats", getStats);

router.get("/users", listUsers);
router.post("/users/:id/block", blockUserByAdmin);
router.delete("/users/:id/block", unblockUserByAdmin);
// admin বানানো/সরানো শুধু Super Admin পারবে
router.patch("/users/:id/role", verifySuperAdmin, setUserRole);

router.get("/media", listMedia);
router.delete("/media/chat/:id", removeChatMedia);
router.delete("/media/story/:id", removeStoryMedia);

router.get("/groups", listGroups);

router.get("/notices", listNotices);
router.post("/notices", createNotice);
router.delete("/notices/:id", deleteNotice);

export default router;
