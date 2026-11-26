import React, { useEffect, useMemo, useState } from "react";
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
    PinOff,
    Plus,
    SmilePlus
} from "lucide-react";
import Avatar from "../Avatar.jsx";
import PollIcon from "./PollIcon.jsx";
import { PollVotersList } from "./PollVoters.jsx";
import { QUICK_REACTIONS, EMOJI_CATEGORIES } from "./emojiData.js";
import { buildMemberMap, resolvePerson } from "./people.js";
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

function InfoRow({ icon, label, time, tone = "" }) {
    return (
        <div className={`sync-msginfo-row ${tone}`}>
            <span className="sync-msginfo-icon">{icon}</span>
            <span className="sync-msginfo-label">{label}</span>
            <span className="sync-msginfo-time">{time || "—"}</span>
        </div>
    );
}

function PeopleList({ title, rows, icon, map, myId }) {
    if (!rows.length) return null;
    return (
        <div className="sync-msginfo-group">
            <div className="sync-msginfo-group-title">
                {icon}
                {title}
                <span className="sync-msginfo-group-count">{rows.length}</span>
            </div>
            {rows.map(r => {
                const p = resolvePerson(r.user, map, myId);
                return (
                    <div className="sync-msginfo-person" key={p.id}>
                        <Avatar src={p.avatar} name={p.name} size={32} />
                        <span className="sync-msginfo-person-name">
                            {p.isMe ? "You" : p.name}
                        </span>
                        <small>{fmtTime(r.at)}</small>
                    </div>
                );
            })}
        </div>
    );
}

function SheetHeader({ title, icon, onBack }) {
    return (
        <div className="sync-sheet-title">
            <button
                type="button"
                className="sync-sheet-back"
                onClick={onBack}
                aria-label="Back"
            >
                <ChevronLeft size={20} />
            </button>
            {icon}
            <span>{title}</span>
        </div>
    );
}

// মেসেজ টিপে ধরলে নিচ থেকে ওঠা মেনু:
// রিয়্যাকশন বার (+ পূর্ণ ইমোজি পিকার) · Reply · Edit · Forward · Pin · Message info
// · কে কী রিয়্যাক্ট করেছে · পোলে কে কোন অপশনে ভোট দিয়েছে · Delete for everyone
export default function MessageActionSheet({
    message,
    isMine,
    myId = "",
    members = [],
    isPinned = false,
    canEdit = false,
    canForward = true,
    canPin = true,
    initialView = "menu",
    preview,
    onClose,
    onReply,
    onReact,
    onEdit,
    onForward,
    onTogglePin,
    onDelete
}) {
    const map = useMemo(() => buildMemberMap(members), [members]);
    const reactions = message?.reactions || [];
    const myReaction = reactions.find(
        r => String(r.user?._id ?? r.user) === String(myId)
    )?.emoji;
    const isPoll = message?.type === "poll" && message?.poll;
    const totalVotes = isPoll
        ? message.poll.options.reduce((n, o) => n + (o.votes?.length || 0), 0)
        : 0;

    // "menu" | "info" | "emoji" | "reactions" | "votes"
    const [view, setView] = useState(initialView);
    const [info, setInfo] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [catId, setCatId] = useState(EMOJI_CATEGORIES[0].id);
    const [rxTab, setRxTab] = useState("all");

    useEffect(() => {
        const off = pushBackHandler(() => {
            if (view !== "menu") {
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

    const react = emoji => {
        onReact?.(emoji);
        onClose?.();
    };

    const sentAt = info?.sentAt || message.createdAt;
    const firstDelivered = info?.deliveredTo?.[0]?.at;
    const firstSeen = info?.seenBy?.[0]?.at;

    // রিয়্যাকশন ট্যাব: All + প্রতিটি ইমোজি
    const rxGroups = useMemo(() => {
        const g = new Map();
        for (const r of reactions) {
            if (!g.has(r.emoji)) g.set(r.emoji, []);
            g.get(r.emoji).push(r);
        }
        return [...g.entries()];
    }, [reactions]);
    const rxRows =
        rxTab === "all" ? reactions : reactions.filter(r => r.emoji === rxTab);

    const barEmojis =
        myReaction && !QUICK_REACTIONS.includes(myReaction)
            ? [myReaction, ...QUICK_REACTIONS.slice(0, 5)]
            : QUICK_REACTIONS;
    const category =
        EMOJI_CATEGORIES.find(c => c.id === catId) || EMOJI_CATEGORIES[0];

    return createPortal(
        <div
            className="sync-modal-backdrop sync-msgsheet-backdrop"
            role="presentation"
            onClick={() => onClose?.()}
        >
            <div
                className={`sync-msgsheet ${
                    view !== "menu" ? "sync-msgsheet-tall" : ""
                }`}
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
                                className="sync-rx-bar"
                                role="group"
                                aria-label="Quick reactions"
                            >
                                {barEmojis.map(emoji => (
                                    <button
                                        key={emoji}
                                        type="button"
                                        className={`sync-rx-btn ${
                                            myReaction === emoji ? "active" : ""
                                        }`}
                                        onClick={() => react(emoji)}
                                    >
                                        {emoji}
                                    </button>
                                ))}
                                <button
                                    type="button"
                                    className="sync-rx-btn more"
                                    aria-label="More reactions"
                                    onClick={() => setView("emoji")}
                                >
                                    <Plus size={20} strokeWidth={2.4} />
                                </button>
                            </div>
                        )}
                        {preview && (
                            <div className="sync-msgsheet-preview">{preview}</div>
                        )}

                        <div className="sync-sheet-list">
                            <button
                                type="button"
                                className="sync-msgsheet-item"
                                onClick={() => {
                                    onReply?.();
                                    onClose?.();
                                }}
                            >
                                <span className="sync-sheet-ico">
                                    <Reply size={18} />
                                </span>
                                Reply
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
                                    <span className="sync-sheet-ico">
                                        <Pencil size={17} />
                                    </span>
                                    Edit message
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
                                    <span className="sync-sheet-ico">
                                        <Forward size={17} />
                                    </span>
                                    Forward
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
                                    <span className="sync-sheet-ico">
                                        {isPinned ? (
                                            <PinOff size={17} />
                                        ) : (
                                            <Pin size={17} />
                                        )}
                                    </span>
                                    {isPinned ? "Unpin message" : "Pin message"}
                                </button>
                            )}
                            {reactions.length > 0 && (
                                <button
                                    type="button"
                                    className="sync-msgsheet-item"
                                    onClick={() => {
                                        setRxTab("all");
                                        setView("reactions");
                                    }}
                                >
                                    <span className="sync-sheet-ico">
                                        <SmilePlus size={18} />
                                    </span>
                                    Reactions
                                    <span className="sync-sheet-badge">
                                        {reactions.length}
                                    </span>
                                </button>
                            )}
                            {isPoll && (
                                <button
                                    type="button"
                                    className="sync-msgsheet-item"
                                    onClick={() => setView("votes")}
                                >
                                    <span className="sync-sheet-ico">
                                        <PollIcon size={18} />
                                    </span>
                                    Who voted
                                    <span className="sync-sheet-badge">
                                        {totalVotes}
                                    </span>
                                </button>
                            )}
                            {isMine && (
                                <button
                                    type="button"
                                    className="sync-msgsheet-item"
                                    onClick={openInfo}
                                >
                                    <span className="sync-sheet-ico">
                                        <Info size={18} />
                                    </span>
                                    Message info
                                </button>
                            )}
                        </div>

                        {isMine && (
                            <div className="sync-sheet-list danger-zone">
                                <button
                                    type="button"
                                    className="sync-msgsheet-item danger"
                                    onClick={() => {
                                        onClose?.();
                                        onDelete?.();
                                    }}
                                >
                                    <span className="sync-sheet-ico">
                                        <Trash2 size={18} />
                                    </span>
                                    Delete for everyone
                                </button>
                            </div>
                        )}
                    </>
                )}

                {view === "emoji" && (
                    <>
                        <SheetHeader
                            title="Choose reaction"
                            icon={<SmilePlus size={17} />}
                            onBack={() => setView("menu")}
                        />
                        <div className="sync-emoji-cats" role="tablist">
                            {EMOJI_CATEGORIES.map(c => (
                                <button
                                    key={c.id}
                                    type="button"
                                    role="tab"
                                    aria-selected={c.id === catId}
                                    aria-label={c.label}
                                    className={`sync-emoji-cat ${
                                        c.id === catId ? "active" : ""
                                    }`}
                                    onClick={() => setCatId(c.id)}
                                >
                                    {c.icon}
                                </button>
                            ))}
                        </div>
                        <div className="sync-emoji-label">{category.label}</div>
                        <div className="sync-emoji-grid sync-sheet-scroll">
                            {category.emojis.map(emoji => (
                                <button
                                    key={emoji}
                                    type="button"
                                    className={`sync-emoji-cell ${
                                        myReaction === emoji ? "active" : ""
                                    }`}
                                    onClick={() => react(emoji)}
                                >
                                    {emoji}
                                </button>
                            ))}
                        </div>
                    </>
                )}

                {view === "reactions" && (
                    <>
                        <SheetHeader
                            title="Reactions"
                            icon={<SmilePlus size={17} />}
                            onBack={() => setView("menu")}
                        />
                        <div className="sync-rx-tabs">
                            <button
                                type="button"
                                className={`sync-rx-tab ${
                                    rxTab === "all" ? "active" : ""
                                }`}
                                onClick={() => setRxTab("all")}
                            >
                                All {reactions.length}
                            </button>
                            {rxGroups.map(([emoji, rows]) => (
                                <button
                                    key={emoji}
                                    type="button"
                                    className={`sync-rx-tab ${
                                        rxTab === emoji ? "active" : ""
                                    }`}
                                    onClick={() => setRxTab(emoji)}
                                >
                                    {emoji} {rows.length}
                                </button>
                            ))}
                        </div>
                        <div className="sync-sheet-scroll">
                            {rxRows.length === 0 && (
                                <div className="sync-voters-empty">
                                    No reactions
                                </div>
                            )}
                            {rxRows.map(r => {
                                const p = resolvePerson(r.user, map, myId);
                                return (
                                    <button
                                        type="button"
                                        key={`${p.id}-${r.emoji}`}
                                        className="sync-rx-person"
                                        disabled={!p.isMe}
                                        onClick={() => p.isMe && react(r.emoji)}
                                    >
                                        <Avatar
                                            src={p.avatar}
                                            name={p.name}
                                            size={38}
                                        />
                                        <span className="sync-rx-person-meta">
                                            <strong>
                                                {p.isMe ? "You" : p.name}
                                            </strong>
                                            <small>
                                                {p.isMe
                                                    ? "Tap to remove"
                                                    : p.username
                                                      ? `@${p.username}`
                                                      : ""}
                                            </small>
                                        </span>
                                        <span className="sync-rx-person-emoji">
                                            {r.emoji}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </>
                )}

                {view === "votes" && isPoll && (
                    <>
                        <SheetHeader
                            title="Poll votes"
                            icon={<PollIcon size={17} />}
                            onBack={() => setView("menu")}
                        />
                        <div className="sync-sheet-scroll">
                            <PollVotersList
                                poll={message.poll}
                                members={members}
                                myId={myId}
                            />
                        </div>
                    </>
                )}

                {view === "info" && (
                    <div className="sync-msginfo">
                        <SheetHeader
                            title="Message info"
                            icon={<Info size={17} />}
                            onBack={() => setView("menu")}
                        />
                        {preview && (
                            <div className="sync-msgsheet-preview">{preview}</div>
                        )}

                        {loading && (
                            <div className="sync-msginfo-loading">
                                <Loader2 size={18} className="spin" /> Loading...
                            </div>
                        )}
                        {error && <div className="sync-msginfo-error">{error}</div>}

                        {!loading && !error && (
                            <div className="sync-sheet-scroll">
                                <div className="sync-msginfo-card">
                                    <InfoRow
                                        icon={<Check size={16} />}
                                        label="Sent"
                                        time={fmtTime(sentAt)}
                                    />
                                    {!info?.isGroup && (
                                        <>
                                            <InfoRow
                                                icon={<CheckCheck size={16} />}
                                                label="Delivered"
                                                time={fmtTime(
                                                    firstDelivered || firstSeen
                                                )}
                                            />
                                            <InfoRow
                                                icon={
                                                    <CheckCheck
                                                        size={16}
                                                        className="is-seen"
                                                    />
                                                }
                                                label="Seen"
                                                time={fmtTime(firstSeen)}
                                                tone="seen"
                                            />
                                        </>
                                    )}
                                </div>
                                {info?.isGroup && (
                                    <>
                                        <PeopleList
                                            title="Seen by"
                                            rows={info.seenBy || []}
                                            map={map}
                                            myId={myId}
                                            icon={
                                                <CheckCheck
                                                    size={16}
                                                    className="is-seen"
                                                />
                                            }
                                        />
                                        <PeopleList
                                            title="Delivered to"
                                            rows={(info.deliveredTo || []).filter(
                                                d =>
                                                    !(info.seenBy || []).some(
                                                        s =>
                                                            s.user._id ===
                                                            d.user._id
                                                    )
                                            )}
                                            map={map}
                                            myId={myId}
                                            icon={<CheckCheck size={16} />}
                                        />
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>,
        document.body
    );
}
