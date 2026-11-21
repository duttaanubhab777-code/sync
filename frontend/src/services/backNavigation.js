// ফোনের Back বাটন (Android APK) ও ব্যাক-জেসচার হ্যান্ডলিং।
// APK-র MainActivity Back চাপলে window.__syncHandleBack() ডাকে:
//   true  -> ওয়েব অংশ নিজে সামলেছে (পপআপ বন্ধ / আগের পেজে ফেরা)
//   false -> একদম হোম পেজে, তাই APK অ্যাপটা শুধু মিনিমাইজ করবে (বন্ধ করবে না)

const handlers = [];

// যে ওভারলে নিজের state দিয়ে খোলে (info drawer, story viewer) সে এখানে নিজেকে রেজিস্টার করে
export function pushBackHandler(fn) {
    handlers.push(fn);
    return () => {
        const i = handlers.lastIndexOf(fn);
        if (i >= 0) handlers.splice(i, 1);
    };
}

export function runBackHandlers() {
    for (let i = handlers.length - 1; i >= 0; i -= 1) {
        try {
            if (handlers[i]() === true) return true;
        } catch {
            // একটা হ্যান্ডলার ভাঙলে বাকিগুলো চলুক
        }
    }
    return false;
}

// সাধারণ মোডাল/শিট/মেনু: backdrop-এ ক্লিক করলে যেগুলো বন্ধ হয়
const BACKDROPS = [
    ".sync-lightbox",
    ".sync-modal-backdrop",
    ".sync-attach-backdrop",
    ".sync-more-scrim"
].join(",");

export function closeTopOverlay() {
    const nodes = Array.from(document.querySelectorAll(BACKDROPS)).filter(
        el => !el.closest(".is-closing")
    );
    if (!nodes.length) return false;
    nodes[nodes.length - 1].click();
    return true;
}

// যে রুটে Back দিলে অ্যাপ মিনিমাইজ হবে (এর আগে আর কোথাও যাওয়ার নেই)
const ROOT_PATHS = new Set(["/", "/chats", "/admin", "/login"]);

export function createBackHandler(navigate) {
    return () => {
        if (runBackHandlers()) return true;
        if (closeTopOverlay()) return true;

        const idx = Number(window.history.state?.idx || 0);
        if (idx > 0) {
            navigate(-1);
            return true;
        }

        const path = window.location.pathname.replace(/\/+$/, "") || "/";
        if (ROOT_PATHS.has(path)) return false;

        // সরাসরি কোনো ভেতরের পেজে খোলা হয়েছে (যেমন নোটিফিকেশন থেকে) — হোমে নিয়ে যাও
        navigate("/", { replace: true });
        return true;
    };
}

// হেডারের ← বাটন: আগের পেজ থাকলে সেখানে ফেরে (history বাড়ায় না), নাহলে fallback-এ যায়
export function goBackOr(navigate, fallback = "/chats") {
    const idx = Number(window.history.state?.idx || 0);
    if (idx > 0) navigate(-1);
    else navigate(fallback, { replace: true });
}
