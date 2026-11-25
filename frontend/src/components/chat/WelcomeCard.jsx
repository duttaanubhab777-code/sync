import React from "react";
import { MessageCircle, Image, Sparkles, Bell } from "lucide-react";
import VerifiedBadge from "../VerifiedBadge.jsx";

const HIGHLIGHTS = [
    {
        icon: MessageCircle,
        tone: "emerald",
        title: "Real-time chats",
        desc: "1-to-1 & group messaging"
    },
    {
        icon: Image,
        tone: "sky",
        title: "Rich media",
        desc: "Photos, videos, voice & files"
    },
    {
        icon: Sparkles,
        tone: "violet",
        title: "24h Stories",
        desc: "Share moments that fade"
    },
    {
        icon: Bell,
        tone: "amber",
        title: "Instant alerts",
        desc: "Never miss a message"
    }
];

const getFirstName = name =>
    String(name || "")
        .trim()
        .split(/\s+/)[0] || "there";

/**
 * নতুন ইউজারের জন্য Sync অফিশিয়াল অ্যাকাউন্ট থেকে পাঠানো ওয়েলকাম মেসেজ কার্ড প্যালেট
 */
export default function WelcomeCard({ name = "" }) {
    const firstName = getFirstName(name);

    return (
        <div className="sync-welcome-card">
            <div className="sync-welcome-hero">
                <div className="sync-welcome-brand-row">
                    <div className="sync-welcome-logo-wrap">
                        <img
                            src="/logo-mark.webp"
                            alt="Sync"
                            width="34"
                            height="34"
                            draggable="false"
                        />
                    </div>
                    <div className="sync-welcome-brand-meta">
                        <div className="sync-welcome-brand-name">
                            <span>Sync</span>
                            <VerifiedBadge variant="official" size={16} />
                        </div>
                        <span className="sync-welcome-brand-tag">
                            Official Account
                        </span>
                    </div>
                </div>

                <h4 className="sync-welcome-greeting">
                    Hello {firstName}!
                </h4>
                <p className="sync-welcome-lead">
                    Welcome to <strong>Sync</strong> — we&apos;re so happy
                    you&apos;re here. Everything you need to stay connected is
                    ready to go.
                </p>
            </div>

            <div className="sync-welcome-palette">
                {HIGHLIGHTS.map(item => {
                    const Icon = item.icon;
                    return (
                        <div
                            key={item.title}
                            className={`sync-welcome-tile tone-${item.tone}`}
                        >
                            <span className="sync-welcome-tile-icon">
                                <Icon size={15} />
                            </span>
                            <div className="sync-welcome-tile-text">
                                <strong>{item.title}</strong>
                                <span>{item.desc}</span>
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="sync-welcome-footer">
                <p>
                    Say hi in the <strong>Sync</strong> community group and make
                    yourself at home.
                </p>
                <span className="sync-welcome-signoff">— Team Sync</span>
            </div>
        </div>
    );
}
