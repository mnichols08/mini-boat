import * as THREE from "/vendor/three.module.js";
import { VIEW } from "./presentation.js";

export class WaterEffects {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.ringGeometry = new THREE.RingGeometry(0.13, 0.19, 16);
    this.dropGeometry = new THREE.IcosahedronGeometry(0.07, 0);
    this.splashes = [];
    this.wake = Array.from({ length: VIEW.wakeCount }, () => {
      const mark = this.makeMesh(this.ringGeometry);
      mark.visible = false;
      return mark;
    });
    this.reset();
  }

  makeMesh(geometry, color = 0xe5ffff) {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0, depthWrite: false,
    }));
    mesh.rotation.x = -Math.PI / 2;
    this.group.add(mesh);
    return mesh;
  }

  reset() {
    this.wake.forEach((mark) => { mark.visible = false; });
    this.splashes.forEach((mesh) => { mesh.removeFromParent(); mesh.material.dispose(); });
    this.splashes = [];
    this.lastWake = null;
    this.wakeIndex = 0;
  }

  splash(boat, side, synchronized, now) {
    if (!boat) return;
    const local = new THREE.Vector3(side === "left" ? 2.2 : -2.2, 0.08,
      side === "left" ? -0.25 : 0.28);
    local.applyAxisAngle(new THREE.Vector3(0, 1, 0), -boat.rotation);
    local.x += boat.x;
    local.z += boat.z;
    const scale = synchronized ? VIEW.syncSplashScale : 1;
    for (let i = 0; i < 4; i += 1) {
      const mesh = this.makeMesh(i === 0 ? this.ringGeometry : this.dropGeometry,
        synchronized ? 0xfff2bd : 0xe5ffff);
      mesh.position.copy(local);
      mesh.userData = { at: now, scale, drop: i, origin: local.clone() };
      this.splashes.push(mesh);
    }
  }

  update(boat, now, moving) {
    const speed = boat ? Math.hypot(boat.velocityX, boat.velocityZ) : 0;
    if (boat && moving && speed > VIEW.wakeMinSpeed && (!this.lastWake ||
      Math.hypot(boat.x - this.lastWake.x, boat.z - this.lastWake.z) >= VIEW.wakeSpacing)) {
      // World-space marks stay behind as the stern sweeps through a turn.
      for (const side of [-1, 1]) {
        const mark = this.wake[this.wakeIndex++ % this.wake.length];
        const offset = new THREE.Vector3(side * 0.55, 0.06, -1.4)
          .applyAxisAngle(new THREE.Vector3(0, 1, 0), -boat.rotation);
        mark.position.set(boat.x + offset.x, 0.06, boat.z + offset.z);
        mark.rotation.z = boat.rotation + side * 0.3;
        mark.userData = { at: now, speed };
        mark.visible = true;
      }
      this.lastWake = { x: boat.x, z: boat.z };
    }
    for (const mark of this.wake) {
      if (!mark.visible) continue;
      const age = (now - mark.userData.at) / VIEW.wakeLifeMs;
      mark.visible = age < 1;
      mark.material.opacity = Math.max(0, (1 - age) * Math.min(0.36, 0.1 + mark.userData.speed * 0.06));
      mark.scale.set(1.1 + age * 2, 0.45 + age * 0.6, 1);
    }
    this.splashes = this.splashes.filter((mesh) => {
      const { at, scale, drop, origin } = mesh.userData;
      const age = (now - at) / VIEW.splashMs;
      if (age >= 1) {
        mesh.removeFromParent(); mesh.material.dispose(); return false;
      }
      mesh.material.opacity = (1 - age) * 0.8;
      if (drop) {
        mesh.scale.setScalar(scale * (1 - age * 0.5));
        mesh.position.set(origin.x + Math.cos(drop * 2.1) * age * 0.45 * scale,
          origin.y + Math.sin(age * Math.PI) * 0.35 * scale,
          origin.z + Math.sin(drop * 2.1) * age * 0.45 * scale);
      } else mesh.scale.setScalar(scale * (1 + age * 3.4));
      return true;
    });
  }
}
