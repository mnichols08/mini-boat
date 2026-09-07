const { GAME_CONSTANTS } = require("./constants");
const { LEVELS } = require("./levels");
const {
  clamp,
  distance,
  nearestPointOnPath,
  normalize,
} = require("./geometry");

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
    this.collisions = 0;
    this.strokes = 0;
    this.synchronizedStrokes = 0;
    this.completed = false;
    this.loadLevel(0);
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
    this.checkpointIndex = 0;
    this.oars = {
      left: { lastStrokeAt: -Infinity },
      right: { lastStrokeAt: -Infinity },
    };
    this.lastStroke = { side: null, at: -Infinity };
    this.lastCollisionAt = -Infinity;
    this.inCollision = false;
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
    this.lastStroke = { side, at: nowMs };
    this.strokes += 1;
    if (synchronized) {
      this.synchronizedStrokes += 1;
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

    const bankCollision = this.resolveRiverbankCollision();
    const rockCollision = this.resolveRockCollisions();
    if ((bankCollision || rockCollision) && !this.inCollision) {
      this.recordCollision();
    }
    this.inCollision = bankCollision || rockCollision;

    this.updateCheckpoints();
    const levelComplete = this.updateFinish();
    return { levelComplete, gameComplete: this.completed };
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

  resolveRiverbankCollision() {
    const nearest = nearestPointOnPath(this.boat, this.level.path);
    const allowedDistance = this.level.halfWidth - this.constants.boatRadius;
    const dist = Math.sqrt(nearest.distanceSq);
    if (dist <= allowedDistance) {
      return false;
    }

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
    this.boat.angularVelocity += clamp(outwardVelocity, -2, 2) * 0.18;
    return true;
  }

  resolveRockCollisions() {
    let collided = false;
    for (const rock of this.level.rocks) {
      const minimum = rock.radius + this.constants.boatRadius;
      const dx = this.boat.x - rock.x;
      const dz = this.boat.z - rock.z;
      const dist = Math.hypot(dx, dz);
      if (dist >= minimum) {
        continue;
      }
      const normal = normalize(dx, dz);
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
      this.boat.velocityX *= 0.66;
      this.boat.velocityZ *= 0.66;
      this.boat.angularVelocity +=
        (normal.x * this.boat.velocityZ - normal.z * this.boat.velocityX) * 0.1;
      collided = true;
    }
    return collided;
  }

  recordCollision() {
    if (
      this.levelElapsedMs - this.lastCollisionAt >=
      this.constants.collisionCooldownMs
    ) {
      this.collisions += 1;
      this.lastCollisionAt = this.levelElapsedMs;
    }
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
      collisions: this.collisions,
      strokes: this.strokes,
      synchronizedStrokes: this.synchronizedStrokes,
      finishedLevel: this.finishedLevel,
      gameComplete: this.completed,
    };
  }
}

module.exports = {
  BoatSimulation,
};
