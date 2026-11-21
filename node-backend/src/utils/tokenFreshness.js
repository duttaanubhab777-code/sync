// পাসওয়ার্ড বদলানোর আগে ইস্যু হওয়া token (iat সেকেন্ডে) আর চলবে না।
// একই সেকেন্ডে ইস্যু হওয়া নতুন token বৈধ ধরা হয় (সেকেন্ডে নামিয়ে তুলনা), যাতে change-password-এর
// ঠিক পরে পাওয়া token সাথে সাথে বাতিল না হয়।
export const isTokenStale = (decoded, passwordChangedAt) => {
    if (!passwordChangedAt || !decoded?.iat) return false;
    const changedSec = Math.floor(new Date(passwordChangedAt).getTime() / 1000);
    return Number.isFinite(changedSec) && changedSec > decoded.iat;
};
