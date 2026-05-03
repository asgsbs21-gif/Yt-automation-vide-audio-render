import { createServer } from "http";
import { Server } from "socket.io";
import app from "./app.js";
import { setIO } from "./lib/socket.js";
import { startScheduler } from "./services/scheduler.js";
import { logger } from "./lib/logger.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const httpServer = createServer(app);

const io = new Server(httpServer, {
  path: "/api/socket.io",
  cors: { origin: true, credentials: true },
  transports: ["polling", "websocket"],
});

setIO(io);

io.on("connection", (socket) => {
  logger.info({ socketId: socket.id }, "Socket.io client connected");
  socket.on("disconnect", () => {
    logger.info({ socketId: socket.id }, "Socket.io client disconnected");
  });
});

httpServer.listen(port, () => {
  logger.info({ port }, "Server listening");
  startScheduler();
});
