import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import mongoose from "mongoose";
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
// frontend ও backend একই Render service/origin থেকে চলে, পাশাপাশি RENDER_EXTERNAL_URL ও FRONTEND_URL সাপোর্ট করবে
export const allowedOrigins = [
    ...(process.env.FRONTEND_URL || "").split(","),
    process.env.RENDER_EXTERNAL_URL || ""
]
    .map(u => u.trim().replace(/\/+$/, ""))
    .filter(Boolean);

export const corsOptions = {
    origin: (origin, callback) => {
        if (
            !origin ||
            allowedOrigins.length === 0 ||
            allowedOrigins.includes(origin)
        ) {
            return callback(null, true);
        }
        return callback(null, false);
    },
    credentials: true
};

// ---------- নিরাপত্তা (helmet + CSP) ----------
const originOf = url => {
    try {
        return new URL(url).origin;
    } catch {
        return null;
    }
};
const pythonOrigin = originOf(process.env.PYTHON_SERVICE_URL);
// Contact page ফর্ম browser থেকে সরাসরি Email Sender API-তে POST করে।
// এই origin connect-src-তে না থাকলে browser request ব্লক করে দেয় (মেইল যায় না, অথচ ফর্মে "sent" দেখায়)।
const DEFAULT_EMAIL_SENDER_URL = "https://email-sender-wy5o.onrender.com";
const emailSenderOrigin = originOf(
    process.env.EMAIL_SENDER_URL || DEFAULT_EMAIL_SENDER_URL
);
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
                    "https://res.cloudinary.com",
                    // link preview-এর thumbnail (og:image) যেকোনো https সাইট থেকে আসে
                    "https:"
                ],
                "media-src": ["'self'", "blob:", "https://res.cloudinary.com"],
                "connect-src": [
                    "'self'",
                    "ws:",
                    "wss:",
                    "https://api.cloudinary.com",
                    ...(pythonOrigin ? [pythonOrigin] : []),
                    ...(emailSenderOrigin ? [emailSenderOrigin] : [])
                ],
                "upgrade-insecure-requests": isProd() ? [] : null
            }
        }
    })
);
app.use(cors(corsOptions));
app.use(express.json({ limit: "64kb" }));
app.use(express.urlencoded({ extended: true, limit: "64kb" }));
app.use(cookieParser());

// Render কোল্ড স্টার্ট জাগানো ও UptimeRobot ping-এর জন্য + ফ্রন্টএন্ডের জন্য runtime public config
app.get("/health", (_req, res) => {
    res.status(200).json({
        ok: true,
        service: "sync-node-backend",
        dbConnected: mongoose.connection.readyState === 1,
        pythonServiceUrl: process.env.PYTHON_SERVICE_URL || "",
        cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME || "",
        // OTP ইমেইলের জন্য PYTHON_SERVICE_URL ও MAIL_RELAY_SECRET দুটোই সেট আছে কিনা (secret দেখানো হয় না)
        mailRelayConfigured: Boolean(
            process.env.PYTHON_SERVICE_URL && process.env.MAIL_RELAY_SECRET
        ),
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

// ---------- Frontend (একই Render Web Service থেকে Vite build serve করা) ----------
const resolveFrontendDir = () => {
    if (process.env.FRONTEND_DIR) {
        return path.resolve(process.env.FRONTEND_DIR);
    }
    return path.resolve(__dirname, "../../frontend/dist");
};

const FRONTEND_DIR = resolveFrontendDir();
const INDEX_FILE = path.join(FRONTEND_DIR, "index.html");
const hasFrontend = fs.existsSync(INDEX_FILE);

if (hasFrontend) {
    app.use(
        express.static(FRONTEND_DIR, {
            index: "index.html",
            extensions: ["html"],
            setHeaders: (res, filePath) => {
                // service worker ও manifest যেন কখনো পুরনো না থাকে (নইলে push-এর নতুন কোড ডিভাইসে পৌঁছায় না)
                if (
                    filePath.endsWith(".html") ||
                    filePath.endsWith(`${path.sep}sw.js`) ||
                    filePath.endsWith(`${path.sep}service-worker.js`) ||
                    filePath.endsWith(`${path.sep}manifest.webmanifest`)
                ) {
                    res.setHeader("Cache-Control", "no-cache");
                } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
                    res.setHeader(
                        "Cache-Control",
                        "public, max-age=31536000, immutable"
                    );
                } else {
                    res.setHeader("Cache-Control", "public, max-age=3600");
                }
            }
        })
    );

    // React Router SPA fallback: ব্রাউজারে সরাসরি /login, /chats, /stories ইত্যাদি খুললে index.html দেওয়া
    app.use((req, res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") return next();
        if (path.extname(req.path)) return next();
        if (!req.accepts("html")) return next();
        res.sendFile("index.html", { root: FRONTEND_DIR });
    });
} else {
    console.warn(
        `[Sync Server] Frontend build not found at ${FRONTEND_DIR} (index.html নেই, 'npm run build' চালানো হয়েছে কিনা দেখো), শুধু API চলবে`
    );
    app.get("/", (_req, res) => {
        res.status(200).json({
            ok: true,
            service: "sync-node-backend",
            warning:
                "Frontend build (frontend/dist) not found. Make sure Render Build Command is set to: npm run build"
        });
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
        message = Object.values(err.errors || {})[0]?.message || "Invalid data";
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
