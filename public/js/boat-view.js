import * as THREE from "/vendor/three.module.js";
import { VIEW } from "./presentation.js";

const LEFT_COLOR = 0xf28c38;
const RIGHT_COLOR = 0x3b8adf;

export class BoatView {
  constructor() {
    this.group = new THREE.Group();
    this.oars = new Map();
    this.buildBoat();
    this.resetFeedback();
  }

  buildBoat() {
    const hullMaterial = new THREE.MeshStandardMaterial({
      color: 0xa56638,
      roughness: 0.8,
    });
    const rimMaterial = new THREE.MeshStandardMaterial({
      color: 0xf2c178,
      roughness: 0.75,
    });
    const darkWood = new THREE.MeshStandardMaterial({
      color: 0x6e3f26,
      roughness: 0.8,
    });

    const hull = new THREE.Mesh(
      new THREE.BoxGeometry(1.65, 0.42, 2.8),
      hullMaterial,
    );
    hull.position.y = 0.26;
    hull.scale.x = 0.85;
    this.group.add(hull);

    const bow = new THREE.Mesh(
      new THREE.ConeGeometry(0.84, 0.78, 4),
      hullMaterial,
    );
    bow.rotation.y = Math.PI / 4;
    bow.position.set(0, 0.26, 1.72);
    bow.scale.z = 0.72;
    this.group.add(bow);

    for (const z of [-0.72, 0.56]) {
      const bench = new THREE.Mesh(
        new THREE.BoxGeometry(1.75, 0.12, 0.28),
        rimMaterial,
      );
      bench.position.set(0, 0.56, z);
      this.group.add(bench);
    }

    this.addPassenger("left", 0.38, -0.52, LEFT_COLOR);
    this.addPassenger("right", -0.38, 0.42, RIGHT_COLOR);
    this.addOar("left", 0.8, -0.25, LEFT_COLOR);
    this.addOar("right", -0.8, 0.28, RIGHT_COLOR);

    const nose = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.12, 0.5),
      darkWood,
    );
    nose.position.set(0, 0.56, 1.48);
    this.group.add(nose);
  }

  addPassenger(side, x, z, color) {
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.65,
    });
    const skinMaterial = new THREE.MeshStandardMaterial({
      color: 0xffd59d,
      roughness: 0.7,
    });
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.18, 0.26, 4, 8),
      bodyMaterial,
    );
    body.position.set(x, 0.82, z);
    body.rotation.x = 0.12;
    this.group.add(body);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 14, 10),
      skinMaterial,
    );
    head.position.set(x, 1.1, z + 0.02);
    this.group.add(head);

    const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0x17333a });
    for (const eyeX of [-0.055, 0.055]) {
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.018, 6, 4),
        eyeMaterial,
      );
      eye.position.set(x + eyeX, 1.13, z + 0.16);
      this.group.add(eye);
    }

    const arm = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.08, 0.5),
      bodyMaterial,
    );
    arm.position.set(side === "left" ? x + 0.22 : x - 0.22, 0.92, z + 0.08);
    arm.rotation.z = side === "left" ? -0.55 : 0.55;
    this.group.add(arm);
  }

  addOar(side, x, z, color) {
    const oarGroup = new THREE.Group();
    const shaftMaterial = new THREE.MeshStandardMaterial({
      color: 0x7b4a2a,
      roughness: 0.8,
    });
    const bladeMaterial = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.7,
    });

    const shaft = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.08, 2.35),
      shaftMaterial,
    );
    const direction = side === "left" ? 1 : -1;
    shaft.position.x = direction * 0.7;
    shaft.rotation.y = Math.PI / 2;
    oarGroup.add(shaft);

    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.055, 0.56),
      bladeMaterial,
    );
    blade.position.set(
      direction * 1.65,
      -0.03,
      0,
    );
    blade.rotation.y = Math.PI / 2;
    oarGroup.add(blade);

    oarGroup.position.set(x, 0.54, z);
    oarGroup.userData.strokeUntil = 0;
    this.oars.set(side, oarGroup);
    this.group.add(oarGroup);
  }

  stroke(side) {
    const oar = this.oars.get(side);
    if (!oar) {
      return;
    }
    oar.userData.strokeUntil = performance.now() + VIEW.strokeMs;
  }

  resetFeedback() {
    for (const oar of this.oars.values()) {
      oar.userData.strokeUntil = 0;
      oar.rotation.set(0, 0, 0);
    }
    this.bumpUntil = 0;
    this.bumpStrength = 0;
    this.group.rotation.x = 0;
    this.group.rotation.z = 0;
  }

  bump({ kind, strength, normalX, normalZ }) {
    this.bumpUntil = performance.now() + VIEW.bumpMs;
    this.bumpStrength = (kind === "rock" ? 1 : 0.55) * (0.4 + strength * 0.6);
    const heading = -this.group.rotation.y;
    this.bumpSide = Math.sign(normalX * Math.cos(heading) + normalZ * Math.sin(heading)) || 1;
  }

  update(boatState, now = performance.now()) {
    if (boatState) {
      this.group.position.set(boatState.x, 0, boatState.z);
      this.group.rotation.y = -boatState.rotation;
    }

    const bump = Math.max(0, this.bumpUntil - now) / VIEW.bumpMs;
    let roll = Math.sin(bump * Math.PI * 3) * bump * VIEW.bumpRock * this.bumpStrength * (this.bumpSide || 1);
    let pitch = Math.sin(bump * Math.PI * 2) * bump * VIEW.bumpRock * this.bumpStrength * 0.5;
    for (const [side, oar] of this.oars) {
      const progress = Math.min(1, Math.max(0, (oar.userData.strokeUntil - now) / VIEW.strokeMs));
      const direction = side === "left" ? -1 : 1;
      const pull = Math.sin(progress * Math.PI);
      oar.rotation.y = direction * pull * VIEW.oarSweep;
      oar.rotation.z = direction * pull * VIEW.oarDip;
      roll += direction * Math.sin(progress * Math.PI * 2) * VIEW.rowRock;
      pitch += pull * VIEW.rowRock * 0.35;
    }
    this.group.rotation.z = roll;
    this.group.rotation.x = pitch;
  }
}
