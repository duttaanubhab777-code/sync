import React, { useEffect } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import {
    MessageSquare,
    CircleDot,
    User,
    LogOut,
    WifiOff,
    Loader2
} from "lucide-react";
import Avatar from "./Avatar.jsx";
import SyncBrandBar from "./SyncBrandBar.jsx";
import { logoutUser, forceLogout } from "../store/authSlice.js";
import { fetchConversations, resetChatState } from "../store/chatSlice.js";
import { fetchStories } from "../store/storySlice.js";
import { connectSocket, disconnectSocket } from "../services/socket.js";

export default function AppLayout() {
    const dispatch = useDispatch();
    const navigate = useNavigate();

    const { user, isAuthenticated, serverWaking } = useSelector(
        state => state.auth
    );
    const { conversations, socketConnected, reconnecting } = useSelector(
        state => state.chat
    );
    const { storyGroups } = useSelector(state => state.story);

    const totalUnread = conversations.reduce(
        (acc, c) => acc + Number(c.unread || 0),
        0
    );

    const hasUnseenStories = storyGroups.some(
        g => !g.isMine && g.hasUnseen
    );

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

    const handleLogout = async () => {
        disconnectSocket();
        dispatch(resetChatState());
        await dispatch(logoutUser());
        navigate("/login", { replace: true });
    };

    return (
        <div className="sync-app-shell">
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

            <SyncBrandBar />
            <div className="sync-main-frame">
                <aside className="sync-nav-rail">

                    <nav className="sync-nav-links">
                        <NavLink
                            to="/chats"
                            className={({ isActive }) =>
                                `sync-nav-item ${isActive ? "active" : ""}`
                            }
                            title="Chats"
                        >
                            <div className="sync-nav-icon-wrap">
                                <MessageSquare size={22} />
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
                            className={({ isActive }) =>
                                `sync-nav-item ${isActive ? "active" : ""}`
                            }
                            title="Stories (24h Status)"
                        >
                            <div className="sync-nav-icon-wrap">
                                <CircleDot size={22} />
                                {hasUnseenStories && (
                                    <span className="sync-nav-dot" />
                                )}
                            </div>
                            <span className="sync-nav-label">Stories</span>
                        </NavLink>

                        <NavLink
                            to="/profile"
                            className={({ isActive }) =>
                                `sync-nav-item ${isActive ? "active" : ""}`
                            }
                            title="Profile & Settings"
                        >
                            <div className="sync-nav-icon-wrap">
                                <User size={22} />
                            </div>
                            <span className="sync-nav-label">Profile</span>
                        </NavLink>
                    </nav>

                    <div className="sync-nav-footer">
                        <button
                            type="button"
                            className="sync-nav-user-btn"
                            onClick={() => navigate("/profile")}
                            title={user?.fullName || "My Profile"}
                        >
                            <Avatar
                                src={user?.avatar}
                                name={user?.fullName || user?.username}
                                size={36}
                                showOnline
                                online={socketConnected}
                            />
                        </button>
                        <button
                            type="button"
                            className="sync-nav-logout"
                            onClick={handleLogout}
                            title="Logout"
                        >
                            <LogOut size={19} />
                        </button>
                    </div>
                </aside>

                <main className="sync-workspace">
                    <Outlet />
                </main>
            </div>
        </div>
    );
}
