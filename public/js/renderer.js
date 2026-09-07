import * as THREE from "/vendor/three.module.js";
import { BoatView } from "./boat-view.js";
import { WorldView } from "./world-view.js";

export class LittleBoatRenderer {
  constructor(host) {
    this.host = host;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xbbe8d4);
    this.camera = new THREE.OrthographicCamera(-12, 12, 8, -8, 0.1, 200);
    this.camera.position.set(0, 18, -16);
    this.camera.lookAt(0, 0, 8);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.host.append(this.renderer.domElement);

    this.world = new WorldView(this.scene);
    this.boat = new BoatView();
    this.scene.add(this.boat.group);
    this.levels = new Map();
    this.currentLevelId = null;
    this.previousState = null;
    this.currentState = null;
    this.currentReceivedAt = performance.now();
    this.followTarget = new THREE.Vector3(0, 0, 7);

    this.addLighting();
    this.resize();
    window.addEventListener("resize", () => this.resize());
    this.render = this.render.bind(this);
    requestAnimationFrame(this.render);
  }

  setLevels(levels) {
    this.levels = new Map(levels.map((level) => [level.id, level]));
    this.world.setLevel(levels[0]);
  }

  setState(state) {
    if (this.currentState && state.collisions > this.currentState.collisions) {
      this.boat.bumpUntil = performance.now() + 450;
    }
    this.previousState = this.currentState || state;
    this.currentState = state;
    this.currentReceivedAt = performance.now();
    if (state.level !== this.currentLevelId) {
      this.previousState = state;
      this.currentLevelId = state.level;
      this.world.setLevel(this.levels.get(state.level));
    }
    this.world.setProgress(state.checkpoint.current);
  }

  stroke(side, synchronized = false) {
    this.boat.stroke(side, synchronized);
  }

  addLighting() {
    const ambient = new THREE.HemisphereLight(0xffffff, 0x5fa66b, 2.2);
    this.scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xffffff, 2.6);
    sun.position.set(-8, 14, -6);
    this.scene.add(sun);
  }

  resize() {
    const width = this.host.clientWidth || window.innerWidth;
    const height = this.host.clientHeight || window.innerHeight;
    const aspect = width / height;
    const viewHeight = width < 700 ? 16 : 18;
    this.camera.left = -viewHeight * aspect * 0.5;
    this.camera.right = viewHeight * aspect * 0.5;
    this.camera.top = viewHeight * 0.5;
    this.camera.bottom = -viewHeight * 0.5;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  render() {
    const boatState = this.interpolateBoat();
    this.boat.update(boatState);
    if (boatState) {
      const targetX = boatState.x;
      const targetZ = boatState.z + 7;
      this.followTarget.lerp(new THREE.Vector3(targetX, 0, targetZ), 0.055);
      this.camera.position.set(this.followTarget.x, 18, this.followTarget.z - 16);
      this.camera.lookAt(this.followTarget);
    }
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.render);
  }

  interpolateBoat() {
    if (!this.currentState) {
      return null;
    }
    if (!this.previousState) {
      return this.currentState.boat;
    }
    const interval = 1000 / 18;
    const alpha = Math.min(
      1,
      (performance.now() - this.currentReceivedAt) / interval,
    );
    const previous = this.previousState.boat;
    const current = this.currentState.boat;
    return {
      x: previous.x + (current.x - previous.x) * alpha,
      z: previous.z + (current.z - previous.z) * alpha,
      rotation:
        previous.rotation + (current.rotation - previous.rotation) * alpha,
    };
  }
}
