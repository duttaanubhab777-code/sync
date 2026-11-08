import React, { useState, useEffect } from "react";
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
    EyeOff
} from "lucide-react";
import AuthShell from "../components/AuthShell.jsx";
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
        <AuthShell serverWaking={serverWaking}>
            <div className="sync-auth-head">
                <h1>Create your account</h1>
                <p>Chat with friends and groups in real time. It only takes a minute.</p>
            </div>

            {(localError || error) && (
                <div className="sync-alert error">{localError || error}</div>
            )}

            <form className="sync-auth-form" onSubmit={handleSubmit}>
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
                    <label htmlFor="reg-phone">Indian mobile number (10 digits)</label>
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
                    <label htmlFor="reg-pass">Password (min 8 characters)</label>
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
                            aria-label={showPass ? "Hide password" : "Show password"}
                        >
                            {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
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
                            <span>Creating account...</span>
                        </>
                    ) : (
                        <>
                            <UserPlus size={18} />
                            <span>Create account</span>
                        </>
                    )}
                </button>
            </form>

            <div className="sync-auth-footer">
                <span>Already have an account?</span>
                <Link to="/login">Sign in</Link>
            </div>
        </AuthShell>
    );
}
