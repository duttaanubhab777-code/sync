import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { X, QrCode, ScanLine, Share2, Download, Link2, Check, Loader2 } from "lucide-react";
import QrScanner from "./QrScanner.jsx";
import { renderQrCard, canvasToBlob } from "../utils/qrStyle.js";
import { buildProfileLink } from "../utils/qrLink.js";
import { openChatByUsername } from "../services/qrChat.js";

// "My QR code" (শেয়ার করার জন্য) আর "Scan" (অন্যের QR স্ক্যান করে সরাসরি চ্যাটে যাওয়া), দুই ট্যাব
export default function QrCodeModal({ onClose, initialTab = "my" }) {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const user = useSelector(state => state.auth.user);
    const canvasRef = useRef(null);
    const [tab, setTab] = useState(initialTab);
    const [drawing, setDrawing] = useState(true);
    const [note, setNote] = useState("");
    const [opening, setOpening] = useState(false);
    const [scanError, setScanError] = useState("");

    const link = user?.username ? buildProfileLink(user.username) : "";

    useEffect(() => {
        if (tab !== "my" || !canvasRef.current || !user) return undefined;
        let cancelled = false;
        setDrawing(true);
        renderQrCard(canvasRef.current, {
            link,
            name: user.fullName,
            username: user.username,
            avatar: user.avatar
        })
            .catch(() => !cancelled && setNote("Could not draw the QR code"))
            .finally(() => !cancelled && setDrawing(false));
        return () => {
            cancelled = true;
        };
    }, [tab, link, user]);

    useEffect(() => {
        const onKey = e => e.key === "Escape" && onClose();
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [onClose]);

    const flash = msg => {
        setNote(msg);
        setTimeout(() => setNote(""), 2200);
    };

    const copyLink = async () => {
        try {
            await navigator.clipboard.writeText(link);
            flash("Link copied");
        } catch {
            flash(link);
        }
    };

    const share = async () => {
        try {
            const blob = await canvasToBlob(canvasRef.current);
            const file = blob && new File([blob], `sync-${user.username}.png`, { type: "image/png" });
            if (file && navigator.canShare?.({ files: [file] })) {
                await navigator.share({
                    files: [file],
                    title: "Chat with me on Sync",
                    text: `Chat with me on Sync: ${link}`
                });
                return;
            }
            if (navigator.share) {
                await navigator.share({ title: "Chat with me on Sync", text: "Chat with me on Sync", url: link });
                return;
            }
            await copyLink();
        } catch (err) {
            if (err?.name !== "AbortError") await copyLink();
        }
    };

    const download = async () => {
        const blob = await canvasToBlob(canvasRef.current);
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `sync-qr-${user.username}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        flash("Saved to downloads");
    };

    const onUsername = useCallback(
        async username => {
            if (opening) return;
            setOpening(true);
            setScanError("");
            try {
                const out = await openChatByUsername(dispatch, username);
                if (out.self) {
                    setScanError("This is your own QR code");
                    return;
                }
                onClose();
                navigate(`/chats/${out.conversation._id}`);
            } catch (err) {
                setScanError(err.message);
            } finally {
                setOpening(false);
            }
        },
        [dispatch, navigate, onClose, opening]
    );

    if (!user) return null;

    return (
        <div className="sync-modal-backdrop" onClick={onClose}>
            <div className="sync-modal-card sync-qr-modal" onClick={e => e.stopPropagation()}>
                <div className="sync-modal-header">
                    <h3>QR code</h3>
                    <button type="button" className="sync-icon-btn" onClick={onClose} aria-label="Close">
                        <X size={19} />
                    </button>
                </div>

                <div className="sync-qr-tabs" role="tablist">
                    <button
                        type="button"
                        role="tab"
                        aria-selected={tab === "my"}
                        className={tab === "my" ? "is-active" : ""}
                        onClick={() => setTab("my")}
                    >
                        <QrCode size={16} /> My code
                    </button>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={tab === "scan"}
                        className={tab === "scan" ? "is-active" : ""}
                        onClick={() => {
                            setScanError("");
                            setTab("scan");
                        }}
                    >
                        <ScanLine size={16} /> Scan
                    </button>
                </div>

                <div className="sync-modal-body sync-qr-body">
                    {tab === "my" ? (
                        <>
                            <div className="sync-qr-canvas-wrap">
                                <canvas ref={canvasRef} className={drawing ? "is-drawing" : ""} />
                                {drawing && <Loader2 size={26} className="spin sync-qr-spin" />}
                            </div>
                            <p className="sync-qr-note" role="status">
                                {note || "Anyone who scans this opens a chat with you. Works with any QR scanner."}
                            </p>
                            <div className="sync-qr-actions">
                                <button type="button" className="sync-btn primary" onClick={share} disabled={drawing}>
                                    <Share2 size={17} /> Share
                                </button>
                                <button type="button" className="sync-btn secondary" onClick={download} disabled={drawing}>
                                    <Download size={17} /> Save
                                </button>
                                <button type="button" className="sync-btn secondary" onClick={copyLink}>
                                    {note === "Link copied" ? <Check size={17} /> : <Link2 size={17} />} Link
                                </button>
                            </div>
                        </>
                    ) : (
                        <>
                            <QrScanner onUsername={onUsername} busy={opening} />
                            {scanError && <p className="sync-qr-error" role="alert">{scanError}</p>}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
