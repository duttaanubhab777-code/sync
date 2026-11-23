import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useDispatch } from "react-redux";
import { Loader2, UserX } from "lucide-react";
import { openChatByUsername } from "../services/qrChat.js";

// /u/<username> : QR বা শেয়ার করা লিংক খুললে সরাসরি ওই ইউজারের চ্যাটে নিয়ে যায়
// (Google Lens / ক্যামেরা অ্যাপ / ব্রাউজার, যেখান থেকেই খোলা হোক)
export default function UserLinkPage() {
    const { username } = useParams();
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const [error, setError] = useState("");
    const ranFor = useRef("");

    useEffect(() => {
        if (ranFor.current === username) return;
        ranFor.current = username;
        let alive = true;
        (async () => {
            try {
                const out = await openChatByUsername(dispatch, String(username || "").toLowerCase());
                if (!alive) return;
                if (out.self) {
                    navigate("/chats", { replace: true });
                    return;
                }
                navigate(`/chats/${out.conversation._id}`, { replace: true });
            } catch (err) {
                if (alive) setError(err.message);
            }
        })();
        return () => {
            alive = false;
            ranFor.current = "";
        };
    }, [username, dispatch, navigate]);

    return (
        <div className="sync-userlink">
            {error ? (
                <>
                    <UserX size={34} />
                    <h3>{error}</h3>
                    <button type="button" className="sync-btn primary" onClick={() => navigate("/chats", { replace: true })}>
                        Go to chats
                    </button>
                </>
            ) : (
                <>
                    <Loader2 size={30} className="spin" />
                    <p>Opening chat with @{username}...</p>
                </>
            )}
        </div>
    );
}
