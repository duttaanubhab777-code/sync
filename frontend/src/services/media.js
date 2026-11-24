import axios from "axios";
import { getStoredToken, PY_URL_KEY, refreshAccessToken } from "./api.js";
import { compressMediaFile } from "../utils/compress.js";

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
                precise: Math.min(100, shown), // দশমিকসহ: বার/রিং মসৃণ চলার জন্য
                loaded: Math.min(loaded, total),
                total,
                speed,
                eta: speed > 1024 ? Math.ceil(remaining / speed) : null,
                phase
            });
            lastEmitted = shown;
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
            if (Math.abs(shown - lastEmitted) >= 0.25) {
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
                const finish = () => {
                    shown = 100;
                    loaded = total;
                    emit("done");
                    resolve(body);
                };
                // ছোট ফাইলে (ছবি) বার হঠাৎ ১০০%-এ লাফায়; তাই বাকি পথটুকু দ্রুত গড়িয়ে তারপর "done"
                if (shown >= 96) {
                    finish();
                } else {
                    const ramp = setInterval(() => {
                        shown = Math.min(100, shown + Math.max((100 - shown) * 0.45, 1.5));
                        if (shown >= 99.5) {
                            clearInterval(ramp);
                            finish();
                        } else {
                            emit("processing");
                        }
                    }, 40);
                }
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

// Python সার্ভিস থেকে আপলোডের signature আনা (401 হলে token refresh করে আবার চেষ্টা)
const fetchUploadSignature = async options => {
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
    const sign = token =>
        axios.post(`${pyBaseUrl}/api/v1/media/sign`, signBody, {
            headers: { Authorization: `Bearer ${token}` }
        });

    let signRes;
    try {
        signRes = await sign(getStoredToken());
    } catch (err) {
        if (err.response?.status === 401) {
            signRes = await sign(await refreshAccessToken());
        } else {
            throw new Error(
                err.response?.data?.message ||
                    "Unable to obtain an upload signature from the media service."
            );
        }
    }

    const signData = signRes.data?.data || signRes.data;
    const { cloudName, apiKey, signature } = signData || {};
    if (!cloudName || !apiKey || !signature) {
        throw new Error("Invalid upload signature from Python service");
    }
    return signData;
};

// options.purpose (ঐচ্ছিক): "chat" (ডিফল্ট) | "voice" | "avatar" | "story" | "group"
// Python সার্ভিস এটা দেখে Cloudinary folder ঠিক করে। না দিলে আগের মতোই sync/chat।
// options.compress === true হলে ছবি/ভিডিও আপলোডের আগে ফোনেই ছোট করা হয় (WhatsApp-এর মতো)।
// options.compressSignal (AbortSignal, ঐচ্ছিক): abort করলে ভিডিও compress থামে, আসল ফাইলই আপলোড হয়।
//
// onProgress(percent, info) এর info.phase এখন:
//   "compressing" -> ফোনে ছোট করা হচ্ছে (info.compressPct থাকলে ০–১০০, না থাকলে অনির্দিষ্ট)
//   "preparing"   -> signature আনা হচ্ছে (compress ছাড়া ফাইলে)
//   "uploading" / "processing" / "done" -> আগের মতো
// info.originalSize ও info.compressedSize (বাইট) compress-এর পর থেকে সব ইভেন্টে থাকে।
export const uploadMediaToCloudinary = async (file, onProgress, options = {}) => {
    if (!file) throw new Error("No file selected");

    const originalSize = file.size;
    let compressedSize = file.size;
    // ছবি/ভিডিও compress হবে কি না (UI-তে "Step 1 of 2" দেখানোর জন্য)
    const originalKind = detectMessageTypeFromFile(file);
    const willCompress =
        options?.compress === true && (originalKind === "image" || originalKind === "video");
    const report = (pct, info) => {
        if (typeof onProgress !== "function") return;
        onProgress(pct, { originalSize, compressedSize, willCompress, ...info });
    };

    // signature আনা আর compress একসাথে চলে, তাই compress-এর সময়টা আলাদা করে অপেক্ষা যোগ করে না
    const signaturePromise = fetchUploadSignature(options);
    signaturePromise.catch(() => {}); // compress চলাকালীন ব্যর্থ হলে unhandled rejection আটকানো

    if (options?.compress === true) {
        report(0, { phase: "compressing", total: originalSize });
        file = await compressMediaFile(file, {
            signal: options?.compressSignal,
            onProgress: (compressPct, detail) =>
                report(0, {
                    phase: "compressing",
                    total: originalSize,
                    compressPct,
                    compressCurrent: detail?.current,
                    compressDuration: detail?.duration,
                    compressRetry: detail?.retry || 0
                })
        });
        compressedSize = file.size;
    } else {
        report(0, { phase: "preparing", total: originalSize });
    }

    const MAX_BYTES = 25 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
        throw new Error("File is too large (max 25 MB)");
    }

    const signData = await signaturePromise;
    const { cloudName, apiKey, timestamp, folder, signature } = signData;

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

    // ডকুমেন্টের জন্য /raw/upload ব্যবহার করলে PDF/ZIP/DOCX আসল ফাইল হিসেবে নিরাপদে ডেলিভার হয়
    const detectedType = detectMessageTypeFromFile(file);
    const resourceEndpoint = detectedType === "file" ? "raw" : "auto";

    // আপলোড শুরুর মুহূর্তেই UI "Uploading"-এ চলে যায়, কোনো ফাঁকা সময় থাকে না
    report(0, { phase: "uploading", total: file.size });

    let data;
    try {
        data = await uploadWithProgress(
            `https://api.cloudinary.com/v1_1/${cloudName}/${resourceEndpoint}/upload`,
            formData,
            file.size,
            (pct, info) => report(pct, info)
        );
    } catch (err) {
        // Cloudinary আসল কারণ জানায় (যেমন "Invalid Signature", "File size too large"), সেটা দেখানো
        throw new Error(err.message || "Upload to Cloudinary failed");
    }

    return {
        url: data.secure_url,
        publicId: data.public_id,
        mime: file.type || `${data.resource_type}/${data.format || "bin"}`,
        fileName: file.name || "",
        bytes: data.bytes,
        width: data.width,
        height: data.height,
        duration: data.duration
    };
};

export const detectMessageTypeFromFile = file => {
    const mime = (file?.type || "").toLowerCase();
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("video/")) return "video";
    if (mime.startsWith("audio/")) return "audio";

    // কিছু Android WebView ফাইল পিকারে MIME খালি থাকে, তাই এক্সটেনশন fallback
    const name = (file?.name || "").toLowerCase();
    if (/\.(jpe?g|png|webp|gif|heic|heif|avif)$/.test(name)) return "image";
    if (/\.(mp4|mov|webm|m4v|3gp|ogv|mkv)$/.test(name)) return "video";
    if (/\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|weba)$/.test(name)) return "audio";
    return "file";
};
