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
    Lock
} from "lucide-react";
import Avatar from "./Avatar.jsx";
import { api, extractErrorMessage } from "../services/api.js";
import {
    createGroupChat,
    leaveGroupChat,
    startDirectChat,
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
                    `/api/users?search=${encodeURIComponent(trimmed)}`
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
                            <div className="sync-empty-hint">
                                Type at least 2 characters to search users
                            </div>
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
                    `/api/users?search=${encodeURIComponent(trimmed)}`
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
                purpose: "group"
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

    useEffect(() => {
        setGroupName(conversation?.groupName || "");
        setGroupDescription(conversation?.groupDescription || "");
        setOnlyAdminCanMessage(Boolean(conversation?.onlyAdminCanMessage));
    }, [conversation]);

    useEffect(() => {
        if (!conversation || isGroup || !conversation.partner?._id) return;
        let active = true;
        api.get(`/api/users/${conversation.partner._id}`)
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
                    `/api/users?search=${encodeURIComponent(trimmed)}`
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
                purpose: "group"
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

    const handleLeaveGroup = async () => {
        if (!window.confirm("Are you sure you want to leave this group?")) {
            return;
        }
        try {
            await dispatch(leaveGroupChat(conversation._id)).unwrap();
            onClose();
        } catch (err) {
            setError(typeof err === "string" ? err : "Could not leave group");
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
    const partnerOnline = Boolean(
        onlineUsers[String(partner._id)] ?? partner.online
    );

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
                        showOnline={!isGroup}
                        online={partnerOnline}
                    />
                    {isGroup && isAdmin && (
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
                    <h3 className="sync-drawer-title">
                        {isGroup
                            ? conversation.groupName
                            : partner.fullName || "Unknown User"}
                    </h3>
                    <p className="sync-drawer-subtitle">
                        {isGroup
                            ? `Group · ${(conversation.members || []).length} members`
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

                {!isGroup ? (
                    <>
                        <div className="sync-drawer-section">
                            <span className="sync-section-label">About</span>
                            <p className="sync-about-text">
                                {partner.about || "Hello ! I am using Sync 😃"}
                            </p>
                        </div>

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
                    </>
                ) : (
                    <>
                        {isAdmin ? (
                            <form
                                className="sync-drawer-section"
                                onSubmit={handleSaveGroup}
                            >
                                <span className="sync-section-label">
                                    Group Settings (Admin)
                                </span>
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

                        {isAdmin && (
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
                                                    Admin
                                                </span>
                                            )}
                                            {isAdmin && !isMe && (
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
                            <button
                                type="button"
                                className="sync-btn danger full"
                                onClick={handleLeaveGroup}
                            >
                                <LogOut size={16} />
                                <span>Leave Group</span>
                            </button>
                        </div>
                    </>
                )}
            </div>
        </aside>
    );
}
