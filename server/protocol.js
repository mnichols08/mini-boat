const CLIENT_MESSAGES = Object.freeze({
  JOIN: "join",
  ROW: "row",
  RESTART: "restart",
});

const SERVER_MESSAGES = Object.freeze({
  JOINED: "joined",
  WAITING: "waiting",
  COUNTDOWN: "countdown",
  STATE: "state",
  STROKE: "stroke",
  COLLISION: "collision",
  CHECKPOINT: "checkpoint",
  LEVEL_COMPLETE: "level-complete",
  GAME_COMPLETE: "game-complete",
  OPPONENT_DISCONNECTED: "opponent-disconnected",
  ERROR: "error",
});

function parseMessage(raw) {
  if (typeof raw !== "string" && !Buffer.isBuffer(raw)) {
    return null;
  }
  try {
    const message = JSON.parse(raw.toString());
    if (!message || typeof message.type !== "string") {
      return null;
    }
    return message;
  } catch (_error) {
    return null;
  }
}

function serializeMessage(message) {
  return JSON.stringify(message);
}

module.exports = {
  CLIENT_MESSAGES,
  SERVER_MESSAGES,
  parseMessage,
  serializeMessage,
};
