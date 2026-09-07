import * as THREE from "/vendor/three.module.js";
import { BoatView } from "./boat-view.js";
import { WorldView } from "./world-view.js";
import { WaterEffects } from "./water-effects.js";
import { VIEW, sampleBoat } from "./presentation.js";

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
    this.water = new WaterEffects(this.scene);
    this.levels = new Map();
    this.currentLevelId = null;
    this.currentState = null;
    this.snapshots = [];
    this.lastFrameAt = performance.now();
    this.cameraTarget = new THREE.Vector3();
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
    const reset =
      state.level !== this.currentLevelId ||
      state.elapsedMs < (this.currentState?.elapsedMs || 0);
    this.currentState = state;
    if (reset) {
      this.snapshots = [];
      this.resetFeedback();
      this.followTarget.set(state.boat.x, 0, state.boat.z + VIEW.cameraAhead);
    }
    this.snapshots.push({ at: performance.now(), boat: state.boat });
    if (this.snapshots.length > 12) this.snapshots.shift();
    if (state.level !== this.currentLevelId) {
      this.currentLevelId = state.level;
      this.world.setLevel(this.levels.get(state.level));
    }
    this.world.setProgress(state.checkpoint.current);
  }

  stroke(side, synchronized = false) {
    this.boat.stroke(side);
    const boat = this.interpolateBoat();
    const now = performance.now();
    this.water.splash(boat, side, synchronized, now);
    if (synchronized)
      this.water.splash(boat, side === "left" ? "right" : "left", true, now);
  }

  setSeat(seat) {
    this.boat.setSeat(seat);
  }

  ping(side, ping, durationMs) {
    this.boat.ping(side, ping, durationMs);
  }

  celebrate() {
    this.boat.celebrate();
  }

  resetFeedback() {
    this.boat.resetFeedback();
    this.water.reset();
  }

  collision(event) {
    this.boat.bump(event);
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
    const now = performance.now();
    const delta = Math.min(0.05, (now - this.lastFrameAt) / 1000);
    this.lastFrameAt = now;
    const boatState = this.interpolateBoat();
    this.boat.update(boatState, now);
    this.water.update(
      boatState,
      now,
      this.currentState?.roomStatus === "playing",
    );
    if (boatState) {
      const sideLead = THREE.MathUtils.clamp(
        boatState.velocityX * VIEW.cameraSideLead,
        -VIEW.cameraMaxSideLead,
        VIEW.cameraMaxSideLead,
      );
      const forwardLead = THREE.MathUtils.clamp(
        boatState.velocityZ * VIEW.cameraSpeedLead,
        0,
        VIEW.cameraMaxLead,
      );
      this.cameraTarget.set(
        boatState.x + sideLead,
        0,
        boatState.z + VIEW.cameraAhead + forwardLead,
      );
      this.followTarget.lerp(
        this.cameraTarget,
        1 - Math.exp(-VIEW.cameraResponse * delta),
      );
      this.camera.position.set(
        this.followTarget.x,
        18,
        this.followTarget.z - 16,
      );
      this.camera.lookAt(this.followTarget);
    }
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.render);
  }

  interpolateBoat() {
    return sampleBoat(this.snapshots, performance.now() - VIEW.interpolationMs);
  }
}
