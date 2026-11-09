import React, { useState, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
    Camera,
    Trash2,
    Save,
    Ban,
    CheckCircle2,
    Loader2,
    Mail,
    Phone,
    AtSign,
    ShieldCheck
} from "lucide-react";
import Avatar from "../components/Avatar.jsx";
import SyncLogo from "../components/SyncLogo.jsx";
import {
    fetchBlockedUsers,
    unblockUserById,
    updateMyProfile
} from "../store/authSlice.js";
import { uploadMediaToCloudinary } from "../services/media.js";

export default function ProfilePage() {
    const dispatch = useDispatch();
    const { user, blockedUsers } = useSelector(state => state.auth);

    const [fullName, setFullName] = useState(user?.fullName || "");
    const [about, setAbout] = useState(
        user?.about || "Hello ! I am using Sync 😃"
    );
    const [saving, setSaving] = useState(false);
    const [uploadingAvatar, setUploadingAvatar] = useState(false);
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");

    useEffect(() => {
        if (user) {
            setFullName(user.fullName || "");
            setAbout(user.about || "");
        }
    }, [user]);

    useEffect(() => {
        dispatch(fetchBlockedUsers());
    }, [dispatch]);

    const handleSaveProfile = async e => {
        e.preventDefault();
        setSaving(true);
        setMessage("");
        setError("");
        try {
            await dispatch(
                updateMyProfile({
                    fullName: fullName.trim(),
                    about: about.trim()
                })
            ).unwrap();
            setMessage("Profile updated successfully");
        } catch (err) {
            setError(typeof err === "string" ? err : "Failed to update profile");
        } finally {
            setSaving(false);
        }
    };

    const handleAvatarUpload = async e => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploadingAvatar(true);
        setMessage("");
        setError("");
        try {
            const media = await uploadMediaToCloudinary(file, undefined, {
                purpose: "avatar"
            });
            await dispatch(updateMyProfile({ avatar: media.url })).unwrap();
            setMessage("Profile photo updated");
        } catch (err) {
            setError(err.message || "Avatar upload failed");
        } finally {
            setUploadingAvatar(false);
        }
    };

    const handleRemoveAvatar = async () => {
        setUploadingAvatar(true);
        setMessage("");
        setError("");
        try {
            await dispatch(updateMyProfile({ avatar: "" })).unwrap();
            setMessage("Profile photo removed");
        } catch (err) {
            setError(typeof err === "string" ? err : "Could not remove photo");
        } finally {
            setUploadingAvatar(false);
        }
    };

    const handleUnblock = async userId => {
        try {
            await dispatch(unblockUserById(userId)).unwrap();
        } catch (err) {
            setError(typeof err === "string" ? err : "Could not unblock user");
        }
    };

    return (
        <div className="sync-profile-page">
            <div className="sync-profile-container">
                <div className="sync-profile-card sync-profile-main">
                    <div className="sync-profile-cover">
                        <SyncLogo size="cover" />
                    </div>
                    <div className="sync-profile-body">
                    <div className="sync-profile-avatar-row">
                        <Avatar
                            src={user?.avatar}
                            name={user?.fullName || user?.username}
                            size={88}
                        />
                        <div className="sync-profile-avatar-actions">
                            <label className="sync-btn primary sm">
                                {uploadingAvatar ? (
                                    <Loader2 size={15} className="spin" />
                                ) : (
                                    <Camera size={15} />
                                )}
                                <span>
                                    {uploadingAvatar
                                        ? "Uploading..."
                                        : "Upload Photo"}
                                </span>
                                <input
                                    type="file"
                                    accept="image/*"
                                    hidden
                                    onChange={handleAvatarUpload}
                                    disabled={uploadingAvatar}
                                />
                            </label>
                            {user?.avatar && (
                                <button
                                    type="button"
                                    className="sync-btn ghost sm"
                                    onClick={handleRemoveAvatar}
                                    disabled={uploadingAvatar}
                                >
                                    <Trash2 size={15} />
                                    <span>Remove</span>
                                </button>
                            )}
                        </div>
                    </div>

                    {message && (
                        <div className="sync-alert success">
                            <CheckCircle2 size={16} /> {message}
                        </div>
                    )}
                    {error && <div className="sync-alert error">{error}</div>}

                    <div className="sync-profile-identity">
                        <h2>My Profile</h2>
                        <p className="sync-muted">
                            Manage your Sync profile information, avatar, and
                            blocked contacts
                        </p>
                    </div>

                    <form
                        className="sync-profile-form"
                        onSubmit={handleSaveProfile}
                    >
                        <div className="sync-field">
                            <label>Full Name</label>
                            <input
                                type="text"
                                minLength={3}
                                maxLength={50}
                                value={fullName}
                                onChange={e => setFullName(e.target.value)}
                                required
                            />
                        </div>

                        <div className="sync-field">
                            <label>About (Bio)</label>
                            <textarea
                                rows={2}
                                maxLength={140}
                                value={about}
                                onChange={e => setAbout(e.target.value)}
                            />
                        </div>

                        <div className="sync-readonly-grid">
                            <div className="sync-readonly-item">
                                <AtSign size={15} />
                                <div>
                                    <span>Username</span>
                                    <strong>@{user?.username}</strong>
                                </div>
                            </div>
                            <div className="sync-readonly-item">
                                <Mail size={15} />
                                <div>
                                    <span>Email</span>
                                    <strong>{user?.email}</strong>
                                </div>
                            </div>
                            <div className="sync-readonly-item">
                                <Phone size={15} />
                                <div>
                                    <span>Phone</span>
                                    <strong>{user?.phoneNumber}</strong>
                                </div>
                            </div>
                            <div className="sync-readonly-item">
                                <ShieldCheck size={15} />
                                <div>
                                    <span>Role</span>
                                    <strong>{user?.role || "user"}</strong>
                                </div>
                            </div>
                        </div>

                        <button
                            type="submit"
                            className="sync-btn primary"
                            disabled={saving}
                        >
                            <Save size={16} />
                            <span>
                                {saving ? "Saving..." : "Save Profile Changes"}
                            </span>
                        </button>
                    </form>
                    </div>
                </div>

                <div className="sync-profile-card">
                    <h3>
                        <Ban size={18} /> Blocked Users ({blockedUsers.length})
                    </h3>
                    <p className="sync-muted">
                        Blocked users cannot start direct chats or send you
                        direct messages.
                    </p>

                    {blockedUsers.length === 0 ? (
                        <div className="sync-empty-hint">
                            You have not blocked any users.
                        </div>
                    ) : (
                        <div className="sync-blocked-list">
                            {blockedUsers.map(b => (
                                <div key={b._id} className="sync-user-row">
                                    <Avatar
                                        src={b.avatar}
                                        name={b.fullName || b.username}
                                        size={40}
                                    />
                                    <div className="sync-user-meta">
                                        <div className="sync-user-name">
                                            {b.fullName}
                                        </div>
                                        <div className="sync-user-sub">
                                            @{b.username}
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        className="sync-btn secondary sm"
                                        onClick={() => handleUnblock(b._id)}
                                    >
                                        Unblock
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
