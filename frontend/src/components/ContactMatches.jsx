import React from "react";
import { BookUser, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import Avatar from "./Avatar.jsx";

// "Contacts on Sync" তালিকা: permission বাটন + ফোনবুকের নম্বরে মিলে যাওয়া ইউজার
export default function ContactMatches({
    contacts, // useContactMatches() এর ফলাফল
    onPick,
    selectedIds, // গ্রুপে একাধিক বাছাইয়ের জন্য (optional)
    busyId,
    actionLabel = "Message"
}) {
    const { mode, status, matches, errorMsg, enable, refresh } = contacts;
    if (status === "unsupported") return null;

    return (
        <div className="sync-contacts-block">
            <div className="sync-contacts-head">
                <span className="sync-section-label">Contacts on Sync</span>
                {status === "ready" && (
                    <button
                        type="button"
                        className="sync-icon-btn xs"
                        onClick={refresh}
                        aria-label="Refresh contacts"
                    >
                        <RefreshCw size={14} />
                    </button>
                )}
            </div>

            {status === "update" && (
                <div className="sync-contacts-cta">
                    <span className="sync-contacts-cta-icon">
                        <BookUser size={22} />
                    </span>
                    <div className="sync-contacts-cta-text">
                        <strong>Update the Sync app</strong>
                        <small>
                            Contacts sync needs the latest version of the Sync
                            app. Install the new version to use it.
                        </small>
                    </div>
                </div>
            )}

            {(status === "prompt" || status === "denied" || status === "error") && (
                <div className="sync-contacts-cta">
                    <span className="sync-contacts-cta-icon">
                        <BookUser size={22} />
                    </span>
                    <div className="sync-contacts-cta-text">
                        <strong>
                            {status === "denied"
                                ? "Contacts permission is off"
                                : status === "error"
                                  ? "Could not read contacts"
                                  : "Find friends from your contacts"}
                        </strong>
                        <small>
                            {status === "denied"
                                ? `Open phone Settings > Apps > Sync > Permissions and allow Contacts, then tap Retry.${
                                      errorMsg ? ` (${errorMsg})` : ""
                                  }`
                                : status === "error"
                                  ? errorMsg || "Something went wrong. Please try again."
                                  : mode === "native"
                                    ? "Allow contacts access to see who in your phonebook is already on Sync."
                                    : "Pick contacts to see who is already on Sync."}
                        </small>
                    </div>
                    <button
                        type="button"
                        className="sync-btn primary sm"
                        onClick={enable}
                    >
                        {status === "prompt"
                            ? mode === "native"
                                ? "Allow"
                                : "Choose"
                            : "Retry"}
                    </button>
                </div>
            )}

            {status === "loading" && (
                <div className="sync-empty-hint">
                    <Loader2 size={18} className="spin" /> Checking your
                    contacts...
                </div>
            )}

            {status === "ready" && matches.length === 0 && (
                <div className="sync-empty-hint">
                    None of your contacts are on Sync yet
                </div>
            )}

            {status === "ready" &&
                matches.map(u => {
                    const selected = selectedIds?.has(u._id);
                    return (
                        <div
                            key={u._id}
                            className={`sync-user-row ${
                                selectedIds ? "clickable" : ""
                            } ${selected ? "selected" : ""}`}
                            onClick={selectedIds ? () => onPick(u) : undefined}
                        >
                            <Avatar
                                src={u.avatar}
                                name={u.fullName || u.username}
                                size={42}
                                showOnline
                                online={u.online}
                            />
                            <div className="sync-user-meta">
                                <div className="sync-user-name">
                                    {u.contactName || u.fullName}
                                </div>
                                <div className="sync-user-sub">
                                    {u.contactName && u.contactName !== u.fullName
                                        ? `${u.fullName} · `
                                        : ""}
                                    @{u.username}
                                </div>
                            </div>
                            {selectedIds ? (
                                <CheckCircle2
                                    size={18}
                                    className={
                                        selected
                                            ? "chip-check active"
                                            : "chip-check"
                                    }
                                />
                            ) : (
                                <button
                                    type="button"
                                    className="sync-btn primary sm"
                                    disabled={busyId === u._id}
                                    onClick={() => onPick(u)}
                                >
                                    {busyId === u._id
                                        ? "Opening..."
                                        : actionLabel}
                                </button>
                            )}
                        </div>
                    );
                })}
        </div>
    );
}
