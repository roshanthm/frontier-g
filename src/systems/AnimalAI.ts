// =============================================================================
// AnimalAI
// Per-frame behavior for every AnimalEntity: needs decay, temperament
// resolution, wandering/grazing/fleeing state machine, predator hunting logic,
// and guardian-dog patrol/defense. Deliberately data-driven (SPECIES_PROFILE)
// so adding a new animal is a config change, not new code.
// =============================================================================

import type { AnimalActivity, AnimalEntity, AnimalSpeciesId, AnimalTemperament } from "@/state/types";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type AnimalAiEvent =
  | { kind: "tantrum"; animal: AnimalEntity }
  | { kind: "blocked_path"; animal: AnimalEntity }
  | { kind: "escaped_pen"; animal: AnimalEntity }
  | { kind: "trampled_crop"; animal: AnimalEntity; coord: { x: number; z: number } }
  | { kind: "alpaca_spit"; animal: AnimalEntity; target: Vec3 }
  | { kind: "predator_spotted"; predator: AnimalEntity; prey: AnimalEntity }
  | { kind: "prey_caught"; predator: AnimalEntity; prey: AnimalEntity }
  | { kind: "guardian_repelled_threat"; guardian: AnimalEntity; predator: AnimalEntity };

export type AnimalAiListener = (event: AnimalAiEvent) => void;

interface SpeciesProfile {
  role: "livestock" | "beast_of_burden" | "fiber" | "poultry" | "guardian" | "predator" | "wildlife";
  moveSpeed: number;
  wanderRadius: number;
  hungerDecayPerSec: number;
  affectionDecayPerSec: number;
  /** Below this hunger, temperament sours toward grumpy/stubborn. */
  hungerGrumpyThreshold: number;
  /** How many days without care before tantrum chance kicks in (donkeys/horses). */
  tantrumCareThresholdDays: number;
  canBreakFence: boolean;
  fleesFromPredators: boolean;
  isPredator: boolean;
  isGuardian: boolean;
}

const SPECIES_PROFILES: Record<AnimalSpeciesId, SpeciesProfile> = {
  cow: {
    role: "livestock",
    moveSpeed: 0.6,
    wanderRadius: 4,
    hungerDecayPerSec: 0.05,
    affectionDecayPerSec: 0.02,
    hungerGrumpyThreshold: 35,
    tantrumCareThresholdDays: 3,
    canBreakFence: false,
    fleesFromPredators: true,
    isPredator: false,
    isGuardian: false,
  },
  bull: {
    role: "livestock",
    moveSpeed: 0.65,
    wanderRadius: 4,
    hungerDecayPerSec: 0.06,
    affectionDecayPerSec: 0.025,
    hungerGrumpyThreshold: 45,
    tantrumCareThresholdDays: 2,
    canBreakFence: true,
    fleesFromPredators: false,
    isPredator: false,
    isGuardian: false,
  },
  horse: {
    role: "beast_of_burden",
    moveSpeed: 1.4,
    wanderRadius: 6,
    hungerDecayPerSec: 0.045,
    affectionDecayPerSec: 0.02,
    hungerGrumpyThreshold: 40,
    tantrumCareThresholdDays: 2,
    canBreakFence: true,
    fleesFromPredators: true,
    isPredator: false,
    isGuardian: false,
  },
  donkey: {
    role: "beast_of_burden",
    moveSpeed: 0.9,
    wanderRadius: 5,
    hungerDecayPerSec: 0.04,
    affectionDecayPerSec: 0.018,
    hungerGrumpyThreshold: 30,
    tantrumCareThresholdDays: 1, // donkeys are famously dramatic
    canBreakFence: true,
    fleesFromPredators: false,
    isPredator: false,
    isGuardian: false,
  },
  alpaca: {
    role: "fiber",
    moveSpeed: 0.7,
    wanderRadius: 4,
    hungerDecayPerSec: 0.035,
    affectionDecayPerSec: 0.015,
    hungerGrumpyThreshold: 35,
    tantrumCareThresholdDays: 4,
    canBreakFence: false,
    fleesFromPredators: true,
    isPredator: false,
    isGuardian: false,
  },
  chicken: {
    role: "poultry",
    moveSpeed: 0.5,
    wanderRadius: 3,
    hungerDecayPerSec: 0.06,
    affectionDecayPerSec: 0.03,
    hungerGrumpyThreshold: 30,
    tantrumCareThresholdDays: 5,
    canBreakFence: false,
    fleesFromPredators: true,
    isPredator: false,
    isGuardian: false,
  },
  husky: {
    role: "guardian",
    moveSpeed: 2.0,
    wanderRadius: 8,
    hungerDecayPerSec: 0.045,
    affectionDecayPerSec: 0.02,
    hungerGrumpyThreshold: 30,
    tantrumCareThresholdDays: 5,
    canBreakFence: false,
    fleesFromPredators: false,
    isPredator: false,
    isGuardian: true,
  },
  fox: {
    role: "predator",
    moveSpeed: 1.6,
    wanderRadius: 12,
    hungerDecayPerSec: 0.03,
    affectionDecayPerSec: 0,
    hungerGrumpyThreshold: 0,
    tantrumCareThresholdDays: 999,
    canBreakFence: false,
    fleesFromPredators: false,
    isPredator: true,
    isGuardian: false,
  },
  deer: {
    role: "wildlife",
    moveSpeed: 1.3,
    wanderRadius: 15,
    hungerDecayPerSec: 0.02,
    affectionDecayPerSec: 0,
    hungerGrumpyThreshold: 0,
    tantrumCareThresholdDays: 999,
    canBreakFence: false,
    fleesFromPredators: true,
    isPredator: false,
    isGuardian: false,
  },
  stag: {
    role: "wildlife",
    moveSpeed: 1.5,
    wanderRadius: 15,
    hungerDecayPerSec: 0.02,
    affectionDecayPerSec: 0,
    hungerGrumpyThreshold: 0,
    tantrumCareThresholdDays: 999,
    canBreakFence: false,
    fleesFromPredators: true,
    isPredator: false,
    isGuardian: false,
  },
};

function dist(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

export class AnimalAI {
  private listeners = new Set<AnimalAiListener>();
  private rng: () => number;

  constructor(rng: () => number = Math.random) {
    this.rng = rng;
  }

  subscribe(listener: AnimalAiListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: AnimalAiEvent) {
    for (const l of this.listeners) l(event);
  }

  static createAnimal(id: string, species: AnimalSpeciesId, position: Vec3, seed: number): AnimalEntity {
    return {
      id,
      species,
      position: { ...position },
      heading: 0,
      needs: { hunger: 80, affection: 60, fear: 0, energy: 100 },
      temperament: "content",
      activity: "idle",
      targetPosition: null,
      daysSinceLastCare: 0,
      isPenned: true,
      penId: null,
      huntTargetId: null,
      patrolIndex: 0,
      personalitySeed: seed,
      age: 0,
      health: 100,
    };
  }

  /** Called once per sim-day: decays care counters and re-evaluates temperament. */
  tickDay(animal: AnimalEntity): void {
    animal.daysSinceLastCare += 1;
    animal.age += 1;
    this.resolveTemperament(animal);
  }

  private resolveTemperament(animal: AnimalEntity): void {
    const profile = SPECIES_PROFILES[animal.species];
    if (profile.isPredator || profile.isGuardian || profile.role === "wildlife") return;

    if (animal.needs.fear > 60) {
      animal.temperament = "spooked";
    } else if (animal.daysSinceLastCare >= profile.tantrumCareThresholdDays && this.rng() < 0.35) {
      animal.temperament = "furious";
    } else if (animal.needs.hunger < profile.hungerGrumpyThreshold) {
      animal.temperament = "grumpy";
    } else if (animal.daysSinceLastCare >= Math.max(1, profile.tantrumCareThresholdDays - 1)) {
      animal.temperament = "stubborn";
    } else {
      animal.temperament = "content";
    }
  }

  /**
   * Per-frame update for a single animal. `context` supplies world queries so
   * this class stays free of Three.js / scene-graph dependencies (fully
   * unit-testable in isolation).
   */
  update(
    animal: AnimalEntity,
    deltaSeconds: number,
    context: {
      isNight: boolean;
      allAnimals: AnimalEntity[];
      playerPosition: Vec3;
      penCenter: Vec3 | null;
      penRadius: number;
      nearbyCropCoord: { x: number; z: number } | null;
      randomPointInRadius: (center: Vec3, radius: number) => Vec3;
    }
  ): void {
    const profile = SPECIES_PROFILES[animal.species];

    // --- Needs decay ---------------------------------------------------------
    animal.needs.hunger = Math.max(0, animal.needs.hunger - profile.hungerDecayPerSec * deltaSeconds);
    animal.needs.affection = Math.max(0, animal.needs.affection - profile.affectionDecayPerSec * deltaSeconds);
    animal.needs.fear = Math.max(0, animal.needs.fear - deltaSeconds * 4); // fear decays fast once threat is gone

    if (profile.isPredator) {
      this.updatePredator(animal, deltaSeconds, context);
      return;
    }
    if (profile.isGuardian) {
      this.updateGuardian(animal, deltaSeconds, context);
      return;
    }

    // --- Threat evasion takes priority over everything else ------------------
    if (profile.fleesFromPredators) {
      const nearestPredator = context.allAnimals.find(
        (a) => SPECIES_PROFILES[a.species].isPredator && dist(a.position, animal.position) < 6
      );
      if (nearestPredator) {
        animal.needs.fear = Math.min(100, animal.needs.fear + 40 * deltaSeconds);
        animal.activity = "fleeing";
        const away = normalizeAway(nearestPredator.position, animal.position);
        animal.targetPosition = {
          x: animal.position.x + away.x * 10,
          y: animal.position.y,
          z: animal.position.z + away.z * 10,
        };
        this.moveToward(animal, profile.moveSpeed * 1.6, deltaSeconds);
        return;
      }
    }

    // --- Furious / stubborn animals actively block the nearest farm path ----
    if (animal.temperament === "furious" && profile.canBreakFence) {
      if (this.rng() < 0.002) {
        this.emit({ kind: "tantrum", animal });
        animal.activity = "tantrum";
        if (animal.isPenned && this.rng() < 0.4) {
          animal.isPenned = false;
          this.emit({ kind: "escaped_pen", animal });
        }
      }
    }

    if (animal.temperament === "stubborn" && animal.activity !== "tantrum") {
      if (this.rng() < 0.0015) {
        animal.activity = "blocking_path";
        this.emit({ kind: "blocked_path", animal });
      }
    }

    // Escaped, hungry livestock beeline for the nearest crop tile and trample it.
    if (!animal.isPenned && context.nearbyCropCoord && animal.needs.hunger < 60) {
      animal.activity = "trampling_crops";
      this.emit({ kind: "trampled_crop", animal, coord: context.nearbyCropCoord });
      animal.needs.hunger = Math.min(100, animal.needs.hunger + 25);
      return;
    }

    // Alpacas spit when startled by a nearby fast-approaching player/animal.
    if (animal.species === "alpaca" && animal.needs.fear > 25 && this.rng() < 0.01) {
      this.emit({ kind: "alpaca_spit", animal, target: context.playerPosition });
    }

    // --- Default: idle / wander / graze within pen (or freely if escaped) ---
    if (animal.activity === "tantrum" || animal.activity === "blocking_path" || animal.activity === "trampling_crops") {
      // Let the temporary "drama" activity resolve on its own back to idle.
      if (this.rng() < 0.05) animal.activity = "idle";
      return;
    }

    this.wander(animal, profile, deltaSeconds, context);
  }

  private wander(
    animal: AnimalEntity,
    profile: SpeciesProfile,
    deltaSeconds: number,
    context: { penCenter: Vec3 | null; penRadius: number; randomPointInRadius: (center: Vec3, radius: number) => Vec3 }
  ): void {
    if (!animal.targetPosition || dist(animal.position, animal.targetPosition) < 0.3) {
      const center = animal.isPenned && context.penCenter ? context.penCenter : animal.position;
      const radius = animal.isPenned ? Math.min(profile.wanderRadius, context.penRadius) : profile.wanderRadius;
      animal.targetPosition = context.randomPointInRadius(center, radius);
      animal.activity = animal.needs.hunger < 70 ? "grazing" : "wandering";
    }
    this.moveToward(animal, profile.moveSpeed * (animal.activity === "grazing" ? 0.4 : 1), deltaSeconds);
  }

  private moveToward(animal: AnimalEntity, speed: number, deltaSeconds: number): void {
    if (!animal.targetPosition) return;
    const dx = animal.targetPosition.x - animal.position.x;
    const dz = animal.targetPosition.z - animal.position.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < 0.05) return;
    const step = Math.min(d, speed * deltaSeconds);
    animal.position.x += (dx / d) * step;
    animal.position.z += (dz / d) * step;
    animal.heading = Math.atan2(dx, dz);
  }

  // ---------------------------------------------------------------------
  // Predator (fox/wolf) logic
  // ---------------------------------------------------------------------

  private updatePredator(
    animal: AnimalEntity,
    deltaSeconds: number,
    context: { isNight: boolean; allAnimals: AnimalEntity[]; randomPointInRadius: (center: Vec3, radius: number) => Vec3 }
  ): void {
    const profile = SPECIES_PROFILES[animal.species];

    if (!context.isNight) {
      // Foxes retreat to the tree line during the day.
      animal.activity = "wandering";
      this.wander(animal, profile, deltaSeconds, { penCenter: null, penRadius: 0, randomPointInRadius: context.randomPointInRadius });
      return;
    }

    const guardianNearby = context.allAnimals.find(
      (a) => SPECIES_PROFILES[a.species].isGuardian && dist(a.position, animal.position) < 5
    );
    if (guardianNearby) {
      animal.activity = "fleeing";
      const away = normalizeAway(guardianNearby.position, animal.position);
      animal.targetPosition = { x: animal.position.x + away.x * 12, y: animal.position.y, z: animal.position.z + away.z * 12 };
      this.moveToward(animal, profile.moveSpeed * 1.5, deltaSeconds);
      this.emit({ kind: "guardian_repelled_threat", guardian: guardianNearby, predator: animal });
      animal.huntTargetId = null;
      return;
    }

    if (!animal.huntTargetId) {
      const prey = context.allAnimals.find(
        (a) => (a.species === "chicken" || a.age < 10) && !a.isPenned === false && dist(a.position, animal.position) < 10
      );
      if (prey) {
        animal.huntTargetId = prey.id;
        this.emit({ kind: "predator_spotted", predator: animal, prey });
      }
    }

    const target = context.allAnimals.find((a) => a.id === animal.huntTargetId);
    if (target) {
      animal.activity = "hunting";
      animal.targetPosition = { ...target.position };
      this.moveToward(animal, profile.moveSpeed, deltaSeconds);
      if (dist(animal.position, target.position) < 0.6) {
        this.emit({ kind: "prey_caught", predator: animal, prey: target });
        target.health = 0;
        animal.huntTargetId = null;
      }
    } else {
      animal.activity = "wandering";
      this.wander(animal, profile, deltaSeconds, { penCenter: null, penRadius: 0, randomPointInRadius: context.randomPointInRadius });
    }
  }

  // ---------------------------------------------------------------------
  // Guardian (husky) logic
  // ---------------------------------------------------------------------

  private updateGuardian(
    animal: AnimalEntity,
    deltaSeconds: number,
    context: { allAnimals: AnimalEntity[]; randomPointInRadius: (center: Vec3, radius: number) => Vec3 }
  ): void {
    const profile = SPECIES_PROFILES[animal.species];
    const threat = context.allAnimals.find(
      (a) => SPECIES_PROFILES[a.species].isPredator && dist(a.position, animal.position) < 9
    );

    if (threat) {
      animal.activity = "patrolling";
      animal.targetPosition = { ...threat.position };
      this.moveToward(animal, profile.moveSpeed, deltaSeconds);
      return;
    }

    // Idle patrol loop around a fixed set of waypoints derived from position history.
    if (!animal.targetPosition || dist(animal.position, animal.targetPosition) < 0.4) {
      animal.targetPosition = context.randomPointInRadius(animal.position, profile.wanderRadius);
      animal.patrolIndex = (animal.patrolIndex + 1) % 8;
      animal.activity = "patrolling";
    }
    this.moveToward(animal, profile.moveSpeed * 0.5, deltaSeconds);
  }

  /** Player feeds an animal: raises hunger, resets care timer, may improve temperament. */
  feed(animal: AnimalEntity, amount = 35): void {
    animal.needs.hunger = Math.min(100, animal.needs.hunger + amount);
    animal.daysSinceLastCare = 0;
  }

  /** Player pets an animal: raises affection, lowers fear, resets care timer. */
  pet(animal: AnimalEntity, amount = 20): void {
    animal.needs.affection = Math.min(100, animal.needs.affection + amount);
    animal.needs.fear = Math.max(0, animal.needs.fear - 15);
    animal.daysSinceLastCare = 0;
  }
}

function normalizeAway(threat: Vec3, self: Vec3): { x: number; z: number } {
  const dx = self.x - threat.x;
  const dz = self.z - threat.z;
  const d = Math.sqrt(dx * dx + dz * dz) || 1;
  return { x: dx / d, z: dz / d };
}

export function getSpeciesProfile(species: AnimalSpeciesId): Readonly<SpeciesProfile> {
  return SPECIES_PROFILES[species];
}

export type { AnimalTemperament, AnimalActivity };
