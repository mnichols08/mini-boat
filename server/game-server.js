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
    socket.on("pong", () => { socket.lastPongAt = this.now(); });
    socket.on("message", (raw) => this.handleInitialMessage(socket, raw));
    socket.on("close", () => this.removeSocket(socket));
    socket.on("error", () => this.removeSocket(socket));
  }

  handleInitialMessage(socket, raw) {
    if (this.socketRooms.has(socket)) {
      return;
    }
    const message = parseMessage(raw);
    if (!message || message.type !== CLIENT_MESSAGES.JOIN) {
      this.send(socket, {
        type: SERVER_MESSAGES.ERROR,
        message: "Send a join message first.",
      });
      return;
    }
    const room = this.findOpenRoom();
    room.addPlayer(socket, message.name);
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
      if (now - socket.lastPongAt > 30000) {
        this.removeSocket(socket);
        socket.terminate?.();
      } else if (socket.ping && now - (socket.lastPingAt || 0) >= 10000) {
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
