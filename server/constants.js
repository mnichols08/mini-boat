const TICK_RATE = 30;
const BROADCAST_RATE = 18;

const GAME_CONSTANTS = {
  tickRate: TICK_RATE,
  fixedDelta: 1 / TICK_RATE,
  broadcastRate: BROADCAST_RATE,
  rowCooldownMs: 520,
  syncWindowMs: 210,
  strokeImpulse: 0.65,
  syncForwardBonus: 1.2,
  turnImpulse: 0.65,
  drag: 0.95,
  angularDrag: 0.94,
  currentScale: 1.7,
  maxSpeed: 7.3,
  maxAngularSpeed: 3.4,
  boatRadius: 0.92,
  bankBounce: 0.45,
  rockBounce: 0.58,
  collisionCooldownMs: 700,
  countdownMs: 3200,
  levelAdvanceDelayMs: 3300,
  nicknameMaxLength: 18,
};

module.exports = {
  GAME_CONSTANTS,
};
