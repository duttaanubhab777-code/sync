import axios from "axios";
import { getStoredToken, PY_URL_KEY, refreshAccessToken } from "./api.js";

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

    let uploadRes;
    try {
        uploadRes = await axios.post(
            `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`,
            formData,
            {
                onUploadProgress: evt => {
                    if (evt.total && typeof onProgress === "function") {
                        onProgress(Math.round((evt.loaded * 100) / evt.total));
                    }
                }
            }
        );
    } catch (err) {
        // Cloudinary আসল কারণ জানায় (যেমন "Invalid Signature", "File size too large"), সেটা দেখানো
        throw new Error(
            err.response?.data?.error?.message ||
                err.message ||
                "Upload to Cloudinary failed"
        );
    }

    const data = uploadRes.data;
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
