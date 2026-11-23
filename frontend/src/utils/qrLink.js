// QR-এ থাকা লিংকের তৈরি ও পড়া।
// QR-এ ঢোকে সাধারণ https লিংক:  https://<sync-domain>/u/<username>
// এতে Google Lens / ফোনের ক্যামেরা / অন্য যেকোনো স্ক্যানারেই লিংকটা খুলে যায়, আর Sync-এর ভেতরের স্ক্যানার সরাসরি চ্যাটে নিয়ে যায়।

const USERNAME_RE = /^[a-z][a-z0-9_]{2,19}$/;
export const PENDING_LINK_KEY = "sync_pending_path";

export const buildProfileLink = username =>
    `${window.location.origin}/u/${encodeURIComponent(String(username || "").toLowerCase())}`;

// স্ক্যান করা টেক্সট থেকে username বের করে; Sync-এর QR না হলে null
export const parseProfileLink = raw => {
    const text = String(raw || "").trim();
    if (!text || text.length > 300) return null;
    let path = "";
    try {
        path = new URL(text).pathname;
    } catch {
        return null;
    }
    const m = path.match(/^\/u\/([^/?#]+)\/?$/i);
    if (!m) return null;
    let name = "";
    try {
        name = decodeURIComponent(m[1]).toLowerCase();
    } catch {
        return null;
    }
    return USERNAME_RE.test(name) ? name : null;
};

// লগইন না থাকলে গন্তব্য মনে রাখা, লগইনের পর AppLayout সেখানে পাঠাবে
export const rememberPendingPath = path => {
    try {
        sessionStorage.setItem(PENDING_LINK_KEY, path);
    } catch {
        /* private mode: অসুবিধা নেই */
    }
};

export const takePendingPath = () => {
    try {
        const v = sessionStorage.getItem(PENDING_LINK_KEY);
        if (v) sessionStorage.removeItem(PENDING_LINK_KEY);
        return v && v.startsWith("/u/") ? v : "";
    } catch {
        return "";
    }
};

// Gmail-এর মতো: নামের প্রথম অক্ষর; দুটো শব্দ থাকলে প্রথম ও শেষ শব্দের প্রথম অক্ষর (বাংলা যুক্তাক্ষর ভাঙে না)
export const qrInitials = (name, username = "") => {
    const seg = s => {
        const text = String(s || "");
        if (typeof Intl !== "undefined" && Intl.Segmenter) {
            const it = new Intl.Segmenter(undefined, { granularity: "grapheme" })
                .segment(text)[Symbol.iterator]()
                .next();
            return it.value?.segment || "";
        }
        return Array.from(text)[0] || "";
    };
    const words = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (words.length >= 2) return (seg(words[0]) + seg(words[words.length - 1])).toUpperCase();
    if (words.length === 1) return seg(words[0]).toUpperCase();
    return seg(username).toUpperCase() || "S";
};
