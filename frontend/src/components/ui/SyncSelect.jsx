import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, X } from "lucide-react";
import { pushBackHandler } from "../../services/backNavigation.js";

// ব্রাউজারের সাদা <select> এর বদলে Sync-এর নিজস্ব ডিজাইনের dropdown।
// ডেস্কটপে: ট্রিগারের নিচে ভাসমান প্যানেল। ফোনে: নিচ থেকে উঠে আসা শিট।
// options: [{ value, label, hint?, count?, icon? }]

const MOBILE_QUERY = "(max-width: 820px)";

export function useIsMobile() {
    const [mobile, setMobile] = useState(() =>
        typeof window !== "undefined" && window.matchMedia
            ? window.matchMedia(MOBILE_QUERY).matches
            : false
    );
    useEffect(() => {
        if (!window.matchMedia) return undefined;
        const mq = window.matchMedia(MOBILE_QUERY);
        const on = () => setMobile(mq.matches);
        on();
        mq.addEventListener?.("change", on);
        return () => mq.removeEventListener?.("change", on);
    }, []);
    return mobile;
}

export default function SyncSelect({
    value,
    onChange,
    options,
    placeholder = "Select...",
    title = "Select",
    disabled = false,
    icon: Icon,
    className = "",
    ariaLabel
}) {
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState(null);
    const [active, setActive] = useState(-1);
    const activeRef = useRef(-1);
    activeRef.current = active;
    const triggerRef = useRef(null);
    const panelRef = useRef(null);
    const mobile = useIsMobile();

    const current = useMemo(
        () => options.find(o => o.value === value),
        [options, value]
    );

    const close = useCallback(() => {
        setOpen(false);
        triggerRef.current?.focus?.({ preventScroll: true });
    }, []);

    const choose = opt => {
        if (opt.disabled) return;
        onChange?.(opt.value);
        setOpen(false);
    };

    // ডেস্কটপে প্যানেলের জায়গা হিসাব (জায়গা না থাকলে ওপরে খোলে)
    const place = useCallback(() => {
        const el = triggerRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const width = Math.min(Math.max(r.width, 240), vw - 24);
        const left = Math.min(Math.max(12, r.left), vw - width - 12);
        const need = Math.min(options.length * 48 + 16, 330);
        const below = vh - r.bottom - 12;
        const above = r.top - 12;
        const openUp = below < need && above > below;
        setPos({
            left,
            width,
            top: openUp ? undefined : r.bottom + 8,
            bottom: openUp ? vh - r.top + 8 : undefined,
            maxHeight: Math.max(160, Math.min(340, openUp ? above : below)),
            up: openUp
        });
    }, [options.length]);

    useLayoutEffect(() => {
        if (open && !mobile) place();
    }, [open, mobile, place]);

    useEffect(() => {
        if (!open) return undefined;
        setActive(Math.max(0, options.findIndex(o => o.value === value)));

        const onKey = e => {
            if (e.key === "Escape") {
                e.preventDefault();
                close();
            } else if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive(i => Math.min(options.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive(i => Math.max(0, i - 1));
            } else if (e.key === "Enter") {
                const opt = options[activeRef.current];
                if (opt) {
                    e.preventDefault();
                    choose(opt);
                }
            }
        };
        const onDown = e => {
            if (mobile) return;
            if (panelRef.current?.contains(e.target)) return;
            if (triggerRef.current?.contains(e.target)) return;
            setOpen(false);
        };
        const onScroll = e => {
            if (mobile) return;
            if (panelRef.current?.contains(e.target)) return;
            setOpen(false);
        };
        window.addEventListener("keydown", onKey);
        window.addEventListener("pointerdown", onDown, true);
        window.addEventListener("scroll", onScroll, true);
        window.addEventListener("resize", place);
        const offBack = pushBackHandler(() => {
            setOpen(false);
            return true;
        });
        return () => {
            window.removeEventListener("keydown", onKey);
            window.removeEventListener("pointerdown", onDown, true);
            window.removeEventListener("scroll", onScroll, true);
            window.removeEventListener("resize", place);
            offBack();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, mobile]);

    // খোলার পর বাছা অপশনটা দেখা যায় এমন জায়গায় আনা
    useEffect(() => {
        if (!open) return;
        const t = setTimeout(() => {
            panelRef.current
                ?.querySelector(".is-selected")
                ?.scrollIntoView({ block: "nearest" });
        }, 30);
        return () => clearTimeout(t);
    }, [open]);

    const list = (
        <ul className="sync-ss-list" role="listbox" aria-label={title}>
            {options.map((o, i) => {
                const selected = o.value === value;
                return (
                    <li key={String(o.value)} role="presentation">
                        <button
                            type="button"
                            role="option"
                            aria-selected={selected}
                            disabled={o.disabled}
                            className={`sync-ss-opt ${selected ? "is-selected" : ""} ${
                                active === i ? "is-active" : ""
                            }`}
                            onMouseEnter={() => setActive(i)}
                            onClick={() => choose(o)}
                        >
                            <span className="sync-ss-opt-main">
                                <span className="sync-ss-opt-label">{o.label}</span>
                                {o.hint && <small>{o.hint}</small>}
                            </span>
                            {o.count != null && (
                                <em className="sync-ss-count">{o.count}</em>
                            )}
                            <span className="sync-ss-tick" aria-hidden="true">
                                {selected && <Check size={16} />}
                            </span>
                        </button>
                    </li>
                );
            })}
        </ul>
    );

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                className={`sync-ss-trigger ${open ? "is-open" : ""} ${className}`}
                onClick={() => !disabled && setOpen(o => !o)}
                disabled={disabled}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-label={ariaLabel || title}
            >
                {Icon && <Icon size={16} className="sync-ss-lead" />}
                <span className={`sync-ss-value ${current ? "" : "is-placeholder"}`}>
                    {current ? current.label : placeholder}
                </span>
                <ChevronDown size={17} className="sync-ss-chev" />
            </button>

            {open &&
                createPortal(
                    mobile ? (
                        <div
                            className="sync-ui-backdrop"
                            role="presentation"
                            onClick={() => setOpen(false)}
                        >
                            <div
                                ref={panelRef}
                                className="sync-ui-sheet"
                                role="dialog"
                                aria-modal="true"
                                aria-label={title}
                                onClick={e => e.stopPropagation()}
                            >
                                <span className="sync-ui-grab" aria-hidden="true" />
                                <div className="sync-ui-sheet-head">
                                    <h4>{title}</h4>
                                    <button
                                        type="button"
                                        className="sync-icon-btn"
                                        aria-label="Close"
                                        onClick={() => setOpen(false)}
                                    >
                                        <X size={18} />
                                    </button>
                                </div>
                                <div className="sync-ui-sheet-scroll">{list}</div>
                            </div>
                        </div>
                    ) : (
                        <div
                            ref={panelRef}
                            className={`sync-ss-pop ${pos?.up ? "is-up" : ""}`}
                            style={
                                pos
                                    ? {
                                          left: pos.left,
                                          width: pos.width,
                                          top: pos.top,
                                          bottom: pos.bottom,
                                          maxHeight: pos.maxHeight
                                      }
                                    : { visibility: "hidden" }
                            }
                        >
                            {list}
                        </div>
                    ),
                    document.body
                )}
        </>
    );
}
