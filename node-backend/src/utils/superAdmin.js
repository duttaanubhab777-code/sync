// Super Admin-দের তালিকা শুধু .env থেকে আসে (ডাটাবেস বা কোনো API দিয়ে বদলানো যায় না)।
// SUPER_ADMIN_EMAILS=a@gmail.com,b@gmail.com
// আগের একক SUPER_ADMIN_EMAIL-ও চলবে, দুটো থাকলে দুটোই ধরা হয়।

export const getSuperAdminEmails = () => {
    const raw = [process.env.SUPER_ADMIN_EMAILS, process.env.SUPER_ADMIN_EMAIL]
        .filter(Boolean)
        .join(",");
    return [
        ...new Set(
            raw
                .split(/[,;\s]+/)
                .map(e => e.trim().toLowerCase())
                .filter(Boolean)
        )
    ];
};

export const isSuperAdminEmail = email =>
    Boolean(email) &&
    getSuperAdminEmails().includes(String(email).trim().toLowerCase());
