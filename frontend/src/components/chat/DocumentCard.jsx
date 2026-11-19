import React from "react";
import {
    Download,
    FileArchive,
    FileCode2,
    FileSpreadsheet,
    FileText,
    Presentation
} from "lucide-react";
import { formatBytes } from "../../utils/format.js";

// URL বা publicId থেকে ফাইলনেম অনুমান (পুরনো মেসেজগুলোতে fileName না থাকলে fallback)
const inferFileName = media => {
    if (media?.fileName) return media.fileName;
    const raw = media?.publicId || media?.url || "";
    const lastSegment = String(raw).split("/").pop()?.split("?")[0] || "";
    try {
        const decoded = decodeURIComponent(lastSegment);
        if (decoded && decoded.length <= 120 && /\.[a-z0-9]{1,8}$/i.test(decoded)) {
            return decoded;
        }
    } catch {
        // ignore malformed encoding
    }
    return "Attachment";
};

const getExtension = (fileName, mime) => {
    const match = String(fileName || "").match(/\.([a-z0-9]{1,8})$/i);
    if (match) return match[1].toUpperCase();
    if (mime && mime.includes("/")) {
        const sub = mime.split("/")[1].split(";")[0];
        if (sub && sub.length <= 8) return sub.toUpperCase();
    }
    return "FILE";
};

const getDocVisual = ext => {
    if (ext === "PDF") return { Icon: FileText, kind: "pdf" };
    if (["DOC", "DOCX", "ODT", "RTF"].includes(ext)) return { Icon: FileText, kind: "doc" };
    if (["XLS", "XLSX", "CSV", "ODS"].includes(ext)) return { Icon: FileSpreadsheet, kind: "sheet" };
    if (["PPT", "PPTX", "ODP"].includes(ext)) return { Icon: Presentation, kind: "slide" };
    if (["ZIP", "RAR", "7Z", "TAR", "GZ"].includes(ext)) return { Icon: FileArchive, kind: "archive" };
    if (["JSON", "JS", "TS", "HTML", "CSS", "PY", "MD"].includes(ext)) return { Icon: FileCode2, kind: "code" };
    return { Icon: FileText, kind: "generic" };
};

export default function DocumentCard({ media }) {
    if (!media?.url) return null;

    const fileName = inferFileName(media);
    const ext = getExtension(fileName, media.mime);
    const { Icon, kind } = getDocVisual(ext);
    const sizeText = formatBytes(media.bytes);

    return (
        <a
            href={media.url}
            target="_blank"
            rel="noopener noreferrer"
            download={fileName}
            className="sync-msg-file-card sync-doc-card"
            onClick={e => e.stopPropagation()}
        >
            <span className={`sync-doc-badge ${kind}`} aria-hidden="true">
                <Icon size={20} />
                <em>{ext.slice(0, 4)}</em>
            </span>
            <div className="file-meta">
                <span className="sync-doc-name" title={fileName}>
                    {fileName}
                </span>
                <small>
                    {[ext, sizeText].filter(Boolean).join(" · ") || "Document"}
                </small>
            </div>
            <span className="sync-doc-dl" aria-hidden="true">
                <Download size={16} />
            </span>
        </a>
    );
}
