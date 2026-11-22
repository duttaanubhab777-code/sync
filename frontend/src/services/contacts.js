// ফোনের contact থেকে Sync ইউজার খুঁজে বের করা (WhatsApp-এর মতো)।
//  • Android অ্যাপে (Capacitor) : native Contacts প্লাগিন দিয়ে READ_CONTACTS permission নিয়ে অটো লোড
//  • Android Chrome (ওয়েব)     : Contact Picker API (ইউজার নিজে বাছাই করে দেয়)
//  • অন্য ব্রাউজার               : সাপোর্ট নেই
import { api } from "./api.js";

const SESSION_TTL_MS = 5 * 60 * 1000;
const CHUNK = 1000;
const MAX_PHONES = 5000;
let cache = null; // { at, matches }
let pluginRef;

const capacitor = () =>
    typeof window !== "undefined" ? window.Capacitor : undefined;

const isNativeApp = () => Boolean(capacitor()?.isNativePlatform?.());

// এই অ্যাপ লাইভ সাইট (server.url) থেকে চলে, তাই বাকি কোডের মতোই window.Capacitor.Plugins.X ব্যবহার করতে হয়
// (পুরনো APK-তে প্লাগিন না থাকলে এটা undefined)
const getNativePlugin = () => {
    const cap = capacitor();
    if (!cap || !isNativeApp()) return null;
    if (cap.Plugins?.Contacts) return cap.Plugins.Contacts;
    try {
        if (
            typeof cap.registerPlugin === "function" &&
            cap.isPluginAvailable?.("Contacts")
        ) {
            return cap.registerPlugin("Contacts");
        }
    } catch {
        /* ignore */
    }
    return null;
};

const webPickerSupported = () =>
    typeof navigator !== "undefined" &&
    "contacts" in navigator &&
    typeof navigator.contacts?.select === "function";

// "native" : APK + Contacts প্লাগিন আছে → permission চেয়ে অটো লোড
// "update" : APK আছে কিন্তু প্লাগিন নেই → নতুন APK লাগবে
// "picker" : সাধারণ ব্রাউজার (Android Chrome) → ইউজার নিজে বাছাই করে
// "none"   : সাপোর্ট নেই
export const getContactsMode = () => {
    if (getNativePlugin()) return "native";
    if (isNativeApp()) return "update";
    if (webPickerSupported()) return "picker";
    return "none";
};

// ফোন নম্বর → ১০ ডিজিট (ভারতীয় মোবাইল), না মিললে ""
// সামলায়: +91 98765 43210, 91-9876543210, 09876543210, 0091 9876543210,
//          +91 0 98765 43210, (98765) 43210 এবং কোনো prefix ছাড়া সাধারণ নম্বর
export const toPhone10 = raw => {
    let d = String(raw || "").replace(/\D/g, ""); // স্পেস, -, (), + সব বাদ
    if (d.startsWith("00")) d = d.slice(2); // আন্তর্জাতিক 00 prefix
    if (d.startsWith("91") && d.length >= 12) d = d.slice(2); // দেশের কোড
    d = d.replace(/^0+/, ""); // trunk prefix 0
    return /^[6-9]\d{9}$/.test(d) ? d : "";
};

export const hasContactsPermission = async () => {
    const plugin = getNativePlugin();
    if (!plugin) return false;
    try {
        const res = await plugin.checkPermissions();
        return res?.contacts === "granted" || res?.readContacts === "granted";
    } catch {
        return false;
    }
};

export const requestContactsPermission = async () => {
    const plugin = getNativePlugin();
    if (!plugin) return false;
    try {
        const res = await plugin.requestPermissions();
        return res?.contacts === "granted" || res?.readContacts === "granted";
    } catch {
        return false;
    }
};

// [{ name, phones: ["98..."] }]
const readDeviceContacts = async mode => {
    if (mode === "native") {
        const res = await getNativePlugin().getContacts({
            projection: { name: true, phones: true }
        });
        return (res?.contacts || []).map(c => ({
            name: c?.name?.display || c?.name?.given || "",
            phones: (c?.phones || []).map(p => p?.number).filter(Boolean)
        }));
    }
    const picked = await navigator.contacts.select(["name", "tel"], {
        multiple: true
    });
    return (picked || []).map(c => ({
        name: (c.name || [])[0] || "",
        phones: c.tel || []
    }));
};

// contact তালিকা পড়ে সার্ভারে মিলিয়ে নিয়ে মিলে যাওয়া ইউজার ফেরত দেয়
export const syncContacts = async ({ force = false } = {}) => {
    const mode = getContactsMode();
    if (mode === "none" || mode === "update") return [];
    if (!force && cache && Date.now() - cache.at < SESSION_TTL_MS) {
        return cache.matches;
    }

    const contacts = await readDeviceContacts(mode);
    const nameByPhone = new Map();
    for (const c of contacts) {
        for (const raw of c.phones) {
            const p = toPhone10(raw);
            if (p && !nameByPhone.has(p)) nameByPhone.set(p, c.name);
        }
    }
    const phones = [...nameByPhone.keys()].slice(0, MAX_PHONES);

    const chunks = [];
    for (let i = 0; i < phones.length; i += CHUNK) {
        chunks.push(phones.slice(i, i + CHUNK));
    }
    const responses = await Promise.all(
        chunks.map(part =>
            api.post("/api/v1/users/match-contacts", { phones: part })
        )
    );

    const seen = new Set();
    const matches = [];
    for (const r of responses) {
        for (const u of r.data?.data || []) {
            if (seen.has(u._id)) continue;
            seen.add(u._id);
            matches.push({
                ...u,
                contactName: nameByPhone.get(u.phoneNumber) || ""
            });
        }
    }
    matches.sort((a, b) =>
        (a.contactName || a.fullName || "").localeCompare(
            b.contactName || b.fullName || ""
        )
    );
    cache = { at: Date.now(), matches };
    return matches;
};

export const clearContactsCache = () => {
    cache = null;
};
