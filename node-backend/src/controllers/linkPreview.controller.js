import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { getLinkPreview, normalizeUrl } from "../utils/linkPreview.js";

// GET /api/link-preview?url=https://...
// preview পাওয়া না গেলে data: null (frontend তখন সাধারণ লিংক কার্ড দেখায়)
export const getLinkPreviewHandler = asyncHandler(async (req, res) => {
    const raw = typeof req.query.url === "string" ? req.query.url : "";
    if (!raw || raw.length > 2048 || !normalizeUrl(raw)) {
        throw new ApiError(400, "Invalid url");
    }
    const preview = await getLinkPreview(raw);
    res.set("Cache-Control", "private, max-age=3600");
    res.status(200).json(new ApiResponse(200, preview || null, "ok"));
});
