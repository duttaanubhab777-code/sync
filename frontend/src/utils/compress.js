// আপলোডের আগে মিডিয়া ছোট করার একটাই প্রবেশদ্বার।
// ছবি (image.js) ও ভিডিও (video.js) দুটোই এখানে compress হয়; progress UI ("Compressing... 40%") আগে থেকেই তৈরি।
//
// compressMediaFile(file, { onProgress, signal, force, trim }) সবসময় একটা File ফেরত দেয় (ব্যর্থ হলে আসলটাই), কখনো throw করে না।
// একমাত্র ব্যতিক্রম: trim = { start, end } দিয়ে ভিডিও ছাঁটতে বললে এবং ছাঁটা না গেলে throw করে (না-ছাঁটা ভিডিও পোস্ট হওয়া ঠেকাতে)।
// onProgress(0..100, { current, duration }) ঐচ্ছিক: যে compress-এর অগ্রগতি জানা যায় (ভিডিও) সে-ই ডাকবে।
// signal (AbortSignal) ঐচ্ছিক: abort হলে ভিডিও compress থেমে আসল ফাইল ফেরত যায় ("Send original" বোতামের জন্য)।
import { compressImageFile } from "./image.js";
import { compressVideoFile } from "./video.js";

export const compressMediaFile = async (file, { onProgress, signal, force = false, trim = null } = {}) => {
    try {
        const type = String(file?.type || "").toLowerCase();
        // কিছু Android WebView ফাইল পিকারে MIME খালি আসে, তাই এক্সটেনশন দিয়েও ভিডিও চেনা
        const looksVideo =
            type.startsWith("video/") || (!type && /\.(mp4|mov|webm|m4v|3gp)$/i.test(file?.name || ""));
        if (type.startsWith("image/")) return await compressImageFile(file);
        if (looksVideo) return await compressVideoFile(file, { onProgress, signal, force, trim });
        return file;
    } catch (err) {
        if (trim && err?.message && /trim/i.test(err.message)) throw err;
        return file;
    }
};
