import React, { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import {
    fetchLinkPreview,
    getCachedLinkPreview
} from "../services/linkPreview.js";

// WhatsApp-এর মত লিংক কার্ড: ছবি + title + description + সাইটের নাম।
// preview না পাওয়া গেলে (বা লোড হওয়ার আগে) আগের সরল কার্ড (শুধু হোস্ট) দেখায়।
export default function LinkPreviewCard({ href, host }) {
    const cached = getCachedLinkPreview(href);
    const [preview, setPreview] = useState(cached.hit ? cached.value : null);
    const [imgOk, setImgOk] = useState(true);

    useEffect(() => {
        let alive = true;
        setImgOk(true);
        const c = getCachedLinkPreview(href);
        if (c.hit) {
            setPreview(c.value);
            return undefined;
        }
        setPreview(null);
        fetchLinkPreview(href).then(value => {
            if (alive) setPreview(value);
        });
        return () => {
            alive = false;
        };
    }, [href]);

    const showImage = Boolean(preview?.image) && imgOk;
    const hasText = Boolean(preview?.title || preview?.description);

    // preview নেই → সরল কার্ড
    if (!preview || (!hasText && !showImage)) {
        return (
            <a
                className="sync-link-preview"
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={event => event.stopPropagation()}
            >
                <span className="sync-link-preview-icon">
                    <ExternalLink size={19} />
                </span>
                <span className="sync-link-preview-copy">
                    <strong>{host}</strong>
                    <small>{href}</small>
                    <em>Open link</em>
                </span>
                <ExternalLink size={16} className="sync-link-preview-arrow" />
            </a>
        );
    }

    return (
        <a
            className="sync-link-card"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={event => event.stopPropagation()}
        >
            {showImage && (
                <img
                    className="sync-link-card-image"
                    src={preview.image}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    onError={() => setImgOk(false)}
                />
            )}
            <span className="sync-link-card-body">
                {preview.title && (
                    <strong className="sync-link-card-title">
                        {preview.title}
                    </strong>
                )}
                {preview.description && (
                    <span className="sync-link-card-desc">
                        {preview.description}
                    </span>
                )}
                <small className="sync-link-card-host">
                    {preview.siteName || preview.host || host}
                </small>
            </span>
        </a>
    );
}
