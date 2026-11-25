import React, { useState } from "react";
import { X, Plus, Trash2, BarChart2 } from "lucide-react";

/**
 * নতুন গ্রুপ পোল তৈরির মডাল (প্রশ্ন + ২ থেকে ৬টি অপশন)
 */
export default function CreatePollModal({ onClose, onCreate }) {
    const [question, setQuestion] = useState("");
    const [options, setOptions] = useState(["", ""]);
    const [allowMultiple, setAllowMultiple] = useState(false);
    const [error, setError] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const updateOption = (idx, value) => {
        setOptions(prev => prev.map((v, i) => (i === idx ? value : v)));
    };

    const addOption = () => {
        if (options.length < 6) setOptions(prev => [...prev, ""]);
    };

    const removeOption = idx => {
        if (options.length > 2) {
            setOptions(prev => prev.filter((_, i) => i !== idx));
        }
    };

    const handleSubmit = async e => {
        e.preventDefault();
        const cleanQ = question.trim();
        const cleanOpts = options.map(o => o.trim()).filter(Boolean);
        if (!cleanQ) {
            setError("Please enter a poll question");
            return;
        }
        if (cleanOpts.length < 2) {
            setError("Add at least 2 options");
            return;
        }
        setSubmitting(true);
        setError("");
        try {
            await onCreate?.({
                question: cleanQ,
                options: cleanOpts,
                allowMultiple
            });
            onClose?.();
        } catch (err) {
            setError(err?.message || "Could not create poll");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="sync-modal-backdrop" onClick={onClose}>
            <div
                className="sync-modal-card"
                onClick={e => e.stopPropagation()}
            >
                <div className="sync-modal-header">
                    <h3 className="sync-name-with-badge">
                        <BarChart2 size={18} /> Create Poll
                    </h3>
                    <button
                        type="button"
                        className="sync-icon-btn"
                        onClick={onClose}
                    >
                        <X size={19} />
                    </button>
                </div>

                <form className="sync-modal-body" onSubmit={handleSubmit}>
                    <div className="sync-field">
                        <label>Question *</label>
                        <input
                            type="text"
                            placeholder="Ask a question..."
                            maxLength={200}
                            value={question}
                            onChange={e => setQuestion(e.target.value)}
                            autoFocus
                            required
                        />
                    </div>

                    <div className="sync-field">
                        <label>Options (2–6)</label>
                        <div className="sync-poll-form-opts">
                            {options.map((opt, idx) => (
                                <div key={idx} className="sync-poll-form-row">
                                    <input
                                        type="text"
                                        placeholder={`Option ${idx + 1}`}
                                        maxLength={100}
                                        value={opt}
                                        onChange={e =>
                                            updateOption(idx, e.target.value)
                                        }
                                    />
                                    {options.length > 2 && (
                                        <button
                                            type="button"
                                            className="sync-icon-btn xs danger"
                                            onClick={() => removeOption(idx)}
                                            aria-label="Remove option"
                                        >
                                            <Trash2 size={15} />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                        {options.length < 6 && (
                            <button
                                type="button"
                                className="sync-btn secondary xs mt-2"
                                onClick={addOption}
                            >
                                <Plus size={14} /> Add Option
                            </button>
                        )}
                    </div>

                    <label className="sync-checkbox-row">
                        <input
                            type="checkbox"
                            checked={allowMultiple}
                            onChange={e => setAllowMultiple(e.target.checked)}
                        />
                        <span>Allow multiple answers</span>
                    </label>

                    {error && <div className="sync-alert error">{error}</div>}

                    <div className="sync-modal-footer">
                        <button
                            type="button"
                            className="sync-btn ghost"
                            onClick={onClose}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="sync-btn primary"
                            disabled={submitting}
                        >
                            {submitting ? "Sending..." : "Send Poll"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
