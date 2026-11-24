import { useSyncExternalStore } from "react";
import { getOutboxSnapshot, subscribeOutbox } from "../services/outbox.js";

// সব চলমান/ব্যর্থ আপলোড (background queue থেকে)
export default function useUploadQueue() {
    return useSyncExternalStore(subscribeOutbox, getOutboxSnapshot, getOutboxSnapshot);
}
