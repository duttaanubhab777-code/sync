import React, { useEffect } from "react";
import { Loader2 } from "lucide-react";

// window.confirm এর বদলে অ্যাপের স্টাইলের কনফার্ম ডায়ালগ
export default function ConfirmDialog({
    icon: Icon,
    title,
    message,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    busy = false,
    onConfirm,
    onCancel
}) {
    useEffect(() => {
        const onKey = e => {
            if (e.key === "Escape" && !busy) onCancel?.();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [busy, onCancel]);

    return (
        <div
            className="sync-modal-backdrop"
            onClick={() => !busy && onCancel?.()}
            role="presentation"
        >
            <div
                className="sync-modal-card is-confirm"
                role="alertdialog"
                aria-modal="true"
                aria-label={title}
                onClick={e => e.stopPropagation()}
            >
                {Icon && (
                    <div className="sync-confirm-icon">
                        <Icon size={28} />
                    </div>
                )}
                <h3>{title}</h3>
                <p>{message}</p>
                <div className="sync-confirm-actions">
                    <button
                        type="button"
                        className="sync-btn secondary lg"
                        onClick={onCancel}
                        disabled={busy}
                    >
                        {cancelLabel}
                    </button>
                    <button
                        type="button"
                        className="sync-btn danger-solid lg"
                        onClick={onConfirm}
                        disabled={busy}
                        autoFocus
                    >
                        {busy ? (
                            <Loader2 size={17} className="spin" />
                        ) : (
                            confirmLabel
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
