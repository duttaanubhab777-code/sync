import React from "react";
import useUploadQueue from "../../hooks/useUploadQueue.js";
import { skipCompression } from "../../services/outbox.js";
import UploadProgressCard from "../UploadProgressCard.jsx";

// ভিডিও compress চলাকালীন কার্ড ("Send original" বোতাম সহ)।
// আলাদা কম্পোনেন্ট, যাতে প্রগ্রেসের আপডেটে পুরো ChatPage রি-রেন্ডার না হয়।
export default function CompressingCard({ conversationId }) {
    const queue = useUploadQueue();
    const job = queue.find(
        j => j.stage === "compressing" && String(j.conversationId) === String(conversationId)
    );
    if (!job || !job.info) return null;
    return <UploadProgressCard info={job.info} onSkip={() => skipCompression(job.id)} />;
}
