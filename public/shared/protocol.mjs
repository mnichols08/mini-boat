// Shared by Node and the browser; clients send intent, never ownership or text.
export const PINGS = Object.freeze({ ROW: "row", LEFT: "left", RIGHT: "right", WAIT: "wait", NICE: "nice" });
export const CLIENT_MESSAGES = Object.freeze({
  JOIN: "join", ROW: "row", PING: "ping", READY: "ready",
  RESTART_REQUEST: "restart-request", RESTART_RESPONSE: "restart-response",
  PAUSE_REQUEST: "pause-request", PAUSE_RESPONSE: "pause-response",
  RESUME_READY: "resume-ready", FIND_PARTNER: "find-partner",
});
export const SERVER_MESSAGES = Object.freeze({
  JOINED: "joined", WAITING: "waiting", COUNTDOWN: "countdown", STATE: "state",
  STROKE: "stroke", COLLISION: "collision", CHECKPOINT: "checkpoint", PING: "ping",
  LEVEL_COMPLETE: "level-complete", GAME_COMPLETE: "game-complete",
  PLAYER_DISCONNECTED: "player-disconnected", PLAYER_RECONNECTED: "player-reconnected",
  RECONNECT_EXPIRED: "reconnect-expired", VOTE_RESULT: "vote-result", ERROR: "error",
});
export const ROOM_STATES = Object.freeze({
  WAITING: "waiting", COUNTDOWN: "countdown", PLAYING: "playing", PAUSED: "paused",
  LEVEL_COMPLETE: "level-complete", GAME_COMPLETE: "game-complete",
  RECONNECTING: "reconnecting", CLOSED: "closed",
});
