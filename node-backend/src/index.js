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
import "./models/pending-signup.model.js";
import { User } from "./models/user.model.js";
import { getSuperAdminEmails } from "./utils/superAdmin.js";

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
    await ensureSuperAdmins();
})();

// .env-এর SUPER_ADMIN_EMAILS তালিকার সাথে ডাটাবেস মিলিয়ে নেওয়া:
//  - তালিকার ইমেইলের অ্যাকাউন্ট আগে থেকে থাকলেও Super Admin হয়ে যায়
//  - তালিকা থেকে সরানো ইমেইলের Super Admin অধিকার চলে যায় (সাধারণ user হয়ে যায়)
//  - তালিকা পুরো ফাঁকা থাকলে কাউকে নামানো হয় না (ভুলে সবাই admin-হীন হয়ে না যায়)
async function ensureSuperAdmins() {
    const emails = getSuperAdminEmails();
    if (emails.length === 0) return;
    try {
        const promoted = await User.updateMany(
            {
                email: { $in: emails },
                $or: [
                    { isSuperAdmin: { $ne: true } },
                    { role: { $ne: "superAdmin" } },
                    { isBlocked: true }
                ]
            },
            { $set: { isSuperAdmin: true, role: "superAdmin", isBlocked: false } }
        );
        const demoted = await User.updateMany(
            {
                email: { $nin: emails },
                $or: [{ isSuperAdmin: true }, { role: "superAdmin" }]
            },
            { $set: { isSuperAdmin: false, role: "user" } }
        );
        if (promoted.modifiedCount || demoted.modifiedCount) {
            console.log(
                `[Admin] Super Admins synced from env (promoted: ${promoted.modifiedCount}, demoted: ${demoted.modifiedCount})`
            );
        }
    } catch (err) {
        console.error("[Admin] ensureSuperAdmins failed:", err.message);
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
