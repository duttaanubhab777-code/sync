import React, { useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { X, Search, Send, CheckCircle2 } from "lucide-react";
import Avatar from "../Avatar.jsx";
import VerifiedBadge from "../VerifiedBadge.jsx";
import { api, extractErrorMessage } from "../../services/api.js";

/**
 * এক চ্যাট থেকে সর্বোচ্চ ৫টি অন্য চ্যাট/গ্রুপে মেসেজ ফরওয়ার্ড করার মডাল
 */
export default function ForwardModal({ message, onClose, onForwarded }) {
    const conversations = useSelector(state => state.chat.conversations);
    const currentUser = useSelector(state => state.auth.user);
    const myId = String(currentUser?._id || "");

    const [query, setQuery] = useState("");
    const [selectedIds, setSelectedIds] = useState([]);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState("");

    const eligible = useMemo(() => {
        const q = query.trim().toLowerCase();
        return conversations.filter(c => {
            // read-only অফিশিয়াল Sync অ্যাকাউন্টে ফরওয়ার্ড করা যাবে না
            if (c.type === "direct" && c.partner?.isOfficial) return false;
            if (
                c.type === "group" &&
                c.onlyAdminCanMessage &&
                !(c.admins || []).some(a => String(a) === myId)
            ) {
                return false;
            }
            const title =
                c.type === "group"
                    ? c.groupName || "Group"
                    : c.partner?.fullName || c.partner?.username || "User";
            if (!q) return true;
            return title.toLowerCase().includes(q);
        });
    }, [conversations, query, myId]);

    const toggle = id => {
        setSelectedIds(prev => {
            if (prev.includes(id)) return prev.filter(x => x !== id);
            if (prev.length >= 5) return prev;
            return [...prev, id];
        });
    };

    const handleForward = async () => {
        if (!message?._id || selectedIds.length === 0) return;
        setSending(true);
        setError("");
        try {
            const res = await api.post(`/api/v1/messages/${message._id}/forward`, {
                targetConversationIds: selectedIds
            });
            onForwarded?.(res.data?.message || "Message forwarded");
            onClose?.();
        } catch (err) {
            setError(extractErrorMessage(err, "Could not forward message"));
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="sync-modal-backdrop" onClick={onClose}>
            <div
                className="sync-modal-card"
                onClick={e => e.stopPropagation()}
            >
                <div className="sync-modal-header">
                    <h3>Forward Message</h3>
                    <button
                        type="button"
                        className="sync-icon-btn"
                        onClick={onClose}
                    >
                        <X size={19} />
                    </button>
                </div>

                <div className="sync-modal-body">
                    <div className="sync-search-input-wrap">
                        <Search size={16} />
                        <input
                            type="text"
                            placeholder="Search chats or groups..."
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            autoFocus
                        />
                    </div>

                    {error && <div className="sync-alert error">{error}</div>}

                    <div className="sync-user-results compact">
                        {eligible.length === 0 && (
                            <div className="sync-empty-hint">
                                No matching chats found.
                            </div>
                        )}
                        {eligible.map(c => {
                            const id = String(c._id);
                            const isGroup = c.type === "group";
                            const title = isGroup
                                ? c.groupName || "Group"
                                : c.partner?.fullName ||
                                  c.partner?.username ||
                                  "User";
                            const avatar = isGroup
                                ? c.groupIcon || ""
                                : c.partner?.avatar || "";
                            const isSelected = selectedIds.includes(id);

                            return (
                                <div
                                    key={id}
                                    className={`sync-user-row clickable ${
                                        isSelected ? "selected" : ""
                                    }`}
                                    onClick={() => toggle(id)}
                                >
                                    <Avatar
                                        src={avatar}
                                        name={title}
                                        size={38}
                                        isGroup={isGroup}
                                    />
                                    <div className="sync-user-meta">
                                        <div className="sync-user-name sync-name-with-badge">
                                            <span className="sync-name-text">
                                                {title}
                                            </span>
                                            {isGroup && c.isOfficial && (
                                                <VerifiedBadge
                                                    variant="group"
                                                    size={14}
                                                />
                                            )}
                                        </div>
                                        <div className="sync-user-sub">
                                            {isGroup
                                                ? `${(c.members || []).length} members`
                                                : `@${c.partner?.username || ""}`}
                                        </div>
                                    </div>
                                    <CheckCircle2
                                        size={18}
                                        className={
                                            isSelected
                                                ? "chip-check active"
                                                : "chip-check"
                                        }
                                    />
                                </div>
                            );
                        })}
                    </div>

                    <div className="sync-modal-footer">
                        <button
                            type="button"
                            className="sync-btn ghost"
                            onClick={onClose}
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            className="sync-btn primary"
                            disabled={selectedIds.length === 0 || sending}
                            onClick={handleForward}
                        >
                            <Send size={15} />
                            <span>
                                {sending
                                    ? "Forwarding..."
                                    : `Forward (${selectedIds.length}/5)`}
                            </span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
