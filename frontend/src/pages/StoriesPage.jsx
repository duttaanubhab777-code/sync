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
    Upload,
    Check,
    Pause,
    Play,
    Volume2,
    VolumeX,
    AlertCircle,
    RotateCw,
    Scissors
} from "lucide-react";
import Avatar from "../components/Avatar.jsx";
import SyncBrandBar from "../components/SyncBrandBar.jsx";
import MoreMenu from "../components/MoreMenu.jsx";
import UploadProgressCard from "../components/UploadProgressCard.jsx";
import VideoTrimmer from "../components/VideoTrimmer.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import {
    deleteMyStory,
    fetchStories,
    fetchStoryViewers,
    markStoryViewed,
    reactToStory,
    replyToStory
} from "../store/storySlice.js";
import {
    cancelUpload,
    enqueueStoryUpload,
    retryUpload
} from "../services/outbox.js";
import useUploadQueue from "../hooks/useUploadQueue.js";
import { pushBackHandler } from "../services/backNavigation.js";
import { detectMessageTypeFromFile } from "../services/media.js";
import { canTrimVideo, STORY_VIDEO_MAX_SECONDS } from "../utils/video.js";
import {
    formatChatListTime,
    formatTime
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
    const { storyGroups, loading, viewersByStoryId } = useSelector(
        state => state.story
    );

    const [showCreateModal, setShowCreateModal] = useState(false);
    const [confirmDeleteStory, setConfirmDeleteStory] = useState(false);
    const [storyType, setStoryType] = useState("text");
    const [caption, setCaption] = useState("");
    const [bgColor, setBgColor] = useState(STORY_COLORS[0]);
    const [mediaFile, setMediaFile] = useState(null);
    const [createError, setCreateError] = useState("");
    // ভিডিও trim: { start, end, total, trimmed } — এডিটরে Done চাপলে বসে
    const [trim, setTrim] = useState(null);
    const [trimmerOpen, setTrimmerOpen] = useState(false);
    // ব্যাকগ্রাউন্ডে চলা স্টোরি আপলোড/কমপ্রেশন কিউ (WhatsApp-এর মতো ট্যাব বদলালেও/কাটলেও চলে)
    const uploadQueue = useUploadQueue();
    const pendingStories = uploadQueue.filter(j => j.kind === "story");
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
    // বর্তমান story-র চলার সময় (ms) ও যেসব react animation আগেই চলে গেছে
    const posRef = useRef(0);
    const firedReactionsRef = useRef(new Set());
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
        posRef.current = 0;
        firedReactionsRef.current = new Set();
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
        // লাইভ animation এখনই চলল; টাইমলাইনে একই react যেন আবার না চলে
        firedReactionsRef.current.add(
            `${lastReaction.user?._id}|${lastReaction.emoji}|${lastReaction.offsetMs ?? 0}`
        );
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

    const handleCreateStory = e => {
        e.preventDefault();
        setCreateError("");

        if (storyType === "text" ? !caption.trim() : !mediaFile) {
            setCreateError(
                storyType === "text"
                    ? "Please write some text for your story"
                    : "Please select an image or video"
            );
            return;
        }

        // ব্যাকগ্রাউন্ড কিউতে (outbox) দেওয়া: মডাল সাথে সাথে বন্ধ হয়, কমপ্রেশন ও আপলোড ব্যাকগ্রাউন্ডে চলে
        enqueueStoryUpload({
            type: storyType === "text" ? "text" : "media",
            caption: caption.trim(),
            backgroundColor: bgColor,
            file: storyType === "text" ? null : mediaFile,
            trim:
                storyType !== "text" && pickedIsVideo && trim?.trimmed
                    ? { start: trim.start, end: trim.end }
                    : null
        });

        setCaption("");
        setMediaFile(null);
        setTrim(null);
        setTrimmerOpen(false);
        setShowCreateModal(false);
        showToast("Posting story in background…");
    };

    const openCreateModal = () => {
        setCreateError("");
        setShowCreateModal(true);
    };

    const closeCreateModal = () => {
        setShowCreateModal(false);
        setTrimmerOpen(false);
        setMediaFile(null);
        setTrim(null);
    };

    // ফাইল বাছা: ভিডিও হলে সাথে সাথে trim এডিটর খোলে (WhatsApp-এর মতো)
    const handleMediaPicked = e => {
        const f = e.target.files?.[0] || null;
        setMediaFile(f);
        setTrim(null);
        if (f && detectMessageTypeFromFile(f) === "video" && canTrimVideo()) {
            setTrimmerOpen(true);
        }
    };

    const handleTrimDone = result => {
        setTrim(result);
        setTrimmerOpen(false);
    };

    // প্রথমবার এডিটর বন্ধ করলে বাছাই বাতিল (WhatsApp-এর মতো); আবার Edit করে বন্ধ করলে আগের ছাঁটাই থাকে
    const handleTrimCancel = () => {
        setTrimmerOpen(false);
        if (!trim) {
            setMediaFile(null);
            const input = document.getElementById("sync-story-media-input");
            if (input) input.value = "";
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
                emoji: same ? null : emoji,
                offsetMs: posRef.current
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

    // ---- story চলার বর্তমান সময় (ms) + লেখকের জন্য react animation টাইমলাইন ----
    const handleProgress = (p, ms) => {
        progressRef.current?.set(p);
        const pos = Number.isFinite(ms) ? ms : 0;
        // আবার শুরু (পেছনে গেলে) হলে আগের চালানো animation গুলো আবার চলবে
        if (pos + 800 < posRef.current) firedReactionsRef.current.clear();
        posRef.current = pos;

        if (!activeGroup?.isMine || !activeStory?.reactionTimeline?.length) return;
        for (const r of activeStory.reactionTimeline) {
            const key = `${r.userId}|${r.emoji}|${r.offsetMs}`;
            if (r.offsetMs > pos || firedReactionsRef.current.has(key)) continue;
            firedReactionsRef.current.add(key);
            // সময় পেরিয়ে গেছে অনেক আগে (যেমন সিক করে) হলে animation বাদ; শুধু ঠিক সময়ের আশেপাশেরগুলো চলে
            if (pos - r.offsetMs > 1500) continue;
            const row = (viewersByStoryId?.[activeStory._id] || []).find(
                v => String(v.user?._id) === String(r.userId)
            );
            launchBurst(r.emoji, row?.user?.fullName || "");
        }
    };

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

    const pickedIsVideo = Boolean(mediaFile) && detectMessageTypeFromFile(mediaFile) === "video";
    const clipClock = sec => {
        const t = Math.max(0, Math.round(sec || 0));
        return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
    };

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

                    {pendingStories.length > 0 && (
                        <div className="sync-story-bg-queue">
                            {pendingStories.map(job => (
                                <div key={job.id} className="sync-story-bg-item">
                                    {job.stage === "failed" ? (
                                        <div className="sync-story-bg-failed" role="status">
                                            <AlertCircle size={16} />
                                            <span>{job.error || "Story upload failed"}</span>
                                            <button
                                                type="button"
                                                className="sync-bubble-upload-btn"
                                                onClick={() => retryUpload(job.id)}
                                            >
                                                <RotateCw size={13} /> Retry
                                            </button>
                                            <button
                                                type="button"
                                                className="sync-bubble-upload-btn ghost"
                                                onClick={() => cancelUpload(job.id)}
                                                aria-label="Cancel"
                                            >
                                                <X size={13} />
                                            </button>
                                        </div>
                                    ) : (
                                        <>
                                            <UploadProgressCard
                                                info={
                                                    job.info || {
                                                        file: job.file,
                                                        name: job.name || "Story",
                                                        size: job.size,
                                                        phase:
                                                            job.stage === "compressing"
                                                                ? "compressing"
                                                                : job.stage === "sending"
                                                                  ? "processing"
                                                                  : "preparing"
                                                    }
                                                }
                                            />
                                            <div className="sync-story-bg-actions">
                                                <button
                                                    type="button"
                                                    className="sync-upc-skip"
                                                    onClick={() => cancelUpload(job.id)}
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

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
                                    <div className="sync-field sync-story-upload-field">
                                        <label htmlFor="sync-story-media-input">
                                            Select Photo or Video <span aria-hidden="true">*</span>
                                        </label>
                                        <div className={`sync-story-upload-zone ${mediaFile ? "has-file" : ""}`}>
                                            <input
                                                id="sync-story-media-input"
                                                className="sync-story-file-input"
                                                type="file"
                                                accept="image/*,video/*"
                                                onChange={handleMediaPicked}
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
                                                            ? pickedIsVideo && trim?.trimmed
                                                                ? `${clipClock(trim.end - trim.start)} clip · Ready to upload`
                                                                : `${(mediaFile.size / (1024 * 1024)).toFixed(2)} MB · Ready to upload`
                                                            : "JPG, PNG, GIF or MP4 · Tap to browse"}
                                                    </small>
                                                </span>
                                                <span className="sync-story-browse-btn">
                                                    {mediaFile ? "Change" : "Browse"}
                                                </span>
                                            </label>
                                            {pickedIsVideo && trim && (
                                                <button
                                                    type="button"
                                                    className="sync-story-trim-chip"
                                                    onClick={() => setTrimmerOpen(true)}
                                                >
                                                    <Scissors size={18} />
                                                    <span className="txt">
                                                        <strong>
                                                            {trim.trimmed
                                                                ? `Trimmed to ${clipClock(trim.end - trim.start)}`
                                                                : "Full video"}
                                                        </strong>
                                                        <small>
                                                            {trim.trimmed
                                                                ? `${clipClock(trim.start)} – ${clipClock(trim.end)} of ${clipClock(trim.total)}`
                                                                : `${clipClock(trim.total)} · Tap to trim`}
                                                        </small>
                                                    </span>
                                                    <em>Edit</em>
                                                </button>
                                            )}
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
                                            onChange={e =>
                                                setCaption(e.target.value)
                                            }
                                        />
                                    </div>

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
                                    onClick={closeCreateModal}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="sync-btn primary"
                                >
                                    Share Story
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {trimmerOpen && mediaFile && (
                <VideoTrimmer
                    file={mediaFile}
                    initial={trim?.trimmed ? { start: trim.start, end: trim.end } : null}
                    maxSeconds={STORY_VIDEO_MAX_SECONDS}
                    onCancel={handleTrimCancel}
                    onDone={handleTrimDone}
                />
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
