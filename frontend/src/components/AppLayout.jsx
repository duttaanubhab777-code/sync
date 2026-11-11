import React, { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import {
    MessageCircle,
    Aperture,
    UserRound,
    ShieldCheck,
    Crown,
    Power,
    WifiOff,
    Loader2,
    Mail,
    LogOut
} from "lucide-react";
import Avatar from "./Avatar.jsx";
import SyncLogo from "./SyncLogo.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import NoticePopup from "./NoticePopup.jsx";
import EnableNotifications from "./notifications/EnableNotifications.jsx";
import useSignOut from "../hooks/useSignOut.js";
import { forceLogout } from "../store/authSlice.js";
import { fetchConversations, resetChatState } from "../store/chatSlice.js";
import { fetchStories } from "../store/storySlice.js";
import { connectSocket, disconnectSocket } from "../services/socket.js";
import { isPlatformAdmin } from "../App.jsx";

export default function AppLayout() {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const location = useLocation();
    const signOut = useSignOut();

    const { user, isAuthenticated, serverWaking } = useSelector(
        state => state.auth
    );
    const { conversations, socketConnected, reconnecting } = useSelector(
        state => state.chat
    );
    const { storyGroups } = useSelector(state => state.story);

    const [confirmLogout, setConfirmLogout] = useState(false);
    const [loggingOut, setLoggingOut] = useState(false);

    const isAdmin = isPlatformAdmin(user);
    const isSuperAdmin = Boolean(
        user?.isSuperAdmin || user?.role === "superAdmin"
    );

    const totalUnread = conversations.reduce(
        (acc, c) => acc + Number(c.unread || 0),
        0
    );

    const hasUnseenStories = storyGroups.some(g => !g.isMine && g.hasUnseen);

    // মোবাইলে চ্যাট খোলা থাকলে নিচের নেভ লুকিয়ে composer-কে জায়গা দেওয়া হয়
    const inChat = /^\/chats\/[^/]+/.test(location.pathname);

    useEffect(() => {
        if (!isAuthenticated) return;
        dispatch(fetchConversations());
        dispatch(fetchStories());
        connectSocket();

        return () => {
            disconnectSocket();
        };
    }, [isAuthenticated, dispatch]);

    useEffect(() => {
        const handleUnauthorized = () => {
            disconnectSocket();
            dispatch(resetChatState());
            dispatch(forceLogout());
            navigate("/login", { replace: true });
        };
        window.addEventListener("sync:unauthorized", handleUnauthorized);
        return () =>
            window.removeEventListener("sync:unauthorized", handleUnauthorized);
    }, [dispatch, navigate]);

    const handleConfirmLogout = async () => {
        setLoggingOut(true);
        await signOut();
    };

    const navClass = ({ isActive }) =>
        `sync-nav-item ${isActive ? "active" : ""}`;

    return (
        <div className={`sync-app-shell ${inChat ? "in-chat" : ""}`}>
            {serverWaking && (
                <div className="sync-top-banner waking">
                    <Loader2 size={16} className="spin" />
                    <span>Waking up the server. This may take a few seconds.</span>
                </div>
            )}
            {!serverWaking && !socketConnected && reconnecting && (
                <div className="sync-top-banner offline">
                    <WifiOff size={15} />
                    <span>Connection lost. Trying to reconnect...</span>
                </div>
            )}

            {!location.pathname.startsWith("/chats") && (
                <header className="sync-global-topbar" aria-label="Quick actions">
                    <div className="sync-global-topbar-spacer" />
                    <div className="sync-global-topbar-actions">
                        <button
                            type="button"
                            className="sync-global-topbar-action"
                            onClick={() => navigate("/contact")}
                            title="Contact Sync"
                            aria-label="Contact Sync"
                        >
                            <Mail size={17} />
                        </button>
                        <button
                            type="button"
                            className="sync-global-topbar-action"
                            onClick={() => setConfirmLogout(true)}
                            title="Sign out"
                            aria-label="Sign out"
                        >
                            <LogOut size={17} />
                        </button>
                    </div>
             
            )}   </header>

            <div className="sync-main-frame">
                <aside className="sync-nav-rail">
                    <div className="sync-nav-brand">
                        <SyncLogo size="nav" glow />
                    </div>

                    <nav className="sync-nav-links" aria-label="Main">
                        {isAdmin && (
                            <NavLink
                                to="/admin"
                                className={navClass}
                                title={
                                    isSuperAdmin
                                        ? "Super Admin Dashboard"
                                        : "Admin Dashboard"
                                }
                            >
                                <div className="sync-nav-icon-wrap">
                                    {isSuperAdmin ? (
                                        <Crown size={23} />
                                    ) : (
                                        <ShieldCheck size={23} />
                                    )}
                                    <span className="sync-nav-dot admin-dot" />
                                </div>
                                <span className="sync-nav-label">
                                    {isSuperAdmin ? "Super" : "Admin"}
                                </span>
                            </NavLink>
                        )}

                        <NavLink to="/chats" className={navClass} title="Chats">
                            <div className="sync-nav-icon-wrap">
                                <MessageCircle size={23} />
                                {totalUnread > 0 && (
                                    <span className="sync-nav-badge">
                                        {totalUnread > 99 ? "99+" : totalUnread}
                                    </span>
                                )}
                            </div>
                            <span className="sync-nav-label">Chats</span>
                        </NavLink>

                        <NavLink
                            to="/stories"
                            className={navClass}
                            title="Stories"
                        >
                            <div className="sync-nav-icon-wrap">
                                <Aperture size={23} />
                                {hasUnseenStories && (
                                    <span className="sync-nav-dot" />
                                )}
                            </div>
                            <span className="sync-nav-label">Stories</span>
                        </NavLink>

                        <NavLink
                            to="/profile"
                            className={navClass}
                            title="Profile"
                        >
                            <div className="sync-nav-icon-wrap">
                                <UserRound size={23} />
                            </div>
                            <span className="sync-nav-label">Profile</span>
                        </NavLink>


                    </nav>

                    <div className="sync-nav-footer">
                        <EnableNotifications />
                        <button
                            type="button"
                            className="sync-nav-logout"
                            onClick={() => setConfirmLogout(true)}
                            title="Sign out"
                            aria-label="Sign out"
                        >
                            <Power size={19} />
                        </button>
                        <button
                            type="button"
                            className="sync-nav-user-btn"
                            onClick={() => navigate("/profile")}
                            title={user?.fullName || "My profile"}
                            aria-label="My profile"
                        >
                            <Avatar
                                src={user?.avatar}
                                name={user?.fullName || user?.username}
                                size={38}
                                showOnline
                                online={socketConnected}
                            />
                        </button>
                    </div>
                </aside>

                <main className="sync-workspace">
                    <Outlet />
                </main>
            </div>

            {/* ৫ সেকেন্ড কাউন্টডাউন সহ গ্লোবাল Notice Popup */}
            <NoticePopup />

            {confirmLogout && (
                <ConfirmDialog
                    icon={Power}
                    title="Sign out of Sync?"
                    message="You will need to sign in again to read your chats and stories."
                    confirmLabel="Sign out"
                    busy={loggingOut}
                    onConfirm={handleConfirmLogout}
                    onCancel={() => setConfirmLogout(false)}
                />
            )}
        </div>
    );
}
