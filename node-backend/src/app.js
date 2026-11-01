import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";

import helmet from "helemet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { ApiError } from "./utils/ApiError.js";

const app = express();

// Render প্রক্সি র পে ছনে আসল ক্লা য়ে ন্ট IP বে র করা র হে ল্পা র ফাং শন
const getClientIp = req => {
    const xff = req.headers["x-forwarded-for"];
    if (typeof xff === "string" && xff.length > 0) {
        return xff.split(",")[0].trim();
    }
    return req.socket?.remoteAddress || "";
};

// proxy এর পেছনে (Render, Railway ইত্যাদি) থাকলে .env তে TRUST_PROXY=1 দিন, নাহলে সঠিক IP পাওয়া যাবে না
if (process.env.TRUST_PROXY) {
    const v = process.env.TRUST_PROXY;
    app.set(
        "trust proxy",
        /^\d+$/.test(v) ? Number(v) : v === "true" ? true : v
    );
}

// সবার আগে ভিজিটরের আসল IP বসিয়ে দেওয়া — এরপর req.ip সব জায়গায় (login history, register,
// rate limit, ফর্মের মেসেজ) ঠিক IP দেয়। না হলে Render এ সবার IP একই (10.x) দেখাত।
app.use((req, res, next) => {
    Object.defineProperty(req, "ip", {
        value: getClientIp(req),
        configurable: true,
        enumerable: true,
        writable: true
    });
    next();
});

// সি কি উরি টি ও CORS কনফি গা রে শন (Vercel ফ্রন্টএন্ডে র জন্য )
app.use(helmet());
const allowedOrigins = (process.env.FRONTEND_URL || "http://localhost:5173")
    .split(",")
    .map(u => u.trim());
app.use(
    cors({
        origin: allowedOrigins,
        credentials: true
    })
);
app.use(express.json({ limit: "64kb" }));
app.use(express.urlencoded({ extended: true, limit: "64kb" }));
app.use(cookieParser());
// Render কো ল্ড স্টা র্ট জা গা নো র জন্য Health Check Endpoint
app.get("/health", (_req, res) => {
    res.status(200).json({
        ok: true,
        service: "sync-node-backend",
        timestamp: new Date().toISOString()
    });
});



      //Router import



// গ্লো বা ল এরর হ্যা ন্ডলা র (যা তে কো নো এরর এলে সা র্ভা র ক্র্যা শ না করে সুন্দসু র JSON দে য়)
app.use((err, _req, res, _next) => {
    const statusCode = err instanceof ApiError ? err.statusCode : 500;
    const message = err.message || "Internal Server Error";
    res.status(statusCode).json({
        success: false,
        statusCode,
        message,
        errors: err.errors || []
    });
});

export { app };
