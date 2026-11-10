import React, { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import {
    UserRound,
    UserPlus,
    AtSign,
    Mail,
    Phone,
    Lock,
    Loader2,
    Eye,
    EyeOff,
    ShieldCheck,
    ArrowLeft,
    RefreshCw,
    CheckCircle2
} from "lucide-react";
import AuthShell from "../components/AuthShell.jsx";
import {
    clearAuthError,
    clearPendingSignup,
    sendSignupOtp,
    resendSignupOtp,
    verifySignupOtp
} from "../store/authSlice.js";
import { isPlatformAdmin } from "../App.jsx";

const OTP_LENGTH = 6;

const normalizeIndianPhone = value => {
    let v = String(value || "").replace(/[\s\-()]/g, "");
    if (v.startsWith("+91")) v = v.slice(3);
    else if (v.startsWith("91") && v.length === 12) v = v.slice(2);
    else if (v.startsWith("0") && v.length === 11) v = v.slice(1);
    return v;
};

const formatTimer = totalSeconds => {
    const sec = Math.max(0, Math.floor(totalSeconds));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
};

export default function RegisterPage() {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const {
        loading,
        otpSending,
        error,
        isAuthenticated,
        user,
        serverWaking
    } = useSelector(state => state.auth);

    const [form, setForm] = useState({
        username: "",
        fullName: "",
        email: "",
        phoneNumber: "",
        password: ""
    });
    const [showPass, setShowPass] = useState(false);
    const [localError, setLocalError] = useState("");
    const [infoMessage, setInfoMessage] = useState("");

    // "form" -> ধাপ ১ (অ্যাকাউন্টের তথ্য), "otp" -> ধাপ ২ (ইমেইল ওটিপি যাচাই)
    const [step, setStep] = useState("form");
    const [otpEmail, setOtpEmail] = useState("");
    const [otpDigits, setOtpDigits] = useState(() =>
        Array(OTP_LENGTH).fill("")
    );
    const [resendLeft, setResendLeft] = useState(0);
    const [expiresLeft, setExpiresLeft] = useState(0);

    const digitRefs = useRef([]);

    useEffect(() => {
        dispatch(clearAuthError());
        return () => {
            dispatch(clearPendingSignup());
        };
    }, [dispatch]);

    useEffect(() => {
        if (isAuthenticated && user) {
            navigate(isPlatformAdmin(user) ? "/admin" : "/chats", {
                replace: true
            });
        }
    }, [isAuthenticated, user, navigate]);

    // প্রতি সেকেন্ডে রিসেন্ড কুলডাউন ও কোডের মেয়াদের টাইমার কমানো
    useEffect(() => {
        if (step !== "otp") return undefined;
        const timer = setInterval(() => {
            setResendLeft(prev => (prev > 0 ? prev - 1 : 0));
            setExpiresLeft(prev => (prev > 0 ? prev - 1 : 0));
        }, 1000);
        return () => clearInterval(timer);
    }, [step]);

    const handleChange = e => {
        const { name, value } = e.target;
        setForm(prev => ({ ...prev, [name]: value }));
        setLocalError("");
        if (error) dispatch(clearAuthError());
    };

    const focusDigit = index => {
        const el = digitRefs.current[index];
        if (el) {
            el.focus();
            el.select?.();
        }
    };

    const handleSendOtp = async e => {
        e.preventDefault();
        setLocalError("");
        setInfoMessage("");
        dispatch(clearAuthError());

        const cleanUsername = form.username.trim().toLowerCase();
        if (!/^[a-z][a-z0-9_]{2,19}$/.test(cleanUsername)) {
            setLocalError(
                "Username must be 3–20 characters, start with a letter, and contain only lowercase letters, numbers, or _"
            );
            return;
        }
        if (form.fullName.trim().length < 3) {
            setLocalError("Full name must be at least 3 characters");
            return;
        }
        const cleanEmail = form.email.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanEmail)) {
            setLocalError("Enter a valid email address");
            return;
        }
        const normalizedPhone = normalizeIndianPhone(form.phoneNumber);
        if (!/^[6-9]\d{9}$/.test(normalizedPhone)) {
            setLocalError("Enter a valid 10-digit Indian mobile number");
            return;
        }
        if (form.password.length < 8) {
            setLocalError("Password must be at least 8 characters");
            return;
        }

        const res = await dispatch(
            sendSignupOtp({
                username: cleanUsername,
                fullName: form.fullName.trim(),
                email: cleanEmail,
                phoneNumber: normalizedPhone,
                password: form.password
            })
        );

        if (sendSignupOtp.fulfilled.match(res)) {
            const payload = res.payload || {};
            setOtpEmail(payload.email || cleanEmail);
            setOtpDigits(Array(OTP_LENGTH).fill(""));
            setResendLeft(payload.resendAfterSeconds ?? 60);
            setExpiresLeft(payload.expiresInSeconds ?? 600);
            setInfoMessage(
                payload.message ||
                    "Verification code sent! Check your inbox or spam folder."
            );
            setStep("otp");
            setTimeout(() => focusDigit(0), 60);
        } else if (res.payload?.retryAfterSeconds) {
            // যদি আগে থেকেই কোড পাঠানো থাকে এবং রিকোয়েস্ট কুলডাউনে আটকায়, তবুও ওটিপি স্ক্রিনে যাওয়ার সুযোগ
            setOtpEmail(cleanEmail);
            setResendLeft(res.payload.retryAfterSeconds);
            if (!expiresLeft) setExpiresLeft(600);
            setStep("otp");
            setTimeout(() => focusDigit(0), 60);
        }
    };

    const handleDigitChange = (index, rawValue) => {
        setLocalError("");
        if (error) dispatch(clearAuthError());

        const digitsOnly = String(rawValue || "").replace(/\D/g, "");
        if (!digitsOnly) {
            setOtpDigits(prev => {
                const next = [...prev];
                next[index] = "";
                return next;
            });
            return;
        }

        // একাধিক অঙ্ক পেস্ট বা টাইপ করলে ঘরগুলোতে পরপর বসানো
        if (digitsOnly.length > 1) {
            const chars = digitsOnly.slice(0, OTP_LENGTH).split("");
            setOtpDigits(prev => {
                const next = [...prev];
                for (let i = 0; i < chars.length && index + i < OTP_LENGTH; i++) {
                    next[index + i] = chars[i];
                }
                return next;
            });
            const targetIndex = Math.min(
                index + chars.length,
                OTP_LENGTH - 1
            );
            focusDigit(targetIndex);
            return;
        }

        const digit = digitsOnly[0];
        setOtpDigits(prev => {
            const next = [...prev];
            next[index] = digit;
            return next;
        });
        if (index < OTP_LENGTH - 1) {
            focusDigit(index + 1);
        }
    };

    const handleDigitKeyDown = (index, e) => {
        if (e.key === "Backspace") {
            if (otpDigits[index]) {
                setOtpDigits(prev => {
                    const next = [...prev];
                    next[index] = "";
                    return next;
                });
            } else if (index > 0) {
                e.preventDefault();
                setOtpDigits(prev => {
                    const next = [...prev];
                    next[index - 1] = "";
                    return next;
                });
                focusDigit(index - 1);
            }
        } else if (e.key === "ArrowLeft" && index > 0) {
            e.preventDefault();
            focusDigit(index - 1);
        } else if (e.key === "ArrowRight" && index < OTP_LENGTH - 1) {
            e.preventDefault();
            focusDigit(index + 1);
        }
    };

    const handleOtpPaste = e => {
        const pasted = (e.clipboardData?.getData("text") || "").replace(
            /\D/g,
            ""
        );
        if (!pasted) return;
        e.preventDefault();
        setLocalError("");
        if (error) dispatch(clearAuthError());

        const chars = pasted.slice(0, OTP_LENGTH).split("");
        const next = Array(OTP_LENGTH).fill("");
        chars.forEach((c, idx) => {
            next[idx] = c;
        });
        setOtpDigits(next);
        focusDigit(Math.min(chars.length, OTP_LENGTH) - 1);
    };

    const handleVerifyOtp = async e => {
        e.preventDefault();
        setLocalError("");
        setInfoMessage("");
        dispatch(clearAuthError());

        const code = otpDigits.join("");
        if (!/^\d{6}$/.test(code)) {
            setLocalError("Please enter the 6-digit verification code");
            return;
        }

        const res = await dispatch(
            verifySignupOtp({
                email: otpEmail || form.email.trim().toLowerCase(),
                otp: code
            })
        );

        if (verifySignupOtp.fulfilled.match(res)) {
            const createdUser = res.payload?.user;
            navigate(isPlatformAdmin(createdUser) ? "/admin" : "/chats", {
                replace: true
            });
        }
    };

    const handleResendOtp = async () => {
        if (resendLeft > 0 || otpSending || loading) return;
        setLocalError("");
        setInfoMessage("");
        dispatch(clearAuthError());

        const targetEmail = otpEmail || form.email.trim().toLowerCase();
        const res = await dispatch(resendSignupOtp({ email: targetEmail }));

        if (resendSignupOtp.fulfilled.match(res)) {
            const payload = res.payload || {};
            setOtpDigits(Array(OTP_LENGTH).fill(""));
            setResendLeft(payload.resendAfterSeconds ?? 60);
            setExpiresLeft(payload.expiresInSeconds ?? 600);
            setInfoMessage(
                payload.message ||
                    "A new 6-digit code has been sent to your email."
            );
            focusDigit(0);
        } else if (res.payload?.retryAfterSeconds) {
            setResendLeft(res.payload.retryAfterSeconds);
        }
    };

    const handleBackToForm = () => {
        setStep("form");
        setLocalError("");
        setInfoMessage("");
        dispatch(clearAuthError());
    };

    const joinedOtp = otpDigits.join("");
    const isOtpComplete = joinedOtp.length === OTP_LENGTH;

    return (
        <AuthShell serverWaking={serverWaking}>
            {step === "form" ? (
                <>
                    <div className="sync-auth-head">
                        <h1>Create your account</h1>
                        <p>
                            Chat with friends and groups in real time. We will
                            send a 6-digit code to verify your email.
                        </p>
                    </div>

                    {(localError || error) && (
                        <div className="sync-alert error">
                            {localError || error}
                        </div>
                    )}

                    <form className="sync-auth-form" onSubmit={handleSendOtp}>
                        <div className="sync-grid-2">
                            <div className="sync-field">
                                <label htmlFor="reg-username">Username</label>
                                <div className="sync-input-icon">
                                    <AtSign size={18} />
                                    <input
                                        id="reg-username"
                                        type="text"
                                        name="username"
                                        placeholder="jarvis_01"
                                        value={form.username}
                                        onChange={handleChange}
                                        maxLength={20}
                                        autoComplete="username"
                                        required
                                    />
                                </div>
                            </div>

                            <div className="sync-field">
                                <label htmlFor="reg-name">Full name</label>
                                <div className="sync-input-icon">
                                    <UserRound size={18} />
                                    <input
                                        id="reg-name"
                                        type="text"
                                        name="fullName"
                                        placeholder="Anubhab Dutta"
                                        value={form.fullName}
                                        onChange={handleChange}
                                        maxLength={50}
                                        autoComplete="name"
                                        required
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="sync-field">
                            <label htmlFor="reg-email">Email address</label>
                            <div className="sync-input-icon">
                                <Mail size={18} />
                                <input
                                    id="reg-email"
                                    type="email"
                                    name="email"
                                    placeholder="you@example.com"
                                    value={form.email}
                                    onChange={handleChange}
                                    autoComplete="email"
                                    required
                                />
                            </div>
                        </div>

                        <div className="sync-field">
                            <label htmlFor="reg-phone">
                                Indian mobile number (10 digits)
                            </label>
                            <div className="sync-input-icon">
                                <Phone size={18} />
                                <input
                                    id="reg-phone"
                                    type="tel"
                                    name="phoneNumber"
                                    placeholder="9876543210 or +91 9876543210"
                                    value={form.phoneNumber}
                                    onChange={handleChange}
                                    autoComplete="tel"
                                    required
                                />
                            </div>
                        </div>

                        <div className="sync-field">
                            <label htmlFor="reg-pass">
                                Password (min 8 characters)
                            </label>
                            <div className="sync-input-icon">
                                <Lock size={18} />
                                <input
                                    id="reg-pass"
                                    type={showPass ? "text" : "password"}
                                    name="password"
                                    placeholder="At least 8 characters"
                                    value={form.password}
                                    onChange={handleChange}
                                    minLength={8}
                                    maxLength={64}
                                    autoComplete="new-password"
                                    required
                                />
                                <button
                                    type="button"
                                    className="sync-pass-toggle"
                                    onClick={() => setShowPass(v => !v)}
                                    aria-label={
                                        showPass
                                            ? "Hide password"
                                            : "Show password"
                                    }
                                >
                                    {showPass ? (
                                        <EyeOff size={18} />
                                    ) : (
                                        <Eye size={18} />
                                    )}
                                </button>
                            </div>
                        </div>

                        <button
                            type="submit"
                            className="sync-btn primary full lg"
                            disabled={loading}
                        >
                            {loading ? (
                                <>
                                    <Loader2 size={18} className="spin" />
                                    <span>Sending verification code...</span>
                                </>
                            ) : (
                                <>
                                    <UserPlus size={18} />
                                    <span>Send verification code</span>
                                </>
                            )}
                        </button>
                    </form>
                </>
            ) : (
                <>
                    <div className="sync-auth-head">
                        <h1>Verify your email</h1>
                        <p>
                            Enter the 6-digit verification code we sent to your
                            email address.
                        </p>
                        <div className="sync-otp-email-bar">
                            <span className="sync-otp-email-badge">
                                <Mail size={15} />
                                <strong>{otpEmail}</strong>
                            </span>
                            <button
                                type="button"
                                className="sync-otp-change-btn"
                                onClick={handleBackToForm}
                                disabled={loading}
                            >
                                <ArrowLeft size={14} />
                                <span>Change details</span>
                            </button>
                        </div>
                    </div>

                    {(localError || error) && (
                        <div className="sync-alert error">
                            {localError || error}
                        </div>
                    )}

                    {!localError && !error && infoMessage && (
                        <div className="sync-alert success">
                            <CheckCircle2 size={17} />
                            <span>{infoMessage}</span>
                        </div>
                    )}

                    <form className="sync-auth-form" onSubmit={handleVerifyOtp}>
                        <div className="sync-field">
                            <label htmlFor="otp-digit-0">
                                6-digit verification code
                            </label>
                            <div
                                className="sync-otp-grid"
                                onPaste={handleOtpPaste}
                            >
                                {otpDigits.map((digit, idx) => (
                                    <input
                                        key={idx}
                                        id={`otp-digit-${idx}`}
                                        ref={el => {
                                            digitRefs.current[idx] = el;
                                        }}
                                        type="text"
                                        inputMode="numeric"
                                        pattern="[0-9]*"
                                        maxLength={6}
                                        autoComplete={
                                            idx === 0
                                                ? "one-time-code"
                                                : "off"
                                        }
                                        className={`sync-otp-digit${digit ? " is-filled" : ""}`}
                                        value={digit}
                                        onChange={e =>
                                            handleDigitChange(
                                                idx,
                                                e.target.value
                                            )
                                        }
                                        onKeyDown={e =>
                                            handleDigitKeyDown(idx, e)
                                        }
                                        aria-label={`Digit ${idx + 1}`}
                                        disabled={loading}
                                    />
                                ))}
                            </div>
                        </div>

                        <div className="sync-otp-meta">
                            <span className="sync-otp-timer">
                                {expiresLeft > 0
                                    ? `Code expires in ${formatTimer(expiresLeft)}`
                                    : "Code expired — request a new one"}
                            </span>

                            <button
                                type="button"
                                className="sync-otp-resend-btn"
                                onClick={handleResendOtp}
                                disabled={
                                    resendLeft > 0 || otpSending || loading
                                }
                            >
                                {otpSending ? (
                                    <>
                                        <Loader2 size={14} className="spin" />
                                        <span>Sending...</span>
                                    </>
                                ) : resendLeft > 0 ? (
                                    <span>Resend in {resendLeft}s</span>
                                ) : (
                                    <>
                                        <RefreshCw size={14} />
                                        <span>Resend code</span>
                                    </>
                                )}
                            </button>
                        </div>

                        <button
                            type="submit"
                            className="sync-btn primary full lg"
                            disabled={loading || !isOtpComplete}
                        >
                            {loading ? (
                                <>
                                    <Loader2 size={18} className="spin" />
                                    <span>Verifying & creating account...</span>
                                </>
                            ) : (
                                <>
                                    <ShieldCheck size={18} />
                                    <span>Verify & create account</span>
                                </>
                            )}
                        </button>
                    </form>
                </>
            )}

            <div className="sync-auth-footer">
                <span>Already have an account?</span>
                <Link to="/login">Sign in</Link>
            </div>
        </AuthShell>
    );
}
