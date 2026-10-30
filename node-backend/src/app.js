import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { ApiError } from "./utils/ApiError.js";

const app = express();

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

export { app };
