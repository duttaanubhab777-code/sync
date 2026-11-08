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

let connectingPromise = null;

const connectDB = async () => {
    if (mongoose.connection.readyState === 1) return;
    if (connectingPromise) return connectingPromise;

    connectingPromise = (async () => {
        while (mongoose.connection.readyState !== 1) {
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
                break;
            } catch (error) {
                console.error(
                    "MongoDB connection error (retrying in 5s):",
                    error.message
                );
                if (!process.env.MONGODB_URI) {
                    break;
                }
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
        connectingPromise = null;
    })();

    return connectingPromise;
};

mongoose.connection.on("disconnected", () => console.warn("[DB] disconnected"));
mongoose.connection.on("reconnected", () => console.log("[DB] reconnected"));

// Creates indexes in parallel for every registered model without blocking startup.
export const prepareDatabase = async () => {
    if (mongoose.connection.readyState !== 1) return;
    const models = Object.values(mongoose.models);
    await Promise.all(
        models.map(async model => {
            try {
                await model.createIndexes();
            } catch (error) {
                console.error(
                    `[DB] createIndexes failed for ${model.modelName}:`,
                    error.message
                );
            }
        })
    );
    console.log(`[DB] ready: ${models.length} models indexed`);
};

export default connectDB;
