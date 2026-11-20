import { useEffect } from "react";
import { useSelector } from "react-redux";
import { setAppBadge } from "../services/appBadge.js";

// সব চ্যাটের unread যোগ করে অ্যাপ আইকনে badge বসায়।
// চ্যাট লিস্ট প্রথমবার লোড হওয়ার আগে কিছু করে না, নাহলে অ্যাপ খুললেই আগের badge ভুলে মুছে যেত।
export default function useAppBadge() {
    const conversations = useSelector(state => state.chat.conversations);
    const loaded = useSelector(state => state.chat.conversationsLoaded);

    const total = conversations.reduce(
        (acc, c) => acc + Math.max(0, Number(c.unread || 0)),
        0
    );

    useEffect(() => {
        if (!loaded) return;
        setAppBadge(total);
    }, [total, loaded]);
}
