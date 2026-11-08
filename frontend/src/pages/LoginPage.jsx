import React, { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { Lock, UserRound, Loader2, Eye, EyeOff, LogIn } from "lucide-react";
import AuthShell from "../components/AuthShell.jsx";
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
        <AuthShell serverWaking={serverWaking}>
            <div className="sync-auth-head">
                <h1>Welcome back</h1>
                <p>
                    Sign in with your username, email, or 10-digit mobile
                    number.
                </p>
            </div>

            {error && <div className="sync-alert error">{error}</div>}

            <form className="sync-auth-form" onSubmit={handleSubmit}>
                <div className="sync-field">
                    <label htmlFor="login-id">Username, email or phone</label>
                    <div className="sync-input-icon">
                        <UserRound size={18} />
                        <input
                            id="login-id"
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
                    <label htmlFor="login-pass">Password</label>
                    <div className="sync-input-icon">
                        <Lock size={18} />
                        <input
                            id="login-pass"
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
                            <span>Signing in...</span>
                        </>
                    ) : (
                        <>
                            <LogIn size={18} />
                            <span>Sign in</span>
                        </>
                    )}
                </button>
            </form>

            <div className="sync-auth-footer">
                <span>New to Sync?</span>
                <Link to="/register">Create an account</Link>
            </div>
        </AuthShell>
    );
}
