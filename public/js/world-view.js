import * as THREE from "/vendor/three.module.js";

export class WorldView {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.scene.add(this.group);
  }

  setLevel(level) {
    this.clear();
    this.gates = [];
    if (!level) {
      return;
    }

    this.addBase(level);
    this.addRiver(level);
    this.addCheckpoints(level);
    this.addRocks(level);
    this.addCurrents(level);
    this.addDock(level.finish.x, level.finish.z, true);
    this.addDock(level.start.x, level.start.z - 2.4, false);
  }

  clear() {
    for (const child of [...this.group.children]) {
      child.traverse((node) => {
        if (node.geometry) node.geometry.dispose();
        if (node.material) node.material.dispose();
      });
      child.removeFromParent();
    }
  }

  addBase(level) {
    const bounds = this.getBounds(level.path);
    const ground = new THREE.Mesh(
      new THREE.BoxGeometry(bounds.width + 28, 0.18, bounds.depth + 32),
      new THREE.MeshStandardMaterial({ color: 0x83c66e, roughness: 1 }),
    );
    ground.position.set(bounds.centerX, -0.12, bounds.centerZ + 8);
    this.group.add(ground);

    for (let index = 0; index < 34; index += 1) {
      const reed = new THREE.Mesh(
        new THREE.ConeGeometry(0.08, 0.65, 5),
        new THREE.MeshStandardMaterial({
          color: index % 2 ? 0xd9c169 : 0x5e9f5f,
          roughness: 0.9,
        }),
      );
      const side = index % 2 ? -1 : 1;
      const pathPoint = level.path[index % level.path.length];
      reed.position.set(
        pathPoint.x + side * (level.halfWidth + 1.2 + (index % 4) * 0.4),
        0.25,
        pathPoint.z + (index % 5) - 2,
      );
      reed.rotation.z = side * 0.25;
      this.group.add(reed);
    }
  }

  addRiver(level) {
    const waterMaterial = new THREE.MeshStandardMaterial({
      color: 0x62c8d0,
      roughness: 0.55,
    });
    for (let index = 0; index < level.path.length - 1; index += 1) {
      const a = level.path[index];
      const b = level.path[index + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const length = Math.hypot(dx, dz);
      const segment = new THREE.Mesh(
        new THREE.BoxGeometry(
          level.halfWidth * 2,
          0.05,
          length,
        ),
        waterMaterial,
      );
      segment.position.set((a.x + b.x) / 2, 0.01, (a.z + b.z) / 2);
      segment.rotation.y = Math.atan2(dx, dz);
      this.group.add(segment);
    }

    for (const point of level.path) {
      const bend = new THREE.Mesh(
        new THREE.CylinderGeometry(level.halfWidth, level.halfWidth, 0.055, 32),
        waterMaterial,
      );
      bend.position.set(point.x, 0.0075, point.z);
      this.group.add(bend);
    }
  }

  addCheckpoints(level) {
    const postMaterial = new THREE.MeshStandardMaterial({
      color: 0x6e3f26,
      roughness: 0.8,
    });
    const bannerMaterial = new THREE.MeshStandardMaterial({
      color: 0xfff0a1,
      roughness: 0.65,
    });
    for (const checkpoint of level.checkpoints) {
      for (const xOffset of [-checkpoint.radius, checkpoint.radius]) {
        const post = new THREE.Mesh(
          new THREE.CylinderGeometry(0.12, 0.16, 1.5, 8),
          postMaterial,
        );
        post.position.set(checkpoint.x + xOffset, 0.74, checkpoint.z);
        this.group.add(post);
      }
      const banner = new THREE.Mesh(
        new THREE.BoxGeometry(checkpoint.radius * 2, 0.16, 0.08),
        bannerMaterial.clone(),
      );
      banner.position.set(checkpoint.x, 1.4, checkpoint.z);
      this.group.add(banner);
      this.gates.push(banner);
    }
  }

  setProgress(count) {
    this.gates?.forEach((gate, index) => {
      gate.material.color.setHex(index < count ? 0x69bd83 : index === count ? 0xffdc65 : 0xfff0a1);
    });
  }

  addRocks(level) {
    const material = new THREE.MeshStandardMaterial({
      color: 0x728080,
      roughness: 1,
    });
    for (const rock of level.rocks) {
      const mesh = new THREE.Mesh(
        new THREE.DodecahedronGeometry(rock.radius, 0),
        material,
      );
      mesh.position.set(rock.x, rock.radius * 0.32, rock.z);
      mesh.scale.y = 0.52;
      mesh.rotation.set(0.4, rock.x, 0.2);
      this.group.add(mesh);
    }
  }

  addCurrents(level) {
    const material = new THREE.MeshBasicMaterial({
      color: 0xe8ffff,
      transparent: true,
      opacity: 0.72,
    });
    for (const current of level.currents) {
      for (let index = 0; index < 5; index += 1) {
        const arrow = new THREE.Group();
        const shaft = new THREE.Mesh(
          new THREE.BoxGeometry(0.08, 0.035, 1.0),
          material,
        );
        const head = new THREE.Mesh(
          new THREE.ConeGeometry(0.18, 0.36, 3),
          material,
        );
        head.rotation.x = Math.PI / 2;
        head.position.z = 0.64;
        arrow.add(shaft, head);
        const angle = Math.atan2(current.forceX, current.forceZ);
        arrow.rotation.y = angle;
        arrow.position.set(
          current.x + (index - 2) * 0.72,
          0.09,
          current.z + Math.sin(index) * 0.7,
        );
        this.group.add(arrow);
      }
    }
  }

  addDock(x, z, finish) {
    const material = new THREE.MeshStandardMaterial({
      color: finish ? 0x8b5a34 : 0xb77843,
      roughness: 0.8,
    });
    const dock = new THREE.Group();
    for (let index = 0; index < 4; index += 1) {
      const plank = new THREE.Mesh(
        new THREE.BoxGeometry(3.2, 0.15, 0.34),
        material,
      );
      plank.position.set(0, 0.18, index * 0.38);
      dock.add(plank);
    }
    dock.position.set(x, 0.04, z);
    this.group.add(dock);
  }

  getBounds(path) {
    const xs = path.map((point) => point.x);
    const zs = path.map((point) => point.z);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minZ = Math.min(...zs);
    const maxZ = Math.max(...zs);
    return {
      centerX: (minX + maxX) / 2,
      centerZ: (minZ + maxZ) / 2,
      width: maxX - minX,
      depth: maxZ - minZ,
    };
  }
}
