import React, { useMemo, useState } from "react";
import { Check, ChevronRight, Users } from "lucide-react";
import PollIcon from "./PollIcon.jsx";
import Avatar from "../Avatar.jsx";
import PollVotersSheet from "./PollVoters.jsx";
import { buildMemberMap, resolvePerson } from "./people.js";

/**
 * গ্রুপ পোলের রিয়েল-টাইম ভোটিং কার্ড
 * — প্রতিটি অপশনে ভোটারদের ছোট অবতার, আর নিচে "View votes" দিয়ে পূর্ণ তালিকা
 */
export default function PollCard({
    poll,
    myId,
    members = [],
    disabled = false,
    onVote
}) {
    const [busyId, setBusyId] = useState(null);
    const [showVoters, setShowVoters] = useState(false);
    const map = useMemo(() => buildMemberMap(members), [members]);
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
                    <PollIcon size={16} /> Poll
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
                    const faces = votes
                        .slice(0, 3)
                        .map(v => resolvePerson(v, map, myId));

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
                                {faces.length > 0 && (
                                    <span className="sync-poll-faces">
                                        {faces.map(p => (
                                            <span
                                                className="sync-poll-face"
                                                key={p.id}
                                                title={p.name}
                                            >
                                                <Avatar
                                                    src={p.avatar}
                                                    name={p.name}
                                                    size={20}
                                                />
                                            </span>
                                        ))}
                                        {count > faces.length && (
                                            <span className="sync-poll-face more">
                                                +{count - faces.length}
                                            </span>
                                        )}
                                    </span>
                                )}
                                <span className="sync-poll-count">
                                    {count > 0 ? `${count} (${pct}%)` : "0"}
                                </span>
                            </span>
                        </button>
                    );
                })}
            </div>

            <button
                type="button"
                className="sync-poll-footer sync-poll-footer-btn"
                disabled={totalVotes === 0}
                onClick={e => {
                    e.stopPropagation();
                    setShowVoters(true);
                }}
            >
                <Users size={14} />
                <span>
                    {totalVotes === 0
                        ? "No votes yet — tap an option to vote"
                        : `${totalVotes} vote${totalVotes === 1 ? "" : "s"}`}
                </span>
                {totalVotes > 0 && (
                    <span className="sync-poll-viewvotes">
                        View votes <ChevronRight size={14} />
                    </span>
                )}
            </button>

            {showVoters && (
                <PollVotersSheet
                    poll={poll}
                    members={members}
                    myId={myId}
                    onClose={() => setShowVoters(false)}
                />
            )}
        </div>
    );
}
