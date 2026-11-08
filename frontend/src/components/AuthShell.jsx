import React from "react";
import { Zap, ShieldCheck, Users, Loader2 } from "lucide-react";
import SyncLogo from "./SyncLogo.jsx";
import BrandTyping from "./BrandTyping.jsx";

// লগইন ও রেজিস্টার দুই পেজেরই কমন লেআউট:
// ডেস্কটপে বাঁয়ে ব্র্যান্ড হিরো, ডানে ফর্ম কার্ড। মোবাইলে ছোট ব্র্যান্ড + কার্ড।
export default function AuthShell({ serverWaking = false, children }) {
    return (
        <div className="sync-auth-page">
            <div className="sync-auth-aurora" aria-hidden="true" />

            <aside className="sync-auth-hero">
                <div className="sync-auth-hero-inner">
                    <div className="sync-hero-art">
                        <span className="sync-orbit o1" aria-hidden="true" />
                        <span className="sync-orbit o2" aria-hidden="true" />
                        <SyncLogo size="hero" glow />
                    </div>
                    <p className="sync-hero-title sync-wordmark">Sync</p>
                    <BrandTyping />

                    <ul className="sync-hero-features">
                        <li>
                            <span>
                                <Zap size={20} />
                            </span>
                            <div>
                                <strong>Instant delivery</strong>
                                <small>
                                    Messages reach every device the moment you
                                    send them.
                                </small>
                            </div>
                        </li>
                        <li>
                            <span>
                                <ShieldCheck size={20} />
                            </span>
                            <div>
                                <strong>Private by design</strong>
                                <small>
                                    Secure sign-in with protected sessions.
                                </small>
                            </div>
                        </li>
                        <li>
                            <span>
                                <Users size={20} />
                            </span>
                            <div>
                                <strong>Chats, groups and stories</strong>
                                <small>
                                    Everything you share, together in one place.
                                </small>
                            </div>
                        </li>
                    </ul>
                </div>
            </aside>

            <main className="sync-auth-panel">
                {serverWaking && (
                    <div className="sync-top-banner waking">
                        <Loader2 size={16} className="spin" />
                        <span>Starting the server. This may take a few moments...</span>
                    </div>
                )}
                <div className="sync-auth-card">{children}</div>
            </main>
        </div>
    );
}
