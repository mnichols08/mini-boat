const TICK_RATE = 30;
const BROADCAST_RATE = 18;

const GAME_CONSTANTS = {
  tickRate: TICK_RATE,
  fixedDelta: 1 / TICK_RATE,
  broadcastRate: BROADCAST_RATE,
  rowCooldownMs: 560,
  syncWindowMs: 220,
  strokeImpulse: 0.8,
  syncForwardBonus: 1.25,
  turnImpulse: 0.52,
  drag: 0.968,
  angularDrag: 0.91,
  currentScale: 1.7,
  maxSpeed: 6.5,
  maxAngularSpeed: 2.2,
  boatRadius: 0.92,
  bankBounce: 0.08,
  rockBounce: 0.22,
  bankFriction: 0.7, // Tangential damping per second while pushing into a bank.
  bankSteer: 0.8,
  rockTangentRetention: 0.82, // Applied on entry, not every contact tick.
  rockTurnImpulse: 0.12,
  collisionIterations: 8,
  contactReleaseDistance: 0.12,
  recoveryDelayMs: 1800,
  recoveryMovement: 0.22,
  recoveryRowRecencyMs: 900,
  recoveryProbeDistance: 0.65,
  recoveryDirections: 16,
  recoveryGeometryWeight: 100,
  recoveryImpulse: 0.65,
  recoveryTurnImpulse: 0.3,
  countdownMs: 3200,
  levelAdvanceDelayMs: 5500,
  nicknameMaxLength: 18,
};

module.exports = {
  GAME_CONSTANTS,
};
