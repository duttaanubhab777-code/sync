import React, { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Globe, Loader2, LogIn, RefreshCw } from "lucide-react";
import Avatar from "./Avatar.jsx";
import { api, extractErrorMessage } from "../services/api.js";

// সময় সবসময় ভারতীয় সময়ে (IST, UTC+5:30), ডিভাইসের টাইমজোন যা-ই হোক
const IST_FORMAT = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
});

export const formatIST = value => {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return `${IST_FORMAT.format(d).replace(/\s?(am|pm)/i, m =>
        ` ${m.trim().toUpperCase()}`
    )} IST`;
};

// Admin / Super Admin: শেষ ২০টা লগইন (কে, কোন IP থেকে, IST-তে কখন)
export default function LoginHistoryAdmin({ flashError }) {
    const [logins, setLogins] = useState([]);
    const [loading, setLoading] = useState(true);
    // null = পুরো প্ল্যাটফর্ম, নইলে একজন ইউজারের নিজস্ব শেষ ২০টা
    const [focus, setFocus] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const qs = focus ? `?userId=${encodeURIComponent(focus.userId)}` : "";
            const res = await api.get(`/api/v1/admin/login-history${qs}`);
            setLogins(
                Array.isArray(res.data?.data?.logins) ? res.data.data.logins : []
            );
        } catch (err) {
            flashError?.(extractErrorMessage(err, "Could not load login history"));
        } finally {
            setLoading(false);
        }
    }, [focus, flashError]);

    useEffect(() => {
        load();
        // flashError প্রতি রেন্ডারে নতুন ফাংশন, তাই শুধু focus বদলালেই লোড হবে
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [focus]);

    return (
        <section className="sync-admin-section">
            <div className="sync-admin-section-head">
                <div>
                    <h3>
                        {focus
                            ? `Last ${logins.length || 20} logins — @${focus.username}`
                            : "Last 20 logins"}
                    </h3>
                    <p className="sync-muted">
                        {focus
                            ? "Only this user's most recent sign-ins."
                            : "Most recent sign-ins across Sync. Tap a person to see only their logins."}{" "}
                        Times are shown in IST.
                    </p>
                </div>
                <div className="sync-loginlog-actions">
                    {focus && (
                        <button
                            type="button"
                            className="sync-btn ghost sm"
                            onClick={() => setFocus(null)}
                        >
                            <ArrowLeft size={15} />
                            <span>All users</span>
                        </button>
                    )}
                    <button
                        type="button"
                        className="sync-btn ghost sm"
                        onClick={load}
                        disabled={loading}
                    >
                        {loading ? (
                            <Loader2 size={15} className="spin" />
                        ) : (
                            <RefreshCw size={15} />
                        )}
                        <span>Refresh</span>
                    </button>
                </div>
            </div>

            {loading && logins.length === 0 ? (
                <p className="sync-muted sync-loginlog-state">
                    <Loader2 size={16} className="spin" /> Loading…
                </p>
            ) : logins.length === 0 ? (
                <p className="sync-muted sync-loginlog-state">
                    No logins recorded yet.
                </p>
            ) : (
                <ol className="sync-loginlog-list">
                    {logins.map((l, i) => (
                        <li
                            key={`${l.userId}-${l.loginTime}-${i}`}
                            className="sync-loginlog-row"
                            style={{ "--i": Math.min(i, 12) }}
                        >
                            <span className="sync-loginlog-rank">{i + 1}</span>
                            <button
                                type="button"
                                className="sync-loginlog-who"
                                onClick={() =>
                                    !focus &&
                                    setFocus({
                                        userId: l.userId,
                                        username: l.username
                                    })
                                }
                                disabled={Boolean(focus)}
                                title={focus ? undefined : "Show only this user"}
                            >
                                <Avatar
                                    src={l.avatar}
                                    name={l.fullName || l.username}
                                    size={38}
                                />
                                <span className="sync-loginlog-name">
                                    <strong>{l.fullName || l.username}</strong>
                                    <small>@{l.username}</small>
                                </span>
                            </button>
                            <span className="sync-loginlog-meta">
                                <span className="sync-loginlog-ip">
                                    <Globe size={14} />
                                    <code>{l.ipAddress || "Unknown IP"}</code>
                                </span>
                                <span className="sync-loginlog-time">
                                    <LogIn size={14} />
                                    {formatIST(l.loginTime)}
                                </span>
                            </span>
                        </li>
                    ))}
                </ol>
            )}
        </section>
    );
}
