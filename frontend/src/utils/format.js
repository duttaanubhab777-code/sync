export const formatTime = dateInput => {
    if (!dateInput) return "";
    const d = new Date(dateInput);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

export const formatChatListTime = dateInput => {
    if (!dateInput) return "";
    const d = new Date(dateInput);
    if (Number.isNaN(d.getTime())) return "";
    const now = new Date();
    const isToday =
        d.getDate() === now.getDate() &&
        d.getMonth() === now.getMonth() &&
        d.getFullYear() === now.getFullYear();

    if (isToday) {
        return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday =
        d.getDate() === yesterday.getDate() &&
        d.getMonth() === yesterday.getMonth() &&
        d.getFullYear() === yesterday.getFullYear();

    if (isYesterday) return "Yesterday";

    return d.toLocaleDateString([], {
        day: "2-digit",
        month: "short"
    });
};

export const formatDateDivider = dateInput => {
    if (!dateInput) return "";
    const d = new Date(dateInput);
    if (Number.isNaN(d.getTime())) return "";
    const now = new Date();
    const isToday =
        d.getDate() === now.getDate() &&
        d.getMonth() === now.getMonth() &&
        d.getFullYear() === now.getFullYear();
    if (isToday) return "Today";

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday =
        d.getDate() === yesterday.getDate() &&
        d.getMonth() === yesterday.getMonth() &&
        d.getFullYear() === yesterday.getFullYear();
    if (isYesterday) return "Yesterday";

    return d.toLocaleDateString([], {
        day: "numeric",
        month: "long",
        year: "numeric"
    });
};

export const formatLastSeen = dateInput => {
    if (!dateInput) return "Offline";
    const d = new Date(dateInput);
    if (Number.isNaN(d.getTime())) return "Offline";
    return `last seen ${formatChatListTime(d)} at ${formatTime(d)}`;
};

export const formatBytes = bytes => {
    if (!bytes || Number.isNaN(Number(bytes))) return "";
    const b = Number(bytes);
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(1)} MB`;
};

export const generateClientMsgId = () => {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

export const getInitials = name => {
    if (!name) return "?";
    const parts = String(name).trim().split(/\s+/);
    if (parts.length >= 2) {
        return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return String(name).slice(0, 2).toUpperCase();
};

export const DEFAULT_ABOUT = "Hey there! I'm using Sync";

// পুরনো ডিফল্ট bio-তে কিবোর্ড ইমোজি ছিল, UI-তে সেটা পরিষ্কার টেক্সট হিসেবে দেখাই
export const cleanAbout = text => {
    const value = String(text || "").trim();
    if (!value || /^hello\s*!?\s*i am using sync/i.test(value)) {
        return DEFAULT_ABOUT;
    }
    return value;
};

// নাম থেকে 0–5 টোন (অ্যাভাটারের গ্রেডিয়েন্ট রঙ ঠিক করতে)
export const getAvatarTone = name => {
    const str = String(name || "");
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    }
    return hash % 6;
};
