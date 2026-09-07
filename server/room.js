const { GAME_CONSTANTS } = require("./constants");
const { BoatSimulation } = require("./simulation");
const {
  CLIENT_MESSAGES,
  SERVER_MESSAGES,
  parseMessage,
  serializeMessage,
} = require("./protocol");

let nextPlayerId = 1;

function sanitizeNickname(name) {
  const trimmed = (typeof name === "string" ? name : "")
    .trim()
    .replace(/\s+/g, " ");
  if (!trimmed) {
    return "Rower";
  }
  return trimmed.slice(0, GAME_CONSTANTS.nicknameMaxLength);
}

class Room {
  constructor({ id, runStore = null, now = () => Date.now() } = {}) {
    this.id = id;
    this.runStore = runStore;
    this.now = now;
    this.players = [];
    this.status = "waiting";
    this.simulation = new BoatSimulation();
    this.countdownEndsAt = 0;
    this.nextLevelAt = 0;
    this.lastBroadcastAt = 0;
    this.lastCheckpointIndex = 0;
    this.startedAt = 0;
  }

  get isFull() {
    return this.players.length >= 2;
  }

  get isEmpty() {
    return this.players.length === 0;
  }

  hasSocket(socket) {
    return this.players.some((player) => player.socket === socket);
  }

  addPlayer(socket, name) {
    if (this.isFull) {
      this.send(socket, {
        type: SERVER_MESSAGES.ERROR,
        message: "Room is full.",
      });
      return null;
    }

    const occupiedSeats = new Set(this.players.map((player) => player.seat));
    const seat = occupiedSeats.has("left") ? "right" : "left";
    const player = {
      id: `p${(nextPlayerId += 1)}`,
      name: sanitizeNickname(name),
      seat,
      socket,
    };
    this.players.push(player);
    this.attachSocket(player);
    this.sendJoined(player);

    if (this.players.length === 1) {
      this.status = "waiting";
      this.send(player.socket, {
        type: SERVER_MESSAGES.WAITING,
        message: "Waiting for another rower...",
      });
    } else {
      this.startCountdown();
    }

    return player;
  }

  attachSocket(player) {
    if (!player.socket || typeof player.socket.on !== "function") {
      return;
    }
    player.socket.on("message", (raw) =>
      this.handleRawMessage(player.socket, raw),
    );
    player.socket.on("close", () => this.removePlayer(player.socket));
    player.socket.on("error", () => this.removePlayer(player.socket));
  }

  handleRawMessage(socket, raw) {
    const message = parseMessage(raw);
    if (!message) {
      this.send(socket, {
        type: SERVER_MESSAGES.ERROR,
        message: "Invalid message.",
      });
      return;
    }
    this.handleMessage(socket, message);
  }

  handleMessage(socket, message) {
    const player = this.players.find(
      (candidate) => candidate.socket === socket,
    );
    if (!player) {
      return;
    }

    if (message.type === CLIENT_MESSAGES.ROW) {
      this.row(player);
      return;
    }

    if (message.type === CLIENT_MESSAGES.RESTART) {
      if (this.status === "finished") this.restart();
      return;
    }

    if (message.type !== CLIENT_MESSAGES.JOIN) {
      this.send(socket, {
        type: SERVER_MESSAGES.ERROR,
        message: "Unknown message type.",
      });
    }
  }

  sendJoined(player) {
    this.send(player.socket, {
      type: SERVER_MESSAGES.JOINED,
      roomId: this.id,
      playerId: player.id,
      seat: player.seat,
      name: player.name,
      players: this.getPlayerSummary(),
      constants: {
        rowCooldownMs: GAME_CONSTANTS.rowCooldownMs,
        syncWindowMs: GAME_CONSTANTS.syncWindowMs,
      },
    });
    this.broadcastState(true);
  }

  startCountdown() {
    this.nextLevelAt = 0;
    this.status = "countdown";
    this.simulation.resetRun();
    this.lastCheckpointIndex = 0;
    this.countdownEndsAt = this.now() + GAME_CONSTANTS.countdownMs;
    this.broadcast({
      type: SERVER_MESSAGES.COUNTDOWN,
      message: "3... 2... 1... ROW!",
      startsAt: this.countdownEndsAt,
      players: this.getPlayerSummary(),
    });
    this.broadcastState(true);
  }

  restart() {
    if (this.players.length < 2) {
      this.status = "waiting";
      this.broadcast({
        type: SERVER_MESSAGES.WAITING,
        message: "Waiting for another rower...",
      });
      return;
    }
    this.startCountdown();
  }

  row(player) {
    if (this.status !== "playing") {
      return;
    }
    const result = this.simulation.row(
      player.seat,
      this.simulation.levelElapsedMs,
    );
    if (!result.accepted) {
      return;
    }
    this.broadcast({
      type: SERVER_MESSAGES.STROKE,
      side: player.seat,
      synchronized: result.synchronized,
      at: this.now(),
    });
  }

  update(deltaSeconds) {
    const now = this.now();
    if (
      this.status === "countdown" &&
      this.nextLevelAt &&
      now >= this.nextLevelAt
    ) {
      this.nextLevelAt = 0;
      this.simulation.advanceLevel();
      this.lastCheckpointIndex = 0;
      this.status = "playing";
      this.broadcast({ type: SERVER_MESSAGES.COUNTDOWN, message: "ROW!", startsAt: now });
      this.broadcastState(true);
    }

    if (this.status === "countdown" && now >= this.countdownEndsAt) {
      this.status = "playing";
      this.startedAt = now;
      this.broadcast({
        type: SERVER_MESSAGES.COUNTDOWN,
        message: "ROW!",
        startsAt: now,
      });
      this.broadcastState(true);
    }

    if (this.status === "playing") {
      const beforeCheckpoint = this.simulation.checkpointIndex;
      const result = this.simulation.update(deltaSeconds);
      if (this.simulation.checkpointIndex > beforeCheckpoint) {
        this.broadcast({
          type: SERVER_MESSAGES.CHECKPOINT,
          current: this.simulation.checkpointIndex,
          total: this.simulation.level.checkpoints.length,
        });
      }

      for (const collision of result.collisions || []) {
        this.broadcast({ type: SERVER_MESSAGES.COLLISION, ...collision });
      }

      if (result.levelComplete) {
        this.onLevelComplete();
      }
    }

    const broadcastIntervalMs = 1000 / GAME_CONSTANTS.broadcastRate;
    if (now - this.lastBroadcastAt >= broadcastIntervalMs) {
      this.broadcastState();
    }
  }

  onLevelComplete() {
    this.broadcast({
      type: SERVER_MESSAGES.LEVEL_COMPLETE,
      ...this.simulation.levelSummaries[this.simulation.levelIndex],
      nextStartsAt: this.simulation.completed ? null : this.now() + GAME_CONSTANTS.levelAdvanceDelayMs,
    });
    if (this.simulation.completed) {
      this.status = "finished";
      const run = this.getCompletedRun();
      this.broadcast({ type: SERVER_MESSAGES.GAME_COMPLETE, ...run });
      if (this.runStore) {
        this.runStore.saveRun(run);
      }
      return;
    }

    this.status = "countdown";
    this.nextLevelAt = this.now() + GAME_CONSTANTS.levelAdvanceDelayMs;
    this.countdownEndsAt = this.nextLevelAt;
  }

  getCompletedRun() {
    return {
      players: this.players.map((player) => player.name),
      levelTimes: [...this.simulation.levelTimes],
      totalTimeMs: Math.round(this.simulation.totalElapsedMs),
      levelSummaries: this.simulation.levelSummaries.map((summary) => ({ ...summary })),
      ...this.simulation.getRunStats(),
    };
  }

  removePlayer(socket) {
    const playerIndex = this.players.findIndex(
      (player) => player.socket === socket,
    );
    if (playerIndex === -1) {
      return;
    }
    const [removed] = this.players.splice(playerIndex, 1);
    if (this.players.length === 0) {
      this.status = "waiting";
      return;
    }

    this.status = "waiting";
    this.simulation = new BoatSimulation();
    this.nextLevelAt = 0;
    this.countdownEndsAt = 0;
    this.broadcast({
      type: SERVER_MESSAGES.OPPONENT_DISCONNECTED,
      message: "Your rowing partner disconnected.",
      disconnectedSeat: removed.seat,
    });
    this.broadcast({
      type: SERVER_MESSAGES.WAITING,
      message: "Waiting for another rower...",
    });
    this.broadcastState(true);
  }

  getPlayerSummary() {
    return this.players.map((player) => ({
      id: player.id,
      name: player.name,
      seat: player.seat,
    }));
  }

  broadcastState(force = false) {
    if (!force && this.players.length === 0) {
      return;
    }
    this.lastBroadcastAt = this.now();
    this.broadcast({
      type: SERVER_MESSAGES.STATE,
      roomStatus: this.status,
      players: this.getPlayerSummary(),
      ...this.simulation.getState(),
    });
  }

  broadcast(message) {
    for (const player of this.players) {
      this.send(player.socket, message);
    }
  }

  send(socket, message) {
    if (!socket || typeof socket.send !== "function") {
      return;
    }
    if (socket.readyState !== undefined && socket.readyState !== 1) {
      return;
    }
    socket.send(serializeMessage(message));
  }
}

module.exports = {
  Room,
  sanitizeNickname,
};
