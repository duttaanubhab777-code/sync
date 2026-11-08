import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { ApiError } from "./utils/ApiError.js";
import apiRouter from "./routes/index.js";
import { apiLimiter } from "./middlewares/rateLimit.middleware.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const isProd = () =>
    process.env.NODE_ENV === "production" || Boolean(process.env.RENDER);

// ---------- proxy ----------
// Render প্রক্সির পেছনে চলে। trust proxy ঠিক থাকলে Express নিজেই আসল ক্লায়েন্ট IP (req.ip) দেয়,
// আর rate limit সেটাই ব্যবহার করে। (X-Forwarded-For-এর প্রথম মান নিজে পড়া নিরাপদ নয়, কেউ নকল করতে পারে)
// .env-এ TRUST_PROXY=1 দিলে সেটা, নাহলে Render-এ (RENDER ভ্যারিয়েবল থাকে) নিজে থেকেই 1
if (process.env.TRUST_PROXY) {
    const v = process.env.TRUST_PROXY;
    app.set(
        "trust proxy",
        /^\d+$/.test(v) ? Number(v) : v === "true" ? true : v
    );
} else if (process.env.RENDER) {
    app.set("trust proxy", 1);
}

// ---------- CORS ----------
// frontend ও backend এখন একই service/origin থেকে চলে, তাই প্রোডাকশনে CORS লাগে না।
// লোকাল ডেভেলপমেন্টে frontend আলাদা পোর্টে চালালে FRONTEND_URL-এ সেই origin দাও (কমা দিয়ে একাধিক)।
export const allowedOrigins = (process.env.FRONTEND_URL || "")
    .split(",")
    .map(u => u.trim().replace(/\/+$/, ""))
    .filter(Boolean);

// ---------- নিরাপত্তা (helmet + CSP) ----------
// Cloudinary-তে সরাসরি আপলোড (api.cloudinary.com) আর Python সার্ভিসে (media sign) কল যেন আটকে না যায়,
// তাই connect-src-এ এগুলো খোলা। Socket.io client নিজের সার্ভার থেকেই আসে: <script src="/socket.io/socket.io.js">
const originOf = url => {
    try {
        return new URL(url).origin;
    } catch {
        return null;
    }
};
const pythonOrigin = originOf(process.env.PYTHON_SERVICE_URL);
const allowInlineScripts = process.env.ALLOW_INLINE_SCRIPTS === "true";

app.use(
    helmet({
        contentSecurityPolicy: {
            useDefaults: true,
            directives: {
                "default-src": ["'self'"],
                "script-src": allowInlineScripts
                    ? ["'self'", "'unsafe-inline'"]
                    : ["'self'"],
                // onclick="..." জাতীয় inline handler (ALLOW_INLINE_SCRIPTS=true হলে চলবে)
                "script-src-attr": allowInlineScripts
                    ? ["'unsafe-inline'"]
                    : ["'none'"],
                "style-src": [
                    "'self'",
                    "'unsafe-inline'",
                    "https://fonts.googleapis.com"
                ],
                "font-src": ["'self'", "data:", "https://fonts.gstatic.com"],
                "img-src": [
                    "'self'",
                    "data:",
                    "blob:",
                    "https://res.cloudinary.com"
                ],
                "media-src": ["'self'", "blob:", "https://res.cloudinary.com"],
                "connect-src": [
                    "'self'",
                    "https://api.cloudinary.com",
                    ...(pythonOrigin ? [pythonOrigin] : [])
                ],
                // লোকাল http ডেভেলপমেন্টে এটা থাকলে সব http রিসোর্স https হয়ে ভেঙে যায়
                "upgrade-insecure-requests": isProd() ? [] : null
            }
        }
    })
);
app.use(
    cors({
        origin: allowedOrigins,
        credentials: true
    })
);
app.use(express.json({ limit: "64kb" }));
app.use(express.urlencoded({ extended: true, limit: "64kb" }));
app.use(cookieParser());

// Render কোল্ড স্টার্ট জাগানো ও UptimeRobot ping-এর জন্য (DB ছোঁয় না, তাই হালকা)
app.get("/health", (_req, res) => {
    res.status(200).json({
        ok: true,
        service: "sync-node-backend",
        timestamp: new Date().toISOString()
    });
});

// ---------- API ----------
app.use("/api", apiLimiter, apiRouter);
app.use("/api", (_req, res) => {
    res.status(404).json({
        success: false,
        statusCode: 404,
        message: "API route not found",
        errors: []
    });
});

// ---------- Frontend (একই service থেকে static ফাইল) ----------
// repo-র frontend/ ফোল্ডার। অন্য জায়গায় রাখলে .env-এ FRONTEND_DIR দাও।
const FRONTEND_DIR = process.env.FRONTEND_DIR
    ? path.resolve(process.env.FRONTEND_DIR)
    : path.resolve(__dirname, "../../frontend");
const INDEX_FILE = path.join(FRONTEND_DIR, "index.html");
const hasFrontend = fs.existsSync(INDEX_FILE);

if (hasFrontend) {
    app.use(
        express.static(FRONTEND_DIR, {
            index: "index.html",
            // /login লিখলে login.html খুলবে
            extensions: ["html"],
            setHeaders: (res, filePath) => {
                // HTML সবসময় নতুন, বাকি ফাইল (css/js/ছবি) ১ ঘণ্টা cache
                res.setHeader(
                    "Cache-Control",
                    filePath.endsWith(".html")
                        ? "no-cache"
                        : "public, max-age=3600"
                );
            }
        })
    );

    // ব্রাউজারে সরাসরি অন্য পথ খুললে (যেমন /chat) index.html দেওয়া; ফাইলের এক্সটেনশন থাকলে (যেমন /missing.js) নয়
    app.use((req, res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") return next();
        if (path.extname(req.path)) return next();
        if (!req.accepts("html")) return next();
        res.sendFile(INDEX_FILE);
    });
} else {
    console.warn(
        `[Sync Server] Frontend not found at ${FRONTEND_DIR} (index.html নেই), শুধু API চলবে`
    );
    app.get("/", (_req, res) => {
        res.status(200).json({ ok: true, service: "sync-node-backend" });
    });
}

app.use((_req, res) => {
    res.status(404).json({
        success: false,
        statusCode: 404,
        message: "Not found",
        errors: []
    });
});

// ---------- গ্লোবাল এরর হ্যান্ডলার ----------
// কোনো এরর এলে সার্ভার ক্র্যাশ না করে সুন্দর JSON দেয়। অজানা (৫০০) এররের ভেতরের তথ্য প্রোডাকশনে বাইরে যায় না।
app.use((err, _req, res, next) => {
    if (res.headersSent) return next(err);

    let statusCode = 500;
    let message = "Internal Server Error";
    let errors = [];

    if (err instanceof ApiError) {
        statusCode = err.statusCode;
        message = err.message;
        errors = err.errors || [];
    } else if (err?.type === "entity.parse.failed") {
        statusCode = 400;
        message = "Invalid JSON body";
    } else if (err?.type === "entity.too.large") {
        statusCode = 413;
        message = "Request body is too large";
    } else if (err?.name === "ValidationError") {
        statusCode = 400;
        message =
            Object.values(err.errors || {})[0]?.message || "Invalid data";
    } else if (err?.name === "CastError") {
        statusCode = 400;
        message = "Invalid id";
    } else if (err?.code === 11000) {
        statusCode = 409;
        message = "Already exists";
    } else {
        console.error("[Unhandled Error]", err);
        if (!isProd()) message = err?.message || message;
    }

    res.status(statusCode).json({
        success: false,
        statusCode,
        message,
        errors
    });
});

export { app };
