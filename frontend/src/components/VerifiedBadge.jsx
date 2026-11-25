import React from "react";

/**
 * ভেরিফায়েড SVG ব্যাজ (কোনো কীবোর্ড টিক বা ইমোজি নয়):
 *  - variant="group"    -> সবুজ ভেরিফায়েড টিক (অফিশিয়াল Sync গ্রুপের জন্য)
 *  - variant="official" -> নীল ভেরিফায়েড টিক (অফিশিয়াল Sync পার্সোনাল অ্যাকাউন্টের জন্য)
 */
export default function VerifiedBadge({
    variant = "group",
    size = 16,
    title,
    className = ""
}) {
    const isOfficialAccount = variant === "official";
    const label =
        title ||
        (isOfficialAccount
            ? "Verified Official Sync Account"
            : "Verified Official Sync Group");

    return (
        <span
            className={`sync-verified-badge sync-verified-badge--${
                isOfficialAccount ? "official" : "group"
            } ${className}`.trim()}
            title={label}
            role="img"
            aria-label={label}
            style={{ width: size, height: size }}
        >
            <svg
                viewBox="0 0 24 24"
                width={size}
                height={size}
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
            >
                {/* স্ক্যালপড ভেরিফায়েড সিল ব্যাকগ্রাউন্ড */}
                <path
                    className="sync-verified-seal"
                    d="M12 1.75l2.37 1.78 2.95-.28 1.24 2.7 2.7 1.24-.28 2.95L22.25 12l-1.78 2.37.28 2.95-2.7 1.24-1.24 2.7-2.95-.28L12 22.25l-2.37-1.78-2.95.28-1.24-2.7-2.7-1.24.28-2.95L1.75 12l1.78-2.37-.28-2.95 2.7-1.24 1.24-2.7 2.95.28L12 1.75z"
                />
                {/* ভেতরের পরিষ্কার সাদা SVG টিক */}
                <path
                    className="sync-verified-check"
                    d="M8.4 12.25l2.35 2.35 4.95-5.15"
                    stroke="#ffffff"
                    strokeWidth="2.35"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            </svg>
        </span>
    );
}
