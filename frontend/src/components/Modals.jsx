import React, { useState, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
    X,
    Search,
    Users,
    UserPlus,
    Shield,
    ShieldOff,
    UserMinus,
    LogOut,
    Ban,
    CheckCircle2,
    Camera,
    Loader2,
    Lock,
    Mail,
    Phone,
    AtSign,
    UserRound,
    Pin,
    PinOff,
    BellOff,
    Bell,
    FileText,
    Link2,
    ExternalLink
} from "lucide-react";
import Avatar from "./Avatar.jsx";
import VerifiedBadge from "./VerifiedBadge.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import ContactMatches from "./ContactMatches.jsx";
import useContactMatches from "../hooks/useContactMatches.js";
import { api, extractErrorMessage } from "../services/api.js";
import {
    createGroupChat,
    leaveGroupChat,
    startDirectChat,
    updateConversationPreferences,
    updateGroupDetails,
    updateGroupMember
} from "../store/chatSlice.js";
import { blockUserById, unblockUserById } from "../store/authSlice.js";
import { uploadMediaToCloudinary } from "../services/media.js";
import { formatLastSeen } from "../utils/format.js";

export function NewDirectChatModal({ onClose, onChatReady }) {
    const dispatch = useDispatch();
    const [query, setQuery] = useState("");
    const [results, setResults] = useState([]);
    const [searching, setSearching] = useState(false);
    const [error, setError] = useState("");
    const [startingId, setStartingId] = useState(null);
    const contacts = useContactMatches();

    useEffect(() => {
        const trimmed = query.trim();
        if (trimmed.length < 2) {
            setResults([]);
            setError("");
            return;
        }
        const timer = setTimeout(async () => {
            setSearching(true);
            setError("");
            try {
                const res = await api.get(
                    `/api/v1/users?search=${encodeURIComponent(trimmed)}`
                );
                setResults(res.data?.data || []);
            } catch (err) {
                setError(extractErrorMessage(err, "Search failed"));
            } finally {
                setSearching(false);
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [query]);

    const handleSelectUser = async userId => {
        setStartingId(userId);
        setError("");
        try {
            const conv = await dispatch(startDirectChat(userId)).unwrap();
            onChatReady?.(conv);
            onClose();
        } catch (err) {
            setError(typeof err === "string" ? err : "Could not start chat");
        } finally {
            setStartingId(null);
        }
    };

    return (
        <div className="sync-modal-backdrop" onClick={onClose}>
            <div
                className="sync-modal-card"
                onClick={e => e.stopPropagation()}
            >
                <div className="sync-modal-header">
                    <h3>New Direct Chat</h3>
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
                        <Search size={17} />
                        <input
                            type="text"
                            placeholder="Search by username, name or 10-digit phone..."
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            autoFocus
                        />
                    </div>

                    {error && <div className="sync-alert error">{error}</div>}

                    <div className="sync-user-results">
                        {searching && (
                            <div className="sync-empty-hint">
                                <Loader2 size={18} className="spin" /> Searching
                                users...
                            </div>
                        )}
                        {!searching &&
                            query.trim().length >= 2 &&
                            results.length === 0 && (
                                <div className="sync-empty-hint">
                                    No users found matching "{query}"
                                </div>
                            )}
                        {!searching && query.trim().length < 2 && (
                            <>
                                <ContactMatches
                                    contacts={contacts}
                                    onPick={u => handleSelectUser(u._id)}
                                    busyId={startingId}
                                />
                                <div className="sync-empty-hint">
                                    Or type at least 2 characters to search
                                    users
                                </div>
                            </>
                        )}

                        {results.map(u => (
                            <div key={u._id} className="sync-user-row">
                                <Avatar
                                    src={u.avatar}
                                    name={u.fullName || u.username}
                                    size={42}
                                    showOnline
                                    online={u.online}
                                />
                                <div className="sync-user-meta">
                                    <div className="sync-user-name">
                                        {u.fullName}
                                    </div>
                                    <div className="sync-user-sub">
                                        @{u.username} · {u.about || "Using Sync"}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    className="sync-btn primary sm"
                                    disabled={startingId === u._id}
                                    onClick={() => handleSelectUser(u._id)}
                                >
                                    {startingId === u._id
                                        ? "Opening..."
                                        : "Message"}
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

export function NewGroupChatModal({ onClose, onGroupReady }) {
    const dispatch = useDispatch();
    const [groupName, setGroupName] = useState("");
    const [groupDescription, setGroupDescription] = useState("");
    const [groupIcon, setGroupIcon] = useState("");
    const [uploadingIcon, setUploadingIcon] = useState(false);

    const [query, setQuery] = useState("");
    const [results, setResults] = useState([]);
    const [selectedUsers, setSelectedUsers] = useState([]);
    const contacts = useContactMatches();
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        const trimmed = query.trim();
        if (trimmed.length < 2) {
            setResults([]);
            return;
        }
        const timer = setTimeout(async () => {
            try {
                const res = await api.get(
                    `/api/v1/users?search=${encodeURIComponent(trimmed)}`
                );
                setResults(res.data?.data || []);
            } catch {
                // ignore
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [query]);

    const toggleMember = user => {
        setSelectedUsers(prev => {
            const exists = prev.some(u => u._id === user._id);
            if (exists) return prev.filter(u => u._id !== user._id);
            return [...prev, user];
        });
    };

    const handleIconUpload = async e => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploadingIcon(true);
        setError("");
        try {
            const uploaded = await uploadMediaToCloudinary(file, undefined, {
                purpose: "group",
                compress: true
            });
            setGroupIcon(uploaded.url);
        } catch (err) {
            setError(err.message || "Icon upload failed");
        } finally {
            setUploadingIcon(false);
        }
    };

    const handleCreate = async e => {
        e.preventDefault();
        if (!groupName.trim()) {
            setError("Group name is required");
            return;
        }
        if (selectedUsers.length === 0) {
            setError("Add at least one member to create a group");
            return;
        }
        setSubmitting(true);
        setError("");
        try {
            const conv = await dispatch(
                createGroupChat({
                    groupName: groupName.trim(),
                    groupDescription: groupDescription.trim(),
                    groupIcon,
                    memberIds: selectedUsers.map(u => u._id)
                })
            ).unwrap();
            onGroupReady?.(conv);
            onClose();
        } catch (err) {
            setError(typeof err === "string" ? err : "Could not create group");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="sync-modal-backdrop" onClick={onClose}>
            <div
                className="sync-modal-card"
                onClick={e => e.stopPropagation()}
            >
                <div className="sync-modal-header">
                    <h3>Create New Group</h3>
                    <button
                        type="button"
                        className="sync-icon-btn"
                        onClick={onClose}
                    >
                        <X size={19} />
                    </button>
                </div>

                <form className="sync-modal-body" onSubmit={handleCreate}>
                    <div className="sync-group-icon-picker">
                        <Avatar
                            src={groupIcon}
                            name={groupName || "G"}
                            size={56}
                            isGroup
                        />
                        <label className="sync-btn secondary sm">
                            <Camera size={15} />
                            <span>
                                {uploadingIcon ? "Uploading..." : "Group Icon"}
                            </span>
                            <input
                                type="file"
                                accept="image/*"
                                hidden
                                onChange={handleIconUpload}
                                disabled={uploadingIcon}
                            />
                        </label>
                    </div>

                    <div className="sync-field">
                        <label>Group Name *</label>
                        <input
                            type="text"
                            placeholder="e.g. Project Sync Team"
                            maxLength={100}
                            value={groupName}
                            onChange={e => setGroupName(e.target.value)}
                            required
                        />
                    </div>

                    <div className="sync-field">
                        <label>Group Description</label>
                        <input
                            type="text"
                            placeholder="Optional group description..."
                            maxLength={500}
                            value={groupDescription}
                            onChange={e => setGroupDescription(e.target.value)}
                        />
                    </div>

                    {selectedUsers.length > 0 && (
                        <div className="sync-chip-list">
                            {selectedUsers.map(u => (
                                <span key={u._id} className="sync-user-chip">
                                    {u.fullName}
                                    <button
                                        type="button"
                                        onClick={() => toggleMember(u)}
                                    >
                                        ×
                                    </button>
                                </span>
                            ))}
                        </div>
                    )}

                    <div className="sync-search-input-wrap">
                        <Search size={17} />
                        <input
                            type="text"
                            placeholder="Search users to add..."
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                        />
                    </div>

                    {error && <div className="sync-alert error">{error}</div>}

                    <div className="sync-user-results compact">
                        {query.trim().length < 2 && (
                            <ContactMatches
                                contacts={contacts}
                                onPick={toggleMember}
                                selectedIds={
                                    new Set(selectedUsers.map(u => u._id))
                                }
                            />
                        )}
                        {results.map(u => {
                            const isSelected = selectedUsers.some(
                                s => s._id === u._id
                            );
                            return (
                                <div
                                    key={u._id}
                                    className={`sync-user-row clickable ${isSelected ? "selected" : ""}`}
                                    onClick={() => toggleMember(u)}
                                >
                                    <Avatar
                                        src={u.avatar}
                                        name={u.fullName}
                                        size={36}
                                    />
                                    <div className="sync-user-meta">
                                        <div className="sync-user-name">
                                            {u.fullName}
                                        </div>
                                        <div className="sync-user-sub">
                                            @{u.username}
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
                            type="submit"
                            className="sync-btn primary"
                            disabled={submitting || uploadingIcon}
                        >
                            {submitting
                                ? "Creating..."
                                : `Create Group (${selectedUsers.length})`}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export function ChatInfoDrawer({ conversation, onClose }) {
    const dispatch = useDispatch();
    const currentUser = useSelector(state => state.auth.user);
    const onlineUsers = useSelector(state => state.chat.onlineUsers);

    const isGroup = conversation?.type === "group";
    const myId = String(currentUser?._id || "");
    const isAdmin =
        isGroup &&
        (conversation.admins || []).some(a => String(a) === myId);

    const [confirmLeave, setConfirmLeave] = useState(false);
    const [leavingGroup, setLeavingGroup] = useState(false);
    const [partnerProfile, setPartnerProfile] = useState(null);
    const [groupName, setGroupName] = useState(conversation?.groupName || "");
    const [groupDescription, setGroupDescription] = useState(
        conversation?.groupDescription || ""
    );
    const [onlyAdminCanMessage, setOnlyAdminCanMessage] = useState(
        Boolean(conversation?.onlyAdminCanMessage)
    );
    const [savingGroup, setSavingGroup] = useState(false);
    const [addQuery, setAddQuery] = useState("");
    const [addResults, setAddResults] = useState([]);
    const [feedback, setFeedback] = useState("");
    const [error, setError] = useState("");
    const [prefBusy, setPrefBusy] = useState(false);
    const [sharedTab, setSharedTab] = useState("media");
    const [sharedItems, setSharedItems] = useState([]);
    const [sharedLoading, setSharedLoading] = useState(false);

    useEffect(() => {
        if (!conversation?._id) return;
        let active = true;
        setSharedLoading(true);
        api.get(
            `/api/v1/chats/${conversation._id}/media?tab=${sharedTab}`
        )
            .then(res => {
                if (active) setSharedItems(res.data?.data?.items || []);
            })
            .catch(() => {
                if (active) setSharedItems([]);
            })
            .finally(() => {
                if (active) setSharedLoading(false);
            });
        return () => {
            active = false;
        };
    }, [conversation?._id, sharedTab]);

    useEffect(() => {
        setGroupName(conversation?.groupName || "");
        setGroupDescription(conversation?.groupDescription || "");
        setOnlyAdminCanMessage(Boolean(conversation?.onlyAdminCanMessage));
    }, [conversation]);

    useEffect(() => {
        if (!conversation || isGroup || !conversation.partner?._id) return;
        let active = true;
        api.get(`/api/v1/users/${conversation.partner._id}`)
            .then(res => {
                if (active) setPartnerProfile(res.data?.data || null);
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, [conversation, isGroup]);

    useEffect(() => {
        if (!isAdmin) return;
        const trimmed = addQuery.trim();
        if (trimmed.length < 2) {
            setAddResults([]);
            return;
        }
        const timer = setTimeout(async () => {
            try {
                const res = await api.get(
                    `/api/v1/users?search=${encodeURIComponent(trimmed)}`
                );
                const memberSet = new Set(
                    (conversation.members || []).map(m => String(m._id || m))
                );
                setAddResults(
                    (res.data?.data || []).filter(
                        u => !memberSet.has(String(u._id))
                    )
                );
            } catch {
                // ignore
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [addQuery, isAdmin, conversation]);

    if (!conversation) return null;

    const handleSaveGroup = async e => {
        e.preventDefault();
        setSavingGroup(true);
        setError("");
        setFeedback("");
        try {
            await dispatch(
                updateGroupDetails({
                    conversationId: conversation._id,
                    groupName: groupName.trim(),
                    groupDescription: groupDescription.trim(),
                    onlyAdminCanMessage
                })
            ).unwrap();
            setFeedback("Group settings updated");
        } catch (err) {
            setError(typeof err === "string" ? err : "Update failed");
        } finally {
            setSavingGroup(false);
        }
    };

    const handleGroupIconChange = async e => {
        const file = e.target.files?.[0];
        if (!file) return;
        setSavingGroup(true);
        setError("");
        try {
            const media = await uploadMediaToCloudinary(file, undefined, {
                purpose: "group",
                compress: true
            });
            await dispatch(
                updateGroupDetails({
                    conversationId: conversation._id,
                    groupIcon: media.url
                })
            ).unwrap();
            setFeedback("Group icon updated");
        } catch (err) {
            setError(err.message || "Failed to update group icon");
        } finally {
            setSavingGroup(false);
        }
    };

    const handleMemberAction = async (action, targetUserId) => {
        setError("");
        setFeedback("");
        try {
            await dispatch(
                updateGroupMember({
                    conversationId: conversation._id,
                    action,
                    targetUserId
                })
            ).unwrap();
            setAddQuery("");
            setAddResults([]);
        } catch (err) {
            setError(typeof err === "string" ? err : "Action failed");
        }
    };

    const handleTogglePreference = async patchObj => {
        setPrefBusy(true);
        setError("");
        try {
            await dispatch(
                updateConversationPreferences({
                    conversationId: conversation._id,
                    ...patchObj
                })
            ).unwrap();
        } catch (err) {
            setError(
                typeof err === "string" ? err : "Could not update preference"
            );
        } finally {
            setPrefBusy(false);
        }
    };

    const handleLeaveGroup = () => setConfirmLeave(true);

    const handleConfirmLeaveGroup = async () => {
        setLeavingGroup(true);
        try {
            await dispatch(leaveGroupChat(conversation._id)).unwrap();
            setConfirmLeave(false);
            onClose();
        } catch (err) {
            setConfirmLeave(false);
            setError(typeof err === "string" ? err : "Could not leave group");
        } finally {
            setLeavingGroup(false);
        }
    };

    const handleToggleBlock = async () => {
        const partnerId = conversation.partner?._id;
        if (!partnerId) return;
        setError("");
        try {
            if (partnerProfile?.blockedByMe) {
                await dispatch(unblockUserById(partnerId)).unwrap();
                setPartnerProfile(prev =>
                    prev ? { ...prev, blockedByMe: false } : prev
                );
            } else {
                await dispatch(blockUserById(partnerId)).unwrap();
                setPartnerProfile(prev =>
                    prev ? { ...prev, blockedByMe: true } : prev
                );
            }
        } catch (err) {
            setError(typeof err === "string" ? err : "Block action failed");
        }
    };

    const partner = partnerProfile || conversation.partner || {};
    const isOfficialGroup = isGroup && Boolean(conversation.isOfficial);
    const isOfficialAccount = !isGroup && Boolean(partner.isOfficial);
    const partnerOnline = isOfficialAccount
        ? false
        : Boolean(onlineUsers[String(partner._id)] ?? partner.online);

    return (
        <aside className="sync-info-drawer">
            <div className="sync-drawer-header">
                <h4>{isGroup ? "Group Info" : "Contact Info"}</h4>
                <button
                    type="button"
                    className="sync-icon-btn"
                    onClick={onClose}
                >
                    <X size={19} />
                </button>
            </div>

            <div className="sync-drawer-body">
                <div className="sync-drawer-hero">
                    <Avatar
                        src={isGroup ? conversation.groupIcon : partner.avatar}
                        name={
                            isGroup
                                ? conversation.groupName
                                : partner.fullName || partner.username
                        }
                        size={84}
                        isGroup={isGroup}
                        showOnline={!isGroup && !isOfficialAccount}
                        online={partnerOnline}
                    />
                    {isGroup && isAdmin && !isOfficialGroup && (
                        <label className="sync-btn secondary sm mt-2">
                            <Camera size={14} />
                            <span>Change Icon</span>
                            <input
                                type="file"
                                accept="image/*"
                                hidden
                                onChange={handleGroupIconChange}
                            />
                        </label>
                    )}
                    <h3 className="sync-drawer-title sync-name-with-badge">
                        <span className="sync-name-text">
                            {isGroup
                                ? conversation.groupName
                                : partner.fullName || "Unknown User"}
                        </span>
                        {isOfficialGroup && (
                            <VerifiedBadge variant="group" size={18} />
                        )}
                        {isOfficialAccount && (
                            <VerifiedBadge variant="official" size={18} />
                        )}
                    </h3>
                    <p className="sync-drawer-subtitle">
                        {isGroup
                            ? `${
                                  isOfficialGroup ? "Official Group" : "Group"
                              } · ${(conversation.members || []).length} members`
                            : isOfficialAccount
                              ? `@${partner.username || "sync"} · Official Account`
                              : `@${partner.username || ""} · ${
                                    partnerOnline
                                        ? "Online"
                                        : formatLastSeen(partner.lastSeen)
                                }`}
                    </p>
                </div>

                {error && <div className="sync-alert error">{error}</div>}
                {feedback && (
                    <div className="sync-alert success">{feedback}</div>
                )}

                <div className="sync-drawer-section">
                    <div className="sync-pref-actions">
                        <button
                            type="button"
                            className={`sync-pref-btn ${
                                conversation.isPinned ? "active" : ""
                            }`}
                            disabled={prefBusy}
                            onClick={() =>
                                handleTogglePreference({
                                    pinned: !conversation.isPinned
                                })
                            }
                        >
                            {conversation.isPinned ? (
                                <PinOff size={15} />
                            ) : (
                                <Pin size={15} />
                            )}
                            <span>
                                {conversation.isPinned ? "Unpin Chat" : "Pin Chat"}
                            </span>
                        </button>
                        <button
                            type="button"
                            className={`sync-pref-btn ${
                                conversation.isMuted ? "active" : ""
                            }`}
                            disabled={prefBusy}
                            onClick={() =>
                                handleTogglePreference({
                                    muted: !conversation.isMuted
                                })
                            }
                        >
                            {conversation.isMuted ? (
                                <Bell size={15} />
                            ) : (
                                <BellOff size={15} />
                            )}
                            <span>
                                {conversation.isMuted ? "Unmute" : "Mute"}
                            </span>
                        </button>
                    </div>
                </div>

                <div className="sync-drawer-section">
                    <span className="sync-section-label">
                        Shared Media, Docs &amp; Links
                    </span>
                    <div className="sync-shared-tabs">
                        {[
                            { id: "media", label: "Media" },
                            { id: "files", label: "Docs" },
                            { id: "links", label: "Links" }
                        ].map(t => (
                            <button
                                key={t.id}
                                type="button"
                                className={`sync-shared-tab ${
                                    sharedTab === t.id ? "active" : ""
                                }`}
                                onClick={() => setSharedTab(t.id)}
                            >
                                {t.label}
                            </button>
                        ))}
                    </div>
                    {sharedLoading ? (
                        <div className="sync-empty-hint">
                            <Loader2 size={16} className="spin" /> Loading...
                        </div>
                    ) : sharedItems.length === 0 ? (
                        <div className="sync-empty-hint">
                            No shared {sharedTab} yet.
                        </div>
                    ) : sharedTab === "media" ? (
                        <div className="sync-shared-media-grid">
                            {sharedItems.map(item => (
                                <a
                                    key={item._id}
                                    href={item.media?.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="sync-shared-thumb"
                                >
                                    {item.type === "video" ? (
                                        <>
                                            <video
                                                src={item.media?.url}
                                                muted
                                                preload="metadata"
                                            />
                                            <span className="sync-shared-video-badge">
                                                Video
                                            </span>
                                        </>
                                    ) : (
                                        <img
                                            src={item.media?.url}
                                            alt="Shared media"
                                            loading="lazy"
                                        />
                                    )}
                                </a>
                            ))}
                        </div>
                    ) : sharedTab === "files" ? (
                        <div className="sync-shared-list">
                            {sharedItems.map(item => (
                                <a
                                    key={item._id}
                                    href={item.media?.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="sync-shared-row"
                                >
                                    <FileText size={16} />
                                    <div className="sync-shared-row-meta">
                                        <strong>
                                            {item.media?.fileName || "Document"}
                                        </strong>
                                        <small>
                                            {item.sender?.fullName ||
                                                item.sender?.username ||
                                                "Member"}
                                        </small>
                                    </div>
                                    <ExternalLink size={14} />
                                </a>
                            ))}
                        </div>
                    ) : (
                        <div className="sync-shared-list">
                            {sharedItems.map(item => (
                                <a
                                    key={item._id}
                                    href={item.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="sync-shared-row"
                                >
                                    <Link2 size={16} />
                                    <div className="sync-shared-row-meta">
                                        <strong>{item.host}</strong>
                                        <small>{item.url}</small>
                                    </div>
                                    <ExternalLink size={14} />
                                </a>
                            ))}
                        </div>
                    )}
                </div>

                {!isGroup ? (
                    <>
                        <div className="sync-drawer-section">
                            <span className="sync-section-label">
                                Contact details
                            </span>
                            <div className="sync-detail-list">
                                <div className="sync-detail-row">
                                    <UserRound size={18} />
                                    <div className="sync-detail-text">
                                        <small>Full name</small>
                                        <span>{partner.fullName || "—"}</span>
                                    </div>
                                </div>
                                <div className="sync-detail-row">
                                    <AtSign size={18} />
                                    <div className="sync-detail-text">
                                        <small>Username</small>
                                        <span>
                                            {partner.username
                                                ? `@${partner.username}`
                                                : "—"}
                                        </span>
                                    </div>
                                </div>
                                {!isOfficialAccount && (
                                    <>
                                        <div className="sync-detail-row">
                                            <Phone size={18} />
                                            <div className="sync-detail-text">
                                                <small>Phone</small>
                                                <span>
                                                    {partner.phoneNumber
                                                        ? `+91 ${partner.phoneNumber}`
                                                        : "—"}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="sync-detail-row">
                                            <Mail size={18} />
                                            <div className="sync-detail-text">
                                                <small>Email</small>
                                                <span>
                                                    {partner.email || "—"}
                                                </span>
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>

                        <div className="sync-drawer-section">
                            <span className="sync-section-label">About</span>
                            <p className="sync-about-text">
                                {partner.about || "Hello ! I am using Sync 😃"}
                            </p>
                        </div>

                        {isOfficialAccount ? (
                            <div className="sync-drawer-section">
                                <div className="sync-official-note">
                                    <VerifiedBadge
                                        variant="official"
                                        size={16}
                                    />
                                    <span>
                                        This is the official Sync system account
                                        for welcome messages and platform
                                        updates.
                                    </span>
                                </div>
                            </div>
                        ) : (
                            <div className="sync-drawer-section">
                                <button
                                    type="button"
                                    className={`sync-btn full ${
                                        partnerProfile?.blockedByMe
                                            ? "secondary"
                                            : "danger"
                                    }`}
                                    onClick={handleToggleBlock}
                                >
                                    <Ban size={16} />
                                    <span>
                                        {partnerProfile?.blockedByMe
                                            ? "Unblock User"
                                            : "Block User"}
                                    </span>
                                </button>
                            </div>
                        )}
                    </>
                ) : (
                    <>
                        {isAdmin ? (
                            <form
                                className="sync-drawer-section"
                                onSubmit={handleSaveGroup}
                            >
                                <span className="sync-section-label">
                                    Group Settings (Group Admin)
                                </span>
                                {!isOfficialGroup && (
                                    <div className="sync-field">
                                        <label>Group Name</label>
                                        <input
                                            type="text"
                                            value={groupName}
                                            onChange={e =>
                                                setGroupName(e.target.value)
                                            }
                                            required
                                        />
                                    </div>
                                )}
                                <div className="sync-field">
                                    <label>Description</label>
                                    <textarea
                                        rows={2}
                                        value={groupDescription}
                                        onChange={e =>
                                            setGroupDescription(e.target.value)
                                        }
                                    />
                                </div>
                                <label className="sync-checkbox-row">
                                    <input
                                        type="checkbox"
                                        checked={onlyAdminCanMessage}
                                        onChange={e =>
                                            setOnlyAdminCanMessage(
                                                e.target.checked
                                            )
                                        }
                                    />
                                    <Lock size={15} />
                                    <span>Only admins can send messages</span>
                                </label>
                                <button
                                    type="submit"
                                    className="sync-btn primary sm full mt-2"
                                    disabled={savingGroup}
                                >
                                    {savingGroup
                                        ? "Saving..."
                                        : "Save Group Settings"}
                                </button>
                            </form>
                        ) : (
                            <div className="sync-drawer-section">
                                <span className="sync-section-label">
                                    Description
                                </span>
                                <p className="sync-about-text">
                                    {conversation.groupDescription ||
                                        "No group description"}
                                </p>
                            </div>
                        )}

                        {isAdmin && !isOfficialGroup && (
                            <div className="sync-drawer-section">
                                <span className="sync-section-label">
                                    Add Participant
                                </span>
                                <div className="sync-search-input-wrap">
                                    <UserPlus size={16} />
                                    <input
                                        type="text"
                                        placeholder="Search user to add..."
                                        value={addQuery}
                                        onChange={e =>
                                            setAddQuery(e.target.value)
                                        }
                                    />
                                </div>
                                {addResults.map(u => (
                                    <div
                                        key={u._id}
                                        className="sync-user-row compact"
                                    >
                                        <Avatar
                                            src={u.avatar}
                                            name={u.fullName}
                                            size={32}
                                        />
                                        <div className="sync-user-meta">
                                            <div className="sync-user-name">
                                                {u.fullName}
                                            </div>
                                            <div className="sync-user-sub">
                                                @{u.username}
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            className="sync-btn primary xs"
                                            onClick={() =>
                                                handleMemberAction("add", u._id)
                                            }
                                        >
                                            Add
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="sync-drawer-section">
                            <span className="sync-section-label">
                                <Users size={14} /> Members (
                                {(conversation.members || []).length})
                            </span>
                            <div className="sync-member-list">
                                {(conversation.members || []).map(m => {
                                    const mId = String(m._id || m);
                                    const memberIsAdmin = (
                                        conversation.admins || []
                                    ).some(a => String(a) === mId);
                                    const isMe = mId === myId;
                                    const isOnline = Boolean(
                                        onlineUsers[mId] ?? m.online
                                    );

                                    return (
                                        <div
                                            key={mId}
                                            className="sync-member-row"
                                        >
                                            <Avatar
                                                src={m.avatar}
                                                name={m.fullName || m.username}
                                                size={36}
                                                showOnline
                                                online={isOnline}
                                            />
                                            <div className="sync-user-meta">
                                                <div className="sync-user-name">
                                                    {m.fullName || m.username}{" "}
                                                    {isMe && "(You)"}
                                                </div>
                                                <div className="sync-user-sub">
                                                    @{m.username}
                                                </div>
                                            </div>
                                            {memberIsAdmin && (
                                                <span className="sync-admin-pill">
                                                    Group Admin
                                                </span>
                                            )}
                                            {isAdmin && !isMe && !isOfficialGroup && (
                                                <div className="sync-member-actions">
                                                    {memberIsAdmin ? (
                                                        <button
                                                            type="button"
                                                            className="sync-icon-btn xs"
                                                            title="Dismiss as admin"
                                                            onClick={() =>
                                                                handleMemberAction(
                                                                    "remove_admin",
                                                                    mId
                                                                )
                                                            }
                                                        >
                                                            <ShieldOff
                                                                size={15}
                                                            />
                                                        </button>
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            className="sync-icon-btn xs"
                                                            title="Make group admin"
                                                            onClick={() =>
                                                                handleMemberAction(
                                                                    "make_admin",
                                                                    mId
                                                                )
                                                            }
                                                        >
                                                            <Shield size={15} />
                                                        </button>
                                                    )}
                                                    <button
                                                        type="button"
                                                        className="sync-icon-btn xs danger"
                                                        title="Remove from group"
                                                        onClick={() =>
                                                            handleMemberAction(
                                                                "remove",
                                                                mId
                                                            )
                                                        }
                                                    >
                                                        <UserMinus size={15} />
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="sync-drawer-section">
                            {isOfficialGroup ? (
                                <div className="sync-official-note">
                                    <Lock size={15} />
                                    <span>
                                        Official Sync community group — all Sync
                                        users are added automatically and this
                                        group cannot be deleted or left.
                                    </span>
                                </div>
                            ) : (
                                <button
                                    type="button"
                                    className="sync-btn danger full"
                                    onClick={handleLeaveGroup}
                                >
                                    <LogOut size={16} />
                                    <span>Leave Group</span>
                                </button>
                            )}
                        </div>
                    </>
                )}
            </div>

            {confirmLeave && (
                <ConfirmDialog
                    icon={LogOut}
                    title="Leave this group?"
                    message="You will stop receiving messages from this group."
                    confirmLabel="Leave"
                    busy={leavingGroup}
                    onConfirm={handleConfirmLeaveGroup}
                    onCancel={() => setConfirmLeave(false)}
                />
            )}
        </aside>
    );
}
