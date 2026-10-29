import mongoose from "mongoose";
import { DB_NAME } from "../constants.js";

// Fail queries after 15s instead of hanging forever (useful during Render cold starts)
mongoose.set("bufferTimeoutMS", 15_000);

// Inserts the database name into any Atlas URI, with or without a trailing "/" or "?query".
export const buildMongoUri = (raw, dbName = DB_NAME) => {
    const uri = String(raw ?? "")
        .trim()
        .replace(/^["']|["']$/g, "");
    if (!uri) throw new Error("MONGODB_URI is not set");
    const scheme = uri.match(/^mongodb(?:\+srv)?:\/\//);
    if (!scheme)
        throw new Error(
            "MONGODB_URI must start with mongodb:// or mongodb+srv://"
        );

    const q = uri.indexOf("?");
    const base = q === -1 ? uri : uri.slice(0, q);
    const query = q === -1 ? "" : uri.slice(q);
    const rest = base.slice(scheme[0].length);
    const slash = rest.indexOf("/");
    const hosts = slash === -1 ? rest : rest.slice(0, slash);
    return `${scheme[0]}${hosts}/${dbName}${query}`;
};

const connectDB = async () => {
    try {
        const conn = await mongoose.connect(
            buildMongoUri(process.env.MONGODB_URI),
            {
                serverSelectionTimeoutMS: 15_000,
                socketTimeoutMS: 45_000
            }
        );
        console.log(
            `MongoDB connected: ${conn.connection.host}/${conn.connection.name}`
        );
    } catch (error) {
        console.error("MongoDB connection error:", error);
        process.exit(1);
    }
};

mongoose.connection.on("disconnected", () => console.warn("[DB] disconnected"));
mongoose.connection.on("reconnected", () => console.log("[DB] reconnected"));

// Creates collections and builds indexes for every registered model.
// Runs at startup so unique indexes (e.g. sender + clientMsgId) exist before the first request.
export const prepareDatabase = async () => {
    const models = Object.values(mongoose.models);
    for (const model of models) {
        try {
            await model.createCollection();
        } catch (error) {
            if (error?.codeName !== "NamespaceExists" && error?.code !== 48) {
                console.error(
                    `[DB] createCollection failed for ${model.modelName}:`,
                    error.message
                );
            }
        }
        try {
            await model.syncIndexes();
        } catch (error) {
            console.error(
                `[DB] syncIndexes failed for ${model.modelName}:`,
                error.message
            );
        }
    }
    console.log(`[DB] ready: ${models.length} models synced`);
};

export default connectDB;
