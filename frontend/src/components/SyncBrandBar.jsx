import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Mail, LogOut } from "lucide-react";
import SyncLogo from "./SyncLogo.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import useSignOut from "../hooks/useSignOut.js";

// Shared compact actions in the top brand bar.
export default function SyncBrandBar({ className = "" }) {
    const [confirmLogout, setConfirmLogout] = useState(false);
    const [loggingOut, setLoggingOut] = useState(false);
    const signOut = useSignOut();

    const handleLogout = async () => {
        setLoggingOut(true);
        await signOut();
    };

    return (
        <>
            <div className={`sync-brandbar ${className}`.trim()}>
                <div className="sync-brandbar-identity">
                    <SyncLogo size="bar" />
                    <span className="sync-brandbar-name">Sync</span>
                </div>
                <div className="sync-brandbar-actions">
                    <Link
                        to="/contact"
                        className="sync-brandbar-action"
                        title="Contact Sync"
                        aria-label="Contact Sync"
                    >
                        <Mail size={17} />
                    </Link>
                    <button
                        type="button"
                        className="sync-brandbar-action"
                        onClick={() => setConfirmLogout(true)}
                        title="Sign out"
                        aria-label="Sign out"
                    >
                        <LogOut size={17} />
                    </button>
                </div>
            </div>
            {confirmLogout && (
                <ConfirmDialog
                    icon={LogOut}
                    title="Sign out of Sync?"
                    message="You will need to sign in again to read your chats and stories."
                    confirmLabel="Sign out"
                    busy={loggingOut}
                    onConfirm={handleLogout}
                    onCancel={() => setConfirmLogout(false)}
                />
            )}
        </>
    );
}
