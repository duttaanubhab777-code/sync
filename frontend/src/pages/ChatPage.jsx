import React, { useState, useEffect, useRef, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import {
    Search,
    UserPlus,
    Users,
    QrCode,
    Send,
    Paperclip,
    Mic,
    Pause,
    Play,
    Trash2,
    Info,
    ArrowLeft,
    Check,
    CheckCheck,
    Clock,
    AlertCircle,
    X,
    Lock,
    Loader2,
    MessageSquare,
    LogOut,
    Pin,
    BellOff,
    Forward,
    ChevronLeft,
    ChevronUp
} from "lucide-react";
import Avatar from "../components/Avatar.jsx";
import SyncBrandBar from "../components/SyncBrandBar.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import MessagePreview from "../components/MessagePreview.jsx";
import LinkPreviewCard from "../components/LinkPreviewCard.jsx";
import AttachmentSheet from "../components/chat/AttachmentSheet.jsx";
import LocationCard from "../components/chat/LocationCard.jsx";
import ContactCard from "../components/chat/ContactCard.jsx";
import DocumentCard from "../components/chat/DocumentCard.jsx";
import WelcomeCard from "../components/chat/WelcomeCard.jsx";
import BroadcastCard from "../components/chat/BroadcastCard.jsx";
import PollCard from "../components/chat/PollCard.jsx";
import PollIcon from "../components/chat/PollIcon.jsx";
import VoiceTrash from "../components/chat/VoiceTrash.jsx";
import CreatePollModal from "../components/chat/CreatePollModal.jsx";
import ForwardModal from "../components/chat/ForwardModal.jsx";
import VerifiedBadge from "../components/VerifiedBadge.jsx";
import { api } from "../services/api.js";
import MessageGesture from "../components/chat/MessageGesture.jsx";
import MessageActionSheet from "../components/chat/MessageActionSheet.jsx";
import { VoicePlayer, VideoPlayer } from "../components/MediaPlayers.jsx";
import {
    ActivityBubble,
    ActivityLabel
} from "../components/ActivityIndicator.jsx";
import useSignOut from "../hooks/useSignOut.js";
import {
    NewDirectChatModal,
    NewGroupChatModal,
    ChatInfoDrawer
} from "../components/Modals.jsx";
import {
    fetchMessages,
    pinConversationMessage,
    setActiveConversation,
    setReplyTo
} from "../store/chatSlice.js";
import {
    deleteSocketMessage,
    editSocketMessage,
    emitMessageSeen,
    emitTypingStart,
    emitTypingStop,
    reactSocketMessage,
    sendSocketMessage,
    voteSocketPoll
} from "../services/socket.js";
import { enqueueMediaMessage } from "../services/outbox.js";
import UploadBubbleOverlay from "../components/chat/UploadBubbleOverlay.jsx";
import CompressingCard from "../components/chat/CompressingCard.jsx";
import { playSound } from "../services/sounds.js";
import MoreMenu from "../components/MoreMenu.jsx";
import QrCodeModal from "../components/QrCodeModal.jsx";
import ChatFab from "../components/ChatFab.jsx";
import ChatWallpaperLayer from "../components/ChatWallpaperLayer.jsx";
import { useAppUpdates, isAndroidApp } from "../services/appUpdate.js";
import { pushBackHandler, goBackOr } from "../services/backNavigation.js";
import {
    formatBytes,
    formatChatListTime,
    formatDateDivider,
    formatLastSeen,
    formatTime,
    generateClientMsgId
} from "../utils/format.js";
import { LocalImg } from "../components/LocalImg.jsx";

const MESSAGE_URL_REGEX = /https?:\/\/[^\s<>"']+/gi;

function MessageLinkContent({ text }) {
    const matches = [...String(text || "").matchAll(MESSAGE_URL_REGEX)];
    if (!matches.length) return <>{text}</>;

    const parts = [];
    let cursor = 0;
    const links = [];

    matches.forEach((match, index) => {
        const rawUrl = match[0];
        const trailing = rawUrl.match(/[),.!?;:]+$/)?.[0] || "";
        const href = trailing ? rawUrl.slice(0, -trailing.length) : rawUrl;
        let parsed;
        try {
            parsed = new URL(href);
            if (!["http:", "https:"].includes(parsed.protocol)) return;
        } catch {
            return;
        }
        if (match.index > cursor) parts.push(text.slice(cursor, match.index));
        parts.push(
            <a
                key={`message-link-${index}`}
                href={parsed.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={event => event.stopPropagation()}
                className="sync-message-link"
            >
                {href}
            </a>,
            trailing
        );
        links.push({ href: parsed.href, host: parsed.hostname });
        cursor = match.index + rawUrl.length;
    });

    if (!links.length) return <>{text}</>;
    if (cursor < text.length) parts.push(text.slice(cursor));

    const preview = links[0];
    // WhatsApp-এর মত: কার্ড উপরে, তার নিচে মেসেজের লেখা
    return (
        <>
            <LinkPreviewCard href={preview.href} host={preview.host} />
            {parts}
        </>
    );
}

// টিক: হোয়াটসঅ্যাপের মতো নয়, আলাদা রঙে আর ছোট ক্যাপসুলের ভেতরে, যাতে সবুজ বাবলেও স্পষ্ট বোঝা যায়
//   ⏱ পাঠানো হচ্ছে  ·  ✓ সাদা = সার্ভারে গেছে  ·  ✓✓ সাদা = পৌঁছেছে  ·  ✓✓ সোনালি = দেখেছে
function StatusTick({ status, optimistic, failed }) {
    if (failed) {
        return (
            <span className="sync-tick failed" title="Failed to send">
                <AlertCircle size={14} />
            </span>
        );
    }
    if (optimistic) {
        return (
            <span className="sync-tick pending" title="Sending...">
                <Clock size={13} />
            </span>
        );
    }
    if (status === "seen") {
        return (
            <span className="sync-tick seen" title="Seen">
                <CheckCheck size={16} strokeWidth={2.6} />
            </span>
        );
    }
    if (status === "delivered") {
        return (
            <span className="sync-tick delivered" title="Delivered">
                <CheckCheck size={16} strokeWidth={2.4} />
            </span>
        );
    }
    return (
        <span className="sync-tick sent" title="Sent">
            <Check size={15} strokeWidth={2.6} />
        </span>
    );
}

const formatReplySnippet = target => {
    if (!target) return "";
    if (target.deletedForEveryone) return "This message was deleted";
    if (target.text) return target.text;
    if (target.type === "location") {
        return target.location?.address
            ? `📍 ${target.location.address}`
            : "📍 Location";
    }
    if (target.type === "contact") {
        return target.contact?.name
            ? `👤 Contact: ${target.contact.name}`
            : "👤 Contact";
    }
    if (target.type === "file") {
        return target.media?.fileName
            ? `📎 ${target.media.fileName}`
            : "📎 Attachment";
    }
    if (target.type === "poll") {
        return target.poll?.question
            ? `📊 ${target.poll.question}`
            : "📊 Poll";
    }
    return `[${String(target.type || "media").toUpperCase()}]`;
};


// রিপ্লাই কোটে মিডিয়া হলে আইকনসহ দেখায়, টেক্সট হলে সাধারণ টেক্সট
function ReplySnippet({ target }) {
    if (!target) return null;
    if (target.deletedForEveryone) {
        return <MessagePreview deleted />;
    }
    if (target.text) return <>{target.text}</>;
    return (
        <MessagePreview
            type={target.type}
            text={formatReplySnippet(target)}
        />
    );
}

const VOICE_BAR_COUNT = 40;
const MIN_VOICE_MS = 800;
// mic চেপে ধরা (hold-to-record): কত ms ধরলে hold ধরা হবে, আর কতটা swipe করলে কী হবে
const HOLD_DELAY_MS = 260;
const HOLD_DELETE_PX = 96; // বামে এতটা টানলে ছাড়লে delete
const HOLD_PAUSE_UP_PX = 56; // উপরে এতটা টানলেই pause (mic ডান কিনারায় থাকে, তাই ডানে নয়, উপরে)
const HOLD_SLOP_PX = 14; // hold শুরুর আগে এর বেশি নড়লে hold বাতিল

function formatRecTime(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const sec = totalSeconds % 60;
    return `${m}:${String(sec).padStart(2, "0")}`;
}

export default function ChatPage() {
    const { conversationId } = useParams();
    const navigate = useNavigate();
    const dispatch = useDispatch();
    const signOut = useSignOut();
    const [confirmLogout, setConfirmLogout] = useState(false);
    const [confirmDeleteMsgId, setConfirmDeleteMsgId] = useState(null);
    const [deletingMsg, setDeletingMsg] = useState(false);
    const [loggingOut, setLoggingOut] = useState(false);

    const handleConfirmLogout = async () => {
        setLoggingOut(true);
        await signOut();
    };

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
    const [showQr, setShowQr] = useState(false);
    const [showNewGroup, setShowNewGroup] = useState(false);
    const [showInfoDrawer, setShowInfoDrawer] = useState(false);

    const [draftText, setDraftText] = useState("");
    const uploadingMedia = false; // আপলোড এখন composer আটকায় না: ইউজার লিখতে/পাঠাতে থাকতে পারে
    const convListRef = useRef(null);
    const { hasUpdate } = useAppUpdates({ autoLoad: isAndroidApp });
    const composerInputRef = useRef(null);
    // মেসেজ টিপে ধরলে যেটার মেনু খোলা (Reply / React / Edit / Forward / Pin / Info / Delete)
    const [sheetMsg, setSheetMsg] = useState(null);
    // শিট কোন ভিউতে খুলবে: "menu" | "reactions" (রিয়্যাকশন পিলে ট্যাপ করলে)
    const [sheetView, setSheetView] = useState("menu");
    const [editingMsg, setEditingMsg] = useState(null);
    const [forwardMsg, setForwardMsg] = useState(null);
    const [showCreatePoll, setShowCreatePoll] = useState(false);
    const [showChatSearch, setShowChatSearch] = useState(false);
    const [chatSearchQuery, setChatSearchQuery] = useState("");
    const [chatSearchResults, setChatSearchResults] = useState([]);
    const [chatSearching, setChatSearching] = useState(false);
    const [highlightedMsgId, setHighlightedMsgId] = useState(null);
    const msgRowRefs = useRef(new Map());
    useEffect(() => {
        setSheetMsg(null);
        setEditingMsg(null);
        setShowChatSearch(false);
        setChatSearchQuery("");
        setChatSearchResults([]);
        setHighlightedMsgId(null);
    }, [activeConversationId]);
    const [composerError, setComposerError] = useState("");

    // চ্যাটের ভেতর মেসেজ সার্চ (debounce 250ms)
    useEffect(() => {
        if (!showChatSearch || !activeConversationId) return;
        const q = chatSearchQuery.trim();
        if (q.length < 2) {
            setChatSearchResults([]);
            return;
        }
        const t = setTimeout(async () => {
            setChatSearching(true);
            try {
                const res = await api.get(
                    `/api/v1/conversations/${activeConversationId}/search?q=${encodeURIComponent(q)}`
                );
                setChatSearchResults(res.data?.data?.messages || []);
            } catch {
                setChatSearchResults([]);
            } finally {
                setChatSearching(false);
            }
        }, 250);
        return () => clearTimeout(t);
    }, [showChatSearch, chatSearchQuery, activeConversationId]);

    const jumpToMessage = msgId => {
        const key = String(msgId || "");
        const el = msgRowRefs.current.get(key);
        if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            setHighlightedMsgId(key);
            setTimeout(() => {
                setHighlightedMsgId(cur => (cur === key ? null : cur));
            }, 2200);
        }
    };
    const [showMicrophoneHelp, setShowMicrophoneHelp] = useState(false);
    const [showAttachSheet, setShowAttachSheet] = useState(false);
    const [lightboxUrl, setLightboxUrl] = useState(null);

    // ফোনের Back চাপলে info drawer আগে বন্ধ হবে (পেজ ছেড়ে অ্যাপ বন্ধ হবে না)
    useEffect(() => {
        if (!showInfoDrawer) return undefined;
        return pushBackHandler(() => {
            setShowInfoDrawer(false);
            return true;
        });
    }, [showInfoDrawer]);

    // recPhase: "idle" | "recording" | "paused" | "discarding"
    const [recPhase, setRecPhase] = useState("idle");
    const [recordingSeconds, setRecordingSeconds] = useState(0);
    const isRecording = recPhase !== "idle";
    // hold-to-record: আঙুল mic-এ থাকা অবস্থায় true; holdArm = বাম swipe-এ delete প্রস্তুত কিনা
    const [holdMode, setHoldMode] = useState(false);
    const [holdArm, setHoldArm] = useState(null);
    const [pausedFromHold, setPausedFromHold] = useState(false);
    const holdRef = useRef({
        active: false,
        pointerId: null,
        startX: 0,
        startY: 0,
        dx: 0,
        started: false,
        released: false,
        done: false,
        timer: 0
    });
    const composerBarRef = useRef(null);
    const recStartingRef = useRef(false);
    const voiceActionsRef = useRef({});
    const mediaRecorderRef = useRef(null);
    const audioChunksRef = useRef([]);
    const recordTimerRef = useRef(null);
    const recStreamRef = useRef(null);
    const recAudioCtxRef = useRef(null);
    const recAnalyserRef = useRef(null);
    const recRafRef = useRef(0);
    const recDiscardRef = useRef(false);
    const recElapsedRef = useRef(0);
    const recLastTickRef = useRef(0);
    const recLevelsRef = useRef(new Array(VOICE_BAR_COUNT).fill(0.08));
    const recBarsRef = useRef([]);
    const recDiscardTimerRef = useRef(null);
    const recContextRef = useRef({ conversationId: null, replyingTo: null });

    const messagesEndRef = useRef(null);
    const typingStopTimerRef = useRef(null);
    const isTypingSentRef = useRef(false);

    useEffect(() => {
        setShowAttachSheet(false);
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
            const isOfficialGroup = Boolean(conv.isOfficial);
            return {
                title: conv.groupName || "Unnamed Group",
                avatar: conv.groupIcon || "",
                isGroup: true,
                isOfficialGroup,
                isOfficialAccount: false,
                online: false,
                subtitle: isOfficialGroup
                    ? `Official Group · ${(conv.members || []).length} members`
                    : `${(conv.members || []).length} members`
            };
        }
        const p = conv.partner || {};
        const isOfficialAccount = Boolean(p.isOfficial);
        const pId = String(p._id || "");
        const isOnline = isOfficialAccount
            ? false
            : Boolean(onlineUsers[pId] ?? p.online);
        const lastSeen = lastSeenByUser[pId] || p.lastSeen;
        return {
            title: p.fullName || p.username || "Sync User",
            avatar: p.avatar || "",
            isGroup: false,
            isOfficialGroup: false,
            isOfficialAccount,
            online: isOnline,
            subtitle: isOfficialAccount
                ? "Official Sync account"
                : isOnline
                  ? "Online"
                  : formatLastSeen(lastSeen)
        };
    };

    // কে কী করছে: { activity: "typing" | "recording", names: [...] } অথবা null
    // একই সময়ে কেউ ভয়েস রেকর্ড করলে সেটাই আগে দেখানো হয়
    const getTypingInfo = convId => {
        const map = typingByConv[String(convId)] || {};
        const entries = Object.entries(map)
            .filter(([uid]) => uid !== myId)
            .map(([, v]) =>
                typeof v === "string" ? { name: v, activity: "typing" } : v
            );
        if (entries.length === 0) return null;
        const recording = entries.filter(e => e.activity === "recording");
        const picked = recording.length > 0 ? recording : entries;
        return {
            activity: recording.length > 0 ? "recording" : "typing",
            names: picked.map(e => e.name)
        };
    };

    const canSendInActive = useMemo(() => {
        if (!activeConversation) return false;
        if (
            activeConversation.type === "direct" &&
            activeConversation.partner?.isOfficial
        ) {
            return false;
        }
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

    // লেখা বাড়লে ইনপুট বক্স নিজে থেকে উঁচু হয় (সর্বোচ্চ ~5 লাইন), তারপর ভেতরে স্ক্রল
    useEffect(() => {
        const el = composerInputRef.current;
        if (!el) return;
        el.style.height = "auto";
        el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
    }, [draftText, isRecording, activeConversationId]);

    // ভয়েস রেকর্ড চলার সময় অন্যপাশে "recording audio..." দেখাতে হার্টবিট পাঠানো হয়
    // (receiver ৪.৫ সেকেন্ড পর নিজে থেকে মুছে ফেলে, তাই ২.৫ সেকেন্ড পরপর নতুন করে পাঠাই)
    useEffect(() => {
        if (recPhase !== "recording" || !activeConversationId) return undefined;
        const convId = activeConversationId;
        if (typingStopTimerRef.current) {
            clearTimeout(typingStopTimerRef.current);
            typingStopTimerRef.current = null;
        }
        isTypingSentRef.current = false;
        emitTypingStart(convId, "recording");
        const timer = setInterval(
            () => emitTypingStart(convId, "recording"),
            2500
        );
        return () => {
            clearInterval(timer);
            emitTypingStop(convId);
        };
    }, [recPhase, activeConversationId]);

    const lastTypingEmitRef = useRef(0);

    const handleTypingChange = val => {
        setDraftText(val);
        if (!activeConversationId) return;

        // সব লেখা মুছে ফেললে সাথে সাথে typing বন্ধ
        if (val.trim().length === 0) {
            if (typingStopTimerRef.current) {
                clearTimeout(typingStopTimerRef.current);
                typingStopTimerRef.current = null;
            }
            if (isTypingSentRef.current) {
                isTypingSentRef.current = false;
                emitTypingStop(activeConversationId);
            }
            return;
        }

        // লিখতে থাকলে ২.৫ সেকেন্ড পরপর আবার পাঠাই, নইলে অন্যপাশে ৪.৫ সেকেন্ড পর indicator হারিয়ে যেত
        const now = Date.now();
        if (
            !isTypingSentRef.current ||
            now - lastTypingEmitRef.current > 2500
        ) {
            isTypingSentRef.current = true;
            lastTypingEmitRef.current = now;
            emitTypingStart(activeConversationId, "typing");
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

        // এডিট মোডে থাকলে নতুন মেসেজ না পাঠিয়ে পুরনো মেসেজ এডিট করা
        if (editingMsg) {
            const targetId = editingMsg._id;
            setEditingMsg(null);
            setDraftText("");
            setComposerError("");
            const ack = await editSocketMessage(targetId, text);
            if (!ack?.ok) {
                setComposerError(
                    ack?.error === "EDIT_WINDOW_EXPIRED"
                        ? "Messages can only be edited within 15 minutes"
                        : ack?.error || "Could not edit message"
                );
            }
            return;
        }

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

    // এক বা একাধিক ফাইল background queue-তে দেওয়া। সাথে সাথে চ্যাটে মেসেজ বসে যায় (প্রিভিউ সহ)
    // আর আপলোড/পাঠানো পেজের বাইরে চলে: চ্যাট ছেড়ে গেলে, অ্যাপ minimize করলে বা নেট কেটে গেলেও থামে না।
    // options.asDocument = true হলে (Document বোতাম থেকে) কোনো compress হবে না, আসল ফাইলই যাবে
    const handleFilesSelected = (selectedFiles, options = {}) => {
        const files = Array.from(selectedFiles || []).filter(Boolean);
        if (files.length === 0 || !activeConversationId || !canSendInActive) return;

        const targetConvId = activeConversationId;
        let pendingCaption = draftText.trim();
        let pendingReply = replyingTo;
        setComposerError("");

        for (const file of files) {
            const replyForThis = pendingReply;
            if (replyForThis) {
                pendingReply = null;
                dispatch(setReplyTo({ conversationId: targetConvId, message: null }));
            }
            const captionForThis = pendingCaption;
            if (captionForThis) {
                pendingCaption = "";
                setDraftText("");
            }
            enqueueMediaMessage({
                file,
                conversationId: targetConvId,
                caption: captionForThis,
                replyToMessage: replyForThis,
                asDocument: Boolean(options?.asDocument)
            });
        }
    };

    const handleSendLocation = async locationData => {
        if (!locationData || !activeConversationId || !canSendInActive) return;
        setComposerError("");
        const replyTarget = replyingTo;
        if (replyTarget) {
            dispatch(
                setReplyTo({
                    conversationId: activeConversationId,
                    message: null
                })
            );
        }
        const caption = draftText.trim();
        if (caption) setDraftText("");

        const ack = await sendSocketMessage({
            conversationId: activeConversationId,
            clientMsgId: generateClientMsgId(),
            type: "location",
            text: caption,
            location: locationData,
            replyToMessage: replyTarget
        });
        if (ack && !ack.ok && !ack.queued) {
            setComposerError(`Location error: ${ack.error || "Failed to send"}`);
        }
    };

    const handleSendContact = async contactData => {
        if (!contactData || !activeConversationId || !canSendInActive) return;
        setComposerError("");
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
            type: "contact",
            text: "",
            contact: contactData,
            replyToMessage: replyTarget
        });
        if (ack && !ack.ok && !ack.queued) {
            setComposerError(`Contact error: ${ack.error || "Failed to send"}`);
        }
    };

    // ---- Voice recording: record → (pause / resume) → Send or Delete ----

    const paintWaveform = () => {
        const bars = recBarsRef.current;
        const levels = recLevelsRef.current;
        for (let i = 0; i < bars.length; i += 1) {
            const el = bars[i];
            if (el) el.style.transform = `scaleY(${Math.max(0.08, levels[i] || 0.08)})`;
        }
    };

    const teardownRecordingResources = () => {
        cancelAnimationFrame(recRafRef.current);
        recRafRef.current = 0;
        clearInterval(recordTimerRef.current);
        recordTimerRef.current = null;
        recStreamRef.current?.getTracks().forEach(track => track.stop());
        recStreamRef.current = null;
        recAnalyserRef.current = null;
        const ctx = recAudioCtxRef.current;
        recAudioCtxRef.current = null;
        if (ctx && ctx.state !== "closed") ctx.close().catch(() => {});
    };

    const startWaveform = stream => {
        recLevelsRef.current = new Array(VOICE_BAR_COUNT).fill(0.08);
        paintWaveform();
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) {
                const ctx = new AudioCtx();
                ctx.resume?.().catch(() => {});
                const analyser = ctx.createAnalyser();
                analyser.fftSize = 512;
                ctx.createMediaStreamSource(stream).connect(analyser);
                recAudioCtxRef.current = ctx;
                recAnalyserRef.current = analyser;
            }
        } catch {
            recAnalyserRef.current = null;
        }

        const buffer = new Uint8Array(512);
        let lastPush = 0;
        const loop = now => {
            recRafRef.current = requestAnimationFrame(loop);
            const recorder = mediaRecorderRef.current;
            if (!recorder || recorder.state !== "recording") return;
            if (now - lastPush < 70) return;
            lastPush = now;

            let level;
            const analyser = recAnalyserRef.current;
            if (analyser) {
                analyser.getByteTimeDomainData(buffer);
                let sum = 0;
                for (let i = 0; i < buffer.length; i += 1) {
                    const v = (buffer[i] - 128) / 128;
                    sum += v * v;
                }
                level = Math.min(1, Math.sqrt(sum / buffer.length) * 4.2);
            } else {
                level = 0.2 + Math.random() * 0.5;
            }
            const levels = recLevelsRef.current;
            levels.push(level);
            levels.shift();
            paintWaveform();
        };
        recRafRef.current = requestAnimationFrame(loop);
    };

    // ভয়েস মেসেজও background queue দিয়ে যায় (নেট গেলে নিজে অপেক্ষা করে আবার পাঠায়)
    const uploadAndSendVoice = (audioFile, conversationId, replyTarget) => {
        enqueueMediaMessage({
            file: audioFile,
            conversationId,
            replyToMessage: replyTarget,
            purpose: "voice",
            type: "audio"
        });
        if (replyTarget) {
            dispatch(setReplyTo({ conversationId, message: null }));
        }
    };

    const startVoiceRecording = async () => {
        if (recPhase !== "idle") return false;
        // getUserMedia requires HTTPS (or localhost) and a user gesture.
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
            setComposerError(
                "Microphone access requires a secure HTTPS connection. Open Sync using its HTTPS address and try again."
            );
            return false;
        }
        if (typeof window.MediaRecorder === "undefined") {
            setComposerError("Voice recording is not supported by this browser.");
            return false;
        }

        // টাচ + ক্লিক একসাথে এলেও দুটো রেকর্ডার যেন না চলে
        if (recStartingRef.current) return false;
        recStartingRef.current = true;
        // রেকর্ডার চালুর আগেই বাজে, যাতে শব্দটা রেকর্ডিংয়ে না ঢোকে
        playSound("recStart");

        setComposerError("");
        setShowMicrophoneHelp(false);
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
            recDiscardRef.current = false;
            recElapsedRef.current = 0;
            clearTimeout(recDiscardTimerRef.current);
            recContextRef.current = {
                conversationId: activeConversationId,
                replyingTo
            };

            recorder.ondataavailable = evt => {
                if (evt.data.size > 0) audioChunksRef.current.push(evt.data);
            };

            recorder.onerror = () => {
                teardownRecordingResources();
                recDiscardRef.current = true;
                setRecPhase("idle");
                setRecordingSeconds(0);
                setComposerError("The microphone recording could not be started. Please try again.");
            };

            recorder.onstop = () => {
                // a stale recorder must not tear down a newer recording
                if (mediaRecorderRef.current === recorder) {
                    teardownRecordingResources();
                }
                const discarded = recDiscardRef.current;
                const chunks = audioChunksRef.current;
                audioChunksRef.current = [];
                if (discarded || chunks.length === 0) return;

                setRecPhase("idle");
                setRecordingSeconds(0);

                const blob = new Blob(chunks, { type: recordingType });
                const extension = recordingType.includes("mp4") ? "m4a" : "webm";
                const audioFile = new File(
                    [blob],
                    `voice_${Date.now()}.${extension}`,
                    { type: recordingType }
                );
                const { conversationId, replyingTo: replyTarget } =
                    recContextRef.current;
                uploadAndSendVoice(audioFile, conversationId, replyTarget);
            };

            mediaRecorderRef.current = recorder;
            recStreamRef.current = stream;
            recorder.start();
            startWaveform(stream);
            setRecPhase("recording");
            setRecordingSeconds(0);
            recLastTickRef.current = Date.now();
            recordTimerRef.current = setInterval(() => {
                const now = Date.now();
                if (mediaRecorderRef.current?.state === "recording") {
                    recElapsedRef.current += now - recLastTickRef.current;
                    setRecordingSeconds(Math.floor(recElapsedRef.current / 1000));
                }
                recLastTickRef.current = now;
            }, 200);
            recStartingRef.current = false;
            return true;
        } catch (err) {
            recStartingRef.current = false;
            stream?.getTracks().forEach(track => track.stop());
            teardownRecordingResources();
            const messages = {
                NotAllowedError: "Please allow microphone access in your browser to record a voice message.",
                PermissionDeniedError: "Please allow microphone access in your browser to record a voice message.",
                NotFoundError: "No microphone was found on this device.",
                NotReadableError: "The microphone is already in use by another app."
            };
            if (
                err?.name === "NotAllowedError" ||
                err?.name === "PermissionDeniedError" ||
                err?.name === "SecurityError"
            ) {
                setShowMicrophoneHelp(true);
            } else {
                setComposerError(
                    messages[err?.name] ||
                    err?.message ||
                    "Could not access the microphone. Check your browser permissions and try again."
                );
            }
            return false;
        }
    };

    const togglePauseVoiceRecording = () => {
        const recorder = mediaRecorderRef.current;
        if (!recorder) return;
        if (recorder.state === "recording") {
            recElapsedRef.current += Date.now() - recLastTickRef.current;
            recorder.pause();
            setRecPhase("paused");
            playSound("recPause");
        } else if (recorder.state === "paused") {
            // সাউন্ড আগে বাজে, তারপর একটু পরে resume — তাই শব্দ রেকর্ডিংয়ে ঢোকে না
            playSound("recPlay");
            setTimeout(() => {
                if (recorder.state !== "paused") return;
                recLastTickRef.current = Date.now();
                recorder.resume();
                recAudioCtxRef.current?.resume?.().catch(() => {});
                setRecPhase("recording");
            }, 300);
        }
    };

    // Delete: throw the recording away with a short exit animation.
    const discardVoiceRecording = (silent = false) => {
        const recorder = mediaRecorderRef.current;
        recDiscardRef.current = true;
        audioChunksRef.current = [];
        if (recorder && recorder.state !== "inactive") {
            try { recorder.stop(); } catch { /* already stopped */ }
        }
        teardownRecordingResources();
        clearTimeout(recDiscardTimerRef.current);
        if (silent) {
            setRecPhase("idle");
            setRecordingSeconds(0);
            return;
        }
        setRecPhase("discarding");
        playSound("recDelete");
        recDiscardTimerRef.current = setTimeout(() => {
            setRecPhase("idle");
            setRecordingSeconds(0);
        }, 460);
    };

    // Send: only now the voice message is uploaded and delivered.
    const sendVoiceRecording = () => {
        const recorder = mediaRecorderRef.current;
        if (!recorder || recorder.state === "inactive") return;
        if (recPhase === "recording") {
            recElapsedRef.current += Date.now() - recLastTickRef.current;
        }
        if (recElapsedRef.current < MIN_VOICE_MS) {
            discardVoiceRecording();
            setComposerError("Voice message is too short. Hold on a little longer.");
            return;
        }
        recDiscardRef.current = false;
        recorder.stop();
    };

    // ---- Hold-to-record: mic চেপে ধরলে রেকর্ড · ছাড়লে send · বামে swipe = delete · উপরে swipe = pause ----
    // (ছোট টাচ/ক্লিক আগের মতই locked রেকর্ডিং চালু করে: delete · pause/play · send বাটনসহ)
    voiceActionsRef.current = {
        start: startVoiceRecording,
        send: sendVoiceRecording,
        discard: discardVoiceRecording,
        togglePause: togglePauseVoiceRecording
    };

    const buzz = ms => {
        try {
            navigator.vibrate?.(ms);
        } catch {
            /* সব ডিভাইসে নেই */
        }
    };

    // swipe-এর দূরত্ব CSS variable-এ বসে (re-render ছাড়া, তাই লাগে না)
    const setHoldVisual = (dx, dy = 0) => {
        const bar = composerBarRef.current;
        if (!bar) return;
        const clamped = Math.max(-150, Math.min(30, dx));
        bar.style.setProperty("--hold-dx", `${clamped}px`);
        bar.style.setProperty(
            "--hold-dy",
            `${Math.max(-90, Math.min(0, dy))}px`
        );
        bar.style.setProperty(
            "--hold-p",
            String(Math.min(1, Math.max(0, -dx / HOLD_DELETE_PX)))
        );
    };

    const beginHoldRecording = async () => {
        const h = holdRef.current;
        h.timer = 0;
        if (!h.active || h.done) return;
        h.started = true;
        h.dx = 0;
        setHoldVisual(0);
        setHoldArm(null);
        setHoldMode(true);
        buzz(12);
        const ok = await voiceActionsRef.current.start();
        if (!ok) {
            h.active = false;
            h.done = true;
            setHoldMode(false);
            return;
        }
        if (h.released || !h.active) {
            // মাইক চালু হওয়ার আগেই (যেমন পারমিশন প্রম্পটে) আঙুল উঠে গেছে → locked রেকর্ডিং হয়ে চলবে
            h.done = true;
            setHoldMode(false);
        }
    };

    const handleMicPointerDown = e => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        if (recPhase !== "idle" || uploadingMedia) return;
        const h = holdRef.current;
        clearTimeout(h.timer);
        Object.assign(h, {
            active: true,
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            dx: 0,
            started: false,
            released: false,
            done: false
        });
        try {
            e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
            /* ignore */
        }
        h.timer = setTimeout(beginHoldRecording, HOLD_DELAY_MS);
    };

    const handleMicPointerMove = e => {
        const h = holdRef.current;
        if (!h.active || e.pointerId !== h.pointerId) return;
        const dx = e.clientX - h.startX;

        if (!h.started) {
            // hold শুরুর আগেই বেশি নড়লে এটা hold নয়, বাতিল
            if (
                Math.abs(dx) > HOLD_SLOP_PX ||
                Math.abs(e.clientY - h.startY) > HOLD_SLOP_PX
            ) {
                clearTimeout(h.timer);
                h.timer = 0;
                h.active = false;
            }
            return;
        }
        if (h.done) return;

        const dy = e.clientY - h.startY;
        h.dx = dx;
        setHoldVisual(dx, dy);

        // উপরে swipe → সাথে সাথে pause, তারপর locked প্যানেল (delete · play · send)
        if (dy <= -HOLD_PAUSE_UP_PX && Math.abs(dy) > Math.abs(dx) * 0.8) {
            if (mediaRecorderRef.current?.state === "recording") {
                h.done = true;
                buzz(14);
                voiceActionsRef.current.togglePause();
                setPausedFromHold(true);
                setHoldMode(false);
                setHoldArm(null);
                setHoldVisual(0, 0);
            }
            return;
        }

        // বামে যথেষ্ট টানলে delete "প্রস্তুত" (ছাড়লে মুছে যাবে), ফিরিয়ে আনলে বাতিল
        const arm = dx <= -HOLD_DELETE_PX ? "delete" : null;
        setHoldArm(prev => {
            if (prev !== arm && arm) buzz(10);
            return prev === arm ? prev : arm;
        });
    };

    const handleMicPointerUp = e => {
        const h = holdRef.current;
        if (!h.active || e.pointerId !== h.pointerId) return;
        clearTimeout(h.timer);
        h.timer = 0;
        h.active = false;
        h.released = true;
        try {
            e.currentTarget.releasePointerCapture?.(e.pointerId);
        } catch {
            /* ignore */
        }

        // hold হওয়ার আগেই ছেড়ে দিয়েছে = সাধারণ টাচ → locked রেকর্ডিং
        if (!h.started) {
            voiceActionsRef.current.start();
            return;
        }
        if (h.done) return;
        const rec = mediaRecorderRef.current;
        // মাইক এখনও চালু হচ্ছে: beginHoldRecording নিজে locked রেকর্ডিংয়ে পাল্টে দেবে
        if (!rec || rec.state === "inactive") return;

        h.done = true;
        if (h.dx <= -HOLD_DELETE_PX) {
            voiceActionsRef.current.discard();
        } else {
            voiceActionsRef.current.send();
        }
    };

    // ব্রাউজার/সিস্টেম টাচ কেড়ে নিলে রেকর্ডিং হারাবে না, locked রেকর্ডিং হয়ে চলবে
    const handleMicPointerCancel = e => {
        const h = holdRef.current;
        if (!h.active || e.pointerId !== h.pointerId) return;
        clearTimeout(h.timer);
        h.timer = 0;
        h.active = false;
        h.released = true;
        if (h.started && !h.done) {
            h.done = true;
            setHoldMode(false);
            setHoldArm(null);
            setHoldVisual(0);
        }
    };

    // রেকর্ডিং শেষ (send/delete) হলে hold-সংক্রান্ত সব কিছু পরিষ্কার
    useEffect(() => {
        if (recPhase !== "idle") return;
        setHoldMode(false);
        setHoldArm(null);
        setPausedFromHold(false);
        const bar = composerBarRef.current;
        bar?.style.removeProperty("--hold-dx");
        bar?.style.removeProperty("--hold-dy");
        bar?.style.removeProperty("--hold-p");
    }, [recPhase]);

    useEffect(() => () => clearTimeout(holdRef.current.timer), []);

    // Leaving the chat (or switching conversation) while recording cancels it.
    useEffect(() => {
        return () => {
            if (mediaRecorderRef.current?.state && mediaRecorderRef.current.state !== "inactive") {
                recDiscardRef.current = true;
                try { mediaRecorderRef.current.stop(); } catch { /* ignore */ }
            }
            teardownRecordingResources();
            clearTimeout(recDiscardTimerRef.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (
            recContextRef.current.conversationId &&
            String(recContextRef.current.conversationId) !== String(activeConversationId) &&
            mediaRecorderRef.current?.state &&
            mediaRecorderRef.current.state !== "inactive"
        ) {
            discardVoiceRecording(true);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeConversationId]);

    const handleCreatePoll = async pollData => {
        if (!activeConversationId || !canSendInActive) return;
        const ack = await sendSocketMessage({
            conversationId: activeConversationId,
            clientMsgId: generateClientMsgId(),
            type: "poll",
            poll: pollData
        });
        if (ack && !ack.ok && !ack.queued) {
            throw new Error(ack.error || "Could not send poll");
        }
    };

    const handleReactMessage = async (msgId, emoji) => {
        if (!msgId || !emoji) return;
        const ack = await reactSocketMessage(msgId, emoji);
        if (!ack?.ok) {
            setComposerError(ack?.error || "Could not react to message");
        }
    };

    const handleTogglePinMessage = async msg => {
        if (!activeConversationId || !msg?._id) return;
        const alreadyPinned =
            String(activeConversation?.pinnedMessage?.messageId || "") ===
            String(msg._id);
        try {
            await dispatch(
                pinConversationMessage({
                    conversationId: activeConversationId,
                    messageId: alreadyPinned ? null : msg._id
                })
            ).unwrap();
        } catch (err) {
            setComposerError(
                typeof err === "string" ? err : "Could not update pinned message"
            );
        }
    };

    const handleDeleteMessage = msgId => {
        setConfirmDeleteMsgId(msgId);
    };

    const handleConfirmDeleteMessage = async () => {
        const msgId = confirmDeleteMsgId;
        if (!msgId) return;
        setDeletingMsg(true);
        const ack = await deleteSocketMessage(msgId);
        if (!ack?.ok) {
            setComposerError(ack?.error || "Could not delete message");
        }
        setDeletingMsg(false);
        setConfirmDeleteMsgId(null);
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
    const activeTypingInfo = activeConversationId
        ? getTypingInfo(activeConversationId)
        : null;
    const activeIsGroup = activeConversation?.type === "group";

    // নিচের দিকে থাকলে typing বাবল আসার সময় স্ক্রল নামিয়ে আনি
    const typingBubbleShown = Boolean(activeTypingInfo);
    const typingBubbleKind = activeTypingInfo?.activity || "";
    useEffect(() => {
        if (!typingBubbleShown) return;
        const end = messagesEndRef.current;
        const viewport = end?.parentElement;
        if (!viewport) return;
        const gap =
            viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
        if (gap < 240) end.scrollIntoView({ behavior: "smooth", block: "end" });
    }, [typingBubbleShown, typingBubbleKind]);

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
                        {/* ডেস্কটপে জায়গা আছে বলে সরাসরি বাটন; মোবাইলে এগুলো floating বাটনে */}
                        <button
                            type="button"
                            className="sync-icon-btn sync-desk-only"
                            title="New Direct Chat"
                            aria-label="New Direct Chat"
                            onClick={() => setShowNewDirect(true)}
                        >
                            <UserPlus size={19} />
                        </button>
                        <button
                            type="button"
                            className="sync-icon-btn sync-desk-only"
                            title="Create Group"
                            aria-label="Create Group"
                            onClick={() => setShowNewGroup(true)}
                        >
                            <Users size={19} />
                        </button>
                        <button
                            type="button"
                            className="sync-icon-btn sync-desk-only"
                            title="QR code & scan"
                            aria-label="QR code and scan"
                            onClick={() => setShowQr(true)}
                        >
                            <QrCode size={19} />
                        </button>
                        <MoreMenu
                            hasUpdate={hasUpdate}
                            onSignOut={() => setConfirmLogout(true)}
                        />
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

                <div className="sync-conv-list" ref={convListRef}>
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
                        const typingInfo = getTypingInfo(conv._id);
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
                                    showOnline={
                                        !info.isGroup && !info.isOfficialAccount
                                    }
                                    online={info.online}
                                />

                                <div className="sync-conv-main">
                                    <div className="sync-conv-top">
                                        <span className="sync-conv-name sync-name-with-badge">
                                            <span className="sync-name-text">
                                                {info.title}
                                            </span>
                                            {info.isOfficialGroup && (
                                                <VerifiedBadge
                                                    variant="group"
                                                    size={15}
                                                />
                                            )}
                                            {info.isOfficialAccount && (
                                                <VerifiedBadge
                                                    variant="official"
                                                    size={15}
                                                />
                                            )}
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
                                                typingInfo ? "typing" : ""
                                            }`}
                                        >
                                            {typingInfo ? (
                                                <ActivityLabel
                                                    info={typingInfo}
                                                    isGroup={
                                                        conv.type === "group"
                                                    }
                                                />
                                            ) : (
                                                conv.lastMessage ? (
                                                    <MessagePreview
                                                        type={
                                                            conv.lastMessage
                                                                .type
                                                        }
                                                        text={
                                                            conv.lastMessage
                                                                .text
                                                        }
                                                        fallback="No messages yet"
                                                    />
                                                ) : (
                                                    "No messages yet"
                                                )
                                            )}
                                        </span>
                                        {(conv.isPinned || conv.isMuted) && (
                                            <span className="sync-conv-flags">
                                                {conv.isPinned && (
                                                    <Pin
                                                        size={12}
                                                        className="is-pinned"
                                                        title="Pinned chat"
                                                    />
                                                )}
                                                {conv.isMuted && (
                                                    <BellOff
                                                        size={12}
                                                        title="Notifications muted"
                                                    />
                                                )}
                                            </span>
                                        )}
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

                <ChatFab
                    scrollRef={convListRef}
                    onNewChat={() => setShowNewDirect(true)}
                    onNewGroup={() => setShowNewGroup(true)}
                    onQr={() => setShowQr(true)}
                />
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
                        <ChatWallpaperLayer />
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
                                        goBackOr(navigate, "/chats");
                                    }}
                                >
                                    <ArrowLeft size={20} />
                                </button>
                                <Avatar
                                    src={activeDisplay.avatar}
                                    name={activeDisplay.title}
                                    size={42}
                                    isGroup={activeDisplay.isGroup}
                                    showOnline={
                                        !activeDisplay.isGroup &&
                                        !activeDisplay.isOfficialAccount
                                    }
                                    online={activeDisplay.online}
                                />
                                <div className="sync-header-meta">
                                    <div className="sync-header-title sync-name-with-badge">
                                        <span className="sync-name-text">
                                            {activeDisplay.title}
                                        </span>
                                        {activeDisplay.isOfficialGroup && (
                                            <VerifiedBadge
                                                variant="group"
                                                size={17}
                                            />
                                        )}
                                        {activeDisplay.isOfficialAccount && (
                                            <VerifiedBadge
                                                variant="official"
                                                size={17}
                                            />
                                        )}
                                    </div>
                                    <div
                                        className={`sync-header-sub ${
                                            activeTypingInfo ? "typing" : ""
                                        }`}
                                    >
                                        {activeTypingInfo ? (
                                            <ActivityLabel
                                                info={activeTypingInfo}
                                                isGroup={activeIsGroup}
                                            />
                                        ) : (
                                            activeDisplay.subtitle
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="sync-chat-header-right">
                                <button
                                    type="button"
                                    className={`sync-icon-btn ${
                                        showChatSearch ? "active" : ""
                                    }`}
                                    title="Search in chat"
                                    aria-label="Search in chat"
                                    onClick={() => setShowChatSearch(v => !v)}
                                >
                                    <Search size={19} />
                                </button>
                                <button
                                    type="button"
                                    className={`sync-icon-btn ${
                                        showInfoDrawer ? "active" : ""
                                    }`}
                                    title="Conversation Info"
                                    aria-label="Conversation Info"
                                    onClick={() => setShowInfoDrawer(v => !v)}
                                >
                                    <Info size={20} />
                                </button>
                                <MoreMenu
                                    hasUpdate={hasUpdate}
                                    onSignOut={() => setConfirmLogout(true)}
                                    className="sync-chat-more-btn"
                                />
                            </div>
                        </header>

                        {showChatSearch && (
                            <div className="sync-inchat-search">
                                <div className="sync-inchat-search-row">
                                    <div className="sync-search-input-wrap">
                                        <Search size={15} />
                                        <input
                                            type="text"
                                            placeholder="Search messages in this chat..."
                                            value={chatSearchQuery}
                                            onChange={e =>
                                                setChatSearchQuery(e.target.value)
                                            }
                                            autoFocus
                                        />
                                    </div>
                                    <button
                                        type="button"
                                        className="sync-icon-btn xs"
                                        onClick={() => {
                                            setShowChatSearch(false);
                                            setChatSearchQuery("");
                                            setChatSearchResults([]);
                                        }}
                                        aria-label="Close search"
                                    >
                                        <X size={16} />
                                    </button>
                                </div>
                                {chatSearching && (
                                    <div className="sync-muted">Searching...</div>
                                )}
                                {!chatSearching &&
                                    chatSearchQuery.trim().length >= 2 &&
                                    chatSearchResults.length === 0 && (
                                        <div className="sync-muted">
                                            No matching messages found.
                                        </div>
                                    )}
                                {chatSearchResults.length > 0 && (
                                    <div className="sync-inchat-results">
                                        {chatSearchResults.map(m => (
                                            <button
                                                key={m._id}
                                                type="button"
                                                className="sync-inchat-result-item"
                                                onClick={() => {
                                                    jumpToMessage(m._id);
                                                    setShowChatSearch(false);
                                                }}
                                            >
                                                <div className="sync-inchat-result-top">
                                                    <strong>
                                                        {m.sender?.fullName ||
                                                            m.sender?.username ||
                                                            "Member"}
                                                    </strong>
                                                    <span>
                                                        {formatChatListTime(
                                                            m.createdAt
                                                        )}
                                                    </span>
                                                </div>
                                                <div className="sync-inchat-result-text">
                                                    {m.type === "poll" ? (
                                                        <MessagePreview
                                                            type="poll"
                                                            text={`📊 ${m.poll?.question || "Poll"}`}
                                                        />
                                                    ) : (
                                                        m.text ||
                                                        m.media?.fileName ||
                                                        ""
                                                    )}
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {activeConversation?.pinnedMessage?.messageId && (
                            <div
                                className="sync-pinned-bar"
                                onClick={() =>
                                    jumpToMessage(
                                        activeConversation.pinnedMessage
                                            .messageId
                                    )
                                }
                            >
                                <span className="sync-pinned-accent" />
                                <div className="sync-pinned-body">
                                    <span className="sync-pinned-label">
                                        <Pin size={12} /> Pinned message
                                        {activeConversation.pinnedMessage
                                            .senderName
                                            ? ` · ${activeConversation.pinnedMessage.senderName}`
                                            : ""}
                                    </span>
                                    <span className="sync-pinned-text">
                                        {activeConversation.pinnedMessage.text}
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    className="sync-icon-btn xs"
                                    title="Unpin message"
                                    onClick={e => {
                                        e.stopPropagation();
                                        dispatch(
                                            pinConversationMessage({
                                                conversationId:
                                                    activeConversationId,
                                                messageId: null
                                            })
                                        );
                                    }}
                                >
                                    <X size={15} />
                                </button>
                            </div>
                        )}

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
                                            ref={el => {
                                                if (msg._id) {
                                                    if (el)
                                                        msgRowRefs.current.set(
                                                            String(msg._id),
                                                            el
                                                        );
                                                    else
                                                        msgRowRefs.current.delete(
                                                            String(msg._id)
                                                        );
                                                }
                                            }}
                                        >
                                        <MessageGesture
                                            className={`sync-msg-row ${
                                                isMine ? "outgoing" : "incoming"
                                            } ${
                                                highlightedMsgId ===
                                                String(msg._id)
                                                    ? "is-highlighted"
                                                    : ""
                                            }`}
                                            disabled={Boolean(
                                                msg.deletedForEveryone ||
                                                    msg.optimistic ||
                                                    msg.failed ||
                                                    !msg._id
                                            )}
                                            onReply={() => {
                                                dispatch(
                                                    setReplyTo({
                                                        conversationId:
                                                            activeConversationId,
                                                        message: msg
                                                    })
                                                );
                                                composerInputRef.current?.focus();
                                            }}
                                            onLongPress={() => {
                                                setSheetView("menu");
                                                setSheetMsg(msg);
                                            }}
                                        >
                                            <div
                                                className={`sync-msg-bubble ${
                                                    msg.deletedForEveryone
                                                        ? "deleted"
                                                        : ""
                                                } ${
                                                    !msg.deletedForEveryone &&
                                                    msg.card?.kind === "welcome"
                                                        ? "has-welcome-card"
                                                        : !msg.deletedForEveryone &&
                                                            msg.card?.kind ===
                                                                "broadcast"
                                                          ? "has-broadcast-card"
                                                          : ""
                                                }`}
                                            >
                                                {msg.forwarded &&
                                                    !msg.deletedForEveryone && (
                                                        <div className="sync-msg-forwarded">
                                                            <Forward size={12} />
                                                            <span>Forwarded</span>
                                                        </div>
                                                    )}
                                                {activeConversation.type ===
                                                    "group" &&
                                                    !isMine && (
                                                        <div className="sync-msg-sender-name sync-name-with-badge">
                                                            <span className="sync-name-text">
                                                                {msg.sender
                                                                    ?.fullName ||
                                                                    msg.sender
                                                                        ?.username ||
                                                                    "Member"}
                                                            </span>
                                                            {msg.sender
                                                                ?.isOfficial && (
                                                                <VerifiedBadge
                                                                    variant="official"
                                                                    size={13}
                                                                />
                                                            )}
                                                        </div>
                                                    )}

                                                {msg.storyReply &&
                                                    !msg.deletedForEveryone && (
                                                        <div className="sync-msg-story-quote">
                                                            <div
                                                                className="story-thumb"
                                                                style={
                                                                    msg
                                                                        .storyReply
                                                                        .thumbnail
                                                                        ? {
                                                                              backgroundImage: `url(${msg.storyReply.thumbnail})`
                                                                          }
                                                                        : {
                                                                              backgroundColor:
                                                                                  msg
                                                                                      .storyReply
                                                                                      .backgroundColor ||
                                                                                  "#0F4C3A"
                                                                          }
                                                                }
                                                            >
                                                                {!msg
                                                                    .storyReply
                                                                    .thumbnail &&
                                                                    msg
                                                                        .storyReply
                                                                        .type ===
                                                                        "text" &&
                                                                    (msg
                                                                        .storyReply
                                                                        .caption ||
                                                                        "")}
                                                            </div>
                                                            <div className="story-meta">
                                                                <span className="story-label">
                                                                    {isMine
                                                                        ? "You replied to a story"
                                                                        : "Replied to your story"}
                                                                </span>
                                                                <span className="story-text">
                                                                    {msg
                                                                        .storyReply
                                                                        .caption ||
                                                                        (msg
                                                                            .storyReply
                                                                            .type ===
                                                                        "video"
                                                                            ? "Video story"
                                                                            : "Photo story")}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    )}

                                                {msg.replyTo &&
                                                    !msg.deletedForEveryone && (
                                                        <div className="sync-msg-reply-quote">
                                                            <span className="reply-bar" />
                                                            <div className="reply-content">
                                                                <p>
                                                                    <ReplySnippet
                                                                        target={
                                                                            msg.replyTo
                                                                        }
                                                                    />
                                                                </p>
                                                            </div>
                                                        </div>
                                                    )}

                                                {!msg.deletedForEveryone &&
                                                    msg.type === "image" &&
                                                    msg.media?.url && (
                                                        <div className="sync-msg-media-img">
                                                            <LocalImg
                                                                url={
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
                                                        <VideoPlayer
                                                            src={msg.media.url}
                                                            duration={
                                                                msg.media
                                                                    .duration
                                                            }
                                                            width={
                                                                msg.media.width
                                                            }
                                                            height={
                                                                msg.media.height
                                                            }
                                                        />
                                                    )}

                                                {!msg.deletedForEveryone &&
                                                    msg.type === "audio" &&
                                                    msg.media?.url && (
                                                        <VoicePlayer
                                                            src={msg.media.url}
                                                            duration={
                                                                msg.media
                                                                    .duration
                                                            }
                                                        />
                                                    )}

                                                {!msg.deletedForEveryone &&
                                                    msg.type === "file" &&
                                                    msg.media?.url && (
                                                        <DocumentCard
                                                            media={msg.media}
                                                        />
                                                    )}

                                                {!msg.deletedForEveryone &&
                                                    msg.type === "location" &&
                                                    msg.location && (
                                                        <LocationCard
                                                            location={
                                                                msg.location
                                                            }
                                                        />
                                                    )}

                                                {!msg.deletedForEveryone &&
                                                    msg.type === "contact" &&
                                                    msg.contact && (
                                                        <ContactCard
                                                            contact={
                                                                msg.contact
                                                            }
                                                        />
                                                    )}

                                                {!msg.deletedForEveryone &&
                                                msg.type === "poll" &&
                                                msg.poll ? (
                                                    <PollCard
                                                        poll={msg.poll}
                                                        myId={myId}
                                                        members={
                                                            activeConversation?.members ||
                                                            []
                                                        }
                                                        disabled={Boolean(
                                                            msg.optimistic ||
                                                                msg.failed
                                                        )}
                                                        onVote={optionId =>
                                                            voteSocketPoll(
                                                                msg._id,
                                                                optionId
                                                            )
                                                        }
                                                    />
                                                ) : !msg.deletedForEveryone &&
                                                  msg.card?.kind === "welcome" ? (
                                                    <WelcomeCard
                                                        name={
                                                            msg.card?.name ||
                                                            currentUser?.fullName ||
                                                            ""
                                                        }
                                                    />
                                                ) : !msg.deletedForEveryone &&
                                                  msg.card?.kind ===
                                                      "broadcast" ? (
                                                    <BroadcastCard
                                                        card={msg.card}
                                                    />
                                                ) : (
                                                    (msg.text ||
                                                        msg.deletedForEveryone) && (
                                                        <div className="sync-msg-text">
                                                            {msg.deletedForEveryone
                                                                ? <MessagePreview deleted />
                                                                : <MessageLinkContent text={msg.text} />}
                                                        </div>
                                                    )
                                                )}

                                                {msg.uploadLocal &&
                                                    (msg.optimistic || msg.failed) && (
                                                        <UploadBubbleOverlay
                                                            clientMsgId={msg.clientMsgId}
                                                        />
                                                    )}

                                                {!msg.deletedForEveryone &&
                                                    Array.isArray(
                                                        msg.reactions
                                                    ) &&
                                                    msg.reactions.length > 0 && (() => {
                                                        const counts = new Map();
                                                        for (const r of msg.reactions) {
                                                            const cur = counts.get(
                                                                r.emoji
                                                            ) || {
                                                                count: 0,
                                                                mine: false
                                                            };
                                                            cur.count += 1;
                                                            if (
                                                                String(
                                                                    r.user
                                                                        ?._id ??
                                                                        r.user
                                                                ) === myId
                                                            ) {
                                                                cur.mine = true;
                                                            }
                                                            counts.set(
                                                                r.emoji,
                                                                cur
                                                            );
                                                        }
                                                        return (
                                                            <div className="sync-msg-reactions">
                                                                {[
                                                                    ...counts.entries()
                                                                ].map(
                                                                    ([
                                                                        emoji,
                                                                        info
                                                                    ]) => (
                                                                        <button
                                                                            key={
                                                                                emoji
                                                                            }
                                                                            type="button"
                                                                            className={`sync-reaction-pill ${
                                                                                info.mine
                                                                                    ? "mine"
                                                                                    : ""
                                                                            }`}
                                                                            title="See who reacted"
                                                                            onClick={e => {
                                                                                e.stopPropagation();
                                                                                setSheetView(
                                                                                    "reactions"
                                                                                );
                                                                                setSheetMsg(
                                                                                    msg
                                                                                );
                                                                            }}
                                                                        >
                                                                            <span>
                                                                                {
                                                                                    emoji
                                                                                }
                                                                            </span>
                                                                            {info.count >
                                                                                1 && (
                                                                                <span>
                                                                                    {
                                                                                        info.count
                                                                                    }
                                                                                </span>
                                                                            )}
                                                                        </button>
                                                                    )
                                                                )}
                                                            </div>
                                                        );
                                                    })()}

                                                <div className="sync-msg-meta">
                                                    {msg.editedAt &&
                                                        !msg.deletedForEveryone && (
                                                            <span className="sync-msg-edited">
                                                                Edited
                                                            </span>
                                                        )}
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
                                            </div>
                                        </MessageGesture>
                                        </div>
                                    </React.Fragment>
                                );
                            })}

                            <ActivityBubble
                                info={activeTypingInfo}
                                isGroup={activeIsGroup}
                            />

                            <div ref={messagesEndRef} />

                            {sheetMsg && (() => {
                                const sheetIsMine =
                                    String(
                                        sheetMsg.sender?._id ?? sheetMsg.sender
                                    ) === myId;
                                const canEditSheet =
                                    sheetIsMine &&
                                    sheetMsg.type === "text" &&
                                    !sheetMsg.card?.kind &&
                                    !sheetMsg.deletedForEveryone &&
                                    Date.now() -
                                        new Date(
                                            sheetMsg.createdAt
                                        ).getTime() <=
                                        15 * 60 * 1000;
                                const canForwardSheet =
                                    !sheetMsg.deletedForEveryone &&
                                    sheetMsg.type !== "poll" &&
                                    !sheetMsg.card?.kind;
                                const sheetPinned =
                                    String(
                                        activeConversation?.pinnedMessage
                                            ?.messageId || ""
                                    ) === String(sheetMsg._id);
                                return (
                                    <MessageActionSheet
                                        message={sheetMsg}
                                        isMine={sheetIsMine}
                                        myId={myId}
                                        isPinned={sheetPinned}
                                        canEdit={canEditSheet}
                                        canForward={canForwardSheet}
                                        canPin={!sheetMsg.deletedForEveryone}
                                        members={activeConversation?.members || []}
                                        initialView={sheetView}
                                        preview={
                                            <ReplySnippet target={sheetMsg} />
                                        }
                                        onClose={() => setSheetMsg(null)}
                                        onReply={() => {
                                            setEditingMsg(null);
                                            dispatch(
                                                setReplyTo({
                                                    conversationId:
                                                        activeConversationId,
                                                    message: sheetMsg
                                                })
                                            );
                                            composerInputRef.current?.focus();
                                        }}
                                        onReact={emoji =>
                                            handleReactMessage(
                                                sheetMsg._id,
                                                emoji
                                            )
                                        }
                                        onEdit={() => {
                                            dispatch(
                                                setReplyTo({
                                                    conversationId:
                                                        activeConversationId,
                                                    message: null
                                                })
                                            );
                                            setEditingMsg(sheetMsg);
                                            setDraftText(sheetMsg.text || "");
                                            composerInputRef.current?.focus();
                                        }}
                                        onForward={() =>
                                            setForwardMsg(sheetMsg)
                                        }
                                        onTogglePin={() =>
                                            handleTogglePinMessage(sheetMsg)
                                        }
                                        onDelete={() =>
                                            handleDeleteMessage(sheetMsg._id)
                                        }
                                    />
                                );
                            })()}
                        </div>

                        <footer className="sync-composer-wrap">
                            {showMicrophoneHelp && (
                                <div
                                    className="sync-permission-backdrop"
                                    role="presentation"
                                    onClick={() => setShowMicrophoneHelp(false)}
                                >
                                    <section
                                        className="sync-permission-card"
                                        role="dialog"
                                        aria-modal="true"
                                        aria-labelledby="sync-mic-title"
                                        onClick={event => event.stopPropagation()}
                                    >
                                        <div className="sync-permission-icon">
                                            <Mic size={25} />
                                        </div>
                                        <h3 id="sync-mic-title">Allow microphone access</h3>
                                        <p>
                                            Sync needs microphone permission to record voice messages.
                                            Tap Try Again and choose Allow in your browser prompt.
                                        </p>
                                        <div className="sync-permission-help">
                                            <strong>Not seeing an Allow prompt?</strong>
                                            <span>
                                                In Chrome, tap the site icon beside the address bar,
                                                open Permissions or Site settings, set Microphone to Allow,
                                                then return to Sync.
                                            </span>
                                        </div>
                                        <div className="sync-permission-actions">
                                            <button
                                                type="button"
                                                className="sync-btn ghost"
                                                onClick={() => setShowMicrophoneHelp(false)}
                                            >
                                                Not now
                                            </button>
                                            <button
                                                type="button"
                                                className="sync-btn primary"
                                                onClick={startVoiceRecording}
                                            >
                                                <Mic size={16} /> Try Again
                                            </button>
                                        </div>
                                    </section>
                                </div>
                            )}
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

                            <CompressingCard conversationId={activeConversationId} />

                            {editingMsg && (
                                <div className="sync-reply-banner">
                                    <div className="reply-banner-text">
                                        <strong>Editing message</strong>
                                        <p>{editingMsg.text}</p>
                                    </div>
                                    <button
                                        type="button"
                                        className="sync-icon-btn xs"
                                        onClick={() => {
                                            setEditingMsg(null);
                                            setDraftText("");
                                        }}
                                    >
                                        <X size={16} />
                                    </button>
                                </div>
                            )}

                            {replyingTo && !editingMsg && (
                                <div className="sync-reply-banner">
                                    <div className="reply-banner-text">
                                        <strong>
                                            Replying to{" "}
                                            {replyingTo.sender?.fullName ||
                                                "message"}
                                        </strong>
                                        <p>
                                            <ReplySnippet target={replyingTo} />
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
                                activeDisplay?.isOfficialAccount ? (
                                    <div className="sync-official-readonly-bar">
                                        <VerifiedBadge
                                            variant="official"
                                            size={16}
                                        />
                                        <span>
                                            Official Sync account — welcome
                                            messages &amp; updates only
                                        </span>
                                    </div>
                                ) : (
                                    <div className="sync-admin-only-bar">
                                        <Lock size={15} />
                                        <span>
                                            Only group admins can send messages
                                            in this group
                                        </span>
                                    </div>
                                )
                            ) : (
                                <form
                                    ref={composerBarRef}
                                    className={`sync-composer-bar ${
                                        isRecording && holdMode
                                            ? "is-holding"
                                            : ""
                                    }`}
                                    onSubmit={handleSendText}
                                >
                                    {recPhase === "idle" && (
                                        <>
                                            <button
                                                type="button"
                                                className={`sync-icon-btn ${
                                                    showAttachSheet
                                                        ? "active"
                                                        : ""
                                                }`}
                                                title="Attach"
                                                aria-label="Attach"
                                                aria-expanded={showAttachSheet}
                                                onClick={() =>
                                                    setShowAttachSheet(v => !v)
                                                }
                                                disabled={uploadingMedia}
                                            >
                                                <Paperclip size={20} />
                                            </button>
                                            {activeIsGroup && (
                                                <button
                                                    type="button"
                                                    className="sync-icon-btn sync-poll-trigger"
                                                    title="Create Poll"
                                                    aria-label="Create Poll"
                                                    onClick={() =>
                                                        setShowCreatePoll(true)
                                                    }
                                                >
                                                    <PollIcon size={21} />
                                                </button>
                                            )}
                                        </>
                                    )}

                                    {isRecording && holdMode ? (
                                        <div
                                            className={`sync-voice-hold ${
                                                holdArm === "delete"
                                                    ? "arm-delete"
                                                    : ""
                                            } ${
                                                recPhase === "discarding"
                                                    ? "discarding"
                                                    : ""
                                            }`}
                                            role="group"
                                            aria-label="Recording voice message"
                                        >
                                            <span className="sync-hold-trash">
                                                <VoiceTrash
                                                    size={18}
                                                    open={
                                                        holdArm === "delete" ||
                                                        recPhase === "discarding"
                                                    }
                                                    shake={recPhase === "discarding"}
                                                />
                                            </span>
                                            <span className="rec-dot" />
                                            <span
                                                className="sync-voice-time"
                                                aria-live="off"
                                            >
                                                {formatRecTime(recordingSeconds)}
                                            </span>
                                            <div
                                                className="sync-hold-hint"
                                                aria-hidden="true"
                                            >
                                                <ChevronLeft size={16} />
                                                <span>
                                                    {holdArm === "delete"
                                                        ? "Release to delete"
                                                        : "Slide to delete"}
                                                </span>
                                            </div>
                                            <span
                                                className="sync-hold-pause-hint"
                                                aria-hidden="true"
                                            >
                                                <Pause size={12} />
                                                <ChevronUp size={14} />
                                            </span>
                                        </div>
                                    ) : isRecording ? (
                                        <div
                                            className={`sync-voice-rec ${recPhase} ${
                                                pausedFromHold ? "from-hold" : ""
                                            }`}
                                            role="group"
                                            aria-label="Voice message recorder"
                                        >
                                            <button
                                                type="button"
                                                className="sync-voice-btn delete"
                                                title="Delete recording"
                                                aria-label="Delete recording"
                                                onClick={() => discardVoiceRecording()}
                                                disabled={recPhase === "discarding"}
                                            >
                                                <VoiceTrash
                                                    size={20}
                                                    open={recPhase === "discarding"}
                                                />
                                            </button>

                                            <div className="sync-voice-panel">
                                                <span className="rec-dot" />
                                                <span
                                                    className="sync-voice-time"
                                                    aria-live="off"
                                                >
                                                    {formatRecTime(recordingSeconds)}
                                                </span>
                                                <div
                                                    className="sync-voice-wave"
                                                    aria-hidden="true"
                                                >
                                                    {Array.from(
                                                        { length: VOICE_BAR_COUNT },
                                                        (_, i) => (
                                                            <span
                                                                key={i}
                                                                ref={el => {
                                                                    recBarsRef.current[i] = el;
                                                                }}
                                                            />
                                                        )
                                                    )}
                                                </div>
                                            </div>

                                            <button
                                                type="button"
                                                className="sync-voice-btn pause"
                                                title={
                                                    recPhase === "paused"
                                                        ? "Resume recording"
                                                        : "Pause recording"
                                                }
                                                aria-label={
                                                    recPhase === "paused"
                                                        ? "Resume recording"
                                                        : "Pause recording"
                                                }
                                                onClick={togglePauseVoiceRecording}
                                                disabled={recPhase === "discarding"}
                                            >
                                                {recPhase === "paused" ? (
                                                    <Play key="play" size={19} />
                                                ) : (
                                                    <Pause key="pause" size={19} />
                                                )}
                                            </button>

                                            <button
                                                type="button"
                                                className="sync-send-btn sync-voice-send"
                                                title="Send voice message"
                                                aria-label="Send voice message"
                                                onClick={sendVoiceRecording}
                                                disabled={recPhase === "discarding"}
                                            >
                                                <Send size={18} />
                                            </button>
                                        </div>
                                    ) : (
                                        <textarea
                                            ref={composerInputRef}
                                            rows={1}
                                            className="sync-composer-input"
                                            placeholder="Type a message..."
                                            maxLength={4000}
                                            value={draftText}
                                            onChange={e =>
                                                handleTypingChange(
                                                    e.target.value
                                                )
                                            }
                                            onKeyDown={e => {
                                                // কম্পিউটারে Enter = পাঠানো, Shift+Enter = নতুন লাইন। ফোনে Enter নতুন লাইন, পাঠাতে বাটন।
                                                if (
                                                    e.key === "Enter" &&
                                                    !e.shiftKey &&
                                                    !e.nativeEvent.isComposing &&
                                                    window.matchMedia(
                                                        "(pointer: fine)"
                                                    ).matches
                                                ) {
                                                    e.preventDefault();
                                                    handleSendText(e);
                                                }
                                            }}
                                        />
                                    )}

                                    {(!isRecording || holdMode) &&
                                        (!draftText.trim() ? (
                                            <button
                                                type="button"
                                                className={`sync-icon-btn sync-mic-btn ${
                                                    isRecording && holdMode
                                                        ? "is-holding"
                                                        : ""
                                                } ${
                                                    holdArm === "delete"
                                                        ? "arm-delete"
                                                        : ""
                                                } ${
                                                    isRecording &&
                                                    holdMode &&
                                                    recPhase === "discarding"
                                                        ? "is-discarding"
                                                        : ""
                                                }`}
                                                title="Tap to record · hold to record and release to send"
                                                aria-label="Record voice message"
                                                onPointerDown={handleMicPointerDown}
                                                onPointerMove={handleMicPointerMove}
                                                onPointerUp={handleMicPointerUp}
                                                onPointerCancel={handleMicPointerCancel}
                                                onContextMenu={e => e.preventDefault()}
                                                onClick={e => {
                                                    // কিবোর্ড (Enter/Space) থেকে এলে detail === 0; টাচ/মাউস pointer হ্যান্ডলারে সামলানো
                                                    if (e.detail === 0) startVoiceRecording();
                                                }}
                                                disabled={uploadingMedia}
                                            >
                                                <Mic size={20} />
                                            </button>
                                        ) : (
                                            <button
                                                type="submit"
                                                className="sync-send-btn"
                                                title="Send Message"
                                                onPointerDown={event => event.preventDefault()}
                                            >
                                                <Send size={18} />
                                            </button>
                                        ))}
                                </form>
                            )}

                            <AttachmentSheet
                                open={showAttachSheet && canSendInActive && !isRecording}
                                disabled={uploadingMedia || !canSendInActive}
                                onClose={() => setShowAttachSheet(false)}
                                onFilesSelected={handleFilesSelected}
                                onSendLocation={handleSendLocation}
                                onSendContact={handleSendContact}
                            />
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

            {showQr && <QrCodeModal onClose={() => setShowQr(false)} />}

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

            {showCreatePoll && (
                <CreatePollModal
                    onClose={() => setShowCreatePoll(false)}
                    onCreate={handleCreatePoll}
                />
            )}

            {forwardMsg && (
                <ForwardModal
                    message={forwardMsg}
                    onClose={() => setForwardMsg(null)}
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
                    <LocalImg url={lightboxUrl} alt="Full view" />
                </div>
            )}

            {confirmDeleteMsgId && (
                <ConfirmDialog
                    icon={Trash2}
                    title="Delete this message?"
                    message="This message will be removed for everyone in this chat."
                    confirmLabel="Delete"
                    busy={deletingMsg}
                    onConfirm={handleConfirmDeleteMessage}
                    onCancel={() => setConfirmDeleteMsgId(null)}
                />
            )}

            {confirmLogout && (
                <ConfirmDialog
                    icon={LogOut}
                    title="Sign out of Sync?"
                    message="You will need to sign in again to read your chats and stories."
                    confirmLabel="Sign out"
                    busy={loggingOut}
                    onConfirm={handleConfirmLogout}
                    onCancel={() => setConfirmLogout(false)}
                />
            )}
        </div>
    );
}
