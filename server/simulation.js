const { GAME_CONSTANTS } = require("./constants");
const { LEVELS } = require("./levels");
const {
  clamp,
  distance,
  nearestPointOnPath,
  normalize,
} = require("./geometry");

function emptyStats() {
  return { leftStrokes: 0, rightStrokes: 0, strokes: 0, synchronizedStrokes: 0, collisions: 0 };
}

function summarizeStats(stats) {
  // Each accepted stroke can belong to at most one synchronized pair.
  return { ...stats, syncPercentage: stats.strokes
    ? Math.round(200 * stats.synchronizedStrokes / stats.strokes) : 0 };
}

class BoatSimulation {
  constructor({ levels = LEVELS, constants = GAME_CONSTANTS } = {}) {
    this.levels = levels;
    this.constants = constants;
    this.resetRun();
  }

  resetRun() {
    this.levelIndex = 0;
    this.levelTimes = [];
    this.totalElapsedMs = 0;
    this.runStats = emptyStats();
    this.levelSummaries = [];
    this.completed = false;
    this.loadLevel(0);
  }

  get collisions() { return this.runStats.collisions; }
  get strokes() { return this.runStats.strokes; }
  get synchronizedStrokes() { return this.runStats.synchronizedStrokes; }
  getRunStats() { return summarizeStats(this.runStats); }

  restartLevel() {
    // Discard only this attempt. Previously completed rivers still count.
    this.totalElapsedMs = Math.max(0, this.totalElapsedMs - this.levelElapsedMs);
    for (const key of Object.keys(this.runStats)) this.runStats[key] -= this.levelStats[key];
    this.levelTimes.length = this.levelIndex;
    this.levelSummaries.length = this.levelIndex;
    this.completed = false;
    this.loadLevel(this.levelIndex);
  }

  incrementStat(key) {
    this.runStats[key] += 1;
    this.levelStats[key] += 1;
  }

  loadLevel(index) {
    const level = this.levels[index];
    if (!level) {
      this.completed = true;
      return false;
    }
    this.levelIndex = index;
    this.level = level;
    this.boat = {
      x: level.start.x,
      z: level.start.z,
      rotation: level.start.rotation,
      velocityX: 0,
      velocityZ: 0,
      angularVelocity: 0,
    };
    this.levelElapsedMs = 0;
    this.levelStats = emptyStats();
    this.checkpointIndex = 0;
    this.oars = {
      left: { lastStrokeAt: -Infinity },
      right: { lastStrokeAt: -Infinity },
    };
    this.lastStroke = { side: null, at: -Infinity };
    this.contacts = new Set();
    this.recoveryAnchor = { x: this.boat.x, z: this.boat.z };
    this.stuckMs = 0;
    this.recoveryCount = 0;
    this.finishedLevel = false;
    return true;
  }

  row(side, nowMs = this.levelElapsedMs) {
    if (this.completed || this.finishedLevel || !["left", "right"].includes(side)) {
      return { accepted: false, reason: "not-rowable" };
    }
    const oar = this.oars[side];
    if (nowMs - oar.lastStrokeAt < this.constants.rowCooldownMs) {
      return { accepted: false, reason: "cooldown" };
    }

    const opposite = side === "left" ? "right" : "left";
    const synchronized =
      this.lastStroke.side === opposite &&
      nowMs - this.lastStroke.at <= this.constants.syncWindowMs;
    const syncMultiplier = synchronized ? 2 * this.constants.syncForwardBonus - 1 : 1;
    // Looking downstream (+Z), screen-right is -X in the fixed camera.
    const forwardX = -Math.sin(this.boat.rotation);
    const forwardZ = Math.cos(this.boat.rotation);
    const impulse = this.constants.strokeImpulse * syncMultiplier;

    this.boat.velocityX += forwardX * impulse;
    this.boat.velocityZ += forwardZ * impulse;
    this.boat.angularVelocity +=
      side === "left"
        ? this.constants.turnImpulse
        : -this.constants.turnImpulse;

    oar.lastStrokeAt = nowMs;
    this.lastStroke = synchronized ? { side: null, at: -Infinity } : { side, at: nowMs };
    this.incrementStat("strokes");
    this.incrementStat(`${side}Strokes`);
    if (synchronized) {
      this.incrementStat("synchronizedStrokes");
    }
    this.limitSpeeds();
    return { accepted: true, side, synchronized };
  }

  update(deltaSeconds = this.constants.fixedDelta) {
    if (this.completed || this.finishedLevel) {
      return { levelComplete: false, gameComplete: this.completed };
    }

    const deltaMs = deltaSeconds * 1000;
    this.levelElapsedMs += deltaMs;
    this.totalElapsedMs += deltaMs;
    this.applyCurrents(deltaSeconds);
    this.limitSpeeds();

    this.boat.x += this.boat.velocityX * deltaSeconds;
    this.boat.z += this.boat.velocityZ * deltaSeconds;
    this.boat.rotation += this.boat.angularVelocity * deltaSeconds;

    this.boat.velocityX *= Math.pow(
      this.constants.drag,
      deltaSeconds * this.constants.tickRate,
    );
    this.boat.velocityZ *= Math.pow(
      this.constants.drag,
      deltaSeconds * this.constants.tickRate,
    );
    this.boat.angularVelocity *= Math.pow(
      this.constants.angularDrag,
      deltaSeconds * this.constants.tickRate,
    );
    this.limitSpeeds();

    const collisions = this.resolveCollisions(deltaSeconds);
    this.recoverIfStuck(deltaMs);
    this.limitSpeeds();

    this.updateCheckpoints();
    const levelComplete = this.updateFinish();
    return { levelComplete, gameComplete: this.completed, collisions };
  }

  applyCurrents(deltaSeconds) {
    for (const current of this.level.currents) {
      const dist = distance(this.boat.x, this.boat.z, current.x, current.z);
      if (dist <= current.radius) {
        const falloff = 1 - dist / current.radius;
        this.boat.velocityX +=
          current.forceX * this.constants.currentScale * falloff * deltaSeconds;
        this.boat.velocityZ +=
          current.forceZ * this.constants.currentScale * falloff * deltaSeconds;
      }
    }
  }

  resolveRiverbankCollision(touched, deltaSeconds) {
    const nearest = nearestPointOnPath(this.boat, this.level.path);
    const allowedDistance = this.level.halfWidth - this.constants.boatRadius;
    const dist = Math.sqrt(nearest.distanceSq);
    if (dist <= allowedDistance) return;

    const normal = normalize(this.boat.x - nearest.x, this.boat.z - nearest.z);
    this.boat.x = nearest.x + normal.x * allowedDistance;
    this.boat.z = nearest.z + normal.z * allowedDistance;
    const outwardVelocity =
      this.boat.velocityX * normal.x + this.boat.velocityZ * normal.z;
    if (outwardVelocity > 0) {
      this.boat.velocityX -=
        (1 + this.constants.bankBounce) * outwardVelocity * normal.x;
      this.boat.velocityZ -=
        (1 + this.constants.bankBounce) * outwardVelocity * normal.z;
    }
    if (!touched.has("bank") && outwardVelocity > 0) {
      const retention = Math.exp(-this.constants.bankFriction * deltaSeconds);
      this.boat.velocityX *= retention;
      this.boat.velocityZ *= retention;
      // Turn the bow gently toward the water without removing bank-parallel motion.
      const turn = Math.cos(this.boat.rotation) * normal.x + Math.sin(this.boat.rotation) * normal.z;
      this.boat.angularVelocity += turn * this.constants.bankSteer * deltaSeconds;
    }
    if (!touched.has("bank")) {
      touched.set("bank", { kind: "bank", normalX: -normal.x, normalZ: -normal.z,
        strength: clamp(Math.abs(outwardVelocity) / this.constants.maxSpeed, 0.15, 1) });
    }
  }

  resolveRockCollisions(touched) {
    for (const [index, rock] of this.level.rocks.entries()) {
      const key = `rock:${index}`;
      const minimum = rock.radius + this.constants.boatRadius;
      const dx = this.boat.x - rock.x;
      const dz = this.boat.z - rock.z;
      const dist = Math.hypot(dx, dz);
      if (dist >= minimum) {
        continue;
      }
      // At the exact center, prefer the direction back out of the incoming motion.
      const normal = dist > 0.0001 ? normalize(dx, dz)
        : normalize(-this.boat.velocityX, -this.boat.velocityZ);
      this.boat.x = rock.x + normal.x * minimum;
      this.boat.z = rock.z + normal.z * minimum;
      const towardRock =
        this.boat.velocityX * normal.x + this.boat.velocityZ * normal.z;
      if (towardRock < 0) {
        this.boat.velocityX -=
          (1 + this.constants.rockBounce) * towardRock * normal.x;
        this.boat.velocityZ -=
          (1 + this.constants.rockBounce) * towardRock * normal.z;
      }
      if (!this.contacts.has(key) && !touched.has(key)) {
        this.boat.velocityX *= this.constants.rockTangentRetention;
        this.boat.velocityZ *= this.constants.rockTangentRetention;
        this.boat.angularVelocity += clamp(
          normal.x * this.boat.velocityZ - normal.z * this.boat.velocityX, -1, 1,
        ) * this.constants.rockTurnImpulse;
      }
      if (!touched.has(key)) {
        touched.set(key, { kind: "rock", normalX: normal.x, normalZ: normal.z,
          strength: clamp(Math.abs(towardRock) / this.constants.maxSpeed, 0.2, 1) });
      }
    }
  }

  resolveCollisions(deltaSeconds) {
    const touched = new Map();
    // Alternate constraints so a rock cannot leave the boat embedded in a bank.
    for (let i = 0; i < this.constants.collisionIterations; i += 1) {
      this.resolveRockCollisions(touched);
      this.resolveRiverbankCollision(touched, deltaSeconds);
    }
    const contacts = new Set(touched.keys());
    const release = this.constants.contactReleaseDistance;
    const nearest = nearestPointOnPath(this.boat, this.level.path);
    if (this.contacts.has("bank") && Math.sqrt(nearest.distanceSq) >=
      this.level.halfWidth - this.constants.boatRadius - release) contacts.add("bank");
    this.level.rocks.forEach((rock, index) => {
      const key = `rock:${index}`;
      if (this.contacts.has(key) && distance(this.boat.x, this.boat.z, rock.x, rock.z) <=
        rock.radius + this.constants.boatRadius + release) contacts.add(key);
    });
    const events = [];
    for (const [key, event] of touched) {
      if (!this.contacts.has(key)) {
        this.incrementStat("collisions");
        events.push(event);
      }
    }
    this.contacts = contacts;
    return events;
  }

  geometryPenalty(point) {
    const nearest = nearestPointOnPath(point, this.level.path);
    let penalty = Math.max(0, Math.sqrt(nearest.distanceSq) -
      (this.level.halfWidth - this.constants.boatRadius));
    for (const rock of this.level.rocks) {
      penalty += Math.max(0, rock.radius + this.constants.boatRadius -
        distance(point.x, point.z, rock.x, rock.z));
    }
    return penalty;
  }

  recoverIfStuck(deltaMs) {
    const moved = distance(this.boat.x, this.boat.z, this.recoveryAnchor.x, this.recoveryAnchor.z);
    const lastRow = Math.max(this.oars.left.lastStrokeAt, this.oars.right.lastStrokeAt);
    if (!this.contacts.size || moved > this.constants.recoveryMovement ||
      this.levelElapsedMs - lastRow > this.constants.recoveryRowRecencyMs) {
      this.stuckMs = 0;
      this.recoveryAnchor = { x: this.boat.x, z: this.boat.z };
      return;
    }
    this.stuckMs += deltaMs;
    if (this.stuckMs < this.constants.recoveryDelayMs) return;

    // Only after sustained failed rowing: find a nearby open direction and nudge
    // velocity toward it. Never teleport or skip checkpoint/finish checks.
    let best;
    for (let i = 0; i < this.constants.recoveryDirections; i += 1) {
      const angle = i * Math.PI * 2 / this.constants.recoveryDirections;
      const direction = { x: Math.sin(angle), z: Math.cos(angle) };
      const probe = { x: this.boat.x + direction.x * this.constants.recoveryProbeDistance,
        z: this.boat.z + direction.z * this.constants.recoveryProbeDistance };
      const nearest = nearestPointOnPath(probe, this.level.path);
      const score = this.geometryPenalty(probe) * this.constants.recoveryGeometryWeight + Math.sqrt(nearest.distanceSq);
      if (!best || score < best.score) best = { ...direction, score };
    }
    this.boat.velocityX += best.x * this.constants.recoveryImpulse;
    this.boat.velocityZ += best.z * this.constants.recoveryImpulse;
    const turn = -Math.sin(this.boat.rotation) * best.z - Math.cos(this.boat.rotation) * best.x;
    this.boat.angularVelocity += turn * this.constants.recoveryTurnImpulse;
    this.recoveryCount += 1;
    this.stuckMs = 0;
    this.recoveryAnchor = { x: this.boat.x, z: this.boat.z };
  }

  updateCheckpoints() {
    const checkpoint = this.level.checkpoints[this.checkpointIndex];
    if (!checkpoint) {
      return false;
    }
    if (
      distance(this.boat.x, this.boat.z, checkpoint.x, checkpoint.z) <=
      checkpoint.radius
    ) {
      this.checkpointIndex += 1;
      return true;
    }
    return false;
  }

  updateFinish() {
    const allCheckpoints =
      this.checkpointIndex >= this.level.checkpoints.length;
    const inFinish =
      distance(
        this.boat.x,
        this.boat.z,
        this.level.finish.x,
        this.level.finish.z,
      ) <= this.level.finish.radius;
    if (!allCheckpoints || !inFinish) {
      return false;
    }
    this.finishedLevel = true;
    this.levelTimes[this.levelIndex] = Math.round(this.levelElapsedMs);
    this.levelSummaries[this.levelIndex] = {
      level: this.level.id, levelName: this.level.name,
      timeMs: this.levelTimes[this.levelIndex], ...summarizeStats(this.levelStats),
    };
    if (this.levelIndex === this.levels.length - 1) {
      this.completed = true;
    }
    return true;
  }

  advanceLevel() {
    if (!this.finishedLevel || this.completed) {
      return false;
    }
    return this.loadLevel(this.levelIndex + 1);
  }

  limitSpeeds() {
    const speed = Math.hypot(this.boat.velocityX, this.boat.velocityZ);
    if (speed > this.constants.maxSpeed) {
      const scale = this.constants.maxSpeed / speed;
      this.boat.velocityX *= scale;
      this.boat.velocityZ *= scale;
    }
    this.boat.angularVelocity = clamp(
      this.boat.angularVelocity,
      -this.constants.maxAngularSpeed,
      this.constants.maxAngularSpeed,
    );
  }

  getState() {
    return {
      level: this.level.id,
      levelName: this.level.name,
      boat: { ...this.boat },
      checkpoint: {
        current: this.checkpointIndex,
        total: this.level.checkpoints.length,
      },
      elapsedMs: Math.round(this.levelElapsedMs),
      totalElapsedMs: Math.round(this.totalElapsedMs),
      ...this.getRunStats(),
      levelStats: { ...summarizeStats(this.levelStats), timeMs: Math.round(this.levelElapsedMs) },
      oars: Object.fromEntries(Object.entries(this.oars).map(([side, oar]) => [side, {
        cooldownRemainingMs: Math.max(0, this.constants.rowCooldownMs -
          (this.levelElapsedMs - oar.lastStrokeAt)),
      }])),
      finishedLevel: this.finishedLevel,
      gameComplete: this.completed,
    };
  }
}

module.exports = {
  BoatSimulation,
};
