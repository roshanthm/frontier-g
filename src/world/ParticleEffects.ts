// =============================================================================
// ParticleEffects
// Lightweight GPU-friendly particle bursts using THREE.Points with per-particle
// velocity/life stored in typed arrays (no per-particle object allocation after
// setup). Handles one-shot bursts (till dust, water splash, harvest sparkle,
// mud-slip debris) and continuous emitters (rain, snow) that Game.ts starts/
// stops as weather changes.
// =============================================================================

import * as THREE from "three";

interface Burst {
  points: THREE.Points;
  velocities: Float32Array;
  maxLife: number;
  age: number;
  gravity: number;
}

export type WeatherParticleKind = "rain" | "snow" | "none";

export class ParticleEffects {
  private scene: THREE.Scene;
  private bursts: Burst[] = [];
  private weatherPoints: THREE.Points | null = null;
  private weatherVelocities: Float32Array | null = null;
  private weatherKind: WeatherParticleKind = "none";
  private weatherBoundsCenter = new THREE.Vector3();
  private readonly weatherAreaRadius = 16;
  private readonly weatherHeight = 14;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  // ---------------------------------------------------------------------
  // One-shot bursts
  // ---------------------------------------------------------------------

  private spawnBurst(
    position: THREE.Vector3,
    count: number,
    color: number,
    size: number,
    speed: number,
    spread: "hemisphere" | "sphere" | "cone_up",
    maxLife: number,
    gravity: number
  ): void {
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = position.x;
      positions[i * 3 + 1] = position.y;
      positions[i * 3 + 2] = position.z;

      let vx: number, vy: number, vz: number;
      if (spread === "cone_up") {
        const theta = Math.random() * Math.PI * 2;
        const r = Math.random() * 0.4;
        vx = Math.cos(theta) * r * speed;
        vz = Math.sin(theta) * r * speed;
        vy = (0.7 + Math.random() * 0.5) * speed;
      } else if (spread === "hemisphere") {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.random() * (Math.PI / 2);
        vx = Math.sin(phi) * Math.cos(theta) * speed;
        vy = Math.cos(phi) * speed;
        vz = Math.sin(phi) * Math.sin(theta) * speed;
      } else {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        vx = Math.sin(phi) * Math.cos(theta) * speed;
        vy = Math.cos(phi) * speed;
        vz = Math.sin(phi) * Math.sin(theta) * speed;
      }
      velocities[i * 3] = vx;
      velocities[i * 3 + 1] = vy;
      velocities[i * 3 + 2] = vz;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color,
      size,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(geometry, material);
    this.scene.add(points);
    this.bursts.push({ points, velocities, maxLife, age: 0, gravity });
  }

  tillDust(position: THREE.Vector3): void {
    this.spawnBurst(position.clone().add(new THREE.Vector3(0, 0.1, 0)), 18, 0x8a6d4b, 0.12, 1.1, "hemisphere", 0.6, -1.2);
  }

  waterSplash(position: THREE.Vector3): void {
    this.spawnBurst(position.clone().add(new THREE.Vector3(0, 0.15, 0)), 14, 0x8fd0f0, 0.09, 1.6, "cone_up", 0.5, -4);
  }

  harvestSparkle(position: THREE.Vector3): void {
    this.spawnBurst(position.clone().add(new THREE.Vector3(0, 0.4, 0)), 20, 0xffe28a, 0.1, 1.2, "sphere", 0.7, -0.5);
  }

  mudSlipDebris(position: THREE.Vector3): void {
    this.spawnBurst(position.clone().add(new THREE.Vector3(0, 0.05, 0)), 24, 0x5a4632, 0.11, 1.8, "hemisphere", 0.55, -3);
  }

  megaGrowthBurst(position: THREE.Vector3): void {
    this.spawnBurst(position.clone().add(new THREE.Vector3(0, 0.5, 0)), 40, 0x9adf6c, 0.14, 2.0, "sphere", 1.0, -1);
  }

  // ---------------------------------------------------------------------
  // Continuous weather
  // ---------------------------------------------------------------------

  setWeather(kind: WeatherParticleKind, center: THREE.Vector3): void {
    this.weatherBoundsCenter.copy(center);
    if (kind === this.weatherKind) return;
    this.weatherKind = kind;
    this.teardownWeather();
    if (kind === "none") return;

    const count = kind === "rain" ? 900 : 500;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      this.randomizeWeatherParticle(positions, velocities, i, center, kind, true);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: kind === "rain" ? 0xaecbe8 : 0xffffff,
      size: kind === "rain" ? 0.05 : 0.09,
      transparent: true,
      opacity: kind === "rain" ? 0.55 : 0.85,
      depthWrite: false,
    });
    this.weatherPoints = new THREE.Points(geometry, material);
    this.weatherVelocities = velocities;
    this.scene.add(this.weatherPoints);
  }

  private randomizeWeatherParticle(
    positions: Float32Array,
    velocities: Float32Array,
    i: number,
    center: THREE.Vector3,
    kind: WeatherParticleKind,
    randomizeHeight: boolean
  ): void {
    const r = Math.random() * this.weatherAreaRadius;
    const theta = Math.random() * Math.PI * 2;
    positions[i * 3] = center.x + Math.cos(theta) * r;
    positions[i * 3 + 1] = randomizeHeight ? Math.random() * this.weatherHeight : this.weatherHeight;
    positions[i * 3 + 2] = center.z + Math.sin(theta) * r;

    if (kind === "rain") {
      velocities[i * 3] = 0;
      velocities[i * 3 + 1] = -9 - Math.random() * 3;
      velocities[i * 3 + 2] = 0;
    } else {
      velocities[i * 3] = (Math.random() - 0.5) * 0.4;
      velocities[i * 3 + 1] = -1.2 - Math.random() * 0.8;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
    }
  }

  private teardownWeather(): void {
    if (this.weatherPoints) {
      this.scene.remove(this.weatherPoints);
      this.weatherPoints.geometry.dispose();
      (this.weatherPoints.material as THREE.Material).dispose();
      this.weatherPoints = null;
      this.weatherVelocities = null;
    }
  }

  // ---------------------------------------------------------------------
  // Per-frame update
  // ---------------------------------------------------------------------

  update(dt: number): void {
    this.updateBursts(dt);
    this.updateWeather(dt);
  }

  private updateBursts(dt: number): void {
    for (let b = this.bursts.length - 1; b >= 0; b--) {
      const burst = this.bursts[b]!;
      burst.age += dt;
      const positions = burst.points.geometry.getAttribute("position") as THREE.BufferAttribute;
      const arr = positions.array as Float32Array;

      for (let i = 0; i < arr.length / 3; i++) {
        burst.velocities[i * 3 + 1] = burst.velocities[i * 3 + 1]! + burst.gravity * dt;
        arr[i * 3] = arr[i * 3]! + burst.velocities[i * 3]! * dt;
        arr[i * 3 + 1] = arr[i * 3 + 1]! + burst.velocities[i * 3 + 1]! * dt;
        arr[i * 3 + 2] = arr[i * 3 + 2]! + burst.velocities[i * 3 + 2]! * dt;
      }
      positions.needsUpdate = true;

      const lifeFrac = burst.age / burst.maxLife;
      (burst.points.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - lifeFrac);

      if (burst.age >= burst.maxLife) {
        this.scene.remove(burst.points);
        burst.points.geometry.dispose();
        (burst.points.material as THREE.Material).dispose();
        this.bursts.splice(b, 1);
      }
    }
  }

  private updateWeather(dt: number): void {
    if (!this.weatherPoints || !this.weatherVelocities) return;
    const positions = this.weatherPoints.geometry.getAttribute("position") as THREE.BufferAttribute;
    const arr = positions.array as Float32Array;
    const count = arr.length / 3;

    for (let i = 0; i < count; i++) {
      arr[i * 3] = arr[i * 3]! + this.weatherVelocities[i * 3]! * dt;
      arr[i * 3 + 1] = arr[i * 3 + 1]! + this.weatherVelocities[i * 3 + 1]! * dt;
      arr[i * 3 + 2] = arr[i * 3 + 2]! + this.weatherVelocities[i * 3 + 2]! * dt;

      if (arr[i * 3 + 1]! < 0) {
        this.randomizeWeatherParticle(arr, this.weatherVelocities, i, this.weatherBoundsCenter, this.weatherKind, false);
      }
    }
    positions.needsUpdate = true;
  }

  dispose(): void {
    this.teardownWeather();
    for (const burst of this.bursts) {
      this.scene.remove(burst.points);
      burst.points.geometry.dispose();
      (burst.points.material as THREE.Material).dispose();
    }
    this.bursts = [];
  }
}
