import React from "react";

/**
 * Static ballot icon used for poll actions.
 * Kept animation-free so the chat composer stays lightweight.
 */
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
            <rect x="4" y="3.5" width="16" height="17" rx="3" stroke="currentColor" strokeWidth="1.8" />
            <path d="M8 8H10.5M13 8H16M8 12H10.5M13 12H16M8 16H10.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M14 16.2L15.5 17.7L18.5 14.7" stroke="#35E69A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}
