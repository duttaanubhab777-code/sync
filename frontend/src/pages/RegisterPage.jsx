import React, { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import {
    User,
    AtSign,
    Mail,
    Phone,
    Lock,
    Loader2,
    Eye,
    EyeOff
} from "lucide-react";
import SyncLogo from "../components/SyncLogo.jsx";
import BrandTyping from "../components/BrandTyping.jsx";
import { clearAuthError, registerUser } from "../store/authSlice.js";

export default function RegisterPage() {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const { loading, error, isAuthenticated, serverWaking } = useSelector(
        state => state.auth
    );

    const [form, setForm] = useState({
        username: "",
        fullName: "",
        email: "",
        phoneNumber: "",
        password: ""
    });
    const [showPass, setShowPass] = useState(false);
    const [localError, setLocalError] = useState("");

    useEffect(() => {
        dispatch(clearAuthError());
    }, [dispatch]);

    useEffect(() => {
        if (isAuthenticated) {
            navigate("/chats", { replace: true });
        }
    }, [isAuthenticated, navigate]);

    const handleChange = e => {
        const { name, value } = e.target;
        setForm(prev => ({ ...prev, [name]: value }));
        setLocalError("");
    };

    const handleSubmit = async e => {
        e.preventDefault();
        setLocalError("");

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
        if (form.password.length < 8) {
            setLocalError("Password must be at least 8 characters");
            return;
        }

        const res = await dispatch(
            registerUser({
                username: cleanUsername,
                fullName: form.fullName.trim(),
                email: form.email.trim().toLowerCase(),
                phoneNumber: form.phoneNumber.trim(),
                password: form.password
            })
        );
        if (registerUser.fulfilled.match(res)) {
            navigate("/chats", { replace: true });
        }
    };

    return (
        <div className="sync-auth-page">
            {serverWaking && (
                <div className="sync-top-banner waking">
                    <Loader2 size={16} className="spin" />
                    <span>Starting the server. This may take a few moments...</span>
                </div>
            )}

            <div className="sync-auth-card">
                <div className="sync-auth-brand">
                    <SyncLogo size="auth" />
                    <h1>Create your Sync account</h1>
                    <p>Fast, secure real-time messaging with friends and groups</p>
                    <BrandTyping />
                </div>

                {(localError || error) && (
                    <div className="sync-alert error">
                        {localError || error}
                    </div>
                )}

                <form className="sync-auth-form" onSubmit={handleSubmit}>
                    <div className="sync-grid-2">
                        <div className="sync-field">
                            <label>Username *</label>
                            <div className="sync-input-icon">
                                <AtSign size={16} />
                                <input
                                    type="text"
                                    name="username"
                                    placeholder="jarvis_01"
                                    value={form.username}
                                    onChange={handleChange}
                                    maxLength={20}
                                    required
                                />
                            </div>
                        </div>

                        <div className="sync-field">
                            <label>Full Name *</label>
                            <div className="sync-input-icon">
                                <User size={16} />
                                <input
                                    type="text"
                                    name="fullName"
                                    placeholder="Anubhab Dutta"
                                    value={form.fullName}
                                    onChange={handleChange}
                                    maxLength={50}
                                    required
                                />
                            </div>
                        </div>
                    </div>

                    <div className="sync-field">
                        <label>Email Address *</label>
                        <div className="sync-input-icon">
                            <Mail size={16} />
                            <input
                                type="email"
                                name="email"
                                placeholder="you@example.com"
                                value={form.email}
                                onChange={handleChange}
                                required
                            />
                        </div>
                    </div>

                    <div className="sync-field">
                        <label>Indian Mobile Number (10 digits) *</label>
                        <div className="sync-input-icon">
                            <Phone size={16} />
                            <input
                                type="tel"
                                name="phoneNumber"
                                placeholder="9876543210 or +91 9876543210"
                                value={form.phoneNumber}
                                onChange={handleChange}
                                required
                            />
                        </div>
                    </div>

                    <div className="sync-field">
                        <label>Password (min 8 chars) *</label>
                        <div className="sync-input-icon">
                            <Lock size={16} />
                            <input
                                type={showPass ? "text" : "password"}
                                name="password"
                                placeholder="At least 8 characters"
                                value={form.password}
                                onChange={handleChange}
                                minLength={8}
                                maxLength={64}
                                required
                            />
                            <button
                                type="button"
                                className="sync-pass-toggle"
                                onClick={() => setShowPass(v => !v)}
                                tabIndex={-1}
                            >
                                {showPass ? (
                                    <EyeOff size={16} />
                                ) : (
                                    <Eye size={16} />
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
                                <span>Creating Account...</span>
                            </>
                        ) : (
                            "Create Account"
                        )}
                    </button>
                </form>

                <div className="sync-auth-footer">
                    <span>Already have an account?</span>{" "}
                    <Link to="/login">Sign In</Link>
                </div>
            </div>
        </div>
    );
}
