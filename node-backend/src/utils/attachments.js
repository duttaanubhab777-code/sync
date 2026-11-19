// Location ও Contact মেসেজ পেলোড স্যানিটাইজ ও ভ্যালিডেট করার ইউটিলিটি
// ক্লায়েন্ট থেকে আসা যেকোনো ডেটা এখানে পরিষ্কার করে তবেই DB-তে নেওয়া হয়।

const MAX_ADDRESS_LEN = 240;
const MAX_CONTACT_NAME_LEN = 100;
const MAX_CONTACT_PHONES = 10;
const MAX_PHONE_LEN = 32;
const MAX_ACCURACY_METERS = 1_000_000;

// ফোনে শুধু সংখ্যার পাশাপাশি +, স্পেস, ড্যাশ, ব্র্যাকেট, ডট অনুমোদিত
const PHONE_CHAR_REGEX = /^[+\d][\d\s().\-]{2,31}$/;

const stripUnsafeText = (value, maxLen) => {
    if (typeof value !== "string") return "";
    return (
        value
            // eslint-disable-next-line no-control-regex
            .replace(/[\x00-\x1f\x7f]/g, " ")
            .replace(/[<>]/g, "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, maxLen)
            .trim()
    );
};

// { lat, lng, accuracy?, address? } যাচাই ও পরিষ্কার করা
export const pickLocation = location => {
    if (!location || typeof location !== "object") return null;

    const lat = Number(location.lat);
    const lng = Number(location.lng);
    if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        lat < -90 ||
        lat > 90 ||
        lng < -180 ||
        lng > 180
    ) {
        return null;
    }

    const out = {
        lat: Number(lat.toFixed(7)),
        lng: Number(lng.toFixed(7))
    };

    if (location.accuracy !== undefined && location.accuracy !== null && location.accuracy !== "") {
        const acc = Number(location.accuracy);
        if (Number.isFinite(acc) && acc >= 0 && acc <= MAX_ACCURACY_METERS) {
            out.accuracy = Number(acc.toFixed(1));
        }
    }

    if (typeof location.address === "string") {
        const cleanAddress = stripUnsafeText(location.address, MAX_ADDRESS_LEN);
        if (cleanAddress) out.address = cleanAddress;
    }

    return out;
};

// ফোন নম্বর পরিষ্কার ও যাচাই (কমপক্ষে ৩টা ডিজিট থাকতে হবে)
export const sanitizePhoneNumber = raw => {
    if (typeof raw !== "string") return "";
    const cleaned = raw
        // eslint-disable-next-line no-control-regex
        .replace(/[\x00-\x1f\x7f]/g, "")
        .replace(/\s+/g, " ")
        .trim();
    if (!cleaned || cleaned.length > MAX_PHONE_LEN) return "";
    if (!PHONE_CHAR_REGEX.test(cleaned)) return "";
    const digits = cleaned.replace(/\D/g, "");
    if (digits.length < 3 || digits.length > 20) return "";
    return cleaned;
};

// { name, phones[] } যাচাই ও পরিষ্কার করা
export const pickContact = contact => {
    if (!contact || typeof contact !== "object") return null;

    const name = stripUnsafeText(contact.name, MAX_CONTACT_NAME_LEN);
    if (!name) return null;

    const rawPhones = Array.isArray(contact.phones) ? contact.phones : [];
    const seen = new Set();
    const phones = [];
    for (const entry of rawPhones) {
        if (phones.length >= MAX_CONTACT_PHONES) break;
        const cleanPhone = sanitizePhoneNumber(entry);
        if (!cleanPhone) continue;
        const dedupeKey = cleanPhone.replace(/[\s().\-]/g, "");
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        phones.push(cleanPhone);
    }

    if (phones.length === 0) return null;

    return { name, phones };
};

// চ্যাট লিস্ট ও পুশ নোটিফিকেশনের জন্য সংক্ষিপ্ত প্রিভিউ টেক্সট
export const buildLastMessagePreview = ({ type, text = "", media, location, contact }) => {
    if (type === "text") return String(text || "").slice(0, 100);
    if (type === "location") {
        return location?.address
            ? `📍 ${location.address}`.slice(0, 100)
            : "📍 Location";
    }
    if (type === "contact") {
        return contact?.name
            ? `👤 Contact: ${contact.name}`.slice(0, 100)
            : "👤 Contact";
    }
    if (type === "file") {
        return media?.fileName
            ? `📎 ${media.fileName}`.slice(0, 100)
            : "📎 Attachment";
    }
    return `[${String(type || "media").toUpperCase()}]`;
};
