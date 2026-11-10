import axios from "axios";
import { getStoredToken, PY_URL_KEY, refreshAccessToken } from "./api.js";

// XMLHttpRequest দিয়ে আপলোড, কারণ এতে প্রতিটা পাঠানো বাইটের খবর পাওয়া যায়।
// ব্রাউজার অনেক সময় কয়েকটা বড় লাফে (0% -> 100%) প্রগ্রেস জানায়, তাই এখানে
// আসল গতি (bytes/sec) মেপে বারটাকে মসৃণভাবে 0 থেকে 100 পর্যন্ত বাড়ানো হয়।
// onProgress(percent, { loaded, total, speed, eta, phase }) ডাকা হয়:
//   speed = বাইট/সেকেন্ড, eta = বাকি সেকেন্ড, phase = "uploading" | "processing" | "done"
const uploadWithProgress = (url, formData, fileSize, onProgress) =>
    new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", url);

        let total = fileSize || 0;
        let loaded = 0;
        let realPct = 0; // ব্রাউজার যা জানিয়েছে
        let shown = 0; // ইউজারকে যা দেখানো হচ্ছে
        let speed = 0; // বাইট/সেকেন্ড (মসৃণ করা)
        let lastT = performance.now();
        let lastLoaded = 0;
        let sendDone = false;
        let finished = false;
        let lastEmitted = -1;

        const emit = phase => {
            if (typeof onProgress !== "function") return;
            const pct = Math.min(100, Math.floor(shown));
            const remaining = Math.max(0, total - loaded);
            onProgress(pct, {
                loaded: Math.min(loaded, total),
                total,
                speed,
                eta: speed > 1024 ? Math.ceil(remaining / speed) : null,
                phase
            });
            lastEmitted = pct;
        };

        const timer = setInterval(() => {
            if (finished) return;
            if (shown < realPct) {
                shown = Math.min(realPct, shown + Math.max((realPct - shown) * 0.3, 0.6));
            } else if (!sendDone && speed > 0 && total > 0) {
                // নতুন খবর আসেনি, কিন্তু নেট চলছে: গতি অনুযায়ী একটু এগিয়ে দেখানো (আসলের ৬% এর বেশি নয়)
                const lead = Math.min(realPct + 6, 98);
                shown = Math.min(lead, shown + ((speed * 0.1) / total) * 100 * 0.6);
            } else if (sendDone && shown < 99) {
                shown = Math.min(99, shown + 0.4); // Cloudinary প্রসেস করছে
            }
            if (Math.floor(shown) !== lastEmitted) {
                emit(sendDone ? "processing" : "uploading");
            }
        }, 100);

        const stop = () => {
            finished = true;
            clearInterval(timer);
        };

        xhr.upload.onprogress = evt => {
            const now = performance.now();
            if (evt.lengthComputable && evt.total) total = evt.total;
            loaded = evt.loaded;
            const dt = (now - lastT) / 1000;
            if (dt >= 0.15) {
                const instant = (loaded - lastLoaded) / dt;
                speed = speed ? speed * 0.65 + instant * 0.35 : instant;
                lastT = now;
                lastLoaded = loaded;
            }
            if (total > 0) realPct = Math.min(99, (loaded / total) * 100);
        };

        xhr.upload.onload = () => {
            sendDone = true;
            loaded = total;
            realPct = 99;
        };

        xhr.onload = () => {
            stop();
            let body = null;
            try {
                body = JSON.parse(xhr.responseText);
            } catch {
                body = null;
            }
            if (xhr.status >= 200 && xhr.status < 300 && body) {
                shown = 100;
                loaded = total;
                emit("done");
                resolve(body);
            } else {
                reject(
                    new Error(
                        body?.error?.message ||
                            `Upload failed (HTTP ${xhr.status})`
                    )
                );
            }
        };

        xhr.onerror = () => {
            stop();
            reject(new Error("Network error while uploading. Check your connection and try again."));
        };
        xhr.ontimeout = () => {
            stop();
            reject(new Error("Upload timed out. Please try again."));
        };
        xhr.onabort = () => {
            stop();
            reject(new Error("Upload cancelled"));
        };

        emit("uploading");
        xhr.send(formData);
    });

// options.purpose (ঐচ্ছিক): "chat" (ডিফল্ট) | "voice" | "avatar" | "story" | "group"
// Python সার্ভিস এটা দেখে Cloudinary folder ঠিক করে। না দিলে আগের মতোই sync/chat।
export const uploadMediaToCloudinary = async (file, onProgress, options = {}) => {
    if (!file) throw new Error("No file selected");

    const MAX_BYTES = 25 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
        throw new Error("File is too large (max 25 MB)");
    }

    const pyBaseUrl = (
        import.meta.env.VITE_PYTHON_SERVICE_URL ||
        localStorage.getItem(PY_URL_KEY) ||
        ""
    ).replace(/\/+$/, "");

    if (!pyBaseUrl) {
        throw new Error(
            "The Python media service URL is not configured. Set PYTHON_SERVICE_URL in your deployment environment."
        );
    }

    const signBody = options?.purpose ? { purpose: options.purpose } : {};

    let token = getStoredToken();

    let signRes;
    try {
        signRes = await axios.post(
            `${pyBaseUrl}/media/sign`,
            signBody,
            {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            }
        );
    } catch (err) {
        if (err.response?.status === 401) {
            token = await refreshAccessToken();
            signRes = await axios.post(
                `${pyBaseUrl}/media/sign`,
                signBody,
                {
                    headers: {
                        Authorization: `Bearer ${token}`
                    }
                }
            );
        } else {
            throw new Error(
                err.response?.data?.message ||
                    "Unable to obtain an upload signature from the media service."
            );
        }
    }

    const signData = signRes.data?.data || signRes.data;
    const { cloudName, apiKey, timestamp, folder, signature } = signData || {};

    if (!cloudName || !apiKey || !signature) {
        throw new Error("Invalid upload signature from Python service");
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("api_key", apiKey);
    formData.append("timestamp", String(timestamp));
    if (folder) formData.append("folder", folder);
    // সার্ভার যদি allowed_formats সই করে থাকে (ENFORCE_ALLOWED_FORMATS চালু), ঠিক সেটাই পাঠাতে হবে
    if (signData.allowedFormats) {
        formData.append("allowed_formats", signData.allowedFormats);
    }
    formData.append("signature", signature);

    let data;
    try {
        data = await uploadWithProgress(
            `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`,
            formData,
            file.size,
            onProgress
        );
    } catch (err) {
        // Cloudinary আসল কারণ জানায় (যেমন "Invalid Signature", "File size too large"), সেটা দেখানো
        throw new Error(err.message || "Upload to Cloudinary failed");
    }

    return {
        url: data.secure_url,
        publicId: data.public_id,
        mime: file.type || `${data.resource_type}/${data.format || "bin"}`,
        bytes: data.bytes,
        width: data.width,
        height: data.height,
        duration: data.duration
    };
};

export const detectMessageTypeFromFile = file => {
    const mime = file?.type || "";
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("video/")) return "video";
    if (mime.startsWith("audio/")) return "audio";
    return "file";
};
