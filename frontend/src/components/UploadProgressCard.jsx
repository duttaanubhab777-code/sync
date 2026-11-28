import React, { useEffect, useId, useState } from "react";
import { ArrowUp, Check, FileText, Minimize2, Music } from "lucide-react";
import { detectMessageTypeFromFile, SEND_ORIGINAL_MAX_BYTES } from "../services/media.js";
import { formatBytes } from "../utils/format.js";

// ছবি/ভিডিও/ফাইল আপলোডের সুন্দর progress কার্ড (Chat ও Story দুই জায়গাতেই এটা)।
// info = uploadMediaToCloudinary-এর onProgress-এর info + { file, name }:
//   phase: "compressing" | "preparing" | "uploading" | "processing" | "done" | "waiting"
// onSkip থাকলে এবং ভিডিওর আসল সাইজ ২৫ MB-এর কম হলেই কেবল "Send original" বোতাম দেখায়।

const RING_R = 24;
const RING_C = 2 * Math.PI * RING_R;

const formatClock = sec => {
    const s = Math.max(0, Math.round(sec || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const formatSpeed = bps => {
    if (!bps || bps < 1) return "";
    if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
    return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
};

const formatLeft = seconds => {
    if (seconds == null) return "";
    if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s left`;
    return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s left`;
};

export default function UploadProgressCard({ info, onSkip, className = "" }) {
    const gradId = useId().replace(/:/g, "");
    const file = info?.file || null;
    const kind = file ? detectMessageTypeFromFile(file) : "file";

    // ছোট প্রিভিউ (আসল ফাইল থেকে): ছবি বা ভিডিওর প্রথম ফ্রেম
    const [thumb, setThumb] = useState("");
    useEffect(() => {
        if (!file || (kind !== "image" && kind !== "video")) {
            setThumb("");
            return undefined;
        }
        const url = URL.createObjectURL(file);
        setThumb(url);
        return () => URL.revokeObjectURL(url);
    }, [file, kind]);

    if (!info) return null;

    const phase = info.phase || "uploading";
    const isDone = phase === "done";
    const isCompress = phase === "compressing";
    const isPrepare = phase === "preparing";
    const isFinalizing = phase === "processing";
    // নেট নেই / আবার চেষ্টা চলছে: error নয়, নিজে থেকে চালিয়ে যাবে
    const isWaiting = phase === "waiting";
    const waitOffline = isWaiting && info.waitReason === "offline";
    const compressPct = Number.isFinite(info.compressPct) ? info.compressPct : null;
    const indeterminate = isPrepare || (isCompress && compressPct === null) || isWaiting;

    let pct = 0;
    if (isCompress) pct = compressPct ?? 0;
    else if (isPrepare) pct = 0;
    else pct = Number.isFinite(info.precise) ? info.precise : 0;
    if (isDone) pct = 100;
    pct = Math.max(0, Math.min(100, pct));

    const stepTotal = info.willCompress ? 2 : 1;
    const step = isCompress || (isPrepare && info.willCompress) ? 1 : stepTotal;

    const noun = kind === "video" ? "video" : kind === "image" ? "photo" : kind === "audio" ? "audio" : "file";
    let title;
    if (isDone) title = "Done";
    else if (isWaiting) title = waitOffline ? "Waiting for network" : "Retrying";
    else if (isCompress)
        title = info.trimming
            ? `Trimming ${noun}`
            : info.compressRetry > 0
              ? `Shrinking ${noun} more`
              : `Compressing ${noun}`;
    else if (isPrepare) title = "Getting ready";
    else if (isFinalizing) title = "Finalizing";
    else title = `Uploading ${noun}`;

    const saved =
        !isCompress &&
        !isPrepare &&
        Number(info.compressedSize) > 0 &&
        Number(info.compressedSize) < Number(info.originalSize);
    const savedPct = saved ? Math.round((1 - info.compressedSize / info.originalSize) * 100) : 0;

    // নিচের ছোট লাইনের বাঁ ও ডান পাশ
    let metaLeft = "";
    let metaRight = "";
    if (isWaiting) {
        metaLeft = waitOffline ? "Will continue when you're back online" : "Reconnecting…";
        metaRight = "";
    } else if (isCompress) {
        metaLeft = formatBytes(info.originalSize || info.size) || "";
        if (Number.isFinite(info.compressDuration) && info.compressDuration > 0) {
            metaLeft = `${formatClock(info.compressCurrent)} / ${formatClock(info.compressDuration)}`;
            metaRight = formatLeft(info.compressDuration - (info.compressCurrent || 0));
        }
    } else if (isPrepare) {
        metaLeft = formatBytes(info.originalSize || info.size) || "";
    } else if (saved) {
        metaLeft = `${formatBytes(info.originalSize)} → ${formatBytes(info.compressedSize)}`;
        metaRight = isDone
            ? ""
            : [formatSpeed(info.speed), formatLeft(info.eta)].filter(Boolean).join(" · ");
    } else {
        metaLeft = `${formatBytes(info.loaded || 0) || "0 B"} / ${formatBytes(info.total || info.size) || ""}`;
        metaRight = isDone
            ? ""
            : [formatSpeed(info.speed), formatLeft(info.eta)].filter(Boolean).join(" · ");
    }

    // ভিডিও ২৫ MB-এর কম হলে তবেই "Send original" বোতাম দেখাবে, নইলে আসবেই না
    const originalBytes = Number(info.originalSize || info.size || file?.size || 0);
    const canSkip =
        Boolean(onSkip) &&
        isCompress &&
        kind === "video" &&
        originalBytes > 0 &&
        originalBytes < SEND_ORIGINAL_MAX_BYTES;

    const stateClass = isDone ? "is-done" : isCompress ? "is-compress" : isPrepare ? "is-prepare" : "is-upload";

    return (
        <div className={`sync-upc ${stateClass} ${className}`} role="status" aria-live="polite">
            <div className="sync-upc-thumb">
                {thumb && kind === "image" && <img src={thumb} alt="" draggable="false" />}
                {thumb && kind === "video" && (
                    <video src={`${thumb}#t=0.1`} muted playsInline preload="metadata" />
                )}
                {!thumb && (
                    <span className="sync-upc-fileicon">
                        {kind === "audio" ? <Music size={22} /> : <FileText size={22} />}
                    </span>
                )}
                <span className="sync-upc-veil" />
                {isCompress && <span className="sync-upc-scan" />}

                <svg className={`sync-upc-ring${indeterminate ? " spinning" : ""}`} viewBox="0 0 56 56" aria-hidden="true">
                    <defs>
                        <linearGradient id={`g${gradId}`} x1="0" y1="0" x2="1" y2="1">
                            <stop offset="0%" stopColor="#b6f34d" />
                            <stop offset="55%" stopColor="#00ed64" />
                            <stop offset="100%" stopColor="#1fa7b0" />
                        </linearGradient>
                    </defs>
                    <circle className="sync-upc-ring-track" cx="28" cy="28" r={RING_R} />
                    <circle
                        className="sync-upc-ring-fill"
                        cx="28"
                        cy="28"
                        r={RING_R}
                        stroke={`url(#g${gradId})`}
                        strokeDasharray={RING_C}
                        strokeDashoffset={indeterminate ? RING_C * 0.72 : RING_C * (1 - pct / 100)}
                        transform="rotate(-90 28 28)"
                    />
                </svg>

                <span className="sync-upc-icon" key={stateClass}>
                    {isDone ? (
                        <Check size={22} strokeWidth={3} />
                    ) : isCompress ? (
                        <Minimize2 size={20} strokeWidth={2.4} />
                    ) : (
                        <ArrowUp size={21} strokeWidth={2.6} />
                    )}
                </span>
            </div>

            <div className="sync-upc-body">
                <div className="sync-upc-row">
                    <span className="sync-upc-title" key={title}>
                        {title}
                        {stepTotal > 1 && !isDone && (
                            <em>
                                {step}/{stepTotal}
                            </em>
                        )}
                    </span>
                    <strong className="sync-upc-pct">
                        {indeterminate ? "" : `${Math.floor(pct)}%`}
                    </strong>
                </div>

                <div className="sync-upc-name">{info.name || file?.name || "file"}</div>

                <div className="sync-upc-bar">
                    <i
                        className={indeterminate ? "indeterminate" : ""}
                        style={indeterminate ? undefined : { width: `${pct}%` }}
                    />
                </div>

                <div className="sync-upc-meta">
                    <span>
                        {metaLeft}
                        {saved && <b className="sync-upc-saved">−{savedPct}%</b>}
                    </span>
                    {canSkip ? (
                        <button type="button" className="sync-upc-skip" onClick={onSkip}>
                            Send original
                        </button>
                    ) : (
                        <span>{metaRight}</span>
                    )}
                </div>
            </div>
        </div>
    );
}
