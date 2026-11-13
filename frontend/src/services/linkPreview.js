import { api } from "./api.js";

// WhatsApp-এর মত লিংক preview: সার্ভার থেকে title/description/image আনে।
// একই লিংক বারবার এলে (চ্যাট লোড, স্ক্রল, re-render) নেটওয়ার্কে যায় না, আর একসাথে সর্বোচ্চ ৩টা রিকোয়েস্ট চলে।
const MAX_PARALLEL = 3;
const STORE_KEY = "sync_link_previews_v1";
const STORE_MAX = 80;

const memory = new Map(); // url -> preview | null
const inflight = new Map(); // url -> Promise
const queue = [];
let running = 0;

// ট্যাব রিলোডেও যেন আবার আনতে না হয়, তাই sessionStorage-এ ছোট করে রাখা
const loadStore = () => {
    try {
        const raw = JSON.parse(sessionStorage.getItem(STORE_KEY) || "{}");
        for (const [k, v] of Object.entries(raw)) memory.set(k, v);
    } catch {
        /* ignore */
    }
};
const saveStore = () => {
    try {
        const entries = [...memory.entries()].slice(-STORE_MAX);
        sessionStorage.setItem(
            STORE_KEY,
            JSON.stringify(Object.fromEntries(entries))
        );
    } catch {
        /* ignore */
    }
};
loadStore();

const pump = () => {
    while (running < MAX_PARALLEL && queue.length) {
        const job = queue.shift();
        running += 1;
        job().finally(() => {
            running -= 1;
            pump();
        });
    }
};

export const getCachedLinkPreview = url =>
    memory.has(url) ? { hit: true, value: memory.get(url) } : { hit: false };

export const fetchLinkPreview = url => {
    if (memory.has(url)) return Promise.resolve(memory.get(url));
    if (inflight.has(url)) return inflight.get(url);

    const promise = new Promise(resolve => {
        queue.push(async () => {
            try {
                const res = await api.get("/api/link-preview", {
                    params: { url },
                    timeout: 12000
                });
                const value = res.data?.data || null;
                memory.set(url, value);
                saveStore();
                resolve(value);
            } catch {
                // নেটওয়ার্ক/৪২৯ এরর cache করি না — পরে আবার চেষ্টা হতে পারে
                resolve(null);
            }
        });
        pump();
    }).finally(() => inflight.delete(url));

    inflight.set(url, promise);
    return promise;
};
