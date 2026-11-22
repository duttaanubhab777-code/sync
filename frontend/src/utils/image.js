// ছবি বাছাই করার পর বর্গাকার (center-crop) করে ছোট WebP/JPEG বানানো।
// ফোনের ৫–১০ MB ছবি আপলোড না করে ~৪০–৯০ KB-এর ছবি যায়, তাই দ্রুত ও lag-ছাড়া।
export const MAX_AVATAR_INPUT_BYTES = 12 * 1024 * 1024;

export const loadBitmap = async file => {
    if (typeof createImageBitmap === "function") {
        try {
            return await createImageBitmap(file, { imageOrientation: "from-image" });
        } catch {
            /* নিচে <img> দিয়ে চেষ্টা */
        }
    }
    const url = URL.createObjectURL(file);
    try {
        const img = new Image();
        img.decoding = "async";
        img.src = url;
        await img.decode();
        return img;
    } finally {
        URL.revokeObjectURL(url);
    }
};

export const canvasToBlob = (canvas, type, quality) =>
    new Promise(resolve => canvas.toBlob(resolve, type, quality));

export const makeAvatarFile = async (file, size = 512) => {
    if (!file) throw new Error("No image selected");
    if (!String(file.type || "").startsWith("image/")) {
        throw new Error("Please choose an image file");
    }
    if (file.size > MAX_AVATAR_INPUT_BYTES) {
        throw new Error("Image is too large (max 12 MB)");
    }

    let bitmap;
    try {
        bitmap = await loadBitmap(file);
    } catch {
        throw new Error("This image could not be read. Try a JPG or PNG.");
    }

    const w = bitmap.width || bitmap.naturalWidth;
    const h = bitmap.height || bitmap.naturalHeight;
    const side = Math.min(w, h);
    const out = Math.min(size, side);

    const canvas = document.createElement("canvas");
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, (w - side) / 2, (h - side) / 2, side, side, 0, 0, out, out);
    bitmap.close?.();

    let blob = await canvasToBlob(canvas, "image/webp", 0.86);
    let ext = "webp";
    if (!blob || blob.type !== "image/webp") {
        blob = await canvasToBlob(canvas, "image/jpeg", 0.88);
        ext = "jpg";
    }
    if (!blob) throw new Error("Could not process this image");

    return new File([blob], `avatar.${ext}`, { type: blob.type });
};

// ---------- চ্যাট/story-র ছবি compress (WhatsApp-এর মতো) ----------
// লম্বা দিক সর্বোচ্চ ১৬০০px, WebP/JPEG কোয়ালিটি ~০.৮। চোখে পার্থক্য বোঝা যায় না, কিন্তু সাইজ সাধারণত ৫–১০ গুণ কমে।
// ডকুমেন্ট হিসেবে পাঠালে এটা ডাকা হয় না। কোনো কারণে ব্যর্থ হলে আসল ফাইলই ফেরত দেয় (আপলোড আটকায় না)।
export const MAX_CHAT_IMAGE_DIMENSION = 1600;
const CHAT_IMAGE_QUALITY = 0.8;
// এর চেয়ে ছোট ও মাপের মধ্যে থাকা ছবি আর ছোঁয়া হয় না
const SKIP_COMPRESS_BELOW_BYTES = 250 * 1024;
// এই ধরনের ছবি canvas-এ গেলে অ্যানিমেশন/ভেক্টর নষ্ট হয়
const NEVER_COMPRESS = /^image\/(gif|svg\+xml)$/i;

export const compressImageFile = async (
    file,
    { maxDimension = MAX_CHAT_IMAGE_DIMENSION, quality = CHAT_IMAGE_QUALITY } = {}
) => {
    try {
        if (!file || !String(file.type || "").startsWith("image/")) return file;
        if (NEVER_COMPRESS.test(file.type)) return file;

        const bitmap = await loadBitmap(file);
        const w = bitmap.width || bitmap.naturalWidth;
        const h = bitmap.height || bitmap.naturalHeight;
        if (!w || !h) {
            bitmap.close?.();
            return file;
        }

        const scale = Math.min(1, maxDimension / Math.max(w, h));
        if (scale === 1 && file.size <= SKIP_COMPRESS_BELOW_BYTES) {
            bitmap.close?.();
            return file;
        }

        const outW = Math.max(1, Math.round(w * scale));
        const outH = Math.max(1, Math.round(h * scale));
        const canvas = document.createElement("canvas");
        canvas.width = outW;
        canvas.height = outH;
        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(bitmap, 0, 0, outW, outH);
        bitmap.close?.();

        // WebP (স্বচ্ছতা ঠিক থাকে) চেষ্টা, না পারলে JPEG (স্বচ্ছ অংশ সাদা)
        let blob = await canvasToBlob(canvas, "image/webp", quality);
        let ext = "webp";
        if (!blob || blob.type !== "image/webp") {
            const flat = document.createElement("canvas");
            flat.width = outW;
            flat.height = outH;
            const fctx = flat.getContext("2d");
            fctx.fillStyle = "#fff";
            fctx.fillRect(0, 0, outW, outH);
            fctx.drawImage(canvas, 0, 0);
            blob = await canvasToBlob(flat, "image/jpeg", quality);
            ext = "jpg";
        }
        // ছোট না হলে আসলটাই ভালো
        if (!blob || blob.size >= file.size * 0.9) return file;

        const baseName = String(file.name || "photo").replace(/\.[^./\\]+$/, "") || "photo";
        return new File([blob], `${baseName}.${ext}`, {
            type: blob.type,
            lastModified: Date.now()
        });
    } catch {
        return file;
    }
};
