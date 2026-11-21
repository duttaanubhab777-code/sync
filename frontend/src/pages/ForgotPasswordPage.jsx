import React, { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import {
    ArrowLeft,
    KeyRound,
    Loader2,
    Mail,
    RefreshCw,
    ShieldCheck
} from "lucide-react";
import AuthShell from "../components/AuthShell.jsx";
import OtpBoxes, { OTP_LENGTH } from "../components/OtpBoxes.jsx";
import PasswordField from "../components/PasswordField.jsx";
import useSignOut from "../hooks/useSignOut.js";
import { api, extractErrorMessage } from "../services/api.js";

const formatTimer = total => {
    const m = Math.floor(total / 60);
    const s = String(total % 60).padStart(2, "0");
    return `${m}:${s}`;
};

const emptyDigits = () => Array(OTP_LENGTH).fill("");

// পাসওয়ার্ড ভুলে গেলে: ১) ইমেইল দিন -> কোড আসে  ২) কোড + নতুন পাসওয়ার্ড দিন
export default function ForgotPasswordPage() {
    const navigate = useNavigate();
    const location = useLocation();
    const signOut = useSignOut();
    const { serverWaking, isAuthenticated } = useSelector(s => s.auth);

    const [step, setStep] = useState("email"); // "email" | "reset"
    const [email, setEmail] = useState(location.state?.email || "");
    const [digits, setDigits] = useState(emptyDigits);
    const [newPassword, setNewPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [info, setInfo] = useState("");
    const [resendLeft, setResendLeft] = useState(0);
    const [expiresLeft, setExpiresLeft] = useState(0);

    useEffect(() => {
        if (step !== "reset") return undefined;
        const t = setInterval(() => {
            setResendLeft(v => (v > 0 ? v - 1 : 0));
            setExpiresLeft(v => (v > 0 ? v - 1 : 0));
        }, 1000);
        return () => clearInterval(t);
    }, [step]);

    const sendCode = async ({ resend = false } = {}) => {
        setError("");
        setInfo("");
        setBusy(true);
        try {
            const res = await api.post("/api/v1/auth/forgot-password/send-otp", {
                email: email.trim().toLowerCase()
            });
            const data = res.data?.data || {};
            setResendLeft(data.resendAfterSeconds ?? 60);
            setExpiresLeft(data.expiresInSeconds ?? 600);
            setDigits(emptyDigits());
            if (resend) setInfo("If the account exists, a new code is on its way.");
            setStep("reset");
        } catch (err) {
            setError(extractErrorMessage(err, "Could not send the code"));
        } finally {
            setBusy(false);
        }
    };

    const handleEmailSubmit = e => {
        e.preventDefault();
        if (!email.trim() || busy) return;
        sendCode();
    };

    const handleReset = async e => {
        e.preventDefault();
        setError("");
        setInfo("");

        const code = digits.join("");
        if (!/^\d{6}$/.test(code)) return setError("Please enter the 6-digit code");
        if (newPassword.length < 8)
            return setError("Password must be at least 8 characters");
        if (newPassword !== confirm) return setError("Passwords do not match");

        setBusy(true);
        try {
            await api.post("/api/v1/auth/forgot-password/reset", {
                email: email.trim().toLowerCase(),
                otp: code,
                newPassword
            });
            // রিসেটে সব ডিভাইস লগআউট হয়; এই ডিভাইসে লগইন থাকলে পরিষ্কার করে লগইন পেজে পাঠানো
            if (isAuthenticated) await signOut();
            navigate("/login", { replace: true, state: { passwordReset: true } });
        } catch (err) {
            setError(extractErrorMessage(err, "Could not reset the password"));
            setBusy(false);
        }
    };

    const complete = digits.join("").length === OTP_LENGTH;

    return (
        <AuthShell serverWaking={serverWaking}>
            {step === "email" ? (
                <>
                    <div className="sync-auth-head">
                        <h1>Forgot password?</h1>
                        <p>
                            Enter the email you signed up with. We will send a
                            6-digit code to reset your password.
                        </p>
                    </div>

                    {error && <div className="sync-alert error">{error}</div>}

                    <form className="sync-auth-form" onSubmit={handleEmailSubmit}>
                        <div className="sync-field">
                            <label htmlFor="fp-email">Email</label>
                            <div className="sync-input-icon">
                                <Mail size={18} />
                                <input
                                    id="fp-email"
                                    type="email"
                                    placeholder="you@example.com"
                                    value={email}
                                    onChange={e => setEmail(e.target.value)}
                                    autoComplete="email"
                                    autoFocus
                                    required
                                />
                            </div>
                        </div>

                        <button
                            type="submit"
                            className="sync-btn primary full lg"
                            disabled={busy}
                        >
                            {busy ? (
                                <>
                                    <Loader2 size={18} className="spin" />
                                    <span>Sending code...</span>
                                </>
                            ) : (
                                <>
                                    <KeyRound size={18} />
                                    <span>Send reset code</span>
                                </>
                            )}
                        </button>
                    </form>
                </>
            ) : (
                <>
                    <div className="sync-auth-head">
                        <h1>Reset password</h1>
                        <p>
                            If an account exists for this email, we sent a
                            6-digit code. Enter it with your new password.
                        </p>
                    </div>

                    <div className="sync-otp-email-bar">
                        <span className="sync-otp-email-badge">
                            <Mail size={15} />
                            <strong>{email}</strong>
                        </span>
                        <button
                            type="button"
                            className="sync-otp-change-btn"
                            onClick={() => {
                                setStep("email");
                                setError("");
                                setInfo("");
                            }}
                            disabled={busy}
                        >
                            <ArrowLeft size={14} />
                            <span>Change</span>
                        </button>
                    </div>

                    {error && <div className="sync-alert error">{error}</div>}
                    {info && <div className="sync-alert success">{info}</div>}

                    <form className="sync-auth-form" onSubmit={handleReset}>
                        <div className="sync-field">
                            <label htmlFor="otp-digit-0">6-digit code</label>
                            <OtpBoxes
                                digits={digits}
                                onChange={d => {
                                    setError("");
                                    setDigits(d);
                                }}
                                disabled={busy}
                            />
                        </div>

                        <div className="sync-otp-meta">
                            <span className="sync-otp-timer">
                                {expiresLeft > 0
                                    ? `Code expires in ${formatTimer(expiresLeft)}`
                                    : "Code expired, request a new one"}
                            </span>
                            <button
                                type="button"
                                className="sync-otp-resend-btn"
                                onClick={() => sendCode({ resend: true })}
                                disabled={resendLeft > 0 || busy}
                            >
                                {resendLeft > 0 ? (
                                    <span>Resend in {resendLeft}s</span>
                                ) : (
                                    <>
                                        <RefreshCw size={14} />
                                        <span>Resend code</span>
                                    </>
                                )}
                            </button>
                        </div>

                        <PasswordField
                            id="fp-new"
                            label="New password"
                            placeholder="At least 8 characters"
                            value={newPassword}
                            onChange={v => {
                                setError("");
                                setNewPassword(v);
                            }}
                            showMeter
                            disabled={busy}
                        />
                        <PasswordField
                            id="fp-confirm"
                            label="Confirm new password"
                            placeholder="Type it again"
                            value={confirm}
                            onChange={v => {
                                setError("");
                                setConfirm(v);
                            }}
                            disabled={busy}
                        />

                        <button
                            type="submit"
                            className="sync-btn primary full lg"
                            disabled={busy || !complete || !newPassword || !confirm}
                        >
                            {busy ? (
                                <>
                                    <Loader2 size={18} className="spin" />
                                    <span>Resetting...</span>
                                </>
                            ) : (
                                <>
                                    <ShieldCheck size={18} />
                                    <span>Reset password</span>
                                </>
                            )}
                        </button>
                    </form>
                </>
            )}

            <div className="sync-auth-footer">
                <span>Remembered it?</span>
                <Link to="/login">Back to sign in</Link>
            </div>
        </AuthShell>
    );
}
