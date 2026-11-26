import { timingSafeEqual } from "node:crypto";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { announceCommits } from "../services/commitAnnounce.service.js";

const safeEqual = (a, b) => {
    const x = Buffer.from(String(a));
    const y = Buffer.from(String(b));
    return x.length === y.length && timingSafeEqual(x, y);
};

// POST /api/v1/commits/announce   (শুধু GitHub Actions — header: x-update-secret)
// body: { branch?, commits: [{ id, message }] }
// প্রতিটা commit মেসেজ অফিশিয়াল Sync DM + Sync গ্রুপে অ্যানাউন্সমেন্ট হয়ে যায়।
export const announceCommitMessages = asyncHandler(async (req, res) => {
    if (String(process.env.COMMIT_ANNOUNCE || "").toLowerCase() === "off") {
        return res
            .status(200)
            .json(new ApiResponse(200, { status: "disabled" }, "success"));
    }

    const secret = String(
        process.env.COMMIT_ANNOUNCE_SECRET ||
            process.env.APP_UPDATE_NOTIFY_SECRET ||
            ""
    ).trim();
    const given = String(req.get("x-update-secret") || "").trim();
    if (!secret || !safeEqual(given, secret)) {
        throw new ApiError(401, "Invalid announce secret");
    }

    const commits = Array.isArray(req.body?.commits)
        ? req.body.commits.slice(0, 50)
        : [];
    if (commits.length === 0) {
        throw new ApiError(400, "No commits provided");
    }

    // হাজার ইউজারে DM পাঠাতে সময় লাগে, তাই সাথে সাথে 202 দিয়ে কাজটা ব্যাকগ্রাউন্ডে চলে
    // (প্রতিটা commit idempotent, তাই workflow আবার ডাকলেও দুবার যাবে না)
    const io = req.app.get("io");
    announceCommits(commits, io)
        .then(r =>
            console.log(
                `[Commit Announce] announced=${r.announced} skipped=${r.skipped} summarized=${r.summarized}`
            )
        )
        .catch(err =>
            console.error("[Commit Announce]", err?.message || err)
        );

    res.status(202).json(
        new ApiResponse(202, { status: "accepted", commits: commits.length }, "success")
    );
});
