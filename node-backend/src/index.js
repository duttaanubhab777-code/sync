import "dotenv/config";
import connectDB, { prepareDatabase } from "./db/db.js";
import "./models/user.model.js"; // model-গুলো আগে import করতেই হবে



await connectDB();
await prepareDatabase();
