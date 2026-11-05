// userId (String) -> now how many socket/tab are connected

const onlineCounts = new Map();

export const addUserConnection = userId => {
    const key = String(userId);
    const current = onlineCounts.get(key) || 0;
    const nextCount = current + 1;
    onlineCounts.set(key, nextCount);

    //if  0 now 1 then one user is online

    return { isFirstConnection: current === 0, count: nextCount };
};

export const removeUserConnection = userId => {
    const key = String(userId);
    const current = onlineCounts.get(key) || 0;

    if (current <= 1) {
        onlineCounts.delete(key);

        //all device/tab are disconnected user is ofline

        return { isCompletlyOfline: true, count: 0 };
    }
    const nextCount = current - 1;
    onlineCounts.set(key, nextCount);
    return { isCompletlyOfline: false, count: nextCount };
};

export const isUserOnline = userId => {
    return onlineCounts.get(String(userId) || 0) > 0;
};

export const getOnlineUserIds = () => {
    return Array.from(onlineCounts.keys());
};
