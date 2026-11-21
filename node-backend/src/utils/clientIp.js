import net from "node:net";

// Render (এবং Cloudflare) এর পেছনে একাধিক proxy থাকে, তাই req.ip প্রায়ই ভেতরের কোনো
// private hop (10.x.x.x) হয়ে যায়। এখানে আসল ক্লায়েন্টের public IP খুঁজে বের করা হয়।

// "::ffff:1.2.3.4" -> "1.2.3.4", port/ফাঁকা জায়গা বাদ
export const normalizeIp = raw => {
    let ip = String(raw ?? "").trim();
    if (!ip) return "";
    ip = ip.replace(/^::ffff:/i, "");
    // "1.2.3.4:5678" (IPv4 + port)
    if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ip)) ip = ip.split(":")[0];
    // "[2001:db8::1]:443"
    const br = ip.match(/^\[([^\]]+)\](?::\d+)?$/);
    if (br) ip = br[1];
    return net.isIP(ip) ? ip : "";
};

// private / loopback / link-local / CGNAT হলে true (এগুলো কারও আসল public IP নয়)
export const isPrivateIp = ip => {
    if (net.isIPv4(ip)) {
        const [a, b] = ip.split(".").map(Number);
        return (
            a === 10 ||
            a === 127 ||
            a === 0 ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168) ||
            (a === 169 && b === 254) ||
            (a === 100 && b >= 64 && b <= 127)
        );
    }
    if (net.isIPv6(ip)) {
        const v = ip.toLowerCase();
        return (
            v === "::1" ||
            v === "::" ||
            v.startsWith("fc") ||
            v.startsWith("fd") ||
            /^fe[89ab]/.test(v)
        );
    }
    return true;
};

const header = (req, name) => {
    const v = req.headers?.[name];
    return Array.isArray(v) ? v[0] : v;
};

// ক্লায়েন্টের আসল IP:
//  ১) Cloudflare / Render-এর বসানো হেডার (cf-connecting-ip, true-client-ip)
//  ২) x-real-ip
//  ৩) x-forwarded-for এর প্রথম public IP
//  ৪) না পেলে req.ip (লোকাল ডেভেলপমেন্টে এটাই আসে)
export const getClientIp = req => {
    for (const name of ["cf-connecting-ip", "true-client-ip", "x-real-ip"]) {
        const ip = normalizeIp(header(req, name));
        if (ip && !isPrivateIp(ip)) return ip;
    }

    const xff = String(header(req, "x-forwarded-for") || "")
        .split(",")
        .map(normalizeIp)
        .filter(Boolean);
    const publicHop = xff.find(ip => !isPrivateIp(ip));
    if (publicHop) return publicHop;

    return (
        normalizeIp(req.ip) ||
        normalizeIp(req.socket?.remoteAddress) ||
        xff[0] ||
        null
    );
};
