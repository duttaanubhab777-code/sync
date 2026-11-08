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

export const initializeApp = createAsyncThunk(
    "auth/initializeApp",
    async (_, { dispatch, rejectWithValue }) => {
        const wakeTimer = setTimeout(() => {
            dispatch(setServerWaking(true));
        }, 1200);

        let healthData = null;
        try {
            const res = await api.get("/health");
            healthData = res.data;
            if (healthData?.pythonServiceUrl) {
                localStorage.setItem(PY_URL_KEY, healthData.pythonServiceUrl);
            }
        } catch {
            // ignore
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

export const registerUser = createAsyncThunk(
    "auth/registerUser",
    async (payload, { rejectWithValue }) => {
        try {
            const res = await api.post("/api/auth/register", payload);
            const { user, accessToken, refreshToken } = res.data?.data || {};
            setStoredTokens({ accessToken, refreshToken });
            if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
            return { user, accessToken, refreshToken };
        } catch (err) {
            return rejectWithValue(
                extractErrorMessage(err, "Registration failed")
            );
        }
    }
);

export const loginUser = createAsyncThunk(
    "auth/loginUser",
    async (payload, { rejectWithValue }) => {
        try {
            const res = await api.post("/api/auth/login", payload);
            const { user, accessToken, refreshToken } = res.data?.data || {};
            setStoredTokens({ accessToken, refreshToken });
            if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
            return { user, accessToken, refreshToken };
        } catch (err) {
            return rejectWithValue(extractErrorMessage(err, "Login failed"));
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

const initialState = {
    user: loadCachedUser(),
    accessToken: getStoredToken(),
    isAuthenticated: Boolean(getStoredToken() && loadCachedUser()),
    initializing: true,
    serverWaking: false,
    loading: false,
    error: null,
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
        forceLogout(state) {
            clearStoredAuth();
            state.user = null;
            state.accessToken = "";
            state.isAuthenticated = false;
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
            .addCase(registerUser.pending, state => {
                state.loading = true;
                state.error = null;
            })
            .addCase(registerUser.fulfilled, (state, action) => {
                state.loading = false;
                state.user = action.payload.user;
                state.accessToken = action.payload.accessToken;
                state.isAuthenticated = true;
            })
            .addCase(registerUser.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
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

export const { setServerWaking, clearAuthError, forceLogout } =
    authSlice.actions;
export default authSlice.reducer;
