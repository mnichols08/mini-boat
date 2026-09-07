const { GAME_CONSTANTS } = require("./constants");
const { Room } = require("./room");
const {
  CLIENT_MESSAGES,
  SERVER_MESSAGES,
  parseMessage,
  serializeMessage,
} = require("./protocol");

class GameServer {
  constructor({ runStore = null, now = () => Date.now() } = {}) {
    this.rooms = new Map();
    this.socketRooms = new Map();
    this.runStore = runStore;
    this.now = now;
    this.nextRoomId = 1;
  }

  handleConnection(socket) {
    socket.lastPongAt = this.now();
    socket.on("pong", () => {
      socket.lastPongAt = this.now();
    });
    socket.on("message", (raw) => this.handleInitialMessage(socket, raw));
    socket.on("close", () => this.removeSocket(socket));
    socket.on("error", () => this.removeSocket(socket));
  }

  handleInitialMessage(socket, raw) {
    const message = parseMessage(raw);
    const existing = this.socketRooms.get(socket);
    if (existing) {
      if (
        message?.type === CLIENT_MESSAGES.FIND_PARTNER &&
        existing.status === "closed"
      ) {
        const player = existing.players.find((p) => p.socket === socket);
        const name = player?.name;
        this.removeSocket(socket);
        const room = this.findOpenRoom();
        room.addPlayer(socket, name);
        this.socketRooms.set(socket, room);
      }
      return;
    }
    if (!message || message.type !== CLIENT_MESSAGES.JOIN) {
      this.send(socket, {
        type: SERVER_MESSAGES.ERROR,
        message: "Send a join message first.",
      });
      return;
    }
    if (message.session !== undefined) {
      if (typeof message.session !== "string" || message.session.length > 100)
        return;
      for (const room of this.rooms.values()) {
        const player = room.players.find((p) => p.session === message.session);
        if (!player) continue;
        if (player.socket && room.status !== "closed") {
          this.send(socket, {
            type: SERVER_MESSAGES.ERROR,
            code: "session-in-use",
            message: "This rowing session is already connected in another tab.",
          });
          return;
        }
        if (room.restorePlayer(socket, message.session)) {
          this.socketRooms.set(socket, room);
          return;
        }
        this.send(socket, {
          type: SERVER_MESSAGES.RECONNECT_EXPIRED,
          message: "This rowing session has ended.",
        });
        return;
      }
    }
    const room = this.findOpenRoom();
    room.addPlayer(socket, message.name, message.session);
    this.socketRooms.set(socket, room);
  }

  findOpenRoom() {
    for (const room of this.rooms.values()) {
      if (!room.isFull && room.status === "waiting") {
        return room;
      }
    }
    const room = new Room({
      id: `room-${(this.nextRoomId += 1)}`,
      runStore: this.runStore,
      now: this.now,
    });
    this.rooms.set(room.id, room);
    return room;
  }

  removeSocket(socket) {
    const room = this.socketRooms.get(socket);
    if (!room) {
      return;
    }
    room.removePlayer(socket);
    this.socketRooms.delete(socket);
    if (room.isEmpty) {
      this.rooms.delete(room.id);
    }
  }

  tick(deltaSeconds = GAME_CONSTANTS.fixedDelta) {
    const now = this.now();
    for (const socket of this.socketRooms.keys()) {
      if (now - socket.lastPongAt > GAME_CONSTANTS.heartbeatTimeoutMs) {
        this.removeSocket(socket);
        socket.terminate?.();
      } else if (
        socket.ping &&
        now - (socket.lastPingAt || 0) >= GAME_CONSTANTS.heartbeatIntervalMs
      ) {
        socket.lastPingAt = now;
        socket.ping();
      }
    }
    for (const room of this.rooms.values()) {
      room.update(deltaSeconds);
      if (room.isEmpty) {
        this.rooms.delete(room.id);
      }
    }
  }

  send(socket, message) {
    if (socket.readyState !== undefined && socket.readyState !== 1) {
      return;
    }
    socket.send(serializeMessage(message));
  }
}

module.exports = {
  GameServer,
};
