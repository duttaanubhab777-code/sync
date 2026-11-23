// ছোট QR Code encoder (কোনো লাইব্রেরি লাগে না)।
// Byte mode + error-correction level H (৩০% নষ্ট হলেও স্ক্যান হয়, তাই মাঝখানে প্রোফাইল ছবি বসানো যায়)।
// Version ১–৪০ নিজে বেছে নেয়, ৮টা mask-এর মধ্যে সবচেয়ে ভালোটা নেয় (ISO/IEC 18004)।
// ফেরত দেয়: { size, modules: boolean[][] }  (true = কালো মডিউল)

// ECC level H: [ecc codewords per block, number of blocks] — index = version
const ECC_PER_BLOCK_H = [
    -1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30
];
const NUM_BLOCKS_H = [
    -1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81
];

const getNumRawDataModules = ver => {
    let result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
        const numAlign = Math.floor(ver / 7) + 2;
        result -= (25 * numAlign - 10) * numAlign - 55;
        if (ver >= 7) result -= 36;
    }
    return result;
};

const getNumDataCodewords = ver =>
    Math.floor(getNumRawDataModules(ver) / 8) - ECC_PER_BLOCK_H[ver] * NUM_BLOCKS_H[ver];

// ---------- Reed–Solomon (GF(256), poly 0x11D) ----------
const rsMultiply = (x, y) => {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
        z = (z << 1) ^ ((z >>> 7) * 0x11d);
        z ^= ((y >>> i) & 1) * x;
    }
    return z;
};

const rsDivisor = degree => {
    const result = new Array(degree).fill(0);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
        for (let j = 0; j < result.length; j++) {
            result[j] = rsMultiply(result[j], root);
            if (j + 1 < result.length) result[j] ^= result[j + 1];
        }
        root = rsMultiply(root, 0x02);
    }
    return result;
};

const rsRemainder = (data, divisor) => {
    const result = divisor.map(() => 0);
    for (const b of data) {
        const factor = b ^ result.shift();
        result.push(0);
        divisor.forEach((coef, i) => {
            result[i] ^= rsMultiply(coef, factor);
        });
    }
    return result;
};

const addEccAndInterleave = (data, ver) => {
    const numBlocks = NUM_BLOCKS_H[ver];
    const blockEccLen = ECC_PER_BLOCK_H[ver];
    const rawCodewords = Math.floor(getNumRawDataModules(ver) / 8);
    const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
    const shortBlockLen = Math.floor(rawCodewords / numBlocks);

    const blocks = [];
    const divisor = rsDivisor(blockEccLen);
    for (let i = 0, k = 0; i < numBlocks; i++) {
        const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
        k += dat.length;
        const ecc = rsRemainder(dat, divisor);
        if (i < numShortBlocks) dat.push(0);
        blocks.push(dat.concat(ecc));
    }

    const result = [];
    for (let i = 0; i < blocks[0].length; i++) {
        blocks.forEach((block, j) => {
            if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(block[i]);
        });
    }
    return result;
};

// ---------- Function patterns ----------
const getAlignmentPositions = ver => {
    if (ver === 1) return [];
    const numAlign = Math.floor(ver / 7) + 2;
    const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
    const result = [6];
    for (let pos = ver * 4 + 10; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
    return result;
};

const buildMatrix = ver => {
    const size = ver * 4 + 17;
    const modules = Array.from({ length: size }, () => new Array(size).fill(false));
    const isFunction = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, dark) => {
        modules[y][x] = dark;
        isFunction[y][x] = true;
    };

    for (let i = 0; i < size; i++) {
        set(6, i, i % 2 === 0);
        set(i, 6, i % 2 === 0);
    }
    const finder = (cx, cy) => {
        for (let dy = -4; dy <= 4; dy++) {
            for (let dx = -4; dx <= 4; dx++) {
                const dist = Math.max(Math.abs(dx), Math.abs(dy));
                const x = cx + dx;
                const y = cy + dy;
                if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, dist !== 2 && dist !== 4);
            }
        }
    };
    finder(3, 3);
    finder(size - 4, 3);
    finder(3, size - 4);

    const align = getAlignmentPositions(ver);
    const n = align.length;
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
            for (let dy = -2; dy <= 2; dy++) {
                for (let dx = -2; dx <= 2; dx++) {
                    set(align[i] + dx, align[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
                }
            }
        }
    }

    // format bits-এর জায়গা (পরে বসবে) + version info
    const drawFormat = mask => {
        const data = (2 << 3) | mask; // ECC level H = 2
        let rem = data;
        for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
        const bits = ((data << 10) | rem) ^ 0x5412;
        const bit = i => ((bits >>> i) & 1) !== 0;
        for (let i = 0; i <= 5; i++) set(8, i, bit(i));
        set(8, 7, bit(6));
        set(8, 8, bit(7));
        set(7, 8, bit(8));
        for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
        for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
        for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
        set(8, size - 8, true);
    };
    drawFormat(0);

    if (ver >= 7) {
        let rem = ver;
        for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
        const bits = (ver << 12) | rem;
        for (let i = 0; i < 18; i++) {
            const dark = ((bits >>> i) & 1) !== 0;
            const a = size - 11 + (i % 3);
            const b = Math.floor(i / 3);
            set(a, b, dark);
            set(b, a, dark);
        }
    }
    return { size, modules, isFunction, drawFormat };
};

const placeData = (m, codewords) => {
    const { size, modules, isFunction } = m;
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
        if (right === 6) right = 5;
        for (let vert = 0; vert < size; vert++) {
            for (let j = 0; j < 2; j++) {
                const x = right - j;
                const upward = ((right + 1) & 2) === 0;
                const y = upward ? size - 1 - vert : vert;
                if (!isFunction[y][x] && i < codewords.length * 8) {
                    modules[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
                    i++;
                }
            }
        }
    }
};

const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x, y) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
];

const applyMask = (m, mask) => {
    for (let y = 0; y < m.size; y++) {
        for (let x = 0; x < m.size; x++) {
            if (!m.isFunction[y][x] && MASKS[mask](x, y)) m.modules[y][x] = !m.modules[y][x];
        }
    }
};

const penalty = ({ size, modules }) => {
    let result = 0;
    const runPenalty = line => {
        let run = 1;
        for (let i = 1; i <= line.length; i++) {
            if (i < line.length && line[i] === line[i - 1]) run++;
            else {
                if (run >= 5) result += 3 + (run - 5);
                run = 1;
            }
        }
        // finder-like pattern 1011101 + 4 light
        const s = line.map(v => (v ? "1" : "0")).join("");
        for (let i = 0; i + 11 <= s.length; i++) {
            const w = s.slice(i, i + 11);
            if (w === "10111010000" || w === "00001011101") result += 40;
        }
    };
    for (let y = 0; y < size; y++) runPenalty(modules[y]);
    for (let x = 0; x < size; x++) runPenalty(modules.map(row => row[x]));
    for (let y = 0; y < size - 1; y++) {
        for (let x = 0; x < size - 1; x++) {
            const c = modules[y][x];
            if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) result += 3;
        }
    }
    let dark = 0;
    modules.forEach(row => row.forEach(v => (dark += v ? 1 : 0)));
    const total = size * size;
    result += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return result;
};

export function encodeQr(text) {
    const bytes = Array.from(new TextEncoder().encode(String(text)));

    let ver = 1;
    for (; ver <= 40; ver++) {
        const countBits = ver <= 9 ? 8 : 16;
        if (4 + countBits + bytes.length * 8 <= getNumDataCodewords(ver) * 8) break;
    }
    if (ver > 40) throw new Error("QR data too long");

    const bits = [];
    const push = (val, len) => {
        for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
    };
    push(0b0100, 4);
    push(bytes.length, ver <= 9 ? 8 : 16);
    bytes.forEach(b => push(b, 8));
    const capBits = getNumDataCodewords(ver) * 8;
    push(0, Math.min(4, capBits - bits.length));
    push(0, (8 - (bits.length % 8)) % 8);
    for (let pad = 0xec; bits.length < capBits; pad ^= 0xec ^ 0x11) push(pad, 8);

    const data = [];
    for (let i = 0; i < bits.length; i += 8) {
        let v = 0;
        for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
        data.push(v);
    }

    const all = addEccAndInterleave(data, ver);
    const m = buildMatrix(ver);
    placeData(m, all);

    let best = 0;
    let bestScore = Infinity;
    for (let mask = 0; mask < 8; mask++) {
        applyMask(m, mask);
        m.drawFormat(mask);
        const score = penalty(m);
        if (score < bestScore) {
            best = mask;
            bestScore = score;
        }
        applyMask(m, mask); // XOR, তাই আবার চালালে আগের অবস্থায় ফেরে
    }
    applyMask(m, best);
    m.drawFormat(best);

    return { size: m.size, modules: m.modules, isFunction: m.isFunction, version: ver };
}
