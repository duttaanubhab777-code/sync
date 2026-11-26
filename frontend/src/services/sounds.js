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

// tan দিয়ে নরম saturation: কড়া ক্লিপিং ছাড়াই সুরে উষ্ণতা আসে, আউটপুট -1..1
const TAN_K = 0.85;
const TAN_NORM = Math.tan(TAN_K);
const softTan = x => Math.tan(Math.max(-1, Math.min(1, x)) * TAN_K) / TAN_NORM;

// ফাংশন থেকে অডিও বাফার বানায়; echo দিলে ফিডব্যাক-ডিলে যোগ হয় (ছোট ঘরের প্রতিধ্বনির মত)
const synth = (c, { dur, at = 0, gain = 0.2, fn, echo = 0, echoFb = 0.3 }) => {
    const rate = c.sampleRate;
    const n = Math.max(1, Math.floor(dur * rate));
    const buf = c.createBuffer(1, n, rate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i += 1) data[i] = fn(i / rate, i / n);
    if (echo > 0) {
        const d = Math.floor(echo * rate);
        for (let i = d; i < n; i += 1) data[i] += data[i - d] * echoFb;
    }
    for (let i = 0; i < n; i += 1) data[i] = softTan(data[i]);
    const src = c.createBufferSource();
    const amp = c.createGain();
    amp.gain.value = gain * 1.8;
    src.buffer = buf;
    src.connect(amp).connect(c.destination);
    src.start(c.currentTime + at);
};

// কাচ/মারিম্বার মত "pluck": FM সিন্থ। sin দিয়ে সুর, ভেতরে cos-ফেজের মডুলেটর,
// মডুলেশন ইনডেক্স দ্রুত কমে যায় বলে শুরুতে ঝকঝকে, তারপর নরম হয়ে মিলিয়ে যায়।
const pluck = (
    c,
    { f, at = 0, dur = 0.3, gain = 0.22, idx = 2.4, ratio = 2, decay = 8, echo = 0.085 }
) =>
    synth(c, {
        dur,
        at,
        gain,
        echo,
        echoFb: 0.32,
        fn: t => {
            const attack = Math.min(1, t / 0.004);
            const amp = attack * Math.exp(-t * decay);
            const mod = idx * Math.exp(-t * decay * 1.6);
            const m = Math.cos(TWO_PI * f * ratio * t);
            return (
                (Math.sin(TWO_PI * f * t + mod * m) +
                    0.18 * Math.sin(TWO_PI * f * 3 * t)) *
                amp
            );
        }
    });

// বাতাসের "ঝুউউশ": sin-হ্যাশ noise → state-variable band-pass filter, কেন্দ্র-ফ্রিকোয়েন্সি hi → lo গড়ায়
const swoosh = (c, { dur = 0.28, at = 0, gain = 0.2, from = 5200, to = 500 }) => {
    let low = 0;
    let band = 0;
    synth(c, {
        dur,
        at,
        gain,
        fn: (t, p) => {
            const h = Math.sin(t * 12.9898 * 43758.5453) * 43758.5453;
            const noise = (h - Math.floor(h)) * 2 - 1;
            const fc = from * Math.pow(to / from, p);
            const f = 2 * Math.sin((Math.PI * fc) / c.sampleRate);
            const high = noise - low - 0.45 * band;
            band += f * high;
            low += f * band;
            const env = Math.sin(Math.PI * Math.pow(p, 0.7)) * Math.cos((p * Math.PI) / 2);
            return band * 1.6 * env;
        }
    });
};

// নিচু গোল "থাপ": sin-এর ফ্রিকোয়েন্সি দ্রুত নামে
const thump = (c, { at = 0, dur = 0.16, gain = 0.3, f0 = 170, f1 = 55 }) =>
    synth(c, {
        dur,
        at,
        gain,
        fn: (t, p) => {
            const ph = TWO_PI * (f0 * t + ((f1 - f0) * t * t) / (2 * dur));
            return Math.sin(ph) * Math.exp(-p * 5.5) * Math.min(1, t / 0.003);
        }
    });

const SOUNDS = {
    // ভয়েস রেকর্ড শুরু: দুটো ঝকঝকে নোট, ওপরে ওঠা (E5 → B5)
    recStart: c => {
        pluck(c, { f: 659.25, dur: 0.22, gain: 0.2, decay: 11 });
        pluck(c, { f: 987.77, at: 0.07, dur: 0.26, gain: 0.2, decay: 10 });
    },
    // pause: নরম নামমুখী দুই নোট (G5 → D5), গোল ও শান্ত
    recPause: c => {
        pluck(c, { f: 783.99, dur: 0.24, gain: 0.22, idx: 1.4, ratio: 1, decay: 9 });
        pluck(c, { f: 587.33, at: 0.1, dur: 0.3, gain: 0.22, idx: 1.2, ratio: 1, decay: 8 });
    },
    // play/resume: তিন নোটের দ্রুত আরোহী arpeggio (D5 → A5 → D6), উজ্জ্বল
    recPlay: c => {
        pluck(c, { f: 587.33, dur: 0.2, gain: 0.19, idx: 2.8, decay: 11 });
        pluck(c, { f: 880, at: 0.065, dur: 0.22, gain: 0.19, idx: 2.8, decay: 11 });
        pluck(c, { f: 1174.66, at: 0.13, dur: 0.3, gain: 0.2, idx: 2.8, decay: 9 });
    },
    // delete: বাতাসের ঝুউউশ + নামমুখী দুই নোট + শেষে নিচু থাপ
    recDelete: c => {
        swoosh(c, { dur: 0.3, gain: 0.22 });
        pluck(c, { f: 523.25, at: 0.04, dur: 0.22, gain: 0.16, idx: 1.6, ratio: 1, decay: 12, echo: 0 });
        pluck(c, { f: 349.23, at: 0.13, dur: 0.24, gain: 0.16, idx: 1.6, ratio: 1, decay: 12, echo: 0 });
        thump(c, { at: 0.24, gain: 0.3 });
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
