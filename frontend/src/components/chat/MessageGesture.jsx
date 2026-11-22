import React, { useRef, useState, useCallback } from "react";
import "../../styles/msg-gestures.css";

// মেসেজ সারি (row): WhatsApp-এর মতো
//   • ডানে বা বামে swipe করলে reply
//   • টিপে ধরলে (hold) মেনু (Reply / Info / Delete)
// ভার্টিক্যাল স্ক্রল ঠিক থাকে (touch-action: pan-y), আর ট্র্যাকিং ref দিয়ে হয়, তাই swipe-এ re-render নেই।
const LONG_PRESS_MS = 420;
const MOVE_SLOP = 10; // এর বেশি নড়লে hold বাতিল
const TRIGGER_DX = 78; // এতটা টানলে reply হয়
const MAX_SHIFT = 64; // বাবল সর্বোচ্চ এতটা সরে
// এগুলোর ওপর থেকে শুরু হলে swipe হয় না (সিকবার, প্লেয়ার, বাটন, লিংক), hold তবু কাজ করে
const NO_SWIPE =
    'input,textarea,select,button,a,audio,video,canvas,[role="slider"],[data-no-gesture],.sync-ap,.sync-vp-bar,.sync-vp-track';

const buzz = ms => {
    try {
        if (navigator.vibrate) navigator.vibrate(ms);
    } catch {
        // সব ডিভাইসে নেই
    }
};

export default function MessageGesture({
    className = "",
    disabled = false,
    onReply,
    onLongPress,
    children
}) {
    const rowRef = useRef(null);
    const iconRef = useRef(null);
    const [pressed, setPressed] = useState(false);
    const st = useRef({
        id: null,
        x: 0,
        y: 0,
        dx: 0,
        mode: "",
        noSwipe: false,
        timer: 0,
        armed: false
    });
    const suppressClickUntil = useRef(0);

    const bubble = () => rowRef.current?.firstElementChild || null;

    const setShift = (dx, animate) => {
        const b = bubble();
        const icon = iconRef.current;
        if (!b) return;
        b.style.transition = animate
            ? "transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1)"
            : "none";
        const shift =
            Math.sign(dx) * Math.min(Math.abs(dx) * 0.6, MAX_SHIFT);
        b.style.transform = shift ? `translate3d(${shift}px,0,0)` : "";
        if (icon) {
            const p = Math.min(Math.abs(dx) / TRIGGER_DX, 1);
            icon.style.opacity = String(p);
            icon.style.transform = `scale(${0.5 + p * 0.5})`;
            icon.dataset.side = dx > 0 ? "left" : "right";
            icon.dataset.ready = p >= 1 ? "1" : "0";
        }
    };

    const clearTimer = () => {
        if (st.current.timer) clearTimeout(st.current.timer);
        st.current.timer = 0;
    };

    const finish = () => {
        clearTimer();
        const s = st.current;
        if (s.mode === "swipe") setShift(0, true);
        s.id = null;
        s.mode = "";
        s.dx = 0;
        s.armed = false;
        setPressed(false);
    };

    const onPointerDown = useCallback(
        e => {
            if (disabled) return;
            if (e.pointerType === "mouse" && e.button !== 0) return;
            const s = st.current;
            s.id = e.pointerId;
            s.x = e.clientX;
            s.y = e.clientY;
            s.dx = 0;
            s.mode = "";
            s.armed = false;
            s.noSwipe = Boolean(e.target?.closest?.(NO_SWIPE));
            clearTimer();
            // মাউসে hold মেনু খোলে না (ডেস্কটপে ডান-ক্লিক আছে), শুধু টাচে
            if (e.pointerType !== "mouse") {
                s.timer = setTimeout(() => {
                    s.timer = 0;
                    if (s.mode !== "") return;
                    s.mode = "long";
                    suppressClickUntil.current = Date.now() + 600;
                    setPressed(true);
                    buzz(14);
                    onLongPress?.();
                }, LONG_PRESS_MS);
            }
        },
        [disabled, onLongPress]
    );

    const onPointerMove = useCallback(e => {
        const s = st.current;
        if (s.id !== e.pointerId || s.mode === "long") return;
        const dx = e.clientX - s.x;
        const dy = e.clientY - s.y;

        if (s.mode === "") {
            const adx = Math.abs(dx);
            const ady = Math.abs(dy);
            if (ady > MOVE_SLOP || (adx > MOVE_SLOP && s.noSwipe)) {
                clearTimer();
                s.mode = "scroll";
                return;
            }
            if (adx > MOVE_SLOP && adx > ady * 1.4) {
                clearTimer();
                s.mode = "swipe";
                try {
                    rowRef.current?.setPointerCapture(e.pointerId);
                } catch {
                    // ignore
                }
            } else {
                return;
            }
        }

        if (s.mode === "swipe") {
            s.dx = dx;
            setShift(dx, false);
            if (!s.armed && Math.abs(dx) >= TRIGGER_DX) {
                s.armed = true;
                buzz(10);
            } else if (s.armed && Math.abs(dx) < TRIGGER_DX) {
                s.armed = false;
            }
        }
    }, []);

    const onPointerUp = useCallback(
        e => {
            const s = st.current;
            if (s.id !== e.pointerId) return;
            if (s.mode === "swipe") {
                suppressClickUntil.current = Date.now() + 350;
                if (Math.abs(s.dx) >= TRIGGER_DX) onReply?.();
            }
            finish();
        },
        [onReply]
    );

    const onPointerCancel = useCallback(() => finish(), []);

    const onContextMenu = useCallback(
        e => {
            e.preventDefault(); // টাচে hold করলে ব্রাউজারের নিজের মেনু/সিলেকশন নয়
            if (disabled) return;
            // টাচে আমাদের নিজস্ব hold আগেই মেনু খুলেছে; ডেস্কটপের ডান-ক্লিকে এখানে খোলে
            if (st.current.mode === "long") return;
            if (e.nativeEvent?.pointerType === "touch") return;
            suppressClickUntil.current = Date.now() + 300;
            onLongPress?.();
        },
        [disabled, onLongPress]
    );

    const onClickCapture = e => {
        if (Date.now() < suppressClickUntil.current) {
            e.preventDefault();
            e.stopPropagation();
        }
    };

    return (
        <div
            ref={rowRef}
            className={`${className} sync-swipeable${pressed ? " is-pressed" : ""}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onContextMenu={onContextMenu}
            onClickCapture={onClickCapture}
        >
            {children}
            <span ref={iconRef} className="sync-swipe-icon" aria-hidden="true">
                <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <polyline points="9 17 4 12 9 7" />
                    <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
                </svg>
            </span>
        </div>
    );
}
