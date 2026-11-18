import React, { useState } from "react";
import {
    Download,
    RefreshCw,
    CheckCircle2,
    Sparkles,
    History,
    ChevronDown,
    Smartphone,
    ArrowRight,
    Loader2,
    CloudOff
} from "lucide-react";
import SyncLogo from "../components/SyncLogo.jsx";
import {
    useAppUpdates,
    openDownload,
    formatReleaseDate,
    formatSize
} from "../services/appUpdate.js";

function ChangeList({ changes }) {
    if (!changes || changes.length === 0) {
        return <p className="sync-muted">Improvements and bug fixes.</p>;
    }
    return (
        <ul className="sync-updates-changes">
            {changes.map((c, i) => (
                <li key={i}>{c}</li>
            ))}
        </ul>
    );
}

export default function UpdatesPage() {
    const {
        status,
        error,
        latest,
        history,
        hasUpdate,
        isAndroidApp,
        installedBuild,
        latestDownloadUrl,
        refresh
    } = useAppUpdates();

    const [openBuild, setOpenBuild] = useState(null);
    const [checking, setChecking] = useState(false);

    const handleRefresh = async () => {
        setChecking(true);
        await refresh();
        setChecking(false);
    };

    const downloadLatest = () =>
        openDownload(latest?.downloadUrl || latestDownloadUrl);

    const upToDate = isAndroidApp && latest && !hasUpdate;
    const expanded = openBuild ?? latest?.build ?? null;

    return (
        <div className="sync-profile-page sync-updates-page">
            <div className="sync-profile-container">
                <div className="sync-profile-card sync-updates-hero">
                    <div className="sync-updates-hero-logo">
                        <SyncLogo size="hero" glow />
                    </div>
                    <h2>App updates</h2>
                    <p className="sync-muted">
                        Versions, what changed in each one, and the latest
                        Android app.
                    </p>
                </div>

                {/* ---------- অবস্থা কার্ড ---------- */}
                <div
                    className={`sync-profile-card sync-updates-status ${
                        hasUpdate ? "has-update" : upToDate ? "is-ok" : ""
                    }`}
                >
                    {status === "loading" && !latest && (
                        <div className="sync-updates-state">
                            <Loader2 size={26} className="spin" />
                            <strong>Checking for updates...</strong>
                        </div>
                    )}

                    {status === "error" && !latest && (
                        <div className="sync-updates-state">
                            <CloudOff size={26} />
                            <strong>{error || "Could not check for updates"}</strong>
                            <button
                                type="button"
                                className="sync-btn secondary sm"
                                onClick={handleRefresh}
                                disabled={checking}
                            >
                                <RefreshCw size={15} />
                                <span>Try again</span>
                            </button>
                        </div>
                    )}

                    {latest && hasUpdate && (
                        <div className="sync-updates-state">
                            <span className="sync-updates-badge">
                                <Sparkles size={13} /> Update available
                            </span>
                            <div className="sync-update-versions">
                                <span className="sync-update-ver is-old">
                                    {installedBuild
                                        ? `v1.0.${installedBuild}`
                                        : "Old version"}
                                </span>
                                <ArrowRight size={16} />
                                <span className="sync-update-ver is-new">
                                    v{latest.version}
                                </span>
                            </div>
                            <button
                                type="button"
                                className="sync-btn primary"
                                onClick={downloadLatest}
                            >
                                <Download size={17} />
                                <span>Update now</span>
                            </button>
                            <small className="sync-muted">
                                The APK downloads in your browser. Open it when
                                it finishes and tap Install. Your chats stay as
                                they are.
                            </small>
                        </div>
                    )}

                    {upToDate && (
                        <div className="sync-updates-state">
                            <CheckCircle2 size={30} className="sync-updates-ok" />
                            <strong>You're up to date</strong>
                            <span className="sync-muted">
                                Installed: v1.0.{installedBuild}
                            </span>
                            <button
                                type="button"
                                className="sync-btn ghost sm"
                                onClick={handleRefresh}
                                disabled={checking}
                            >
                                {checking ? (
                                    <Loader2 size={15} className="spin" />
                                ) : (
                                    <RefreshCw size={15} />
                                )}
                                <span>Check again</span>
                            </button>
                        </div>
                    )}

                    {latest && !isAndroidApp && (
                        <div className="sync-updates-state">
                            <Smartphone size={28} />
                            <strong>Sync for Android</strong>
                            <span className="sync-muted">
                                Latest version: v{latest.version}
                                {latest.sizeBytes
                                    ? ` · ${formatSize(latest.sizeBytes)}`
                                    : ""}
                            </span>
                            <button
                                type="button"
                                className="sync-btn primary"
                                onClick={downloadLatest}
                            >
                                <Download size={17} />
                                <span>Download the Android app</span>
                            </button>
                            <small className="sync-muted">
                                On the web you always get the newest Sync
                                automatically.
                            </small>
                        </div>
                    )}
                </div>

                {/* ---------- সর্বশেষ ভার্সনে কী এসেছে ---------- */}
                {latest && (
                    <div className="sync-profile-card">
                        <h3>
                            <Sparkles size={18} /> What's new in v{latest.version}
                        </h3>
                        <span className="sync-muted sync-updates-date">
                            {formatReleaseDate(latest.publishedAt)}
                        </span>
                        <ChangeList changes={latest.changes} />
                    </div>
                )}

                {/* ---------- ভার্সনের ইতিহাস ---------- */}
                {history.length > 0 && (
                    <div className="sync-profile-card">
                        <h3>
                            <History size={18} /> Version history
                        </h3>
                        <div className="sync-updates-history">
                            {history.map(r => {
                                const isOpen = expanded === r.build;
                                const isInstalled =
                                    isAndroidApp && r.build === installedBuild;
                                return (
                                    <div
                                        key={r.build}
                                        className={`sync-updates-item ${
                                            isOpen ? "is-open" : ""
                                        }`}
                                    >
                                        <button
                                            type="button"
                                            className="sync-updates-item-head"
                                            onClick={() =>
                                                setOpenBuild(isOpen ? -1 : r.build)
                                            }
                                            aria-expanded={isOpen}
                                        >
                                            <span className="sync-updates-item-ver">
                                                v{r.version}
                                            </span>
                                            {r.build === latest?.build && (
                                                <span className="sync-updates-tag">
                                                    Latest
                                                </span>
                                            )}
                                            {isInstalled && (
                                                <span className="sync-updates-tag is-installed">
                                                    Installed
                                                </span>
                                            )}
                                            <span className="sync-updates-item-date">
                                                {formatReleaseDate(r.publishedAt)}
                                            </span>
                                            <ChevronDown
                                                size={17}
                                                className="sync-updates-chevron"
                                            />
                                        </button>
                                        {isOpen && (
                                            <div className="sync-updates-item-body">
                                                <ChangeList changes={r.changes} />
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
