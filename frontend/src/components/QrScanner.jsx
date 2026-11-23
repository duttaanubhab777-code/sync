import React, { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ImageUp, Loader2 } from "lucide-react";
import { parseProfileLink } from "../utils/qrLink.js";

// ক্যামেরা দিয়ে QR স্ক্যান। Chrome/Android-এ ব্রাউজারের নিজস্ব BarcodeDetector (দ্রুত),
// না থাকলে (iOS Safari, পুরনো WebView) jsQR দিয়ে। গ্যালারি থেকে ছবি বাছাইও আছে।
// শুধু Sync-এর QR (/u/<username>) গ্রহণ করে; অন্য QR হলে জানায়।

let detectorPromise = null;
const getNativeDetector = () => {
    if (detectorPromise) return detectorPromise;
    detectorPromise = (async () => {
        try {
            if (!("BarcodeDetector" in window)) return null;
            const formats = await window.BarcodeDetector.getSupportedFormats?.();
            if (formats && !formats.includes("qr_code")) return null;
            return new window.BarcodeDetector({ formats: ["qr_code"] });
        } catch {
            return null;
        }
    })();
    return detectorPromise;
};

let jsQrPromise = null;
const getJsQr = () => {
    if (!jsQrPromise) {
        jsQrPromise = import("jsqr").then(m => m.default || m);
    }
    return jsQrPromise;
};

async function decodeSource(source, width, height, scratch) {
    const native = await getNativeDetector();
    if (native) {
        try {
            const codes = await native.detect(source);
            if (codes?.[0]?.rawValue) return codes[0].rawValue;
        } catch {
            /* jsQR-এ চেষ্টা করা হবে */
        }
    }
    const scale = Math.min(1, 720 / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    scratch.width = w;
    scratch.height = h;
    const ctx = scratch.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, w, h);
    const jsQR = await getJsQr();
    const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, {
        inversionAttempts: "attemptBoth"
    });
    return code?.data || "";
}

export default function QrScanner({ onUsername, busy = false }) {
    const videoRef = useRef(null);
    const scratchRef = useRef(null);
    const fileRef = useRef(null);
    const busyRef = useRef(busy);
    const lastRef = useRef({ text: "", at: 0 });
    const [status, setStatus] = useState("starting"); // starting | live | denied | unsupported
    const [hint, setHint] = useState("");

    useEffect(() => {
        busyRef.current = busy;
    }, [busy]);

    const handleText = useCallback(
        text => {
            const now = Date.now();
            if (text === lastRef.current.text && now - lastRef.current.at < 2500) return false;
            lastRef.current = { text, at: now };
            const username = parseProfileLink(text);
            if (!username) {
                setHint("This is not a Sync QR code");
                return false;
            }
            setHint("");
            onUsername?.(username);
            return true;
        },
        [onUsername]
    );

    useEffect(() => {
        let stream = null;
        let raf = 0;
        let stopped = false;
        let lastTick = 0;
        let inFlight = false;

        const tick = async ts => {
            if (stopped) return;
            raf = requestAnimationFrame(tick);
            const v = videoRef.current;
            if (!v || v.readyState < 2 || inFlight || busyRef.current) return;
            if (ts - lastTick < 140) return;
            lastTick = ts;
            inFlight = true;
            try {
                const text = await decodeSource(
                    v,
                    v.videoWidth,
                    v.videoHeight,
                    scratchRef.current
                );
                if (text && !stopped) handleText(text);
            } catch {
                /* এই ফ্রেম বাদ */
            } finally {
                inFlight = false;
            }
        };

        (async () => {
            if (!navigator.mediaDevices?.getUserMedia) {
                setStatus("unsupported");
                return;
            }
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        facingMode: { ideal: "environment" },
                        width: { ideal: 1280 },
                        height: { ideal: 720 }
                    },
                    audio: false
                });
                if (stopped) {
                    stream.getTracks().forEach(t => t.stop());
                    return;
                }
                const v = videoRef.current;
                v.srcObject = stream;
                v.setAttribute("playsinline", "true");
                await v.play().catch(() => {});
                setStatus("live");
                raf = requestAnimationFrame(tick);
            } catch {
                setStatus("denied");
            }
        })();

        return () => {
            stopped = true;
            cancelAnimationFrame(raf);
            stream?.getTracks().forEach(t => t.stop());
        };
    }, [handleText]);

    const onPickFile = async e => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;
        setHint("Reading image...");
        try {
            const bmp = await createImageBitmap(file);
            const text = await decodeSource(bmp, bmp.width, bmp.height, scratchRef.current);
            bmp.close?.();
            if (!text) setHint("No QR code found in this image");
            else if (!handleText(text)) {
                /* hint আগেই বসেছে */
            }
        } catch {
            setHint("Could not read this image");
        }
    };

    return (
        <div className="sync-qrscan">
            <div className="sync-qrscan-view">
                <video ref={videoRef} muted playsInline className={status === "live" ? "is-live" : ""} />
                <canvas ref={scratchRef} hidden />
                {status === "live" && (
                    <div className="sync-qrscan-frame" aria-hidden="true">
                        <i /><i /><i /><i />
                        <span className="sync-qrscan-line" />
                    </div>
                )}
                {status === "starting" && (
                    <div className="sync-qrscan-msg">
                        <Loader2 size={26} className="spin" />
                        <span>Starting camera...</span>
                    </div>
                )}
                {status === "denied" && (
                    <div className="sync-qrscan-msg">
                        <Camera size={28} />
                        <strong>Camera is not available</strong>
                        <span>Allow camera access for Sync in your settings, or choose a QR image below.</span>
                    </div>
                )}
                {status === "unsupported" && (
                    <div className="sync-qrscan-msg">
                        <Camera size={28} />
                        <strong>Camera is not supported here</strong>
                        <span>Choose a QR image from your gallery instead.</span>
                    </div>
                )}
                {busy && (
                    <div className="sync-qrscan-msg is-busy">
                        <Loader2 size={26} className="spin" />
                        <span>Opening chat...</span>
                    </div>
                )}
            </div>

            <p className={`sync-qrscan-hint ${hint ? "is-warn" : ""}`} role="status">
                {hint || "Point your camera at a Sync QR code"}
            </p>

            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickFile} />
            <button type="button" className="sync-btn secondary" onClick={() => fileRef.current?.click()}>
                <ImageUp size={17} /> Scan from gallery
            </button>
        </div>
    );
}
