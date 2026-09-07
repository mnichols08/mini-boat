// Cosmetic tuning only. Authoritative gameplay values live in server/constants.js.
export const VIEW = Object.freeze({
  strokeMs: 440,
  oarSweep: 1.05,
  oarDip: 0.24,
  rowRock: 0.035,
  bumpMs: 520,
  bumpRock: 0.075,
  syncMs: 650,
  splashMs: 540,
  syncSplashScale: 1.25,
  wakeCount: 56,
  wakeLifeMs: 2000,
  wakeSpacing: 0.28,
  wakeMinSpeed: 0.18,
  interpolationMs: 100,
  cameraResponse: 3.5,
  cameraAhead: 4.5,
  cameraSpeedLead: 0.5,
  cameraMaxLead: 2.5,
  cameraSideLead: 0.45,
  cameraMaxSideLead: 1.8,
  audioVolume: 0.12,
});

export function formatTime(ms) {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

// Interpolate a short history instead of restarting a guessed 18 Hz lerp for
// every packet. Actual state broadcasts arrive on the server's 30 Hz ticks.
export function sampleBoat(snapshots, at) {
  if (!snapshots.length) return null;
  for (let i = 1; i < snapshots.length; i += 1) {
    const a = snapshots[i - 1], b = snapshots[i];
    if (b.at < at) continue;
    const alpha = Math.max(0, Math.min(1, (at - a.at) / Math.max(1, b.at - a.at)));
    return Object.fromEntries(Object.keys(b.boat).map((key) =>
      [key, a.boat[key] + (b.boat[key] - a.boat[key]) * alpha]));
  }
  return snapshots.at(-1).boat;
}
