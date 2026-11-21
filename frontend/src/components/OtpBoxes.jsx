import React, { useRef } from "react";

export const OTP_LENGTH = 6;

// ৬ ঘরের OTP ইনপুট: টাইপ, পেস্ট (পুরো কোড), ব্যাকস্পেস ও তীর কী কাজ করে
export default function OtpBoxes({ digits, onChange, disabled = false }) {
    const refs = useRef([]);
    const focusAt = i => refs.current[i]?.focus();

    const setAt = (index, chars) => {
        const next = [...digits];
        chars.forEach((c, k) => {
            if (index + k < OTP_LENGTH) next[index + k] = c;
        });
        onChange(next);
        focusAt(Math.min(index + chars.length, OTP_LENGTH - 1));
    };

    const handleChange = (index, raw) => {
        const only = String(raw || "").replace(/\D/g, "");
        if (!only) {
            const next = [...digits];
            next[index] = "";
            onChange(next);
            return;
        }
        setAt(index, only.slice(0, OTP_LENGTH).split(""));
    };

    const handleKeyDown = (index, e) => {
        if (e.key === "Backspace") {
            if (digits[index]) {
                const next = [...digits];
                next[index] = "";
                onChange(next);
            } else if (index > 0) {
                e.preventDefault();
                const next = [...digits];
                next[index - 1] = "";
                onChange(next);
                focusAt(index - 1);
            }
        } else if (e.key === "ArrowLeft" && index > 0) {
            e.preventDefault();
            focusAt(index - 1);
        } else if (e.key === "ArrowRight" && index < OTP_LENGTH - 1) {
            e.preventDefault();
            focusAt(index + 1);
        }
    };

    const handlePaste = e => {
        const pasted = (e.clipboardData?.getData("text") || "").replace(/\D/g, "");
        if (!pasted) return;
        e.preventDefault();
        const chars = pasted.slice(0, OTP_LENGTH).split("");
        const next = Array(OTP_LENGTH).fill("");
        chars.forEach((c, i) => {
            next[i] = c;
        });
        onChange(next);
        focusAt(Math.min(chars.length, OTP_LENGTH) - 1);
    };

    return (
        <div className="sync-otp-grid" onPaste={handlePaste}>
            {digits.map((digit, idx) => (
                <input
                    key={idx}
                    id={`otp-digit-${idx}`}
                    ref={el => {
                        refs.current[idx] = el;
                    }}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    autoComplete={idx === 0 ? "one-time-code" : "off"}
                    className={`sync-otp-digit${digit ? " is-filled" : ""}`}
                    value={digit}
                    onChange={e => handleChange(idx, e.target.value)}
                    onKeyDown={e => handleKeyDown(idx, e)}
                    aria-label={`Digit ${idx + 1}`}
                    disabled={disabled}
                />
            ))}
        </div>
    );
}
