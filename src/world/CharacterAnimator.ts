// =============================================================================
// CharacterAnimator
// Skeleton-free procedural animation: since our low-poly meshes are built from
// primitive parts (see AssetLoader's buildPlaceholder), we animate them by
// directly oscillating each named part's local transform every frame — a walk
// cycle swings legs opposite-phase, torsos bob, tails/ears wag, heads bob when
// grazing. This reads as genuinely alive without needing a skinned mesh or
// bone hierarchy, and upgrades transparently to real skeletal animation later
// if imported .glb files carry AnimationClips (see tryPlayClip below).
// =============================================================================

import * as THREE from "three";

export type LocomotionState = "idle" | "walk" | "run" | "graze" | "spooked";

interface PartRefs {
  legFL?: THREE.Object3D;
  legFR?: THREE.Object3D;
  legBL?: THREE.Object3D;
  legBR?: THREE.Object3D;
  body?: THREE.Object3D;
  head?: THREE.Object3D;
  neck?: THREE.Object3D;
  tail?: THREE.Object3D;
  armL?: THREE.Object3D;
  armR?: THREE.Object3D;
  root: THREE.Object3D;
}

/** Base local Y/rotation captured at bind time so oscillations are additive, not cumulative. */
interface BindPose {
  positions: Map<THREE.Object3D, THREE.Vector3>;
  rotations: Map<THREE.Object3D, THREE.Euler>;
}

export class CharacterAnimator {
  private parts: PartRefs;
  private bind: BindPose = { positions: new Map(), rotations: new Map() };
  private gaitPhase = 0;
  private idlePhase = Math.random() * Math.PI * 2;
  private mixer: THREE.AnimationMixer | null = null;
  private clips: THREE.AnimationClip[] = [];

  constructor(root: THREE.Object3D, parts: Omit<PartRefs, "root">, clips: THREE.AnimationClip[] = []) {
    this.parts = { ...parts, root };
    this.clips = clips;
    this.captureBindPose();

    if (clips.length > 0) {
      // Real imported .glb animation takes priority over the procedural rig.
      this.mixer = new THREE.AnimationMixer(root);
    }
  }

  private captureBindPose(): void {
    for (const obj of Object.values(this.parts)) {
      if (!obj) continue;
      this.bind.positions.set(obj, obj.position.clone());
      this.bind.rotations.set(obj, obj.rotation.clone());
    }
  }

  /** Attempts to play a named clip (e.g. "Walk", "Idle") if the source .glb provided one. */
  tryPlayClip(name: string): boolean {
    if (!this.mixer) return false;
    const clip = THREE.AnimationClip.findByName(this.clips, name);
    if (!clip) return false;
    this.mixer.stopAllAction();
    this.mixer.clipAction(clip).play();
    return true;
  }

  /**
   * Advances the rig by `dt` seconds. `speedFactor` is roughly meters/sec of
   * actual travel — it drives both gait cadence and stride amplitude so a
   * running animal visibly gallops rather than moonwalking at speed.
   */
  update(dt: number, state: LocomotionState, speedFactor: number): void {
    if (this.mixer) {
      this.mixer.update(dt);
      return; // real animation clips fully own the rig; skip procedural layer
    }

    const cadence = state === "run" ? 9 : state === "walk" ? 5.5 : 2;
    this.gaitPhase += dt * cadence * Math.max(0.15, Math.min(speedFactor, 1.6));
    this.idlePhase += dt * 1.6;

    const strideAmp = state === "run" ? 0.55 : state === "walk" ? 0.32 : 0;
    const bobAmp = state === "run" ? 0.09 : state === "walk" ? 0.05 : 0.02;

    this.animateLegs(strideAmp);
    this.animateBody(bobAmp, state);
    this.animateHead(state);
    this.animateTail(state);
    this.animateArms(strideAmp);
  }

  private animateLegs(strideAmp: number): void {
    const { legFL, legFR, legBL, legBR } = this.parts;
    if (legFL && legFR && legBL && legBR) {
      // Diagonal quadruped gait: front-left+back-right swing together, opposite the other pair.
      this.rotateAdditive(legFL, "x", Math.sin(this.gaitPhase) * strideAmp);
      this.rotateAdditive(legBR, "x", Math.sin(this.gaitPhase) * strideAmp);
      this.rotateAdditive(legFR, "x", Math.sin(this.gaitPhase + Math.PI) * strideAmp);
      this.rotateAdditive(legBL, "x", Math.sin(this.gaitPhase + Math.PI) * strideAmp);
      return;
    }
    // Biped fallback (farmer): legFL/legFR reused as left/right leg pivots.
    if (legFL && legFR) {
      this.rotateAdditive(legFL, "x", Math.sin(this.gaitPhase) * strideAmp);
      this.rotateAdditive(legFR, "x", Math.sin(this.gaitPhase + Math.PI) * strideAmp);
    }
  }

  private animateArms(strideAmp: number): void {
    const { armL, armR } = this.parts;
    if (armL && armR) {
      this.rotateAdditive(armL, "x", Math.sin(this.gaitPhase + Math.PI) * strideAmp * 0.7);
      this.rotateAdditive(armR, "x", Math.sin(this.gaitPhase) * strideAmp * 0.7);
    }
  }

  private animateBody(bobAmp: number, state: LocomotionState): void {
    const { body, root } = this.parts;
    const target = body ?? root;
    const bindY = this.bind.positions.get(target)?.y ?? target.position.y;
    const bobFreq = state === "run" || state === "walk" ? this.gaitPhase * 2 : this.idlePhase;
    target.position.y = bindY + Math.abs(Math.sin(bobFreq)) * bobAmp;
  }

  private animateHead(state: LocomotionState): void {
    const { head } = this.parts;
    if (!head) return;
    const bindRot = this.bind.rotations.get(head);
    if (!bindRot) return;

    if (state === "graze") {
      // Slow downward dip-and-rise, like nosing at grass.
      head.rotation.x = bindRot.x + (Math.sin(this.idlePhase * 0.6) * 0.5 + 0.5) * 0.5;
    } else if (state === "spooked") {
      head.rotation.y = bindRot.y + Math.sin(this.idlePhase * 6) * 0.15;
    } else {
      // Gentle idle look-around / breathing sway.
      head.rotation.y = bindRot.y + Math.sin(this.idlePhase * 0.3) * 0.08;
      head.rotation.x = bindRot.x + Math.sin(this.idlePhase * 0.5) * 0.03;
    }
  }

  private animateTail(state: LocomotionState): void {
    const { tail } = this.parts;
    if (!tail) return;
    const bindRot = this.bind.rotations.get(tail);
    if (!bindRot) return;
    const wagSpeed = state === "spooked" ? 10 : state === "walk" || state === "run" ? 4 : 1.2;
    const wagAmp = state === "spooked" ? 0.5 : 0.22;
    tail.rotation.y = bindRot.y + Math.sin(this.idlePhase * wagSpeed) * wagAmp;
  }

  private rotateAdditive(obj: THREE.Object3D, axis: "x" | "y" | "z", delta: number): void {
    const bindRot = this.bind.rotations.get(obj);
    if (!bindRot) return;
    obj.rotation[axis] = bindRot[axis] + delta;
  }
}

export function locomotionFromActivity(activity: string, speed: number): LocomotionState {
  if (activity === "fleeing" || activity === "hunting" || activity === "tantrum") return speed > 0.05 ? "run" : "spooked";
  if (activity === "grazing") return "graze";
  if (speed > 1.0) return "run";
  if (speed > 0.05) return "walk";
  return "idle";
}

/** Builds a CharacterAnimator by looking up the standard named parts on a loaded/placeholder model. */
export function createAnimatorForModel(root: THREE.Object3D, clips: THREE.AnimationClip[] = []): CharacterAnimator {
  const find = (name: string): THREE.Object3D | undefined => root.getObjectByName(name) ?? undefined;
  return new CharacterAnimator(
    root,
    {
      legFL: find("legFL"),
      legFR: find("legFR"),
      legBL: find("legBL"),
      legBR: find("legBR"),
      body: find("body"),
      head: find("head"),
      neck: find("neck"),
      tail: find("tail"),
      armL: find("armL"),
      armR: find("armR"),
    },
    clips
  );
}
