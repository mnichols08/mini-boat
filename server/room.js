const { randomUUID } = require("node:crypto");
const { GAME_CONSTANTS: C } = require("./constants");
const { BoatSimulation } = require("./simulation");
const {
  CLIENT_MESSAGES: CLIENT,
  SERVER_MESSAGES: SERVER,
  ROOM_STATES: S,
  PINGS,
  parseMessage,
  serializeMessage,
} = require("./protocol");

let nextPlayerId = 1;
const emptyReady = () => ({ left: false, right: false });
const allowedPings = new Set(Object.values(PINGS));
// Votes are bounded proposals within PLAYING; they never stop simulation.
const TRANSITIONS = {
  [S.WAITING]: [S.COUNTDOWN, S.RECONNECTING, S.CLOSED],
  [S.COUNTDOWN]: [S.PLAYING, S.RECONNECTING, S.CLOSED],
  [S.PLAYING]: [
    S.PAUSED,
    S.COUNTDOWN,
    S.LEVEL_COMPLETE,
    S.GAME_COMPLETE,
    S.RECONNECTING,
    S.CLOSED,
  ],
  [S.PAUSED]: [S.COUNTDOWN, S.RECONNECTING, S.CLOSED],
  [S.LEVEL_COMPLETE]: [S.COUNTDOWN, S.RECONNECTING, S.CLOSED],
  [S.GAME_COMPLETE]: [S.COUNTDOWN, S.RECONNECTING, S.CLOSED],
  [S.RECONNECTING]: [
    S.WAITING,
    S.COUNTDOWN,
    S.PAUSED,
    S.LEVEL_COMPLETE,
    S.GAME_COMPLETE,
    S.CLOSED,
  ],
  [S.CLOSED]: [],
};

function sanitizeNickname(name) {
  const trimmed = (typeof name === "string" ? name : "")
    .trim()
    .replace(/\s+/g, " ");
  return (trimmed || "Rower").slice(0, C.nicknameMaxLength);
}

class Room {
  constructor({ id, runStore = null, now = () => Date.now() } = {}) {
    this.id = id;
    this.runStore = runStore;
    this.now = now;
    this.players = [];
    this.status = S.WAITING;
    this.simulation = new BoatSimulation();
    this.ready = emptyReady();
    this.vote = null;
    this.countdownEndsAt = 0;
    this.countdownReason = null;
    this.reconnectReturnState = null;
    this.celebrationEndsAt = 0;
    this.lastBroadcastAt = 0;
  }

  get isFull() {
    return this.players.length >= 2;
  }
  // A reserved, disconnected seat keeps the room alive until its deadline.
  get isEmpty() {
    return this.players.length === 0;
  }
  hasSocket(socket) {
    return this.players.some((player) => player.socket === socket);
  }

  transition(next) {
    if (next === this.status) return;
    if (!TRANSITIONS[this.status]?.includes(next))
      throw new Error(`Illegal room transition: ${this.status} -> ${next}`);
    this.status = next;
  }

  addPlayer(socket, name, session = null) {
    if (this.isFull || this.status !== S.WAITING) {
      this.send(socket, {
        type: SERVER.ERROR,
        message: "Room is unavailable.",
      });
      return null;
    }
    const player = {
      id: `p${nextPlayerId++}`,
      name: sanitizeNickname(name),
      seat: this.players.some((p) => p.seat === "left") ? "right" : "left",
      session: typeof session === "string" && session ? session : randomUUID(),
      socket,
      disconnectedUntil: null,
      lastPingAt: -Infinity,
      lastRequestAt: -Infinity,
    };
    this.players.push(player);
    this.ready = emptyReady();
    this.attachSocket(player);
    this.sendJoined(player);
    if (this.isFull) {
      this.simulation.resetRun();
      this.startCountdown("start");
    } else {
      this.send(socket, {
        type: SERVER.WAITING,
        message: "Waiting for another rower...",
      });
      this.broadcastState(true);
    }
    return player;
  }

  attachSocket(player) {
    // Capture this socket: a late close from an old connection must not evict a restored seat.
    const socket = player.socket;
    if (!socket?.on) return;
    player.listeners = {
      message: (raw) => this.handleRawMessage(socket, raw),
      close: () => this.removePlayer(socket),
      error: () => this.removePlayer(socket),
    };
    for (const [event, handler] of Object.entries(player.listeners))
      socket.on(event, handler);
  }

  detachSocket(player) {
    for (const [event, handler] of Object.entries(player.listeners || {}))
      player.socket?.off?.(event, handler);
    player.listeners = null;
    player.socket = null;
  }

  handleRawMessage(socket, raw) {
    const message = parseMessage(raw);
    if (!message) {
      this.send(socket, { type: SERVER.ERROR, message: "Invalid message." });
      return;
    }
    this.handleMessage(socket, message);
  }

  handleMessage(socket, message) {
    const player = this.players.find(
      (candidate) => candidate.socket === socket,
    );
    if (!player || !message || this.status === S.CLOSED) return;
    this.expireVote();
    switch (message.type) {
      case CLIENT.ROW:
        this.row(player);
        break;
      case CLIENT.PING:
        this.ping(player, message.ping);
        break;
      case CLIENT.READY:
        this.markReady(player, false);
        break;
      case CLIENT.RESUME_READY:
        this.markReady(player, true);
        break;
      case CLIENT.RESTART_REQUEST:
        this.requestVote(player, "restart");
        break;
      case CLIENT.PAUSE_REQUEST:
        this.requestVote(player, "pause");
        break;
      case CLIENT.RESTART_RESPONSE:
        this.respondVote(player, "restart", message);
        break;
      case CLIENT.PAUSE_RESPONSE:
        this.respondVote(player, "pause", message);
        break;
      case CLIENT.JOIN:
        break;
      default:
        break; // Unsupported and excessive intents have no side effects.
    }
  }

  sendJoined(player, reconnected = false) {
    this.send(player.socket, {
      type: SERVER.JOINED,
      roomId: this.id,
      playerId: player.id,
      session: player.session,
      seat: player.seat,
      name: player.name,
      reconnected,
      players: this.getPlayerSummary(),
      constants: {
        rowCooldownMs: C.rowCooldownMs,
        syncWindowMs: C.syncWindowMs,
        pingCooldownMs: C.pingCooldownMs,
        pingLifetimeMs: C.pingLifetimeMs,
        reconnectGraceMs: C.reconnectGraceMs,
        countdownMs: C.countdownMs,
        celebrationMs: C.celebrationMs,
      },
    });
  }

  startCountdown(reason) {
    this.ready = emptyReady();
    this.vote = null;
    this.celebrationEndsAt = 0;
    this.transition(S.COUNTDOWN);
    this.countdownReason = reason;
    this.countdownEndsAt = this.now() + C.countdownMs;
    this.broadcast({
      type: SERVER.COUNTDOWN,
      reason,
      startsAt: this.countdownEndsAt,
      durationMs: C.countdownMs,
      players: this.getPlayerSummary(),
    });
    this.broadcastState(true);
  }

  markReady(player, resume) {
    if (
      resume
        ? this.status !== S.PAUSED
        : ![S.LEVEL_COMPLETE, S.GAME_COMPLETE].includes(this.status)
    )
      return;
    if (this.ready[player.seat]) return;
    this.ready[player.seat] = true;
    this.maybeStartReady();
    this.broadcastState(true);
  }

  maybeStartReady() {
    if (
      !this.isFull ||
      this.players.some((p) => !p.socket) ||
      !this.ready.left ||
      !this.ready.right ||
      this.now() < this.celebrationEndsAt
    )
      return;
    if (this.status === S.LEVEL_COMPLETE) {
      this.simulation.advanceLevel();
      this.startCountdown("next-level");
    } else if (this.status === S.GAME_COMPLETE) {
      this.simulation.resetRun();
      this.startCountdown("replay");
    } else if (this.status === S.PAUSED) this.startCountdown("resume");
  }

  ping(player, ping) {
    if (
      ![
        S.COUNTDOWN,
        S.PLAYING,
        S.PAUSED,
        S.LEVEL_COMPLETE,
        S.GAME_COMPLETE,
      ].includes(this.status) ||
      !allowedPings.has(ping) ||
      this.now() - player.lastPingAt < C.pingCooldownMs
    )
      return;
    player.lastPingAt = this.now();
    this.broadcast({
      type: SERVER.PING,
      playerId: player.id,
      side: player.seat,
      ping,
      durationMs: C.pingLifetimeMs,
    });
  }

  requestVote(player, kind) {
    if (
      this.status !== S.PLAYING ||
      this.vote ||
      this.now() - player.lastRequestAt < C.requestCooldownMs
    )
      return;
    player.lastRequestAt = this.now();
    this.vote = {
      id: randomUUID(),
      kind,
      requestedBy: player.seat,
      expiresAt:
        this.now() +
        (kind === "restart" ? C.restartVoteTimeoutMs : C.pauseRequestTimeoutMs),
    };
    this.broadcastState(true);
  }

  respondVote(player, kind, message) {
    if (
      this.status !== S.PLAYING ||
      !this.vote ||
      this.vote.kind !== kind ||
      message.voteId !== this.vote.id ||
      player.seat === this.vote.requestedBy ||
      typeof message.accept !== "boolean"
    )
      return;
    if (!message.accept) {
      this.clearVote("declined");
      return;
    }
    this.vote = null;
    this.ready = emptyReady();
    if (kind === "restart") {
      this.simulation.restartLevel();
      this.startCountdown("restart");
    } else {
      this.transition(S.PAUSED);
      this.broadcastState(true);
    }
  }

  clearVote(reason) {
    const kind = this.vote.kind;
    this.vote = null;
    this.broadcast({ type: SERVER.VOTE_RESULT, kind, reason });
    this.broadcastState(true);
  }

  expireVote() {
    if (this.vote && this.now() >= this.vote.expiresAt)
      this.clearVote("expired");
  }

  row(player) {
    if (this.status !== S.PLAYING) return;
    const result = this.simulation.row(
      player.seat,
      this.simulation.levelElapsedMs,
    );
    if (result.accepted)
      this.broadcast({
        type: SERVER.STROKE,
        side: player.seat,
        synchronized: result.synchronized,
        at: this.now(),
      });
  }

  update(deltaSeconds) {
    const now = this.now();
    this.expireReconnect();
    if (this.status === S.CLOSED) return;
    this.expireVote();
    this.maybeStartReady();
    if (this.status === S.COUNTDOWN && now >= this.countdownEndsAt) {
      this.transition(S.PLAYING);
      this.countdownEndsAt = 0;
      this.ready = emptyReady();
      this.broadcastState(true);
      // This tick began in countdown. Start integrating on the next tick.
      return;
    }
    if (this.status === S.PLAYING) {
      const beforeCheckpoint = this.simulation.checkpointIndex;
      const result = this.simulation.update(deltaSeconds);
      if (this.simulation.checkpointIndex > beforeCheckpoint)
        this.broadcast({
          type: SERVER.CHECKPOINT,
          current: this.simulation.checkpointIndex,
          total: this.simulation.level.checkpoints.length,
        });
      for (const collision of result.collisions || [])
        this.broadcast({ type: SERVER.COLLISION, ...collision });
      if (result.levelComplete) this.onLevelComplete();
    }
    if (now - this.lastBroadcastAt >= 1000 / C.broadcastRate)
      this.broadcastState();
  }

  onLevelComplete() {
    if (this.status !== S.PLAYING) return;
    this.ready = emptyReady();
    this.vote = null;
    this.celebrationEndsAt = this.now() + C.celebrationMs;
    this.transition(
      this.simulation.completed ? S.GAME_COMPLETE : S.LEVEL_COMPLETE,
    );
    this.broadcast({
      type: SERVER.LEVEL_COMPLETE,
      ...this.simulation.levelSummaries[this.simulation.levelIndex],
      durationMs: C.celebrationMs,
    });
    if (this.simulation.completed) {
      const run = this.getCompletedRun();
      this.broadcast({ type: SERVER.GAME_COMPLETE, ...run });
      this.runStore?.saveRun(run);
    }
    this.broadcastState(true);
  }

  getCompletedRun() {
    return {
      players: this.players.map((player) => player.name),
      levelTimes: [...this.simulation.levelTimes],
      totalTimeMs: Math.round(this.simulation.totalElapsedMs),
      levelSummaries: this.simulation.levelSummaries.map((summary) => ({
        ...summary,
      })),
      ...this.simulation.getRunStats(),
    };
  }

  removePlayer(socket) {
    const player = this.players.find((p) => p.socket === socket);
    if (!player) return;
    this.detachSocket(player);
    if (
      this.status === S.CLOSED ||
      (this.status === S.WAITING && this.players.length < 2)
    ) {
      this.players = this.players.filter((p) => p !== player);
      return;
    }
    player.disconnectedUntil = this.now() + C.reconnectGraceMs;
    if (this.status !== S.RECONNECTING) this.reconnectReturnState = this.status;
    this.transition(S.RECONNECTING);
    this.ready = emptyReady();
    this.vote = null;
    this.countdownEndsAt = 0;
    this.broadcast({
      type: SERVER.PLAYER_DISCONNECTED,
      playerId: player.id,
      side: player.seat,
      name: player.name,
    });
    this.broadcastState(true);
  }

  restorePlayer(socket, session) {
    this.expireReconnect();
    const player = this.players.find((p) => p.session === session);
    if (!player || player.socket || this.status !== S.RECONNECTING) return null;
    player.socket = socket;
    player.disconnectedUntil = null;
    this.attachSocket(player);
    this.ready = emptyReady();
    this.sendJoined(player, true);
    this.broadcast({
      type: SERVER.PLAYER_RECONNECTED,
      playerId: player.id,
      side: player.seat,
      name: player.name,
    });
    if (this.players.every((p) => p.socket)) {
      const previous = this.reconnectReturnState;
      this.reconnectReturnState = null;
      if ([S.PLAYING, S.COUNTDOWN].includes(previous))
        this.startCountdown("reconnect");
      else this.transition(previous);
    }
    this.broadcastState(true);
    return player;
  }

  expireReconnect() {
    if (
      this.status !== S.RECONNECTING ||
      !this.players.some(
        (p) =>
          p.disconnectedUntil !== null && this.now() >= p.disconnectedUntil,
      )
    )
      return;
    this.transition(S.CLOSED);
    this.ready = emptyReady();
    this.vote = null;
    this.reconnectReturnState = null;
    this.celebrationEndsAt = 0;
    this.players = this.players.filter((p) => p.socket);
    this.broadcast({
      type: SERVER.RECONNECT_EXPIRED,
      message: "Your partner did not return.",
    });
    this.broadcastState(true);
  }

  getPlayerSummary() {
    return this.players.map((player) => ({
      id: player.id,
      name: player.name,
      seat: player.seat,
      connected: Boolean(player.socket),
      disconnectedUntil: player.disconnectedUntil,
    }));
  }

  broadcastState(force = false) {
    if (!force && this.isEmpty) return;
    this.lastBroadcastAt = this.now();
    this.broadcast({
      type: SERVER.STATE,
      roomStatus: this.status,
      serverNow: this.now(),
      players: this.getPlayerSummary(),
      ready: { ...this.ready },
      vote: this.vote ? { ...this.vote } : null,
      countdownEndsAt: this.countdownEndsAt,
      countdownReason: this.countdownReason,
      celebrationEndsAt: this.celebrationEndsAt,
      levelSummary:
        this.simulation.levelSummaries[this.simulation.levelIndex] || null,
      runSummary: this.simulation.completed ? this.getCompletedRun() : null,
      ...this.simulation.getState(),
    });
  }

  broadcast(message) {
    for (const player of this.players) this.send(player.socket, message);
  }
  send(socket, message) {
    if (
      !socket?.send ||
      (socket.readyState !== undefined && socket.readyState !== 1)
    )
      return;
    socket.send(serializeMessage(message));
  }
}

module.exports = { Room, sanitizeNickname };
