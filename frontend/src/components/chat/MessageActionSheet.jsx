import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
    Reply,
    Info,
    Trash2,
    ChevronLeft,
    Check,
    CheckCheck,
    Loader2,
    Pencil,
    Forward,
    Pin,
    PinOff
} from "lucide-react";

const QUICK_REACTIONS = ["❤️", "😂", "👍", "🔥", "😮", "😢"];
import { api, extractErrorMessage } from "../../services/api.js";
import { pushBackHandler } from "../../services/backNavigation.js";
import "../../styles/msg-gestures.css";

const fmt = new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
});
const fmtTime = iso => {
    if (!iso) return "";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : fmt.format(d);
};

function InfoRow({ icon, label, time }) {
    return (
        <div className="sync-msginfo-row">
            <span className="sync-msginfo-icon">{icon}</span>
            <span className="sync-msginfo-label">{label}</span>
            <span className="sync-msginfo-time">{time || "—"}</span>
        </div>
    );
}

function PeopleList({ title, rows, icon }) {
    if (!rows.length) return null;
    return (
        <div className="sync-msginfo-group">
            <div className="sync-msginfo-group-title">
                {icon}
                {title}
            </div>
            {rows.map(r => (
                <div className="sync-msginfo-person" key={r.user._id}>
                    <span>{r.user.fullName || r.user.username || "Member"}</span>
                    <small>{fmtTime(r.at)}</small>
                </div>
            ))}
        </div>
    );
}

// মেসেজ টিপে ধরলে নিচ থেকে ওঠা মেনু: Reply · Message info (নিজের মেসেজে) · Delete for everyone (নিজের মেসেজে)
export default function MessageActionSheet({
    message,
    isMine,
    myId = "",
    isPinned = false,
    canEdit = false,
    canForward = true,
    canPin = true,
    preview,
    onClose,
    onReply,
    onReact,
    onEdit,
    onForward,
    onTogglePin,
    onDelete
}) {
    const myReaction = (message?.reactions || []).find(
        r => String(r.user?._id ?? r.user) === String(myId)
    )?.emoji;
    const [view, setView] = useState("menu"); // "menu" | "info"
    const [info, setInfo] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        const off = pushBackHandler(() => {
            if (view === "info") {
                setView("menu");
            } else {
                onClose?.();
            }
            return true;
        });
        const onKey = e => {
            if (e.key === "Escape") onClose?.();
        };
        window.addEventListener("keydown", onKey);
        return () => {
            off();
            window.removeEventListener("keydown", onKey);
        };
    }, [view, onClose]);

    const openInfo = async () => {
        setView("info");
        setLoading(true);
        setError("");
        try {
            const res = await api.get(`/api/v1/messages/${message._id}/info`);
            setInfo(res.data?.data || res.data);
        } catch (err) {
            setError(extractErrorMessage(err, "Could not load message info"));
        } finally {
            setLoading(false);
        }
    };

    const sentAt = info?.sentAt || message.createdAt;
    const firstDelivered = info?.deliveredTo?.[0]?.at;
    const firstSeen = info?.seenBy?.[0]?.at;

    return createPortal(
        <div
            className="sync-modal-backdrop sync-msgsheet-backdrop"
            role="presentation"
            onClick={() => onClose?.()}
        >
            <div
                className="sync-msgsheet"
                role="dialog"
                aria-modal="true"
                aria-label="Message options"
                onClick={e => e.stopPropagation()}
            >
                <div className="sync-msgsheet-grip" />

                {view === "menu" && (
                    <>
                        {onReact && (
                            <div
                                className="sync-react-bar"
                                role="group"
                                aria-label="Quick reactions"
                            >
                                {QUICK_REACTIONS.map(emoji => (
                                    <button
                                        key={emoji}
                                        type="button"
                                        className={`sync-react-emoji-btn ${
                                            myReaction === emoji ? "active" : ""
                                        }`}
                                        onClick={() => {
                                            onReact(emoji);
                                            onClose?.();
                                        }}
                                    >
                                        {emoji}
                                    </button>
                                ))}
                            </div>
                        )}
                        {preview && (
                            <div className="sync-msgsheet-preview">{preview}</div>
                        )}
                        <button
                            type="button"
                            className="sync-msgsheet-item"
                            onClick={() => {
                                onReply?.();
                                onClose?.();
                            }}
                        >
                            <Reply size={19} /> Reply
                        </button>
                        {canEdit && onEdit && (
                            <button
                                type="button"
                                className="sync-msgsheet-item"
                                onClick={() => {
                                    onEdit();
                                    onClose?.();
                                }}
                            >
                                <Pencil size={18} /> Edit message
                            </button>
                        )}
                        {canForward && onForward && (
                            <button
                                type="button"
                                className="sync-msgsheet-item"
                                onClick={() => {
                                    onForward();
                                    onClose?.();
                                }}
                            >
                                <Forward size={18} /> Forward
                            </button>
                        )}
                        {canPin && onTogglePin && (
                            <button
                                type="button"
                                className="sync-msgsheet-item"
                                onClick={() => {
                                    onTogglePin();
                                    onClose?.();
                                }}
                            >
                                {isPinned ? (
                                    <>
                                        <PinOff size={18} /> Unpin message
                                    </>
                                ) : (
                                    <>
                                        <Pin size={18} /> Pin message
                                    </>
                                )}
                            </button>
                        )}
                        {isMine && (
                            <button
                                type="button"
                                className="sync-msgsheet-item"
                                onClick={openInfo}
                            >
                                <Info size={19} /> Message info
                            </button>
                        )}
                        {isMine && (
                            <button
                                type="button"
                                className="sync-msgsheet-item danger"
                                onClick={() => {
                                    onClose?.();
                                    onDelete?.();
                                }}
                            >
                                <Trash2 size={19} /> Delete for everyone
                            </button>
                        )}
                    </>
                )}

                {view === "info" && (
                    <div className="sync-msginfo">
                        <button
                            type="button"
                            className="sync-msginfo-back"
                            onClick={() => setView("menu")}
                        >
                            <ChevronLeft size={18} /> Message info
                        </button>

                        {loading && (
                            <div className="sync-msginfo-loading">
                                <Loader2 size={18} className="spin" /> Loading...
                            </div>
                        )}
                        {error && <div className="sync-msginfo-error">{error}</div>}

                        {!loading && !error && (
                            <>
                                <InfoRow
                                    icon={<Check size={15} />}
                                    label="Sent"
                                    time={fmtTime(sentAt)}
                                />
                                {!info?.isGroup && (
                                    <>
                                        <InfoRow
                                            icon={<CheckCheck size={15} />}
                                            label="Delivered"
                                            time={fmtTime(firstDelivered || firstSeen)}
                                        />
                                        <InfoRow
                                            icon={
                                                <CheckCheck
                                                    size={15}
                                                    className="is-seen"
                                                />
                                            }
                                            label="Seen"
                                            time={fmtTime(firstSeen)}
                                        />
                                    </>
                                )}
                                {info?.isGroup && (
                                    <>
                                        <PeopleList
                                            title="Seen by"
                                            rows={info.seenBy || []}
                                            icon={
                                                <CheckCheck
                                                    size={15}
                                                    className="is-seen"
                                                />
                                            }
                                        />
                                        <PeopleList
                                            title="Delivered to"
                                            rows={(info.deliveredTo || []).filter(
                                                d =>
                                                    !(info.seenBy || []).some(
                                                        s => s.user._id === d.user._id
                                                    )
                                            )}
                                            icon={<CheckCheck size={15} />}
                                        />
                                    </>
                                )}
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>,
        document.body
    );
}
