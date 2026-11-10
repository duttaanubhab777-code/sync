import React, { useEffect, useState, useMemo } from "react";
import { useSelector } from "react-redux";
import { Check, Clock, Sparkles, Loader2 } from "lucide-react";
import SyncLogo from "./SyncLogo.jsx";
import { api } from "../services/api.js";

const OK_WAIT_SECONDS = 5;

const timeFmt = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true
});
const dateFmt = new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short"
});
const dayStart = d =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export const formatNoticeDeadlineLine = iso => {
    if (!iso) return "";
    const end = new Date(iso);
    if (Number.isNaN(end.getTime())) return "";
    const days = Math.round((dayStart(end) - dayStart(new Date())) / 86400000);
    const when =
        days === 0
            ? "today"
            : days === 1
              ? "tomorrow"
              : days < 0
                ? dateFmt.format(end)
                : `on ${dateFmt.format(end)}`;
    return `Ends ${when} at ${timeFmt.format(end).toLowerCase()} ⏳`;
};

export const formatCountdownHMS = (iso, nowMs = Date.now()) => {
    if (!iso) return null;
    const endMs = new Date(iso).getTime();
    if (Number.isNaN(endMs)) return null;
    const diffSec = Math.max(0, Math.floor((endMs - nowMs) / 1000));
    const hours = String(Math.floor(diffSec / 3600)).padStart(2, "0");
    const minutes = String(Math.floor((diffSec % 3600) / 60)).padStart(2, "0");
    const seconds = String(diffSec % 60).padStart(2, "0");
    return `${hours}:${minutes}:${seconds}`;
};

export default function NoticePopup() {
    const { isAuthenticated, user } = useSelector(state => state.auth);
    const [queue, setQueue] = useState([]);
    const [waitSeconds, setWaitSeconds] = useState(OK_WAIT_SECONDS);
    const [acknowledging, setAcknowledging] = useState(false);
    const [nowMs, setNowMs] = useState(() => Date.now());

    // লগইন অবস্থায় বকেয়া নোটিসগুলো লোড করা
    useEffect(() => {
        if (!isAuthenticated || !user?._id) {
            setQueue([]);
            return;
        }
        let active = true;
        api.get("/api/notices/pending")
            .then(res => {
                if (!active) return;
                const list = res.data?.data || [];
                setQueue(list);
            })
            .catch(() => {});

        return () => {
            active = false;
        };
    }, [isAuthenticated, user?._id]);

    // রিয়েল-টাইমে নতুন নোটিস বা ডিলিট হওয়া নোটিস শোনা
    useEffect(() => {
        const onNewNotice = evt => {
            const notice = evt.detail;
            if (!notice?._id) return;
            setQueue(prev => {
                if (prev.some(n => String(n._id) === String(notice._id))) {
                    return prev;
                }
                return [...prev, notice];
            });
        };

        const onRemovedNotice = evt => {
            const noticeId = evt.detail;
            if (!noticeId) return;
            setQueue(prev =>
                prev.filter(n => String(n._id) !== String(noticeId))
            );
        };

        window.addEventListener("sync:notice-new", onNewNotice);
        window.addEventListener("sync:notice-removed", onRemovedNotice);
        return () => {
            window.removeEventListener("sync:notice-new", onNewNotice);
            window.removeEventListener("sync:notice-removed", onRemovedNotice);
        };
    }, []);

    const current = queue[0] || null;

    // নতুন নোটিস সামনে এলেই ৫ সেকেন্ডের কাউন্টডাউন শুরু
    useEffect(() => {
        if (!current?._id) return;
        setWaitSeconds(OK_WAIT_SECONDS);
        setAcknowledging(false);

        const timer = setInterval(() => {
            setWaitSeconds(prev => {
                if (prev <= 1) {
                    clearInterval(timer);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(timer);
    }, [current?._id]);

    // অফার/কাউন্টডাউন থাকলে প্রতি সেকেন্ডে HH:MM:SS আপডেট
    useEffect(() => {
        if (!current?.countdownTo) return;
        setNowMs(Date.now());
        const tick = setInterval(() => setNowMs(Date.now()), 1000);
        return () => clearInterval(tick);
    }, [current?._id, current?.countdownTo]);

    const countdownDisplay = useMemo(
        () =>
            current?.countdownTo
                ? formatCountdownHMS(current.countdownTo, nowMs)
                : null,
        [current?.countdownTo, nowMs]
    );

    const deadlineLine = useMemo(
        () =>
            current?.countdownTo
                ? formatNoticeDeadlineLine(current.countdownTo)
                : "",
        [current?.countdownTo]
    );

    if (!current) return null;

    const handleAcknowledge = async () => {
        if (waitSeconds > 0 || acknowledging) return;
        setAcknowledging(true);
        const id = current._id;
        try {
            await api.post(`/api/notices/${id}/ack`);
        } catch {
            // নেটওয়ার্ক এরর হলেও ইউজারকে আটকে রাখা হবে না
        } finally {
            setQueue(prev => prev.filter(n => String(n._id) !== String(id)));
            setAcknowledging(false);
        }
    };

    const progressPct =
        ((OK_WAIT_SECONDS - waitSeconds) / OK_WAIT_SECONDS) * 100;

    return (
        <div
            className="sync-notice-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sync-notice-title"
        >
            <div className="sync-notice-popup">
                <div className="sync-notice-topbar">
                    <div className="sync-notice-app-chip">
                        <div className="sync-notice-app-icon">
                            <SyncLogo size="mini" />
                        </div>
                        <div className="sync-notice-app-meta">
                            <span className="sync-notice-app-name">Sync</span>
                            <span className="sync-notice-app-sub">
                                <Sparkles size={11} /> Official Notice
                            </span>
                        </div>
                    </div>
                    <div className="sync-notice-top-right">
                        {queue.length > 1 && (
                            <span className="sync-notice-queue-pill">
                                1 of {queue.length}
                            </span>
                        )}
                        <span className="sync-notice-now">Now</span>
                    </div>
                </div>

                {current.image?.url && (
                    <div className="sync-notice-hero-media">
                        <img
                            src={current.image.url}
                            alt={current.title}
                            loading="eager"
                        />
                    </div>
                )}

                <div className="sync-notice-content">
                    <h2 id="sync-notice-title" className="sync-notice-title">
                        {current.title}
                    </h2>

                    {deadlineLine && (
                        <div className="sync-notice-deadline">
                            {deadlineLine}
                        </div>
                    )}

                    <p className="sync-notice-body">{current.body}</p>

                    {countdownDisplay && (
                        <div
                            className="sync-notice-countdown"
                            aria-label="Time remaining"
                        >
                            {countdownDisplay}
                        </div>
                    )}
                </div>

                <div className="sync-notice-footer">
                    <button
                        type="button"
                        className={`sync-notice-ok-btn ${
                            waitSeconds > 0 ? "is-waiting" : "is-ready"
                        }`}
                        disabled={waitSeconds > 0 || acknowledging}
                        onClick={handleAcknowledge}
                    >
                        <span
                            className="sync-notice-ok-fill"
                            style={{ width: `${progressPct}%` }}
                        />
                        <span className="sync-notice-ok-label">
                            {acknowledging ? (
                                <>
                                    <Loader2 size={17} className="spin" />
                                    <span>Saving...</span>
                                </>
                            ) : waitSeconds > 0 ? (
                                <>
                                    <Clock size={17} />
                                    <span>
                                        Please read · OK in {waitSeconds}s
                                    </span>
                                </>
                            ) : (
                                <>
                                    <Check size={18} />
                                    <span>OK</span>
                                </>
                            )}
                        </span>
                    </button>
                </div>
            </div>
        </div>
    );
}
