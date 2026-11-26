import React from "react";

/** Lightweight inline SVG poll mark shared by the composer and poll surfaces. */
export default function PollIcon({ size = 20, className = "" }) {
    return (
        <svg
            className={`sync-poll-icon ${className}`.trim()}
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
            focusable="false"
        >
            <path className="sync-poll-icon-track" d="M4 19V13M10 19V5M16 19V9M22 19V3" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
            <path d="M2 21H22" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity=".45" />
        </svg>
    );
}
