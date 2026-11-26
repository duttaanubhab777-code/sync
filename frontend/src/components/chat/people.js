// ভোটার / রিয়্যাকশন দাতার নাম ও অবতার বের করার হেল্পার
const idOf = v => String(v?._id ?? v ?? "");

export const buildMemberMap = (members = []) => {
    const map = new Map();
    for (const m of members || []) {
        if (m && typeof m === "object") map.set(idOf(m), m);
    }
    return map;
};

export const resolvePerson = (ref, map, myId = "") => {
    const id = idOf(ref);
    const fromMap = map?.get(id);
    const src = fromMap || (ref && typeof ref === "object" ? ref : {});
    const name = src.fullName || src.username || "Member";
    return {
        id,
        name,
        username: src.username || "",
        avatar: src.avatar || "",
        isMe: Boolean(myId) && id === String(myId)
    };
};
