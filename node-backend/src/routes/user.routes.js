import { Router } from "express";
import {
    searchUsers,
    matchContacts,
    getBlockedUsers,
    getUserProfile,
    getUserByUsername,
    updateMyProfile,
    blockUser,
    unblockUser
} from "../controllers/user.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { validate } from "../middlewares/validator.middleware.js";
import { updateProfileSchema } from "../validators/chat.validator.js";

const router = Router();
router.use(verifyJWT);

router.get("/", searchUsers);
router.post("/match-contacts", matchContacts);
// "/me" আর "/blocked" অবশ্যই "/:id"-এর আগে থাকতে হবে
router.patch("/me", validate(updateProfileSchema), updateMyProfile);
router.get("/blocked", getBlockedUsers);
// "/by-username/:username" ও "/:id"-এর আগে থাকতে হবে না (পথ আলাদা), তবু পাশে রাখা হলো
router.get("/by-username/:username", getUserByUsername);
router.get("/:id", getUserProfile);
router.post("/:id/block", blockUser);
router.delete("/:id/block", unblockUser);

export default router;
