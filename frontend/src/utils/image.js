// ছবি বাছাই করার পর বর্গাকার (center-crop) করে ছোট WebP/JPEG বানানো।
// ফোনের ৫–১০ MB ছবি আপলোড না করে ~৪০–৯০ KB-এর ছবি যায়, তাই দ্রুত ও lag-ছাড়া।
export const MAX_AVATAR_INPUT_BYTES = 12 * 1024 * 1024;

const loadBitmap = async file => {
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

const canvasToBlob = (canvas, type, quality) =>
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
