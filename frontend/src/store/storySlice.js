import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { api, extractErrorMessage } from "../services/api.js";

export const fetchStories = createAsyncThunk(
    "story/fetchStories",
    async (_, { rejectWithValue }) => {
        try {
            const res = await api.get("/api/stories");
            return res.data?.data || [];
        } catch (err) {
            return rejectWithValue(
                extractErrorMessage(err, "Failed to load stories")
            );
        }
    }
);

export const createNewStory = createAsyncThunk(
    "story/createNewStory",
    async (payload, { dispatch, rejectWithValue }) => {
        try {
            const res = await api.post("/api/stories", payload);
            await dispatch(fetchStories());
            return res.data?.data;
        } catch (err) {
            return rejectWithValue(
                extractErrorMessage(err, "Failed to post story")
            );
        }
    }
);

export const markStoryViewed = createAsyncThunk(
    "story/markStoryViewed",
    async (storyId) => {
        await api.post(`/api/stories/${storyId}/view`);
        return storyId;
    }
);

export const fetchStoryViewers = createAsyncThunk(
    "story/fetchStoryViewers",
    async (storyId, { rejectWithValue }) => {
        try {
            const res = await api.get(`/api/stories/${storyId}/viewers`);
            return { storyId, viewers: res.data?.data || [] };
        } catch (err) {
            return rejectWithValue(
                extractErrorMessage(err, "Failed to load viewers")
            );
        }
    }
);

export const deleteMyStory = createAsyncThunk(
    "story/deleteMyStory",
    async (storyId, { dispatch, rejectWithValue }) => {
        try {
            await api.delete(`/api/stories/${storyId}`);
            await dispatch(fetchStories());
            return storyId;
        } catch (err) {
            return rejectWithValue(
                extractErrorMessage(err, "Failed to delete story")
            );
        }
    }
);

const initialState = {
    storyGroups: [],
    loading: false,
    posting: false,
    viewersByStoryId: {},
    error: null
};

const storySlice = createSlice({
    name: "story",
    initialState,
    reducers: {
        recordRealtimeStoryView(state, action) {
            const { storyId, viewer, viewedAt } = action.payload || {};
            if (!storyId) return;
            const sId = String(storyId);
            for (const group of state.storyGroups) {
                if (group.isMine) {
                    const st = group.stories.find(s => String(s._id) === sId);
                    if (st) {
                        st.viewCount = Number(st.viewCount || 0) + 1;
                    }
                }
            }
            if (viewer) {
                if (!state.viewersByStoryId[sId]) {
                    state.viewersByStoryId[sId] = [];
                }
                const exists = state.viewersByStoryId[sId].some(
                    v => String(v.user?._id) === String(viewer._id)
                );
                if (!exists) {
                    state.viewersByStoryId[sId].unshift({
                        user: viewer,
                        viewedAt: viewedAt || new Date().toISOString()
                    });
                }
            }
        }
    },
    extraReducers: builder => {
        builder
            .addCase(fetchStories.pending, state => {
                state.loading = true;
            })
            .addCase(fetchStories.fulfilled, (state, action) => {
                state.loading = false;
                state.storyGroups = action.payload;
            })
            .addCase(fetchStories.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            })
            .addCase(createNewStory.pending, state => {
                state.posting = true;
                state.error = null;
            })
            .addCase(createNewStory.fulfilled, state => {
                state.posting = false;
            })
            .addCase(createNewStory.rejected, (state, action) => {
                state.posting = false;
                state.error = action.payload;
            })
            .addCase(markStoryViewed.fulfilled, (state, action) => {
                const sId = String(action.payload);
                for (const group of state.storyGroups) {
                    for (const s of group.stories) {
                        if (String(s._id) === sId) {
                            s.seen = true;
                        }
                    }
                    if (!group.isMine) {
                        group.hasUnseen = group.stories.some(s => !s.seen);
                    }
                }
            })
            .addCase(fetchStoryViewers.fulfilled, (state, action) => {
                const { storyId, viewers } = action.payload;
                state.viewersByStoryId[String(storyId)] = viewers;
            });
    }
});

export const { recordRealtimeStoryView } = storySlice.actions;
export default storySlice.reducer;
