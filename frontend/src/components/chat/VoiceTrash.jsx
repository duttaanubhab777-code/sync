import React from "react";

// অ্যানিমেটেড ট্র্যাশ আইকন: ঢাকনা (lid) আলাদা গ্রুপ, তাই খোলা/ঝাঁকুনি CSS দিয়ে হয়
export default function VoiceTrash({ size = 20, open = false, shake = false }) {
    return (
        <svg
            viewBox="0 0 24 24"
            width={size}
            height={size}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`sync-vtrash ${open ? "is-open" : ""} ${
                shake ? "is-shake" : ""
            }`}
            aria-hidden="true"
        >
            <g className="vt-lid">
                <path d="M3.5 6h17" />
                <path d="M9 6V4.6A1.6 1.6 0 0 1 10.6 3h2.8A1.6 1.6 0 0 1 15 4.6V6" />
            </g>
            <g className="vt-body">
                <path d="M5.8 8.5l.9 10.8A2 2 0 0 0 8.7 21h6.6a2 2 0 0 0 2-1.7l.9-10.8" />
                <path d="M10 11.5v5.2" />
                <path d="M14 11.5v5.2" />
            </g>
        </svg>
    );
}
