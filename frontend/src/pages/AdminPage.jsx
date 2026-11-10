import React, { useState, useEffect, useCallback } from "react";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import {
    ShieldCheck,
    Crown,
    Users,
    Image as ImageIcon,
    Video,
    Megaphone,
    BarChart3,
    Search,
    UserPlus,
    Ban,
    CheckCircle2,
    Trash2,
    Shield,
    ShieldOff,
    RefreshCw,
    Loader2,
    Lock,
    Upload,
    X,
    Clock,
    Sparkles,
    MessageCircle,
    Eye,
    AlertTriangle,
    Activity,
    Bell,
    Camera,
    MessageSquare,
    TrendingUp
} from "lucide-react";
import Avatar from "../components/Avatar.jsx";
import SyncLogo from "../components/SyncLogo.jsx";
import {
    formatCountdownHMS,
    formatNoticeDeadlineLine
} from "../components/NoticePopup.jsx";
import { api, extractErrorMessage } from "../services/api.js";
import { uploadMediaToCloudinary } from "../services/media.js";
import { formatLastSeen, formatTime } from "../utils/format.js";

const toLocalDatetimeInput = date => {
    if (!date) return "";
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return "";
    const pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
        d.getHours()
    )}:${pad(d.getMinutes())}`;
};


const DashboardBar = ({ label, value = 0, maxValue = 0, detail }) => {
    const numericValue = Number(value) || 0;
    const percentage = maxValue > 0
        ? Math.min(100, Math.max(numericValue > 0 ? 2 : 0, (numericValue / maxValue) * 100))
        : 0;

    return (
        <div className="sync-dashboard-bar-row">
            <div className="sync-dashboard-bar-meta">
                <span>{label}</span>
                <strong>{numericValue.toLocaleString()}</strong>
            </div>
            <div className="sync-dashboard-bar-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={maxValue || 0} aria-valuenow={numericValue}>
                <span style={{ width: String(percentage) + "%" }} />
            </div>
            {detail && <small>{detail}</small>}
        </div>
    );
};

const DashboardDonut = ({ segments, total }) => {
    const radius = 42;
    const circumference = 2 * Math.PI * radius;
    let offset = 0;

    return (
        <div className="sync-dashboard-donut-wrap">
            <svg viewBox="0 0 112 112" role="img" aria-label={"User distribution: " + total + " accounts"}>
                <circle cx="56" cy="56" r={radius} fill="none" stroke="var(--line)" strokeWidth="13" />
                {segments.map(segment => {
                    const value = Math.max(0, Number(segment.value) || 0);
                    const length = total > 0 ? (value / total) * circumference : 0;
                    const currentOffset = offset;
                    offset += length;
                    return (
                        <circle key={segment.label} cx="56" cy="56" r={radius} fill="none" stroke={segment.color} strokeWidth="13"
                            strokeDasharray={String(length) + " " + String(circumference - length)}
                            strokeDashoffset={-currentOffset} transform="rotate(-90 56 56)" />
                    );
                })}
                <text x="56" y="53" textAnchor="middle" className="sync-dashboard-donut-total">{total.toLocaleString()}</text>
                <text x="56" y="67" textAnchor="middle" className="sync-dashboard-donut-caption">accounts</text>
            </svg>
            <div className="sync-dashboard-legend">
                {segments.map(segment => (
                    <div key={segment.label}>
                        <span style={{ background: segment.color }} />
                        <span>{segment.label}</span>
                        <strong>{(Number(segment.value) || 0).toLocaleString()}</strong>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default function AdminPage() {
    const navigate = useNavigate();
    const currentUser = useSelector(state => state.auth.user);
    const isSuperAdmin = Boolean(
        currentUser?.isSuperAdmin || currentUser?.role === "superAdmin"
    );

    const [activeTab, setActiveTab] = useState("overview");
    const [bannerMsg, setBannerMsg] = useState("");
    const [bannerErr, setBannerErr] = useState("");

    // ---------- 1. Stats ----------
    const [stats, setStats] = useState(null);
    const [loadingStats, setLoadingStats] = useState(false);

    // ---------- 2. Users & Admins ----------
    const [users, setUsers] = useState([]);
    const [userTotal, setUserTotal] = useState(0);
    const [userPage, setUserPage] = useState(1);
    const [userPages, setUserPages] = useState(1);
    const [userSearch, setUserSearch] = useState("");
    const [userFilter, setUserFilter] = useState("all");
    const [loadingUsers, setLoadingUsers] = useState(false);
    const [busyUserId, setBusyUserId] = useState(null);

    // Super Admin: নতুন Admin তৈরির ফর্ম
    const [showCreateAdmin, setShowCreateAdmin] = useState(false);
    const [newAdminForm, setNewAdminForm] = useState({
        fullName: "",
        username: "",
        email: "",
        phoneNumber: "",
        password: ""
    });
    const [creatingAdmin, setCreatingAdmin] = useState(false);

    // ---------- 3. Media (শুধু Image ও Video, মেসেজ লেখা নয়) ----------
    const [mediaSource, setMediaSource] = useState("chat");
    const [mediaKind, setMediaKind] = useState("all");
    const [mediaItems, setMediaItems] = useState([]);
    const [mediaNextBefore, setMediaNextBefore] = useState(null);
    const [loadingMedia, setLoadingMedia] = useState(false);
    const [deletingMediaId, setDeletingMediaId] = useState(null);
    const [previewMedia, setPreviewMedia] = useState(null);

    // ---------- 4. Notices ----------
    const [notices, setNotices] = useState([]);
    const [noticeTotalUsers, setNoticeTotalUsers] = useState(0);
    const [loadingNotices, setLoadingNotices] = useState(false);
    const [noticeTitle, setNoticeTitle] = useState("");
    const [noticeBody, setNoticeBody] = useState("");
    const [noticeImageUrl, setNoticeImageUrl] = useState("");
    const [noticeImagePublicId, setNoticeImagePublicId] = useState("");
    const [uploadingNoticeImg, setUploadingNoticeImg] = useState(false);
    const [noticeUploadPct, setNoticeUploadPct] = useState(0);
    const [noticeCountdownTo, setNoticeCountdownTo] = useState("");
    const [noticeShowDays, setNoticeShowDays] = useState(7);
    const [publishingNotice, setPublishingNotice] = useState(false);
    const [previewNowMs, setPreviewNowMs] = useState(() => Date.now());

    // ---------- 5. Groups ----------
    const [groups, setGroups] = useState([]);
    const [groupSearch, setGroupSearch] = useState("");
    const [loadingGroups, setLoadingGroups] = useState(false);
    const [deletingGroupId, setDeletingGroupId] = useState(null);

    const flashSuccess = msg => {
        setBannerErr("");
        setBannerMsg(msg);
        setTimeout(() => setBannerMsg(""), 4500);
    };

    const flashError = err => {
        setBannerMsg("");
        setBannerErr(
            typeof err === "string"
                ? err
                : extractErrorMessage(err, "Action failed")
        );
    };

    const loadStats = useCallback(async () => {
        setLoadingStats(true);
        try {
            const res = await api.get("/api/admin/stats");
            setStats(res.data?.data || null);
        } catch (err) {
            flashError(err);
        } finally {
            setLoadingStats(false);
        }
    }, []);

    const loadUsers = useCallback(
        async (page = userPage) => {
            setLoadingUsers(true);
            try {
                const params = new URLSearchParams({
                    page: String(page),
                    limit: "20",
                    filter: userFilter
                });
                if (userSearch.trim()) params.set("search", userSearch.trim());
                const res = await api.get(`/api/admin/users?${params}`);
                const data = res.data?.data || {};
                setUsers(data.users || []);
                setUserTotal(data.total || 0);
                setUserPage(data.page || 1);
                setUserPages(data.pages || 1);
            } catch (err) {
                flashError(err);
            } finally {
                setLoadingUsers(false);
            }
        },
        [userFilter, userPage, userSearch]
    );

    const loadMedia = useCallback(
        async (before = null) => {
            setLoadingMedia(true);
            try {
                const params = new URLSearchParams({
                    source: mediaSource,
                    kind: mediaKind,
                    limit: "24"
                });
                if (before) params.set("before", before);
                const res = await api.get(`/api/admin/media?${params}`);
                const data = res.data?.data || {};
                const list = data.items || [];
                setMediaItems(prev => (before ? [...prev, ...list] : list));
                setMediaNextBefore(data.nextBefore || null);
            } catch (err) {
                flashError(err);
            } finally {
                setLoadingMedia(false);
            }
        },
        [mediaSource, mediaKind]
    );

    const loadNotices = useCallback(async () => {
        setLoadingNotices(true);
        try {
            const res = await api.get("/api/admin/notices");
            const data = res.data?.data || {};
            setNotices(data.notices || []);
            setNoticeTotalUsers(data.totalUsers || 0);
        } catch (err) {
            flashError(err);
        } finally {
            setLoadingNotices(false);
        }
    }, []);

    const loadGroups = useCallback(async () => {
        setLoadingGroups(true);
        try {
            const params = new URLSearchParams();
            if (groupSearch.trim()) params.set("search", groupSearch.trim());
            const res = await api.get(`/api/admin/groups?${params}`);
            setGroups(res.data?.data || []);
        } catch (err) {
            flashError(err);
        } finally {
            setLoadingGroups(false);
        }
    }, [groupSearch]);

    useEffect(() => {
        loadStats();
    }, [loadStats]);

    useEffect(() => {
        if (activeTab === "users") {
            const t = setTimeout(() => loadUsers(1), 220);
            return () => clearTimeout(t);
        }
    }, [activeTab, userSearch, userFilter, loadUsers]);

    useEffect(() => {
        if (activeTab === "media") {
            loadMedia(null);
        }
    }, [activeTab, mediaSource, mediaKind, loadMedia]);

    useEffect(() => {
        if (activeTab === "notices") {
            loadNotices();
        }
    }, [activeTab, loadNotices]);

    useEffect(() => {
        if (activeTab === "groups") {
            const t = setTimeout(() => loadGroups(), 220);
            return () => clearTimeout(t);
        }
    }, [activeTab, groupSearch, loadGroups]);

    useEffect(() => {
        if (activeTab !== "notices" || !noticeCountdownTo) return;
        const tick = setInterval(() => setPreviewNowMs(Date.now()), 1000);
        return () => clearInterval(tick);
    }, [activeTab, noticeCountdownTo]);

    // ---------- Handlers: Users & Admins ----------
    const canManageTarget = target => {
        if (!target) return false;
        if (String(target._id) === String(currentUser?._id)) return false;
        if (target.isSuperAdmin || target.role === "superAdmin") return false;
        if (target.role === "admin" && !isSuperAdmin) return false;
        return true;
    };

    const handleCreateAdminSubmit = async e => {
        e.preventDefault();
        setCreatingAdmin(true);
        setBannerErr("");
        try {
            const res = await api.post("/api/admin/admins", {
                fullName: newAdminForm.fullName.trim(),
                username: newAdminForm.username.trim().toLowerCase(),
                email: newAdminForm.email.trim().toLowerCase(),
                phoneNumber: newAdminForm.phoneNumber.trim(),
                password: newAdminForm.password
            });
            const created = res.data?.data;
            if (created) {
                setUsers(prev => [created, ...prev]);
                setUserTotal(t => t + 1);
            }
            setNewAdminForm({
                fullName: "",
                username: "",
                email: "",
                phoneNumber: "",
                password: ""
            });
            setShowCreateAdmin(false);
            flashSuccess(
                `New Platform Admin @${created?.username || "admin"} created!`
            );
            loadStats();
        } catch (err) {
            flashError(err);
        } finally {
            setCreatingAdmin(false);
        }
    };

    const handleToggleBlock = async target => {
        setBusyUserId(target._id);
        try {
            const res = target.isBlocked
                ? await api.delete(`/api/admin/users/${target._id}/block`)
                : await api.post(`/api/admin/users/${target._id}/block`);
            const updated = res.data?.data;
            setUsers(prev =>
                prev.map(u => (u._id === target._id ? updated : u))
            );
            flashSuccess(
                target.isBlocked
                    ? `@${target.username} unblocked`
                    : `@${target.username} blocked`
            );
            loadStats();
        } catch (err) {
            flashError(err);
        } finally {
            setBusyUserId(null);
        }
    };

    const handleToggleAdminRole = async target => {
        const nextRole = target.role === "admin" ? "user" : "admin";
        setBusyUserId(target._id);
        try {
            const res = await api.patch(`/api/admin/users/${target._id}/role`, {
                role: nextRole
            });
            const updated = res.data?.data;
            setUsers(prev =>
                prev.map(u => (u._id === target._id ? updated : u))
            );
            flashSuccess(
                nextRole === "admin"
                    ? `@${target.username} promoted to Platform Admin`
                    : `@${target.username} is now a regular user`
            );
            loadStats();
        } catch (err) {
            flashError(err);
        } finally {
            setBusyUserId(null);
        }
    };

    const handleDeleteUser = async target => {
        if (
            !window.confirm(
                `Permanently delete user @${target.username} (${target.fullName})?`
            )
        ) {
            return;
        }
        setBusyUserId(target._id);
        try {
            await api.delete(`/api/admin/users/${target._id}`);
            setUsers(prev => prev.filter(u => u._id !== target._id));
            setUserTotal(t => Math.max(0, t - 1));
            flashSuccess(`User @${target.username} deleted`);
            loadStats();
        } catch (err) {
            flashError(err);
        } finally {
            setBusyUserId(null);
        }
    };

    // ---------- Handlers: Media ----------
    const handleRemoveMedia = async item => {
        if (
            !window.confirm(
                `Remove this ${item.type} from ${
                    item.source === "story" ? "Stories" : "Chat"
                } for everyone?`
            )
        ) {
            return;
        }
        setDeletingMediaId(item.id);
        try {
            const endpoint =
                item.source === "story"
                    ? `/api/admin/media/story/${item.id}`
                    : `/api/admin/media/chat/${item.id}`;
            await api.delete(endpoint);
            setMediaItems(prev => prev.filter(m => m.id !== item.id));
            if (previewMedia?.id === item.id) setPreviewMedia(null);
            flashSuccess("Media removed for everyone");
            loadStats();
        } catch (err) {
            flashError(err);
        } finally {
            setDeletingMediaId(null);
        }
    };

    // ---------- Handlers: Notices ----------
    const handleNoticeImageUpload = async e => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;
        setUploadingNoticeImg(true);
        setNoticeUploadPct(0);
        try {
            const uploaded = await uploadMediaToCloudinary(
                file,
                setNoticeUploadPct
            );
            setNoticeImageUrl(uploaded.url);
            setNoticeImagePublicId(uploaded.publicId || "");
        } catch (err) {
            flashError(err.message || "Notice image upload failed");
        } finally {
            setUploadingNoticeImg(false);
            setNoticeUploadPct(0);
        }
    };

    const applyCountdownPreset = mode => {
        const now = new Date();
        if (mode === "none") {
            setNoticeCountdownTo("");
            return;
        }
        if (mode === "2h") {
            setNoticeCountdownTo(
                toLocalDatetimeInput(new Date(now.getTime() + 2 * 3600 * 1000))
            );
        } else if (mode === "6h") {
            setNoticeCountdownTo(
                toLocalDatetimeInput(new Date(now.getTime() + 6 * 3600 * 1000))
            );
        } else if (mode === "tomorrow2358") {
            const t = new Date(
                now.getFullYear(),
                now.getMonth(),
                now.getDate() + 1,
                23,
                58,
                0
            );
            setNoticeCountdownTo(toLocalDatetimeInput(t));
        } else if (mode === "3d") {
            setNoticeCountdownTo(
                toLocalDatetimeInput(
                    new Date(now.getTime() + 3 * 24 * 3600 * 1000)
                )
            );
        }
    };

    const handlePublishNotice = async e => {
        e.preventDefault();
        if (!noticeTitle.trim() || !noticeBody.trim()) {
            flashError("Notice title and message are required");
            return;
        }
        setPublishingNotice(true);
        setBannerErr("");
        try {
            const payload = {
                title: noticeTitle.trim(),
                body: noticeBody.trim(),
                imageUrl: noticeImageUrl.trim(),
                imagePublicId: noticeImagePublicId,
                countdownTo: noticeCountdownTo
                    ? new Date(noticeCountdownTo).toISOString()
                    : null,
                showDays: Number(noticeShowDays) || 7
            };
            await api.post("/api/admin/notices", payload);
            setNoticeTitle("");
            setNoticeBody("");
            setNoticeImageUrl("");
            setNoticeImagePublicId("");
            setNoticeCountdownTo("");
            flashSuccess(
                "Notice published! Real-time 5s popup & Push notification sent to all users."
            );
            loadNotices();
            loadStats();
        } catch (err) {
            flashError(err);
        } finally {
            setPublishingNotice(false);
        }
    };

    const handleDeleteNotice = async id => {
        if (!window.confirm("Delete this notice for all users?")) return;
        try {
            await api.delete(`/api/admin/notices/${id}`);
            setNotices(prev => prev.filter(n => n._id !== id));
            flashSuccess("Notice removed");
            loadStats();
        } catch (err) {
            flashError(err);
        }
    };

    // ---------- Handlers: Groups ----------
    const handleDeleteGroup = async g => {
        if (
            !window.confirm(
                `Delete group "${g.name}" (${g.memberCount} members)?`
            )
        ) {
            return;
        }
        setDeletingGroupId(g.id);
        try {
            await api.delete(`/api/admin/groups/${g.id}`);
            setGroups(prev => prev.filter(item => item.id !== g.id));
            flashSuccess(`Group "${g.name}" deleted`);
            loadStats();
        } catch (err) {
            flashError(err);
        } finally {
            setDeletingGroupId(null);
        }
    };

    const previewCountdown = noticeCountdownTo
        ? formatCountdownHMS(noticeCountdownTo, previewNowMs)
        : null;
    const previewDeadline = noticeCountdownTo
        ? formatNoticeDeadlineLine(noticeCountdownTo)
        : "";

    return (
        <div className="sync-admin-page">
            <div className="sync-admin-container">
                {/* ---------- Header ---------- */}
                <header className="sync-admin-hero">
                    <div className="sync-admin-hero-left">
                        <div
                            className={`sync-admin-role-badge ${
                                isSuperAdmin ? "is-super" : "is-admin"
                            }`}
                        >
                            {isSuperAdmin ? (
                                <>
                                    <Crown size={15} />
                                    <span>Super Admin (.env)</span>
                                </>
                            ) : (
                                <>
                                    <ShieldCheck size={15} />
                                    <span>Platform Admin</span>
                                </>
                            )}
                        </div>
                        <h1>
                            {isSuperAdmin
                                ? "Super Admin Control Center"
                                : "Admin Dashboard"}
                        </h1>
                        <p className="sync-muted">
                            Signed in as <strong>{currentUser?.fullName}</strong>{" "}
                            (@{currentUser?.username}) · Manage users, broadcast
                            5s popup notices & push alerts, and moderate image &
                            video files.
                        </p>
                    </div>

                    <div className="sync-admin-hero-actions">
                        <button
                            type="button"
                            className="sync-btn secondary sm"
                            onClick={() => navigate("/chats")}
                        >
                            <MessageCircle size={16} />
                            <span>Open Messenger</span>
                        </button>
                        {isSuperAdmin && (
                            <button
                                type="button"
                                className="sync-btn primary sm"
                                onClick={() => {
                                    setActiveTab("users");
                                    setShowCreateAdmin(true);
                                }}
                            >
                                <UserPlus size={16} />
                                <span>Create New Admin</span>
                            </button>
                        )}
                    </div>
                </header>

                {/* ---------- Role & Privacy Clarity Strip ---------- */}
                <div className="sync-admin-clarity-bar">
                    <div className="sync-clarity-chip privacy">
                        <Lock size={14} />
                        <span>
                            <strong>Message Privacy:</strong> Private chat text
                            & story captions are strictly hidden. Only{" "}
                            <strong>Images & Videos</strong> are visible here.
                        </span>
                    </div>
                    <div className="sync-clarity-chip roles">
                        <Shield size={14} />
                        <span>
                            <strong>Role Hierarchy:</strong>{" "}
                            <em>Super Admin</em> (.env, creates Admins) &gt;{" "}
                            <em>Platform Admin</em> (dashboard access) ≠{" "}
                            <em>Group Admin</em> (chat group only).
                        </span>
                    </div>
                </div>

                {bannerMsg && (
                    <div className="sync-alert success">
                        <CheckCircle2 size={16} />
                        <span>{bannerMsg}</span>
                    </div>
                )}
                {bannerErr && (
                    <div className="sync-alert error">
                        <AlertTriangle size={16} />
                        <span>{bannerErr}</span>
                    </div>
                )}

                {/* ---------- Navigation Tabs ---------- */}
                <div className="sync-admin-tabs" role="tablist">
                    {[
                        {
                            id: "overview",
                            label: "Overview",
                            icon: BarChart3
                        },
                        {
                            id: "users",
                            label: isSuperAdmin
                                ? "Users & Admins"
                                : "Users",
                            icon: Users
                        },
                        {
                            id: "media",
                            label: "Images & Videos",
                            icon: ImageIcon
                        },
                        {
                            id: "notices",
                            label: "Notices & Push",
                            icon: Megaphone
                        },
                        {
                            id: "groups",
                            label: "Groups",
                            icon: Shield
                        }
                    ].map(t => {
                        const Icon = t.icon;
                        return (
                            <button
                                key={t.id}
                                type="button"
                                role="tab"
                                aria-selected={activeTab === t.id}
                                className={`sync-admin-tab ${
                                    activeTab === t.id ? "active" : ""
                                }`}
                                onClick={() => setActiveTab(t.id)}
                            >
                                <Icon size={16} />
                                <span>{t.label}</span>
                            </button>
                        );
                    })}
                </div>

                {/* =========================================================
                    TAB 1: OVERVIEW
                   ========================================================= */}
                {activeTab === "overview" && (
                    <section className="sync-admin-section">
                        <div className="sync-admin-section-head">
                            <h3>Platform Overview</h3>
                            <button
                                type="button"
                                className="sync-btn secondary xs"
                                onClick={loadStats}
                                disabled={loadingStats}
                            >
                                <RefreshCw
                                    size={14}
                                    className={loadingStats ? "spin" : ""}
                                />
                                <span>Refresh</span>
                            </button>
                        </div>

                        <div className="sync-admin-stats-grid">
                            <div
                                className="sync-stat-card clickable"
                                onClick={() => setActiveTab("users")}
                            >
                                <span className="sync-stat-label">
                                    Total Users
                                </span>
                                <strong className="sync-stat-value">
                                    {stats?.users?.total ?? "—"}
                                </strong>
                                <small className="sync-stat-sub">
                                    {stats?.users?.online ?? 0} online now · +
                                    {stats?.users?.newThisWeek ?? 0} this week
                                </small>
                            </div>

                            <div
                                className="sync-stat-card clickable"
                                onClick={() => {
                                    setUserFilter("admins");
                                    setActiveTab("users");
                                }}
                            >
                                <span className="sync-stat-label">
                                    Platform Admins
                                </span>
                                <strong className="sync-stat-value">
                                    {stats?.users?.admins ?? "—"}
                                </strong>
                                <small className="sync-stat-sub">
                                    {stats?.users?.superAdmins ?? 1} Super Admin
                                    (.env) · {stats?.users?.blocked ?? 0} blocked
                                </small>
                            </div>

                            <div
                                className="sync-stat-card clickable"
                                onClick={() => setActiveTab("media")}
                            >
                                <span className="sync-stat-label">
                                    Images & Videos
                                </span>
                                <strong className="sync-stat-value">
                                    {(stats?.media?.images ?? 0) +
                                        (stats?.media?.videos ?? 0)}
                                </strong>
                                <small className="sync-stat-sub">
                                    <Camera size={13} /> {stats?.media?.images ?? 0} photos · <Video size={13} /> 
                                    {stats?.media?.videos ?? 0} videos ·{" "}
                                    {stats?.media?.activeStories ?? 0} active
                                    stories
                                </small>
                            </div>

                            <div
                                className="sync-stat-card clickable"
                                onClick={() => setActiveTab("notices")}
                            >
                                <span className="sync-stat-label">
                                    Active Notices & Push
                                </span>
                                <strong className="sync-stat-value">
                                    {stats?.notices?.active ?? "—"}
                                </strong>
                                <small className="sync-stat-sub">
                                    <Bell size={13} /> {stats?.notices?.pushDevices ?? 0} push
                                    subscribed devices
                                </small>
                            </div>

                            <div
                                className="sync-stat-card clickable"
                                onClick={() => setActiveTab("groups")}
                            >
                                <span className="sync-stat-label">
                                    Groups & Direct Chats
                                </span>
                                <strong className="sync-stat-value">
                                    {stats?.chats?.groups ?? "—"}
                                </strong>
                                <small className="sync-stat-sub">
                                    {stats?.chats?.direct ?? 0} direct chats ·{" "}
                                    {stats?.chats?.messages ?? 0} total messages
                                    (encrypted/hidden)
                                </small>
                            </div>
                        </div>

                        
                        <div className="sync-dashboard-analytics">
                            <article className="sync-dashboard-chart-card sync-dashboard-audience">
                                <div className="sync-dashboard-chart-heading">
                                    <div><span className="sync-dashboard-eyebrow">AUDIENCE</span><h3><Users size={18} /> Account distribution</h3></div>
                                    <span className="sync-dashboard-live-label"><Activity size={13} /> Current totals</span>
                                </div>
                                <DashboardDonut total={Number(stats?.users?.total) || 0} segments={[
                                    { label: "Members", value: Math.max(0, (Number(stats?.users?.total) || 0) - (Number(stats?.users?.admins) || 0)), color: "#00c878" },
                                    { label: "Admins", value: Math.max(0, (Number(stats?.users?.admins) || 0) - (Number(stats?.users?.superAdmins) || 0)), color: "#6d8cff" },
                                    { label: "Super Admins", value: Number(stats?.users?.superAdmins) || 0, color: "#f2b84b" }
                                ]} />
                            </article>

                            <article className="sync-dashboard-chart-card">
                                <div className="sync-dashboard-chart-heading"><div><span className="sync-dashboard-eyebrow">COMMUNITY</span><h3><TrendingUp size={18} /> User activity</h3></div><span className="sync-dashboard-chart-note">Current metrics</span></div>
                                <div className="sync-dashboard-bars">
                                    <DashboardBar label="Online now" value={stats?.users?.online} maxValue={Math.max(Number(stats?.users?.online) || 0, Number(stats?.users?.newThisWeek) || 0, Number(stats?.users?.blocked) || 0, 1)} />
                                    <DashboardBar label="Joined this week" value={stats?.users?.newThisWeek} maxValue={Math.max(Number(stats?.users?.online) || 0, Number(stats?.users?.newThisWeek) || 0, Number(stats?.users?.blocked) || 0, 1)} />
                                    <DashboardBar label="Blocked accounts" value={stats?.users?.blocked} maxValue={Math.max(Number(stats?.users?.online) || 0, Number(stats?.users?.newThisWeek) || 0, Number(stats?.users?.blocked) || 0, 1)} />
                                </div>
                            </article>

                            <article className="sync-dashboard-chart-card">
                                <div className="sync-dashboard-chart-heading"><div><span className="sync-dashboard-eyebrow">CONTENT</span><h3><Camera size={18} /> Media overview</h3></div><span className="sync-dashboard-chart-note">Published content</span></div>
                                <div className="sync-dashboard-bars">
                                    <DashboardBar label="Images" value={stats?.media?.images} maxValue={Math.max(Number(stats?.media?.images) || 0, Number(stats?.media?.videos) || 0, Number(stats?.media?.activeStories) || 0, 1)} />
                                    <DashboardBar label="Videos" value={stats?.media?.videos} maxValue={Math.max(Number(stats?.media?.images) || 0, Number(stats?.media?.videos) || 0, Number(stats?.media?.activeStories) || 0, 1)} />
                                    <DashboardBar label="Active stories" value={stats?.media?.activeStories} maxValue={Math.max(Number(stats?.media?.images) || 0, Number(stats?.media?.videos) || 0, Number(stats?.media?.activeStories) || 0, 1)} />
                                </div>
                            </article>

                            <article className="sync-dashboard-chart-card">
                                <div className="sync-dashboard-chart-heading"><div><span className="sync-dashboard-eyebrow">MESSAGING</span><h3><MessageSquare size={18} /> Conversation activity</h3></div><span className="sync-dashboard-chart-note">Platform totals</span></div>
                                <div className="sync-dashboard-bars">
                                    <DashboardBar label="Group conversations" value={stats?.chats?.groups} maxValue={Math.max(Number(stats?.chats?.groups) || 0, Number(stats?.chats?.direct) || 0, Number(stats?.chats?.messages) || 0, 1)} />
                                    <DashboardBar label="Direct conversations" value={stats?.chats?.direct} maxValue={Math.max(Number(stats?.chats?.groups) || 0, Number(stats?.chats?.direct) || 0, Number(stats?.chats?.messages) || 0, 1)} />
                                    <DashboardBar label="Messages" value={stats?.chats?.messages} maxValue={Math.max(Number(stats?.chats?.groups) || 0, Number(stats?.chats?.direct) || 0, Number(stats?.chats?.messages) || 0, 1)} />
                                </div>
                            </article>

                            <article className="sync-dashboard-chart-card sync-dashboard-reach-card">
                                <div className="sync-dashboard-chart-heading"><div><span className="sync-dashboard-eyebrow">NOTIFICATIONS</span><h3><Bell size={18} /> Push subscriptions</h3></div></div>
                                <div className="sync-dashboard-reach-stats">
                                    <div><strong>{(Number(stats?.notices?.active) || 0).toLocaleString()}</strong><span>Active notices</span></div>
                                    <div><strong>{(Number(stats?.notices?.pushDevices) || 0).toLocaleString()}</strong><span>Subscribed devices</span></div>
                                </div>
                                <p className="sync-dashboard-footnote">Registered push subscriptions across user devices.</p>
                            </article>
                        </div>

                        <div className="sync-admin-quick-cards">
                            <div className="sync-profile-card">
                                <h3>
                                    <Megaphone size={18} /> Broadcast Popup &
                                    Push Notice
                                </h3>
                                <p className="sync-muted">
                                    Send an offer, announcement, or alert with a
                                    banner image and live countdown timer. Every
                                    user sees a popup where the{" "}
                                    <strong>OK button unlocks after 5s</strong>,
                                    plus a rich Web Push notification.
                                </p>
                                <div>
                                    <button
                                        type="button"
                                        className="sync-btn primary sm"
                                        onClick={() => setActiveTab("notices")}
                                    >
                                        <Megaphone size={15} /> Create Notice
                                    </button>
                                </div>
                            </div>

                            <div className="sync-profile-card">
                                <h3>
                                    <ImageIcon size={18} /> Moderate Images &
                                    Videos
                                </h3>
                                <p className="sync-muted">
                                    Inspect photos and videos shared in chats
                                    and stories without accessing private text
                                    conversations, and delete inappropriate
                                    media for everyone in one click.
                                </p>
                                <div>
                                    <button
                                        type="button"
                                        className="sync-btn secondary sm"
                                        onClick={() => setActiveTab("media")}
                                    >
                                        <Eye size={15} /> Open Media Inspector
                                    </button>
                                </div>
                            </div>
                        </div>
                    </section>
                )}

                {/* =========================================================
                    TAB 2: USERS & ADMINS
                   ========================================================= */}
                {activeTab === "users" && (
                    <section className="sync-admin-section">
                        <div className="sync-admin-section-head">
                            <div>
                                <h3>
                                    Users & Platform Admins ({userTotal})
                                </h3>
                                <p className="sync-muted">
                                    {isSuperAdmin
                                        ? "As Super Admin, you can create new Platform Admins, promote/demote Admins, and block or delete users."
                                        : "As Platform Admin, you can search and block/unblock or remove regular users."}
                                </p>
                            </div>
                            {isSuperAdmin && (
                                <button
                                    type="button"
                                    className="sync-btn primary sm"
                                    onClick={() =>
                                        setShowCreateAdmin(v => !v)
                                    }
                                >
                                    <UserPlus size={15} />
                                    <span>
                                        {showCreateAdmin
                                            ? "Close Form"
                                            : "Create New Admin"}
                                    </span>
                                </button>
                            )}
                        </div>

                        {isSuperAdmin && showCreateAdmin && (
                            <form
                                className="sync-profile-card sync-create-admin-card"
                                onSubmit={handleCreateAdminSubmit}
                            >
                                <div className="sync-admin-section-head">
                                    <h3>
                                        <Crown size={18} /> Create New Platform
                                        Admin Account
                                    </h3>
                                    <button
                                        type="button"
                                        className="sync-icon-btn xs"
                                        onClick={() =>
                                            setShowCreateAdmin(false)
                                        }
                                    >
                                        <X size={16} />
                                    </button>
                                </div>
                                <p className="sync-muted">
                                    This account will immediately have{" "}
                                    <strong>Platform Admin</strong> access on
                                    the same login page (can send notices,
                                    inspect images/videos, and block regular
                                    users).
                                </p>
                                <div className="sync-grid-2">
                                    <div className="sync-field">
                                        <label>Full Name *</label>
                                        <input
                                            type="text"
                                            placeholder="e.g. Arnab Dutta"
                                            minLength={3}
                                            maxLength={50}
                                            value={newAdminForm.fullName}
                                            onChange={e =>
                                                setNewAdminForm(f => ({
                                                    ...f,
                                                    fullName: e.target.value
                                                }))
                                            }
                                            required
                                        />
                                    </div>
                                    <div className="sync-field">
                                        <label>Username *</label>
                                        <input
                                            type="text"
                                            placeholder="e.g. arnab_admin"
                                            minLength={3}
                                            maxLength={20}
                                            value={newAdminForm.username}
                                            onChange={e =>
                                                setNewAdminForm(f => ({
                                                    ...f,
                                                    username: e.target.value
                                                }))
                                            }
                                            required
                                        />
                                    </div>
                                    <div className="sync-field">
                                        <label>Email Address *</label>
                                        <input
                                            type="email"
                                            placeholder="admin@example.com"
                                            value={newAdminForm.email}
                                            onChange={e =>
                                                setNewAdminForm(f => ({
                                                    ...f,
                                                    email: e.target.value
                                                }))
                                            }
                                            required
                                        />
                                    </div>
                                    <div className="sync-field">
                                        <label>10-Digit Mobile Number *</label>
                                        <input
                                            type="tel"
                                            placeholder="9876543210"
                                            value={newAdminForm.phoneNumber}
                                            onChange={e =>
                                                setNewAdminForm(f => ({
                                                    ...f,
                                                    phoneNumber: e.target.value
                                                }))
                                            }
                                            required
                                        />
                                    </div>
                                </div>
                                <div className="sync-field">
                                    <label>Password (min 8 characters) *</label>
                                    <input
                                        type="password"
                                        placeholder="Set initial password"
                                        minLength={8}
                                        maxLength={64}
                                        value={newAdminForm.password}
                                        onChange={e =>
                                            setNewAdminForm(f => ({
                                                ...f,
                                                password: e.target.value
                                            }))
                                        }
                                        required
                                    />
                                </div>
                                <div className="sync-modal-footer">
                                    <button
                                        type="button"
                                        className="sync-btn ghost sm"
                                        onClick={() =>
                                            setShowCreateAdmin(false)
                                        }
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        className="sync-btn primary sm"
                                        disabled={creatingAdmin}
                                    >
                                        {creatingAdmin ? (
                                            <>
                                                <Loader2
                                                    size={15}
                                                    className="spin"
                                                />
                                                <span>Creating Admin...</span>
                                            </>
                                        ) : (
                                            <>
                                                <UserPlus size={15} />
                                                <span>Create Admin</span>
                                            </>
                                        )}
                                    </button>
                                </div>
                            </form>
                        )}

                        <div className="sync-admin-toolbar">
                            <div className="sync-search-input-wrap">
                                <Search size={16} />
                                <input
                                    type="text"
                                    placeholder="Search by username, name, email or phone..."
                                    value={userSearch}
                                    onChange={e =>
                                        setUserSearch(e.target.value)
                                    }
                                />
                            </div>
                            <div className="sync-filter-pills">
                                {[
                                    { id: "all", label: "All Users" },
                                    {
                                        id: "admins",
                                        label: "Admins & Super Admins"
                                    },
                                    { id: "blocked", label: "Blocked" }
                                ].map(f => (
                                    <button
                                        key={f.id}
                                        type="button"
                                        className={`sync-filter-pill ${
                                            userFilter === f.id ? "active" : ""
                                        }`}
                                        onClick={() => {
                                            setUserFilter(f.id);
                                            setUserPage(1);
                                        }}
                                    >
                                        {f.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {loadingUsers ? (
                            <div className="sync-empty-hint">
                                <Loader2 size={20} className="spin" /> Loading
                                users...
                            </div>
                        ) : users.length === 0 ? (
                            <div className="sync-empty-hint">
                                No users match your filter.
                            </div>
                        ) : (
                            <div className="sync-admin-user-list">
                                {users.map(u => {
                                    const uIsSuper = Boolean(
                                        u.isSuperAdmin ||
                                            u.role === "superAdmin"
                                    );
                                    const uIsAdmin = u.role === "admin";
                                    const isMe =
                                        String(u._id) ===
                                        String(currentUser?._id);
                                    const manageable = canManageTarget(u);
                                    const isBusy = busyUserId === u._id;

                                    return (
                                        <div
                                            key={u._id}
                                            className={`sync-admin-user-card ${
                                                u.isBlocked ? "is-blocked" : ""
                                            }`}
                                        >
                                            <Avatar
                                                src={u.avatar}
                                                name={u.fullName || u.username}
                                                size={46}
                                                showOnline
                                                online={u.online}
                                            />

                                            <div className="sync-admin-user-info">
                                                <div className="sync-admin-user-top">
                                                    <strong>
                                                        {u.fullName}
                                                    </strong>
                                                    {isMe && (
                                                        <span className="sync-role-pill me">
                                                            You
                                                        </span>
                                                    )}
                                                    {uIsSuper ? (
                                                        <span className="sync-role-pill super">
                                                            <Crown size={12} />{" "}
                                                            Super Admin (.env)
                                                        </span>
                                                    ) : uIsAdmin ? (
                                                        <span className="sync-role-pill admin">
                                                            <ShieldCheck
                                                                size={12}
                                                            />{" "}
                                                            Platform Admin
                                                        </span>
                                                    ) : (
                                                        <span className="sync-role-pill user">
                                                            User
                                                        </span>
                                                    )}
                                                    {u.isBlocked && (
                                                        <span className="sync-role-pill blocked">
                                                            Blocked
                                                        </span>
                                                    )}
                                                </div>

                                                <div className="sync-admin-user-meta">
                                                    <span>@{u.username}</span>
                                                    <span>· {u.email}</span>
                                                    <span>
                                                        · {u.phoneNumber}
                                                    </span>
                                                    <span>
                                                        ·{" "}
                                                        {u.online
                                                            ? "🟢 Online"
                                                            : formatLastSeen(
                                                                  u.lastSeen
                                                              )}
                                                    </span>
                                                </div>
                                            </div>

                                            <div className="sync-admin-user-actions">
                                                {isSuperAdmin &&
                                                    !uIsSuper &&
                                                    !isMe && (
                                                        <button
                                                            type="button"
                                                            className="sync-btn secondary xs"
                                                            disabled={isBusy}
                                                            onClick={() =>
                                                                handleToggleAdminRole(
                                                                    u
                                                                )
                                                            }
                                                            title={
                                                                uIsAdmin
                                                                    ? "Remove Platform Admin role"
                                                                    : "Promote to Platform Admin"
                                                            }
                                                        >
                                                            {uIsAdmin ? (
                                                                <>
                                                                    <ShieldOff
                                                                        size={
                                                                            13
                                                                        }
                                                                    />
                                                                    <span>
                                                                        Remove
                                                                        Admin
                                                                    </span>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <Shield
                                                                        size={
                                                                            13
                                                                        }
                                                                    />
                                                                    <span>
                                                                        Make
                                                                        Admin
                                                                    </span>
                                                                </>
                                                            )}
                                                        </button>
                                                    )}

                                                {manageable && (
                                                    <>
                                                        <button
                                                            type="button"
                                                            className={`sync-btn xs ${
                                                                u.isBlocked
                                                                    ? "secondary"
                                                                    : "danger"
                                                            }`}
                                                            disabled={isBusy}
                                                            onClick={() =>
                                                                handleToggleBlock(
                                                                    u
                                                                )
                                                            }
                                                        >
                                                            <Ban size={13} />
                                                            <span>
                                                                {u.isBlocked
                                                                    ? "Unblock"
                                                                    : "Block"}
                                                            </span>
                                                        </button>

                                                        <button
                                                            type="button"
                                                            className="sync-icon-btn xs danger"
                                                            disabled={isBusy}
                                                            title="Delete user account"
                                                            onClick={() =>
                                                                handleDeleteUser(
                                                                    u
                                                                )
                                                            }
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {userPages > 1 && (
                            <div className="sync-admin-pagination">
                                <button
                                    type="button"
                                    className="sync-btn secondary xs"
                                    disabled={userPage <= 1 || loadingUsers}
                                    onClick={() => loadUsers(userPage - 1)}
                                >
                                    Previous
                                </button>
                                <span>
                                    Page {userPage} of {userPages}
                                </span>
                                <button
                                    type="button"
                                    className="sync-btn secondary xs"
                                    disabled={
                                        userPage >= userPages || loadingUsers
                                    }
                                    onClick={() => loadUsers(userPage + 1)}
                                >
                                    Next
                                </button>
                            </div>
                        )}
                    </section>
                )}

                {/* =========================================================
                    TAB 3: MEDIA INSPECTOR (IMAGES & VIDEOS ONLY)
                   ========================================================= */}
                {activeTab === "media" && (
                    <section className="sync-admin-section">
                        <div className="sync-admin-section-head">
                            <div>
                                <h3>
                                    Media Inspector (Images & Videos Only)
                                </h3>
                                <p className="sync-muted">
                                    🔒 Private chat text messages and story
                                    captions are never returned by the server.
                                    Only uploaded <strong>Images</strong> and{" "}
                                    <strong>Videos</strong> are shown here.
                                </p>
                            </div>
                            <button
                                type="button"
                                className="sync-btn secondary xs"
                                onClick={() => loadMedia(null)}
                                disabled={loadingMedia}
                            >
                                <RefreshCw
                                    size={14}
                                    className={loadingMedia ? "spin" : ""}
                                />
                                <span>Refresh</span>
                            </button>
                        </div>

                        <div className="sync-admin-toolbar">
                            <div className="sync-filter-pills">
                                {[
                                    { id: "chat", label: "Chat Media" },
                                    { id: "story", label: "Active Stories" }
                                ].map(s => (
                                    <button
                                        key={s.id}
                                        type="button"
                                        className={`sync-filter-pill ${
                                            mediaSource === s.id ? "active" : ""
                                        }`}
                                        onClick={() => setMediaSource(s.id)}
                                    >
                                        {s.label}
                                    </button>
                                ))}
                            </div>

                            <div className="sync-filter-pills">
                                {[
                                    {
                                        id: "all",
                                        label: "All (Images + Videos)"
                                    },
                                    { id: "image", label: "📷 Images Only" },
                                    { id: "video", label: "🎥 Videos Only" }
                                ].map(k => (
                                    <button
                                        key={k.id}
                                        type="button"
                                        className={`sync-filter-pill ${
                                            mediaKind === k.id ? "active" : ""
                                        }`}
                                        onClick={() => setMediaKind(k.id)}
                                    >
                                        {k.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {loadingMedia && mediaItems.length === 0 ? (
                            <div className="sync-empty-hint">
                                <Loader2 size={20} className="spin" /> Loading
                                media files...
                            </div>
                        ) : mediaItems.length === 0 ? (
                            <div className="sync-empty-hint">
                                No {mediaKind === "all" ? "image or video" : mediaKind}{" "}
                                files found in {mediaSource}.
                            </div>
                        ) : (
                            <>
                                <div className="sync-admin-media-grid">
                                    {mediaItems.map(item => (
                                        <article
                                            key={item.id}
                                            className="sync-admin-media-card"
                                        >
                                            <div
                                                className="sync-admin-media-thumb"
                                                onClick={() =>
                                                    setPreviewMedia(item)
                                                }
                                            >
                                                {item.type === "video" ? (
                                                    <video
                                                        src={item.url}
                                                        preload="metadata"
                                                        muted
                                                    />
                                                ) : (
                                                    <img
                                                        src={item.url}
                                                        alt="Shared media"
                                                        loading="lazy"
                                                    />
                                                )}
                                                <span className="sync-media-type-badge">
                                                    {item.type === "video" ? (
                                                        <>
                                                            <Video size={12} />{" "}
                                                            Video
                                                        </>
                                                    ) : (
                                                        <>
                                                            <ImageIcon
                                                                size={12}
                                                            />{" "}
                                                            Image
                                                        </>
                                                    )}
                                                </span>
                                            </div>

                                            <div className="sync-admin-media-body">
                                                <div className="sync-admin-media-sender">
                                                    <Avatar
                                                        src={
                                                            item.sender?.avatar
                                                        }
                                                        name={
                                                            item.sender
                                                                ?.fullName ||
                                                            item.sender
                                                                ?.username ||
                                                            "User"
                                                        }
                                                        size={28}
                                                    />
                                                    <div className="sync-admin-media-meta">
                                                        <strong>
                                                            {item.sender
                                                                ?.fullName ||
                                                                "Deleted user"}
                                                        </strong>
                                                        <span>
                                                            @
                                                            {item.sender
                                                                ?.username ||
                                                                "unknown"}{" "}
                                                            ·{" "}
                                                            {formatTime(
                                                                item.createdAt
                                                            )}
                                                        </span>
                                                    </div>
                                                </div>

                                                {item.chat && (
                                                    <div className="sync-admin-media-chat">
                                                        <span>
                                                            {item.chat.type ===
                                                            "group"
                                                                ? `Group: ${item.chat.name}`
                                                                : `Direct: ${item.chat.name}`}
                                                        </span>
                                                    </div>
                                                )}

                                                <div className="sync-admin-media-actions">
                                                    <button
                                                        type="button"
                                                        className="sync-btn secondary xs"
                                                        onClick={() =>
                                                            setPreviewMedia(
                                                                item
                                                            )
                                                        }
                                                    >
                                                        <Eye size={13} /> View
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="sync-btn danger xs"
                                                        disabled={
                                                            deletingMediaId ===
                                                            item.id
                                                        }
                                                        onClick={() =>
                                                            handleRemoveMedia(
                                                                item
                                                            )
                                                        }
                                                    >
                                                        <Trash2 size={13} />
                                                        <span>
                                                            {deletingMediaId ===
                                                            item.id
                                                                ? "Removing..."
                                                                : "Delete"}
                                                        </span>
                                                    </button>
                                                </div>
                                            </div>
                                        </article>
                                    ))}
                                </div>

                                {mediaNextBefore && (
                                    <div className="sync-load-more-wrap">
                                        <button
                                            type="button"
                                            className="sync-btn secondary sm"
                                            disabled={loadingMedia}
                                            onClick={() =>
                                                loadMedia(mediaNextBefore)
                                            }
                                        >
                                            {loadingMedia
                                                ? "Loading..."
                                                : "Load Older Media"}
                                        </button>
                                    </div>
                                )}
                            </>
                        )}
                    </section>
                )}

                {/* =========================================================
                    TAB 4: NOTICES & POPUP BROADCAST
                   ========================================================= */}
                {activeTab === "notices" && (
                    <section className="sync-admin-section">
                        <div className="sync-admin-notices-layout">
                            <form
                                className="sync-profile-card"
                                onSubmit={handlePublishNotice}
                            >
                                <h3>
                                    <Megaphone size={18} /> Publish New Notice
                                    (5s Popup + Push)
                                </h3>
                                <p className="sync-muted">
                                    Broadcast an announcement or offer to every
                                    user. Online users immediately see the popup
                                    (where <strong>OK unlocks after 5s</strong>
                                    ), and background/offline devices receive a
                                    rich Web Push notification with image &
                                    countdown.
                                </p>

                                <div className="sync-field">
                                    <label>Notice Title / Headline *</label>
                                    <input
                                        type="text"
                                        maxLength={120}
                                        placeholder="e.g. Diwali Offer ends tomorrow at 11:58 pm ⏳"
                                        value={noticeTitle}
                                        onChange={e =>
                                            setNoticeTitle(e.target.value)
                                        }
                                        required
                                    />
                                </div>

                                <div className="sync-field">
                                    <label>Notice Details / Body *</label>
                                    <textarea
                                        rows={3}
                                        maxLength={1000}
                                        placeholder="e.g. Annual Pass at ₹1101 instead of ₹1599."
                                        value={noticeBody}
                                        onChange={e =>
                                            setNoticeBody(e.target.value)
                                        }
                                        required
                                    />
                                </div>

                                <div className="sync-field">
                                    <label>
                                        Banner / Illustration Image (Optional)
                                    </label>
                                    <div className="sync-notice-upload-row">
                                        <label className="sync-btn secondary sm">
                                            {uploadingNoticeImg ? (
                                                <Loader2
                                                    size={15}
                                                    className="spin"
                                                />
                                            ) : (
                                                <Upload size={15} />
                                            )}
                                            <span>
                                                {uploadingNoticeImg
                                                    ? `Uploading ${noticeUploadPct}%...`
                                                    : "Upload Image"}
                                            </span>
                                            <input
                                                type="file"
                                                accept="image/*"
                                                hidden
                                                onChange={
                                                    handleNoticeImageUpload
                                                }
                                                disabled={uploadingNoticeImg}
                                            />
                                        </label>

                                        {noticeImageUrl && (
                                            <button
                                                type="button"
                                                className="sync-btn danger xs"
                                                onClick={() => {
                                                    setNoticeImageUrl("");
                                                    setNoticeImagePublicId("");
                                                }}
                                            >
                                                <X size={14} /> Remove Image
                                            </button>
                                        )}
                                    </div>
                                </div>

                                <div className="sync-field">
                                    <label>
                                        Live Countdown Target Time (Optional —
                                        shows big HH:MM:SS timer)
                                    </label>
                                    <input
                                        type="datetime-local"
                                        value={noticeCountdownTo}
                                        onChange={e =>
                                            setNoticeCountdownTo(e.target.value)
                                        }
                                    />
                                    <div className="sync-filter-pills mt-2">
                                        <button
                                            type="button"
                                            className="sync-filter-pill"
                                            onClick={() =>
                                                applyCountdownPreset("2h")
                                            }
                                        >
                                            +2 Hours
                                        </button>
                                        <button
                                            type="button"
                                            className="sync-filter-pill"
                                            onClick={() =>
                                                applyCountdownPreset("6h")
                                            }
                                        >
                                            +6 Hours
                                        </button>
                                        <button
                                            type="button"
                                            className="sync-filter-pill"
                                            onClick={() =>
                                                applyCountdownPreset(
                                                    "tomorrow2358"
                                                )
                                            }
                                        >
                                            Tomorrow 11:58 PM
                                        </button>
                                        <button
                                            type="button"
                                            className="sync-filter-pill"
                                            onClick={() =>
                                                applyCountdownPreset("3d")
                                            }
                                        >
                                            +3 Days
                                        </button>
                                        {noticeCountdownTo && (
                                            <button
                                                type="button"
                                                className="sync-filter-pill"
                                                onClick={() =>
                                                    applyCountdownPreset("none")
                                                }
                                            >
                                                Clear Timer
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {!noticeCountdownTo && (
                                    <div className="sync-field">
                                        <label>
                                            Keep Notice Active For (Days: 1–30)
                                        </label>
                                        <input
                                            type="number"
                                            min={1}
                                            max={30}
                                            value={noticeShowDays}
                                            onChange={e =>
                                                setNoticeShowDays(
                                                    e.target.value
                                                )
                                            }
                                        />
                                    </div>
                                )}

                                <button
                                    type="submit"
                                    className="sync-btn primary full"
                                    disabled={
                                        publishingNotice || uploadingNoticeImg
                                    }
                                >
                                    {publishingNotice ? (
                                        <>
                                            <Loader2
                                                size={16}
                                                className="spin"
                                            />
                                            <span>
                                                Publishing & Sending Push...
                                            </span>
                                        </>
                                    ) : (
                                        <>
                                            <Megaphone size={16} />
                                            <span>
                                                Publish Notice & Push to All
                                            </span>
                                        </>
                                    )}
                                </button>
                            </form>

                            {/* Live Preview Card */}
                            <div className="sync-admin-notice-preview-col">
                                <span className="sync-section-label">
                                    <Sparkles size={14} /> Live Popup &
                                    Notification Preview
                                </span>

                                <div className="sync-notice-popup is-preview">
                                    <div className="sync-notice-topbar">
                                        <div className="sync-notice-app-chip">
                                            <div className="sync-notice-app-icon">
                                                <SyncLogo size="mini" />
                                            </div>
                                            <div className="sync-notice-app-meta">
                                                <span className="sync-notice-app-name">
                                                    Sync
                                                </span>
                                                <span className="sync-notice-app-sub">
                                                    Official Notice
                                                </span>
                                            </div>
                                        </div>
                                        <span className="sync-notice-now">
                                            Now
                                        </span>
                                    </div>

                                    {noticeImageUrl && (
                                        <div className="sync-notice-hero-media">
                                            <img
                                                src={noticeImageUrl}
                                                alt="Preview"
                                            />
                                        </div>
                                    )}

                                    <div className="sync-notice-content">
                                        <h2 className="sync-notice-title">
                                            {noticeTitle.trim() ||
                                                "Diwali Offer ends tomorrow at 11:58 pm ⏳"}
                                        </h2>
                                        {previewDeadline && (
                                            <div className="sync-notice-deadline">
                                                {previewDeadline}
                                            </div>
                                        )}
                                        <p className="sync-notice-body">
                                            {noticeBody.trim() ||
                                                "Annual Pass at ₹1101 instead of ₹1599."}
                                        </p>
                                        {previewCountdown && (
                                            <div className="sync-notice-countdown">
                                                {previewCountdown}
                                            </div>
                                        )}
                                    </div>

                                    <div className="sync-notice-footer">
                                        <button
                                            type="button"
                                            className="sync-notice-ok-btn is-waiting"
                                            disabled
                                        >
                                            <span
                                                className="sync-notice-ok-fill"
                                                style={{ width: "40%" }}
                                            />
                                            <span className="sync-notice-ok-label">
                                                <Clock size={16} />
                                                <span>
                                                    Please read · OK in 5s
                                                </span>
                                            </span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Published Notices List */}
                        <div className="sync-profile-card mt-4">
                            <div className="sync-admin-section-head">
                                <h3>Published Notices ({notices.length})</h3>
                                <button
                                    type="button"
                                    className="sync-btn secondary xs"
                                    onClick={loadNotices}
                                    disabled={loadingNotices}
                                >
                                    <RefreshCw
                                        size={14}
                                        className={loadingNotices ? "spin" : ""}
                                    />
                                    <span>Refresh</span>
                                </button>
                            </div>

                            {loadingNotices ? (
                                <div className="sync-empty-hint">
                                    <Loader2 size={18} className="spin" />{" "}
                                    Loading notices...
                                </div>
                            ) : notices.length === 0 ? (
                                <div className="sync-empty-hint">
                                    No notices have been published yet.
                                </div>
                            ) : (
                                <div className="sync-admin-user-list">
                                    {notices.map(n => (
                                        <div
                                            key={n._id}
                                            className="sync-admin-user-card"
                                        >
                                            {n.image?.url && (
                                                <img
                                                    src={n.image.url}
                                                    alt={n.title}
                                                    className="sync-notice-list-thumb"
                                                />
                                            )}
                                            <div className="sync-admin-user-info">
                                                <div className="sync-admin-user-top">
                                                    <strong>{n.title}</strong>
                                                    <span
                                                        className={`sync-role-pill ${
                                                            n.active
                                                                ? "admin"
                                                                : "blocked"
                                                        }`}
                                                    >
                                                        {n.active
                                                            ? "Active"
                                                            : "Expired"}
                                                    </span>
                                                    <span className="sync-role-pill user">
                                                        ✓ OK'd:{" "}
                                                        {n.acknowledged || 0} /{" "}
                                                        {noticeTotalUsers}
                                                    </span>
                                                </div>
                                                <p className="sync-muted">
                                                    {n.body}
                                                </p>
                                                <div className="sync-admin-user-meta">
                                                    <span>
                                                        By @
                                                        {n.createdBy
                                                            ?.username ||
                                                            "admin"}
                                                    </span>
                                                    {n.countdownTo && (
                                                        <span>
                                                            ·{" "}
                                                            {formatNoticeDeadlineLine(
                                                                n.countdownTo
                                                            )}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                className="sync-btn danger xs"
                                                onClick={() =>
                                                    handleDeleteNotice(n._id)
                                                }
                                            >
                                                <Trash2 size={14} />
                                                <span>Delete</span>
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </section>
                )}

                {/* =========================================================
                    TAB 5: GROUPS
                   ========================================================= */}
                {activeTab === "groups" && (
                    <section className="sync-admin-section">
                        <div className="sync-admin-section-head">
                            <div>
                                <h3>Chat Groups ({groups.length})</h3>
                                <p className="sync-muted">
                                    Note: <strong>Group Admins</strong> listed
                                    below only manage their own group chat and
                                    do <strong>not</strong> have Platform Admin
                                    privileges.
                                </p>
                            </div>
                        </div>

                        <div className="sync-admin-toolbar">
                            <div className="sync-search-input-wrap">
                                <Search size={16} />
                                <input
                                    type="text"
                                    placeholder="Search groups by name..."
                                    value={groupSearch}
                                    onChange={e =>
                                        setGroupSearch(e.target.value)
                                    }
                                />
                            </div>
                        </div>

                        {loadingGroups ? (
                            <div className="sync-empty-hint">
                                <Loader2 size={20} className="spin" /> Loading
                                groups...
                            </div>
                        ) : groups.length === 0 ? (
                            <div className="sync-empty-hint">
                                No groups found.
                            </div>
                        ) : (
                            <div className="sync-admin-user-list">
                                {groups.map(g => (
                                    <div
                                        key={g.id}
                                        className="sync-admin-user-card"
                                    >
                                        <Avatar
                                            src={g.icon}
                                            name={g.name}
                                            size={44}
                                            isGroup
                                        />
                                        <div className="sync-admin-user-info">
                                            <div className="sync-admin-user-top">
                                                <strong>{g.name}</strong>
                                                <span className="sync-role-pill user">
                                                    {g.memberCount} members
                                                </span>
                                            </div>
                                            <div className="sync-admin-user-meta">
                                                <span>
                                                    Group Admins (Chat-only):{" "}
                                                    {(g.groupAdmins || [])
                                                        .map(
                                                            a =>
                                                                `@${a.username}`
                                                        )
                                                        .join(", ") || "None"}
                                                </span>
                                                {g.createdBy && (
                                                    <span>
                                                        · Created by @
                                                        {g.createdBy.username}
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        <button
                                            type="button"
                                            className="sync-btn danger xs"
                                            disabled={deletingGroupId === g.id}
                                            onClick={() => handleDeleteGroup(g)}
                                        >
                                            <Trash2 size={14} />
                                            <span>
                                                {deletingGroupId === g.id
                                                    ? "Deleting..."
                                                    : "Delete Group"}
                                            </span>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>
                )}
            </div>

            {/* Lightbox for inspecting Image or Video */}
            {previewMedia && (
                <div
                    className="sync-lightbox"
                    onClick={() => setPreviewMedia(null)}
                >
                    <button
                        type="button"
                        className="sync-icon-btn light lightbox-close"
                        onClick={() => setPreviewMedia(null)}
                    >
                        <X size={24} />
                    </button>
                    <div
                        className="sync-admin-lightbox-inner"
                        onClick={e => e.stopPropagation()}
                    >
                        {previewMedia.type === "video" ? (
                            <video
                                src={previewMedia.url}
                                controls
                                autoPlay
                                className="sync-admin-lightbox-video"
                            />
                        ) : (
                            <img src={previewMedia.url} alt="Media preview" />
                        )}
                        <div className="sync-admin-lightbox-bar">
                            <span>
                                Shared by{" "}
                                <strong>
                                    {previewMedia.sender?.fullName || "User"}
                                </strong>{" "}
                                (@{previewMedia.sender?.username || "unknown"})
                            </span>
                            <button
                                type="button"
                                className="sync-btn danger sm"
                                disabled={deletingMediaId === previewMedia.id}
                                onClick={() => handleRemoveMedia(previewMedia)}
                            >
                                <Trash2 size={15} /> Delete for Everyone
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
