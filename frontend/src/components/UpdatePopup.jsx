import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, Clock, Check, ArrowRight, Sparkles } from "lucide-react";
import SyncLogo from "./SyncLogo.jsx";
import {
    isAndroidApp,
    useAppUpdates,
    openDownload,
    formatSize,
    formatReleaseDate
} from "../services/appUpdate.js";

const WAIT_SECONDS = 5; // নোটিসের মতোই ৫ সেকেন্ড পর বাটন চালু হয়
const SHOW_DELAY_MS = 3200; // boot splash শেষ হওয়ার পর পপআপ আসে
const LATER_MS = 12 * 60 * 60 * 1000; // "Later" চাপলে ১২ ঘণ্টা আর দেখায় না

const laterKey = build => `sync_update_later_${build}`;
const wasPostponed = build => {
    try {
        const t = Number(localStorage.getItem(laterKey(build)) || 0);
        return Date.now() - t < LATER_MS;
    } catch {
        return false;
    }
};

export default function UpdatePopup() {
    const navigate = useNavigate();
    const { hasUpdate, latest, installedBuild, latestDownloadUrl } =
        useAppUpdates({ autoLoad: isAndroidApp });

    const [delayDone, setDelayDone] = useState(false);
    const [closed, setClosed] = useState(false);
    const [wait, setWait] = useState(WAIT_SECONDS);
    const [started, setStarted] = useState(false);

    const build = latest?.build;

    useEffect(() => {
        if (!hasUpdate || !build) return;
        if (wasPostponed(build)) {
            setClosed(true);
            return;
        }
        const t = setTimeout(() => setDelayDone(true), SHOW_DELAY_MS);
        return () => clearTimeout(t);
    }, [hasUpdate, build]);

    const visible = hasUpdate && delayDone && !closed;

    useEffect(() => {
        if (!visible) return;
        setWait(WAIT_SECONDS);
        const id = setInterval(() => {
            setWait(prev => {
                if (prev <= 1) {
                    clearInterval(id);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(id);
    }, [visible]);

    if (!visible || !latest) return null;

    const changes = latest.changes || [];
    const shown = changes.slice(0, 4);
    const extra = Math.max(0, changes.length - shown.length);
    const meta = [formatReleaseDate(latest.publishedAt), formatSize(latest.sizeBytes)]
        .filter(Boolean)
        .join(" · ");
    const progressPct = ((WAIT_SECONDS - wait) / WAIT_SECONDS) * 100;

    const handleUpdate = () => {
        if (wait > 0) return;
        openDownload(latest.downloadUrl || latestDownloadUrl);
        setStarted(true);
    };

    const handleLater = () => {
        try {
            localStorage.setItem(laterKey(build), String(Date.now()));
        } catch {
            // storage বন্ধ থাকলে শুধু এই সেশনে লুকাবে
        }
        setClosed(true);
    };

    const handleSeeAll = () => {
        setClosed(true);
        navigate("/updates");
    };

    return (
        <div
            className="sync-notice-backdrop sync-update-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sync-update-title"
        >
            <div className="sync-notice-popup sync-update-popup">
                <div className="sync-notice-topbar">
                    <div className="sync-notice-app-chip">
                        <div className="sync-notice-app-icon">
                            <SyncLogo size="mini" />
                        </div>
                        <div className="sync-notice-app-meta">
                            <span className="sync-notice-app-name">Sync</span>
                            <span className="sync-notice-app-sub">
                                <Sparkles size={11} /> Update available
                            </span>
                        </div>
                    </div>
                    <span className="sync-update-new-pill">New</span>
                </div>

                <div className="sync-update-hero">
                    <div className="sync-update-hero-icon">
                        <Download size={30} />
                    </div>
                    <h2 id="sync-update-title" className="sync-notice-title">
                        {started ? "Download started" : "A new version is ready"}
                    </h2>
                    <div className="sync-update-versions">
                        <span className="sync-update-ver is-old">
                            {installedBuild ? `v1.0.${installedBuild}` : "Old version"}
                        </span>
                        <ArrowRight size={16} />
                        <span className="sync-update-ver is-new">v{latest.version}</span>
                    </div>
                    {meta && <span className="sync-update-meta">{meta}</span>}
                </div>

                {started ? (
                    <p className="sync-update-steps">
                        Your browser is downloading the new Sync. When it
                        finishes, open the file and tap <b>Install</b>. Your
                        chats and login stay as they are.
                    </p>
                ) : (
                    <div className="sync-update-changes">
                        <span className="sync-update-changes-title">What's new</span>
                        <ul>
                            {shown.length > 0 ? (
                                shown.map((c, i) => <li key={i}>{c}</li>)
                            ) : (
                                <li>Improvements and bug fixes</li>
                            )}
                        </ul>
                        {extra > 0 && (
                            <button
                                type="button"
                                className="sync-update-more"
                                onClick={handleSeeAll}
                            >
                                +{extra} more
                            </button>
                        )}
                    </div>
                )}

                <div className="sync-notice-footer sync-update-footer">
                    {started ? (
                        <button
                            type="button"
                            className="sync-notice-ok-btn is-ready"
                            onClick={() => setClosed(true)}
                        >
                            <span className="sync-notice-ok-label">
                                <Check size={18} />
                                <span>Done</span>
                            </span>
                        </button>
                    ) : (
                        <>
                            <button
                                type="button"
                                className={`sync-notice-ok-btn ${
                                    wait > 0 ? "is-waiting" : "is-ready"
                                }`}
                                disabled={wait > 0}
                                onClick={handleUpdate}
                            >
                                <span
                                    className="sync-notice-ok-fill"
                                    style={{ width: `${progressPct}%` }}
                                />
                                <span className="sync-notice-ok-label">
                                    {wait > 0 ? (
                                        <>
                                            <Clock size={17} />
                                            <span>Update in {wait}s</span>
                                        </>
                                    ) : (
                                        <>
                                            <Download size={18} />
                                            <span>Update now</span>
                                        </>
                                    )}
                                </span>
                            </button>
                            <button
                                type="button"
                                className="sync-update-later"
                                onClick={handleLater}
                            >
                                Later
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
