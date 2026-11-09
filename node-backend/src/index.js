import "dotenv/config";
import http from "node:http";
import mongoose from "mongoose";
import connectDB, { prepareDatabase } from "./db/db.js";
import { app } from "./app.js";
import { initSocket } from "./socket/index.js";
// ডাটাবেস মডেলগুলো রেজিস্টার করা যাতে prepareDatabase ইনডেক্স তৈরি করতে পারে
import "./models/user.model.js";
import "./models/conversation.model.js";
import "./models/message.model.js";
import "./models/story.model.js";
import "./models/notification.model.js";
import "./models/push-subscription.model.js";
import "./models/notice.model.js";
import { User } from "./models/user.model.js";

const port = process.env.PORT || 8000;

// Express অ্যাপ দিয়ে HTTP সার্ভার তৈরি এবং তাতে Socket.IO যুক্ত করা
const server = http.createServer(app);
const io = initSocket(server);

// কন্ট্রোলার থেকেও যেন io ব্যবহার করা যায় সেজন্য app-এ সেট করে রাখা
app.set("io", io);

// Render-এর load balancer-এর idle timeout-এর চেয়ে বেশি রাখা, নইলে মাঝেমধ্যে 502 আসে
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

// Render Cold Start-এ যাতে সাথে সাথে পোর্ট ও /health রেসপন্স করে, তাই আগে server.listen চালু করা
server.listen(port, "0.0.0.0", () => {
    console.log(`[Sync Server] Running on http://0.0.0.0:${port}`);
});

// ব্যাকগ্রাউন্ডে MongoDB কানেকশন ও ইনডেক্স প্রস্তুত করা
(async () => {
    await connectDB();
    await prepareDatabase();
    await ensureSuperAdmin();
})();

// SUPER_ADMIN_EMAIL দেওয়া ইমেইলের অ্যাকাউন্ট আগে থেকেই থাকলেও Super Admin বানিয়ে দেওয়া
// (আগে শুধু নতুন register করার সময় হতো, তাই আগের অ্যাকাউন্ট কখনো admin হতো না)
async function ensureSuperAdmin() {
    const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
    if (!email) return;
    try {
        const res = await User.updateOne(
            { email, $or: [{ isSuperAdmin: { $ne: true } }, { role: { $ne: "superAdmin" } }] },
            { $set: { isSuperAdmin: true, role: "superAdmin", isBlocked: false } }
        );
        if (res.modifiedCount) console.log(`[Admin] ${email} is now the Super Admin`);
    } catch (err) {
        console.error("[Admin] ensureSuperAdmin failed:", err.message);
    }
}

// Render নতুন ডিপ্লয় করার সময় SIGTERM পাঠালে নিরাপদে বন্ধ হওয়া
const shutdown = signal => {
    console.log(`[${signal}] shutting down gracefully...`);

    server.close(() => {
        mongoose.connection.close().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 10_000).unref();
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
