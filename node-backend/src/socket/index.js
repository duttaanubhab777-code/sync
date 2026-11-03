import http from "http";
import { server } from "socket.io";
import app from "./app.js";

const httpServer = http.createServer(app);

export const io = new Server(httpServer, {
    cors: {
        origin: procces.env.FRONTEND_URL,
        credential: true
    }
});

httpServer.listen(process.env.PORT || 8000);

io.use(async (socket, next) => {
    try {
        const token = socket.handshake.auth?.token;
        if (!token) return next(new Error("NO_TOKEN"));
        const d = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
        const user = await User.findById(d._id).select("_id name");
        if (!user) return next(new Error("NO_USER"));
        socket.user = user; // req.user-এর মতো ই
        next();
    } catch {
        next(new Error("INVALID_TOKEN"));
    }
});
