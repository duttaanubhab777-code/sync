// URL টা সত্যিই আমাদের Cloudinary অ্যাকাউন্টের কিনা যাচাই করা (নকল/ক্ষতিকর লিংক আটকাতে)
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
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    // CLOUDINARY_CLOUD_NAME সেট না থাকলে যেকোনো Cloudinary URL চলবে (production-এ অবশ্যই সেট করো)
    if (!cloudName) return true;
    return u.pathname.startsWith(`/${cloudName}/`);
};

// client থেকে আসা media object থেকে শুধু দরকারি ফিল্ডগুলো রাখা
export const pickMedia = media => {
    if (!media || typeof media !== "object") return undefined;
    const out = {};
    for (const k of ["url", "publicId", "mime"]) {
        if (typeof media[k] === "string") out[k] = media[k];
    }
    for (const k of ["bytes", "width", "height", "duration"]) {
        const n = Number(media[k]);
        if (Number.isFinite(n) && n >= 0) out[k] = n;
    }
    return out;
};
