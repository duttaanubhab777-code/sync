import React, { useEffect, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
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
    Check,
    Pause,
    Play,
    Volume2,
    VolumeX
} from "lucide-react";
import Avatar from "../components/Avatar.jsx";
import SyncBrandBar from "../components/SyncBrandBar.jsx";
import MoreMenu from "../components/MoreMenu.jsx";
import UploadProgressCard from "../components/UploadProgressCard.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
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
import { pushBackHandler } from "../services/backNavigation.js";
import {
    formatBytes,
    formatChatListTime,
    formatTime,
    generateClientMsgId
} from "../utils/format.js";
import StoryMedia from "../components/story/StoryMedia.jsx";
import StoryProgress from "../components/story/StoryProgress.jsx";

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
    const { hasUpdate = false, onSignOut } = useOutletContext() || {};
    const dispatch = useDispatch();
    const { user } = useSelector(state => state.auth);
    const { storyGroups, loading, posting, viewersByStoryId } = useSelector(
        state => state.story
    );

    const [showCreateModal, setShowCreateModal] = useState(false);
    const [confirmDeleteStory, setConfirmDeleteStory] = useState(false);
    const [storyType, setStoryType] = useState("text");
    const [caption, setCaption] = useState("");
    const [bgColor, setBgColor] = useState(STORY_COLORS[0]);
    const [mediaFile, setMediaFile] = useState(null);
    const [uploadProgress, setUploadProgress] = useState(0);
    // compress / upload-এর ধাপ ও সাইজ (original → compressed) দেখানোর জন্য
    const [uploadInfo, setUploadInfo] = useState(null);
    // ভিডিও compress চলাকালীন "Send original" চাপলে আসল ফাইলই আপলোড হয়
    const compressAbortRef = useRef(null);
    const [createError, setCreateError] = useState("");
    // Share Story একবার ট্যাপেই সাথে সাথে lock: state async বলে আলাদা ref দিয়ে সিঙ্ক্রোনাস গার্ড
    const [submitting, setSubmitting] = useState(false);
    const submittingRef = useRef(false);
    // এই story-র ইউনিক আইডি: ডাবল ট্যাপ/রিট্রাই হলেও সার্ভারে একবারই সেভ হয়
    const clientStoryIdRef = useRef(null);
    const replyingRef = useRef(false);

    const [viewerState, setViewerState] = useState(null);
    const [showViewersList, setShowViewersList] = useState(false);

    // ---- Story player v2: pause / mute / transition / gesture ----
    const [held, setHeld] = useState(false); // আঙুল চেপে ধরা
    const [userPaused, setUserPaused] = useState(false); // Pause বাটন
    const [muted, setMuted] = useState(false);
    const [replyFocused, setReplyFocused] = useState(false);
    const [tabHidden, setTabHidden] = useState(
        typeof document !== "undefined" ? document.hidden : false
    );
    const [closing, setClosing] = useState(false);
    const [nav, setNav] = useState({ dir: "open", n: 0 });
    const progressRef = useRef(null);
    const playerRef = useRef(null);
    const gestureRef = useRef(null);
    const closeTimerRef = useRef(null);

    const bumpNav = dir => {
        progressRef.current?.set(0);
        setNav(prev => ({ dir, n: prev.n + 1 }));
    };

    // সুন্দর করে বন্ধ (slide-down + fade)
    const closeViewer = () => {
        if (closeTimerRef.current) return;
        setClosing(true);
        closeTimerRef.current = setTimeout(() => {
            closeTimerRef.current = null;
            setViewerState(null);
            setShowViewersList(false);
            setClosing(false);
            setNav({ dir: "open", n: 0 });
        }, 230);
    };
    useEffect(() => () => clearTimeout(closeTimerRef.current), []);

    // ফোনের Back: আগে viewers লিস্ট, তারপর story viewer বন্ধ হবে (অ্যাপ বন্ধ হবে না)
    const viewerOpen = viewerState !== null;
    useEffect(() => {
        if (!viewerOpen) return undefined;
        return pushBackHandler(() => {
            if (showViewersList) setShowViewersList(false);
            else closeViewer();
            return true;
        });
    }, [viewerOpen, showViewersList]);

    // ট্যাব/অ্যাপ লুকালে স্টোরি আপনাআপনি থামে
    useEffect(() => {
        const onVis = () => setTabHidden(document.hidden);
        document.addEventListener("visibilitychange", onVis);
        return () => document.removeEventListener("visibilitychange", onVis);
    }, []);

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
        setHeld(false);
        setUserPaused(false);
        setReplyFocused(false);
    }, [activeStory?._id]);

    // পরের ছবিটা আগেই লোড করে রাখা (পরের স্টোরি ঝট করে খোলে)
    useEffect(() => {
        if (!activeGroup || viewerState === null) return;
        const nextInGroup = activeGroup.stories[viewerState.storyIdx + 1];
        const nextGroup = storyGroups[viewerState.groupIdx + 1];
        const nxt = nextInGroup || nextGroup?.stories?.[0];
        if (nxt?.type === "image" && nxt.media?.url) {
            const img = new Image();
            img.src = nxt.media.url;
        }
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
        // আগের রিকোয়েস্ট চলতে থাকলে (আপলোড বা সেভ) নতুন ট্যাপ/Enter একদম উপেক্ষা
        if (submittingRef.current || posting) return;
        setCreateError("");

        if (storyType === "text" ? !caption.trim() : !mediaFile) {
            setCreateError(
                storyType === "text"
                    ? "Please write some text for your story"
                    : "Please select an image or video"
            );
            return;
        }

        submittingRef.current = true;
        setSubmitting(true);
        if (!clientStoryIdRef.current) {
            clientStoryIdRef.current = generateClientMsgId();
        }
        const clientStoryId = clientStoryIdRef.current;

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
                        backgroundColor: bgColor,
                        clientStoryId
                    })
                ).unwrap();
            } else {
                if (!mediaFile) {
                    setCreateError("Please select an image or video");
                    return;
                }
                const abortCtrl = new AbortController();
                compressAbortRef.current = abortCtrl;
                setUploadInfo({
                    file: mediaFile,
                    name: mediaFile.name,
                    size: mediaFile.size,
                    phase: "preparing"
                });
                const media = await uploadMediaToCloudinary(
                    mediaFile,
                    (pct, info) => {
                        setUploadProgress(pct);
                        setUploadInfo({
                            file: mediaFile,
                            name: mediaFile.name,
                            size: mediaFile.size,
                            ...info
                        });
                    },
                    {
                        purpose: "story",
                        compress: true,
                        compressSignal: abortCtrl.signal
                    }
                );
                const detectedType = mediaFile.type.startsWith("video/")
                    ? "video"
                    : "image";
                await dispatch(
                    createNewStory({
                        type: detectedType,
                        caption: caption.trim(),
                        backgroundColor: bgColor,
                        media,
                        clientStoryId
                    })
                ).unwrap();
            }
            clientStoryIdRef.current = null; // পরের story-র জন্য নতুন আইডি
            setCaption("");
            setMediaFile(null);
            setUploadProgress(0);
            setUploadInfo(null);
            setShowCreateModal(false);
        } catch (err) {
            setCreateError(
                typeof err === "string"
                    ? err
                    : err?.message || "Could not post story"
            );
        } finally {
            submittingRef.current = false;
            setSubmitting(false);
        }
    };

    const openCreateModal = () => {
        clientStoryIdRef.current = null;
        setCreateError("");
        setShowCreateModal(true);
    };

    // পোস্ট চলার সময় modal বন্ধ করা যাবে না (আপলোড মাঝপথে ছেড়ে গেলে ভুতুড়ে পোস্ট হয়)
    const closeCreateModal = () => {
        if (submittingRef.current) return;
        setShowCreateModal(false);
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
        if (!text || replying || replyingRef.current || !activeStory) return;
        replyingRef.current = true;
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
            replyingRef.current = false;
            setReplying(false);
        }
    };

    const handleDeleteCurrentStory = () => {
        if (!activeStory) return;
        setConfirmDeleteStory(true);
    };

    const handleConfirmDeleteStory = async () => {
        if (!activeStory) {
            setConfirmDeleteStory(false);
            return;
        }
        setConfirmDeleteStory(false);
        await dispatch(deleteMyStory(activeStory._id));
        setViewerState(null);
        setShowViewersList(false);
        setClosing(false);
    };

    const goNextStory = () => {
        if (!activeGroup || viewerState === null || closing) return;
        if (viewerState.storyIdx + 1 < activeGroup.stories.length) {
            bumpNav("next");
            setViewerState({
                ...viewerState,
                storyIdx: viewerState.storyIdx + 1
            });
        } else if (viewerState.groupIdx + 1 < storyGroups.length) {
            bumpNav("group-next");
            setViewerState({
                groupIdx: viewerState.groupIdx + 1,
                storyIdx: 0
            });
        } else {
            closeViewer();
        }
        setShowViewersList(false);
    };

    const goPrevStory = () => {
        if (!activeGroup || viewerState === null || closing) return;
        if (viewerState.storyIdx > 0) {
            bumpNav("prev");
            setViewerState({
                ...viewerState,
                storyIdx: viewerState.storyIdx - 1
            });
            setShowViewersList(false);
        } else if (viewerState.groupIdx > 0) {
            const prevGroup = storyGroups[viewerState.groupIdx - 1];
            bumpNav("group-prev");
            setViewerState({
                groupIdx: viewerState.groupIdx - 1,
                storyIdx: Math.max(0, prevGroup.stories.length - 1)
            });
            setShowViewersList(false);
        } else {
            // প্রথম স্টোরিতে আবার ট্যাপ → শুরু থেকে রিস্টার্ট
            bumpNav("prev");
        }
    };

    // সোয়াইপ: পুরো গ্রুপ (এক ব্যক্তির সব স্টোরি) পাল্টানো
    const goGroup = delta => {
        if (viewerState === null || closing) return;
        const ni = viewerState.groupIdx + delta;
        if (ni < 0) return;
        if (ni >= storyGroups.length) {
            closeViewer();
            return;
        }
        bumpNav(delta > 0 ? "group-next" : "group-prev");
        setViewerState({ groupIdx: ni, storyIdx: 0 });
        setShowViewersList(false);
    };

    const handleProgress = p => progressRef.current?.set(p);

    // ---------- জেসচার: ট্যাপ (বাঁ/ডান), হোল্ড = পজ, সোয়াইপ ----------
    const resetDrag = () => {
        const el = playerRef.current;
        if (!el) return;
        el.style.transition =
            "transform .28s var(--ease), opacity .28s, border-radius .28s";
        el.style.transform = "";
        el.style.opacity = "";
        el.style.borderRadius = "";
        setTimeout(() => {
            if (playerRef.current) playerRef.current.style.transition = "";
        }, 320);
    };

    const onStagePointerDown = e => {
        if (e.target.closest("button")) return;
        if (e.pointerType === "mouse" && e.button !== 0) return;
        const g = {
            id: e.pointerId,
            x: e.clientX,
            y: e.clientY,
            dx: 0,
            dy: 0,
            moved: false,
            held: false,
            drag: false,
            timer: null
        };
        g.timer = setTimeout(() => {
            if (!g.moved) {
                g.held = true;
                setHeld(true);
            }
        }, 240);
        gestureRef.current = g;
        try {
            e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
            /* ignore */
        }
    };

    const onStagePointerMove = e => {
        const g = gestureRef.current;
        if (!g || g.id !== e.pointerId) return;
        g.dx = e.clientX - g.x;
        g.dy = e.clientY - g.y;
        if (!g.moved && Math.hypot(g.dx, g.dy) > 10) {
            g.moved = true;
            clearTimeout(g.timer);
            if (g.held) {
                g.held = false;
                setHeld(false);
            }
        }
        if (g.moved && g.dy > 0 && Math.abs(g.dy) > Math.abs(g.dx)) {
            g.drag = true;
            const el = playerRef.current;
            if (el) {
                el.style.transition = "none";
                el.style.transform = `translateY(${g.dy * 0.9}px) scale(${Math.max(
                    0.82,
                    1 - g.dy / 1400
                )})`;
                el.style.borderRadius = `${Math.min(32, g.dy / 5)}px`;
                el.style.opacity = String(Math.max(0.4, 1 - g.dy / 700));
            }
        }
    };

    const endGesture = (e, cancelled) => {
        const g = gestureRef.current;
        if (!g || g.id !== e.pointerId) return;
        clearTimeout(g.timer);
        gestureRef.current = null;
        if (g.held) setHeld(false);

        if (g.drag) {
            if (!cancelled && g.dy > 110) closeViewer();
            else resetDrag();
            return;
        }
        if (cancelled) return;

        const vertical = Math.abs(g.dy) > Math.abs(g.dx);
        if (g.moved && vertical && g.dy < -90 && activeGroup?.isMine) {
            setShowViewersList(true); // উপরে সোয়াইপ = viewers
            return;
        }
        if (g.moved && !vertical && Math.abs(g.dx) > 70) {
            goGroup(g.dx < 0 ? 1 : -1);
            return;
        }
        if (g.moved || g.held) return;

        // সাধারণ ট্যাপ
        if (showPicker) {
            setShowPicker(false);
            return;
        }
        if (showViewersList) {
            setShowViewersList(false);
            return;
        }
        const rect = e.currentTarget.getBoundingClientRect();
        const rel = (e.clientX - rect.left) / Math.max(1, rect.width);
        if (rel < 0.32) goPrevStory();
        else goNextStory();
    };

    // কিবোর্ড (ডেস্কটপ): ← → Space Esc M
    useEffect(() => {
        if (!viewerOpen) return undefined;
        const onKey = e => {
            const tag = (e.target?.tagName || "").toLowerCase();
            if (tag === "input" || tag === "textarea") return;
            if (e.key === "ArrowRight") goNextStory();
            else if (e.key === "ArrowLeft") goPrevStory();
            else if (e.key === " ") {
                e.preventDefault();
                setUserPaused(v => !v);
            } else if (e.key === "Escape") closeViewer();
            else if (e.key === "m" || e.key === "M") setMuted(v => !v);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    });

    const storyPaused =
        held ||
        userPaused ||
        showPicker ||
        showViewersList ||
        confirmDeleteStory ||
        replyFocused ||
        tabHidden ||
        closing;

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
                    <div className="sync-stories-header-actions">
                        <button
                            type="button"
                            className="sync-btn primary sm"
                            onClick={openCreateModal}
                        >
                            <Plus size={16} />
                            <span>Add Story</span>
                        </button>
                        <MoreMenu
                            hasUpdate={hasUpdate}
                            onSignOut={onSignOut}
                            className="sync-stories-more-btn"
                        />
                    </div>
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
                                openCreateModal();
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
                            onClick={openCreateModal}
                        >
                            <Plus size={17} />
                            <span>Post a Story</span>
                        </button>
                    </div>
                ) : (
                    <div
                        ref={playerRef}
                        className={`sync-story-player ${held ? "held" : ""} ${
                            closing ? "closing" : ""
                        }`}
                        style={{
                            backgroundColor:
                                activeStory.type === "text"
                                    ? activeStory.backgroundColor || "#0F4C3A"
                                    : "#070d10"
                        }}
                    >
                        <StoryProgress
                            ref={progressRef}
                            count={activeGroup.stories.length}
                            index={viewerState.storyIdx}
                        />

                        <div
                            className="sync-story-player-header"
                            key={activeGroup.author?._id || viewerState.groupIdx}
                        >
                            <div className="sync-story-author">
                                <div className="sync-sv-avatar">
                                    <Avatar
                                        src={activeGroup.author?.avatar}
                                        name={activeGroup.author?.fullName}
                                        size={38}
                                    />
                                </div>
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
                                <button
                                    type="button"
                                    className="sync-icon-btn light"
                                    title={userPaused ? "Play" : "Pause"}
                                    aria-label={userPaused ? "Play" : "Pause"}
                                    onClick={() => setUserPaused(v => !v)}
                                >
                                    <span
                                        key={userPaused ? "play" : "pause"}
                                        className="sync-sv-icon-swap"
                                    >
                                        {userPaused ? (
                                            <Play size={18} />
                                        ) : (
                                            <Pause size={18} />
                                        )}
                                    </span>
                                </button>
                                {activeStory.type === "video" && (
                                    <button
                                        type="button"
                                        className="sync-icon-btn light"
                                        title={muted ? "Unmute" : "Mute"}
                                        aria-label={muted ? "Unmute" : "Mute"}
                                        onClick={() => setMuted(v => !v)}
                                    >
                                        <span
                                            key={muted ? "off" : "on"}
                                            className="sync-sv-icon-swap"
                                        >
                                            {muted ? (
                                                <VolumeX size={18} />
                                            ) : (
                                                <Volume2 size={18} />
                                            )}
                                        </span>
                                    </button>
                                )}
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
                                    title="Close"
                                    onClick={closeViewer}
                                >
                                    <X size={20} />
                                </button>
                            </div>
                        </div>

                        <div
                            className="sync-story-content"
                            onPointerDown={onStagePointerDown}
                            onPointerMove={onStagePointerMove}
                            onPointerUp={e => endGesture(e, false)}
                            onPointerCancel={e => endGesture(e, true)}
                            onContextMenu={e => e.preventDefault()}
                        >
                            <button
                                type="button"
                                className="sync-story-nav prev"
                                aria-label="Previous"
                                onClick={goPrevStory}
                            >
                                <ChevronLeft size={26} />
                            </button>

                            <div
                                key={`${activeStory._id}_${nav.n}`}
                                className={`sync-sv-anim ${nav.dir}`}
                            >
                                <StoryMedia
                                    story={activeStory}
                                    paused={storyPaused}
                                    muted={muted}
                                    onProgress={handleProgress}
                                    onDone={goNextStory}
                                    onAutoplayBlocked={() => setMuted(true)}
                                />
                            </div>

                            {userPaused && (
                                <div className="sync-sv-pause-badge">
                                    <Pause size={32} />
                                </div>
                            )}

                            <button
                                type="button"
                                className="sync-story-nav next"
                                aria-label="Next"
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
                                        onFocus={() => {
                                            setShowPicker(false);
                                            setReplyFocused(true);
                                        }}
                                        onBlur={() => setReplyFocused(false)}
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
                    onClick={closeCreateModal}
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
                                onClick={closeCreateModal}
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
                                    disabled={submitting}
                                    onClick={() => setStoryType("text")}
                                >
                                    <Type size={15} /> Text Status
                                </button>
                                <button
                                    type="button"
                                    className={`sync-pill-btn ${
                                        storyType === "media" ? "active" : ""
                                    }`}
                                    disabled={submitting}
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
                                            readOnly={submitting}
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
                                    <div className="sync-field sync-story-upload-field">
                                        <label htmlFor="sync-story-media-input">
                                            Select Photo or Video <span aria-hidden="true">*</span>
                                        </label>
                                        <div className={`sync-story-upload-zone ${mediaFile ? "has-file" : ""} ${submitting ? "is-disabled" : ""}`}>
                                            <input
                                                id="sync-story-media-input"
                                                className="sync-story-file-input"
                                                type="file"
                                                accept="image/*,video/*"
                                                disabled={submitting}
                                                onChange={e => {
                                                    // ফাইল বদলালে নতুন story → নতুন আইডি
                                                    clientStoryIdRef.current = null;
                                                    setMediaFile(
                                                        e.target.files?.[0] || null
                                                    );
                                                }}
                                                required
                                            />
                                            <label
                                                className="sync-story-upload-trigger"
                                                htmlFor="sync-story-media-input"
                                            >
                                                <span className="sync-story-upload-icon">
                                                    {mediaFile ? (
                                                        <ImageIcon size={23} strokeWidth={1.9} />
                                                    ) : (
                                                        <Upload size={23} strokeWidth={1.9} />
                                                    )}
                                                </span>
                                                <span className="sync-story-upload-copy">
                                                    <strong>
                                                        {mediaFile ? mediaFile.name : "Choose a photo or video"}
                                                    </strong>
                                                    <small>
                                                        {mediaFile
                                                            ? `${(mediaFile.size / (1024 * 1024)).toFixed(2)} MB · Ready to upload`
                                                            : "JPG, PNG, GIF or MP4 · Tap to browse"}
                                                    </small>
                                                </span>
                                                <span className="sync-story-browse-btn">
                                                    {mediaFile ? "Change" : "Browse"}
                                                </span>
                                            </label>
                                            <div className="sync-story-upload-footnote">
                                                <span className="sync-story-upload-dot" />
                                                Your story will be visible for 24 hours
                                            </div>
                                        </div>
                                    </div>
                                    <div className="sync-field">
                                        <label>Caption (optional)</label>
                                        <input
                                            type="text"
                                            placeholder="Add a caption..."
                                            maxLength={700}
                                            value={caption}
                                            readOnly={submitting}
                                            onChange={e =>
                                                setCaption(e.target.value)
                                            }
                                        />
                                    </div>
                                    {submitting && uploadInfo && (
                                        <UploadProgressCard
                                            info={uploadInfo}
                                            onSkip={() =>
                                                compressAbortRef.current?.abort()
                                            }
                                        />
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
                                    disabled={submitting}
                                    onClick={closeCreateModal}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="sync-btn primary"
                                    disabled={posting || submitting}
                                >
                                    {posting || submitting
                                        ? uploadInfo?.phase === "compressing"
                                            ? Number.isFinite(uploadInfo?.compressPct)
                                                ? `Compressing ${Math.round(uploadInfo.compressPct)}%`
                                                : "Compressing..."
                                            : uploadProgress > 0 &&
                                                uploadProgress < 100
                                              ? `Uploading ${Math.round(uploadProgress)}%`
                                              : "Posting..."
                                        : "Share Story"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {confirmDeleteStory && (
                <ConfirmDialog
                    icon={Trash2}
                    title="Delete this story?"
                    message="Your story will be removed for everyone who can see it."
                    confirmLabel="Delete"
                    onConfirm={handleConfirmDeleteStory}
                    onCancel={() => setConfirmDeleteStory(false)}
                />
            )}
        </div>
    );
}
