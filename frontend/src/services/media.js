import axios from "axios";
import { getStoredToken, PY_URL_KEY, refreshAccessToken } from "./api.js";

export const uploadMediaToCloudinary = async (file, onProgress) => {
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
            "Python Media Service URL (PYTHON_SERVICE_URL) সেট করা নেই। Render বা .env-এ PYTHON_SERVICE_URL যোগ করুন।"
        );
    }

    let token = getStoredToken();

    let signRes;
    try {
        signRes = await axios.post(
            `${pyBaseUrl}/media/sign`,
            {},
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
                {},
                {
                    headers: {
                        Authorization: `Bearer ${token}`
                    }
                }
            );
        } else {
            throw new Error(
                err.response?.data?.message ||
                    "মিডিয়া সার্ভার থেকে আপলোড সিগনেচার পাওয়া যায়নি"
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
    formData.append("signature", signature);

    const uploadRes = await axios.post(
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
