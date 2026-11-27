import React from "react";
import { AlertCircle, Loader2, RotateCw, WifiOff, X } from "lucide-react";
import useUploadQueue from "../../hooks/useUploadQueue.js";
import { cancelUpload, retryUpload } from "../../services/outbox.js";

// মেসেজ বাবলের ওপর আপলোডের অবস্থা: কমপ্রেশন %, আপলোড % রিং, "Waiting for network…", ব্যর্থ হলে Retry/Delete।
// অবস্থা outbox থেকে সরাসরি আসে (Redux নয়), তাই প্রগ্রেসে পুরো চ্যাট লিস্ট রি-রেন্ডার হয় না।
export default function UploadBubbleOverlay({ clientMsgId }) {
    const queue = useUploadQueue();
    const job = queue.find(j => j.id === clientMsgId);
    if (!job) return null;

    const info = job.info || {};
    const failed = job.stage === "failed";
    const waiting = info.phase === "waiting";
    const compressing = job.stage === "compressing";
    const sending = job.stage === "sending";
    const queued = job.stage === "queued";
    const compressPct = Number.isFinite(info.compressPct) ? Math.floor(info.compressPct) : null;
    const pct = compressing
        ? compressPct ?? 0
        : Math.max(0, Math.min(100, Math.floor(info.precise ?? job.pct ?? 0)));

    let label;
    if (failed) label = job.error || "Failed";
    else if (waiting && info.waitReason === "offline") label = "Waiting for network…";
    else if (waiting) label = "Retrying…";
    else if (compressing) label = compressPct !== null ? `Compressing ${compressPct}%` : "Compressing…";
    else if (queued) label = "Waiting…";
    else if (sending) label = "Sending…";
    else label = `${pct}%`;

    const showBar = !waiting && !sending && !queued && (!compressing || compressPct !== null);

    return (
        <div className={`sync-bubble-upload${failed ? " is-failed" : ""}`} role="status">
            {failed ? (
                <>
                    <AlertCircle size={18} />
                    <span className="sync-bubble-upload-label">{label}</span>
                    <button
                        type="button"
                        className="sync-bubble-upload-btn"
                        onClick={() => retryUpload(clientMsgId)}
                    >
                        <RotateCw size={14} /> Retry
                    </button>
                    <button
                        type="button"
                        className="sync-bubble-upload-btn ghost"
                        onClick={() => cancelUpload(clientMsgId)}
                        aria-label="Delete"
                    >
                        <X size={14} />
                    </button>
                </>
            ) : (
                <>
                    {waiting && info.waitReason === "offline" ? (
                        <WifiOff size={16} />
                    ) : (
                        <Loader2 size={16} className="spin" />
                    )}
                    <span className="sync-bubble-upload-label">{label}</span>
                    {showBar && (
                        <span className="sync-bubble-upload-bar">
                            <i style={{ width: `${pct}%` }} />
                        </span>
                    )}
                    <button
                        type="button"
                        className="sync-bubble-upload-btn ghost"
                        onClick={() => cancelUpload(clientMsgId)}
                        aria-label="Cancel"
                    >
                        <X size={14} />
                    </button>
                </>
            )}
        </div>
    );
}
