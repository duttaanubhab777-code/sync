import crypto from "node:crypto";

// Push notification পৌঁছালেই "delivered" (ডাবল টিক) করার জন্য ছোট স্বাক্ষরিত টোকেন।
// ফোন অ্যাপ বন্ধ থাকলেও push পায়, তখন লগইন টোকেন ছাড়াই এই টোকেন দিয়ে সার্ভারকে জানাতে পারে।
// টোকেন = HMAC(secret, "ack:<recipientId>:<messageId>"), তাই শুধু ওই একটা মেসেজের জন্যই বৈধ।
const secret = () => {
    const s =
        process.env.DELIVERY_ACK_SECRET ||
        process.env.JWT_SECRET ||
        process.env.ACCESS_TOKEN_SECRET;
    if (!s) throw new Error("JWT_SECRET (or DELIVERY_ACK_SECRET) is not set");
    return s;
};

const sign = (userId, messageId) =>
    crypto
        .createHmac("sha256", secret())
        .update(`ack:${userId}:${messageId}`)
        .digest("hex")
        .slice(0, 32);

export const makeAckToken = (userId, messageId) =>
    sign(String(userId), String(messageId));

export const isValidAckToken = (userId, messageId, token) => {
    if (typeof token !== "string" || token.length !== 32) return false;
    const expected = Buffer.from(sign(String(userId), String(messageId)));
    const given = Buffer.from(token);
    return (
        expected.length === given.length &&
        crypto.timingSafeEqual(expected, given)
    );
};

// FCM ডেটায় ack-এর ঠিকানা; Render নিজে RENDER_EXTERNAL_URL সেট করে। না থাকলে ack পাঠানো হয় না।
export const ackUrl = () => {
    const base = String(
        process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || ""
    )
        .trim()
        .replace(/\/+$/, "");
    return /^https:\/\//.test(base) ? `${base}/api/v1/messages/delivery-ack` : "";
};
