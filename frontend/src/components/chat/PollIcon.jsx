import React from "react";

/**
 * Poll SVG icon — rounded card with rising bars (no keyboard look).
 * Static, animation-free so the composer stays lightweight.
 */
export default function PollIcon({ size = 20, className = "", strokeWidth = 1.8 }) {
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
            <rect
                x="3.5"
                y="3.5"
                width="17"
                height="17"
                rx="5"
                stroke="currentColor"
                strokeWidth={strokeWidth}
            />
            <path
                d="M8.2 16V12.6M12 16V8M15.8 16V10.6"
                stroke="currentColor"
                strokeWidth={strokeWidth + 0.5}
                strokeLinecap="round"
            />
        </svg>
    );
}
