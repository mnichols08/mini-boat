const assert = require("node:assert/strict");
const test = require("node:test");
const { GAME_CONSTANTS } = require("../server/constants");
const { nearestPointOnPath } = require("../server/geometry");
const { BoatSimulation } = require("../server/simulation");

function makeSimulation(overrides = {}) {
  const constants = { ...GAME_CONSTANTS, ...overrides };
  return new BoatSimulation({ constants });
}

test("left stroke adds forward impulse and rotates right", () => {
  const simulation = makeSimulation();
  const result = simulation.row("left", 0);

  assert.equal(result.accepted, true);
  assert.ok(simulation.boat.velocityZ > 0);
  assert.ok(simulation.boat.angularVelocity > 0);
});

test("right stroke adds forward impulse and rotates left", () => {
  const simulation = makeSimulation();
  const result = simulation.row("right", 0);

  assert.equal(result.accepted, true);
  assert.ok(simulation.boat.velocityZ > 0);
  assert.ok(simulation.boat.angularVelocity < 0);
});

test("synchronized strokes mostly cancel rotation and receive bonus", () => {
  const simulation = makeSimulation({ maxSpeed: 20 });
  simulation.row("left", 0);
  const afterLeft = simulation.boat.velocityZ;
  const result = simulation.row("right", 180);

  assert.equal(result.synchronized, true);
  assert.ok(Math.abs(simulation.boat.angularVelocity) < 0.001);
  assert.ok(
    simulation.boat.velocityZ > afterLeft + GAME_CONSTANTS.strokeImpulse,
  );
});

test("cooldown prevents impossible stroke spam", () => {
  const simulation = makeSimulation();
  assert.equal(simulation.row("left", 0).accepted, true);
  assert.equal(simulation.row("left", 100).accepted, false);
  assert.equal(simulation.row("left", 600).accepted, true);
});

test("velocity moves boat and drag reduces speed", () => {
  const simulation = makeSimulation();
  simulation.boat.velocityZ = 5;
  simulation.update(1 / 30);

  assert.ok(simulation.boat.z > 0);
  assert.ok(simulation.boat.velocityZ < 5);
});

test("angular drag reduces rotation speed", () => {
  const simulation = makeSimulation();
  simulation.boat.angularVelocity = 2;
  simulation.update(1 / 30);

  assert.ok(simulation.boat.rotation > 0);
  assert.ok(simulation.boat.angularVelocity < 2);
});

test("boat speed is capped and fixed timestep remains stable", () => {
  const simulation = makeSimulation();
  simulation.boat.velocityZ = 200;
  for (let index = 0; index < 240; index += 1) {
    simulation.update(1 / 30);
  }
  assert.ok(Number.isFinite(simulation.boat.x));
  assert.ok(Number.isFinite(simulation.boat.z));
  assert.ok(
    Math.hypot(simulation.boat.velocityX, simulation.boat.velocityZ) <=
      GAME_CONSTANTS.maxSpeed,
  );
});

test("boat cannot pass through riverbank boundary", () => {
  const simulation = makeSimulation();
  simulation.boat.x = 50;
  simulation.boat.z = 12;
  simulation.update(1 / 30);
  const nearest = nearestPointOnPath(simulation.boat, simulation.level.path);
  const allowedDistance =
    simulation.level.halfWidth - GAME_CONSTANTS.boatRadius;

  assert.ok(Math.sqrt(nearest.distanceSq) <= allowedDistance + 0.001);
});

test("rock collision redirects velocity and does not trap boat", () => {
  const simulation = makeSimulation();
  simulation.loadLevel(1);
  const rock = simulation.level.rocks[0];
  simulation.boat.x = rock.x;
  simulation.boat.z = rock.z - 0.1;
  simulation.boat.velocityZ = 2;
  simulation.update(1 / 30);
  const firstDistance = Math.hypot(
    simulation.boat.x - rock.x,
    simulation.boat.z - rock.z,
  );
  simulation.row("left", 1000);
  simulation.update(1 / 30);

  assert.ok(firstDistance >= rock.radius + GAME_CONSTANTS.boatRadius - 0.001);
  assert.ok(Number.isFinite(simulation.boat.x));
});

test("entering and leaving current changes applied force", () => {
  const levels = [
    {
      id: "current-test",
      name: "Current Test",
      start: { x: 0, z: 0, rotation: 0 },
      path: [
        { x: 0, z: -20 },
        { x: 0, z: 20 },
      ],
      halfWidth: 50,
      rocks: [],
      currents: [{ x: 0, z: 0, radius: 5, forceX: 0, forceZ: 1 }],
      checkpoints: [],
      finish: { x: 0, z: 100, radius: 2 },
    },
  ];
  const simulation = new BoatSimulation({ levels, constants: GAME_CONSTANTS });
  const current = simulation.level.currents[0];
  simulation.boat.x = current.x;
  simulation.boat.z = current.z;
  simulation.update(1 / 30);
  const pushedVelocity = simulation.boat.velocityZ;
  simulation.boat.x = current.x + current.radius + 20;
  simulation.boat.z = current.z;
  simulation.boat.velocityZ = 0;
  simulation.update(1 / 30);

  assert.ok(pushedVelocity > 0);
  assert.equal(simulation.boat.velocityZ, 0);
});

test("checkpoints must be triggered in order and finish waits for them", () => {
  const simulation = makeSimulation();
  const finish = simulation.level.finish;
  simulation.boat.x = finish.x;
  simulation.boat.z = finish.z;
  assert.equal(simulation.update(1 / 30).levelComplete, false);

  const checkpoint = simulation.level.checkpoints[0];
  simulation.boat.x = checkpoint.x;
  simulation.boat.z = checkpoint.z;
  simulation.update(1 / 30);
  simulation.boat.x = finish.x;
  simulation.boat.z = finish.z;
  assert.equal(simulation.update(1 / 30).levelComplete, true);
});

test("completing level 1 loads level 2 and completing level 3 ends run", () => {
  const simulation = makeSimulation();
  simulation.checkpointIndex = simulation.level.checkpoints.length;
  simulation.boat.x = simulation.level.finish.x;
  simulation.boat.z = simulation.level.finish.z;
  simulation.update(1 / 30);
  assert.equal(simulation.advanceLevel(), true);
  assert.equal(simulation.level.id, "level-2");

  simulation.loadLevel(2);
  simulation.checkpointIndex = simulation.level.checkpoints.length;
  simulation.boat.x = simulation.level.finish.x;
  simulation.boat.z = simulation.level.finish.z;
  simulation.update(1 / 30);
  assert.equal(simulation.completed, true);
});

test("sync bonus is 25 percent for a pair with production constants", () => {
  const sim = makeSimulation();
  sim.row('left', 0); sim.row('right', 0);
  assert.ok(Math.abs(sim.boat.velocityZ - 2 * GAME_CONSTANTS.strokeImpulse * 1.25) < 1e-10);
});

test("sustained bank contact counts once and a later impact counts again", () => {
  const sim = makeSimulation();
  for(let i=0;i<90;i++) { sim.boat.x=20; sim.update(); }
  assert.equal(sim.collisions,1);
  sim.boat.x=0; sim.update(); sim.boat.x=20; sim.update();
  assert.equal(sim.collisions,2);
});

test("later checkpoints cannot be collected out of order", () => {
  const sim=makeSimulation(); sim.loadLevel(1);
  Object.assign(sim.boat,sim.level.checkpoints[2]); sim.update();
  assert.equal(sim.checkpointIndex,0);
});

test("invalid inherited oar names are rejected",()=> {
  assert.equal(makeSimulation().row('toString').accepted,false);
});
