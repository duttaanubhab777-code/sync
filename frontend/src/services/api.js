import axios from "axios";

const BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");

export const TOKEN_KEY = "sync_access_token";
export const REFRESH_KEY = "sync_refresh_token";
export const USER_KEY = "sync_user";
export const LAST_MSG_ID_KEY = "sync_last_msg_id";
export const LAST_SERVER_TIME_KEY = "sync_last_server_time";
export const PY_URL_KEY = "sync_python_service_url";

export const getStoredToken = () => localStorage.getItem(TOKEN_KEY) || "";
export const getStoredRefreshToken = () => localStorage.getItem(REFRESH_KEY) || "";

export const setStoredTokens = ({ accessToken, refreshToken }) => {
    if (accessToken) localStorage.setItem(TOKEN_KEY, accessToken);
    if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
};

export const clearStoredAuth = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
};

export const api = axios.create({
    baseURL: BASE_URL,
    withCredentials: true,
    headers: {
        "Content-Type": "application/json"
    }
});

api.interceptors.request.use(config => {
    const token = getStoredToken();
    if (token && !config.headers.Authorization) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

let refreshPromise = null;

export const refreshAccessToken = async () => {
    if (refreshPromise) return refreshPromise;

    refreshPromise = (async () => {
        try {
            const refreshToken = getStoredRefreshToken();
            const res = await axios.post(
                `${BASE_URL}/api/auth/refresh`,
                refreshToken ? { refreshToken } : {},
                { withCredentials: true }
            );
            const newAccessToken = res.data?.data?.accessToken;
            if (newAccessToken) {
                setStoredTokens({ accessToken: newAccessToken });
                return newAccessToken;
            }
            throw new Error("No access token returned");
        } catch (err) {
            clearStoredAuth();
            throw err;
        } finally {
            refreshPromise = null;
        }
    })();

    return refreshPromise;
};

api.interceptors.response.use(
    response => response,
    async error => {
        const originalRequest = error.config;
        const status = error.response?.status;
        const url = originalRequest?.url || "";

        const isAuthEndpoint =
            url.includes("/api/auth/login") ||
            url.includes("/api/auth/register") ||
            url.includes("/api/auth/refresh") ||
            url.includes("/api/auth/logout");

        if (status === 401 && !originalRequest?._retry && !isAuthEndpoint) {
            originalRequest._retry = true;
            try {
                const newToken = await refreshAccessToken();
                originalRequest.headers.Authorization = `Bearer ${newToken}`;
                return api(originalRequest);
            } catch (refreshErr) {
                window.dispatchEvent(new CustomEvent("sync:unauthorized"));
                return Promise.reject(refreshErr);
            }
        }

        return Promise.reject(error);
    }
);

export const extractErrorMessage = (error, fallback = "Something went wrong") => {
    return (
        error?.response?.data?.message ||
        error?.message ||
        fallback
    );
};
