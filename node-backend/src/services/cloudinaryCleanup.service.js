// Cloudinary থেকে ফাইল সত্যিই মুছে ফেলার সার্ভিস।
// DB থেকে মেসেজ/স্টোরি/নোটিস/ছবির লিংক মুছলে সেই ফাইল Cloudinary-তেও মুছে দেওয়া হয়,
// নইলে Cloudinary-র স্টোরেজ অকারণে ভরে যায়।
//
// দরকারি env (Render-এ): CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
// key/secret না থাকলে কিছু ভাঙে না, শুধু একবার warning দিয়ে মোছা বাদ দেওয়া হয়।
//
// নিরাপত্তা: public_id ক্লায়েন্টের পাঠানো publicId থেকে নয়, সবসময় যাচাই-করা URL থেকে বের করা হয়।
// আর মোছার আগে দেখা হয় অন্য কোনো ডকুমেন্ট (অন্য মেসেজ, avatar, ...) একই ফাইল এখনো ব্যবহার করছে কিনা।

import crypto from "node:crypto";
import { isValidCloudinaryUrl } from "../utils/cloudinary.js";

const CONCURRENCY = 4;
const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 15_000;

let warnedMissingCreds = false;

const getCredentials = () => {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
    const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
    const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();
    if (!cloudName || !apiKey || !apiSecret) return null;
    return { cloudName, apiKey, apiSecret };
};

// https://res.cloudinary.com/<cloud>/<image|video|raw>/upload/[transformations/][v123/]<public_id>[.ext]
// থেকে { resourceType, publicId } বের করা। Cloudinary URL না হলে null।
export const parseCloudinaryUrl = url => {
    if (!isValidCloudinaryUrl(url)) return null;
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    // [cloudName, resourceType, "upload", ...rest]
    if (parts.length < 4 || parts[2] !== "upload") return null;
    const resourceType = parts[1];
    let rest = parts.slice(3);

    const versionIdx = rest.findIndex(seg => /^v\d+$/.test(seg));
    if (versionIdx !== -1) {
        // version-এর আগের সবকিছুই transformation
        rest = rest.slice(versionIdx + 1);
    } else {
        // version না থাকলে শুরুর transformation segment (যেমন w_200,h_200 / f_auto) বাদ দেওয়া
        while (rest.length > 1 && /^[a-z]{1,3}_[^/]*$/.test(rest[0])) rest.shift();
    }
    if (rest.length === 0) return null;

    let publicId;
    try {
        publicId = rest.map(decodeURIComponent).join("/");
    } catch {
        return null;
    }
    // image/video-র public_id-তে extension থাকে না; raw ফাইলে extension public_id-এরই অংশ
    if (resourceType !== "raw") publicId = publicId.replace(/\.[A-Za-z0-9]{1,5}$/, "");
    if (!publicId) return null;
    return { resourceType, publicId };
};

const signParams = (params, apiSecret) => {
    const toSign = Object.keys(params)
        .sort()
        .map(k => `${k}=${params[k]}`)
        .join("&");
    return crypto.createHash("sha1").update(toSign + apiSecret).digest("hex");
};

const destroyOne = async ({ resourceType, publicId }, creds) => {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            const timestamp = Math.floor(Date.now() / 1000);
            const signed = { invalidate: "true", public_id: publicId, timestamp };
            const body = new URLSearchParams({
                ...Object.fromEntries(
                    Object.entries(signed).map(([k, v]) => [k, String(v)])
                ),
                api_key: creds.apiKey,
                signature: signParams(signed, creds.apiSecret)
            });
            const res = await fetch(
                `https://api.cloudinary.com/v1_1/${encodeURIComponent(
                    creds.cloudName
                )}/${resourceType}/destroy`,
                {
                    method: "POST",
                    body,
                    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
                }
            );
            const data = await res.json().catch(() => ({}));
            if (res.ok && (data.result === "ok" || data.result === "not found")) {
                return true; // "not found" = আগেই মোছা, তাও সফল
            }
            // 4xx (রেট লিমিট ছাড়া) আবার চেষ্টা করে লাভ নেই
            if (res.status >= 400 && res.status < 500 && res.status !== 429) {
                console.error(
                    `[Cloudinary cleanup] ${publicId}: ${res.status} ${data?.error?.message || ""}`
                );
                return false;
            }
        } catch (err) {
            if (attempt === MAX_ATTEMPTS) {
                console.error(`[Cloudinary cleanup] ${publicId}: ${err.message}`);
            }
        }
        await new Promise(r => setTimeout(r, 500 * attempt));
    }
    return false;
};

// DB-তে অন্য কোথাও এই URL এখনো ব্যবহার হচ্ছে কিনা (ডকুমেন্ট মোছার পরে কল করতে হবে)
const isStillReferenced = async url => {
    // মডেল এখানে import করা হয় যাতে এই ফাইল মডেলগুলোর সাথে circular না হয়
    const [{ Message }, { Story }, { User }, { Conversation }, { Notice }, { Wallpaper }] =
        await Promise.all([
            import("../models/message.model.js"),
            import("../models/story.model.js"),
            import("../models/user.model.js"),
            import("../models/conversation.model.js"),
            import("../models/notice.model.js"),
            import("../models/wallpaper.model.js")
        ]);
    const checks = await Promise.all([
        Message.exists({ "media.url": url }),
        Story.exists({ "media.url": url }),
        User.exists({ avatar: url }),
        Conversation.exists({ groupIcon: url }),
        Notice.exists({ "image.url": url }),
        Wallpaper.exists({ "image.url": url })
    ]);
    return checks.some(Boolean);
};

// url-এর তালিকা Cloudinary থেকে মোছা। কখনো throw করে না। মোছা ফাইলের সংখ্যা ফেরত দেয়।
export const deleteCloudinaryUrls = async (urls, { checkReferences = true } = {}) => {
    try {
        const unique = [
            ...new Set(
                (Array.isArray(urls) ? urls : [urls]).filter(
                    u => typeof u === "string" && u
                )
            )
        ];
        if (unique.length === 0) return 0;

        const creds = getCredentials();
        if (!creds) {
            if (!warnedMissingCreds) {
                warnedMissingCreds = true;
                console.warn(
                    "[Cloudinary cleanup] CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET সেট করা নেই, তাই Cloudinary থেকে ফাইল মোছা হচ্ছে না"
                );
            }
            return 0;
        }

        const targets = [];
        for (const url of unique) {
            const parsed = parseCloudinaryUrl(url);
            if (!parsed) continue;
            if (checkReferences && (await isStillReferenced(url))) continue;
            targets.push(parsed);
        }

        let deleted = 0;
        let cursor = 0;
        const worker = async () => {
            while (cursor < targets.length) {
                const item = targets[cursor++];
                if (await destroyOne(item, creds)) deleted++;
            }
        };
        await Promise.all(
            Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker)
        );
        return deleted;
    } catch (err) {
        console.error("[Cloudinary cleanup] failed:", err.message);
        return 0;
    }
};

// রেসপন্স আটকে না রেখে ব্যাকগ্রাউন্ডে মোছা
export const cleanupInBackground = (urls, options) => {
    deleteCloudinaryUrls(urls, options).catch(() => {});
};

// ---------- মেয়াদ-শেষ story/notice (TTL-এর আগেই মিডিয়া মুছে তারপর ডকুমেন্ট মোছা) ----------

const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const SWEEP_BATCH = 100;
// MongoDB TTL index আমাদের আগে ডকুমেন্ট মুছে না ফেলে, সেজন্য TTL ১ ঘণ্টা পিছিয়ে দেওয়া হয়
export const TTL_GRACE_SECONDS = 60 * 60;

let sweeping = false;

export const sweepExpiredMedia = async () => {
    if (sweeping) return;
    sweeping = true;
    try {
        const [{ Story }, { Notice, NoticeAck }] = await Promise.all([
            import("../models/story.model.js"),
            import("../models/notice.model.js")
        ]);
        const now = new Date();

        const stories = await Story.find({ expiresAt: { $lte: now } })
            .select("media.url")
            .limit(SWEEP_BATCH)
            .lean();
        if (stories.length) {
            await Story.deleteMany({ _id: { $in: stories.map(s => s._id) } });
            await deleteCloudinaryUrls(stories.map(s => s.media?.url));
        }

        const notices = await Notice.find({ expiresAt: { $lte: now } })
            .select("image.url")
            .limit(SWEEP_BATCH)
            .lean();
        if (notices.length) {
            const ids = notices.map(n => n._id);
            await Notice.deleteMany({ _id: { $in: ids } });
            await NoticeAck.deleteMany({ notice: { $in: ids } });
            await deleteCloudinaryUrls(notices.map(n => n.image?.url));
        }
    } catch (err) {
        console.error("[Cloudinary sweep] failed:", err.message);
    } finally {
        sweeping = false;
    }
};

// পুরনো DB-তে TTL index-এর মেয়াদ ০ থেকে ১ ঘণ্টায় বদলানো (না হলে MongoDB চুপচাপ ডকুমেন্ট মুছে ফেলত
// আর Cloudinary-র ফাইল পড়ে থাকত)। নতুন DB-তে মডেলই সরাসরি ১ ঘণ্টা দিয়ে index বানায়।
export const migrateTtlIndexes = async () => {
    try {
        const { default: mongoose } = await import("mongoose");
        const db = mongoose.connection.db;
        for (const collection of ["stories", "notices"]) {
            try {
                await db.command({
                    collMod: collection,
                    index: { name: "expiresAt_1", expireAfterSeconds: TTL_GRACE_SECONDS }
                });
            } catch (err) {
                // collection/TTL index না থাকলে বা আগেই ঠিক থাকলে সমস্যা নেই
                if (!/ns does not exist|index not found|no expireAfterSeconds|same|Namespace/i.test(err.message)) {
                    console.warn(`[Cloudinary cleanup] TTL migrate (${collection}):`, err.message);
                }
            }
        }
    } catch (err) {
        console.warn("[Cloudinary cleanup] TTL migrate skipped:", err.message);
    }
};

export const startMediaSweeper = () => {
    sweepExpiredMedia();
    const timer = setInterval(sweepExpiredMedia, SWEEP_INTERVAL_MS);
    timer.unref?.();
    return timer;
};
