import { Router } from "express";
import {
    createStory,
    getStoryFeed,
    viewStory,
    getStoryViewers,
    deleteStory,
    reactToStory,
    replyToStory
} from "../controllers/story.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { validate } from "../middlewares/validator.middleware.js";
import {
    createStorySchema,
    reactStorySchema,
    replyStorySchema
} from "../validators/chat.validator.js";

const router = Router();
router.use(verifyJWT);

router.get("/", getStoryFeed);
router.post("/", validate(createStorySchema), createStory);
router.post("/:id/view", viewStory);
router.get("/:id/viewers", getStoryViewers);
router.post("/:id/react", validate(reactStorySchema), reactToStory);
router.post("/:id/reply", validate(replyStorySchema), replyToStory);
router.delete("/:id", deleteStory);

export default router;
