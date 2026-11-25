import React, { useState } from "react";
import { BarChart2, Check } from "lucide-react";

/**
 * গ্রুপ পোলের রিয়েল-টাইম ভোটিং কার্ড
 */
export default function PollCard({ poll, myId, disabled = false, onVote }) {
    const [busyId, setBusyId] = useState(null);
    if (!poll || !Array.isArray(poll.options)) return null;

    const totalVotes = poll.options.reduce(
        (sum, opt) => sum + (opt.votes?.length || 0),
        0
    );

    const handleClick = async optionId => {
        if (disabled || busyId) return;
        setBusyId(optionId);
        try {
            await onVote?.(optionId);
        } finally {
            setBusyId(null);
        }
    };

    return (
        <div className="sync-poll-card">
            <div className="sync-poll-header">
                <span className="sync-poll-badge">
                    <BarChart2 size={13} /> Poll
                </span>
                <span className="sync-poll-mode">
                    {poll.allowMultiple ? "Multiple choice" : "Single choice"}
                </span>
            </div>

            <div className="sync-poll-question">{poll.question}</div>

            <div className="sync-poll-options">
                {poll.options.map(opt => {
                    const votes = opt.votes || [];
                    const count = votes.length;
                    const pct =
                        totalVotes > 0
                            ? Math.round((count / totalVotes) * 100)
                            : 0;
                    const voted = votes.some(v => String(v) === String(myId));

                    return (
                        <button
                            key={opt.id}
                            type="button"
                            className={`sync-poll-opt ${voted ? "voted" : ""}`}
                            disabled={disabled || busyId === opt.id}
                            onClick={e => {
                                e.stopPropagation();
                                handleClick(opt.id);
                            }}
                        >
                            <span
                                className="sync-poll-bar"
                                style={{ width: `${pct}%` }}
                            />
                            <span className="sync-poll-opt-main">
                                <span
                                    className={`sync-poll-check ${
                                        voted ? "checked" : ""
                                    }`}
                                >
                                    {voted && <Check size={11} strokeWidth={3} />}
                                </span>
                                <span className="sync-poll-opt-text">
                                    {opt.text}
                                </span>
                            </span>
                            <span className="sync-poll-opt-meta">
                                {count > 0 ? `${count} (${pct}%)` : "0"}
                            </span>
                        </button>
                    );
                })}
            </div>

            <div className="sync-poll-footer">
                {totalVotes === 0
                    ? "No votes yet — tap an option to vote"
                    : `${totalVotes} vote${totalVotes === 1 ? "" : "s"}`}
            </div>
        </div>
    );
}
