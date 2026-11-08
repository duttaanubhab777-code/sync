// userId (String) -> এখন কয়টা socket/ট্যাব কানেক্টেড আছে তার সংখ্যা
const onlineCounts = new Map();

export const addUserConnection = userId => {
    const key = String(userId);
    const current = onlineCounts.get(key) || 0;
    const nextCount = current + 1;
    onlineCounts.set(key, nextCount);

    // আগে 0 ছিল, এখন 1 হলো মানে ইউজার এইমাত্র অনলাইনে এল
    return { isFirstConnection: current === 0, count: nextCount };
};

export const removeUserConnection = userId => {
    const key = String(userId);
    const current = onlineCounts.get(key) || 0;

    if (current <= 1) {
        onlineCounts.delete(key);
        // সব ডিভাইস/ট্যাব বন্ধ, ইউজার এখন পুরোপুরি অফলাইন
        return { isCompletelyOffline: true, count: 0 };
    }
    const nextCount = current - 1;
    onlineCounts.set(key, nextCount);
    return { isCompletelyOffline: false, count: nextCount };
};

export const isUserOnline = userId => {
    return (onlineCounts.get(String(userId)) || 0) > 0;
};

export const getOnlineUserIds = () => {
    return Array.from(onlineCounts.keys());
};
