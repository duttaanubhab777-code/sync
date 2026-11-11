import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useSelector } from "react-redux";
import {
    ArrowLeft,
    LogIn,
    UserPlus,
    MessageCircle,
    UserRound,
    Mail,
    Tag,
    MessageSquareText,
    Send,
    ShieldCheck,
    RefreshCw,
    CircleAlert,
    Power,
    Handshake
} from "lucide-react";
import {
    EMAIL_SENDER_BASE,
    EMAIL_SENDER_LOGO,
    EMAIL_SENDER_LOGO_FALLBACK
} from "../config/contact.js";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import useSignOut from "../hooks/useSignOut.js";
import {
    contactErrorMessage,
    flushContactOutbox,
    sendContactMessage,
    warmEmailSender
} from "../services/contactMail.js";

const MAX_MESSAGE = 1000;
const SPARKS = [0, 45, 90, 135, 180, 225, 270, 315];

// Email Sender লোগো: প্রথম URL → fallback URL → ইনলাইন SVG
function EmailSenderMark({ size = 88 }) {
    const [stage, setStage] = useState(0);
    if (stage >= 2) {
        return (
            <svg className="sync-es-fallback" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 11.5 21 4l-7.5 17-2.4-7.1L3 11.5z" />
            </svg>
        );
    }
    return (
        <img
            src={stage === 0 ? EMAIL_SENDER_LOGO : EMAIL_SENDER_LOGO_FALLBACK}
            alt="Email Sender"
            width={size}
            height={size}
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setStage(s => s + 1)}
        />
    );
}

export default function ContactPage() {
    const { user, isAuthenticated } = useSelector(state => state.auth);

    const [values, setValues] = useState({
        name: user?.fullName || "",
        email: user?.email || "",
        subject: "",
        message: "",
        botcheck: ""
    });
    const [touched, setTouched] = useState({});
    const [busy, setBusy] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState("");
    const doneRef = useRef(null);
    const signOut = useSignOut();
    const [confirmLogout, setConfirmLogout] = useState(false);
    const [loggingOut, setLoggingOut] = useState(false);

    const handleConfirmLogout = async () => {
        setLoggingOut(true);
        await signOut();
    };

    // আগের না-যাওয়া মেসেজ আবার পাঠানো (ট্যাব বন্ধ/অফলাইন থাকলে)
    useEffect(() => {
        flushContactOutbox();
    }, []);

    // লগইন করা ইউজারের নাম ও ইমেইল নিজে থেকে বসে যায় (ফাঁকা থাকলেই)
    useEffect(() => {
        if (!user) return;
        setValues(v => ({
            ...v,
            name: v.name || user.fullName || "",
            email: v.email || user.email || ""
        }));
    }, [user]);

    useEffect(() => {
        if (sent) doneRef.current?.focus();
    }, [sent]);

    const set = key => e => {
        const value = e.target.value;
        setValues(v => ({ ...v, [key]: value }));
    };
    const touch = key => () => setTouched(t => ({ ...t, [key]: true }));
    const fieldClass = key =>
        `sync-cf-field ${touched[key] ? "is-touched" : ""}`;

    const handleSubmit = async e => {
        e.preventDefault();
        setTouched({ name: true, email: true, subject: true, message: true });
        if (!e.currentTarget.checkValidity()) return;
        setError("");
        setBusy(true);
        const r = await sendContactMessage({
            name: values.name.trim(),
            email: values.email.trim(),
            subject: values.subject.trim(),
            message: values.message.trim(),
            botcheck: values.botcheck
        });
        setBusy(false);
        if (r.ok) {
            setValues(v => ({ ...v, subject: "", message: "" }));
            setTouched({});
            setSent(true);
        } else {
            setError(contactErrorMessage(r));
        }
    };

    const used = values.message.length;
    const ratio = Math.min(used / MAX_MESSAGE, 1);

    return (
        <div className="sync-contact-page">
            <div className="sync-contact-aurora" aria-hidden="true">
                <i />
                <i />
                <i />
            </div>
            <div className="sync-contact-dust" aria-hidden="true">
                {Array.from({ length: 8 }, (_, n) => (
                    <i key={n} />
                ))}
            </div>

            <header className="sync-contact-nav">
                <Link
                    to={isAuthenticated ? "/chats" : "/login"}
                    className="sync-contact-back"
                    aria-label={isAuthenticated ? "Back to chats" : "Back to sign in"}
                >
                    <ArrowLeft size={18} />
                </Link>
                <Link to="/" className="sync-contact-brand">
                    <img
                        src="/logo-mark.webp"
                        width="34"
                        height="34"
                        alt=""
                        draggable="false"
                    />
                    <span>Sync</span>
                </Link>
                <nav className="sync-contact-nav-links" aria-label="Account">
                    {isAuthenticated ? (
                        <>
                            <Link to="/chats" className="sync-contact-pill">
                                <MessageCircle size={15} />
                                <span>Open Sync</span>
                            </Link>
                            <button
                                type="button"
                                className="sync-contact-pill sync-contact-logout"
                                onClick={() => setConfirmLogout(true)}
                                aria-label="Sign out of Sync"
                            >
                                <Power size={15} />
                                <span>Logout</span>
                            </button>
                        </>
                    ) : (
                        <>
                            <Link to="/login" className="sync-contact-pill">
                                <LogIn size={15} />
                                <span>Sign in</span>
                            </Link>
                            <Link
                                to="/register"
                                className="sync-contact-pill solid"
                            >
                                <UserPlus size={15} />
                                <span>Join</span>
                            </Link>
                        </>
                    )}
                </nav>
            </header>

            <main className="sync-contact-main">
                <form
                    className={`sync-contact-card ${busy ? "is-busy" : ""} ${
                        sent ? "is-sent" : ""
                    }`}
                    onSubmit={handleSubmit}
                    onFocus={warmEmailSender}
                    onPointerDown={warmEmailSender}
                    noValidate={false}
                >
                    <span className="sync-contact-bar" aria-hidden="true">
                        <i />
                    </span>

                    <div className="sync-contact-head">
                        <div className="sync-collab" aria-hidden="true">
                            <span className="sync-collab-tile sync">
                                <img
                                    src="/logo-mark.webp"
                                    width="88"
                                    height="88"
                                    alt=""
                                    draggable="false"
                                />
                            </span>
                            <span className="sync-collab-link" title="Collaboration">
                                <Handshake size={25} strokeWidth={2.1} />
                            </span>
                            <span className="sync-collab-tile es">
                                <EmailSenderMark />
                            </span>
                        </div>
                        <p className="sync-collab-names">
                            <span className="a">Sync</span>
                            <b>+</b>
                            <span className="e">
                                <span className="blue">Email</span> Sender
                            </span>
                        </p>
                        <h1>Get in touch</h1>
                        <p className="sync-contact-sub">
                            Questions, feedback or a bug to report? Send us a
                            message and we will reply soon.
                        </p>
                    </div>

                    {!sent && (
                        <div className="sync-contact-body">
                            <input
                                type="text"
                                name="botcheck"
                                className="sync-cf-hp"
                                tabIndex={-1}
                                autoComplete="off"
                                aria-hidden="true"
                                value={values.botcheck}
                                onChange={set("botcheck")}
                            />

                            <div
                                className={fieldClass("name")}
                                style={{ "--d": "0.18s" }}
                            >
                                <label htmlFor="cf-name">Name</label>
                                <div className="sync-cf-ctl">
                                    <UserRound size={18} />
                                    <input
                                        id="cf-name"
                                        type="text"
                                        name="name"
                                        placeholder="Your name"
                                        autoComplete="name"
                                        maxLength={80}
                                        value={values.name}
                                        onChange={set("name")}
                                        onBlur={touch("name")}
                                        required
                                    />
                                    <small>Please enter your name</small>
                                </div>
                            </div>

                            <div
                                className={fieldClass("email")}
                                style={{ "--d": "0.25s" }}
                            >
                                <label htmlFor="cf-email">Email</label>
                                <div className="sync-cf-ctl">
                                    <Mail size={18} />
                                    <input
                                        id="cf-email"
                                        type="email"
                                        name="email"
                                        placeholder="you@example.com"
                                        autoComplete="email"
                                        maxLength={120}
                                        value={values.email}
                                        onChange={set("email")}
                                        onBlur={touch("email")}
                                        required
                                    />
                                    <small>Enter a valid email address</small>
                                </div>
                            </div>

                            <div
                                className={fieldClass("subject")}
                                style={{ "--d": "0.32s" }}
                            >
                                <label htmlFor="cf-subject">Subject</label>
                                <div className="sync-cf-ctl">
                                    <Tag size={18} />
                                    <input
                                        id="cf-subject"
                                        type="text"
                                        name="subject"
                                        placeholder="How can we help?"
                                        maxLength={120}
                                        value={values.subject}
                                        onChange={set("subject")}
                                        onBlur={touch("subject")}
                                        required
                                    />
                                    <small>Add a short subject</small>
                                </div>
                            </div>

                            <div
                                className={fieldClass("message")}
                                style={{ "--d": "0.39s" }}
                            >
                                <label htmlFor="cf-message">
                                    <span>Message</span>
                                    <span className="sync-cf-count">
                                        {used} / {MAX_MESSAGE}
                                    </span>
                                </label>
                                <div className="sync-cf-ctl ta">
                                    <MessageSquareText size={18} />
                                    <textarea
                                        id="cf-message"
                                        name="message"
                                        rows={5}
                                        maxLength={MAX_MESSAGE}
                                        placeholder="Write your message..."
                                        value={values.message}
                                        onChange={set("message")}
                                        onBlur={touch("message")}
                                        required
                                    />
                                    <small>Write a few words</small>
                                </div>
                                <span className="sync-cf-meter" aria-hidden="true">
                                    <i style={{ transform: `scaleX(${ratio})` }} />
                                </span>
                            </div>

                            {error && (
                                <p className="sync-cf-error" role="alert">
                                    <CircleAlert size={16} />
                                    <span>{error}</span>
                                </p>
                            )}

                            <button
                                type="submit"
                                className="sync-cf-send"
                                disabled={busy}
                            >
                                <span className="sync-cf-send-text">
                                    {busy ? "Sending..." : "Send message"}
                                </span>
                                <Send size={19} className="sync-cf-plane" />
                            </button>
                        </div>
                    )}

                    {sent && (
                        <div
                            className="sync-cf-done"
                            role="status"
                            aria-live="polite"
                            tabIndex={-1}
                            ref={doneRef}
                        >
                            <div className="sync-cf-sparks" aria-hidden="true">
                                {SPARKS.map(a => (
                                    <i key={a} style={{ "--a": `${a}deg` }} />
                                ))}
                            </div>
                            <svg
                                className="sync-cf-tick"
                                viewBox="0 0 52 52"
                                aria-hidden="true"
                            >
                                <circle cx="26" cy="26" r="23" />
                                <path d="M15 27l8 8 14-16" />
                            </svg>
                            <h3>Message sent!</h3>
                            <p>
                                Thank you for reaching out. We will get back to
                                you soon.
                            </p>
                            <button
                                type="button"
                                className="sync-cf-again"
                                onClick={() => setSent(false)}
                            >
                                Send another message
                            </button>
                        </div>
                    )}

                    <a
                        className="sync-cf-badge"
                        href={EMAIL_SENDER_BASE}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        <span>Powered by</span>
                        <EmailSenderMark size={34} />
                        <b>
                            <span className="blue">Email</span>{" "}
                            <span className="orange">Sender</span>
                        </b>
                    </a>

                    <p className="sync-collab-note">
                        <span className="sync-collab-note-icon">
                            <Handshake size={15} />
                        </span>
                        <span>
                            A little collaboration, a better connection.
                            {" "}
                            <a
                                href={EMAIL_SENDER_BASE}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                Sync × Email Sender
                            </a>
                            {" "}— keeping your messages moving.
                        </span>
                    </p>
                </form>

                <ul className="sync-contact-assure">
                    <li>
                        <ShieldCheck size={15} />
                        <span>Spam-protected</span>
                    </li>
                    <li>
                        <RefreshCw size={15} />
                        <span>Retries automatically if you go offline</span>
                    </li>
                </ul>
            </main>

            {confirmLogout && (
                <ConfirmDialog
                    icon={Power}
                    title="Sign out of Sync?"
                    message="You will need to sign in again to read your chats and stories."
                    confirmLabel="Sign out"
                    busy={loggingOut}
                    onConfirm={handleConfirmLogout}
                    onCancel={() => setConfirmLogout(false)}
                />
            )}
        </div>
    );
}
