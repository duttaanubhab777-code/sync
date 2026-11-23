import { api } from "./api.js";
import { startDirectChat } from "../store/chatSlice.js";

const errText = (err, fallback) =>
    err?.response?.data?.message || (typeof err === "string" ? err : err?.message) || fallback;

// username থেকে ইউজার খুঁজে তার সাথে direct চ্যাট খোলে (না থাকলে তৈরি হয়)।
// ফেরত: { conversation } অথবা { self: true }; ব্যর্থ হলে Error ছুড়ে।
export async function openChatByUsername(dispatch, username) {
    let user;
    try {
        const res = await api.get(
            `/api/v1/users/by-username/${encodeURIComponent(username)}`
        );
        user = res.data?.data;
    } catch (err) {
        if (err?.response?.status === 404) {
            throw new Error("This user was not found on Sync");
        }
        throw new Error(errText(err, "Could not look up this user"));
    }
    if (!user?._id) throw new Error("This user was not found on Sync");
    if (user.isSelf) return { self: true, user };

    try {
        const conversation = await dispatch(startDirectChat(user._id)).unwrap();
        return { conversation, user };
    } catch (err) {
        throw new Error(errText(err, "Could not start the chat"));
    }
}
