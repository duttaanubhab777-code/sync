import { AppUpdateState } from "../models/app-update-state.model.js";
import { sendPushToAll, isFcmConfigured } from "./push.service.js";

// নতুন Android APK release হলে শুধু Android অ্যাপের ব্যবহারকারীদের "Update Now" বাটনসহ নোটিফিকেশন পাঠায়।
// - ব্রাউজার/PWA-তে যায় না (fcmOnly)
// - একই build একবারই যায় (ডাটাবেসে lastNotifiedBuild রাখা হয়)
// - সার্ভার প্রথমবার চালু হলে আগের release-এর জন্য নোটিফিকেশন পাঠায় না, শুধু বর্তমান build মনে রাখে
// - নোটিশ (notice) সিস্টেমের সাথে কোনো সম্পর্ক নেই

const KEY = "android";
const POLL_MS = Math.max(
    60_000,
    Number(process.env.APP_UPDATE_POLL_MS) || 5 * 60 * 1000
);

let running = false;

const buildPayload = latest => {
    const changes = (latest.changes || []).slice(0, 5);
    const body = changes.length
        ? changes.map(c => `• ${c}`).join("\n")
        : "Improvements and bug fixes.";
    return {
        type: "app_update",
        title: `Sync ${latest.version} is available`,
        body: body.slice(0, 700),
        build: String(latest.build),
        version: latest.version,
        downloadUrl: latest.downloadUrl,
        changes: changes.join("\n").slice(0, 900),
        tag: `app-update-${latest.build}`,
        url: "/updates"
    };
};

export const checkAndNotifyAndroidUpdate = async ({ fresh = false } = {}) => {
    if (running) return { status: "busy" };
    running = true;
    try {
        // controller-কে এখানে ঢোকানো হয়েছে যাতে circular import না হয়
        const { getLatestRelease } = await import(
            "../controllers/appUpdate.controller.js"
        );
        const latest = await getLatestRelease({ fresh });
        if (!latest || !latest.build || !latest.downloadUrl) {
            return { status: "no-release" };
        }

        const existing = await AppUpdateState.findOne({ key: KEY }).lean();
        if (!existing) {
            // প্রথমবার: শুধু মনে রাখা, ব্যবহারকারীদের বিরক্ত না করে
            try {
                await AppUpdateState.create({
                    key: KEY,
                    lastNotifiedBuild: latest.build,
                    lastNotifiedAt: null
                });
            } catch (err) {
                if (err?.code !== 11000) throw err;
            }
            return { status: "initialised", build: latest.build };
        }
        if (latest.build <= existing.lastNotifiedBuild) {
            return { status: "up-to-date", build: latest.build };
        }
        if (!isFcmConfigured()) {
            return { status: "fcm-not-configured", build: latest.build };
        }

        // একসাথে একাধিক সার্ভার/ডাক এলেও শুধু একজন "দাবি" করতে পারে
        const claimed = await AppUpdateState.findOneAndUpdate(
            { key: KEY, lastNotifiedBuild: { $lt: latest.build } },
            {
                $set: {
                    lastNotifiedBuild: latest.build,
                    lastNotifiedAt: new Date()
                }
            },
            { new: true }
        );
        if (!claimed) return { status: "already-claimed", build: latest.build };

        const result = await sendPushToAll(buildPayload(latest), {
            fcmOnly: true
        });
        await AppUpdateState.updateOne(
            { key: KEY },
            { $set: { lastResult: { sent: result.sent, total: result.total } } }
        );
        console.log(
            `[app-update] build ${latest.build} notification sent to ${result.sent}/${result.total} Android devices`
        );
        return { status: "sent", build: latest.build, ...result };
    } catch (err) {
        console.warn("[app-update] notify check failed:", err.message);
        return { status: "error", message: err.message };
    } finally {
        running = false;
    }
};

// Render ঘুমিয়ে থাকলেও জাগার পর ধরতে পারে; GitHub Actions-এর ping হলে সাথে সাথেই যায়
export const startAppUpdateWatcher = () => {
    if (process.env.APP_UPDATE_WATCHER === "off") return;
    setTimeout(() => checkAndNotifyAndroidUpdate(), 20_000).unref();
    setInterval(() => checkAndNotifyAndroidUpdate(), POLL_MS).unref();
};
