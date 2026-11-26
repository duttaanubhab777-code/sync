import { CommitAnnouncement } from "../models/commit-announcement.model.js";
import {
    sendOfficialBroadcast,
    sendOfficialGroupPost
} from "./official.service.js";

/*
 * প্রতিটা git commit মেসেজ অটো-অ্যানাউন্সমেন্ট হয়ে যায়:
 *   GitHub Actions push-এ POST /api/v1/commits/announce → এই সার্ভিস
 *   → (১) সবার personal "Sync" DM-এ ব্রডকাস্ট কার্ড + push
 *   → (২) অফিশিয়াল "Sync" গ্রুপে একই কার্ড
 *
 * commit মেসেজ লেখার নিয়ম (Conventional Commits হলে সুন্দর দেখায়):
 *   feat(chat): Poll votes now show who voted      ← প্রথম লাইন = কার্ডের শিরোনাম
 *   - See who voted for each option                ← বাকি লাইন = কার্ডের বার্তা (• বুলেট হয়ে যায়)
 *   - New emoji picker for reactions
 * না চাইলে মেসেজের যেকোনো জায়গায় [skip announce] লিখো।
 */

const MAX_INDIVIDUAL = 5; // এর বেশি commit একসাথে এলে একটা সারাংশ কার্ড যায়
const SKIP_MARKER = /\[(?:skip|no)[ -]?announce\]/i;
const TRAILER = /^(co-authored-by|signed-off-by|change-id|reviewed-by)\s*:/i;
const CONVENTIONAL = /^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/;

const TYPE_TAGS = {
    feat: "New Feature",
    feature: "New Feature",
    fix: "Fix",
    bugfix: "Fix",
    hotfix: "Fix",
    perf: "Performance",
    ui: "Design",
    style: "Design",
    design: "Design",
    refactor: "Improvement",
    improve: "Improvement",
    security: "Security",
    docs: "Update",
    chore: "Update",
    build: "Update",
    ci: "Update",
    test: "Update"
};

const FALLBACK_BODY = {
    "New Feature": "A new feature just landed in Sync. Open the app to try it out!",
    Fix: "We fixed an issue to make Sync smoother and more reliable.",
    Performance: "Sync is now faster and more responsive.",
    Design: "Sync just got a fresh new look in some places.",
    Improvement: "We improved Sync behind the scenes.",
    Security: "We strengthened Sync's security.",
    Update: "A new update is now live on Sync."
};

const skipTypes = () =>
    new Set(
        String(process.env.COMMIT_ANNOUNCE_SKIP_TYPES || "")
            .split(",")
            .map(t => t.trim().toLowerCase())
            .filter(Boolean)
    );

const capitalise = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// commit মেসেজ → { title, body, tag, type } (ঘোষণার অযোগ্য হলে null)
export const parseCommitMessage = rawMessage => {
    const raw = String(rawMessage || "").replace(/\r/g, "").trim();
    if (!raw) return null;
    if (SKIP_MARKER.test(raw)) return null;

    const lines = raw.split("\n");
    const subject = lines[0].trim();
    if (!subject || /^merge\b/i.test(subject)) return null;

    let type = "";
    let title = subject;
    const m = CONVENTIONAL.exec(subject);
    if (m) {
        type = m[1].toLowerCase();
        title = m[4].trim();
    }
    if (skipTypes().has(type)) return null;

    const tag = TYPE_TAGS[type] || "Update";

    const bodyLines = [];
    for (const line of lines.slice(1)) {
        const t = line.trim();
        if (TRAILER.test(t)) continue;
        bodyLines.push(
            /^[-*]\s+/.test(t) ? `• ${t.replace(/^[-*]\s+/, "")}` : t
        );
    }
    const body = bodyLines
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

    return {
        title: capitalise(title).slice(0, 120),
        body: (body || FALLBACK_BODY[tag]).slice(0, 1500),
        tag,
        type
    };
};

const deliver = async (card, key, io) => {
    // দুই জায়গায় আলাদা আলাদা চেষ্টা: একটা ব্যর্থ হলে আরেকটা আটকাবে না
    const [dm, group] = await Promise.allSettled([
        sendOfficialBroadcast({ ...card, broadcastKey: key }, io),
        sendOfficialGroupPost({ ...card, broadcastKey: key }, io)
    ]);
    if (dm.status === "rejected") {
        console.error("[Commit Announce DM]", dm.reason?.message || dm.reason);
    }
    if (group.status === "rejected") {
        console.error("[Commit Announce Group]", group.reason?.message || group.reason);
    }
    // দুটোই ব্যর্থ হলে "হয়নি" ধরা হবে, যাতে পরের চেষ্টায় আবার যায়
    if (dm.status === "rejected" && group.status === "rejected") {
        throw new Error("Announcement delivery failed");
    }
    return {
        deliveredCount:
            dm.status === "fulfilled" ? dm.value.deliveredCount : 0,
        groupPosted: group.status === "fulfilled" && Boolean(group.value.posted)
    };
};

const record = (shas, subject, tag, result) =>
    CommitAnnouncement.bulkWrite(
        shas.map(sha => ({
            updateOne: {
                filter: { sha },
                update: {
                    $setOnInsert: {
                        sha,
                        subject: subject.slice(0, 200),
                        tag,
                        deliveredCount: result.deliveredCount,
                        groupPosted: result.groupPosted,
                        announcedAt: new Date()
                    }
                },
                upsert: true
            }
        }))
    );

/**
 * commits: [{ id, message }] — GitHub push event-এর commit তালিকা (পুরনো থেকে নতুন ক্রমে)
 * ফেরত: { announced, skipped, summarized }
 */
export const announceCommits = async (commits, io) => {
    const seen = new Set();
    const candidates = [];
    for (const c of Array.isArray(commits) ? commits : []) {
        const sha = String(c?.id || "").trim();
        if (!/^[0-9a-f]{7,64}$/i.test(sha) || seen.has(sha)) continue;
        seen.add(sha);
        const card = parseCommitMessage(c?.message);
        if (card) candidates.push({ sha, card });
    }

    // আগে ঘোষণা হয়ে গেছে এমন commit বাদ (GitHub retry / workflow rerun-এ দুবার যাবে না)
    const done = new Set(
        (
            await CommitAnnouncement.find(
                { sha: { $in: candidates.map(c => c.sha) } },
                { sha: 1 }
            ).lean()
        ).map(r => r.sha)
    );
    const fresh = candidates.filter(c => !done.has(c.sha));
    const skipped = seen.size - fresh.length;
    if (fresh.length === 0) return { announced: 0, skipped, summarized: false };

    // অনেক commit একসাথে এলে ইউজারকে স্প্যাম না করে একটা সারাংশ কার্ড
    if (fresh.length > MAX_INDIVIDUAL) {
        const lines = fresh.map(c => `• ${c.card.title}`).join("\n");
        const card = {
            title: `${fresh.length} new updates in Sync`,
            body: lines.slice(0, 1500),
            tag: "Update"
        };
        const key = `commits:${fresh[fresh.length - 1].sha}`;
        const result = await deliver(card, key, io);
        await record(fresh.map(c => c.sha), card.title, card.tag, result);
        return { announced: 1, skipped, summarized: true };
    }

    let announced = 0;
    for (const { sha, card } of fresh) {
        const result = await deliver(card, `commit:${sha}`, io);
        await record([sha], card.title, card.tag, result);
        announced += 1;
    }
    return { announced, skipped, summarized: false };
};
