import React, { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
    Plus,
    Eye,
    Trash2,
    X,
    ChevronLeft,
    ChevronRight,
    Image as ImageIcon,
    Type,
    Loader2,
    Send,
    Check
} from "lucide-react";
import Avatar from "../components/Avatar.jsx";
import SyncBrandBar from "../components/SyncBrandBar.jsx";
import {
    createNewStory,
    deleteMyStory,
    fetchStories,
    fetchStoryViewers,
    markStoryViewed,
    reactToStory,
    replyToStory
} from "../store/storySlice.js";
import { uploadMediaToCloudinary } from "../services/media.js";
import { formatChatListTime, formatTime } from "../utils/format.js";

const STORY_COLORS = [
    "#0F4C3A",
    "#1E3A8A",
    "#581C87",
    "#7C2D12",
    "#831843",
    "#111827",
    "#047857"
];

// নিচের বারে সরাসরি দেখানো react
const QUICK_REACTIONS = ["❤️", "😂", "😮", "😢", "🔥", "👏", "🙏"];

// "+" চাপলে পুরো তালিকা
const REACTION_GROUPS = [
    {
        label: "Faces",
        items: [
            "😀", "😁", "😂", "🤣", "😊", "😍", "🥰", "😘", "😎", "🤩",
            "🥳", "😜", "🤔", "😮", "😲", "🥺", "😢", "😭", "😡", "🤯"
        ]
    },
    {
        label: "Hands",
        items: ["👍", "👎", "👏", "🙌", "🙏", "💪", "👌", "✌️", "🤝", "🤞", "👀", "🫶"]
    },
    {
        label: "Love & vibes",
        items: [
            "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "💔", "💯", "🔥",
            "✨", "🎉", "🎊", "⭐", "💥", "🌹", "🎂", "🏆"
        ]
    }
];

export default function StoriesPage() {
    const dispatch = useDispatch();
    const { user } = useSelector(state => state.auth);
    const { storyGroups, loading, posting, viewersByStoryId } = useSelector(
        state => state.story
    );

    const [showCreateModal, setShowCreateModal] = useState(false);
    const [storyType, setStoryType] = useState("text");
    const [caption, setCaption] = useState("");
    const [bgColor, setBgColor] = useState(STORY_COLORS[0]);
    const [mediaFile, setMediaFile] = useState(null);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [createError, setCreateError] = useState("");

    const [viewerState, setViewerState] = useState(null);
    const [showViewersList, setShowViewersList] = useState(false);

    const [replyText, setReplyText] = useState("");
    const [replying, setReplying] = useState(false);
    const [replyError, setReplyError] = useState("");
    const [toast, setToast] = useState("");
    const [showPicker, setShowPicker] = useState(false);
    const [bursts, setBursts] = useState([]);
    const toastTimerRef = useRef(null);
    const lastReaction = useSelector(state => state.story.lastReaction);

    useEffect(() => {
        dispatch(fetchStories());
    }, [dispatch]);

    const activeGroup =
        viewerState !== null ? storyGroups[viewerState.groupIdx] : null;
    const activeStory =
        activeGroup && viewerState !== null
            ? activeGroup.stories[viewerState.storyIdx]
            : null;

    // অন্য story-তে গেলে reply/picker পরিষ্কার
    useEffect(() => {
        setReplyText("");
        setReplyError("");
        setShowPicker(false);
    }, [activeStory?._id]);

    useEffect(() => () => clearTimeout(toastTimerRef.current), []);

    // আমার story-তে কেউ react দিলে সাথে সাথে emoji উড়ে ওঠে
    useEffect(() => {
        if (!lastReaction || !activeStory || !activeGroup?.isMine) return;
        if (String(lastReaction.storyId) !== String(activeStory._id)) return;
        if (Date.now() - lastReaction.at > 4000) return;
        launchBurst(lastReaction.emoji, lastReaction.user?.fullName);
    }, [lastReaction]);

    useEffect(() => {
        if (!activeStory || !activeGroup) return;
        if (!activeGroup.isMine && !activeStory.seen) {
            dispatch(markStoryViewed(activeStory._id));
        }
        if (activeGroup.isMine) {
            dispatch(fetchStoryViewers(activeStory._id));
        }
    }, [activeStory, activeGroup, dispatch]);

    const handleCreateStory = async e => {
        e.preventDefault();
        setCreateError("");

        try {
            if (storyType === "text") {
                if (!caption.trim()) {
                    setCreateError("Please write some text for your story");
                    return;
                }
                await dispatch(
                    createNewStory({
                        type: "text",
                        caption: caption.trim(),
                        backgroundColor: bgColor
                    })
                ).unwrap();
            } else {
                if (!mediaFile) {
                    setCreateError("Please select an image or video");
                    return;
                }
                const media = await uploadMediaToCloudinary(
                    mediaFile,
                    setUploadProgress,
                    { purpose: "story" }
                );
                const detectedType = mediaFile.type.startsWith("video/")
                    ? "video"
                    : "image";
                await dispatch(
                    createNewStory({
                        type: detectedType,
                        caption: caption.trim(),
                        backgroundColor: bgColor,
                        media
                    })
                ).unwrap();
            }
            setCaption("");
            setMediaFile(null);
            setUploadProgress(0);
            setShowCreateModal(false);
        } catch (err) {
            setCreateError(
                typeof err === "string"
                    ? err
                    : err?.message || "Could not post story"
            );
        }
    };

    const showToast = text => {
        setToast(text);
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = setTimeout(() => setToast(""), 2400);
    };

    // emoji-র ঝাঁক নিচ থেকে উপরে উড়ে যায়
    const launchBurst = (emoji, label = "") => {
        const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const particles = Array.from({ length: 16 }, (_, i) => ({
            id: i,
            x: Math.round((Math.random() - 0.5) * 260),
            delay: Math.round(Math.random() * 380),
            size: 22 + Math.round(Math.random() * 24),
            dur: 1500 + Math.round(Math.random() * 900),
            rot: Math.round((Math.random() - 0.5) * 60)
        }));
        setBursts(prev => [...prev.slice(-2), { id, emoji, label, particles }]);
        setTimeout(
            () => setBursts(prev => prev.filter(b => b.id !== id)),
            2800
        );
    };

    const handleReact = emoji => {
        if (!activeStory || activeGroup?.isMine) return;
        const same = activeStory.myReaction === emoji;
        dispatch(
            reactToStory({
                storyId: activeStory._id,
                emoji: same ? null : emoji
            })
        );
        if (!same) launchBurst(emoji);
        setShowPicker(false);
    };

    const handleSendReply = async e => {
        e.preventDefault();
        const text = replyText.trim();
        if (!text || replying || !activeStory) return;
        setReplying(true);
        setReplyError("");
        try {
            await dispatch(
                replyToStory({ storyId: activeStory._id, text })
            ).unwrap();
            setReplyText("");
            setShowPicker(false);
            const first = (activeGroup?.author?.fullName || "").split(" ")[0];
            showToast(first ? `Reply sent to ${first}` : "Reply sent");
        } catch (err) {
            setReplyError(
                typeof err === "string"
                    ? err
                    : err?.message || "Could not send reply"
            );
        } finally {
            setReplying(false);
        }
    };

    const handleDeleteCurrentStory = async () => {
        if (!activeStory) return;
        if (!window.confirm("Delete this story?")) return;
        await dispatch(deleteMyStory(activeStory._id));
        setViewerState(null);
        setShowViewersList(false);
    };

    const goNextStory = () => {
        if (!activeGroup || viewerState === null) return;
        if (viewerState.storyIdx + 1 < activeGroup.stories.length) {
            setViewerState({
                ...viewerState,
                storyIdx: viewerState.storyIdx + 1
            });
            setShowViewersList(false);
        } else if (viewerState.groupIdx + 1 < storyGroups.length) {
            setViewerState({
                groupIdx: viewerState.groupIdx + 1,
                storyIdx: 0
            });
            setShowViewersList(false);
        } else {
            setViewerState(null);
            setShowViewersList(false);
        }
    };

    const goPrevStory = () => {
        if (!activeGroup || viewerState === null) return;
        if (viewerState.storyIdx > 0) {
            setViewerState({
                ...viewerState,
                storyIdx: viewerState.storyIdx - 1
            });
            setShowViewersList(false);
        } else if (viewerState.groupIdx > 0) {
            const prevGroup = storyGroups[viewerState.groupIdx - 1];
            setViewerState({
                groupIdx: viewerState.groupIdx - 1,
                storyIdx: Math.max(0, prevGroup.stories.length - 1)
            });
            setShowViewersList(false);
        }
    };

    const myGroupIdx = storyGroups.findIndex(g => g.isMine);
    const myGroup = myGroupIdx !== -1 ? storyGroups[myGroupIdx] : null;
    const contactGroups = storyGroups
        .map((g, idx) => ({ ...g, originalIdx: idx }))
        .filter(g => !g.isMine);

    return (
        <div className={`sync-stories-layout ${viewerState !== null ? "has-active-story" : ""}`}>
            <div className="sync-stories-sidebar">
                <div className="sync-pane-header">
                    <SyncBrandBar className="sync-pane-brand" />
                    <h2>Stories</h2>
                    <button
                        type="button"
                        className="sync-btn primary sm"
                        onClick={() => setShowCreateModal(true)}
                    >
                        <Plus size={16} />
                        <span>Add Story</span>
                    </button>
                </div>

                <div className="sync-stories-list">
                    <div className="sync-section-label">My Status</div>
                    <div
                        className="sync-story-row"
                        onClick={() => {
                            if (myGroup && myGroup.stories.length > 0) {
                                setViewerState({
                                    groupIdx: myGroupIdx,
                                    storyIdx: 0
                                });
                            } else {
                                setShowCreateModal(true);
                            }
                        }}
                    >
                        <div
                            className={`sync-story-ring ${
                                myGroup?.stories?.length ? "seen" : ""
                            }`}
                        >
                            <Avatar
                                src={user?.avatar}
                                name={user?.fullName || user?.username}
                                size={48}
                            />
                        </div>
                        <div className="sync-user-meta">
                            <div className="sync-user-name">My Status</div>
                            <div className="sync-user-sub">
                                {myGroup?.stories?.length
                                    ? `${myGroup.stories.length} active update(s) · Tap to view`
                                    : "Tap to add a 24h status update"}
                            </div>
                        </div>
                    </div>

                    <div className="sync-section-label mt-4">
                        Recent Updates (Contacts)
                    </div>
                    {loading && storyGroups.length === 0 && (
                        <div className="sync-empty-hint">
                            <Loader2 size={18} className="spin" /> Loading
                            stories...
                        </div>
                    )}
                    {!loading && contactGroups.length === 0 && (
                        <div className="sync-empty-hint">
                            No recent stories from your contacts yet.
                        </div>
                    )}

                    {contactGroups.map(group => {
                        const lastStory =
                            group.stories[group.stories.length - 1];
                        return (
                            <div
                                key={group.author._id}
                                className="sync-story-row"
                                onClick={() =>
                                    setViewerState({
                                        groupIdx: group.originalIdx,
                                        storyIdx: 0
                                    })
                                }
                            >
                                <div
                                    className={`sync-story-ring ${
                                        group.hasUnseen ? "unseen" : "seen"
                                    }`}
                                >
                                    <Avatar
                                        src={group.author.avatar}
                                        name={
                                            group.author.fullName ||
                                            group.author.username
                                        }
                                        size={48}
                                    />
                                </div>
                                <div className="sync-user-meta">
                                    <div className="sync-user-name">
                                        {group.author.fullName}
                                    </div>
                                    <div className="sync-user-sub">
                                        {group.stories.length} story ·{" "}
                                        {formatChatListTime(
                                            lastStory?.createdAt
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="sync-stories-stage">
                {!activeStory ? (
                    <div className="sync-stage-placeholder">
                        <div className="sync-placeholder-circle">
                            <Eye size={34} />
                        </div>
                        <h3>Select a story to view</h3>
                        <p>
                            Stories disappear automatically after 24 hours.
                            Share text, photos, or videos with your contacts.
                        </p>
                        <button
                            type="button"
                            className="sync-btn primary"
                            onClick={() => setShowCreateModal(true)}
                        >
                            <Plus size={17} />
                            <span>Post a Story</span>
                        </button>
                    </div>
                ) : (
                    <div
                        className="sync-story-player"
                        style={{
                            backgroundColor:
                                activeStory.type === "text"
                                    ? activeStory.backgroundColor || "#0F4C3A"
                                    : "#070d10"
                        }}
                    >
                        <div className="sync-story-progress-row">
                            {activeGroup.stories.map((st, idx) => (
                                <div
                                    key={st._id}
                                    className={`sync-story-seg ${
                                        idx <= viewerState.storyIdx
                                            ? "active"
                                            : ""
                                    }`}
                                />
                            ))}
                        </div>

                        <div className="sync-story-player-header">
                            <div className="sync-story-author">
                                <Avatar
                                    src={activeGroup.author?.avatar}
                                    name={activeGroup.author?.fullName}
                                    size={38}
                                />
                                <div>
                                    <div className="sync-story-author-name">
                                        {activeGroup.isMine
                                            ? "My Story"
                                            : activeGroup.author?.fullName}
                                    </div>
                                    <div className="sync-story-time">
                                        {formatTime(activeStory.createdAt)}
                                    </div>
                                </div>
                            </div>

                            <div className="sync-story-actions">
                                {activeGroup.isMine && (
                                    <button
                                        type="button"
                                        className="sync-icon-btn light"
                                        title="Delete story"
                                        onClick={handleDeleteCurrentStory}
                                    >
                                        <Trash2 size={18} />
                                    </button>
                                )}
                                <button
                                    type="button"
                                    className="sync-icon-btn light"
                                    onClick={() => {
                                        setViewerState(null);
                                        setShowViewersList(false);
                                    }}
                                >
                                    <X size={20} />
                                </button>
                            </div>
                        </div>

                        <div
                            className="sync-story-content"
                            onClick={() => setShowPicker(false)}
                        >
                            <button
                                type="button"
                                className="sync-story-nav prev"
                                onClick={goPrevStory}
                            >
                                <ChevronLeft size={26} />
                            </button>

                            {activeStory.type === "text" && (
                                <div className="sync-story-text-canvas">
                                    {activeStory.caption}
                                </div>
                            )}

                            {activeStory.type === "image" &&
                                activeStory.media?.url && (
                                    <div className="sync-story-media-wrap">
                                        <img
                                            src={activeStory.media.url}
                                            alt={activeStory.caption || "story"}
                                        />
                                        {activeStory.caption && (
                                            <div className="sync-story-caption">
                                                {activeStory.caption}
                                            </div>
                                        )}
                                    </div>
                                )}

                            {activeStory.type === "video" &&
                                activeStory.media?.url && (
                                    <div className="sync-story-media-wrap">
                                        <video
                                            src={activeStory.media.url}
                                            controls
                                            autoPlay
                                        />
                                        {activeStory.caption && (
                                            <div className="sync-story-caption">
                                                {activeStory.caption}
                                            </div>
                                        )}
                                    </div>
                                )}

                            <button
                                type="button"
                                className="sync-story-nav next"
                                onClick={goNextStory}
                            >
                                <ChevronRight size={26} />
                            </button>
                        </div>

                        {!activeGroup.isMine && (
                            <div className="sync-story-footer sync-story-react-footer">
                                {showPicker && (
                                    <div className="sync-react-picker">
                                        {REACTION_GROUPS.map(group => (
                                            <div
                                                key={group.label}
                                                className="sync-react-group"
                                            >
                                                <div className="sync-react-group-label">
                                                    {group.label}
                                                </div>
                                                <div className="sync-react-grid">
                                                    {group.items.map(
                                                        (emoji, i) => (
                                                            <button
                                                                type="button"
                                                                key={emoji}
                                                                className={`sync-react-cell ${
                                                                    activeStory.myReaction ===
                                                                    emoji
                                                                        ? "active"
                                                                        : ""
                                                                }`}
                                                                style={{
                                                                    animationDelay: `${Math.min(
                                                                        i * 14,
                                                                        220
                                                                    )}ms`
                                                                }}
                                                                onClick={() =>
                                                                    handleReact(
                                                                        emoji
                                                                    )
                                                                }
                                                            >
                                                                {emoji}
                                                            </button>
                                                        )
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <div className="sync-react-bar">
                                    {activeStory.myReaction &&
                                        !QUICK_REACTIONS.includes(
                                            activeStory.myReaction
                                        ) && (
                                            <button
                                                type="button"
                                                className="sync-react-btn active"
                                                onClick={() =>
                                                    handleReact(
                                                        activeStory.myReaction
                                                    )
                                                }
                                            >
                                                {activeStory.myReaction}
                                            </button>
                                        )}
                                    {QUICK_REACTIONS.map((emoji, i) => (
                                        <button
                                            type="button"
                                            key={emoji}
                                            className={`sync-react-btn ${
                                                activeStory.myReaction === emoji
                                                    ? "active"
                                                    : ""
                                            }`}
                                            style={{
                                                animationDelay: `${i * 45}ms`
                                            }}
                                            onClick={() => handleReact(emoji)}
                                            aria-label={`React ${emoji}`}
                                        >
                                            {emoji}
                                        </button>
                                    ))}
                                    <button
                                        type="button"
                                        className={`sync-react-btn more ${
                                            showPicker ? "open" : ""
                                        }`}
                                        style={{
                                            animationDelay: `${
                                                QUICK_REACTIONS.length * 45
                                            }ms`
                                        }}
                                        onClick={() => setShowPicker(v => !v)}
                                        aria-label="More reactions"
                                    >
                                        <Plus size={20} />
                                    </button>
                                </div>

                                <form
                                    className="sync-story-reply"
                                    onSubmit={handleSendReply}
                                >
                                    <input
                                        type="text"
                                        placeholder={`Reply to ${
                                            (
                                                activeGroup.author?.fullName ||
                                                ""
                                            ).split(" ")[0] || "story"
                                        }...`}
                                        maxLength={1000}
                                        value={replyText}
                                        onChange={e =>
                                            setReplyText(e.target.value)
                                        }
                                        onFocus={() => setShowPicker(false)}
                                    />
                                    <button
                                        type="submit"
                                        className="sync-story-reply-send"
                                        disabled={!replyText.trim() || replying}
                                        aria-label="Send reply"
                                    >
                                        {replying ? (
                                            <Loader2
                                                size={18}
                                                className="spin"
                                            />
                                        ) : (
                                            <Send size={18} />
                                        )}
                                    </button>
                                </form>
                                {replyError && (
                                    <div className="sync-story-reply-error">
                                        {replyError}
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="sync-react-burst" aria-hidden="true">
                            {bursts.map(b => (
                                <div key={b.id} className="sync-burst">
                                    <div className="sync-burst-main">
                                        <span>{b.emoji}</span>
                                        {b.label && <em>{b.label}</em>}
                                    </div>
                                    {b.particles.map(p => (
                                        <span
                                            key={p.id}
                                            className="sync-burst-particle"
                                            style={{
                                                "--x": `${p.x}px`,
                                                "--r": `${p.rot}deg`,
                                                fontSize: `${p.size}px`,
                                                animationDelay: `${p.delay}ms`,
                                                animationDuration: `${p.dur}ms`
                                            }}
                                        >
                                            {b.emoji}
                                        </span>
                                    ))}
                                </div>
                            ))}
                        </div>

                        {toast && (
                            <div className="sync-story-toast" role="status">
                                <Check size={16} />
                                <span>{toast}</span>
                            </div>
                        )}

                        {activeGroup.isMine && (
                            <div className="sync-story-footer">
                                <button
                                    type="button"
                                    className="sync-viewers-pill"
                                    onClick={() =>
                                        setShowViewersList(v => !v)
                                    }
                                >
                                    <Eye size={16} />
                                    <span>
                                        {viewersByStoryId[activeStory._id]
                                            ?.length ??
                                            activeStory.viewCount ??
                                            0}{" "}
                                        views
                                    </span>
                                </button>

                                {Object.keys(activeStory.reactionSummary || {})
                                    .length > 0 && (
                                    <div className="sync-react-summary">
                                        {Object.entries(
                                            activeStory.reactionSummary
                                        ).map(([emoji, count]) => (
                                            <span
                                                key={emoji}
                                                className="sync-react-chip"
                                            >
                                                <span>{emoji}</span>
                                                <b>{count}</b>
                                            </span>
                                        ))}
                                    </div>
                                )}

                                {showViewersList && (
                                    <div className="sync-viewers-sheet">
                                        <h4>Viewed by</h4>
                                        {(
                                            viewersByStoryId[activeStory._id] ||
                                            []
                                        ).length === 0 ? (
                                            <p className="sync-empty-hint">
                                                No views yet
                                            </p>
                                        ) : (
                                            (
                                                viewersByStoryId[
                                                    activeStory._id
                                                ] || []
                                            ).map((v, i) => (
                                                <div
                                                    key={v.user?._id || i}
                                                    className="sync-user-row compact"
                                                >
                                                    <Avatar
                                                        src={v.user?.avatar}
                                                        name={v.user?.fullName}
                                                        size={32}
                                                    />
                                                    <div className="sync-user-meta">
                                                        <div className="sync-user-name">
                                                            {v.user?.fullName}
                                                        </div>
                                                        <div className="sync-user-sub">
                                                            {formatTime(
                                                                v.viewedAt
                                                            )}
                                                        </div>
                                                    </div>
                                                    {v.reaction && (
                                                        <span className="sync-viewer-reaction">
                                                            {v.reaction}
                                                        </span>
                                                    )}
                                                </div>
                                            ))
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {showCreateModal && (
                <div
                    className="sync-modal-backdrop"
                    onClick={() => setShowCreateModal(false)}
                >
                    <div
                        className="sync-modal-card"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="sync-modal-header">
                            <h3>Create 24h Story</h3>
                            <button
                                type="button"
                                className="sync-icon-btn"
                                onClick={() => setShowCreateModal(false)}
                            >
                                <X size={19} />
                            </button>
                        </div>

                        <form
                            className="sync-modal-body"
                            onSubmit={handleCreateStory}
                        >
                            <div className="sync-tab-pills">
                                <button
                                    type="button"
                                    className={`sync-pill-btn ${
                                        storyType === "text" ? "active" : ""
                                    }`}
                                    onClick={() => setStoryType("text")}
                                >
                                    <Type size={15} /> Text Status
                                </button>
                                <button
                                    type="button"
                                    className={`sync-pill-btn ${
                                        storyType === "media" ? "active" : ""
                                    }`}
                                    onClick={() => setStoryType("media")}
                                >
                                    <ImageIcon size={15} /> Photo / Video
                                </button>
                            </div>

                            {storyType === "text" ? (
                                <>
                                    <div
                                        className="sync-story-preview-box"
                                        style={{ backgroundColor: bgColor }}
                                    >
                                        <textarea
                                            placeholder="Type a status..."
                                            maxLength={700}
                                            value={caption}
                                            onChange={e =>
                                                setCaption(e.target.value)
                                            }
                                            required
                                        />
                                    </div>
                                    <div className="sync-color-palette">
                                        {STORY_COLORS.map(c => (
                                            <button
                                                type="button"
                                                key={c}
                                                className={`sync-color-swatch ${
                                                    bgColor === c
                                                        ? "selected"
                                                        : ""
                                                }`}
                                                style={{ backgroundColor: c }}
                                                onClick={() => setBgColor(c)}
                                            />
                                        ))}
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="sync-field">
                                        <label>Select Photo or Video *</label>
                                        <input
                                            type="file"
                                            accept="image/*,video/*"
                                            onChange={e =>
                                                setMediaFile(
                                                    e.target.files?.[0] || null
                                                )
                                            }
                                            required
                                        />
                                    </div>
                                    <div className="sync-field">
                                        <label>Caption (optional)</label>
                                        <input
                                            type="text"
                                            placeholder="Add a caption..."
                                            maxLength={700}
                                            value={caption}
                                            onChange={e =>
                                                setCaption(e.target.value)
                                            }
                                        />
                                    </div>
                                    {uploadProgress > 0 &&
                                        uploadProgress < 100 && (
                                            <div className="sync-progress-bar">
                                                <div
                                                    style={{
                                                        width: `${uploadProgress}%`
                                                    }}
                                                />
                                            </div>
                                        )}
                                </>
                            )}

                            {createError && (
                                <div className="sync-alert error">
                                    {createError}
                                </div>
                            )}

                            <div className="sync-modal-footer">
                                <button
                                    type="button"
                                    className="sync-btn ghost"
                                    onClick={() => setShowCreateModal(false)}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="sync-btn primary"
                                    disabled={posting}
                                >
                                    {posting ? "Posting..." : "Share Story"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
