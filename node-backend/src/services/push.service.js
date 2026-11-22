import crypto from "node:crypto";
import axios from "axios";
import webpush from "web-push";
import { PushSubscription } from "../models/push-subscription.model.js";
import { User } from "../models/user.model.js";

const DEFAULT_FIREBASE_PROJECT_ID = "sync-34886";

let webPushConfigured = false;
let webPushWarned = false;
let fcmWarned = false;

// ক্যাশ করা Google OAuth2 access token (FCM HTTP v1 এর জন্য)
let cachedFcmToken = {
    accessToken: "",
    expiresAtMs: 0,
    cacheKey: ""
};

const toBase64Url = input =>
    Buffer.from(input)
        .toString("base64")
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");

export const normalizePrivateKey = raw => {
    if (!raw || typeof raw !== "string") return "";
    let key = raw.trim();
    if (
        (key.startsWith('"') && key.endsWith('"')) ||
        (key.startsWith("'") && key.endsWith("'"))
    ) {
        key = key.slice(1, -1);
    }
    return key.replace(/\\n/g, "\n").trim();
};

const tryParseJson = raw => {
    if (!raw || typeof raw !== "string") return null;
    const trimmed = raw.trim();
    try {
        if (trimmed.startsWith("{")) return JSON.parse(trimmed);
        // কেউ base64 করে পুরো JSON দিলে সেটাও পড়া যাবে
        const decoded = Buffer.from(trimmed, "base64").toString("utf8").trim();
        if (decoded.startsWith("{")) return JSON.parse(decoded);
    } catch {
        return null;
    }
    return null;
};

// Render বা .env থেকে Firebase Service Account এর তথ্য বের করা।
// ইউজার চাইলে পুরো ডাউনলোড করা JSON ফাইলটা `FIREBASE_SERVICE_ACCOUNT_JSON`-এ দিতে পারে,
// অথবা আলাদাভাবে `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` দিতে পারে।
export const resolveFcmCredentials = (env = process.env) => {
    const rawJson =
        env.FIREBASE_SERVICE_ACCOUNT_JSON ||
        env.FIREBASE_SERVICE_ACCOUNT ||
        (env.FIREBASE_PRIVATE_KEY?.trim().startsWith("{")
            ? env.FIREBASE_PRIVATE_KEY
            : "");

    const parsed = tryParseJson(rawJson);
    const projectId = String(
        parsed?.project_id ||
            env.FIREBASE_PROJECT_ID ||
            DEFAULT_FIREBASE_PROJECT_ID
    ).trim();
    const clientEmail = String(
        parsed?.client_email || env.FIREBASE_CLIENT_EMAIL || ""
    ).trim();
    const privateKey = normalizePrivateKey(
        parsed?.private_key || env.FIREBASE_PRIVATE_KEY || ""
    );

    if (
        !projectId ||
        !clientEmail ||
        !privateKey.includes("BEGIN PRIVATE KEY")
    ) {
        return null;
    }

    return { projectId, clientEmail, privateKey };
};

export const isFcmConfigured = (env = process.env) =>
    Boolean(resolveFcmCredentials(env));

export const createServiceAccountJwt = ({
    clientEmail,
    privateKey,
    nowSec = Math.floor(Date.now() / 1000)
}) => {
    const header = toBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claims = toBase64Url(
        JSON.stringify({
            iss: clientEmail,
            sub: clientEmail,
            scope: "https://www.googleapis.com/auth/firebase.messaging",
            aud: "https://oauth2.googleapis.com/token",
            iat: nowSec,
            exp: nowSec + 3600
        })
    );
    const unsigned = `${header}.${claims}`;
    const signer = crypto.createSign("RSA-SHA256");
    signer.update(unsigned);
    signer.end();
    const signature = signer
        .sign(privateKey, "base64")
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
    return `${unsigned}.${signature}`;
};

const getFcmAccessToken = async creds => {
    const cacheKey = `${creds.projectId}:${creds.clientEmail}`;
    if (
        cachedFcmToken.accessToken &&
        cachedFcmToken.cacheKey === cacheKey &&
        Date.now() < cachedFcmToken.expiresAtMs - 60_000
    ) {
        return cachedFcmToken.accessToken;
    }

    const assertion = createServiceAccountJwt(creds);
    const body = new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion
    }).toString();

    const res = await axios.post("https://oauth2.googleapis.com/token", body, {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 10000
    });

    const accessToken = res.data?.access_token;
    const expiresInSec = Number(res.data?.expires_in) || 3600;
    if (!accessToken) {
        throw new Error("Failed to obtain Firebase OAuth2 access token");
    }

    cachedFcmToken = {
        accessToken,
        expiresAtMs: Date.now() + expiresInSec * 1000,
        cacheKey
    };
    return accessToken;
};

// FCM HTTP v1 এর `data` ম্যাপে সব মান অবশ্যই string হতে হয়
export const buildFcmDataMap = (payload = {}) => {
    const nested =
        payload.data && typeof payload.data === "object" ? payload.data : {};
    const raw = {
        type: payload.type || "message",
        title: payload.title || "Sync",
        body: payload.body || "",
        messageText: payload.messageText || payload.body || "",
        senderName: payload.senderName || payload.title || "Sync",
        senderAvatar: payload.senderAvatar || payload.icon || "",
        groupIcon: payload.groupIcon || "",
        image: payload.image || "",
        tag: payload.tag || "",
        endsAt: payload.endsAt || "",
        requireInteraction: payload.requireInteraction ? "true" : "false",
        conversationId: nested.conversationId || payload.conversationId || "",
        messageId: nested.messageId || payload.messageId || "",
        noticeId: nested.noticeId || payload.noticeId || "",
        // push পৌঁছানোর প্রমাণ ("delivered" ডাবল টিক): Android native service এটা দিয়ে সার্ভারকে জানায়
        ackToken: nested.ackToken || "",
        ackUserId: nested.ackUserId || "",
        ackUrl: nested.ackUrl || "",
        storyId: nested.storyId || payload.storyId || "",
        // Android অ্যাপ আপডেট নোটিফিকেশন (type = "app_update") এর তথ্য
        build: payload.build || nested.build || "",
        version: payload.version || nested.version || "",
        downloadUrl: payload.downloadUrl || nested.downloadUrl || "",
        changes: payload.changes || nested.changes || "",
        url:
            nested.url ||
            payload.url ||
            (nested.conversationId ? `/chats/${nested.conversationId}` : "/"),
        // অ্যাপ আইকনের badge সংখ্যা (০ হলেও পাঠানো হয়, যাতে badge মুছে যায়)
        badgeCount:
            payload.badgeCount === undefined || payload.badgeCount === null
                ? ""
                : String(Math.max(0, Math.floor(Number(payload.badgeCount) || 0))),
        chatUnread:
            payload.chatUnread === undefined || payload.chatUnread === null
                ? ""
                : String(Math.max(0, Math.floor(Number(payload.chatUnread) || 0))),
        timestamp: String(Date.now())
    };

    const out = {};
    for (const [k, v] of Object.entries(raw)) {
        if (v !== undefined && v !== null && String(v) !== "") {
            out[k] = String(v);
        }
    }
    return out;
};

const configureWebPush = () => {
    if (webPushConfigured) return true;
    const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env;
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
        if (!webPushWarned) {
            webPushWarned = true;
            console.warn(
                "[Push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY সেট করা নেই, তাই ব্রাউজারে Web Push যাবে না"
            );
        }
        return false;
    }
    webpush.setVapidDetails(
        process.env.VAPID_SUBJECT || "mailto:sync93346@gmail.com",
        VAPID_PUBLIC_KEY,
        VAPID_PRIVATE_KEY
    );
    webPushConfigured = true;
    return true;
};

export const getVapidPublicKey = () => process.env.VAPID_PUBLIC_KEY || "";

export const savePushSubscription = async (userId, subscription) => {
    // ১. Android অ্যাপের Native FCM Token রেজিস্ট্রেশন
    const rawFcmToken =
        typeof subscription?.fcmToken === "string"
            ? subscription.fcmToken.trim()
            : subscription?.provider === "fcm" &&
                typeof subscription?.token === "string"
              ? subscription.token.trim()
              : typeof subscription?.token === "string" &&
                  !subscription?.endpoint
                ? subscription.token.trim()
                : "";

    if (rawFcmToken) {
        const endpoint = `fcm:${rawFcmToken}`;
        return PushSubscription.findOneAndUpdate(
            { endpoint },
            {
                $set: {
                    user: userId,
                    provider: "fcm",
                    platform: subscription?.platform || "android",
                    endpoint,
                    fcmToken: rawFcmToken,
                    keys: { p256dh: "", auth: "" },
                    expirationTime: null
                }
            },
            { upsert: true, new: true, runValidators: true }
        );
    }

    // ২. ব্রাউজার / PWA এর Web Push রেজিস্ট্রেশন
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
                provider: "webpush",
                platform: subscription.platform || "web",
                endpoint: subscription.endpoint,
                fcmToken: null,
                keys: subscription.keys,
                expirationTime: subscription.expirationTime ?? null
            }
        },
        { upsert: true, new: true, runValidators: true }
    );
};

export const removePushSubscription = async (userId, endpointOrToken) => {
    const clean = String(endpointOrToken || "").trim();
    if (!clean) return { deletedCount: 0 };
    const candidates = clean.startsWith("fcm:")
        ? [clean, clean.slice(4)]
        : [clean, `fcm:${clean}`];
    return PushSubscription.deleteMany({
        user: userId,
        $or: [
            { endpoint: { $in: candidates } },
            { fcmToken: { $in: candidates } }
        ]
    });
};

const isFcmItem = item =>
    item?.provider === "fcm" ||
    Boolean(item?.fcmToken) ||
    String(item?.endpoint || "").startsWith("fcm:");

const getItemFcmToken = item => {
    if (item?.fcmToken) return String(item.fcmToken).trim();
    const ep = String(item?.endpoint || "");
    return ep.startsWith("fcm:") ? ep.slice(4).trim() : "";
};

const deliverFcm = async (item, payload) => {
    const creds = resolveFcmCredentials();
    if (!creds) {
        if (!fcmWarned) {
            fcmWarned = true;
            console.warn(
                "[Push] FIREBASE_SERVICE_ACCOUNT_JSON বা FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY সেট করা নেই, তাই Android অ্যাপে FCM নোটিফিকেশন যাবে না"
            );
        }
        return false;
    }

    const token = getItemFcmToken(item);
    if (!token) return false;

    try {
        const accessToken = await getFcmAccessToken(creds);
        const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(
            creds.projectId
        )}/messages:send`;

        await axios.post(
            url,
            {
                message: {
                    token,
                    data: buildFcmDataMap(payload),
                    android: {
                        priority: "HIGH",
                        ttl: "86400s"
                    }
                }
            },
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json"
                },
                timeout: 10000
            }
        );
        return true;
    } catch (error) {
        const status = error.response?.status;
        const errBody = error.response?.data?.error || {};
        const details = Array.isArray(errBody.details) ? errBody.details : [];
        const fcmErrorCode = details.find(d => d?.errorCode)?.errorCode || "";
        const msg = String(errBody.message || error.message || "");

        if (
            status === 404 ||
            status === 410 ||
            fcmErrorCode === "UNREGISTERED" ||
            msg.includes("not a valid FCM registration token") ||
            msg.includes("Requested entity was not found")
        ) {
            await PushSubscription.deleteOne({ _id: item._id }).catch(() => {});
        } else {
            console.error(
                "[Push FCM] Delivery failed:",
                status || "",
                fcmErrorCode || msg
            );
        }
        return false;
    }
};

// একটা subscription-এ পাঠানো (Web Push বা Android FCM)। মেয়াদ-শেষ (404/410) হলে DB থেকে মুছে দেয়
const deliver = async (item, payload, body, options) => {
    if (isFcmItem(item)) {
        return deliverFcm(item, payload);
    }
    if (!configureWebPush()) return false;
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
            console.error(
                "[Push] Delivery failed:",
                error.statusCode || "",
                error.message
            );
        }
        return false;
    }
};

export const sendPushToUser = async (userId, payload, options = {}) => {
    const canWeb = configureWebPush();
    const canFcm = isFcmConfigured();
    if (!canWeb && !canFcm) return 0;

    const subscriptions = await PushSubscription.find({ user: userId }).lean();
    if (subscriptions.length === 0) return 0;

    const body = JSON.stringify(payload);
    const opts = { TTL: 60 * 60, urgency: "high", ...options };
    const results = await Promise.all(
        subscriptions.map(item => deliver(item, payload, body, opts))
    );
    return results.filter(Boolean).length;
};

// সব ইউজারের সব ডিভাইসে (block করা ইউজার ও excludeUserId বাদে) পাঠানো, ৫০টা করে একসাথে
export const sendPushToAll = async (payload, options = {}) => {
    const canWeb = options.fcmOnly ? false : configureWebPush();
    const canFcm = isFcmConfigured();
    if (!canWeb && !canFcm) return { sent: 0, total: 0, skipped: true };

    // fcmOnly = true হলে শুধু Android অ্যাপের (FCM) ডিভাইসে যায়, ব্রাউজার/PWA-তে যায় না
    const { excludeUserId, fcmOnly, ...pushOptions } = options;
    const blocked = await User.find({ isBlocked: true }, { _id: 1 }).lean();
    const excludedIds = blocked.map(u => u._id);
    if (excludeUserId) excludedIds.push(excludeUserId);
    const filter = excludedIds.length ? { user: { $nin: excludedIds } } : {};
    if (fcmOnly) filter.provider = "fcm";

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
            current.map(item => deliver(item, payload, body, opts))
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
