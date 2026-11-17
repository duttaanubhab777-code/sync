import React from "react";
import { Mic } from "lucide-react";

/* ==========================================================================
   Sync — live activity indicators (WhatsApp style)
   info = { activity: "typing" | "recording", names: string[] }
   - ActivityLabel  : চ্যাট লিস্টের প্রিভিউ ও হেডারের ছোট লাইভ টেক্সট
   - ActivityBubble : মেসেজ লিস্টের নিচে অ্যানিমেটেড বাবল
   ========================================================================== */

const namesText = names => {
    const list = names || [];
    if (list.length <= 2) return list.join(", ");
    return `${list.slice(0, 2).join(", ")} +${list.length - 2}`;
};

export const activityText = (info, isGroup) => {
    if (!info) return "";
    const verb = info.activity === "recording" ? "recording audio" : "typing";
    if (!isGroup) return verb;
    const names = info.names || [];
    return `${namesText(names)} ${names.length > 1 ? "are" : "is"} ${verb}`;
};

function Dots({ big }) {
    return (
        <span className={`sync-act-dots ${big ? "big" : ""}`} aria-hidden="true">
            <i />
            <i />
            <i />
        </span>
    );
}

function Wave({ bars = 5, big }) {
    return (
        <span className={`sync-act-wave ${big ? "big" : ""}`} aria-hidden="true">
            {Array.from({ length: bars }, (_, i) => (
                <i key={i} />
            ))}
        </span>
    );
}

export function ActivityLabel({ info, isGroup }) {
    if (!info) return null;
    const recording = info.activity === "recording";
    return (
        <span className={`sync-act ${recording ? "rec" : "txt"}`}>
            {recording && <Mic className="sync-act-mic" size={13} aria-hidden="true" />}
            <span className="sync-act-text">{activityText(info, isGroup)}</span>
            {recording ? <Wave /> : <Dots />}
        </span>
    );
}

export function ActivityBubble({ info, isGroup }) {
    if (!info) return null;
    const recording = info.activity === "recording";
    return (
        <div className="sync-msg-row incoming sync-act-row">
            <div
                className={`sync-msg-bubble sync-act-bubble ${
                    recording ? "rec" : "txt"
                }`}
                role="status"
                aria-label={activityText(info, isGroup)}
            >
                {isGroup && (
                    <div className="sync-msg-sender-name">
                        {namesText(info.names)}
                    </div>
                )}
                <div className="sync-act-inner">
                    {recording ? (
                        <>
                            <Mic className="sync-act-mic" size={17} aria-hidden="true" />
                            <Wave bars={9} big />
                        </>
                    ) : (
                        <Dots big />
                    )}
                </div>
            </div>
        </div>
    );
}
