const express = require("express");
const http = require("http");
const path = require("path");
const { WebSocketServer } = require("ws");
const { GAME_CONSTANTS } = require("./constants");
const { GameServer } = require("./game-server");
const { LEVELS } = require("./levels");
const { RunStore } = require("./db");

try {
  process.loadEnvFile();
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const PORT = Number(process.env.PORT || 3000);
const HOST = "0.0.0.0";
const app = express();
const server = http.createServer(app);
const runStore = new RunStore();
const gameServer = new GameServer({ runStore });
const wss = new WebSocketServer({ server, maxPayload: 2048 });

app.use(express.static(path.join(__dirname, "..", "public")));
app.use(
  "/vendor",
  express.static(path.join(__dirname, "..", "node_modules", "three", "build")),
);

app.get("/health", (_request, response) => {
  response.json({ status: "ok", service: "little-boat" });
});

app.get("/api/levels", (_request, response) => {
  response.json({ levels: LEVELS });
});

wss.on("connection", (socket) => {
  gameServer.handleConnection(socket);
});

const tickTimer = setInterval(() => {
  gameServer.tick(GAME_CONSTANTS.fixedDelta);
}, 1000 / GAME_CONSTANTS.tickRate);

server.listen(PORT, HOST, () => {
  console.log(`The Little Boat is rowing at http://${HOST}:${PORT}`);
});

async function shutdown() {
  clearInterval(tickTimer);
  for (const socket of wss.clients) socket.terminate();
  wss.close();
  await runStore.close();
  server.close(() => process.exit(0));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
