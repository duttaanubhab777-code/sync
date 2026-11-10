// Contact form -> Email Sender
// Key বদলাতে চাইলে এখানে অথবা frontend/.env-এ VITE_EMAIL_SENDER_KEY দিলেই হবে।
// (এই key সব form-service-এর মতোই browser-এ দেখা যায়; এটা শুধু মেইল পাঠানোর অনুমতি, গোপন secret নয়)
export const EMAIL_SENDER_BASE = "https://email-sender-wy5o.onrender.com";
export const EMAIL_SENDER_SEND_URL = `${EMAIL_SENDER_BASE}/api/v1/mail/send`;
export const EMAIL_SENDER_PING_URL = `${EMAIL_SENDER_BASE}/api/v1/mail/ping`;

export const EMAIL_SENDER_KEY =
    import.meta.env.VITE_EMAIL_SENDER_KEY ||
    "Anubhab_email_sndr_096305c3faa26c2aa6c247d671f391ba";

// Email Sender ব্যাজ লোগো (প্রথমটা না এলে fallback)
export const EMAIL_SENDER_LOGO =
    "https://res.cloudinary.com/khvkgpxq/image/upload/v1791965885/badge-logo-320.png";
export const EMAIL_SENDER_LOGO_FALLBACK =
    "https://res.cloudinary.com/khvkgpxq/image/upload/w_64,h_64,c_fit,f_auto,q_auto/v1791551108/badge-logo.png";
