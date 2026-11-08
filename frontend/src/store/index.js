import { configureStore } from "@reduxjs/toolkit";
import authReducer from "./authSlice.js";
import chatReducer from "./chatSlice.js";
import storyReducer from "./storySlice.js";

export const store = configureStore({
    reducer: {
        auth: authReducer,
        chat: chatReducer,
        story: storyReducer
    }
});
