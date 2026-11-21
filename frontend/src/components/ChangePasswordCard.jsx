import React, { useState } from "react";
import { Link } from "react-router-dom";
import { KeyRound, Loader2 } from "lucide-react";
import PasswordField from "./PasswordField.jsx";
import {
    api,
    extractErrorMessage,
    setStoredTokens
} from "../services/api.js";

// প্রোফাইলে পাসওয়ার্ড বদলানো। সফল হলে এই ডিভাইসে নতুন token বসে, বাকি সব ডিভাইস লগআউট হয়।
export default function ChangePasswordCard({ email = "" }) {
    const [current, setCurrent] = useState("");
    const [next, setNext] = useState("");
    const [confirm, setConfirm] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [done, setDone] = useState("");

    const submit = async e => {
        e.preventDefault();
        setError("");
        setDone("");
        if (next.length < 8) return setError("New password must be at least 8 characters");
        if (next === current)
            return setError("New password must be different from the current one");
        if (next !== confirm) return setError("New passwords do not match");

        setBusy(true);
        try {
            const res = await api.post("/api/v1/auth/change-password", {
                currentPassword: current,
                newPassword: next
            });
            const { accessToken, refreshToken } = res.data?.data || {};
            setStoredTokens({ accessToken, refreshToken });
            setCurrent("");
            setNext("");
            setConfirm("");
            setDone(res.data?.message || "Password changed");
        } catch (err) {
            setError(extractErrorMessage(err, "Could not change the password"));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="sync-profile-card">
            <h3>
                <KeyRound size={18} /> Change Password
            </h3>
            <p className="sync-muted">
                Choose a new password. Your other devices will be signed out.
            </p>

            {error && <div className="sync-alert error">{error}</div>}
            {done && <div className="sync-alert success">{done}</div>}

            <form className="sync-changepass-form" onSubmit={submit}>
                <PasswordField
                    id="cp-current"
                    label="Current password"
                    autoComplete="current-password"
                    value={current}
                    onChange={v => {
                        setError("");
                        setCurrent(v);
                    }}
                    disabled={busy}
                />
                <PasswordField
                    id="cp-new"
                    label="New password"
                    placeholder="At least 8 characters"
                    value={next}
                    onChange={v => {
                        setError("");
                        setNext(v);
                    }}
                    showMeter
                    disabled={busy}
                />
                <PasswordField
                    id="cp-confirm"
                    label="Confirm new password"
                    value={confirm}
                    onChange={v => {
                        setError("");
                        setConfirm(v);
                    }}
                    disabled={busy}
                />

                <div className="sync-changepass-actions">
                    <button
                        type="submit"
                        className="sync-btn primary"
                        disabled={busy || !current || !next || !confirm}
                    >
                        {busy ? (
                            <Loader2 size={16} className="spin" />
                        ) : (
                            <KeyRound size={16} />
                        )}
                        <span>{busy ? "Updating..." : "Update password"}</span>
                    </button>
                    <Link
                        to="/forgot-password"
                        state={{ email }}
                        className="sync-changepass-forgot"
                    >
                        Forgot your current password?
                    </Link>
                </div>
            </form>
        </div>
    );
}
