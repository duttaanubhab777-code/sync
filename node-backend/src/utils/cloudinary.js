// URL টা সত্যিই আমাদের Cloudinary অ্যাকাউন্টের কিনা যাচাই করা (নকল/ক্ষতিকর লিংক আটকাতে)
// গ্রহণযোগ্য: https://res.cloudinary.com/<CLOUD_NAME>/(image|video|raw)/upload/...
// Phase 1-2 পরিবর্তন: production-এ CLOUDINARY_CLOUD_NAME না থাকলে কোনো URL-ই গ্রহণ করা হয় না,
// আর /fetch/ বা /private/ ধরনের লিংক (যেগুলো অন্য সাইটের ছবি টেনে আনতে পারে) বাদ দেওয়া হয়।
const isProduction = () =>
    process.env.NODE_ENV === "production" || Boolean(process.env.RENDER);

export const isValidCloudinaryUrl = url => {
    if (!url || typeof url !== "string") return false;
    let u;
    try {
        u = new URL(url);
    } catch {
        return false;
    }
    if (u.protocol !== "https:" || u.hostname !== "res.cloudinary.com") {
        return false;
    }
    // user:pass@ বা অন্য পোর্ট দিয়ে লুকানো লিংক নয়
    if (u.username || u.password || u.port) return false;

    const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
    if (!cloudName) {
        // লোকাল ডেভেলপমেন্টে সেট না থাকলে যেকোনো Cloudinary অ্যাকাউন্ট চলবে, production-এ নয়
        if (isProduction()) return false;
        return /^\/[^/]+\/(image|video|raw)\/upload\//.test(u.pathname);
    }
    return u.pathname.startsWith(`/${cloudName}/`)
        ? /^\/(image|video|raw)\/upload\//.test(
              u.pathname.slice(cloudName.length + 1)
          )
        : false;
};

// ফাইলের নাম থেকে path traversal, control char ও HTML ইনজেকশন সরানো
export const sanitizeFileName = name => {
    if (typeof name !== "string") return "";
    // আগে HTML ট্যাগ সরানো, তারপর পাথ থাকলে শুধু শেষের ফাইলনেম অংশ নেওয়া
    const withoutTags = name.replace(/<[^>]*>/g, "");
    const base = withoutTags.split(/[\\/]/).pop() || "";
    const cleaned = base
        // eslint-disable-next-line no-control-regex
        .replace(/[\x00-\x1f\x7f]/g, "")
        .replace(/[<>:"'`|?*]/g, "")
        .replace(/\.\.+/g, ".")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^\.+/, "")
        .slice(0, 180)
        .trim();
    return cleaned;
};

// client থেকে আসা media object থেকে শুধু দরকারি ফিল্ডগুলো রাখা
export const pickMedia = media => {
    if (!media || typeof media !== "object") return undefined;
    const out = {};
    for (const k of ["url", "publicId", "mime"]) {
        if (typeof media[k] === "string") out[k] = media[k];
    }
    if (typeof media.fileName === "string") {
        const cleanName = sanitizeFileName(media.fileName);
        if (cleanName) out.fileName = cleanName;
    }
    for (const k of ["bytes", "width", "height", "duration"]) {
        const n = Number(media[k]);
        if (Number.isFinite(n) && n >= 0) out[k] = n;
    }
    return out;
};
