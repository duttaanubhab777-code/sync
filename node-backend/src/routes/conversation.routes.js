import { Router } from "express";
import {
    listConversations,
    getOrCreateDirect,
    createGroup,
    getConversation,
    updateGroup,
    updateMembers,
    leaveGroup,
    markConversationRead
} from "../controllers/conversation.controller.js";
import { getMessages } from "../controllers/message.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { validate } from "../middlewares/validator.middleware.js";
import {
    directConversationSchema,
    createGroupSchema,
    updateGroupSchema,
    updateMembersSchema
} from "../validators/chat.validator.js";

const router = Router();
router.use(verifyJWT);

router.get("/", listConversations);
router.post("/", validate(directConversationSchema), getOrCreateDirect);
router.post("/group", validate(createGroupSchema), createGroup);

router.get("/:id", getConversation);
router.patch("/:id", validate(updateGroupSchema), updateGroup);
router.patch("/:id/members", validate(updateMembersSchema), updateMembers);
router.post("/:id/leave", leaveGroup);
router.post("/:id/read", markConversationRead);
router.get("/:id/messages", getMessages);

export default router;
