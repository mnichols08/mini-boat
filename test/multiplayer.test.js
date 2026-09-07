const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { Room } = require("../server/room");
const { GAME_CONSTANTS: C } = require("../server/constants");
const {
  CLIENT_MESSAGES: CLIENT,
  SERVER_MESSAGES: SERVER,
  PINGS,
} = require("../server/protocol");

class Socket extends EventEmitter {
  readyState = 1;
  sent = [];
  send(raw) {
    this.sent.push(JSON.parse(raw));
  }
}

function roomWithPlayers(nowRef = { now: 1000 }) {
  const room = new Room({ now: () => nowRef.now });
  const left = new Socket();
  const right = new Socket();
  room.addPlayer(left, "Lefty");
  room.addPlayer(right, "Righty");
  nowRef.now += C.countdownMs;
  room.update(C.fixedDelta);
  left.sent = [];
  right.sent = [];
  return { room, left, right, nowRef };
}

function finishLevel(room, nowRef) {
  room.simulation.checkpointIndex = room.simulation.level.checkpoints.length;
  Object.assign(room.simulation.boat, room.simulation.level.finish);
  room.update(C.fixedDelta);
  nowRef.now += C.celebrationMs;
}

test("valid pings are broadcast with server-owned identity and rate limited", () => {
  const { room, left, right, nowRef } = roomWithPlayers();
  room.handleMessage(left, {
    type: CLIENT.PING,
    ping: PINGS.LEFT,
    playerId: "fake",
    text: "anything",
  });
  room.handleMessage(left, { type: CLIENT.PING, ping: PINGS.RIGHT });
  nowRef.now += C.pingCooldownMs;
  room.handleMessage(left, { type: CLIENT.PING, ping: "free text" });
  room.handleMessage(right, { type: CLIENT.PING, ping: PINGS.NICE });

  const pings = left.sent.filter((message) => message.type === SERVER.PING);
  assert.equal(pings.length, 2);
  assert.deepEqual(
    pings,
    right.sent.filter((message) => message.type === SERVER.PING),
  );
  assert.equal(pings[0].side, "left");
  assert.equal(pings[0].playerId, room.players[0].id);
  assert.equal(pings[0].ping, PINGS.LEFT);
  assert.equal(pings[1].side, "right");
});

test("readiness gates next levels and resets when countdown finishes", () => {
  const { room, left, right, nowRef } = roomWithPlayers();
  finishLevel(room, nowRef);
  assert.equal(room.status, "level-complete");
  room.handleMessage(left, { type: CLIENT.READY });
  assert.equal(room.status, "level-complete");
  assert.equal(room.ready.left, true);
  room.handleMessage(right, { type: CLIENT.READY });
  assert.equal(room.status, "countdown");
  assert.equal(room.simulation.levelIndex, 1);
  nowRef.now += C.countdownMs;
  room.update(C.fixedDelta);
  assert.equal(room.status, "playing");
  assert.deepEqual(room.ready, { left: false, right: false });
});

test("final replay requires both players", () => {
  const { room, left, right, nowRef } = roomWithPlayers();
  room.simulation.loadLevel(2);
  finishLevel(room, nowRef);
  assert.equal(room.status, "game-complete");
  room.handleMessage(left, { type: CLIENT.READY });
  assert.equal(room.status, "game-complete");
  room.handleMessage(right, { type: CLIENT.READY });
  assert.equal(room.status, "countdown");
  assert.equal(room.countdownReason, "replay");
  assert.equal(room.simulation.levelIndex, 0);
});

test("restart vote requires the partner, can be declined, and can expire", () => {
  const { room, left, right, nowRef } = roomWithPlayers();
  room.simulation.row("left", 0);
  room.simulation.checkpointIndex = 1;
  room.handleMessage(left, { type: CLIENT.RESTART_REQUEST });
  assert.equal(room.status, "playing");
  assert.equal(room.vote.kind, "restart");
  assert.equal(room.simulation.checkpointIndex, 1);
  room.handleMessage(right, {
    type: CLIENT.RESTART_RESPONSE,
    voteId: room.vote.id,
    accept: false,
  });
  assert.equal(room.vote, null);
  assert.equal(room.simulation.checkpointIndex, 1);

  room.handleMessage(left, { type: CLIENT.RESTART_REQUEST });
  assert.equal(room.vote, null);
  nowRef.now += C.requestCooldownMs;
  room.handleMessage(left, { type: CLIENT.RESTART_REQUEST });
  const expiredId = room.vote.id;
  nowRef.now += C.restartVoteTimeoutMs;
  room.update(C.fixedDelta);
  assert.equal(room.vote, null);
  assert.ok(
    left.sent.some(
      (message) =>
        message.type === SERVER.VOTE_RESULT && message.reason === "expired",
    ),
  );

  nowRef.now += C.requestCooldownMs;
  room.handleMessage(left, { type: CLIENT.RESTART_REQUEST });
  assert.notEqual(room.vote?.id, expiredId);
  room.handleMessage(right, {
    type: CLIENT.RESTART_RESPONSE,
    voteId: room.vote.id,
    accept: true,
  });
  assert.equal(room.status, "countdown");
  assert.equal(room.countdownReason, "restart");
  assert.equal(room.simulation.checkpointIndex, 0);
  assert.equal(room.simulation.levelElapsedMs, 0);
  assert.equal(room.simulation.strokes, 0);
});

test("pause vote freezes simulation and resume requires both players", () => {
  const { room, left, right, nowRef } = roomWithPlayers();
  room.handleMessage(left, { type: CLIENT.PAUSE_REQUEST });
  assert.equal(room.status, "playing");
  const voteId = room.vote.id;
  room.update(C.fixedDelta);
  assert.ok(room.simulation.levelElapsedMs > 0);
  room.handleMessage(right, {
    type: CLIENT.PAUSE_RESPONSE,
    voteId,
    accept: true,
  });
  assert.equal(room.status, "paused");
  const frozen = room.simulation.levelElapsedMs;
  room.handleMessage(left, { type: CLIENT.ROW });
  room.update(C.fixedDelta);
  assert.equal(room.simulation.levelElapsedMs, frozen);
  assert.equal(room.simulation.strokes, 0);

  room.handleMessage(left, { type: CLIENT.RESUME_READY });
  assert.equal(room.status, "paused");
  room.handleMessage(right, { type: CLIENT.RESUME_READY });
  assert.equal(room.status, "countdown");
  assert.equal(room.countdownReason, "resume");
  nowRef.now += C.countdownMs;
  room.update(C.fixedDelta);
  assert.equal(room.status, "playing");
});

test("same session restores a reconnecting seat and another session cannot steal it", () => {
  const { room, left, nowRef } = roomWithPlayers();
  const session = room.players[1].session;
  const z = room.simulation.boat.z;
  room.removePlayer(room.players[1].socket);
  assert.equal(room.status, "reconnecting");
  room.update(C.fixedDelta);
  assert.equal(room.simulation.boat.z, z);
  assert.equal(room.restorePlayer(new Socket(), "other-session"), null);
  const restored = room.restorePlayer(new Socket(), session);
  assert.equal(restored.seat, "right");
  assert.equal(room.status, "countdown");
  assert.ok(
    left.sent.some((message) => message.type === SERVER.PLAYER_RECONNECTED),
  );
  nowRef.now += C.countdownMs;
  room.update(C.fixedDelta);
  assert.equal(room.status, "playing");
});

test("reconnect grace expiry closes the abandoned run cleanly", () => {
  const nowRef = { now: 1000 };
  const { room, left } = roomWithPlayers(nowRef);
  room.removePlayer(room.players[1].socket);
  nowRef.now += C.reconnectGraceMs;
  room.update(C.fixedDelta);
  assert.equal(room.status, "closed");
  assert.equal(room.players.length, 1);
  assert.ok(
    left.sent.some((message) => message.type === SERVER.RECONNECT_EXPIRED),
  );
});
