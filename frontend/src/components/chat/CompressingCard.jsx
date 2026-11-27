import React from "react";
import useUploadQueue from "../../hooks/useUploadQueue.js";
import { skipCompression } from "../../services/outbox.js";
import { SEND_ORIGINAL_MAX_BYTES } from "../../services/media.js";
import UploadProgressCard from "../UploadProgressCard.jsx";

// চ্যাটের ভিডিও compress চলাকালীন কার্ড (২৫ MB-এর কম হলেই শুধু "Send original" বোতাম সহ)।
// আলাদা কম্পোনেন্ট, যাতে প্রগ্রেসের আপডেটে পুরো ChatPage রি-রেন্ডার না হয়।
export default function CompressingCard({ conversationId }) {
    const queue = useUploadQueue();
    const job = queue.find(
        j =>
            j.kind !== "story" &&
            j.stage === "compressing" &&
            String(j.conversationId) === String(conversationId)
    );
    if (!job || !job.info) return null;
    const canSendOriginal = Number(job.size || 0) < SEND_ORIGINAL_MAX_BYTES;
    return (
        <UploadProgressCard
            info={job.info}
            onSkip={canSendOriginal ? () => skipCompression(job.id) : undefined}
        />
    );
}
