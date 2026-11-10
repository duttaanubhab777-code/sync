import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import {
    api,
    clearStoredAuth,
    extractErrorMessage,
    getStoredRefreshToken,
    getStoredToken,
    PY_URL_KEY,
    setStoredTokens,
    USER_KEY
} from "../services/api.js";

const loadCachedUser = () => {
    try {
        const raw = localStorage.getItem(USER_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
};

const extractRetryAfter = err => {
    const fromErrors = err?.response?.data?.errors?.[0]?.retryAfterSeconds;
    if (Number.isFinite(Number(fromErrors)) && Number(fromErrors) > 0) {
        return Number(fromErrors);
    }
    const header = err?.response?.headers?.["retry-after"];
    if (Number.isFinite(Number(header)) && Number(header) > 0) {
        return Number(header);
    }
    return null;
};

export const initializeApp = createAsyncThunk(
    "auth/initializeApp",
    async (_, { dispatch, rejectWithValue }) => {
        const wakeTimer = setTimeout(() => {
            dispatch(setServerWaking(true));
        }, 1200);

        let healthData = null;
        try {
            // Render Cold Start-এর সময় সার্ভার ও ডেটাবেস জাগা পর্যন্ত রিট্রাই করা
            for (let attempt = 0; attempt < 8; attempt++) {
                try {
                    const res = await api.get("/health", { timeout: 12000 });
                    healthData = res.data;
                    if (healthData?.pythonServiceUrl) {
                        localStorage.setItem(
                            PY_URL_KEY,
                            healthData.pythonServiceUrl
                        );
                    }
                    if (healthData?.dbConnected !== false) {
                        break;
                    }
                } catch {
                    // সার্ভার এখনো জাগছে, ৩ সেকেন্ড অপেক্ষা করে আবার চেষ্টা
                }
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        } finally {
            clearTimeout(wakeTimer);
            dispatch(setServerWaking(false));
        }

        const token = getStoredToken();
        const refreshToken = getStoredRefreshToken();
        if (!token && !refreshToken) {
            return { user: null, healthData };
        }

        try {
            const meRes = await api.get("/api/auth/me");
            const user = meRes.data?.data;
            if (user) {
                localStorage.setItem(USER_KEY, JSON.stringify(user));
            }
            return { user, healthData };
        } catch (err) {
            clearStoredAuth();
            return rejectWithValue(extractErrorMessage(err, "Session expired"));
        }
    }
);

// ধাপ ১: সাইনআপ তথ্য যাচাই করে ইমেইলে ৬-সংখ্যার OTP পাঠানো
export const sendSignupOtp = createAsyncThunk(
    "auth/sendSignupOtp",
    async (payload, { dispatch, rejectWithValue }) => {
        const wakeTimer = setTimeout(() => {
            dispatch(setServerWaking(true));
        }, 1500);
        try {
            const res = await api.post("/api/auth/register/send-otp", payload);
            const data = res.data?.data || {};
            return {
                email: data.email || payload.email,
                expiresInSeconds: data.expiresInSeconds || 600,
                resendAfterSeconds: data.resendAfterSeconds || 60,
                message:
                    res.data?.message || "Verification code sent to your email"
            };
        } catch (err) {
            return rejectWithValue({
                message: extractErrorMessage(
                    err,
                    "Could not send verification code"
                ),
                retryAfterSeconds: extractRetryAfter(err)
            });
        } finally {
            clearTimeout(wakeTimer);
            dispatch(setServerWaking(false));
        }
    }
);

// কোড না পৌঁছালে বা মেয়াদ শেষ হলে আবার OTP পাঠানো
export const resendSignupOtp = createAsyncThunk(
    "auth/resendSignupOtp",
    async ({ email }, { dispatch, rejectWithValue }) => {
        const wakeTimer = setTimeout(() => {
            dispatch(setServerWaking(true));
        }, 1500);
        try {
            const res = await api.post("/api/auth/register/resend-otp", {
                email
            });
            const data = res.data?.data || {};
            return {
                email: data.email || email,
                expiresInSeconds: data.expiresInSeconds || 600,
                resendAfterSeconds: data.resendAfterSeconds || 60,
                message:
                    res.data?.message ||
                    "A new verification code was sent to your email"
            };
        } catch (err) {
            return rejectWithValue({
                message: extractErrorMessage(
                    err,
                    "Could not resend verification code"
                ),
                retryAfterSeconds: extractRetryAfter(err)
            });
        } finally {
            clearTimeout(wakeTimer);
            dispatch(setServerWaking(false));
        }
    }
);

// ধাপ ২: ইমেইলে আসা ৬-সংখ্যার OTP মিলিয়ে আসল অ্যাকাউন্ট তৈরি ও লগইন
export const verifySignupOtp = createAsyncThunk(
    "auth/verifySignupOtp",
    async ({ email, otp }, { dispatch, rejectWithValue }) => {
        const wakeTimer = setTimeout(() => {
            dispatch(setServerWaking(true));
        }, 1500);
        try {
            const res = await api.post("/api/auth/register/verify-otp", {
                email,
                otp
            });
            const { user, accessToken, refreshToken } = res.data?.data || {};
            setStoredTokens({ accessToken, refreshToken });
            if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
            return { user, accessToken, refreshToken };
        } catch (err) {
            return rejectWithValue(
                extractErrorMessage(err, "OTP verification failed")
            );
        } finally {
            clearTimeout(wakeTimer);
            dispatch(setServerWaking(false));
        }
    }
);

// পুরনো নামের সাথে সামঞ্জস্য রাখার জন্য alias
export const registerUser = sendSignupOtp;

export const loginUser = createAsyncThunk(
    "auth/loginUser",
    async (payload, { dispatch, rejectWithValue }) => {
        const wakeTimer = setTimeout(() => {
            dispatch(setServerWaking(true));
        }, 1500);
        try {
            const res = await api.post("/api/auth/login", payload);
            const { user, accessToken, refreshToken } = res.data?.data || {};
            setStoredTokens({ accessToken, refreshToken });
            if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
            return { user, accessToken, refreshToken };
        } catch (err) {
            return rejectWithValue(extractErrorMessage(err, "Login failed"));
        } finally {
            clearTimeout(wakeTimer);
            dispatch(setServerWaking(false));
        }
    }
);

export const logoutUser = createAsyncThunk("auth/logoutUser", async () => {
    const refreshToken = getStoredRefreshToken();
    try {
        await api.post(
            "/api/auth/logout",
            refreshToken ? { refreshToken } : {}
        );
    } catch {
        // ignore
    } finally {
        clearStoredAuth();
    }
});

export const updateMyProfile = createAsyncThunk(
    "auth/updateMyProfile",
    async (payload, { rejectWithValue }) => {
        try {
            const res = await api.patch("/api/users/me", payload);
            const user = res.data?.data;
            if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
            return user;
        } catch (err) {
            return rejectWithValue(
                extractErrorMessage(err, "Failed to update profile")
            );
        }
    }
);

export const fetchBlockedUsers = createAsyncThunk(
    "auth/fetchBlockedUsers",
    async (_, { rejectWithValue }) => {
        try {
            const res = await api.get("/api/users/blocked");
            return res.data?.data || [];
        } catch (err) {
            return rejectWithValue(
                extractErrorMessage(err, "Failed to load blocked users")
            );
        }
    }
);

export const blockUserById = createAsyncThunk(
    "auth/blockUserById",
    async (userId, { dispatch, rejectWithValue }) => {
        try {
            await api.post(`/api/users/${userId}/block`);
            dispatch(fetchBlockedUsers());
            return userId;
        } catch (err) {
            return rejectWithValue(
                extractErrorMessage(err, "Failed to block user")
            );
        }
    }
);

export const unblockUserById = createAsyncThunk(
    "auth/unblockUserById",
    async (userId, { dispatch, rejectWithValue }) => {
        try {
            await api.delete(`/api/users/${userId}/block`);
            dispatch(fetchBlockedUsers());
            return userId;
        } catch (err) {
            return rejectWithValue(
                extractErrorMessage(err, "Failed to unblock user")
            );
        }
    }
);

const normalizeErrorPayload = payload => {
    if (!payload) return null;
    if (typeof payload === "string") return payload;
    return payload.message || "Something went wrong";
};

const initialState = {
    user: loadCachedUser(),
    accessToken: getStoredToken(),
    isAuthenticated: false,
    initializing: true,
    serverWaking: false,
    loading: false,
    otpSending: false,
    error: null,
    pendingSignup: null,
    blockedUsers: [],
    pythonServiceUrl:
        import.meta.env.VITE_PYTHON_SERVICE_URL ||
        localStorage.getItem(PY_URL_KEY) ||
        "",
    cloudinaryCloudName: ""
};

const authSlice = createSlice({
    name: "auth",
    initialState,
    reducers: {
        setServerWaking(state, action) {
            state.serverWaking = Boolean(action.payload);
        },
        clearAuthError(state) {
            state.error = null;
        },
        clearPendingSignup(state) {
            state.pendingSignup = null;
            state.error = null;
        },
        updateUserRole(state, action) {
            if (!state.user) return;
            const { role, isSuperAdmin } = action.payload || {};
            if (role) state.user.role = role;
            if (typeof isSuperAdmin === "boolean") {
                state.user.isSuperAdmin = isSuperAdmin;
            }
            try {
                localStorage.setItem(USER_KEY, JSON.stringify(state.user));
            } catch {
                // ignore
            }
        },
        forceLogout(state) {
            clearStoredAuth();
            state.user = null;
            state.accessToken = "";
            state.isAuthenticated = false;
            state.pendingSignup = null;
            state.blockedUsers = [];
        }
    },
    extraReducers: builder => {
        builder
            .addCase(initializeApp.pending, state => {
                state.initializing = true;
            })
            .addCase(initializeApp.fulfilled, (state, action) => {
                state.initializing = false;
                state.serverWaking = false;
                const { user, healthData } = action.payload || {};
                if (healthData?.pythonServiceUrl) {
                    state.pythonServiceUrl = healthData.pythonServiceUrl;
                }
                if (healthData?.cloudinaryCloudName) {
                    state.cloudinaryCloudName = healthData.cloudinaryCloudName;
                }
                if (user) {
                    state.user = user;
                    state.accessToken = getStoredToken();
                    state.isAuthenticated = true;
                } else {
                    state.user = null;
                    state.accessToken = "";
                    state.isAuthenticated = false;
                }
            })
            .addCase(initializeApp.rejected, state => {
                state.initializing = false;
                state.serverWaking = false;
                state.user = null;
                state.accessToken = "";
                state.isAuthenticated = false;
            })
            .addCase(sendSignupOtp.pending, state => {
                state.loading = true;
                state.otpSending = true;
                state.error = null;
            })
            .addCase(sendSignupOtp.fulfilled, (state, action) => {
                state.loading = false;
                state.otpSending = false;
                state.error = null;
                state.pendingSignup = action.payload;
            })
            .addCase(sendSignupOtp.rejected, (state, action) => {
                state.loading = false;
                state.otpSending = false;
                state.error = normalizeErrorPayload(action.payload);
            })
            .addCase(resendSignupOtp.pending, state => {
                state.otpSending = true;
                state.error = null;
            })
            .addCase(resendSignupOtp.fulfilled, (state, action) => {
                state.otpSending = false;
                state.error = null;
                state.pendingSignup = action.payload;
            })
            .addCase(resendSignupOtp.rejected, (state, action) => {
                state.otpSending = false;
                state.error = normalizeErrorPayload(action.payload);
            })
            .addCase(verifySignupOtp.pending, state => {
                state.loading = true;
                state.error = null;
            })
            .addCase(verifySignupOtp.fulfilled, (state, action) => {
                state.loading = false;
                state.error = null;
                state.pendingSignup = null;
                state.user = action.payload.user;
                state.accessToken = action.payload.accessToken;
                state.isAuthenticated = true;
            })
            .addCase(verifySignupOtp.rejected, (state, action) => {
                state.loading = false;
                state.error = normalizeErrorPayload(action.payload);
            })
            .addCase(loginUser.pending, state => {
                state.loading = true;
                state.error = null;
            })
            .addCase(loginUser.fulfilled, (state, action) => {
                state.loading = false;
                state.user = action.payload.user;
                state.accessToken = action.payload.accessToken;
                state.isAuthenticated = true;
            })
            .addCase(loginUser.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            })
            .addCase(logoutUser.fulfilled, state => {
                state.user = null;
                state.accessToken = "";
                state.isAuthenticated = false;
                state.pendingSignup = null;
                state.blockedUsers = [];
            })
            .addCase(updateMyProfile.fulfilled, (state, action) => {
                state.user = action.payload;
            })
            .addCase(fetchBlockedUsers.fulfilled, (state, action) => {
                state.blockedUsers = action.payload;
            });
    }
});

export const {
    setServerWaking,
    clearAuthError,
    clearPendingSignup,
    updateUserRole,
    forceLogout
} = authSlice.actions;
export default authSlice.reducer;
