import webpush from "web-push";
import { PushSubscription } from "../models/push-subscription.model.js";

let configured = false;
const configure = () => {
    if (configured) return true;
    const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env;
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;
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
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
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

export const sendPushToUser = async (userId, payload) => {
    if (!configure()) return;
    const subscriptions = await PushSubscription.find({ user: userId }).lean();
    await Promise.all(subscriptions.map(async item => {
        try {
            await webpush.sendNotification({
                endpoint: item.endpoint,
                keys: item.keys,
                expirationTime: item.expirationTime
            }, JSON.stringify(payload), { TTL: 60 * 60, urgency: "high" });
        } catch (error) {
            if (error.statusCode === 404 || error.statusCode === 410) {
                await PushSubscription.deleteOne({ _id: item._id });
            } else {
                console.error("[Push] Delivery failed:", error.message);
            }
        }
    }));
};
