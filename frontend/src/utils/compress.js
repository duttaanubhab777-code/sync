// আপলোডের আগে মিডিয়া ছোট করার একটাই প্রবেশদ্বার।
// ছবি (image.js) ও ভিডিও (video.js) দুটোই এখানে compress হয়; progress UI ("Compressing... 40%") আগে থেকেই তৈরি।
//
// compressMediaFile(file, { onProgress }) সবসময় একটা File ফেরত দেয় (ব্যর্থ হলে আসলটাই), কখনো throw করে না।
// onProgress(0..100, { current, duration }) ঐচ্ছিক: যে compress-এর অগ্রগতি জানা যায় (ভিডিও) সে-ই ডাকবে।
// signal (AbortSignal) ঐচ্ছিক: abort হলে ভিডিও compress থেমে আসল ফাইল ফেরত যায় ("Skip" বোতামের জন্য)।
import { compressImageFile } from "./image.js";
import { compressVideoFile } from "./video.js";

export const compressMediaFile = async (file, { onProgress, signal } = {}) => {
    try {
        const type = String(file?.type || "").toLowerCase();
        // কিছু Android WebView ফাইল পিকারে MIME খালি আসে, তাই এক্সটেনশন দিয়েও ভিডিও চেনা
        const looksVideo =
            type.startsWith("video/") || (!type && /\.(mp4|mov|webm|m4v|3gp)$/i.test(file?.name || ""));
        if (type.startsWith("image/")) return await compressImageFile(file);
        if (looksVideo) return await compressVideoFile(file, { onProgress, signal });
        return file;
    } catch {
        return file;
    }
};
