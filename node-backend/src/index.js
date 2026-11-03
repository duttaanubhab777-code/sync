import "dotenv/config";
import http from "node:http";
import mongoose from "mongoose";
import connectDB, { prepareDatabase } from "./db/db.js";
import { app } from "./app.js";
import { initSocket } from "./socket/index.js";
// ডা টা বে স মডে লগুলো রে জি স্টা র করা যা তে prepareDatabase ইনডে ক্স তৈ রি করতে পা রে
import "./models/user.model.js";
import "./models/conversation.model.js";
import "./models/message.model.js";
import "./models/story.model.js";
await connectDB();
await prepareDatabase();
const port = process.env.PORT || 8000;
// Express অ্যা প দি য়ে HTTP সা র্ভা র তৈ রি এবং তা তে Socket.IO যুক্তযু করা
const server = http.createServer(app);
const io = initSocket(server);
// কন্ট্রো লা র থে কে ও যে ন io ব্য বহা র করা যা য় সে জন্য app-এ সে ট করে রা খা
app.set("io", io);
server.listen(port, "0.0.0.0", () => {
    console.log(`[Sync Server] Running on http://localhost:${port}`);
});
// Render নতুন ডি প্লয় করা র সময় SIGTERM পা ঠা লে নি রা পদে বন্ধ হওয়া
const shutdown = signal => {
    console.log(`[${signal}] shutting down gracefully...`);

    server.close(() => {
        mongoose.connection.close().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 10_000).unref();
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
