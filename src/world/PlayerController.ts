// =============================================================================
// PlayerController
// Isometric/third-person WASD movement for the farmer, camera-relative so
// "W" always means "away from camera" regardless of the fixed isometric
// camera angle. Tracks the current ground surface for footstep SFX and rolls
// a small chance of a comedic mud-slip while running across wet tiles.
// =============================================================================

import * as THREE from "three";
import type { SurfaceKind } from "@/systems/AudioManager";

export interface PlayerControllerOptions {
  moveSpeed: number;
  runMultiplier: number;
  cameraYawRadians: number;
}

export class PlayerController {
  readonly object: THREE.Object3D;
  velocity = new THREE.Vector3();
  isRunning = false;
  isMoving = false;
  currentSurface: SurfaceKind = "grass";
  private hasSlippedThisMove = false;

  private keys = new Set<string>();
  private options: PlayerControllerOptions;

  constructor(object: THREE.Object3D, options: PlayerControllerOptions) {
    this.object = object;
    this.options = options;
    window.addEventListener("keydown", (e) => this.keys.add(e.code));
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
  }

  dispose(): void {
    this.keys.clear();
  }

  /** Returns true if a "mud slip" pratfall should trigger this frame (running on mud, rare). */
  update(deltaSeconds: number, moistureAtFeet: number): boolean {
    const forward = (this.keys.has("KeyW") || this.keys.has("ArrowUp") ? 1 : 0) - (this.keys.has("KeyS") || this.keys.has("ArrowDown") ? 1 : 0);
    const strafe = (this.keys.has("KeyD") || this.keys.has("ArrowRight") ? 1 : 0) - (this.keys.has("KeyA") || this.keys.has("ArrowLeft") ? 1 : 0);
    this.isRunning = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");

    this.isMoving = forward !== 0 || strafe !== 0;
    this.currentSurface = moistureAtFeet > 0.75 ? "mud" : moistureAtFeet > 0.15 ? "soil" : "grass";

    if (!this.isMoving) {
      this.velocity.set(0, 0, 0);
      this.hasSlippedThisMove = false;
      return false;
    }

    const yaw = this.options.cameraYawRadians;
    const forwardVec = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const rightVec = new THREE.Vector3(Math.sin(yaw + Math.PI / 2), 0, Math.cos(yaw + Math.PI / 2));

    const move = new THREE.Vector3()
      .addScaledVector(forwardVec, forward)
      .addScaledVector(rightVec, strafe);
    if (move.lengthSq() > 0) move.normalize();

    const speed = this.options.moveSpeed * (this.isRunning ? this.options.runMultiplier : 1);
    this.velocity.copy(move).multiplyScalar(speed);

    this.object.position.addScaledVector(this.velocity, deltaSeconds);
    if (move.lengthSq() > 0) {
      this.object.rotation.y = Math.atan2(move.x, move.z);
    }

    // Comedic mud-slip: running on a heavily saturated tile has a small
    // per-continuous-run chance of a pratfall, capped at once per run.
    let didSlip = false;
    if (this.isRunning && this.currentSurface === "mud" && !this.hasSlippedThisMove) {
      if (Math.random() < 0.004) {
        didSlip = true;
        this.hasSlippedThisMove = true;
      }
    }
    return didSlip;
  }
}
