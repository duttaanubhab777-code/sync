import React, { useState } from "react";
import { X, Plus, Trash2, Check, ListChecks } from "lucide-react";
import PollIcon from "./PollIcon.jsx";

/** Create a group poll with 2–6 answer options. */
export default function CreatePollModal({ onClose, onCreate }) {
    const [question, setQuestion] = useState("");
    const [options, setOptions] = useState(["", ""]);
    const [allowMultiple, setAllowMultiple] = useState(false);
    const [error, setError] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const updateOption = (idx, value) => setOptions(prev => prev.map((v, i) => i === idx ? value : v));
    const addOption = () => { if (options.length < 6) setOptions(prev => [...prev, ""]); };
    const removeOption = idx => { if (options.length > 2) setOptions(prev => prev.filter((_, i) => i !== idx)); };

    const handleSubmit = async e => {
        e.preventDefault();
        const cleanQ = question.trim();
        const cleanOpts = options.map(o => o.trim()).filter(Boolean);
        if (!cleanQ) return setError("Please enter a poll question");
        if (cleanOpts.length < 2) return setError("Add at least 2 options");
        if (new Set(cleanOpts.map(value => value.toLowerCase())).size !== cleanOpts.length) return setError("Each option must be different");
        setSubmitting(true);
        setError("");
        try {
            await onCreate?.({ question: cleanQ, options: cleanOpts, allowMultiple });
            onClose?.();
        } catch (err) {
            setError(err?.message || "Could not create poll");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="sync-modal-backdrop sync-poll-backdrop" onClick={onClose}>
            <section className="sync-modal-card sync-poll-create" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="sync-poll-title">
                <div className="sync-poll-create-glow" aria-hidden="true" />
                <header className="sync-poll-create-head">
                    <div className="sync-poll-create-mark"><PollIcon size={27} /></div>
                    <div className="sync-poll-create-heading">
                        <span className="sync-poll-eyebrow">GROUP ENGAGEMENT</span>
                        <h3 id="sync-poll-title">Create a poll</h3>
                        <p>Make a choice together with your group</p>
                    </div>
                    <button type="button" className="sync-icon-btn sync-poll-close" onClick={onClose} aria-label="Close poll creator"><X size={19} /></button>
                </header>

                <form className="sync-poll-create-body" onSubmit={handleSubmit}>
                    <div className="sync-poll-field-block">
                        <div className="sync-poll-field-label"><label htmlFor="sync-poll-question">Your question</label><span>{question.length}/200</span></div>
                        <div className="sync-poll-input-wrap question">
                            <ListChecks size={18} aria-hidden="true" />
                            <input id="sync-poll-question" type="text" placeholder="What would you like to ask?" maxLength={200} value={question} onChange={e => setQuestion(e.target.value)} autoFocus required />
                        </div>
                    </div>

                    <div className="sync-poll-field-block">
                        <div className="sync-poll-field-label"><label>Answer options</label><span>{options.length} of 6</span></div>
                        <div className="sync-poll-create-options">
                            {options.map((opt, idx) => (
                                <div key={idx} className="sync-poll-create-option">
                                    <span className="sync-poll-option-index">{String(idx + 1).padStart(2, "0")}</span>
                                    <input type="text" aria-label={`Option ${idx + 1}`} placeholder={`Add option ${idx + 1}`} maxLength={100} value={opt} onChange={e => updateOption(idx, e.target.value)} />
                                    {options.length > 2 && <button type="button" className="sync-poll-remove-option" onClick={() => removeOption(idx)} aria-label={`Remove option ${idx + 1}`}><Trash2 size={16} /></button>}
                                </div>
                            ))}
                        </div>
                        {options.length < 6 && <button type="button" className="sync-poll-add-option" onClick={addOption}><span><Plus size={17} /></span> Add another option <small>{6 - options.length} remaining</small></button>}
                    </div>

                    <button type="button" className={`sync-poll-multiple-toggle ${allowMultiple ? "enabled" : ""}`} aria-pressed={allowMultiple} onClick={() => setAllowMultiple(value => !value)}>
                        <span className="sync-poll-toggle-icon">{allowMultiple ? <Check size={16} /> : <span />}</span>
                        <span className="sync-poll-toggle-copy"><strong>Allow multiple answers</strong><small>{allowMultiple ? "Members can select more than one option" : "Members can select one option only"}</small></span>
                        <span className={`sync-poll-switch ${allowMultiple ? "on" : ""}`}><i /></span>
                    </button>

                    {error && <div className="sync-alert error sync-poll-error" role="alert">{error}</div>}
                    <footer className="sync-poll-create-footer">
                        <button type="button" className="sync-btn ghost" onClick={onClose} disabled={submitting}>Cancel</button>
                        <button type="submit" className="sync-poll-submit" disabled={submitting}><PollIcon size={18} />{submitting ? "Creating poll…" : "Create poll"}<span className="sync-poll-submit-shine" /></button>
                    </footer>
                </form>
            </section>
        </div>
    );
}
