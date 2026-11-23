import { encodeQr } from "./qrEncoder.js";
import { qrInitials } from "./qrLink.js";

// Sync লোগোর রঙ (গাঢ় করে নেওয়া, যাতে সাদা প্যানেলে স্ক্যানারের কন্ট্রাস্ট ভালো থাকে)
const C_DEEP = "#0e5a3e";
const C_LEAF = "#16804d";
const C_TEAL = "#0d7f7a";
const C_CYAN = "#0f7c8e";
const BG_0 = "#031512";
const BG_1 = "#0b2b24";

const FONT = '"Inter", "Hind Siliguri", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

const loadImage = src =>
    new Promise(resolve => {
        if (!src) return resolve(null);
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.decoding = "async";
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
    });

const rr = (ctx, x, y, w, h, r) => {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
};

const brandGradient = (ctx, x, y, w, h) => {
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, C_DEEP);
    g.addColorStop(0.35, C_LEAF);
    g.addColorStop(0.7, C_TEAL);
    g.addColorStop(1, C_CYAN);
    return g;
};

// QR-এর মডিউল আঁকা: পাশাপাশি মডিউল জুড়ে গোলাকার "তরল" ডিজাইন, তিন কোণে গোল finder, মাঝখানে ফাঁকা গোল জায়গা
function drawQrBody(ctx, qr, x0, y0, m) {
    const { size, modules } = qr;
    const holeR = size * 0.2 * m; // মাঝের ছবির জায়গা (ECC-H এর সীমার অনেক ভেতরে)
    const cx = x0 + (size * m) / 2;
    const cy = y0 + (size * m) / 2;

    const inFinder = (x, y) =>
        (x < 8 && y < 8) || (x >= size - 8 && y < 8) || (x < 8 && y >= size - 8);
    const dark = (x, y) => x >= 0 && y >= 0 && x < size && y < size && modules[y][x] && !inFinder(x, y);
    const inHole = (x, y) => Math.hypot(x0 + (x + 0.5) * m - cx, y0 + (y + 0.5) * m - cy) < holeR + m * 0.9;

    ctx.save();
    ctx.fillStyle = brandGradient(ctx, x0, y0, size * m, size * m);
    ctx.beginPath();
    const r = m * 0.5;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (!dark(x, y) || inHole(x, y)) continue;
            const L = dark(x - 1, y) && !inHole(x - 1, y);
            const R = dark(x + 1, y) && !inHole(x + 1, y);
            const T = dark(x, y - 1) && !inHole(x, y - 1);
            const B = dark(x, y + 1) && !inHole(x, y + 1);
            const px = x0 + x * m;
            const py = y0 + y * m;
            // কোনো কোণের দুই পাশেই প্রতিবেশী না থাকলে সেই কোণ গোল
            const tl = !L && !T ? r : 0;
            const tr = !R && !T ? r : 0;
            const br = !R && !B ? r : 0;
            const bl = !L && !B ? r : 0;
            // একটু বড় করে আঁকা, যাতে জোড়ায় সূক্ষ্ম ফাঁক না থাকে
            const e = 0.4;
            const ax = px - (L ? e : 0);
            const ay = py - (T ? e : 0);
            const aw = m + (L ? e : 0) + (R ? e : 0);
            const ah = m + (T ? e : 0) + (B ? e : 0);
            ctx.moveTo(ax + tl, ay);
            ctx.lineTo(ax + aw - tr, ay);
            if (tr) ctx.arc(ax + aw - tr, ay + tr, tr, -Math.PI / 2, 0);
            ctx.lineTo(ax + aw, ay + ah - br);
            if (br) ctx.arc(ax + aw - br, ay + ah - br, br, 0, Math.PI / 2);
            ctx.lineTo(ax + bl, ay + ah);
            if (bl) ctx.arc(ax + bl, ay + ah - bl, bl, Math.PI / 2, Math.PI);
            ctx.lineTo(ax, ay + tl);
            if (tl) ctx.arc(ax + tl, ay + tl, tl, Math.PI, Math.PI * 1.5);
            ctx.closePath();
        }
    }
    ctx.fill();

    // finder: বাইরে গোল রিং + ভেতরে গোল স্কয়ার
    const finder = (fx, fy) => {
        const x = x0 + fx * m;
        const y = y0 + fy * m;
        ctx.beginPath();
        rr(ctx, x, y, 7 * m, 7 * m, 2.3 * m);
        rr(ctx, x + m, y + m, 5 * m, 5 * m, 1.4 * m);
        ctx.fillStyle = brandGradient(ctx, x0, y0, size * m, size * m);
        ctx.fill("evenodd");
        ctx.beginPath();
        rr(ctx, x + 2 * m, y + 2 * m, 3 * m, 3 * m, 1.1 * m);
        ctx.fillStyle = C_DEEP;
        ctx.fill();
    };
    finder(0, 0);
    finder(size - 7, 0);
    finder(0, size - 7);
    ctx.restore();

    return { cx, cy, holeR };
}

function drawCenterBadge(ctx, cx, cy, holeR, img, initials, m) {
    // বাইরের সাদা গোল, তারপর ব্র্যান্ড গ্রেডিয়েন্ট রিং, তারপর ছবি/অক্ষর
    const outer = holeR + m * 0.55;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, outer, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();

    const ringW = Math.max(3, m * 0.42);
    ctx.beginPath();
    ctx.arc(cx, cy, outer - m * 0.1 - ringW / 2, 0, Math.PI * 2);
    ctx.lineWidth = ringW;
    ctx.strokeStyle = brandGradient(ctx, cx - outer, cy - outer, outer * 2, outer * 2);
    ctx.stroke();

    const inner = outer - m * 0.1 - ringW - m * 0.28;
    ctx.beginPath();
    ctx.arc(cx, cy, inner, 0, Math.PI * 2);
    ctx.clip();

    if (img) {
        const s = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, cx - inner, cy - inner, inner * 2, inner * 2);
    } else {
        const g = ctx.createLinearGradient(cx - inner, cy - inner, cx + inner, cy + inner);
        g.addColorStop(0, "#1c8f55");
        g.addColorStop(0.55, "#12907f");
        g.addColorStop(1, "#0f7c8e");
        ctx.fillStyle = g;
        ctx.fillRect(cx - inner, cy - inner, inner * 2, inner * 2);
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const fs = inner * (initials.length > 1 ? 0.92 : 1.15);
        ctx.font = `700 ${fs}px ${FONT}`;
        ctx.fillText(initials, cx, cy + fs * 0.04);
    }
    ctx.restore();
}

const fitText = (ctx, text, maxW, startPx, weight) => {
    let px = startPx;
    ctx.font = `${weight} ${px}px ${FONT}`;
    while (ctx.measureText(text).width > maxW && px > 18) {
        px -= 2;
        ctx.font = `${weight} ${px}px ${FONT}`;
    }
    return px;
};

// ফুল কার্ড (শেয়ার/ডাউনলোডের ছবিও এটাই)
export async function renderQrCard(canvas, { link, name, username, avatar }) {
    try {
        await document.fonts?.ready;
    } catch {
        /* ফন্ট না পেলে system font */
    }
    const [avatarImg, logoImg] = await Promise.all([loadImage(avatar), loadImage("/logo-mark.webp")]);

    const W = 720;
    const H = 980;
    const dpr = 2; // পরিষ্কার ছবির জন্য ১৪৪০×১৯৬০
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // ব্যাকগ্রাউন্ড
    ctx.save();
    ctx.beginPath();
    rr(ctx, 0, 0, W, H, 56);
    ctx.clip();
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, BG_1);
    bg.addColorStop(1, BG_0);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    const glow = (x, y, r, col) => {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, col);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
    };
    glow(110, 90, 420, "rgba(137,198,102,0.30)");
    glow(W - 60, H - 120, 480, "rgba(31,167,176,0.26)");
    ctx.restore();

    // হেডার: লোগো + Sync
    const logoS = 64;
    ctx.font = `800 46px ${FONT}`;
    ctx.textBaseline = "middle";
    const wm = "Sync";
    const wmW = ctx.measureText(wm).width;
    const hx = (W - (logoS + 16 + wmW)) / 2;
    if (logoImg) ctx.drawImage(logoImg, hx, 52, logoS, logoS);
    const tg = ctx.createLinearGradient(hx + logoS, 0, hx + logoS + wmW + 16, 0);
    tg.addColorStop(0, "#b6f34d");
    tg.addColorStop(0.5, "#00ed64");
    tg.addColorStop(1, "#2ccb9a");
    ctx.fillStyle = tg;
    ctx.textAlign = "left";
    ctx.fillText(wm, hx + logoS + 16, 52 + logoS / 2 + 2);

    // সাদা প্যানেল
    const panel = 560;
    const px = (W - panel) / 2;
    const py = 160;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 16;
    ctx.beginPath();
    rr(ctx, px, py, panel, panel, 48);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.restore();

    const qr = encodeQr(link);
    const quiet = 2; // সাদা কিনারা (মডিউলে)
    const pad = 22;
    const m = (panel - pad * 2) / (qr.size + quiet * 2);
    const origin = px + pad + quiet * m;
    const { cx, cy, holeR } = drawQrBody(ctx, qr, origin, py + pad + quiet * m, m);
    drawCenterBadge(ctx, cx, cy, holeR, avatarImg, qrInitials(name, username), m);

    // নিচের লেখা
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const title = String(name || username || "Sync user");
    fitText(ctx, title, W - 120, 44, 800);
    ctx.fillStyle = "#e8f7f0";
    ctx.fillText(title, W / 2, py + panel + 82);

    const handle = `@${username}`;
    fitText(ctx, handle, W - 120, 30, 600);
    const hg = ctx.createLinearGradient(W / 2 - 120, 0, W / 2 + 120, 0);
    hg.addColorStop(0, "#b6f34d");
    hg.addColorStop(1, "#2ccb9a");
    ctx.fillStyle = hg;
    ctx.fillText(handle, W / 2, py + panel + 130);

    ctx.fillStyle = "#9bb8ad";
    ctx.font = `500 24px ${FONT}`;
    ctx.fillText("Scan to chat with me on Sync", W / 2, py + panel + 188);
}

export const canvasToBlob = canvas =>
    new Promise(resolve => canvas.toBlob(b => resolve(b), "image/png"));
