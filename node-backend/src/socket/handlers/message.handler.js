import io from "./index.js";

io.on("connection", socket => {
    socket.join(`user: ${socket.user._id}`);

    registerMassageHandler(io, socket);

    socket.on("disconnect", reason => {
        console.log("Disconnect: ", reason);
    });
});
