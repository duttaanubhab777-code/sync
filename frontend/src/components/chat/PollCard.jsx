import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronRight, Users } from "lucide-react";
import PollIcon from "./PollIcon.jsx";
import Avatar from "../Avatar.jsx";
import PollVotersSheet from "./PollVoters.jsx";
import { buildMemberMap, resolvePerson } from "./people.js";

// লোকালি সাথে সাথে ভোটের অবস্থা আপডেট করা (0ms রেসপন্স, সার্ভারের উত্তরের জন্য অপেক্ষা নয়)
function applyLocalVote(poll, optionId, myId) {
    if (!poll || !Array.isArray(poll.options) || !myId) return poll;
    const me = String(myId);
    const target = poll.options.find(o => o.id === optionId);
    if (!target) return poll;
    const already = (target.votes || []).some(v => String(v) === me);

    return {
        ...poll,
        options: poll.options.map(opt => {
            const votes = (opt.votes || []).map(String);
            if (opt.id === optionId) {
                return {
                    ...opt,
                    votes: already
                        ? votes.filter(v => v !== me)
                        : [...votes, me]
                };
            }
            if (!already && !poll.allowMultiple) {
                return {
                    ...opt,
                    votes: votes.filter(v => v !== me)
                };
            }
            return opt;
        })
    };
}

/**
 * গ্রুপ পোলের রিয়েল-টাইম ভোটিং কার্ড
 * — ট্যাপ করা মাত্রই 0ms-এ অপশন, বার ও কাউন্ট আপডেট হয় (optimistic UI)
 * — প্রতিটি অপশনে ভোটারদের ছোট অবতার, আর নিচে "View votes" দিয়ে পূর্ণ তালিকা
 */
export default function PollCard({
    poll,
    myId,
    members = [],
    disabled = false,
    onVote
}) {
    const [optimisticPoll, setOptimisticPoll] = useState(null);
    const [showVoters, setShowVoters] = useState(false);
    const inflightRef = useRef(0);
    const map = useMemo(() => buildMemberMap(members), [members]);

    // সার্ভার থেকে নতুন poll এলে এবং কোনো লোকাল ভোট পেন্ডিং না থাকলে সিঙ্ক করা
    useEffect(() => {
        if (inflightRef.current === 0) {
            setOptimisticPoll(null);
        }
    }, [poll]);

    const shownPoll = optimisticPoll || poll;
    if (!shownPoll || !Array.isArray(shownPoll.options)) return null;

    const totalVotes = shownPoll.options.reduce(
        (sum, opt) => sum + (opt.votes?.length || 0),
        0
    );

    const handleClick = optionId => {
        if (disabled) return;
        const base = optimisticPoll || poll;
        const next = applyLocalVote(base, optionId, myId);
        setOptimisticPoll(next);

        inflightRef.current += 1;
        Promise.resolve(onVote?.(optionId))
            .then(ack => {
                inflightRef.current = Math.max(0, inflightRef.current - 1);
                if (inflightRef.current === 0) {
                    // সার্ভার ব্যর্থ হলে আগের আসল অবস্থায় ফিরে যাওয়া; সফল হলে সার্ভারের ডেটা বসবে
                    if (ack && ack.ok === false) {
                        setOptimisticPoll(null);
                    } else if (ack?.poll) {
                        setOptimisticPoll(null);
                    }
                }
            })
            .catch(() => {
                inflightRef.current = Math.max(0, inflightRef.current - 1);
                if (inflightRef.current === 0) {
                    setOptimisticPoll(null);
                }
            });
    };

    return (
        <div className="sync-poll-card">
            <div className="sync-poll-header">
                <span className="sync-poll-badge">
                    <PollIcon size={16} /> Poll
                </span>
                <span className="sync-poll-mode">
                    {shownPoll.allowMultiple ? "Multiple choice" : "Single choice"}
                </span>
            </div>

            <div className="sync-poll-question">{shownPoll.question}</div>

            <div className="sync-poll-options">
                {shownPoll.options.map(opt => {
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
                            disabled={disabled}
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
                    poll={shownPoll}
                    members={members}
                    myId={myId}
                    onClose={() => setShowVoters(false)}
                />
            )}
        </div>
    );
}
