import webpush from "web-push";
import { PushSubscription } from "../models/push-subscription.model.js";
import { User } from "../models/user.model.js";

let configured = false;
let warned = false;
const configure = () => {
    if (configured) return true;
    const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env;
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
        if (!warned) {
            warned = true;
            console.warn(
                "[Push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY সেট করা নেই, তাই কোনো push notification যাবে না"
            );
        }
        return false;
    }
    webpush.setVapidDetails(
        process.env.VAPID_SUBJECT || "mailto:sync93346@gmail.com",
        VAPID_PUBLIC_KEY,
        VAPID_PRIVATE_KEY
    );
    configured = true;
    return true;
};

export const getVapidPublicKey = () => process.env.VAPID_PUBLIC_KEY || "";

export const savePushSubscription = async (userId, subscription) => {
    if (
        !subscription?.endpoint ||
        !subscription?.keys?.p256dh ||
        !subscription?.keys?.auth
    ) {
        const error = new Error("Invalid push subscription");
        error.statusCode = 400;
        throw error;
    }
    return PushSubscription.findOneAndUpdate(
        { endpoint: subscription.endpoint },
        {
            $set: {
                user: userId,
                endpoint: subscription.endpoint,
                keys: subscription.keys,
                expirationTime: subscription.expirationTime ?? null
            }
        },
        { upsert: true, new: true, runValidators: true }
    );
};

export const removePushSubscription = async (userId, endpoint) =>
    PushSubscription.deleteOne({ user: userId, endpoint });

// একটা subscription-এ পাঠানো। মেয়াদ-শেষ (404/410) হলে DB থেকে মুছে দেয়
const deliver = async (item, body, options) => {
    try {
        await webpush.sendNotification(
            {
                endpoint: item.endpoint,
                keys: item.keys,
                expirationTime: item.expirationTime
            },
            body,
            options
        );
        return true;
    } catch (error) {
        if (error.statusCode === 404 || error.statusCode === 410) {
            await PushSubscription.deleteOne({ _id: item._id });
        } else {
            console.error("[Push] Delivery failed:", error.statusCode || "", error.message);
        }
        return false;
    }
};

export const sendPushToUser = async (userId, payload, options = {}) => {
    if (!configure()) return 0;
    const subscriptions = await PushSubscription.find({ user: userId }).lean();
    const body = JSON.stringify(payload);
    const opts = { TTL: 60 * 60, urgency: "high", ...options };
    const results = await Promise.all(
        subscriptions.map(item => deliver(item, body, opts))
    );
    return results.filter(Boolean).length;
};

// সব ইউজারের সব ডিভাইসে (block করা ইউজার ও excludeUserId বাদে) পাঠানো, ৫০টা করে একসাথে
export const sendPushToAll = async (payload, options = {}) => {
    if (!configure()) return { sent: 0, total: 0, skipped: true };

    const { excludeUserId, ...pushOptions } = options;
    const blocked = await User.find({ isBlocked: true }, { _id: 1 }).lean();
    const excludedIds = blocked.map(u => u._id);
    if (excludeUserId) excludedIds.push(excludeUserId);
    const filter = excludedIds.length
        ? { user: { $nin: excludedIds } }
        : {};

    const body = JSON.stringify(payload);
    const opts = { TTL: 60 * 60 * 24, urgency: "high", ...pushOptions };
    const BATCH = 50;

    let sent = 0;
    let total = 0;
    let batch = [];

    const flush = async () => {
        const current = batch;
        batch = [];
        const results = await Promise.all(
            current.map(item => deliver(item, body, opts))
        );
        sent += results.filter(Boolean).length;
    };

    for await (const item of PushSubscription.find(filter).lean().cursor()) {
        total += 1;
        batch.push(item);
        if (batch.length >= BATCH) await flush();
    }
    if (batch.length) await flush();

    return { sent, total, skipped: false };
};
