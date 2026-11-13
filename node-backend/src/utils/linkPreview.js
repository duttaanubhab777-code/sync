// WhatsApp-এর মত link preview: URL-এর পেজ থেকে title / description / image (Open Graph) বের করে।
// সার্ভার অন্যের দেওয়া URL-এ রিকোয়েস্ট পাঠায়, তাই SSRF ঠেকানো সবচেয়ে জরুরি:
//   - শুধু http/https এবং পোর্ট 80/443
//   - DNS-এর উত্তরে private/internal IP থাকলে কানেকশনই হয় না (connect-এর মুহূর্তে যাচাই, rebinding-proof)
//   - redirect প্রতিবার নতুন করে যাচাই, সর্বোচ্চ ৪ বার
//   - ৫ সেকেন্ড টাইমআউট, ৫১২ KB-এর বেশি পড়া হয় না, শুধু HTML
import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import net from "node:net";
import zlib from "node:zlib";

const MAX_REDIRECTS = 4;
const MAX_BYTES = 768 * 1024;
const TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 500;
// Instagram/Facebook/অনেক সাইট শেয়ার-বটের জন্য Open Graph দেয়, সাধারণ ব্রাউজারকে লগইন/consent পেজ দেখায়।
// তাই আগে বট UA, না পেলে ব্রাউজার UA দিয়ে আবার চেষ্টা।
const USER_AGENTS = [
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
];

// ---------- IP যাচাই ----------
const isPrivateV4 = ip => {
    const p = ip.split(".").map(Number);
    if (p.length !== 4 || p.some(n => Number.isNaN(n))) return true;
    const [a, b] = p;
    return (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 100 && b >= 64 && b <= 127) || // CGNAT
        (a === 169 && b === 254) || // link-local / cloud metadata
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 192 && b === 0 && p[2] === 0) ||
        (a === 198 && (b === 18 || b === 19)) ||
        a >= 224 // multicast + reserved
    );
};

export const isPrivateIp = raw => {
    const ip = String(raw || "").toLowerCase().replace(/^\[|\]$/g, "");
    const kind = net.isIP(ip);
    if (kind === 4) return isPrivateV4(ip);
    if (kind === 6) {
        if (ip === "::" || ip === "::1") return true;
        const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
        if (mapped) return isPrivateV4(mapped[1]);
        const mappedHex = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
        if (mappedHex) {
            const hi = parseInt(mappedHex[1], 16);
            const lo = parseInt(mappedHex[2], 16);
            return isPrivateV4(
                `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`
            );
        }
        const first = parseInt(ip.split(":")[0] || "0", 16);
        return (
            (first & 0xfe00) === 0xfc00 || // fc00::/7
            (first & 0xffc0) === 0xfe80 || // fe80::/10
            (first & 0xff00) === 0xff00 // multicast
        );
    }
    return true; // IP-ই না হলে ধরে নিই অনিরাপদ
};

// DNS উত্তরের সবকটা IP public না হলে কানেকশন বাতিল
const safeLookup = (hostname, options, callback) => {
    const cb = typeof options === "function" ? options : callback;
    const opts = typeof options === "function" ? {} : options || {};
    dns.lookup(hostname, { ...opts, all: true }, (err, addresses) => {
        if (err) return cb(err);
        if (!addresses?.length || addresses.some(a => isPrivateIp(a.address))) {
            return cb(new Error("Blocked address"));
        }
        if (opts.all) return cb(null, addresses);
        return cb(null, addresses[0].address, addresses[0].family);
    });
};

export const normalizeUrl = raw => {
    let u;
    try {
        u = new URL(String(raw).trim());
    } catch {
        return null;
    }
    if (!["http:", "https:"].includes(u.protocol)) return null;
    if (u.username || u.password) return null;
    const port = u.port || (u.protocol === "https:" ? "443" : "80");
    if (port !== "80" && port !== "443") return null;
    if (isPrivateIp(u.hostname) && net.isIP(u.hostname.replace(/^\[|\]$/g, "")))
        return null;
    if (/^localhost$|\.local$|\.internal$/i.test(u.hostname)) return null;
    u.hash = "";
    return u;
};

// ---------- একটা hop ----------
const requestOnce = (url, userAgent, accept) =>
    new Promise((resolve, reject) => {
        const lib = url.protocol === "https:" ? https : http;
        const req = lib.request(
            url,
            {
                method: "GET",
                lookup: safeLookup,
                headers: {
                    "User-Agent": userAgent,
                    Accept:
                        accept ||
                        "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
                    "Accept-Language": "en,bn;q=0.8",
                    "Accept-Encoding": "gzip, deflate, br"
                },
                timeout: TIMEOUT_MS
            },
            res => resolve(res)
        );
        req.on("timeout", () => req.destroy(new Error("Timeout")));
        req.on("error", reject);
        req.end();
    });

const readBody = (res, limit) =>
    new Promise(resolve => {
        const enc = String(res.headers["content-encoding"] || "").toLowerCase();
        let stream = res;
        if (enc === "gzip") stream = res.pipe(zlib.createGunzip());
        else if (enc === "deflate") stream = res.pipe(zlib.createInflate());
        else if (enc === "br") stream = res.pipe(zlib.createBrotliDecompress());

        const chunks = [];
        let size = 0;
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            res.destroy();
            resolve(Buffer.concat(chunks));
        };
        stream.on("data", chunk => {
            chunks.push(chunk);
            size += chunk.length;
            // <head> শেষ হলেই যথেষ্ট
            if (size >= limit || /<\/head>/i.test(chunk.toString("latin1")))
                finish();
        });
        stream.on("end", finish);
        stream.on("error", finish);
        res.on("close", finish);
        setTimeout(finish, TIMEOUT_MS + 2000).unref?.();
    });

// ---------- HTML পার্স ----------
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decodeEntities = s =>
    String(s || "")
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
        .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
const safeChar = n => {
    try {
        return String.fromCodePoint(n);
    } catch {
        return "";
    }
};
const clean = (s, max) =>
    decodeEntities(s).replace(/\s+/g, " ").trim().slice(0, max);

const parseAttrs = tag => {
    const attrs = {};
    const re = /([a-zA-Z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
    let m;
    while ((m = re.exec(tag))) {
        attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
    }
    return attrs;
};

const absolute = (value, base) => {
    if (!value) return "";
    try {
        const u = new URL(decodeEntities(value).trim(), base);
        if (!["http:", "https:"].includes(u.protocol)) return "";
        // https পেজে http ছবি browser ব্লক করে, তাই https-এ তোলা
        if (u.protocol === "http:") u.protocol = "https:";
        return u.href.length > 2000 ? "" : u.href;
    } catch {
        return "";
    }
};

export const parseHtmlPreview = (html, pageUrl) => {
    const head = html.split(/<\/head>/i)[0] || html;
    const meta = {};
    for (const tag of head.match(/<meta\s[^>]*>/gi) || []) {
        const a = parseAttrs(tag);
        const key = (a.property || a.name || "").toLowerCase();
        if (key && a.content !== undefined && !(key in meta)) {
            meta[key] = a.content;
        }
    }
    const titleTag = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    const host = new URL(pageUrl).hostname.replace(/^www\./, "");

    const title = clean(
        meta["og:title"] || meta["twitter:title"] || titleTag,
        140
    );
    const description = clean(
        meta["og:description"] ||
            meta["twitter:description"] ||
            meta["description"],
        220
    );
    const image = absolute(
        meta["og:image:secure_url"] ||
            meta["og:image"] ||
            meta["og:image:url"] ||
            meta["twitter:image"] ||
            meta["twitter:image:src"],
        pageUrl
    );
    const siteName = clean(meta["og:site_name"], 60) || host;
    const isVideo =
        /^video/i.test(meta["og:type"] || "") ||
        Boolean(
            meta["og:video"] ||
                meta["og:video:url"] ||
                meta["og:video:secure_url"] ||
                meta["twitter:player"]
        );

    return {
        url: pageUrl,
        host,
        siteName,
        title,
        description,
        image,
        isVideo
    };
};

const decodeBody = (buf, contentType) => {
    const headerCharset = /charset=([\w-]+)/i.exec(contentType || "")?.[1];
    const sniff = /<meta[^>]+charset=["']?([\w-]+)/i.exec(
        buf.subarray(0, 4096).toString("latin1")
    )?.[1];
    const charset = (headerCharset || sniff || "utf-8").toLowerCase();
    try {
        return new TextDecoder(charset).decode(buf);
    } catch {
        return buf.toString("utf8");
    }
};

// ---------- মূল ফাংশন (redirect ফলো করে) ----------
const fetchPage = async (startUrl, userAgent) => {
    let url = startUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const res = await requestOnce(url, userAgent);
        const status = res.statusCode || 0;

        if (status >= 300 && status < 400 && res.headers.location) {
            res.resume();
            let next;
            try {
                next = normalizeUrl(new URL(res.headers.location, url).href);
            } catch {
                next = null;
            }
            if (!next) return null;
            url = next;
            continue;
        }

        const type = String(res.headers["content-type"] || "").toLowerCase();
        if (status < 200 || status >= 300 || !/html|xml/.test(type)) {
            res.resume();
            return null;
        }
        const buf = await readBody(res, MAX_BYTES);
        const preview = parseHtmlPreview(decodeBody(buf, type), url.href);
        if (!preview.title && !preview.description && !preview.image)
            return null;
        return preview;
    }
    return null;
};

// বট UA-তে না পেলে ব্রাউজার UA-তে আবার
const fetchGeneric = async url => {
    for (const ua of USER_AGENTS) {
        try {
            const preview = await fetchPage(url, ua);
            if (preview) return preview;
        } catch {
            /* পরের UA */
        }
    }
    return null;
};

// ---------- YouTube / Vimeo / TikTok / Spotify: oEmbed (বট-ব্লক এড়ায়, সবসময় thumbnail দেয়) ----------
const youtubeId = u => {
    const host = u.hostname.replace(/^(www|m|music)\./, "");
    let id = null;
    if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0];
    else if (host === "youtube.com" || host === "youtube-nocookie.com") {
        if (u.pathname === "/watch") id = u.searchParams.get("v");
        else id = u.pathname.match(/^\/(?:shorts|live|embed|v)\/([\w-]+)/)?.[1];
    }
    return id && /^[\w-]{6,15}$/.test(id) ? id : null;
};

const OEMBED = [
    {
        test: h => /(^|\.)vimeo\.com$/.test(h),
        endpoint: "https://vimeo.com/api/oembed.json?url=",
        site: "Vimeo",
        video: true
    },
    {
        test: h => /(^|\.)tiktok\.com$/.test(h),
        endpoint: "https://www.tiktok.com/oembed?url=",
        site: "TikTok",
        video: true
    },
    {
        test: h => h === "open.spotify.com",
        endpoint: "https://open.spotify.com/oembed?url=",
        site: "Spotify",
        video: false
    }
];

const fetchJson = async (endpoint, target) => {
    const res = await requestOnce(
        new URL(endpoint + encodeURIComponent(target)),
        USER_AGENTS[1],
        "application/json"
    );
    if ((res.statusCode || 0) !== 200) {
        res.resume();
        return null;
    }
    const buf = await readBody(res, 128 * 1024);
    try {
        return JSON.parse(buf.toString("utf8"));
    } catch {
        return null;
    }
};

const fetchProvider = async url => {
    const host = url.hostname.replace(/^www\./, "");

    const yt = youtubeId(url);
    if (yt) {
        const canonical = `https://www.youtube.com/watch?v=${yt}`;
        let data = null;
        try {
            data = await fetchJson("https://www.youtube.com/oembed?format=json&url=", canonical);
        } catch {
            data = null;
        }
        return {
            url: url.href,
            host: "youtube.com",
            siteName: "YouTube",
            title: clean(data?.title, 140) || "YouTube video",
            description: clean(data?.author_name, 220),
            // oEmbed ফেল করলেও thumbnail আইডি থেকেই পাওয়া যায়
            image:
                absolute(data?.thumbnail_url, canonical) ||
                `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`,
            isVideo: true
        };
    }

    const provider = OEMBED.find(p => p.test(host));
    if (provider) {
        try {
            const data = await fetchJson(provider.endpoint, url.href);
            if (data?.title || data?.thumbnail_url) {
                return {
                    url: url.href,
                    host,
                    siteName: provider.site,
                    title: clean(data.title, 140),
                    description: clean(data.author_name, 220),
                    image: absolute(data.thumbnail_url, url.href),
                    isVideo: provider.video
                };
            }
        } catch {
            /* সাধারণ পদ্ধতিতে চেষ্টা */
        }
    }
    return null;
};

const fetchPreview = async url =>
    (await fetchProvider(url)) || (await fetchGeneric(url));

// ---------- cache + একই URL একসাথে এলে একবারই fetch ----------
const cache = new Map(); // url -> { at, ttl, value }
const inflight = new Map();

export const getLinkPreview = async rawUrl => {
    const url = normalizeUrl(rawUrl);
    if (!url) return null;
    const key = url.href;

    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
    if (inflight.has(key)) return inflight.get(key);

    const job = (async () => {
        let value = null;
        try {
            value = await fetchPreview(url);
        } catch {
            value = null; // সাইট ডাউন/ব্লক: preview ছাড়াই চলবে
        }
        if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
        cache.set(key, {
            at: Date.now(),
            ttl: value ? CACHE_TTL_MS : NEGATIVE_TTL_MS,
            value
        });
        return value;
    })().finally(() => inflight.delete(key));

    inflight.set(key, job);
    return job;
};
