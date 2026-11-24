import React, { useState } from "react";
import { HardDrive, ChevronDown } from "lucide-react";
import { isAndroidApp } from "../services/appUpdate.js";
import {
    clearNativeMedia,
    getMediaDiagnostics,
    testNativeSave
} from "../services/nativeMedia.js";

const LABELS = [
    ["image", "Photos"],
    ["video", "Videos"],
    ["audio", "Voice"],
    ["story", "Stories"],
    ["wallpaper", "Wallpapers"]
];

// Profile-এ "Storage" কার্ড (শুধু Android অ্যাপে): ফোনে কত মিডিয়া সেভ আছে আর এক চাপে মুছে ফেলা।
// "Details" খুললে টেকনিক্যাল তথ্য ও লগ দেখা যায় (সমস্যা হলে screenshot পাঠানোর জন্য)।
export default function SavedMediaCard() {
    const [diag, setDiag] = useState(() => getMediaDiagnostics());
    const [open, setOpen] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const [result, setResult] = useState("");
    const [busy, setBusy] = useState(false);

    if (!isAndroidApp) return null;

    const refresh = () => setDiag(getMediaDiagnostics());

    const runTest = async () => {
        setBusy(true);
        setResult("Testing...");
        setResult(await testNativeSave());
        setBusy(false);
        refresh();
    };

    const clearAll = async () => {
        if (!confirming) {
            setConfirming(true);
            setTimeout(() => setConfirming(false), 4000);
            return;
        }
        setConfirming(false);
        setBusy(true);
        await clearNativeMedia();
        setResult("Saved media cleared");
        setBusy(false);
        refresh();
    };

    const chips = LABELS.filter(([k]) => diag.kinds[k]).map(
        ([k, label]) => `${label} ${diag.kinds[k]}`
    );

    return (
        <div className="sync-profile-card">
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span
                    aria-hidden="true"
                    style={{
                        display: "grid",
                        placeItems: "center",
                        width: 42,
                        height: 42,
                        borderRadius: 14,
                        background: "rgba(37, 211, 102, 0.14)",
                        color: "#25d366",
                        flex: "none"
                    }}
                >
                    <HardDrive size={20} />
                </span>
                <div style={{ minWidth: 0 }}>
                    <h3 style={{ margin: 0 }}>Storage</h3>
                    <p className="sync-muted" style={{ margin: "2px 0 0" }}>
                        Chat media saved on this phone, so it opens without internet.
                    </p>
                </div>
            </div>

            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 12 }}>
                <strong style={{ fontSize: 26 }}>{diag.mb} MB</strong>
                <span className="sync-muted">
                    {diag.files} {diag.files === 1 ? "file" : "files"}
                </span>
            </div>
            {chips.length > 0 && (
                <p className="sync-muted" style={{ margin: "4px 0 0" }}>
                    {chips.join(" · ")}
                </p>
            )}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                <button
                    type="button"
                    className={`sync-btn sm ${confirming ? "danger" : "secondary"}`}
                    disabled={busy || diag.files === 0}
                    onClick={clearAll}
                >
                    {confirming ? "Tap again to confirm" : "Clear saved media"}
                </button>
                <button
                    type="button"
                    className="sync-btn ghost sm"
                    onClick={() => {
                        refresh();
                        setOpen(o => !o);
                    }}
                >
                    Details
                    <ChevronDown
                        size={14}
                        style={{
                            marginLeft: 4,
                            transform: open ? "rotate(180deg)" : "none",
                            transition: "transform 0.2s"
                        }}
                    />
                </button>
            </div>

            {result && !open && <p className="sync-muted">{result}</p>}

            {open && (
                <div style={{ marginTop: 10 }}>
                    <p className="sync-muted" style={{ margin: 0 }}>
                        Plugin: {diag.plugin ? "active" : "not available (install the latest APK)"} ·
                        mode: {diag.mode}
                    </p>
                    <div style={{ display: "flex", gap: 8, margin: "8px 0" }}>
                        <button
                            type="button"
                            className="sync-btn secondary sm"
                            disabled={busy}
                            onClick={runTest}
                        >
                            Test saving
                        </button>
                        <button
                            type="button"
                            className="sync-btn secondary sm"
                            disabled={busy}
                            onClick={refresh}
                        >
                            Refresh
                        </button>
                    </div>
                    {result && <p className="sync-muted">{result}</p>}
                    {diag.log.length > 0 && (
                        <pre
                            style={{
                                fontSize: 11,
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-word",
                                opacity: 0.75,
                                margin: 0
                            }}
                        >
                            {diag.log.slice(-8).join("\n")}
                        </pre>
                    )}
                </div>
            )}
        </div>
    );
}
