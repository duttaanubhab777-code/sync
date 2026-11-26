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

// ---- নিজের হাতে গণিত দিয়ে বানানো সাউন্ড (sin · cos · tan) ----
// প্রতিটা নমুনা (sample) সরাসরি সূত্র থেকে বসানো হয়: কোনো অডিও ফাইল নেই।
const TWO_PI = Math.PI * 2;

// লিনিয়ার chirp-এর ফেজ: f0 থেকে f1 পর্যন্ত ফ্রিকোয়েন্সি গড়িয়ে যায়
const chirpPhase = (f0, f1, t, dur) =>
    TWO_PI * (f0 * t + ((f1 - f0) * t * t) / (2 * dur));

// tan দিয়ে নরম saturation: কড়া ক্লিপিং ছাড়াই সুরে একটু উষ্ণতা আসে, আউটপুট -1..1
const TAN_K = 0.9;
const TAN_NORM = Math.tan(TAN_K);
const softTan = x => Math.tan(Math.max(-1, Math.min(1, x)) * TAN_K) / TAN_NORM;

// cos দিয়ে নরম শুরু-শেষের envelope (ক্লিক শব্দ হয় না)
const envelope = (p, attack = 0.12) =>
    Math.sin(Math.min(1, p / attack) * (Math.PI / 2)) *
    Math.pow(Math.cos((p * Math.PI) / 2), 2);

// ফাংশন থেকে সরাসরি অডিও বাফার বানিয়ে চালায়
const synth = (c, { dur, at = 0, gain = 0.2, fn }) => {
    const rate = c.sampleRate;
    const n = Math.max(1, Math.floor(dur * rate));
    const buf = c.createBuffer(1, n, rate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i += 1) {
        const t = i / rate;
        data[i] = fn(t, t / dur);
    }
    const src = c.createBufferSource();
    const amp = c.createGain();
    amp.gain.value = gain;
    src.buffer = buf;
    src.connect(amp).connect(c.destination);
    src.start(c.currentTime + at);
};

// গোল সুর: sin মূল সুর + cos-ফেজের হারমোনিক, তারপর tan saturation
const tone = (c, { f0, f1 = f0, dur, at = 0, gain = 0.2, vibrato = 0 }) =>
    synth(c, {
        dur,
        at,
        gain,
        fn: (t, p) => {
            const ph = chirpPhase(f0, f1, t, dur) + vibrato * Math.sin(TWO_PI * 16 * t);
            const raw =
                Math.sin(ph) + 0.32 * Math.cos(2 * ph + 0.6) + 0.12 * Math.sin(3 * ph);
            return softTan(raw * 0.7) * envelope(p);
        }
    });

// কাগজ মোচড়ানোর মত খসখসে শব্দ: sin-হ্যাশ দিয়ে নির্ধারিত noise
const crumple = (c, { dur, at = 0, gain = 0.12 }) => {
    let prev = 0;
    synth(c, {
        dur,
        at,
        gain,
        fn: (t, p) => {
            const h = Math.sin(t * 12.9898 * 43758.5453) * 43758.5453;
            const noise = (h - Math.floor(h)) * 2 - 1;
            prev += (noise - prev) * 0.35; // হালকা low-pass
            const flutter = 0.55 + 0.45 * Math.cos(TWO_PI * 38 * t);
            return prev * flutter * envelope(p, 0.05);
        }
    });
};

const SOUNDS = {
    // ভয়েস রেকর্ড শুরু: নরম উঠে-যাওয়া "পপ"
    recStart: c => {
        tone(c, { f0: 480, f1: 880, dur: 0.15, gain: 0.2 });
        tone(c, { f0: 1320, dur: 0.07, at: 0.07, gain: 0.07 });
    },
    // pause: দুই ধাপে নামা সুর
    recPause: c => {
        tone(c, { f0: 784, dur: 0.09, gain: 0.2 });
        tone(c, { f0: 523, f1: 494, dur: 0.14, at: 0.08, gain: 0.2 });
    },
    // play/resume: দুই ধাপে ওঠা সুর + শেষে ছোট ঝিলিক
    recPlay: c => {
        tone(c, { f0: 523, dur: 0.09, gain: 0.2 });
        tone(c, { f0: 784, f1: 830, dur: 0.12, at: 0.08, gain: 0.2 });
        tone(c, { f0: 1568, dur: 0.06, at: 0.17, gain: 0.06 });
    },
    // delete: নিচে গড়িয়ে পড়া সুর + কাগজ মোচড়ানো + শেষে নিচু "থাপ"
    recDelete: c => {
        tone(c, { f0: 880, f1: 140, dur: 0.3, gain: 0.17, vibrato: 1.4 });
        crumple(c, { dur: 0.22, at: 0.02, gain: 0.14 });
        tone(c, { f0: 140, f1: 52, dur: 0.17, at: 0.24, gain: 0.26 });
    },
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
