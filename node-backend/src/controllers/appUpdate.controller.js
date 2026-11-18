import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";

// Android APK-র release গুলো GitHub Releases-এ থাকে (GitHub Actions বানায়)।
// অ্যাপ ও ওয়েব এই endpoint থেকে নতুন ভার্সন, "কী বদলেছে" ও পুরনো ভার্সনের ইতিহাস পায়।
// ব্রাউজার সরাসরি api.github.com ডাকে না (CSP ও rate limit এড়াতে), সার্ভার ক্যাশ করে দেয়।
const REPO = (process.env.GITHUB_REPO || "duttaanubhab777-code/sync").trim();
// আগে ক্যাশ ছিল ১০ মিনিট, তাই নতুন release (যেমন v1.0.10) বের হলেও অ্যাপ অনেকক্ষণ পুরনো v1.0.9-ই দেখাত।
// এখন ক্যাশ ছোট (২ মিনিট), আর ইউজার "Check again" চাপলে (?fresh=1) ক্যাশ ভেঙে সরাসরি GitHub থেকে আনে।
const CACHE_MS = 2 * 60 * 1000;
const FRESH_MIN_GAP_MS = 15 * 1000; // ?fresh=1 স্প্যাম হলে GitHub rate limit এড়াতে
const HISTORY_LIMIT = 15;

let cache = { at: 0, data: null };
let inflightFetch = null;

// "Sync Android v1.0.42" বা tag "android-v1.0.42" থেকে build নম্বর (42)
const buildOf = release => {
    const hay = `${release.name || ""} ${release.tag_name || ""}`;
    const m = /v?1\.0\.(\d+)/.exec(hay);
    return m ? Number(m[1]) : 0;
};

// release body-র "### What's new" অংশের লাইনগুলো (commit hash বাদ দিয়ে)
const changesOf = body => {
    const text = String(body || "");
    const start = text.search(/###\s*What'?s new/i);
    if (start === -1) return [];
    const rest = text.slice(start).split("\n").slice(1);
    const out = [];
    for (const line of rest) {
        if (/^#{1,6}\s/.test(line)) break;
        const m = /^\s*[-*]\s+(.*)$/.exec(line);
        if (!m) continue;
        const clean = m[1].replace(/\s*\(`?[0-9a-f]{6,40}`?\)\s*$/i, "").trim();
        if (clean) out.push(clean.slice(0, 200));
    }
    return out.slice(0, 20);
};

const toClientRelease = r => {
    const build = buildOf(r);
    const apk = (r.assets || []).find(a => /\.apk$/i.test(a.name || ""));
    return {
        build,
        version: `1.0.${build}`,
        publishedAt: r.published_at || r.created_at || null,
        changes: changesOf(r.body),
        downloadUrl: apk?.browser_download_url || "",
        sizeBytes: apk?.size || 0
    };
};

const fetchFromGitHub = async () => {
    const headers = {
        Accept: "application/vnd.github+json",
        "User-Agent": "sync-app-updates"
    };
    if (process.env.GITHUB_TOKEN) {
        headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }
    const res = await fetch(
        `https://api.github.com/repos/${REPO}/releases?per_page=30`,
        { headers, signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) throw new Error(`GitHub responded ${res.status}`);
    const list = await res.json();

    const releases = (Array.isArray(list) ? list : [])
        .filter(r => !r.draft && /^android-/i.test(r.tag_name || ""))
        .map(toClientRelease)
        .filter(r => r.build > 0 && r.downloadUrl)
        // একই build দুবার থাকলে (পুরনো android-latest ও নতুন tag) একটাই রাখা
        .filter((r, i, arr) => arr.findIndex(x => x.build === r.build) === i)
        .sort((a, b) => b.build - a.build);

    return {
        latest: releases[0] || null,
        history: releases.slice(0, HISTORY_LIMIT),
        // সবসময় সর্বশেষ APK-তে নিয়ে যায়
        latestDownloadUrl: `https://github.com/${REPO}/releases/latest/download/Sync.apk`,
        releasesUrl: `https://github.com/${REPO}/releases`
    };
};

// ---------- GitHub API ব্যর্থ হলে বিকল্প (rate limit / timeout) ----------
// GitHub API-র quota (টোকেন ছাড়া ঘণ্টায় ৬০, Render-এর shared IP-তে সহজেই শেষ) ফুরোলে আগে শুধু build নম্বর
// পাওয়া যেত, তাই v1.0.12-এর "What's new" ফাঁকা থেকে "Improvements and bug fixes" দেখাত।
// এখন releases.atom feed পড়া হয়: এটা API quota খায় না, আর প্রতিটা release-এর "What's new" ও তারিখ দেয়।
const API_BLOCK_MS = 5 * 60 * 1000;
let apiBlockedUntil = 0;

const decodeEntities = t =>
    String(t || "")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#0*39;|&#x27;|&apos;/gi, "'")
        .replace(/&amp;/g, "&");

// atom entry-র (escape করা) HTML থেকে "What's new" এর <li> গুলো
export const changesFromHtml = html => {
    const h = decodeEntities(html);
    const sec =
        /<h[1-6][^>]*>\s*What(?:'|’|&#0*39;|&apos;)?s new\s*<\/h[1-6]>([\s\S]*?)(?=<h[1-6][\s>]|$)/i.exec(
            h
        );
    if (!sec) return [];
    const out = [];
    const re = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    let m;
    while ((m = re.exec(sec[1]))) {
        const text = decodeEntities(m[1].replace(/<[^>]+>/g, ""))
            .replace(/\s+/g, " ")
            .replace(/\s*\(`?[0-9a-f]{6,40}`?\)\s*$/i, "")
            .trim();
        if (text) out.push(text.slice(0, 200));
    }
    return out.slice(0, 20);
};

export const parseReleasesAtom = xml => {
    const entries = String(xml || "").match(/<entry>[\s\S]*?<\/entry>/g) || [];
    const releases = [];
    for (const e of entries) {
        const href =
            /<link[^>]*rel="alternate"[^>]*href="([^"]+)"/.exec(e)?.[1] || "";
        const tag = decodeURIComponent(href.split("/releases/tag/")[1] || "");
        if (!/^android-/i.test(tag)) continue;
        const title = decodeEntities(/<title>([\s\S]*?)<\/title>/.exec(e)?.[1]);
        const build = buildOf({ name: title, tag_name: tag });
        if (!build) continue;
        const content =
            /<content[^>]*>([\s\S]*?)<\/content>/.exec(e)?.[1] || "";
        releases.push({
            build,
            version: `1.0.${build}`,
            publishedAt: /<updated>([^<]+)<\/updated>/.exec(e)?.[1] || null,
            changes: changesFromHtml(content),
            // asset-এর নাম workflow-তে সবসময় Sync.apk
            downloadUrl: `https://github.com/${REPO}/releases/download/${tag}/Sync.apk`,
            sizeBytes: 0
        });
    }
    return releases
        .filter((r, i, arr) => arr.findIndex(x => x.build === r.build) === i)
        .sort((a, b) => b.build - a.build);
};

const fetchFromAtom = async () => {
    const res = await fetch(`https://github.com/${REPO}/releases.atom`, {
        headers: {
            "User-Agent": "sync-app-updates",
            Accept: "application/atom+xml"
        },
        signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) throw new Error(`releases.atom responded ${res.status}`);
    const releases = parseReleasesAtom(await res.text());
    if (!releases.length)
        throw new Error("releases.atom had no android releases");
    return {
        latest: releases[0],
        history: releases.slice(0, HISTORY_LIMIT),
        latestDownloadUrl: `https://github.com/${REPO}/releases/latest/download/Sync.apk`,
        releasesUrl: `https://github.com/${REPO}/releases`
    };
};

// শেষ ভরসা: github.com/<repo>/releases/latest-এর redirect থেকে শুধু build নম্বর
const latestBuildFromRedirect = async () => {
    const res = await fetch(`https://github.com/${REPO}/releases/latest`, {
        redirect: "manual",
        headers: { "User-Agent": "sync-app-updates" },
        signal: AbortSignal.timeout(6000)
    });
    const loc = res.headers.get("location") || "";
    const m = /android-v1\.0\.(\d+)/i.exec(loc);
    return m ? Number(m[1]) : 0;
};

const refreshCache = async () => {
    if (inflightFetch) return inflightFetch;
    inflightFetch = (async () => {
        try {
            // 1) GitHub API (সবচেয়ে পূর্ণ তথ্য: APK সাইজসহ)। সম্প্রতি ব্যর্থ হলে সরাসরি atom-এ
            if (Date.now() >= apiBlockedUntil) {
                try {
                    cache = { at: Date.now(), data: await fetchFromGitHub() };
                    return;
                } catch (err) {
                    apiBlockedUntil = Date.now() + API_BLOCK_MS;
                    console.warn(
                        "[app-updates] GitHub API failed:",
                        err.message
                    );
                }
            }
            // 2) releases.atom
            try {
                cache = { at: Date.now(), data: await fetchFromAtom() };
                return;
            } catch (err) {
                console.warn(
                    "[app-updates] atom fallback failed:",
                    err.message
                );
            }
            // 3) শুধু build নম্বর
            try {
                const build = await latestBuildFromRedirect();
                const known = cache.data?.latest?.build || 0;
                if (build > known) {
                    const base = cache.data || {
                        history: [],
                        latestDownloadUrl: `https://github.com/${REPO}/releases/latest/download/Sync.apk`,
                        releasesUrl: `https://github.com/${REPO}/releases`
                    };
                    const latest = {
                        build,
                        version: `1.0.${build}`,
                        publishedAt: null,
                        changes: [],
                        downloadUrl: base.latestDownloadUrl,
                        sizeBytes: 0
                    };
                    cache = {
                        at: Date.now() - CACHE_MS + 30 * 1000,
                        data: {
                            ...base,
                            latest,
                            history: [latest, ...base.history]
                        }
                    };
                    return;
                }
            } catch (err) {
                console.warn(
                    "[app-updates] redirect fallback failed:",
                    err.message
                );
            }
            if (!cache.data)
                throw new ApiError(
                    502,
                    "Could not check for updates right now"
                );
            // পুরনো ক্যাশ দিয়েই চলবে, ১ মিনিট পর আবার চেষ্টা
            cache = { ...cache, at: Date.now() - CACHE_MS + 60 * 1000 };
        } finally {
            inflightFetch = null;
        }
    })();
    return inflightFetch;
};

// GET /api/app/updates (public)
export const getAppUpdates = asyncHandler(async (req, res) => {
    const age = Date.now() - cache.at;
    const wantsFresh = req.query.fresh === "1" && age > FRESH_MIN_GAP_MS;
    const fresh = cache.data && age < CACHE_MS && !wantsFresh;
    if (!fresh) await refreshCache();
    // ব্রাউজার/প্রক্সি যেন এই জবাব আটকে না রাখে, নইলে নতুন ভার্সন দেরিতে দেখা যায়
    res.set("Cache-Control", "no-store");
    res.status(200).json(new ApiResponse(200, cache.data, "success"));
});
