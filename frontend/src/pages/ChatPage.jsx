import React, { useState, useEffect, useRef, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import {
    Search,
    UserPlus,
    Users,
    Send,
    Paperclip,
    Mic,
    Square,
    Reply,
    Trash2,
    Info,
    ArrowLeft,
    Check,
    CheckCheck,
    Clock,
    AlertCircle,
    FileText,
    Download,
    X,
    Lock,
    Loader2,
    MessageSquare
} from "lucide-react";
import Avatar from "../components/Avatar.jsx";
import SyncBrandBar from "../components/SyncBrandBar.jsx";
import {
    NewDirectChatModal,
    NewGroupChatModal,
    ChatInfoDrawer
} from "../components/Modals.jsx";
import {
    fetchMessages,
    setActiveConversation,
    setReplyTo
} from "../store/chatSlice.js";
import {
    deleteSocketMessage,
    emitMessageSeen,
    emitTypingStart,
    emitTypingStop,
    sendSocketMessage
} from "../services/socket.js";
import {
    detectMessageTypeFromFile,
    uploadMediaToCloudinary
} from "../services/media.js";
import {
    formatBytes,
    formatChatListTime,
    formatDateDivider,
    formatLastSeen,
    formatTime,
    generateClientMsgId
} from "../utils/format.js";

function StatusTick({ status, optimistic, failed }) {
    if (failed) {
        return (
            <span className="sync-tick failed" title="Failed to send">
                <AlertCircle size={13} />
            </span>
        );
    }
    if (optimistic) {
        return (
            <span className="sync-tick pending" title="Sending...">
                <Clock size={12} />
            </span>
        );
    }
    if (status === "seen") {
        return (
            <span className="sync-tick seen" title="Seen">
                <CheckCheck size={15} />
            </span>
        );
    }
    if (status === "delivered") {
        return (
            <span className="sync-tick delivered" title="Delivered">
                <CheckCheck size={15} />
            </span>
        );
    }
    return (
        <span className="sync-tick sent" title="Sent">
            <Check size={14} />
        </span>
    );
}

export default function ChatPage() {
    const { conversationId } = useParams();
    const navigate = useNavigate();
    const dispatch = useDispatch();

    const currentUser = useSelector(state => state.auth.user);
    const {
        conversations,
        conversationsLoading,
        activeConversationId,
        messagesByConv,
        onlineUsers,
        lastSeenByUser,
        typingByConv,
        replyingToByConv
    } = useSelector(state => state.chat);

    const myId = String(currentUser?._id || "");

    const [searchText, setSearchText] = useState("");
    const [filterTab, setFilterTab] = useState("all");
    const [showNewDirect, setShowNewDirect] = useState(false);
    const [showNewGroup, setShowNewGroup] = useState(false);
    const [showInfoDrawer, setShowInfoDrawer] = useState(false);

    const [draftText, setDraftText] = useState("");
    const [uploadingMedia, setUploadingMedia] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [composerError, setComposerError] = useState("");
    const [lightboxUrl, setLightboxUrl] = useState(null);

    const [isRecording, setIsRecording] = useState(false);
    const [recordingSeconds, setRecordingSeconds] = useState(0);
    const mediaRecorderRef = useRef(null);
    const audioChunksRef = useRef([]);
    const recordTimerRef = useRef(null);

    const messagesEndRef = useRef(null);
    const typingStopTimerRef = useRef(null);
    const isTypingSentRef = useRef(false);

    useEffect(() => {
        if (conversationId) {
            dispatch(setActiveConversation(conversationId));
        } else {
            dispatch(setActiveConversation(null));
            setShowInfoDrawer(false);
        }
    }, [conversationId, dispatch]);

    const activeConversation = useMemo(
        () =>
            conversations.find(
                c => String(c._id) === String(activeConversationId)
            ) || null,
        [conversations, activeConversationId]
    );

    const activeBucket = activeConversationId
        ? messagesByConv[String(activeConversationId)]
        : null;
    const messages = activeBucket?.items || [];
    const replyingTo = activeConversationId
        ? replyingToByConv[String(activeConversationId)]
        : null;

    useEffect(() => {
        if (!activeConversationId) return;
        const bucket = messagesByConv[String(activeConversationId)];
        if (!bucket?.loadedOnce && !bucket?.loading) {
            dispatch(fetchMessages({ conversationId: activeConversationId }));
        }
        emitMessageSeen(activeConversationId);
    }, [activeConversationId, dispatch]);

    useEffect(() => {
        if (!activeConversationId || messages.length === 0) return;
        const lastMsg = messages[messages.length - 1];
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });

        const senderId = String(lastMsg.sender?._id ?? lastMsg.sender);
        if (senderId !== myId && !String(lastMsg._id).startsWith("temp_")) {
            emitMessageSeen(activeConversationId, lastMsg._id);
        }
    }, [messages.length, activeConversationId, myId]);

    const filteredConversations = useMemo(() => {
        const q = searchText.trim().toLowerCase();
        return conversations.filter(c => {
            if (filterTab === "unread" && !(Number(c.unread) > 0)) return false;
            if (filterTab === "groups" && c.type !== "group") return false;
            if (!q) return true;
            const title =
                c.type === "group"
                    ? c.groupName
                    : c.partner?.fullName || c.partner?.username || "";
            const lastText = c.lastMessage?.text || "";
            return (
                title.toLowerCase().includes(q) ||
                lastText.toLowerCase().includes(q)
            );
        });
    }, [conversations, searchText, filterTab]);

    const getConvDisplay = conv => {
        if (conv.type === "group") {
            return {
                title: conv.groupName || "Unnamed Group",
                avatar: conv.groupIcon || "",
                isGroup: true,
                online: false,
                subtitle: `${(conv.members || []).length} members`
            };
        }
        const p = conv.partner || {};
        const pId = String(p._id || "");
        const isOnline = Boolean(onlineUsers[pId] ?? p.online);
        const lastSeen = lastSeenByUser[pId] || p.lastSeen;
        return {
            title: p.fullName || p.username || "Sync User",
            avatar: p.avatar || "",
            isGroup: false,
            online: isOnline,
            subtitle: isOnline ? "Online" : formatLastSeen(lastSeen)
        };
    };

    const getTypingLabel = convId => {
        const map = typingByConv[String(convId)] || {};
        const names = Object.entries(map)
            .filter(([uid]) => uid !== myId)
            .map(([, name]) => name);
        if (names.length === 0) return "";
        if (names.length === 1) return `${names[0]} is typing...`;
        return `${names.slice(0, 2).join(", ")} are typing...`;
    };

    const canSendInActive = useMemo(() => {
        if (!activeConversation) return false;
        if (
            activeConversation.type === "group" &&
            activeConversation.onlyAdminCanMessage
        ) {
            return (activeConversation.admins || []).some(
                a => String(a) === myId
            );
        }
        return true;
    }, [activeConversation, myId]);

    const handleTypingChange = val => {
        setDraftText(val);
        if (!activeConversationId) return;

        if (!isTypingSentRef.current && val.trim().length > 0) {
            isTypingSentRef.current = true;
            emitTypingStart(activeConversationId);
        }

        if (typingStopTimerRef.current) {
            clearTimeout(typingStopTimerRef.current);
        }
        typingStopTimerRef.current = setTimeout(() => {
            if (isTypingSentRef.current && activeConversationId) {
                isTypingSentRef.current = false;
                emitTypingStop(activeConversationId);
            }
        }, 2000);
    };

    const handleSendText = async e => {
        e?.preventDefault();
        const text = draftText.trim();
        if (!text || !activeConversationId || !canSendInActive) return;

        setDraftText("");
        setComposerError("");
        if (isTypingSentRef.current) {
            isTypingSentRef.current = false;
            emitTypingStop(activeConversationId);
        }

        const replyTarget = replyingTo;
        if (replyTarget) {
            dispatch(
                setReplyTo({
                    conversationId: activeConversationId,
                    message: null
                })
            );
        }

        const ack = await sendSocketMessage({
            conversationId: activeConversationId,
            clientMsgId: generateClientMsgId(),
            type: "text",
            text,
            replyToMessage: replyTarget
        });

        if (ack && !ack.ok && !ack.queued) {
            setComposerError(`Message error: ${ack.error || "Failed"}`);
        }
    };

    const handleFileAttachment = async e => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file || !activeConversationId) return;

        setUploadingMedia(true);
        setUploadProgress(0);
        setComposerError("");

        try {
            const media = await uploadMediaToCloudinary(
                file,
                setUploadProgress
            );
            const msgType = detectMessageTypeFromFile(file);
            const replyTarget = replyingTo;
            if (replyTarget) {
                dispatch(
                    setReplyTo({
                        conversationId: activeConversationId,
                        message: null
                    })
                );
            }

            const ack = await sendSocketMessage({
                conversationId: activeConversationId,
                clientMsgId: generateClientMsgId(),
                type: msgType,
                text: draftText.trim(),
                media,
                replyToMessage: replyTarget
            });
            setDraftText("");
            if (ack && !ack.ok && !ack.queued) {
                setComposerError(`Media message error: ${ack.error}`);
            }
        } catch (err) {
            setComposerError(err.message || "Media upload failed");
        } finally {
            setUploadingMedia(false);
            setUploadProgress(0);
        }
    };

    const startVoiceRecording = async () => {
        // getUserMedia requires HTTPS (or localhost) and a user gesture.
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
            setComposerError(
                "Microphone access requires a secure HTTPS connection. Open Sync using its HTTPS address and try again."
            );
            return;
        }
        if (typeof window.MediaRecorder === "undefined") {
            setComposerError("Voice recording is not supported by this browser.");
            return;
        }

        setComposerError("");
        let stream;
        try {
            // Calling this directly from the microphone button opens the
            // browser's native Allow / Block permission prompt when needed.
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            const mimeType = [
                "audio/webm;codecs=opus",
                "audio/webm",
                "audio/mp4"
            ].find(type => MediaRecorder.isTypeSupported?.(type));
            const recorder = new MediaRecorder(
                stream,
                mimeType ? { mimeType } : undefined
            );
            const recordingType = recorder.mimeType || mimeType || "audio/webm";
            audioChunksRef.current = [];

            recorder.ondataavailable = evt => {
                if (evt.data.size > 0) audioChunksRef.current.push(evt.data);
            };

            recorder.onerror = () => {
                stream.getTracks().forEach(track => track.stop());
                clearInterval(recordTimerRef.current);
                setIsRecording(false);
                setRecordingSeconds(0);
                setComposerError("The microphone recording could not be started. Please try again.");
            };

            recorder.onstop = async () => {
                stream.getTracks().forEach(track => track.stop());
                clearInterval(recordTimerRef.current);
                setIsRecording(false);
                setRecordingSeconds(0);

                if (audioChunksRef.current.length === 0) return;
                const blob = new Blob(audioChunksRef.current, {
                    type: recordingType
                });
                const extension = recordingType.includes("mp4") ? "m4a" : "webm";
                const audioFile = new File(
                    [blob],
                    `voice_${Date.now()}.${extension}`,
                    { type: recordingType }
                );

                setUploadingMedia(true);
                setUploadProgress(0);
                try {
                    const media = await uploadMediaToCloudinary(
                        audioFile,
                        setUploadProgress,
                        { purpose: "voice" }
                    );
                    await sendSocketMessage({
                        conversationId: activeConversationId,
                        clientMsgId: generateClientMsgId(),
                        type: "audio",
                        text: "",
                        media,
                        replyToMessage: replyingTo
                    });
                    if (replyingTo) {
                        dispatch(
                            setReplyTo({
                                conversationId: activeConversationId,
                                message: null
                            })
                        );
                    }
                } catch (err) {
                    setComposerError(
                        err.message || "Voice message upload failed"
                    );
                } finally {
                    setUploadingMedia(false);
                    setUploadProgress(0);
                }
            };

            mediaRecorderRef.current = recorder;
            recorder.start();
            setIsRecording(true);
            setRecordingSeconds(0);
            recordTimerRef.current = setInterval(() => {
                setRecordingSeconds(seconds => seconds + 1);
            }, 1000);
        } catch (err) {
            stream?.getTracks().forEach(track => track.stop());
            const messages = {
                NotAllowedError: "Please allow microphone access in your browser to record a voice message.",
                PermissionDeniedError: "Please allow microphone access in your browser to record a voice message.",
                NotFoundError: "No microphone was found on this device.",
                NotReadableError: "The microphone is already in use by another app."
            };
            setComposerError(
                messages[err?.name] ||
                err?.message ||
                "Could not access the microphone. Check your browser permissions and try again."
            );
        }
    };

    const stopVoiceRecording = () => {
        if (
            mediaRecorderRef.current &&
            mediaRecorderRef.current.state !== "inactive"
        ) {
            mediaRecorderRef.current.stop();
        }
    };

    const handleDeleteMessage = async msgId => {
        if (!window.confirm("Delete this message for everyone?")) return;
        const ack = await deleteSocketMessage(msgId);
        if (!ack?.ok) {
            setComposerError(ack?.error || "Could not delete message");
        }
    };

    const handleLoadOlder = () => {
        if (
            !activeConversationId ||
            !activeBucket?.hasMore ||
            !activeBucket?.nextBefore ||
            activeBucket.loading
        ) {
            return;
        }
        dispatch(
            fetchMessages({
                conversationId: activeConversationId,
                before: activeBucket.nextBefore
            })
        );
    };

    const activeDisplay = activeConversation
        ? getConvDisplay(activeConversation)
        : null;
    const activeTypingText = activeConversationId
        ? getTypingLabel(activeConversationId)
        : "";

    return (
        <div
            className={`sync-chat-layout ${
                activeConversationId ? "has-active-chat" : ""
            }`}
        >
            <section className="sync-chat-sidebar">
                <div className="sync-pane-header">
                    <SyncBrandBar className="sync-pane-brand" />
                    <h2>Chats</h2>
                    <div className="sync-header-actions">
                        <button
                            type="button"
                            className="sync-icon-btn"
                            title="New Direct Chat"
                            onClick={() => setShowNewDirect(true)}
                        >
                            <UserPlus size={19} />
                        </button>
                        <button
                            type="button"
                            className="sync-icon-btn"
                            title="Create Group"
                            onClick={() => setShowNewGroup(true)}
                        >
                            <Users size={19} />
                        </button>
                    </div>
                </div>

                <div className="sync-sidebar-controls">
                    <div className="sync-search-input-wrap">
                        <Search size={16} />
                        <input
                            type="text"
                            placeholder="Search chats or messages..."
                            value={searchText}
                            onChange={e => setSearchText(e.target.value)}
                        />
                    </div>

                    <div className="sync-filter-pills">
                        {["all", "unread", "groups"].map(tab => (
                            <button
                                key={tab}
                                type="button"
                                className={`sync-filter-pill ${
                                    filterTab === tab ? "active" : ""
                                }`}
                                onClick={() => setFilterTab(tab)}
                            >
                                {tab === "all"
                                    ? "All"
                                    : tab === "unread"
                                      ? "Unread"
                                      : "Groups"}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="sync-conv-list">
                    {conversationsLoading && conversations.length === 0 && (
                        <div aria-busy="true" aria-label="Loading conversations">
                            {[0, 1, 2, 3, 4, 5].map(n => (
                                <div className="sync-skeleton-row" key={n}>
                                    <div className="sync-skel avatar" />
                                    <div className="sync-skel-lines">
                                        <div className="sync-skel line" />
                                        <div className="sync-skel line short" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {!conversationsLoading &&
                        filteredConversations.length === 0 && (
                            <div className="sync-empty-hint">
                                <p>No conversations found.</p>
                                <button
                                    type="button"
                                    className="sync-btn primary sm mt-2"
                                    onClick={() => setShowNewDirect(true)}
                                >
                                    <UserPlus size={15} /> Start a Chat
                                </button>
                            </div>
                        )}

                    {filteredConversations.map((conv, convIndex) => {
                        const info = getConvDisplay(conv);
                        const isSelected =
                            String(conv._id) === String(activeConversationId);
                        const typingText = getTypingLabel(conv._id);
                        const unread = Number(conv.unread || 0);

                        return (
                            <div
                                key={conv._id}
                                style={{ "--i": Math.min(convIndex, 12) }}
                                className={`sync-conv-row ${
                                    isSelected ? "active" : ""
                                }`}
                                onClick={() => navigate(`/chats/${conv._id}`)}
                            >
                                <Avatar
                                    src={info.avatar}
                                    name={info.title}
                                    size={48}
                                    isGroup={info.isGroup}
                                    showOnline={!info.isGroup}
                                    online={info.online}
                                />

                                <div className="sync-conv-main">
                                    <div className="sync-conv-top">
                                        <span className="sync-conv-name">
                                            {info.title}
                                        </span>
                                        <span
                                            className={`sync-conv-time ${
                                                unread > 0 ? "unread" : ""
                                            }`}
                                        >
                                            {formatChatListTime(
                                                conv.lastMessage?.createdAt ||
                                                    conv.updatedAt
                                            )}
                                        </span>
                                    </div>

                                    <div className="sync-conv-bottom">
                                        <span
                                            className={`sync-conv-preview ${
                                                typingText ? "typing" : ""
                                            }`}
                                        >
                                            {typingText ||
                                                conv.lastMessage?.text ||
                                                "No messages yet"}
                                        </span>
                                        {unread > 0 && (
                                            <span className="sync-unread-badge">
                                                {unread > 99 ? "99+" : unread}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </section>

            <section className="sync-chat-stage">
                {!activeConversation ? (
                    <div className="sync-stage-placeholder">
                        <div className="sync-placeholder-circle">
                            <MessageSquare size={36} />
                        </div>
                        <h3>Sync Web Messenger</h3>
                        <p>
                            Select a conversation from the left or start a new
                            direct/group chat to begin messaging in real time.
                        </p>
                        <div className="sync-placeholder-actions">
                            <button
                                type="button"
                                className="sync-btn primary"
                                onClick={() => setShowNewDirect(true)}
                            >
                                <UserPlus size={16} /> New Direct Chat
                            </button>
                            <button
                                type="button"
                                className="sync-btn secondary"
                                onClick={() => setShowNewGroup(true)}
                            >
                                <Users size={16} /> New Group
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="sync-active-chat-wrap">
                        <header className="sync-chat-header">
                            <div
                                className="sync-chat-header-left"
                                onClick={() => setShowInfoDrawer(v => !v)}
                            >
                                <button
                                    type="button"
                                    className="sync-icon-btn mobile-back"
                                    onClick={e => {
                                        e.stopPropagation();
                                        navigate("/chats");
                                    }}
                                >
                                    <ArrowLeft size={20} />
                                </button>
                                <Avatar
                                    src={activeDisplay.avatar}
                                    name={activeDisplay.title}
                                    size={42}
                                    isGroup={activeDisplay.isGroup}
                                    showOnline={!activeDisplay.isGroup}
                                    online={activeDisplay.online}
                                />
                                <div className="sync-header-meta">
                                    <div className="sync-header-title">
                                        {activeDisplay.title}
                                    </div>
                                    <div
                                        className={`sync-header-sub ${
                                            activeTypingText ? "typing" : ""
                                        }`}
                                    >
                                        {activeTypingText ||
                                            activeDisplay.subtitle}
                                    </div>
                                </div>
                            </div>

                            <div className="sync-chat-header-right">
                                <button
                                    type="button"
                                    className={`sync-icon-btn ${
                                        showInfoDrawer ? "active" : ""
                                    }`}
                                    title="Conversation Info"
                                    onClick={() => setShowInfoDrawer(v => !v)}
                                >
                                    <Info size={20} />
                                </button>
                            </div>
                        </header>

                        <div className="sync-messages-viewport">
                            {activeBucket?.hasMore && (
                                <div className="sync-load-more-wrap">
                                    <button
                                        type="button"
                                        className="sync-btn secondary xs"
                                        onClick={handleLoadOlder}
                                        disabled={activeBucket.loading}
                                    >
                                        {activeBucket.loading
                                            ? "Loading..."
                                            : "Load older messages"}
                                    </button>
                                </div>
                            )}

                            {activeBucket?.loading && messages.length === 0 && (
                                <div className="sync-empty-hint">
                                    <Loader2 size={20} className="spin" />{" "}
                                    Loading messages...
                                </div>
                            )}

                            {!activeBucket?.loading &&
                                messages.length === 0 && (
                                    <div className="sync-empty-chat-badge">
                                        Say hello! Messages are synced in real
                                        time across your devices.
                                    </div>
                                )}

                            {messages.map((msg, idx) => {
                                const senderId = String(
                                    msg.sender?._id ?? msg.sender
                                );
                                const isMine = senderId === myId;
                                const prevMsg =
                                    idx > 0 ? messages[idx - 1] : null;
                                const curDate = formatDateDivider(
                                    msg.createdAt
                                );
                                const prevDate = prevMsg
                                    ? formatDateDivider(prevMsg.createdAt)
                                    : "";
                                const showDateDivider =
                                    curDate && curDate !== prevDate;

                                return (
                                    <React.Fragment
                                        key={msg._id || msg.clientMsgId}
                                    >
                                        {showDateDivider && (
                                            <div className="sync-date-divider">
                                                <span>{curDate}</span>
                                            </div>
                                        )}

                                        <div
                                            className={`sync-msg-row ${
                                                isMine ? "outgoing" : "incoming"
                                            }`}
                                        >
                                            <div
                                                className={`sync-msg-bubble ${
                                                    msg.deletedForEveryone
                                                        ? "deleted"
                                                        : ""
                                                }`}
                                            >
                                                {activeConversation.type ===
                                                    "group" &&
                                                    !isMine && (
                                                        <div className="sync-msg-sender-name">
                                                            {msg.sender
                                                                ?.fullName ||
                                                                msg.sender
                                                                    ?.username ||
                                                                "Member"}
                                                        </div>
                                                    )}

                                                {msg.replyTo &&
                                                    !msg.deletedForEveryone && (
                                                        <div className="sync-msg-reply-quote">
                                                            <span className="reply-bar" />
                                                            <div className="reply-content">
                                                                <p>
                                                                    {msg.replyTo
                                                                        .deletedForEveryone
                                                                        ? "This message was deleted"
                                                                        : msg
                                                                              .replyTo
                                                                              .text ||
                                                                          `[${String(
                                                                              msg
                                                                                  .replyTo
                                                                                  .type ||
                                                                                  "media"
                                                                          ).toUpperCase()}]`}
                                                                </p>
                                                            </div>
                                                        </div>
                                                    )}

                                                {!msg.deletedForEveryone &&
                                                    msg.type === "image" &&
                                                    msg.media?.url && (
                                                        <div className="sync-msg-media-img">
                                                            <img
                                                                src={
                                                                    msg.media
                                                                        .url
                                                                }
                                                                alt="attachment"
                                                                loading="lazy"
                                                                onClick={() =>
                                                                    setLightboxUrl(
                                                                        msg
                                                                            .media
                                                                            .url
                                                                    )
                                                                }
                                                            />
                                                        </div>
                                                    )}

                                                {!msg.deletedForEveryone &&
                                                    msg.type === "video" &&
                                                    msg.media?.url && (
                                                        <div className="sync-msg-media-video">
                                                            <video
                                                                src={
                                                                    msg.media
                                                                        .url
                                                                }
                                                                controls
                                                            />
                                                        </div>
                                                    )}

                                                {!msg.deletedForEveryone &&
                                                    msg.type === "audio" &&
                                                    msg.media?.url && (
                                                        <div className="sync-msg-media-audio">
                                                            <audio
                                                                src={
                                                                    msg.media
                                                                        .url
                                                                }
                                                                controls
                                                            />
                                                        </div>
                                                    )}

                                                {!msg.deletedForEveryone &&
                                                    msg.type === "file" &&
                                                    msg.media?.url && (
                                                        <a
                                                            href={msg.media.url}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            className="sync-msg-file-card"
                                                        >
                                                            <FileText
                                                                size={22}
                                                            />
                                                            <div className="file-meta">
                                                                <span>
                                                                    Attachment
                                                                </span>
                                                                <small>
                                                                    {formatBytes(
                                                                        msg
                                                                            .media
                                                                            .bytes
                                                                    )}
                                                                </small>
                                                            </div>
                                                            <Download
                                                                size={16}
                                                            />
                                                        </a>
                                                    )}

                                                {(msg.text ||
                                                    msg.deletedForEveryone) && (
                                                    <div className="sync-msg-text">
                                                        {msg.deletedForEveryone
                                                            ? "🚫 This message was deleted"
                                                            : msg.text}
                                                    </div>
                                                )}

                                                <div className="sync-msg-meta">
                                                    <span className="sync-msg-time">
                                                        {formatTime(
                                                            msg.createdAt
                                                        )}
                                                    </span>
                                                    {isMine &&
                                                        !msg.deletedForEveryone && (
                                                            <StatusTick
                                                                status={
                                                                    msg.status
                                                                }
                                                                optimistic={
                                                                    msg.optimistic
                                                                }
                                                                failed={
                                                                    msg.failed
                                                                }
                                                            />
                                                        )}
                                                </div>

                                                {!msg.deletedForEveryone &&
                                                    !msg.optimistic && (
                                                        <div className="sync-msg-actions">
                                                            <button
                                                                type="button"
                                                                title="Reply"
                                                                onClick={() =>
                                                                    dispatch(
                                                                        setReplyTo(
                                                                            {
                                                                                conversationId:
                                                                                    activeConversationId,
                                                                                message:
                                                                                    msg
                                                                            }
                                                                        )
                                                                    )
                                                                }
                                                            >
                                                                <Reply
                                                                    size={14}
                                                                />
                                                            </button>
                                                            {isMine && (
                                                                <button
                                                                    type="button"
                                                                    title="Delete for everyone"
                                                                    onClick={() =>
                                                                        handleDeleteMessage(
                                                                            msg._id
                                                                        )
                                                                    }
                                                                >
                                                                    <Trash2
                                                                        size={
                                                                            14
                                                                        }
                                                                    />
                                                                </button>
                                                            )}
                                                        </div>
                                                    )}
                                            </div>
                                        </div>
                                    </React.Fragment>
                                );
                            })}

                            <div ref={messagesEndRef} />
                        </div>

                        <footer className="sync-composer-wrap">
                            {composerError && (
                                <div className="sync-composer-banner error">
                                    <span>{composerError}</span>
                                    <button
                                        type="button"
                                        onClick={() => setComposerError("")}
                                    >
                                        <X size={14} />
                                    </button>
                                </div>
                            )}

                            {uploadingMedia && (
                                <div className="sync-composer-banner uploading">
                                    <Loader2 size={15} className="spin" />
                                    <span>
                                        Uploading media to Cloudinary...{" "}
                                        {uploadProgress}%
                                    </span>
                                </div>
                            )}

                            {replyingTo && (
                                <div className="sync-reply-banner">
                                    <div className="reply-banner-text">
                                        <strong>
                                            Replying to{" "}
                                            {replyingTo.sender?.fullName ||
                                                "message"}
                                        </strong>
                                        <p>
                                            {replyingTo.text ||
                                                `[${String(
                                                    replyingTo.type
                                                ).toUpperCase()}]`}
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        className="sync-icon-btn xs"
                                        onClick={() =>
                                            dispatch(
                                                setReplyTo({
                                                    conversationId:
                                                        activeConversationId,
                                                    message: null
                                                })
                                            )
                                        }
                                    >
                                        <X size={16} />
                                    </button>
                                </div>
                            )}

                            {!canSendInActive ? (
                                <div className="sync-admin-only-bar">
                                    <Lock size={15} />
                                    <span>
                                        Only group admins can send messages in
                                        this group
                                    </span>
                                </div>
                            ) : (
                                <form
                                    className="sync-composer-bar"
                                    onSubmit={handleSendText}
                                >
                                    <label
                                        className="sync-icon-btn"
                                        title="Attach Image, Video, Audio or File"
                                    >
                                        <Paperclip size={20} />
                                        <input
                                            type="file"
                                            hidden
                                            onChange={handleFileAttachment}
                                            disabled={
                                                uploadingMedia || isRecording
                                            }
                                        />
                                    </label>

                                    {isRecording ? (
                                        <div className="sync-recording-indicator">
                                            <span className="rec-dot" />
                                            <span>
                                                Recording voice...{" "}
                                                {recordingSeconds}s
                                            </span>
                                            <button
                                                type="button"
                                                className="sync-btn danger xs"
                                                onClick={stopVoiceRecording}
                                            >
                                                <Square size={13} /> Stop & Send
                                            </button>
                                        </div>
                                    ) : (
                                        <input
                                            type="text"
                                            className="sync-composer-input"
                                            placeholder="Type a message..."
                                            maxLength={4000}
                                            value={draftText}
                                            onChange={e =>
                                                handleTypingChange(
                                                    e.target.value
                                                )
                                            }
                                        />
                                    )}

                                    {!draftText.trim() && !isRecording ? (
                                        <button
                                            type="button"
                                            className="sync-icon-btn"
                                            title="Record Voice Note"
                                            onClick={startVoiceRecording}
                                            disabled={uploadingMedia}
                                        >
                                            <Mic size={20} />
                                        </button>
                                    ) : (
                                        !isRecording && (
                                            <button
                                                type="submit"
                                                className="sync-send-btn"
                                                title="Send Message"
                                            >
                                                <Send size={18} />
                                            </button>
                                        )
                                    )}
                                </form>
                            )}
                        </footer>
                    </div>
                )}

                {showInfoDrawer && activeConversation && (
                    <ChatInfoDrawer
                        conversation={activeConversation}
                        onClose={() => setShowInfoDrawer(false)}
                    />
                )}
            </section>

            {showNewDirect && (
                <NewDirectChatModal
                    onClose={() => setShowNewDirect(false)}
                    onChatReady={conv => navigate(`/chats/${conv._id}`)}
                />
            )}

            {showNewGroup && (
                <NewGroupChatModal
                    onClose={() => setShowNewGroup(false)}
                    onGroupReady={conv => navigate(`/chats/${conv._id}`)}
                />
            )}

            {lightboxUrl && (
                <div
                    className="sync-lightbox"
                    onClick={() => setLightboxUrl(null)}
                >
                    <button
                        type="button"
                        className="sync-icon-btn light lightbox-close"
                        onClick={() => setLightboxUrl(null)}
                    >
                        <X size={24} />
                    </button>
                    <img src={lightboxUrl} alt="Full view" />
                </div>
            )}
        </div>
    );
}
