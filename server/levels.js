const LEVELS = [
  {
    id: "level-1",
    name: "First Row",
    purpose: "Teach rowing",
    start: { x: 0, z: 0, rotation: 0 },
    path: [
      { x: 0, z: 0 },
      { x: 0, z: 16 },
      { x: 4, z: 31 },
      { x: 8, z: 47 },
    ],
    halfWidth: 6.2,
    rocks: [],
    currents: [],
    checkpoints: [{ id: "l1-c1", x: 2.3, z: 26, radius: 3.2 }],
    finish: { x: 8, z: 49.5, radius: 4.2 },
  },
  {
    id: "level-2",
    name: "Rocky Bend",
    purpose: "Teach steering",
    start: { x: 0, z: 0, rotation: 0.08 },
    path: [
      { x: 0, z: 0 },
      { x: -4, z: 14 },
      { x: 3, z: 31 },
      { x: -2, z: 48 },
      { x: 5, z: 64 },
    ],
    halfWidth: 5.1,
    rocks: [
      { x: -2.2, z: 18, radius: 1.25 },
      { x: 2.4, z: 29, radius: 1.35 },
      { x: -2.3, z: 40, radius: 1.15 },
      { x: 2.2, z: 53, radius: 1.35 },
    ],
    currents: [],
    checkpoints: [
      { id: "l2-c1", x: -3.2, z: 17, radius: 3.2 },
      { id: "l2-c2", x: 2.3, z: 35, radius: 3.0 },
      { id: "l2-c3", x: 1.7, z: 55, radius: 3.2 },
    ],
    finish: { x: 5, z: 66.5, radius: 4.3 },
  },
  {
    id: "level-3",
    name: "Going With the Flow",
    purpose: "Introduce currents",
    start: { x: 0, z: 0, rotation: -0.05 },
    path: [
      { x: 0, z: 0 },
      { x: 5, z: 15 },
      { x: -3, z: 34 },
      { x: 4, z: 55 },
      { x: -1, z: 75 },
      { x: 6, z: 94 },
    ],
    halfWidth: 5,
    rocks: [
      { x: 3.2, z: 18, radius: 1.2 },
      { x: -1.4, z: 31, radius: 1.45 },
      { x: 2.8, z: 48, radius: 1.25 },
      { x: -2.3, z: 66, radius: 1.2 },
      { x: 4.7, z: 81, radius: 1.4 },
    ],
    currents: [
      { x: 3.7, z: 17, radius: 5.2, forceX: -0.32, forceZ: 0.72 },
      { x: -2.5, z: 41, radius: 5.7, forceX: 0.42, forceZ: 0.62 },
      { x: 2.3, z: 69, radius: 6.4, forceX: -0.36, forceZ: 0.78 },
    ],
    checkpoints: [
      { id: "l3-c1", x: 4, z: 18, radius: 3.2 },
      { id: "l3-c2", x: -2.3, z: 38, radius: 3.2 },
      { id: "l3-c3", x: 3.4, z: 61, radius: 3.2 },
      { id: "l3-c4", x: 1.4, z: 83, radius: 3.4 },
    ],
    finish: { x: 6, z: 96.5, radius: 4.6 },
  },
];

function getLevel(index) {
  return LEVELS[index] || null;
}

module.exports = {
  LEVELS,
  getLevel,
};
