// Contact form পাঠানোর লজিক (Email Sender API)।
// - মেসেজ আগে ডিভাইসের outbox-এ রাখা হয়, তাই সার্ভার ঘুমিয়ে থাকলে/নেট না থাকলেও হারায় না
// - ব্যর্থ হলে ধাপে ধাপে retry; ট্যাব বন্ধ হলে পরের বার পেজ খুললেই আবার পাঠায়
// - একই submissionId দুবার গেলে সার্ভার duplicate ফেলে দেয়, তাই retry নিরাপদ
import {
    EMAIL_SENDER_KEY,
    EMAIL_SENDER_PING_URL,
    EMAIL_SENDER_SEND_URL
} from "../config/contact.js";

const OUTBOX = "sync-contact-outbox";
const RETRY_MS = [3000, 8000, 20000, 45000, 90000];
const OPTIMISTIC_MS = 2500;
const DAY_MS = 24 * 3600 * 1000;

const uid = () => {
    try {
        return crypto.randomUUID();
    } catch {
        return `sy${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
    }
};

const loadOutbox = () => {
    try {
        const list = JSON.parse(localStorage.getItem(OUTBOX));
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
};

const saveOutbox = list => {
    try {
        localStorage.setItem(OUTBOX, JSON.stringify(list));
    } catch {
        /* storage বন্ধ থাকলেও পাঠানো চলবে */
    }
};

const dropFromOutbox = id => saveOutbox(loadOutbox().filter(m => m.id !== id));

const post = async item => {
    const body = new URLSearchParams(item.body);
    try {
        const res = await fetch(item.action, {
            method: "POST",
            headers: { Accept: "application/json" },
            body,
            keepalive: body.toString().length < 60000
        });
        if (res.ok) return { ok: true };
        // 400-403: ফর্ম/key ভুল, আবার চেষ্টা করে লাভ নেই
        return {
            ok: false,
            final: res.status >= 400 && res.status <= 403,
            status: res.status
        };
    } catch {
        return { ok: false, final: false, status: 0 };
    }
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const deliver = async (item, attempt = 0) => {
    const r = await post(item);
    if (r.ok || r.final) {
        dropFromOutbox(item.id);
        return r;
    }
    // retry শেষ হলে outbox-এই থাকে, পরের ভিজিটে আবার যাবে
    if (attempt >= RETRY_MS.length) return r;
    await sleep(RETRY_MS[attempt]);
    return deliver(item, attempt + 1);
};

// সার্ভার ঘুমিয়ে থাকলে ফর্ম খোলার সাথে সাথেই জাগানো
let warmed = false;
export const warmEmailSender = () => {
    if (warmed) return;
    warmed = true;
    try {
        fetch(EMAIL_SENDER_PING_URL, { mode: "no-cors", cache: "no-store" }).catch(
            () => {}
        );
    } catch {
        /* ignore */
    }
};

// আগে যে মেসেজ যায়নি (ট্যাব বন্ধ/অফলাইন) সেগুলো আবার পাঠানো
let flushed = false;
export const flushContactOutbox = () => {
    if (flushed) return;
    flushed = true;
    loadOutbox().forEach(item => {
        if (Date.now() - item.t > DAY_MS) return dropFromOutbox(item.id);
        if (item.action === EMAIL_SENDER_SEND_URL) deliver(item, 1);
    });
};

// ফর্ম পাঠানো। সার্ভার ২.৫ সেকেন্ডে সাড়া না দিলে ইউজারকে বসিয়ে না রেখে "sent" দেখানো হয়
// আর আসল পাঠানো পেছনে retry সহ চলতে থাকে।
export const sendContactMessage = ({ name, email, subject, message, botcheck }) => {
    const id = uid();
    const body = new URLSearchParams({
        access_key: EMAIL_SENDER_KEY,
        botcheck: botcheck || "",
        name,
        email,
        subject,
        message,
        submissionId: id,
        pageUrl: window.location.href
    }).toString();

    const item = { id, action: EMAIL_SENDER_SEND_URL, body, t: Date.now() };
    saveOutbox([...loadOutbox(), item]);

    return new Promise(resolve => {
        let settled = false;
        const finish = r => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(r);
        };
        const timer = setTimeout(() => finish({ ok: true }), OPTIMISTIC_MS);
        deliver(item, 0).then(finish);
    });
};

export const contactErrorMessage = r => {
    if (r.status === 0) return "Network error. Please check your connection.";
    if (r.status === 429)
        return "Too many messages. Please try again in a little while.";
    if (r.status === 401 || r.status === 403)
        return "This form is not set up correctly.";
    return "Something went wrong. Please try again.";
};
