import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";

// Android APK-র release গুলো GitHub Releases-এ থাকে (GitHub Actions বানায়)।
// অ্যাপ ও ওয়েব এই endpoint থেকে নতুন ভার্সন, "কী বদলেছে" ও পুরনো ভার্সনের ইতিহাস পায়।
// ব্রাউজার সরাসরি api.github.com ডাকে না (CSP ও rate limit এড়াতে), সার্ভার ক্যাশ করে দেয়।
const REPO = (process.env.GITHUB_REPO || "duttaanubhab777-code/sync").trim();
const CACHE_MS = 10 * 60 * 1000;
const HISTORY_LIMIT = 15;

let cache = { at: 0, data: null };

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

// GET /api/app/updates (public)
export const getAppUpdates = asyncHandler(async (_req, res) => {
    const fresh = cache.data && Date.now() - cache.at < CACHE_MS;
    if (!fresh) {
        try {
            cache = { at: Date.now(), data: await fetchFromGitHub() };
        } catch (err) {
            // GitHub না পেলে পুরনো ক্যাশ দিয়ে চালানো, ক্যাশও না থাকলে এরর
            if (!cache.data) {
                throw new ApiError(502, "Could not check for updates right now");
            }
        }
    }
    res.set("Cache-Control", "public, max-age=60");
    res.status(200).json(new ApiResponse(200, cache.data, "success"));
});
