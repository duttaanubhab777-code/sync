// Sync-এর নিজস্ব সাউন্ড: কোনো অডিও ফাইল নেই, সব Web Audio API দিয়ে তৈরি।
// এতে ফাইল সাইজ বাড়ে না, কপিরাইটের ঝামেলা নেই, আর সুরগুলো Sync-এর নিজের।

const STORAGE_KEY = "sync-sounds";

let ctx = null;
let enabled = true;
try {
    enabled = localStorage.getItem(STORAGE_KEY) !== "off";
} catch {
    enabled = true;
}

const getCtx = () => {
    if (!ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return null;
        try {
            ctx = new AudioCtx();
        } catch {
            return null;
        }
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
};

// ব্রাউজার ইউজারের প্রথম touch/click-এর আগে সাউন্ড চালাতে দেয় না, তাই তখনই চালু করে নেওয়া হয়
if (typeof window !== "undefined") {
    const unlock = () => {
        getCtx();
        ["pointerdown", "touchstart", "keydown"].forEach(ev =>
            window.removeEventListener(ev, unlock)
        );
    };
    ["pointerdown", "touchstart", "keydown"].forEach(ev =>
        window.addEventListener(ev, unlock, { passive: true })
    );
}

// একটা নোট: ফ্রিকোয়েন্সি, শুরুর সময়, দৈর্ঘ্য, ওয়েভ টাইপ, ভলিউম, চাইলে স্লাইড
const note = (
    c,
    { freq, at = 0, dur = 0.2, type = "sine", gain = 0.16, slideTo = null }
) => {
    const t0 = c.currentTime + at;
    const osc = c.createOscillator();
    const amp = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(amp).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
};

// ঘণ্টার মতো নোট: মূল সুর + একটু উঁচু হারমোনিক
const bell = (c, freq, at, dur, gain) => {
    note(c, { freq, at, dur, type: "sine", gain });
    note(c, { freq: freq * 2.01, at, dur: dur * 0.6, type: "sine", gain: gain * 0.35 });
};

const SOUNDS = {
    // মেসেজ পাঠানো: ছোট উঁচু-হওয়া "ফুট"
    send: c => {
        note(c, { freq: 420, slideTo: 760, dur: 0.11, type: "sine", gain: 0.15 });
        note(c, { freq: 1180, at: 0.07, dur: 0.06, type: "triangle", gain: 0.05 });
    },
    // চালু চ্যাটে মেসেজ আসা: নরম দুই নোটের ঘণ্টা
    receive: c => {
        bell(c, 659, 0, 0.16, 0.13);
        bell(c, 988, 0.1, 0.24, 0.12);
    },
    // অন্য চ্যাটে/ব্যাকগ্রাউন্ডে মেসেজ আসা: চার নোটের ছোট চাইম
    notify: c => {
        [523, 659, 784, 1047].forEach((f, i) =>
            bell(c, f, i * 0.085, 0.28, 0.12)
        );
    },
    // পাঠাতে ব্যর্থ: নিচু নামমুখী দুই সুর
    error: c => {
        note(c, { freq: 247, dur: 0.16, type: "triangle", gain: 0.12 });
        note(c, { freq: 185, at: 0.14, dur: 0.24, type: "triangle", gain: 0.12 });
    },
    // আপলোড শেষ: দ্রুত উঠে যাওয়া "টুং"
    done: c => {
        bell(c, 880, 0, 0.14, 0.12);
        bell(c, 1320, 0.08, 0.26, 0.12);
    }
};

const lastPlayed = {};

export const playSound = name => {
    if (!enabled || !SOUNDS[name]) return;
    const now = performance.now();
    // একসাথে অনেক মেসেজ এলে কানফাটা শব্দ না হয়, তাই একই সাউন্ডের মাঝে ন্যূনতম বিরতি
    if (lastPlayed[name] && now - lastPlayed[name] < 220) return;
    lastPlayed[name] = now;
    const c = getCtx();
    if (!c) return;
    try {
        SOUNDS[name](c);
    } catch {
        // সাউন্ড চালাতে না পারলে অ্যাপ থামবে না
    }
};

export const isSoundEnabled = () => enabled;

export const setSoundEnabled = value => {
    enabled = Boolean(value);
    try {
        localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
    } catch {
        // storage বন্ধ থাকলে শুধু এই সেশনে কাজ করবে
    }
    if (enabled) playSound("done");
};
