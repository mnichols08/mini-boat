const { CLIENT_MESSAGES, SERVER_MESSAGES, PINGS, ROOM_STATES } = require("../public/shared/protocol.mjs");

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
  PINGS,
  ROOM_STATES,
  parseMessage,
  serializeMessage,
};
