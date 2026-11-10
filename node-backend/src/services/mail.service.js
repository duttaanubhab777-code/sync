// Render ফ্রি প্ল্যানে SMTP বন্ধ, তাই ইমেইল পাঠানোর কাজ PythonAnywhere-এর mail relay-কে দেওয়া হয়।
//   Node (Render) --POST /mail/send + X-Relay-Key--> Flask (PythonAnywhere) --Gmail SMTP--> ইউজার
// দরকারি .env: PYTHON_SERVICE_URL, MAIL_RELAY_SECRET (Python-এর config.py-র সাথে হুবহু এক)

// Python relay দুটো SMTP port চেষ্টা করে (প্রতিটায় ১২ সেকেন্ড), তাই এর চেয়ে বেশি অপেক্ষা
const RELAY_TIMEOUT_MS = 30_000;
// relay-র body সীমা ৮ KB, তাই HTML ছোট রাখতে হবে (test-এ এটা যাচাই করা আছে)
export const MAX_MAIL_HTML_BYTES = 6_000;

const isProd = () =>
    process.env.NODE_ENV === "production" || Boolean(process.env.RENDER);

export class MailRelayError extends Error {
    constructor(code, detail = "", status = 502) {
        super(`${code}${detail ? `: ${detail}` : ""}`);
        this.name = "MailRelayError";
        this.code = code;
        this.status = status;
    }
}

const relayBase = () =>
    String(process.env.PYTHON_SERVICE_URL || "")
        .trim()
        .replace(/\/+$/, "");

export const isMailRelayConfigured = () =>
    Boolean(relayBase() && process.env.MAIL_RELAY_SECRET);

const escapeHtml = s =>
    String(s ?? "").replace(
        /[&<>"']/g,
        c =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;"
            })[c]
    );

export const buildOtpEmail = ({ fullName, otp, minutes }) => {
    const name = escapeHtml(String(fullName || "there").split(" ")[0]);
    const code = escapeHtml(otp);
    const html =
        `<div style="font-family:Arial,Helvetica,sans-serif;background:#f4f6f8;padding:24px">` +
        `<div style="max-width:420px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px;color:#1f2933">` +
        `<h2 style="margin:0 0 12px;color:#0f766e">Sync</h2>` +
        `<p style="margin:0 0 16px">Hi ${name}, use this code to verify your email and finish creating your Sync account:</p>` +
        `<div style="font-size:32px;letter-spacing:8px;font-weight:bold;text-align:center;background:#ecfdf5;border-radius:8px;padding:14px 0;margin:0 0 16px">${code}</div>` +
        `<p style="margin:0 0 8px;font-size:14px">This code expires in ${minutes} minutes.</p>` +
        `<p style="margin:0;font-size:12px;color:#6b7280">If you did not try to sign up for Sync, you can safely ignore this email. Never share this code with anyone.</p>` +
        `</div></div>`;
    return { subject: `${otp} is your Sync verification code`, html };
};

// relay-এর JSON error-কে MailRelayError বানানো (secret বা পুরো body কখনো log হয় না)
const relayFailure = (status, body) => {
    const message = String(body?.message || "").slice(0, 200);
    if (status === 403)
        return new MailRelayError(
            "relay_forbidden",
            "MAIL_RELAY_SECRET Render আর PythonAnywhere-এ এক নয়",
            502
        );
    if (status === 503)
        return new MailRelayError(
            "relay_not_configured",
            "PythonAnywhere config.py-তে Gmail সেটিং নেই",
            503
        );
    if (status === 429)
        return new MailRelayError("relay_rate_limited", message, 429);
    return new MailRelayError(`relay_http_${status}`, message, 502);
};

export const sendMail = async ({ to, subject, html, fromName }) => {
    if (!isMailRelayConfigured()) {
        throw new MailRelayError(
            "not_configured",
            "PYTHON_SERVICE_URL / MAIL_RELAY_SECRET সেট করা নেই",
            503
        );
    }
    if (Buffer.byteLength(html, "utf8") > MAX_MAIL_HTML_BYTES) {
        throw new MailRelayError("mail_too_large", "", 500);
    }

    const url = `${relayBase()}/mail/send`;
    const init = {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Relay-Key": process.env.MAIL_RELAY_SECRET
        },
        body: JSON.stringify({ to, subject, html, fromName }),
        redirect: "error" // redirect হলে secret অন্য জায়গায় চলে যেতে পারে
    };

    // শুধু কানেকশন-ব্যর্থতায় একবার আবার চেষ্টা; timeout হলে আর না (ইউজারকে বেশিক্ষণ বসিয়ে রাখা হবে না)
    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const res = await fetch(url, {
                ...init,
                signal: AbortSignal.timeout(RELAY_TIMEOUT_MS)
            });
            const body = await res.json().catch(() => null);
            if (!res.ok) throw relayFailure(res.status, body);
            return body?.data ?? {};
        } catch (err) {
            if (err instanceof MailRelayError) throw err;
            if (err?.name === "TimeoutError" || err?.name === "AbortError") {
                throw new MailRelayError("relay_timeout", "", 504);
            }
            lastError = err;
        }
    }
    throw new MailRelayError(
        "relay_unreachable",
        String(lastError?.cause?.code || lastError?.message || "").slice(0, 120),
        502
    );
};

// signup OTP ইমেইল। লোকাল ডেভেলপমেন্টে relay না থাকলে OTP কনসোলে ছাপা হয় (প্রোডাকশনে কখনো না)।
export const sendOtpEmail = async ({ to, fullName, otp, minutes }) => {
    if (!isMailRelayConfigured() && !isProd()) {
        console.log(`[DEV][OTP] ${to} -> ${otp}  (mail relay not configured)`);
        return { dev: true };
    }
    const { subject, html } = buildOtpEmail({ fullName, otp, minutes });
    return sendMail({ to, subject, html, fromName: "Sync" });
};
