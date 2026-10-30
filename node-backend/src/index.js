import "dotenv/config";
import connectDB, { prepareDatabase } from "./db/db.js";

import { app } from "./app.js";
import { User } from "./models/user.model.js";
import { Conversation } from "./models/conversation.model.js";

import { Message } from "./models/message.model.js";

await connectDB();
await prepareDatabase();

const port = process.env.PORT || 3000;
const server = app.listen(port, "0.0.0.0", () => {
    console.log(`http://localhost${port}`);
});

/*

// Render নতুন deploy এর সময় SIGTERM দেয় — চলমান request শেষ করে সুন্দরভাবে বন্ধ
        const shutdown = signal => {
            console.log(`[${signal}] shutting down…`);
            server.close(() => mongoose.connection.close().finally(() => process.exit(0)));
            setTimeout(() => process.exit(0), 10_000).unref();
        };

        */

export { app };
