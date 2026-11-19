import React, { useEffect, useRef, useState } from "react";
import { Camera, Loader2, X, UserRound } from "lucide-react";
import { makeAvatarFile } from "../utils/image.js";

// Register পেজের গোল প্রোফাইল-ছবি বাছাই। ছবি এখানেই বর্গাকার করে ছোট করা হয়;
// আসল আপলোড হয় অ্যাকাউন্ট তৈরি হওয়ার পরপরই (তখনই লগইন token পাওয়া যায়)।
export default function AvatarPicker({
    file = null,
    onChange,
    onError,
    disabled = false,
    size = 112
}) {
    const inputRef = useRef(null);
    const [preview, setPreview] = useState("");
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!file) {
            setPreview("");
            return undefined;
        }
        const url = URL.createObjectURL(file);
        setPreview(url);
        return () => URL.revokeObjectURL(url);
    }, [file]);

    const handlePick = async e => {
        const picked = e.target.files?.[0];
        e.target.value = ""; // একই ছবি আবার বাছাই করা যাবে
        if (!picked) return;
        setBusy(true);
        onError?.("");
        try {
            onChange?.(await makeAvatarFile(picked));
        } catch (err) {
            onError?.(err.message || "Could not use this image");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="sync-avatar-picker">
            <div
                className={`sync-avatar-picker-ring${file ? " has-file" : ""}`}
                style={{ width: size, height: size }}
            >
                <button
                    type="button"
                    className="sync-avatar-picker-btn"
                    onClick={() => inputRef.current?.click()}
                    disabled={disabled || busy}
                    aria-label={file ? "Change profile photo" : "Add profile photo"}
                >
                    {preview ? (
                        <img src={preview} alt="Your profile photo preview" />
                    ) : (
                        <UserRound size={Math.round(size * 0.42)} />
                    )}
                    {busy && (
                        <span className="sync-avatar-picker-busy">
                            <Loader2 size={22} className="spin" />
                        </span>
                    )}
                </button>

                <span className="sync-avatar-picker-badge" aria-hidden="true">
                    <Camera size={15} />
                </span>

                {file && !busy && (
                    <button
                        type="button"
                        className="sync-avatar-picker-remove"
                        onClick={() => onChange?.(null)}
                        disabled={disabled}
                        aria-label="Remove profile photo"
                    >
                        <X size={13} />
                    </button>
                )}
            </div>

            <p className="sync-avatar-picker-hint">
                {file ? "Looks great! Tap to change" : "Add a profile photo (optional)"}
            </p>

            <input
                ref={inputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={handlePick}
            />
        </div>
    );
}
