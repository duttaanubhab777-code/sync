import React, { useState } from "react";
import { Phone, Copy, Check } from "lucide-react";
import { getAvatarTone, getInitials } from "../../utils/format.js";

const buildTelHref = phone => {
    const clean = String(phone || "").replace(/[^\d+]/g, "");
    return clean ? `tel:${clean}` : "";
};

export default function ContactCard({ contact }) {
    const [copiedPhone, setCopiedPhone] = useState("");

    if (!contact?.name || !Array.isArray(contact.phones) || contact.phones.length === 0) {
        return null;
    }

    const tone = getAvatarTone(contact.name);
    const initials = getInitials(contact.name);

    const handleCopy = async (e, phone) => {
        e.stopPropagation();
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(phone);
            } else {
                const ta = document.createElement("textarea");
                ta.value = phone;
                ta.setAttribute("readonly", "");
                ta.style.position = "fixed";
                ta.style.opacity = "0";
                document.body.appendChild(ta);
                ta.select();
                document.execCommand("copy");
                document.body.removeChild(ta);
            }
            setCopiedPhone(phone);
            setTimeout(() => {
                setCopiedPhone(cur => (cur === phone ? "" : cur));
            }, 1800);
        } catch {
            // ignore clipboard failure
        }
    };

    return (
        <div className="sync-cmsg-card">
            <div className="sync-cmsg-head">
                <div className={`sync-contact-avatar tone-${tone}`} aria-hidden="true">
                    {initials}
                </div>
                <div className="sync-contact-meta">
                    <strong className="sync-contact-name">{contact.name}</strong>
                    <span className="sync-cmsg-sub">
                        {contact.phones.length === 1
                            ? "Contact card"
                            : `${contact.phones.length} phone numbers`}
                    </span>
                </div>
            </div>

            <div className="sync-contact-phones">
                {contact.phones.map(phone => {
                    const telHref = buildTelHref(phone);
                    const isCopied = copiedPhone === phone;
                    return (
                        <div className="sync-contact-phone-row" key={phone}>
                            <span className="sync-contact-number">{phone}</span>
                            <div className="sync-contact-actions">
                                <button
                                    type="button"
                                    className={`sync-contact-act ${isCopied ? "copied" : ""}`}
                                    title={isCopied ? "Copied" : "Copy number"}
                                    aria-label={`Copy ${phone}`}
                                    onClick={e => handleCopy(e, phone)}
                                >
                                    {isCopied ? <Check size={14} /> : <Copy size={14} />}
                                    <span>{isCopied ? "Copied" : "Copy"}</span>
                                </button>
                                {telHref && (
                                    <a
                                        href={telHref}
                                        className="sync-contact-act call"
                                        title={`Call ${contact.name}`}
                                        aria-label={`Call ${phone}`}
                                        onClick={e => e.stopPropagation()}
                                    >
                                        <Phone size={14} />
                                        <span>Call</span>
                                    </a>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
