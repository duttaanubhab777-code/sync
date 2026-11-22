import React from "react";
import {
    Image as ImageIcon,
    Video,
    Mic,
    FileText,
    MapPin,
    UserRound,
    Ban
} from "lucide-react";

// চ্যাট লিস্ট / রিপ্লাই প্রিভিউতে "[AUDIO]" বা emoji এর বদলে professional SVG আইকন + লেখা
const TYPE_META = {
    image: { Icon: ImageIcon, label: "Photo" },
    video: { Icon: Video, label: "Video" },
    audio: { Icon: Mic, label: "Voice message" },
    file: { Icon: FileText, label: "Document" },
    location: { Icon: MapPin, label: "Location" },
    contact: { Icon: UserRound, label: "Contact" }
};

const stripLeadingSymbol = s =>
    String(s || "")
        .replace(/^(📍|👤|📎)\s*/u, "")
        .replace(/^Contact:\s*/i, "")
        .trim();

// পুরনো/নতুন দুই ধরনের সংরক্ষিত টেক্সট থেকেই টাইপ বের করে
export const resolvePreview = ({ type, text, deleted } = {}) => {
    const raw = String(text || "");
    if (deleted || raw === "This message was deleted") {
        return { Icon: Ban, label: "This message was deleted", detail: "" };
    }

    let kind = type && type !== "text" ? type : null;
    const bracket = raw.match(/^\[([A-Za-z]+)\]$/);
    if (bracket) kind = bracket[1].toLowerCase();
    else if (!kind && raw.startsWith("📍")) kind = "location";
    else if (!kind && raw.startsWith("👤")) kind = "contact";
    else if (!kind && raw.startsWith("📎")) kind = "file";

    const meta = kind && TYPE_META[kind];
    if (!meta) return null;

    let detail = "";
    if (!bracket && kind !== "image" && kind !== "video" && kind !== "audio") {
        detail = stripLeadingSymbol(raw);
        // "Location" / "Attachment" ডিফল্ট লেখা আলাদা করে দেখানোর দরকার নেই
        if (/^(Location|Attachment|Contact)$/i.test(detail)) detail = "";
    }
    return { Icon: meta.Icon, label: meta.label, detail };
};

export default function MessagePreview({
    type,
    text,
    deleted,
    fallback = "",
    size = 15
}) {
    const info = resolvePreview({ type, text, deleted });
    if (!info) return <>{text || fallback}</>;
    const { Icon, label, detail } = info;
    return (
        <span className="sync-preview-chip">
            <Icon size={size} strokeWidth={2} aria-hidden="true" />
            <span className="sync-preview-label">
                {detail ? detail : label}
            </span>
        </span>
    );
}
