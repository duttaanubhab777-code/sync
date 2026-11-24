import React, { useState } from "react";
import { isAndroidApp } from "../services/appUpdate.js";
import {
    clearNativeMedia,
    getMediaDiagnostics,
    testNativeSave
} from "../services/nativeMedia.js";

// Profile-এ "Saved media" কার্ড (শুধু Android অ্যাপে): ফোনে কত ছবি/ভিডিও সেভ আছে, সেভ কাজ করছে কিনা,
// আর সাম্প্রতিক লগ। কোনো সমস্যা হলে এই কার্ডের screenshot পাঠালেই কারণ বোঝা যায়।
export default function SavedMediaCard() {
    const [diag, setDiag] = useState(() => getMediaDiagnostics());
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
        setBusy(true);
        await clearNativeMedia();
        setResult("Cleared");
        setBusy(false);
        refresh();
    };

    return (
        <div className="sync-profile-card">
            <h3>Saved media (this phone)</h3>
            <p className="sync-muted">
                Plugin: {diag.plugin ? "active" : "NOT available (install the new APK)"} · mode:{" "}
                {diag.mode} · files: {diag.files} · {diag.mb} MB
                {Object.keys(diag.kinds).length > 0 &&
                    ` (${Object.entries(diag.kinds)
                        .map(([k, n]) => `${k}: ${n}`)
                        .join(", ")})`}
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 0" }}>
                <button type="button" className="sync-btn" disabled={busy} onClick={runTest}>
                    Test saving
                </button>
                <button type="button" className="sync-btn" disabled={busy} onClick={refresh}>
                    Refresh
                </button>
                <button type="button" className="sync-btn" disabled={busy} onClick={clearAll}>
                    Clear saved media
                </button>
            </div>
            {result && <p className="sync-muted">{result}</p>}
            {diag.log.length > 0 && (
                <pre
                    style={{
                        fontSize: 11,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        opacity: 0.8,
                        margin: 0
                    }}
                >
                    {diag.log.slice(-8).join("\n")}
                </pre>
            )}
        </div>
    );
}
