const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { Room } = require("../server/room");
const { GameServer } = require("../server/game-server");
const { BoatSimulation } = require("../server/simulation");
const { GAME_CONSTANTS: C } = require("../server/constants");

class Socket extends EventEmitter {
  readyState = 1;
  sent = [];
  send(raw) {
    this.sent.push(JSON.parse(raw));
  }
}

test("all three levels transition, persist once, and restart cleanly", () => {
  let now = 1000;
  const runs = [];
  const room = new Room({
    now: () => now,
    runStore: { saveRun: (run) => runs.push(run) },
  });
  const a = new Socket(),
    b = new Socket();
  room.addPlayer(a, "A");
  room.addPlayer(b, "B");
  now += C.countdownMs;
  room.update(C.fixedDelta);
  assert.equal(room.status, "playing");
  room.handleMessage(a, { type: "restart" });
  assert.equal(room.status, "playing");
  for (let index = 0; index < 3; index++) {
    const sim = room.simulation;
    for (const gate of sim.level.checkpoints) {
      Object.assign(sim.boat, { x: gate.x, z: gate.z });
      room.update(C.fixedDelta);
    }
    Object.assign(sim.boat, sim.level.finish);
    room.update(C.fixedDelta);
    if (index < 2) {
      assert.equal(room.status, "level-complete");
      const time = sim.totalElapsedMs;
      now += C.celebrationMs;
      room.handleMessage(a, { type: "ready" });
      assert.equal(room.status, "level-complete");
      room.handleMessage(b, { type: "ready" });
      assert.equal(room.status, "countdown");
      room.update(C.fixedDelta);
      assert.equal(sim.totalElapsedMs, time);
      now += C.countdownMs;
      room.update(C.fixedDelta);
      assert.equal(sim.levelIndex, index + 1);
    }
  }
  assert.equal(room.status, "game-complete");
  room.update(C.fixedDelta);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].levelTimes.length, 3);
  now += C.celebrationMs;
  room.handleMessage(a, { type: "ready" });
  assert.equal(room.status, "game-complete");
  room.handleMessage(b, { type: "ready" });
  assert.equal(room.status, "countdown");
  assert.equal(room.simulation.levelIndex, 0);
  assert.equal(room.simulation.strokes, 0);
});

test("skipping the first checkpoint does not count a later one", () => {
  const sim = new BoatSimulation();
  sim.loadLevel(1);
  Object.assign(sim.boat, sim.level.checkpoints[1]);
  sim.update(C.fixedDelta);
  assert.equal(sim.checkpointIndex, 0);
});

test("seat spoofing on row cannot operate the other oar", () => {
  const room = new Room();
  const a = new Socket(),
    b = new Socket();
  room.addPlayer(a, "A");
  room.addPlayer(b, "B");
  room.status = "playing";
  room.handleMessage(a, { type: "row", side: "right" });
  assert.ok(room.simulation.boat.angularVelocity > 0);
  assert.equal(room.simulation.oars.right.lastStrokeAt, -Infinity);
});

test("disconnect reserves the vacant seat for reconnect instead of replacement", () => {
  const room = new Room();
  const a = new Socket(),
    b = new Socket();
  room.addPlayer(a, "A");
  room.addPlayer(b, "B");
  room.status = "playing";
  const session = room.players[0].session;
  room.removePlayer(a);
  assert.equal(room.status, "reconnecting");
  const frozen = JSON.stringify(room.simulation.getState());
  room.update(C.fixedDelta);
  assert.equal(JSON.stringify(room.simulation.getState()), frozen);
  assert.equal(room.addPlayer(new Socket(), "C"), null);
  assert.deepEqual(
    room.players.map((p) => p.seat),
    ["left", "right"],
  );
  assert.equal(room.restorePlayer(new Socket(), session).seat, "left");
  assert.equal(room.status, "countdown");
});

test("silent lost connections are removed by the shared loop", () => {
  let now = 1000;
  const server = new GameServer({ now: () => now });
  const socket = new Socket();
  server.handleConnection(socket);
  socket.emit("message", JSON.stringify({ type: "join", name: "A" }));
  now += 31000;
  server.tick();
  assert.equal(server.rooms.size, 0);
});

test("left-only rowing curves toward screen-right downstream", () => {
  const sim = new BoatSimulation();
  for (let i = 0; i < 50; i++) {
    if (i % 18 === 0) sim.row("left");
    sim.update(C.fixedDelta);
  }
  assert.ok(sim.boat.x < 0);
  assert.ok(sim.boat.z > 0);
});
