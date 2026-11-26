// Sync-এর নিজস্ব সাউন্ড: কোনো অডিও ফাইল নেই, সব Web Audio API দিয়ে তৈরি।
// এতে ফাইল সাইজ বাড়ে না, কপিরাইটের ঝামেলা নেই, আর সুরগুলো Sync-এর নিজের।
//
// নির্ভরযোগ্যতার ৩টা নিয়ম (ভয়েস রেকর্ডিংয়ের সময় সাউন্ড কখনও বাজে, কখনও বাজে না — এই সমস্যার সমাধান):
//  1. ভারী সাউন্ড (pluck/swoosh/thump) আগে থেকেই বাফারে বানিয়ে রাখা হয় (pre-render)।
//     বাজানোর সময় আর গণিতের লুপ চলে না, শুধু একটা BufferSource চালু হয় — তাই UI আটকায় না, lag হয় না।
//  2. মাইক খুললে/রেকর্ডার চললে মোবাইলে AudioContext suspended/interrupted হয়ে যায়।
//     তাই বাজানোর আগে নিশ্চিত করা হয় context "running"; না হলে resume, তাতেও না হলে নতুন context।
//     আর দেরিতে (stale) বেজে ওঠা সাউন্ড বাদ দেওয়া হয়, যাতে ভুল সময়ে শব্দ না আসে।
//  3. recording-এর সাউন্ড আর কোনো debounce-এ আটকায় না, যাতে pause/play দ্রুত চাপলেও প্রতিবার বাজে।

const STORAGE_KEY = "sync-sounds";

let ctx = null;
let enabled = true;
try {
    enabled = localStorage.getItem(STORAGE_KEY) !== "off";
} catch {
    enabled = true;
}

const AudioCtxClass =
    typeof window !== "undefined"
        ? window.AudioContext || window.webkitAudioContext
        : null;

// resume-এর জন্য সর্বোচ্চ অপেক্ষা; এর বেশি দেরি হলে সাউন্ডটা আর বাজানো হয় না
const RESUME_TIMEOUT_MS = 280;
const MAX_STALE_MS = 450;

const isRunning = c => c && c.state === "running";

const createCtx = () => {
    if (!AudioCtxClass) return null;
    try {
        const c = new AudioCtxClass({ latencyHint: "interactive" });
        // কোনো কারণে (ফোন কল, মাইক চালু, ট্যাব ব্যাকগ্রাউন্ড) থেমে গেলে নিজে থেকেই চালু করার চেষ্টা
        c.onstatechange = () => {
            if (c === ctx && (c.state === "suspended" || c.state === "interrupted")) {
                c.resume().catch(() => {});
            }
        };
        return c;
    } catch {
        try {
            return new AudioCtxClass();
        } catch {
            return null;
        }
    }
};

const getCtx = () => {
    if (!ctx || ctx.state === "closed") ctx = createCtx();
    if (ctx && !isRunning(ctx)) ctx.resume().catch(() => {});
    return ctx;
};

// রেকর্ডিংয়ের waveform-ও যেন একই context ব্যবহার করে (দ্বিতীয় AudioContext মোবাইলে সাউন্ড কেটে দেয়)
export const getSharedAudioContext = () => getCtx();

export const resumeAudio = () => {
    const c = getCtx();
    return c ? c.resume().catch(() => {}) : Promise.resolve();
};

// context যেন "running" হয়ে যায় — সর্বোচ্চ RESUME_TIMEOUT_MS অপেক্ষা করে
const waitRunning = c =>
    new Promise(resolve => {
        if (isRunning(c)) return resolve(true);
        let done = false;
        const finish = ok => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve(ok);
        };
        const timer = setTimeout(() => finish(isRunning(c)), RESUME_TIMEOUT_MS);
        try {
            c.resume().then(() => finish(isRunning(c)), () => finish(false));
        } catch {
            finish(false);
        }
    });

// প্রথম touch/click-এর আগে ব্রাউজার সাউন্ড চালাতে দেয় না, তাই ইউজারের প্রথম ইশারাতেই চালু করে নেওয়া হয়।
// context সত্যিই "running" না হওয়া পর্যন্ত listener থাকে (iOS-এ প্রথমবার ব্যর্থ হতে পারে)।
const UNLOCK_EVENTS = ["pointerdown", "touchstart", "touchend", "click", "keydown"];
if (typeof window !== "undefined") {
    const unlock = () => {
        const c = getCtx();
        if (!c) return;
        try {
            // নিঃশব্দ ১ ফ্রেম বাজালে iOS পুরোপুরি unlock হয়
            const s = c.createBufferSource();
            s.buffer = c.createBuffer(1, 1, c.sampleRate);
            s.connect(c.destination);
            s.start(0);
        } catch {
            // ignore
        }
        prewarm();
        c.resume()
            .then(() => {
                if (isRunning(c)) {
                    UNLOCK_EVENTS.forEach(ev => window.removeEventListener(ev, unlock, true));
                }
            })
            .catch(() => {});
    };
    UNLOCK_EVENTS.forEach(ev =>
        window.addEventListener(ev, unlock, { passive: true, capture: true })
    );
    // ট্যাবে ফিরলে বা ফোনের অডিও ফিরে এলে আবার চালু
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && ctx && !isRunning(ctx)) {
            ctx.resume().catch(() => {});
        }
    });
}

// ---------------- হালকা (oscillator) সাউন্ড: অডিও থ্রেডেই চলে, CPU লাগে না ----------------

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

// ---------------- নিজের হাতে গণিত দিয়ে বানানো সাউন্ড (sin · cos · tan) ----------------
// প্রতিটা নমুনা (sample) সরাসরি সূত্র থেকে বসানো হয়। একবারই বানিয়ে cache করা হয়।
const TWO_PI = Math.PI * 2;

// tan দিয়ে নরম saturation: কড়া ক্লিপিং ছাড়াই সুরে উষ্ণতা আসে, আউটপুট -1..1
const TAN_K = 0.85;
const TAN_NORM = Math.tan(TAN_K);
const softTan = x => Math.tan(Math.max(-1, Math.min(1, x)) * TAN_K) / TAN_NORM;

// একটা layer (স্তর) রেন্ডার করে: echo দিলে ফিডব্যাক-ডিলে যোগ হয় (ছোট ঘরের প্রতিধ্বনির মত)
const renderLayer = (rate, { dur, gain = 0.2, fn, echo = 0, echoFb = 0.3 }) => {
    const n = Math.max(1, Math.floor(dur * rate));
    const data = new Float32Array(n);
    for (let i = 0; i < n; i += 1) data[i] = fn(i / rate, i / n);
    if (echo > 0) {
        const d = Math.floor(echo * rate);
        for (let i = d; i < n; i += 1) data[i] += data[i - d] * echoFb;
    }
    const amp = gain * 1.8;
    for (let i = 0; i < n; i += 1) data[i] = softTan(data[i]) * amp;
    return data;
};

// কাচ/মারিম্বার মত "pluck": FM সিন্থ। sin দিয়ে সুর, ভেতরে cos-ফেজের মডুলেটর,
// মডুলেশন ইনডেক্স দ্রুত কমে যায় বলে শুরুতে ঝকঝকে, তারপর নরম হয়ে মিলিয়ে যায়।
const pluck = ({ f, at = 0, dur = 0.3, gain = 0.22, idx = 2.4, ratio = 2, decay = 8, echo = 0.085 }) => ({
    at,
    dur,
    gain,
    echo,
    echoFb: 0.32,
    fn: t => {
        const attack = Math.min(1, t / 0.004);
        const amp = attack * Math.exp(-t * decay);
        const mod = idx * Math.exp(-t * decay * 1.6);
        const m = Math.cos(TWO_PI * f * ratio * t);
        return (
            (Math.sin(TWO_PI * f * t + mod * m) + 0.18 * Math.sin(TWO_PI * f * 3 * t)) * amp
        );
    }
});

// বাতাসের "ঝুউউশ": sin-হ্যাশ noise → state-variable band-pass filter, কেন্দ্র-ফ্রিকোয়েন্সি hi → lo গড়ায়
const swoosh = rate => ({ dur = 0.28, at = 0, gain = 0.2, from = 5200, to = 500 }) => {
    let low = 0;
    let band = 0;
    return {
        at,
        dur,
        gain,
        fn: (t, p) => {
            const h = Math.sin(t * 12.9898 * 43758.5453) * 43758.5453;
            const noise = (h - Math.floor(h)) * 2 - 1;
            const fc = from * Math.pow(to / from, p);
            const f = 2 * Math.sin((Math.PI * fc) / rate);
            const high = noise - low - 0.45 * band;
            band += f * high;
            low += f * band;
            const env = Math.sin(Math.PI * Math.pow(p, 0.7)) * Math.cos((p * Math.PI) / 2);
            return band * 1.6 * env;
        }
    };
};

// নিচু গোল "থাপ": sin-এর ফ্রিকোয়েন্সি দ্রুত নামে
const thump = ({ at = 0, dur = 0.16, gain = 0.3, f0 = 170, f1 = 55 }) => ({
    at,
    dur,
    gain,
    fn: (t, p) => {
        const ph = TWO_PI * (f0 * t + ((f1 - f0) * t * t) / (2 * dur));
        return Math.sin(ph) * Math.exp(-p * 5.5) * Math.min(1, t / 0.003);
    }
});

// কয়েকটা layer মিলিয়ে একটাই বাফার বানায়
const mixLayers = (rate, layers) => {
    const rendered = layers.map(l => ({
        offset: Math.floor((l.at || 0) * rate),
        data: renderLayer(rate, l)
    }));
    const total = rendered.reduce((m, r) => Math.max(m, r.offset + r.data.length), 1);
    const out = new Float32Array(total);
    rendered.forEach(({ offset, data }) => {
        for (let i = 0; i < data.length; i += 1) out[offset + i] += data[i];
    });
    return out;
};

// buf: আগে থেকে রেন্ডার-করা বাফার সাউন্ড · osc: oscillator সাউন্ড
const buf = layersFn => ({ layersFn });
const osc = play => ({ play });

const SOUNDS = {
    // ভয়েস রেকর্ড শুরু: দুটো ঝকঝকে নোট, ওপরে ওঠা (E5 → B5)
    recStart: buf(() => [
        pluck({ f: 659.25, dur: 0.22, gain: 0.2, decay: 11 }),
        pluck({ f: 987.77, at: 0.07, dur: 0.26, gain: 0.2, decay: 10 })
    ]),
    // pause: নরম নামমুখী দুই নোট (G5 → D5), গোল ও শান্ত
    recPause: buf(() => [
        pluck({ f: 783.99, dur: 0.24, gain: 0.22, idx: 1.4, ratio: 1, decay: 9 }),
        pluck({ f: 587.33, at: 0.1, dur: 0.3, gain: 0.22, idx: 1.2, ratio: 1, decay: 8 })
    ]),
    // play/resume: তিন নোটের দ্রুত আরোহী arpeggio (D5 → A5 → D6), উজ্জ্বল
    recPlay: buf(() => [
        pluck({ f: 587.33, dur: 0.2, gain: 0.19, idx: 2.8, decay: 11 }),
        pluck({ f: 880, at: 0.065, dur: 0.22, gain: 0.19, idx: 2.8, decay: 11 }),
        pluck({ f: 1174.66, at: 0.13, dur: 0.3, gain: 0.2, idx: 2.8, decay: 9 })
    ]),
    // delete: বাতাসের ঝুউউশ + নামমুখী দুই নোট + শেষে নিচু থাপ
    recDelete: buf(rate => [
        swoosh(rate)({ dur: 0.3, gain: 0.22 }),
        pluck({ f: 523.25, at: 0.04, dur: 0.22, gain: 0.16, idx: 1.6, ratio: 1, decay: 12, echo: 0 }),
        pluck({ f: 349.23, at: 0.13, dur: 0.24, gain: 0.16, idx: 1.6, ratio: 1, decay: 12, echo: 0 }),
        thump({ at: 0.24, gain: 0.3 })
    ]),
    // মেসেজ পাঠানো: ছোট উঁচু-হওয়া "ফুট"
    send: osc(c => {
        note(c, { freq: 420, slideTo: 760, dur: 0.11, type: "sine", gain: 0.15 });
        note(c, { freq: 1180, at: 0.07, dur: 0.06, type: "triangle", gain: 0.05 });
    }),
    // চালু চ্যাটে মেসেজ আসা: নরম দুই নোটের ঘণ্টা
    receive: osc(c => {
        bell(c, 659, 0, 0.16, 0.13);
        bell(c, 988, 0.1, 0.24, 0.12);
    }),
    // অন্য চ্যাটে/ব্যাকগ্রাউন্ডে মেসেজ আসা: চার নোটের ছোট চাইম
    notify: osc(c => {
        [523, 659, 784, 1047].forEach((f, i) => bell(c, f, i * 0.085, 0.28, 0.12));
    }),
    // পাঠাতে ব্যর্থ: নিচু নামমুখী দুই সুর
    error: osc(c => {
        note(c, { freq: 247, dur: 0.16, type: "triangle", gain: 0.12 });
        note(c, { freq: 185, at: 0.14, dur: 0.24, type: "triangle", gain: 0.12 });
    }),
    // আপলোড শেষ: দ্রুত উঠে যাওয়া "টুং"
    done: osc(c => {
        bell(c, 880, 0, 0.14, 0.12);
        bell(c, 1320, 0.08, 0.26, 0.12);
    })
};

// ---------------- বাফার cache ----------------
// Float32Array গুলো sampleRate অনুযায়ী একবারই বানানো হয়; AudioBuffer যেকোনো context-এ চলে।
const PRELOAD_RATE = 44100;
const bufferCache = {};

const getBuffer = (c, name) => {
    const def = SOUNDS[name];
    if (!def || !def.layersFn) return null;
    if (!bufferCache[name]) {
        const rate = c.sampleRate || PRELOAD_RATE;
        const samples = mixLayers(rate, def.layersFn(rate));
        const ab = c.createBuffer(1, samples.length, rate);
        ab.getChannelData(0).set(samples);
        bufferCache[name] = ab;
    }
    return bufferCache[name];
};

// একটা একটা করে, ফাঁকা সময়ে বানানো হয় — যাতে কোনো frame আটকে না যায়
let prewarmStarted = false;
function prewarm() {
    if (prewarmStarted || !ctx) return;
    prewarmStarted = true;
    const names = Object.keys(SOUNDS).filter(n => SOUNDS[n].layersFn);
    const step = () => {
        const name = names.shift();
        if (!name) return;
        try {
            if (ctx && ctx.state !== "closed") getBuffer(ctx, name);
        } catch {
            // পরে বাজানোর সময় আবার চেষ্টা হবে
        }
        schedule(step);
    };
    const schedule = fn =>
        typeof requestIdleCallback === "function"
            ? requestIdleCallback(fn, { timeout: 400 })
            : setTimeout(fn, 30);
    schedule(step);
}

const startSound = (c, name) => {
    const def = SOUNDS[name];
    if (def.play) {
        def.play(c);
        return;
    }
    const ab = getBuffer(c, name);
    if (!ab) return;
    const src = c.createBufferSource();
    src.buffer = ab;
    src.connect(c.destination);
    src.start(0);
};

// মেসেজ সাউন্ডে একসাথে অনেক মেসেজ এলে কানফাটা শব্দ এড়াতে ন্যূনতম বিরতি।
// recording-এর সাউন্ডে প্রায় কোনো বিরতি নেই, যাতে দ্রুত pause/play চাপলেও প্রতিবার বাজে।
const MIN_GAP = { recStart: 60, recPause: 60, recPlay: 60, recDelete: 60 };
const DEFAULT_GAP = 220;
const lastPlayed = {};

const rebuildCtx = () => {
    const old = ctx;
    ctx = null;
    if (old && old.state !== "closed") old.close().catch(() => {});
    return getCtx();
};

export const playSound = name => {
    if (!enabled || !SOUNDS[name]) return;
    const requestedAt = performance.now();
    const gap = MIN_GAP[name] ?? DEFAULT_GAP;
    if (lastPlayed[name] && requestedAt - lastPlayed[name] < gap) return;
    lastPlayed[name] = requestedAt;

    let c = getCtx();
    if (!c) return;

    const fire = target => {
        // দেরিতে (stale) বেজে ওঠা শব্দ বাদ: ভুল মুহূর্তে শব্দ আসার চেয়ে না আসা ভালো
        if (performance.now() - requestedAt > MAX_STALE_MS) return;
        try {
            startSound(target, name);
        } catch {
            // সাউন্ড চালাতে না পারলে অ্যাপ থামবে না
        }
    };

    // স্বাভাবিক পথ: context চালু আছে → সঙ্গে সঙ্গে বাজাও (কোনো async দেরি নেই)
    if (isRunning(c)) {
        fire(c);
        return;
    }

    // মাইক/রেকর্ডার চালু হওয়ায় context থেমে গেলে: resume করে বাজাও,
    // না হলে (যেমন iOS "interrupted") নতুন context বানিয়ে আবার চেষ্টা
    waitRunning(c).then(ok => {
        if (ok) return fire(c);
        const fresh = rebuildCtx();
        if (!fresh) return;
        waitRunning(fresh).then(ok2 => {
            if (ok2) fire(fresh);
        });
    });
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
