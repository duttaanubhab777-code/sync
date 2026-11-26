import React from "react";

// লেখার ভেতরের http/https লিংকগুলো ক্লিকযোগ্য <a> বানায় (ব্রডকাস্ট/অ্যানাউন্সমেন্ট কার্ডের জন্য)
const URL_REGEX = /https?:\/\/[^\s<>"']+/gi;
const TRAILING_PUNCT = /[),.!?;:]+$/;

export default function LinkifiedText({ text }) {
    const source = String(text || "");
    const matches = [...source.matchAll(URL_REGEX)];
    if (!matches.length) return <>{source}</>;

    const parts = [];
    let cursor = 0;

    matches.forEach((match, index) => {
        const rawUrl = match[0];
        const trailing = rawUrl.match(TRAILING_PUNCT)?.[0] || "";
        const href = trailing ? rawUrl.slice(0, -trailing.length) : rawUrl;
        let parsed;
        try {
            parsed = new URL(href);
            if (!["http:", "https:"].includes(parsed.protocol)) return;
        } catch {
            return;
        }
        if (match.index > cursor) parts.push(source.slice(cursor, match.index));
        parts.push(
            <a
                key={`bc-link-${index}`}
                href={parsed.href}
                target="_blank"
                rel="noopener noreferrer"
                data-no-gesture
                onClick={event => event.stopPropagation()}
                className="sync-message-link sync-broadcast-link"
            >
                {href}
            </a>
        );
        if (trailing) parts.push(trailing);
        cursor = match.index + rawUrl.length;
    });

    if (cursor < source.length) parts.push(source.slice(cursor));
    return <>{parts}</>;
}
