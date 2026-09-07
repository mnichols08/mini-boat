function distanceSquared(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

function distance(ax, az, bx, bz) {
  return Math.sqrt(distanceSquared(ax, az, bx, bz));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function nearestPointOnSegment(point, a, b) {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const lengthSq = abx * abx + abz * abz;
  if (lengthSq === 0) {
    return { x: a.x, z: a.z, t: 0 };
  }
  const t = clamp(
    ((point.x - a.x) * abx + (point.z - a.z) * abz) / lengthSq,
    0,
    1,
  );
  return { x: a.x + abx * t, z: a.z + abz * t, t };
}

function nearestPointOnPath(point, path) {
  let best = null;
  for (let index = 0; index < path.length - 1; index += 1) {
    const candidate = nearestPointOnSegment(
      point,
      path[index],
      path[index + 1],
    );
    const distSq = distanceSquared(point.x, point.z, candidate.x, candidate.z);
    if (!best || distSq < best.distanceSq) {
      best = { ...candidate, distanceSq: distSq, segmentIndex: index };
    }
  }
  return best;
}

function normalize(x, z) {
  const length = Math.hypot(x, z);
  if (length < 0.0001) {
    return { x: 0, z: 1 };
  }
  return { x: x / length, z: z / length };
}

module.exports = {
  clamp,
  distance,
  distanceSquared,
  nearestPointOnPath,
  normalize,
};
