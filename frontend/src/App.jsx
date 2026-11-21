import React, { useEffect } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
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
import ContactPage from "./pages/ContactPage.jsx";
import UpdatesPage from "./pages/UpdatesPage.jsx";
import UpdatePopup from "./components/UpdatePopup.jsx";
import { createBackHandler } from "./services/backNavigation.js";

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
    const navigate = useNavigate();

    useEffect(() => {
        dispatch(initializeApp());
    }, [dispatch]);

    // Android APK-র Back বাটন: MainActivity এই ফাংশন ডাকে।
    // পপআপ খোলা থাকলে বন্ধ, নইলে আগের পেজে; একদম হোমে থাকলে false (APK তখন অ্যাপ মিনিমাইজ করে)
    useEffect(() => {
        const handler = createBackHandler(navigate);
        window.__syncHandleBack = handler;
        return () => {
            if (window.__syncHandleBack === handler) {
                delete window.__syncHandleBack;
            }
        };
    }, [navigate]);

    return (
        <>
        <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/contact" element={<ContactPage />} />

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
                <Route path="updates" element={<UpdatesPage />} />
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
        {/* Android অ্যাপে নতুন ভার্সন থাকলে ৫ সেকেন্ডের কাউন্টডাউন সহ আপডেট পপআপ */}
        <UpdatePopup />
        </>
    );
}
