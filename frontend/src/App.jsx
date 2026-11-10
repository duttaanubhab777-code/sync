import React, { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { Loader2 } from "lucide-react";
import SyncLogo from "./components/SyncLogo.jsx";
import { initializeApp } from "./store/authSlice.js";
import AppLayout from "./components/AppLayout.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import RegisterPage from "./pages/RegisterPage.jsx";
import ChatPage from "./pages/ChatPage.jsx";
import StoriesPage from "./pages/StoriesPage.jsx";
import ProfilePage from "./pages/ProfilePage.jsx";
import AdminPage from "./pages/AdminPage.jsx";

export const isPlatformAdmin = user =>
    Boolean(
        user &&
            (user.isSuperAdmin ||
                user.role === "superAdmin" ||
                user.role === "admin")
    );

function ProtectedRoute({ children }) {
    const { isAuthenticated, initializing, serverWaking } = useSelector(
        state => state.auth
    );

    if (initializing) {
        return (
            <div className="sync-splash-screen">
                <SyncLogo size="splash" />
                <h2>Sync</h2>
                <div className="sync-splash-status">
                    <Loader2 size={18} className="spin" />
                    <span>
                        {serverWaking
                            ? "Waking up the server. Please wait..."
                            : "Loading your workspace..."}
                    </span>
                </div>
            </div>
        );
    }

    if (!isAuthenticated) {
        return <Navigate to="/login" replace />;
    }

    return children;
}

function AdminRoute({ children }) {
    const user = useSelector(state => state.auth.user);
    if (!isPlatformAdmin(user)) {
        return <Navigate to="/chats" replace />;
    }
    return children;
}

function HomeRedirect() {
    const user = useSelector(state => state.auth.user);
    return (
        <Navigate to={isPlatformAdmin(user) ? "/admin" : "/chats"} replace />
    );
}

export default function App() {
    const dispatch = useDispatch();

    useEffect(() => {
        dispatch(initializeApp());
    }, [dispatch]);

    return (
        <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />

            <Route
                path="/"
                element={
                    <ProtectedRoute>
                        <AppLayout />
                    </ProtectedRoute>
                }
            >
                <Route index element={<HomeRedirect />} />
                <Route path="chats" element={<ChatPage />} />
                <Route path="chats/:conversationId" element={<ChatPage />} />
                <Route path="stories" element={<StoriesPage />} />
                <Route path="profile" element={<ProfilePage />} />
                <Route
                    path="admin"
                    element={
                        <AdminRoute>
                            <AdminPage />
                        </AdminRoute>
                    }
                />
            </Route>

            <Route path="*" element={<HomeRedirect />} />
        </Routes>
    );
}
