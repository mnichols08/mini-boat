const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { BoatSimulation } = require("../server/simulation");
const { GAME_CONSTANTS: C } = require("../server/constants");
const { Room } = require("../server/room");
const { parseMessage, SERVER_MESSAGES } = require("../server/protocol");

function river({ rocks = [], currents = [], halfWidth = 5 } = {}, constants = {}) {
  const level = { id: "test", name: "Test", start: { x: 0, z: -5, rotation: 0 },
    path: [{ x: 0, z: -50 }, { x: 0, z: 150 }], halfWidth, rocks, currents,
    checkpoints: [], finish: { x: 0, z: 145, radius: 2 } };
  return new BoatSimulation({ levels: [level], constants: { ...C, ...constants } });
}

for (const side of ["left", "right"]) {
  test(`${side} cooldown rejects just before and accepts exactly at the boundary`, () => {
    const sim = river();
    sim.row(side, 0);
    assert.equal(sim.row(side, C.rowCooldownMs - 0.001).accepted, false);
    assert.equal(sim.row(side, C.rowCooldownMs).accepted, true);
    assert.equal(sim.strokes, 2);
    assert.equal(sim.getState()[`${side}Strokes`], 2);
  });
  for (const offset of [-0.001, 0, 0.001]) {
    test(`${side} first sync at window ${offset >= 0 ? "+" : ""}${offset}ms`, () => {
      const sim = river();
      sim.row(side, 0);
      const result = sim.row(side === "left" ? "right" : "left", C.syncWindowMs + offset);
      assert.equal(result.synchronized, offset <= 0);
      assert.equal(sim.synchronizedStrokes, offset <= 0 ? 1 : 0);
    });
  }
}

test("a synchronized pair is consumed and bonus cannot be reused with a shorter tuned cooldown", () => {
  const sim = river({}, { rowCooldownMs: 10, maxSpeed: 100 });
  sim.row("left", 0);
  sim.row("right", 1);
  assert.equal(sim.row("left", 10).synchronized, false);
  assert.equal(sim.synchronizedStrokes, 1);
  assert.ok(Math.abs(sim.boat.velocityZ - C.strokeImpulse * (2 * C.syncForwardBonus + 1)) < 1e-10);
  assert.equal(sim.getState().syncPercentage, 67);
});

test("rejected input changes neither physics nor stats nor oar cooldowns", () => {
  const sim = river();
  sim.row("left", 0);
  const before = JSON.stringify(sim.getState());
  for (const side of ["left", "neither", "__proto__", null]) sim.row(side, 1);
  assert.equal(JSON.stringify(sim.getState()), before);
});

test("level stats reset, snapshots stay immutable, run totals accumulate and restart clears them", () => {
  const sim = new BoatSimulation();
  assert.equal(sim.getState().syncPercentage, 0);
  sim.boat.x = 20; sim.update();
  sim.boat.x = 0;
  sim.row("left", 0); sim.row("right", 10); sim.row("left", 600);
  sim.checkpointIndex = sim.level.checkpoints.length;
  Object.assign(sim.boat, { x: sim.level.finish.x, z: sim.level.finish.z, velocityX: 0, velocityZ: 0 });
  sim.update();
  const summary = { ...sim.levelSummaries[0] };
  assert.equal(summary.leftStrokes, 2);
  assert.equal(summary.rightStrokes, 1);
  assert.equal(summary.strokes, 3);
  assert.equal(summary.synchronizedStrokes, 1);
  assert.equal(summary.syncPercentage, 67);
  assert.equal(summary.collisions, 1);
  assert.equal(summary.timeMs, sim.levelTimes[0]);
  sim.advanceLevel();
  assert.equal(sim.getState().levelStats.strokes, 0);
  assert.equal(sim.getState().levelStats.collisions, 0);
  assert.equal(sim.collisions, 1);
  assert.equal(sim.getState().levelStats.timeMs, 0);
  assert.equal(sim.getState().oars.left.cooldownRemainingMs, 0);
  sim.row("right", 0);
  assert.equal(sim.getState().levelStats.rightStrokes, 1);
  assert.equal(sim.getState().strokes, 4);
  assert.equal(sim.getState().syncPercentage, 50);
  assert.deepEqual(sim.levelSummaries[0], summary);
  sim.resetRun();
  assert.equal(sim.strokes, 0);
  assert.equal(sim.synchronizedStrokes, 0);
  assert.equal(sim.collisions, 0);
  assert.deepEqual(sim.levelSummaries, []);
});

test("sustained rock pressure and exact resting contact count once, with one feedback event", () => {
  const sim = river({ rocks: [{ x: 0, z: 0, radius: 1 }] }, { rockBounce: 0 });
  sim.boat.z = -1.92;
  let events = 0;
  for (let i = 0; i < 90; i += 1) {
    sim.boat.velocityZ = i < 30 ? 1 : 0;
    events += sim.update().collisions.length;
  }
  assert.equal(sim.collisions, 1);
  assert.equal(events, 1);
  assert.equal(sim.contacts.has("rock:0"), true);
  assert.equal(sim.recoveryCount, 0);
});

for (const kind of ["bank", "rock"]) {
  test(`${kind} separation followed by re-entry counts again without an arbitrary cooldown`, () => {
    const sim = river({ rocks: kind === "rock" ? [{ x: 0, z: 0, radius: 1 }] : [] });
    const hit = () => Object.assign(sim.boat, kind === "rock"
      ? { x: 0, z: -1.8, velocityX: 0, velocityZ: 0 }
      : { x: 4.2, z: -5, velocityX: 0, velocityZ: 0 });
    hit(); sim.update();
    Object.assign(sim.boat, { x: 0, z: -5 }); sim.update();
    hit(); sim.update();
    assert.equal(sim.collisions, 2);
    assert.equal(sim.getState().levelStats.collisions, 2);
  });
}

test("small contact jitter does not create repeated bumps", () => {
  const sim = river();
  for (let i = 0; i < 90; i += 1) {
    sim.boat.x = 5 - C.boatRadius + (i % 2 ? -0.01 : 0.01);
    sim.update();
  }
  assert.equal(sim.collisions, 1);
});

test("touching a different rock counts even while another contact persists", () => {
  const sim = river({ rocks: [{ x: -1, z: 0, radius: 1 }, { x: 1, z: 0, radius: 1 }] });
  sim.boat.z = -1.5;
  sim.update();
  assert.equal(sim.collisions, 2);
});

test("bank scraping keeps downstream motion and never invokes recovery", () => {
  const sim = river();
  sim.boat.x = 5 - C.boatRadius;
  sim.boat.velocityZ = 3;
  const startZ = sim.boat.z;
  for (let i = 0; i < 90; i += 1) {
    sim.boat.velocityX = 0.2;
    if (i % 18 === 0) { sim.row("left"); sim.row("right"); }
    sim.update();
  }
  assert.ok(sim.boat.z > startZ + 4);
  assert.ok(sim.boat.velocityZ > 1);
  assert.equal(sim.recoveryCount, 0);
});

test("normal free rowing and idle contact never invoke recovery", () => {
  for (const idle of [false, true]) {
    const sim = river();
    if (idle) sim.boat.x = 5 - C.boatRadius + 0.01;
    for (let i = 0; i < 180; i += 1) {
      if (!idle && i % 18 === 0) { sim.row("left"); sim.row("right"); }
      sim.update();
    }
    assert.equal(sim.recoveryCount, 0);
  }
});

test("sustained failed rowing gets a conservative velocity nudge without teleporting", () => {
  const sim = river({ rocks: [{ x: 0, z: 0, radius: 1 }] }, { rockBounce: 0 });
  sim.boat.z = -1.92;
  sim.recoveryAnchor = { x: sim.boat.x, z: sim.boat.z };
  let nudged = false;
  for (let i = 0; i < 150; i += 1) {
    if (i % 18 === 0) { sim.row("left"); sim.row("right"); }
    const before = { x: sim.boat.x, z: sim.boat.z };
    sim.update();
    assert.ok(Math.hypot(sim.boat.x - before.x, sim.boat.z - before.z) < 0.15);
    if (sim.recoveryCount) { nudged = true; break; }
  }
  assert.equal(nudged, true);
  assert.ok(Math.hypot(sim.boat.velocityX, sim.boat.velocityZ) > 0);
  assert.ok(sim.levelElapsedMs >= C.recoveryDelayMs);
});

test("rock and bank constraints jointly clear an awkward narrow gap", () => {
  const sim = river({ halfWidth: 3, rocks: [{ x: 1.7, z: 0, radius: 1 }] });
  Object.assign(sim.boat, { x: 2.05, z: -1.7, velocityX: 0.5, velocityZ: 1 });
  for (let i = 0; i < 90; i += 1) {
    sim.update();
    assert.ok(sim.geometryPenalty(sim.boat) < 0.002);
  }
});

test("a player can row away from a head-on rock contact with production physics", () => {
  const sim = new BoatSimulation();
  sim.loadLevel(1);
  const rock = sim.level.rocks[0];
  Object.assign(sim.boat, { x: rock.x, z: rock.z - rock.radius - C.boatRadius, rotation: 0 });
  for (let i = 0; i < 180; i += 1) {
    if (i % 18 === 0) sim.row("left");
    sim.update();
  }
  assert.ok(Math.hypot(sim.boat.x - rock.x, sim.boat.z - rock.z) > rock.radius + C.boatRadius + 1);
  assert.equal(sim.geometryPenalty(sim.boat), 0);
});

test("a boat embedded at a rock center resolves to finite, open water", () => {
  const sim = river({ rocks: [{ x: 0, z: 0, radius: 1 }] });
  Object.assign(sim.boat, { x: 0, z: 0 });
  sim.update();
  assert.ok(Number.isFinite(sim.boat.x) && Number.isFinite(sim.boat.z));
  assert.equal(sim.geometryPenalty(sim.boat), 0);
  assert.equal(sim.collisions, 1);
});

class Socket extends EventEmitter {
  readyState = 1;
  sent = [];
  send(raw) { this.sent.push(JSON.parse(raw)); }
}

function roomWithPlayers() {
  const room = new Room();
  const a = new Socket(), b = new Socket();
  room.addPlayer(a, "A"); room.addPlayer(b, "B");
  room.status = "playing";
  a.sent = []; b.sent = [];
  return { room, a, b };
}

test("both clients receive only accepted, server-owned stroke feedback", () => {
  const { room, a, b } = roomWithPlayers();
  room.handleRawMessage(a, JSON.stringify({ type: "row", side: "right", synchronized: true }));
  room.handleRawMessage(a, JSON.stringify({ type: "row" }));
  room.handleRawMessage(b, JSON.stringify({ type: "row", side: "left" }));
  const strokes = a.sent.filter((message) => message.type === SERVER_MESSAGES.STROKE);
  assert.equal(strokes.length, 2);
  assert.deepEqual(strokes, b.sent.filter((message) => message.type === SERVER_MESSAGES.STROKE));
  assert.equal(strokes[0].side, "left");
  assert.equal(strokes[0].synchronized, false);
  assert.equal(strokes[1].side, "right");
  assert.equal(strokes[1].synchronized, true);
  assert.ok(strokes.every((message) => Number.isFinite(message.at) && parseMessage(JSON.stringify(message))));
  room.broadcastState(true);
  assert.equal(a.sent.at(-1).oars.left.cooldownRemainingMs, C.rowCooldownMs);
  assert.equal(room.simulation.strokes, 2);
});

test("malformed input and spoofed server events cannot mutate gameplay", () => {
  const { room, a } = roomWithPlayers();
  const before = JSON.stringify(room.simulation.getState());
  for (const raw of ["{nope", "null", "[]", "3", '{"type":"stroke","side":"right"}',
    '{"type":"collision"}', '{"type":"state","strokes":99}']) room.handleRawMessage(a, raw);
  room.handleMessage(new Socket(), { type: "row" });
  assert.equal(JSON.stringify(room.simulation.getState()), before);
  assert.equal(a.sent.some((message) => message.type === "stroke"), false);
});

test("collision feedback is bounded and emitted only on contact entry", () => {
  const { room, a } = roomWithPlayers();
  for (let i = 0; i < 60; i += 1) {
    room.simulation.boat.x = 20;
    room.update(C.fixedDelta);
  }
  const events = a.sent.filter((message) => message.type === "collision");
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "bank");
  assert.ok(events[0].strength >= 0 && events[0].strength <= 1);
  assert.ok(Math.abs(Math.hypot(events[0].normalX, events[0].normalZ) - 1) < 1e-10);
});

test("every level including the final one reports its own stats and persistence receives run totals", () => {
  const { room, a } = roomWithPlayers();
  const saved = [];
  room.runStore = { saveRun: (run) => saved.push(run) };
  for (let i = 0; i < 3; i += 1) {
    const sim = room.simulation;
    sim.row("left", 0); sim.row("right", 0);
    sim.checkpointIndex = sim.level.checkpoints.length;
    Object.assign(sim.boat, { x: sim.level.finish.x, z: sim.level.finish.z, velocityX: 0, velocityZ: 0 });
    room.update(C.fixedDelta);
    const event = a.sent.filter((message) => message.type === "level-complete").at(-1);
    assert.equal(event.strokes, 2);
    assert.equal(event.synchronizedStrokes, 1);
    assert.equal(event.syncPercentage, 100);
    if (i < 2) { sim.advanceLevel(); room.status = "playing"; }
  }
  assert.equal(saved.length, 1);
  assert.equal(saved[0].strokes, 6);
  assert.equal(saved[0].leftStrokes, 3);
  assert.equal(saved[0].rightStrokes, 3);
  assert.equal(saved[0].synchronizedStrokes, 3);
  assert.equal(saved[0].syncPercentage, 100);
  assert.equal(saved[0].levelSummaries.length, 3);
});

test("snapshot interpolation follows packet spacing, holds on loss, and does not extrapolate", async () => {
  const { sampleBoat } = await import("../public/js/presentation.js");
  const snapshots = [{ at: 0, boat: { x: 0, z: 0, rotation: 0, velocityZ: 2 } },
    { at: 67, boat: { x: 1, z: 2, rotation: 0.2, velocityZ: 2 } },
    { at: 150, boat: { x: 2, z: 4, rotation: 0.4, velocityZ: 2 } }];
  assert.equal(sampleBoat([], 0), null);
  assert.equal(sampleBoat(snapshots, -5).x, 0);
  assert.equal(sampleBoat(snapshots, 33.5).x, 0.5);
  assert.equal(sampleBoat(snapshots, 108.5).x, 1.5);
  assert.deepEqual(sampleBoat(snapshots, 300), snapshots.at(-1).boat);
});
