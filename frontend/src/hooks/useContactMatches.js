import { useCallback, useEffect, useState } from "react";
import {
    getContactsMode,
    hasContactsPermission,
    requestContactsPermission,
    syncContacts
} from "../services/contacts.js";

// status: "unsupported" | "prompt" | "loading" | "ready" | "denied" | "error"
export default function useContactMatches() {
    const mode = getContactsMode();
    const [status, setStatus] = useState(
        mode === "none" ? "unsupported" : "prompt"
    );
    const [matches, setMatches] = useState([]);

    const load = useCallback(async force => {
        setStatus("loading");
        try {
            const list = await syncContacts({ force });
            setMatches(list);
            setStatus("ready");
        } catch (err) {
            // ব্রাউজারের picker বন্ধ করলে বা permission না দিলে
            const msg = String(err?.message || err || "").toLowerCase();
            setStatus(
                msg.includes("denied") || msg.includes("permission")
                    ? "denied"
                    : "error"
            );
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
            const ok = await requestContactsPermission();
            if (!ok) {
                setStatus("denied");
                return;
            }
        }
        load(true);
    }, [mode, load]);

    return { mode, status, matches, enable, refresh: () => load(true) };
}
