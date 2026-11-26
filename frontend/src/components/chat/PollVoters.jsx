import React, { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import Avatar from "../Avatar.jsx";
import PollIcon from "./PollIcon.jsx";
import { buildMemberMap, resolvePerson } from "./people.js";
import { pushBackHandler } from "../../services/backNavigation.js";

/** কোন অপশনে কে ভোট দিয়েছে — অপশন অনুযায়ী গ্রুপ করা তালিকা */
export function PollVotersList({ poll, members, myId }) {
    const map = useMemo(() => buildMemberMap(members), [members]);
    const total = (poll?.options || []).reduce(
        (n, o) => n + (o.votes?.length || 0),
        0
    );

    return (
        <div className="sync-voters">
            {(poll?.options || []).map(opt => {
                const votes = opt.votes || [];
                const pct = total ? Math.round((votes.length / total) * 100) : 0;
                return (
                    <section className="sync-voters-group" key={opt.id}>
                        <header className="sync-voters-head">
                            <span className="sync-voters-opt">{opt.text}</span>
                            <span className="sync-voters-count">
                                {votes.length} · {pct}%
                            </span>
                        </header>
                        <div className="sync-voters-bar">
                            <i style={{ width: `${pct}%` }} />
                        </div>
                        {votes.length === 0 ? (
                            <div className="sync-voters-empty">No votes</div>
                        ) : (
                            votes.map(v => {
                                const p = resolvePerson(v, map, myId);
                                return (
                                    <div className="sync-voters-row" key={p.id}>
                                        <Avatar src={p.avatar} name={p.name} size={34} />
                                        <div className="sync-voters-meta">
                                            <strong>
                                                {p.isMe ? "You" : p.name}
                                            </strong>
                                            {p.username && !p.isMe && (
                                                <small>@{p.username}</small>
                                            )}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </section>
                );
            })}
        </div>
    );
}

/** পোল কার্ড থেকে খোলা স্বতন্ত্র ভোটার শিট */
export default function PollVotersSheet({ poll, members, myId, onClose }) {
    useEffect(() => {
        const off = pushBackHandler(() => {
            onClose?.();
            return true;
        });
        const onKey = e => e.key === "Escape" && onClose?.();
        window.addEventListener("keydown", onKey);
        return () => {
            off();
            window.removeEventListener("keydown", onKey);
        };
    }, [onClose]);

    return createPortal(
        <div
            className="sync-modal-backdrop sync-msgsheet-backdrop"
            role="presentation"
            onClick={() => onClose?.()}
        >
            <div
                className="sync-msgsheet sync-msgsheet-tall"
                role="dialog"
                aria-modal="true"
                aria-label="Poll votes"
                onClick={e => e.stopPropagation()}
            >
                <div className="sync-msgsheet-grip" />
                <div className="sync-sheet-title">
                    <PollIcon size={18} /> <span>Poll votes</span>
                    <button
                        type="button"
                        className="sync-sheet-close"
                        onClick={() => onClose?.()}
                        aria-label="Close"
                    >
                        <X size={18} />
                    </button>
                </div>
                <div className="sync-sheet-scroll">
                    <PollVotersList poll={poll} members={members} myId={myId} />
                </div>
            </div>
        </div>,
        document.body
    );
}
