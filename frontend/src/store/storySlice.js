import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { api, extractErrorMessage } from "../services/api.js";
import { prefetchMedia } from "../services/nativeMedia.js";

export const fetchStories = createAsyncThunk(
    "story/fetchStories",
    async (_, { rejectWithValue }) => {
        try {
            const res = await api.get("/api/v1/stories");
            const groups = res.data?.data || [];
            // স্টোরির ছবি/ভিডিও আগেভাগেই ডিভাইসে নামিয়ে রাখা, যাতে খুললে সাথে সাথে চলে
            const items = [];
            for (const g of Array.isArray(groups) ? groups : []) {
                for (const st of g.stories || []) {
                    if (st?.media?.url && (st.type === "image" || st.type === "video")) {
                        items.push({
                            url: st.media.url,
                            kind: st.type === "video" ? "video" : "story"
                        });
                    }
                }
            }
            prefetchMedia(items);
            return groups;
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
            const res = await api.post("/api/v1/stories", payload);
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
        await api.post(`/api/v1/stories/${storyId}/view`);
        return storyId;
    }
);

export const fetchStoryViewers = createAsyncThunk(
    "story/fetchStoryViewers",
    async (storyId, { rejectWithValue }) => {
        try {
            const res = await api.get(`/api/v1/stories/${storyId}/viewers`);
            return { storyId, viewers: res.data?.data || [] };
        } catch (err) {
            return rejectWithValue(
                extractErrorMessage(err, "Failed to load viewers")
            );
        }
    }
);

export const reactToStory = createAsyncThunk(
    "story/reactToStory",
    async ({ storyId, emoji, offsetMs = 0 }, { dispatch, rejectWithValue }) => {
        // আগে UI-তে সাথে সাথে দেখাই (optimistic), সার্ভার ফেল করলে ফিরিয়ে আনি
        dispatch(setMyReaction({ storyId, emoji: emoji || null }));
        try {
            const res = await api.post(`/api/v1/stories/${storyId}/react`, {
                emoji: emoji || null,
                // story-র কত ms-এর মাথায় react দিলাম (লেখক ঠিক সেই সময়ে animation দেখেন)
                offsetMs: Math.max(0, Math.round(Number(offsetMs) || 0))
            });
            return { storyId, ...(res.data?.data || {}) };
        } catch (err) {
            dispatch(fetchStories());
            return rejectWithValue(
                extractErrorMessage(err, "Could not send reaction")
            );
        }
    }
);

export const replyToStory = createAsyncThunk(
    "story/replyToStory",
    async ({ storyId, text }, { rejectWithValue }) => {
        try {
            const res = await api.post(`/api/v1/stories/${storyId}/reply`, {
                text
            });
            return res.data?.data;
        } catch (err) {
            return rejectWithValue(
                extractErrorMessage(err, "Could not send reply")
            );
        }
    }
);

export const deleteMyStory = createAsyncThunk(
    "story/deleteMyStory",
    async (storyId, { dispatch, rejectWithValue }) => {
        try {
            await api.delete(`/api/v1/stories/${storyId}`);
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
    lastReaction: null,
    error: null
};

const findStory = (state, storyId) => {
    const sId = String(storyId);
    for (const group of state.storyGroups) {
        const st = group.stories.find(x => String(x._id) === sId);
        if (st) return st;
    }
    return null;
};

const storySlice = createSlice({
    name: "story",
    initialState,
    reducers: {
        // আমি নিজে react দিলে/সরালে
        setMyReaction(state, action) {
            const { storyId, emoji } = action.payload || {};
            const st = findStory(state, storyId);
            if (!st) return;
            const prev = st.myReaction || null;
            if (prev === (emoji || null)) return;
            st.reactionSummary = st.reactionSummary || {};
            if (prev) {
                st.reactionSummary[prev] = Math.max(
                    0,
                    (st.reactionSummary[prev] || 1) - 1
                );
                if (!st.reactionSummary[prev]) delete st.reactionSummary[prev];
            }
            if (emoji) {
                st.reactionSummary[emoji] =
                    (st.reactionSummary[emoji] || 0) + 1;
            }
            st.reactionCount = Object.values(st.reactionSummary).reduce(
                (a, b) => a + b,
                0
            );
            st.myReaction = emoji || null;
        },
        // অন্য কেউ আমার story-তে react দিলে (রিয়েল-টাইম)
        recordRealtimeStoryReaction(state, action) {
            const {
                storyId,
                user,
                emoji,
                reactedAt,
                offsetMs,
                reactionCount,
                reactionSummary
            } = action.payload || {};
            if (!storyId || !user?._id) return;
            const sId = String(storyId);
            const st = findStory(state, sId);
            if (st && typeof reactionCount === "number") {
                st.reactionCount = reactionCount;
            }
            if (st && reactionSummary) {
                st.reactionSummary = reactionSummary;
            }
            // লেখকের টাইমলাইন আপডেট: একজনের একটাই react, নতুন হলে আগেরটা বদলে যায়
            const at = Math.max(0, Math.round(Number(offsetMs) || 0));
            if (st && Array.isArray(st.reactionTimeline)) {
                st.reactionTimeline = st.reactionTimeline.filter(
                    r => String(r.userId) !== String(user._id)
                );
                if (emoji) {
                    st.reactionTimeline.push({
                        userId: String(user._id),
                        emoji,
                        offsetMs: at
                    });
                    st.reactionTimeline.sort((a, b) => a.offsetMs - b.offsetMs);
                }
            }
            const list = state.viewersByStoryId[sId];
            if (list) {
                const row = list.find(
                    v => String(v.user?._id) === String(user._id)
                );
                if (row) {
                    row.reaction = emoji || null;
                } else {
                    list.unshift({
                        user,
                        viewedAt: reactedAt || new Date().toISOString(),
                        reaction: emoji || null
                    });
                }
            }
            if (emoji) {
                state.lastReaction = {
                    storyId: sId,
                    emoji,
                    user,
                    offsetMs: at,
                    at: Date.now()
                };
            }
        },
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

export const {
    recordRealtimeStoryView,
    recordRealtimeStoryReaction,
    setMyReaction
} = storySlice.actions;
export default storySlice.reducer;
