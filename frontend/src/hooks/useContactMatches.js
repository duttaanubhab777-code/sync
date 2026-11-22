import { useCallback, useEffect, useState } from "react";
import { extractErrorMessage } from "../services/api.js";
import {
    getContactsMode,
    hasContactsPermission,
    requestContactsPermission,
    syncContacts
} from "../services/contacts.js";

// status: "unsupported" | "update" | "prompt" | "loading" | "ready" | "denied" | "error"
export default function useContactMatches() {
    const mode = getContactsMode();
    const [status, setStatus] = useState(
        mode === "none" ? "unsupported" : mode === "update" ? "update" : "prompt"
    );
    const [matches, setMatches] = useState([]);
    const [errorMsg, setErrorMsg] = useState("");

    const load = useCallback(async force => {
        setStatus("loading");
        try {
            const list = await syncContacts({ force });
            setMatches(list);
            setStatus("ready");
        } catch (err) {
            const raw = String(err?.message || err || "");
            const low = raw.toLowerCase();
            if (!err?.response && (low.includes("denied") || low.includes("permission"))) {
                setStatus("denied");
                return;
            }
            // সার্ভার/নেটওয়ার্কের ভুল হলে আসল কারণটা দেখানো, যাতে বোঝা যায় কী হয়েছে
            setErrorMsg(
                err?.response
                    ? extractErrorMessage(err, "Server error")
                    : raw || "Unknown error"
            );
            setStatus("error");
        }
    }, []);

    // permission আগেই দেওয়া থাকলে খুলতেই অটো মিলিয়ে নেয়
    useEffect(() => {
        if (mode !== "native") return;
        let alive = true;
        hasContactsPermission().then(ok => {
            if (alive && ok) load(false);
        });
        return () => {
            alive = false;
        };
    }, [mode, load]);

    const enable = useCallback(async () => {
        if (mode === "native") {
            const { granted, error } = await requestContactsPermission();
            if (!granted) {
                setErrorMsg(error);
                setStatus("denied");
                return;
            }
        }
        load(true);
    }, [mode, load]);

    return { mode, status, matches, errorMsg, enable, refresh: () => load(true) };
}
