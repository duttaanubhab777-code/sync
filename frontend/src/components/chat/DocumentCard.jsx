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
import { isAndroidApp } from "../../services/appUpdate.js";

// Cloudinary-র fl_attachment ফ্ল্যাগ দিলে ফাইল ব্রাউজারে খোলার বদলে সরাসরি ফোনে ডাউনলোড হয়।
// শুধু আমাদের Cloudinary-র /upload/ লিংকে বসানো হয়; আগে থেকেই থাকলে আবার বসে না।
const toDownloadUrl = url => {
    const s = String(url || "");
    if (!/^https:\/\/res\.cloudinary\.com\//.test(s)) return s;
    if (/\/upload\/[^/]*fl_attachment/.test(s)) return s;
    return s.replace("/upload/", "/upload/fl_attachment/");
};

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
    const downloadUrl = toDownloadUrl(media.url);

    const handleClick = e => {
        e.stopPropagation();
        // অ্যাপে (Capacitor WebView) ট্যাপ করলে সিস্টেম ব্রাউজার ফাইলটা নামায়
        if (isAndroidApp) {
            e.preventDefault();
            window.location.href = downloadUrl;
        }
    };

    return (
        <a
            href={downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="sync-msg-file-card sync-doc-card"
            onClick={handleClick}
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
