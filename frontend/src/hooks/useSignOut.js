import { useCallback } from "react";
import { useDispatch } from "react-redux";
import { useNavigate } from "react-router-dom";
import { logoutUser } from "../store/authSlice.js";
import { resetChatState } from "../store/chatSlice.js";
import { disconnectSocket } from "../services/socket.js";

// AppLayout (ডেস্কটপ রেইল) ও ProfilePage (মোবাইল) দুই জায়গা থেকেই একই লগআউট
export default function useSignOut() {
    const dispatch = useDispatch();
    const navigate = useNavigate();

    return useCallback(async () => {
        disconnectSocket();
        dispatch(resetChatState());
        await dispatch(logoutUser());
        navigate("/login", { replace: true });
    }, [dispatch, navigate]);
}
