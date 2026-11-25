import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
    CalendarDays,
    ChevronLeft,
    ChevronRight,
    Clock3,
    X
} from "lucide-react";
import { pushBackHandler } from "../../services/backNavigation.js";
import { useIsMobile } from "./SyncSelect.jsx";

// ফোনের/ব্রাউজারের সাদা datetime-local এর বদলে Sync-এর নিজস্ব তারিখ + সময় বাছাইয়ের পপআপ।
// value / onChange এর ফরম্যাট আগের মতোই "YYYY-MM-DDTHH:mm" (খালি হলে "")
// ফোনে: নিচ থেকে শিট (Date → Time ধাপে ধাপে)। ডেস্কটপে: মাঝখানে কার্ড (ক্যালেন্ডার + সময় পাশাপাশি)।

const pad = n => String(n).padStart(2, "0");
const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
];
const WEEK = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const ITEM_H = 44;

const parse = str => {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(str || "");
    if (!m) return null;
    return { y: +m[1], mo: +m[2] - 1, d: +m[3], h: +m[4], mi: +m[5] };
};

const toStr = p => `${p.y}-${pad(p.mo + 1)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;

const fromDate = dt => ({
    y: dt.getFullYear(),
    mo: dt.getMonth(),
    d: dt.getDate(),
    h: dt.getHours(),
    mi: dt.getMinutes()
});

// এখন থেকে পরের ৫ মিনিটের ঘরে
const defaultDraft = () => {
    const dt = new Date(Date.now() + 5 * 60 * 1000);
    dt.setMinutes(Math.ceil(dt.getMinutes() / 5) * 5, 0, 0);
    return fromDate(dt);
};

const to12 = h => ({ hour: h % 12 === 0 ? 12 : h % 12, pm: h >= 12 });
const to24 = (hour, pm) => (hour % 12) + (pm ? 12 : 0);

const formatDate = p =>
    new Date(p.y, p.mo, p.d).toLocaleDateString("en-US", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric"
    });

const formatTime = p => {
    const { hour, pm } = to12(p.h);
    return `${hour}:${pad(p.mi)} ${pm ? "PM" : "AM"}`;
};

// ---------- স্ক্রল-হুইল ----------
function Wheel({ items, value, onChange, label, width }) {
    const ref = useRef(null);
    const timer = useRef(null);
    const fromScroll = useRef(false);
    const idx = Math.max(0, items.findIndex(i => i.value === value));

    useLayoutEffect(() => {
        if (ref.current) ref.current.scrollTop = idx * ITEM_H;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        if (fromScroll.current) {
            fromScroll.current = false;
            return;
        }
        if (Math.abs(el.scrollTop - idx * ITEM_H) > 2) {
            el.scrollTo({ top: idx * ITEM_H, behavior: "smooth" });
        }
    }, [idx]);

    useEffect(() => () => clearTimeout(timer.current), []);

    const onScroll = () => {
        clearTimeout(timer.current);
        timer.current = setTimeout(() => {
            const el = ref.current;
            if (!el) return;
            const i = Math.min(
                items.length - 1,
                Math.max(0, Math.round(el.scrollTop / ITEM_H))
            );
            if (items[i].value !== value) {
                fromScroll.current = true;
                onChange(items[i].value);
            }
        }, 80);
    };

    const onKeyDown = e => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const next = Math.min(
                items.length - 1,
                Math.max(0, idx + (e.key === "ArrowDown" ? 1 : -1))
            );
            onChange(items[next].value);
        }
    };

    return (
        <div className="sync-wheel" style={width ? { width } : undefined}>
            <div
                ref={ref}
                className="sync-wheel-scroll"
                role="listbox"
                tabIndex={0}
                aria-label={label}
                onScroll={onScroll}
                onKeyDown={onKeyDown}
            >
                {items.map((it, i) => (
                    <button
                        key={String(it.value)}
                        type="button"
                        tabIndex={-1}
                        role="option"
                        aria-selected={it.value === value}
                        className={`sync-wheel-item ${it.value === value ? "is-on" : ""} ${
                            Math.abs(i - idx) === 1 ? "is-near" : ""
                        }`}
                        onClick={() => onChange(it.value)}
                    >
                        {it.label}
                    </button>
                ))}
            </div>
            <span className="sync-wheel-band" aria-hidden="true" />
        </div>
    );
}

const HOURS = Array.from({ length: 12 }, (_, i) => ({
    value: i + 1,
    label: pad(i + 1)
}));
const MINUTES = Array.from({ length: 60 }, (_, i) => ({
    value: i,
    label: pad(i)
}));
const MERIDIEM = [
    { value: false, label: "AM" },
    { value: true, label: "PM" }
];

export default function SyncDateTimePicker({
    value,
    onChange,
    placeholder = "Pick date & time",
    title = "Set date and time",
    disablePast = false,
    clearable = true,
    disabled = false,
    className = ""
}) {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState(defaultDraft);
    const [view, setView] = useState({ y: 0, mo: 0 }); // ক্যালেন্ডারে কোন মাস দেখাচ্ছে
    const [mode, setMode] = useState("days"); // days | months
    const [step, setStep] = useState("date"); // শুধু ফোনে: date | time
    const triggerRef = useRef(null);
    const mobile = useIsMobile();

    const parsed = useMemo(() => parse(value), [value]);

    const openPicker = () => {
        if (disabled) return;
        const base = parsed || defaultDraft();
        setDraft(base);
        setView({ y: base.y, mo: base.mo });
        setMode("days");
        setStep("date");
        setOpen(true);
    };

    const close = useCallback(() => {
        setOpen(false);
        triggerRef.current?.focus?.({ preventScroll: true });
    }, []);

    useEffect(() => {
        if (!open) return undefined;
        const onKey = e => {
            if (e.key === "Escape") {
                e.preventDefault();
                setOpen(false);
            }
        };
        window.addEventListener("keydown", onKey);
        const offBack = pushBackHandler(() => {
            setOpen(false);
            return true;
        });
        return () => {
            window.removeEventListener("keydown", onKey);
            offBack();
        };
    }, [open]);

    const today = useMemo(() => {
        const t = new Date();
        return { y: t.getFullYear(), mo: t.getMonth(), d: t.getDate() };
    }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

    const isPast = (y, mo, d) => {
        if (!disablePast) return false;
        return new Date(y, mo, d).getTime() < new Date(today.y, today.mo, today.d).getTime();
    };

    // মাসের ৪২ ঘরের গ্রিড
    const cells = useMemo(() => {
        const first = new Date(view.y, view.mo, 1).getDay();
        const dim = new Date(view.y, view.mo + 1, 0).getDate();
        const prevDim = new Date(view.y, view.mo, 0).getDate();
        const out = [];
        for (let i = 0; i < 42; i += 1) {
            const dayNum = i - first + 1;
            if (dayNum < 1) {
                const dt = new Date(view.y, view.mo - 1, prevDim + dayNum);
                out.push({ ...fromDate(dt), other: true });
            } else if (dayNum > dim) {
                const dt = new Date(view.y, view.mo + 1, dayNum - dim);
                out.push({ ...fromDate(dt), other: true });
            } else {
                out.push({ y: view.y, mo: view.mo, d: dayNum, other: false });
            }
        }
        return out;
    }, [view]);

    const shiftMonth = delta => {
        const dt = new Date(view.y, view.mo + delta, 1);
        setView({ y: dt.getFullYear(), mo: dt.getMonth() });
    };

    const pickDay = c => {
        if (isPast(c.y, c.mo, c.d)) return;
        setDraft(p => ({ ...p, y: c.y, mo: c.mo, d: c.d }));
        if (c.other) setView({ y: c.y, mo: c.mo });
        setStep("time");
    };

    const goToday = () => {
        const t = new Date();
        setDraft(p => ({ ...p, y: t.getFullYear(), mo: t.getMonth(), d: t.getDate() }));
        setView({ y: t.getFullYear(), mo: t.getMonth() });
        setMode("days");
    };

    const goNow = () => {
        const d = defaultDraft();
        setDraft(d);
        setView({ y: d.y, mo: d.mo });
        setMode("days");
    };

    const { hour, pm } = to12(draft.h);
    const setHour = h12 => setDraft(p => ({ ...p, h: to24(h12, to12(p.h).pm) }));
    const setMinute = mi => setDraft(p => ({ ...p, mi }));
    const setMeridiem = isPm => setDraft(p => ({ ...p, h: to24(to12(p.h).hour, isPm) }));

    const set = () => {
        onChange?.(toStr(draft));
        setOpen(false);
    };
    const clear = () => {
        onChange?.("");
        setOpen(false);
    };

    const draftInPast =
        disablePast && new Date(draft.y, draft.mo, draft.d, draft.h, draft.mi).getTime() < Date.now() - 60 * 1000;

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                className={`sync-dt-trigger ${parsed ? "has-value" : ""} ${className}`}
                onClick={openPicker}
                disabled={disabled}
                aria-haspopup="dialog"
                aria-expanded={open}
            >
                <span className="sync-dt-trigger-ico">
                    <CalendarDays size={18} />
                </span>
                {parsed ? (
                    <span className="sync-dt-trigger-text">
                        <strong>{formatDate(parsed)}</strong>
                        <small>
                            <Clock3 size={12} /> {formatTime(parsed)}
                        </small>
                    </span>
                ) : (
                    <span className="sync-dt-trigger-text is-placeholder">{placeholder}</span>
                )}
                {parsed && clearable && !disabled && (
                    <span
                        role="button"
                        tabIndex={0}
                        className="sync-dt-trigger-clear"
                        aria-label="Clear date and time"
                        onClick={e => {
                            e.stopPropagation();
                            onChange?.("");
                        }}
                        onKeyDown={e => {
                            if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                e.stopPropagation();
                                onChange?.("");
                            }
                        }}
                    >
                        <X size={14} />
                    </span>
                )}
            </button>

            {open &&
                createPortal(
                    <div className="sync-ui-backdrop sync-dp-backdrop" role="presentation" onClick={close}>
                        <div
                            className={`sync-ui-sheet sync-dp is-step-${step}`}
                            role="dialog"
                            aria-modal="true"
                            aria-label={title}
                            onClick={e => e.stopPropagation()}
                        >
                            <span className="sync-ui-grab" aria-hidden="true" />

                            <div className="sync-dp-head">
                                <p className="sync-dp-eyebrow">{title}</p>
                                <div className="sync-dp-summary">
                                    <button
                                        type="button"
                                        className={`sync-dp-chip ${step === "date" ? "is-on" : ""}`}
                                        onClick={() => setStep("date")}
                                    >
                                        <CalendarDays size={16} />
                                        <span>{formatDate(draft)}</span>
                                    </button>
                                    <button
                                        type="button"
                                        className={`sync-dp-chip ${step === "time" ? "is-on" : ""}`}
                                        onClick={() => setStep("time")}
                                    >
                                        <Clock3 size={16} />
                                        <span>{formatTime(draft)}</span>
                                    </button>
                                </div>
                            </div>

                            <div className="sync-dp-body">
                                {/* ---------- তারিখ ---------- */}
                                <section className="sync-dp-pane sync-dp-date" aria-label="Date">
                                    <div className="sync-dp-nav">
                                        <button
                                            type="button"
                                            className="sync-dp-title"
                                            onClick={() => setMode(m => (m === "days" ? "months" : "days"))}
                                            aria-label="Choose month and year"
                                        >
                                            {mode === "days"
                                                ? `${MONTHS[view.mo]} ${view.y}`
                                                : `${view.y}`}
                                            <ChevronRight
                                                size={15}
                                                className={mode === "months" ? "is-down" : ""}
                                            />
                                        </button>
                                        <div className="sync-dp-arrows">
                                            <button
                                                type="button"
                                                className="sync-icon-btn xs"
                                                aria-label="Previous"
                                                onClick={() =>
                                                    mode === "days"
                                                        ? shiftMonth(-1)
                                                        : setView(v => ({ ...v, y: v.y - 1 }))
                                                }
                                            >
                                                <ChevronLeft size={18} />
                                            </button>
                                            <button
                                                type="button"
                                                className="sync-icon-btn xs"
                                                aria-label="Next"
                                                onClick={() =>
                                                    mode === "days"
                                                        ? shiftMonth(1)
                                                        : setView(v => ({ ...v, y: v.y + 1 }))
                                                }
                                            >
                                                <ChevronRight size={18} />
                                            </button>
                                        </div>
                                    </div>

                                    {mode === "days" ? (
                                        <div className="sync-dp-cal" key={`${view.y}-${view.mo}`}>
                                            <div className="sync-dp-week" aria-hidden="true">
                                                {WEEK.map(w => (
                                                    <span key={w}>{w}</span>
                                                ))}
                                            </div>
                                            <div className="sync-dp-grid" role="grid">
                                                {cells.map(c => {
                                                    const sel =
                                                        c.y === draft.y && c.mo === draft.mo && c.d === draft.d;
                                                    const tod =
                                                        c.y === today.y && c.mo === today.mo && c.d === today.d;
                                                    const past = isPast(c.y, c.mo, c.d);
                                                    return (
                                                        <button
                                                            key={`${c.y}-${c.mo}-${c.d}`}
                                                            type="button"
                                                            disabled={past}
                                                            aria-pressed={sel}
                                                            aria-label={new Date(c.y, c.mo, c.d).toDateString()}
                                                            className={`sync-dp-day ${c.other ? "is-other" : ""} ${
                                                                sel ? "is-sel" : ""
                                                            } ${tod ? "is-today" : ""}`}
                                                            onClick={() => pickDay(c)}
                                                        >
                                                            {c.d}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="sync-dp-months">
                                            {MONTHS.map((m, i) => {
                                                const pastMonth =
                                                    disablePast &&
                                                    (view.y < today.y || (view.y === today.y && i < today.mo));
                                                return (
                                                    <button
                                                        key={m}
                                                        type="button"
                                                        disabled={pastMonth}
                                                        className={`sync-dp-month ${
                                                            view.mo === i && view.y === draft.y && draft.mo === i
                                                                ? "is-sel"
                                                                : ""
                                                        }`}
                                                        onClick={() => {
                                                            setView(v => ({ ...v, mo: i }));
                                                            setMode("days");
                                                        }}
                                                    >
                                                        {m.slice(0, 3)}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}

                                    <div className="sync-dp-quick">
                                        <button type="button" className="sync-dp-link" onClick={goToday}>
                                            Today
                                        </button>
                                        <button type="button" className="sync-dp-link" onClick={goNow}>
                                            Now
                                        </button>
                                    </div>
                                </section>

                                {/* ---------- সময় ---------- */}
                                <section className="sync-dp-pane sync-dp-time" aria-label="Time">
                                    <div className="sync-dp-wheels" key={mobile ? step : "all"}>
                                        <Wheel
                                            items={HOURS}
                                            value={hour}
                                            onChange={setHour}
                                            label="Hour"
                                        />
                                        <span className="sync-dp-colon" aria-hidden="true">:</span>
                                        <Wheel
                                            items={MINUTES}
                                            value={draft.mi}
                                            onChange={setMinute}
                                            label="Minute"
                                        />
                                        <Wheel
                                            items={MERIDIEM}
                                            value={pm}
                                            onChange={setMeridiem}
                                            label="AM or PM"
                                            width="76px"
                                        />
                                    </div>
                                    {draftInPast && (
                                        <p className="sync-dp-warn">This time has already passed.</p>
                                    )}
                                </section>
                            </div>

                            <div className="sync-dp-foot">
                                {clearable ? (
                                    <button type="button" className="sync-dp-text-btn danger" onClick={clear}>
                                        Clear
                                    </button>
                                ) : (
                                    <span />
                                )}
                                <div className="sync-dp-foot-main">
                                    <button type="button" className="sync-btn secondary" onClick={close}>
                                        Cancel
                                    </button>
                                    {step === "date" ? (
                                        <button
                                            type="button"
                                            className="sync-btn primary sync-dp-next"
                                            onClick={() => setStep("time")}
                                        >
                                            Next
                                        </button>
                                    ) : null}
                                    <button
                                        type="button"
                                        className={`sync-btn primary sync-dp-set ${step === "date" ? "is-hide-mobile" : ""}`}
                                        onClick={set}
                                        disabled={draftInPast}
                                    >
                                        Set
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>,
                    document.body
                )}
        </>
    );
}
