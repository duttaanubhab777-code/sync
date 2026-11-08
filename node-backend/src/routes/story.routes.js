import { Router } from "express";
import {
    createStory,
    getStoryFeed,
    viewStory,
    getStoryViewers,
    deleteStory
} from "../controllers/story.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { validate } from "../middlewares/validator.middleware.js";
import { createStorySchema } from "../validators/chat.validator.js";

const router = Router();
router.use(verifyJWT);

router.get("/", getStoryFeed);
router.post("/", validate(createStorySchema), createStory);
router.post("/:id/view", viewStory);
router.get("/:id/viewers", getStoryViewers);
router.delete("/:id", deleteStory);

export default router;
