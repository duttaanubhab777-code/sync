import React, { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { MessageSquare, Lock, User, Loader2, Eye, EyeOff } from "lucide-react";
import { clearAuthError, loginUser } from "../store/authSlice.js";

export default function LoginPage() {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const { loading, error, isAuthenticated, serverWaking } = useSelector(
        state => state.auth
    );

    const [identifier, setIdentifier] = useState("");
    const [password, setPassword] = useState("");
    const [showPass, setShowPass] = useState(false);

    useEffect(() => {
        dispatch(clearAuthError());
    }, [dispatch]);

    useEffect(() => {
        if (isAuthenticated) {
            navigate("/chats", { replace: true });
        }
    }, [isAuthenticated, navigate]);

    const handleSubmit = async e => {
        e.preventDefault();
        if (!identifier.trim() || !password) return;
        const res = await dispatch(
            loginUser({
                identifier: identifier.trim(),
                password
            })
        );
        if (loginUser.fulfilled.match(res)) {
            navigate("/chats", { replace: true });
        }
    };

    return (
        <div className="sync-auth-page">
            {serverWaking && (
                <div className="sync-top-banner waking">
                    <Loader2 size={16} className="spin" />
                    <span>
                        সার্ভার জাগছে (Render Cold Start)... একটু অপেক্ষা করুন
                    </span>
                </div>
            )}

            <div className="sync-auth-card">
                <div className="sync-auth-brand">
                    <div className="sync-auth-logo">
                        <MessageSquare size={28} />
                    </div>
                    <h1>Welcome back to Sync</h1>
                    <p>
                        Sign in with your username, email, or 10-digit mobile
                        number
                    </p>
                </div>

                {error && <div className="sync-alert error">{error}</div>}

                <form className="sync-auth-form" onSubmit={handleSubmit}>
                    <div className="sync-field">
                        <label>Username, Email or Phone</label>
                        <div className="sync-input-icon">
                            <User size={17} />
                            <input
                                type="text"
                                placeholder="username / you@email.com / 9876543210"
                                value={identifier}
                                onChange={e => setIdentifier(e.target.value)}
                                autoComplete="username"
                                required
                            />
                        </div>
                    </div>

                    <div className="sync-field">
                        <label>Password</label>
                        <div className="sync-input-icon">
                            <Lock size={17} />
                            <input
                                type={showPass ? "text" : "password"}
                                placeholder="Enter your password"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                autoComplete="current-password"
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
                                <span>Signing in...</span>
                            </>
                        ) : (
                            "Sign In"
                        )}
                    </button>
                </form>

                <div className="sync-auth-footer">
                    <span>Don't have an account?</span>{" "}
                    <Link to="/register">Create a Sync account</Link>
                </div>
            </div>
        </div>
    );
}
