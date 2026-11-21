import React, { useState } from "react";
import { Eye, EyeOff, Lock } from "lucide-react";

// পাসওয়ার্ড কেমন শক্ত: ০ (খুব দুর্বল) থেকে ৪ (শক্ত)
export const passwordStrength = value => {
    const v = String(value || "");
    if (!v) return 0;
    let score = 0;
    if (v.length >= 8) score += 1;
    if (v.length >= 12) score += 1;
    if (/[a-z]/.test(v) && /[A-Z]/.test(v)) score += 1;
    if (/\d/.test(v) && /[^A-Za-z0-9]/.test(v)) score += 1;
    else if (/\d/.test(v) || /[^A-Za-z0-9]/.test(v)) score += 0.5;
    return Math.min(4, Math.floor(score));
};

const LABELS = ["Too weak", "Weak", "Fair", "Good", "Strong"];

// আইকন + দেখা/লুকানো বাটন + (ঐচ্ছিক) শক্তির মিটার সহ পাসওয়ার্ড ঘর
export default function PasswordField({
    id,
    label,
    value,
    onChange,
    placeholder = "",
    autoComplete = "new-password",
    showMeter = false,
    disabled = false,
    autoFocus = false
}) {
    const [show, setShow] = useState(false);
    const level = passwordStrength(value);

    return (
        <div className="sync-field">
            <label htmlFor={id}>{label}</label>
            <div className="sync-input-icon">
                <Lock size={18} />
                <input
                    id={id}
                    type={show ? "text" : "password"}
                    placeholder={placeholder}
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    autoComplete={autoComplete}
                    maxLength={64}
                    disabled={disabled}
                    autoFocus={autoFocus}
                    required
                />
                <button
                    type="button"
                    className="sync-pass-toggle"
                    onClick={() => setShow(v => !v)}
                    aria-label={show ? "Hide password" : "Show password"}
                >
                    {show ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
            </div>
            {showMeter && value && (
                <div className="sync-pass-meter" data-level={level}>
                    <span className="sync-pass-bars" aria-hidden="true">
                        {[1, 2, 3, 4].map(n => (
                            <i key={n} className={n <= level ? "on" : ""} />
                        ))}
                    </span>
                    <small>{LABELS[level]}</small>
                </div>
            )}
        </div>
    );
}
