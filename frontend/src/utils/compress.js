// আপলোডের আগে মিডিয়া ছোট করার একটাই প্রবেশদ্বার।
// এখন শুধু ছবি compress হয়। ভিডিও compress যোগ করতে নিচের `compressVideoFile` বানিয়ে
// switch-এ বসালেই হবে; progress UI ("Compressing... 40%") আগে থেকেই তৈরি।
//
// compressMediaFile(file, { onProgress }) সবসময় একটা File ফেরত দেয় (ব্যর্থ হলে আসলটাই), কখনো throw করে না।
// onProgress(0..100) ঐচ্ছিক: যে compress-এর অগ্রগতি জানা যায় (ভিডিও) সে-ই ডাকবে।
import { compressImageFile } from "./image.js";

export const compressMediaFile = async (file, { onProgress } = {}) => {
    try {
        const type = String(file?.type || "").toLowerCase();
        if (type.startsWith("image/")) return await compressImageFile(file);
        // if (type.startsWith("video/")) return await compressVideoFile(file, { onProgress });
        void onProgress;
        return file;
    } catch {
        return file;
    }
};
