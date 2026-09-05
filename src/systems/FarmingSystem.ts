// =============================================================================
// FarmingSystem
// Owns the soil grid and crop tiles. All mutation goes through this class so
// invariants (tilth required before planting, NPK never negative, etc.) hold
// in one place. Growth is advanced once per sim-day via tickDay(), called by
// TimeSystem's "day_changed" event — NOT every frame.
// =============================================================================

import { CROP_SPECIES } from "@/state/content";
import {
  createDefaultSoil,
  type CropSpeciesId,
  type CropStage,
  type CropTile,
  type GridCoord,
  type SoilState,
  type WeatherKind,
} from "@/state/types";

export type FarmEvent =
  | { kind: "tilled"; coord: GridCoord }
  | { kind: "watered"; coord: GridCoord; amount: number }
  | { kind: "planted"; coord: GridCoord; species: CropSpeciesId }
  | { kind: "stage_advanced"; coord: GridCoord; stage: CropStage }
  | { kind: "harvested"; coord: GridCoord; species: CropSpeciesId; yieldAmount: number; wasMega: boolean }
  | { kind: "crop_died"; coord: GridCoord; reason: "rot" | "drought" | "old_age" }
  | { kind: "mega_growth"; coord: GridCoord; species: CropSpeciesId };

export type FarmListener = (event: FarmEvent) => void;

function coordKey(c: GridCoord): string {
  return `${c.x},${c.z}`;
}

export class FarmingSystem {
  private soilByCoord = new Map<string, SoilState>();
  private cropByCoord = new Map<string, CropTile>();
  private listeners = new Set<FarmListener>();

  /** Reserved for future randomized soil-quality variance on tile creation. */
  constructor(private rng: () => number = Math.random) {}

  /** Exposes the injected RNG so callers (tests, future features) can reuse the same stream. */
  getRng(): () => number {
    return this.rng;
  }

  subscribe(listener: FarmListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: FarmEvent) {
    for (const l of this.listeners) l(event);
  }

  // ---------------------------------------------------------------------
  // Grid access
  // ---------------------------------------------------------------------

  getOrCreateSoil(coord: GridCoord): SoilState {
    const key = coordKey(coord);
    let soil = this.soilByCoord.get(key);
    if (!soil) {
      soil = createDefaultSoil(coord);
      this.soilByCoord.set(key, soil);
    }
    return soil;
  }

  getCrop(coord: GridCoord): CropTile | undefined {
    return this.cropByCoord.get(coordKey(coord));
  }

  allSoil(): SoilState[] {
    return Array.from(this.soilByCoord.values());
  }

  allCrops(): CropTile[] {
    return Array.from(this.cropByCoord.values());
  }

  // ---------------------------------------------------------------------
  // Player actions
  // ---------------------------------------------------------------------

  /** Tills a tile: untilled/hardpan -> tilled. No-op on flooded ground. */
  till(coord: GridCoord): boolean {
    const soil = this.getOrCreateSoil(coord);
    if (soil.moisture >= 0.85) return false; // too muddy to till
    if (soil.tilth === "tilled") return false;
    soil.tilth = "tilled";
    soil.compacted = false;
    this.emit({ kind: "tilled", coord });
    return true;
  }

  /** Pours `amount` (0..1 fraction of a full watering-can charge, ~0.4 moisture) onto a tile. */
  water(coord: GridCoord, amount = 0.4): void {
    const soil = this.getOrCreateSoil(coord);
    soil.moisture = clamp01(soil.moisture + amount);
    this.emit({ kind: "watered", coord, amount });
  }

  /** Applies compost/manure, restoring NPK. Manure leans nitrogen-heavy; compost is balanced. */
  fertilize(coord: GridCoord, kind: "compost" | "manure"): void {
    const soil = this.getOrCreateSoil(coord);
    if (kind === "compost") {
      soil.npk.nitrogen = clampNpk(soil.npk.nitrogen + 18);
      soil.npk.phosphorus = clampNpk(soil.npk.phosphorus + 18);
      soil.npk.potassium = clampNpk(soil.npk.potassium + 18);
    } else {
      soil.npk.nitrogen = clampNpk(soil.npk.nitrogen + 32);
      soil.npk.phosphorus = clampNpk(soil.npk.phosphorus + 8);
      soil.npk.potassium = clampNpk(soil.npk.potassium + 6);
    }
  }

  /** Amends pH toward neutral (lime raises pH, sulfur lowers it). */
  amendPh(coord: GridCoord, direction: "raise" | "lower", amount = 0.6): void {
    const soil = this.getOrCreateSoil(coord);
    soil.ph = clampPh(soil.ph + (direction === "raise" ? amount : -amount));
  }

  plant(coord: GridCoord, species: CropSpeciesId, currentDay: number): boolean {
    const soil = this.getOrCreateSoil(coord);
    if (soil.tilth !== "tilled") return false;
    if (this.cropByCoord.has(coordKey(coord))) return false;

    const tile: CropTile = {
      coord,
      species,
      stage: "seed",
      stageProgress: 0,
      daysHarvestable: 0,
      health: 100,
      isMegaGrown: false,
      plantedOnDay: currentDay,
    };
    this.cropByCoord.set(coordKey(coord), tile);
    this.emit({ kind: "planted", coord, species });
    return true;
  }

  /** Returns null if nothing was harvested (not harvestable yet). */
  harvest(coord: GridCoord): { species: CropSpeciesId; yieldAmount: number; wasMega: boolean } | null {
    const key = coordKey(coord);
    const tile = this.cropByCoord.get(key);
    if (!tile || tile.stage !== "harvestable") return null;

    const def = CROP_SPECIES[tile.species];
    const healthFactor = tile.health / 100;
    let yieldAmount = Math.max(1, Math.round((1 + healthFactor) * (tile.isMegaGrown ? 4 : 1)));
    const wasMega = tile.isMegaGrown;

    this.cropByCoord.delete(key);
    // Harvesting draws down soil NPK a final time (roots pulled with the crop).
    const soil = this.getOrCreateSoil(coord);
    soil.npk.nitrogen = clampNpk(soil.npk.nitrogen - def.npkUptakePerDay.nitrogen * 2);
    soil.npk.phosphorus = clampNpk(soil.npk.phosphorus - def.npkUptakePerDay.phosphorus * 2);
    soil.npk.potassium = clampNpk(soil.npk.potassium - def.npkUptakePerDay.potassium * 2);
    soil.tilth = "untilled";

    this.emit({ kind: "harvested", coord, species: tile.species, yieldAmount, wasMega });
    return { species: tile.species, yieldAmount, wasMega };
  }

  // ---------------------------------------------------------------------
  // Daily simulation tick — the heart of the agronomy model
  // ---------------------------------------------------------------------

  /**
   * Advances every soil tile and crop by one sim-day. `sunExposure` is 0..1
   * (average daily sun height from TimeSystem), `weather` drives rain
   * replenishment and frost damage.
   */
  tickDay(currentDay: number, sunExposure: number, weather: WeatherKind): void {
    this.tickSoil(sunExposure, weather);
    this.tickCrops(currentDay, weather);
  }

  private tickSoil(sunExposure: number, weather: WeatherKind): void {
    const rainfall = weather === "thunderstorm" ? 0.55 : weather === "rain" ? 0.3 : 0;
    const evapRate = 0.06 + sunExposure * 0.1 + (weather === "drought" ? 0.12 : 0);

    for (const soil of this.soilByCoord.values()) {
      soil.moisture = clamp01(soil.moisture + rainfall - evapRate);

      if (weather === "frost") {
        // Frost doesn't dry the soil out, but it stalls biological activity.
        soil.moisture = clamp01(soil.moisture - 0.01);
      }

      soil.floodedDays = soil.moisture >= 0.9 ? soil.floodedDays + 1 : 0;
      soil.droughtDays = soil.moisture <= 0.05 ? soil.droughtDays + 1 : 0;

      // Packed hardpan forms if a tilled tile floods for 3+ consecutive days.
      if (soil.floodedDays >= 3 && soil.tilth === "tilled") {
        soil.tilth = "hardpan";
      }

      // Slow natural NPK regeneration from soil biota (very slow without compost).
      soil.npk.nitrogen = clampNpk(soil.npk.nitrogen + 0.4);
      soil.npk.phosphorus = clampNpk(soil.npk.phosphorus + 0.2);
      soil.npk.potassium = clampNpk(soil.npk.potassium + 0.2);

      // pH drifts slowly toward neutral (7) over time.
      soil.ph += (7 - soil.ph) * 0.02;
    }
  }

  private tickCrops(currentDay: number, weather: WeatherKind): void {
    for (const tile of this.cropByCoord.values()) {
      if (tile.stage === "rotten") continue;
      const def = CROP_SPECIES[tile.species];
      const soil = this.getOrCreateSoil(tile.coord);

      const moistureOk = soil.moisture >= def.idealMoisture.min && soil.moisture <= def.idealMoisture.max;
      const phOk = soil.ph >= def.idealPh.min && soil.ph <= def.idealPh.max;

      // Consume NPK proportional to uptake rate; overfertilization = uptake satisfied
      // several times over, which is what flags mega-growth eligibility below.
      const nAvail = soil.npk.nitrogen / Math.max(1, def.npkUptakePerDay.nitrogen);
      const pAvail = soil.npk.phosphorus / Math.max(1, def.npkUptakePerDay.phosphorus);
      const kAvail = soil.npk.potassium / Math.max(1, def.npkUptakePerDay.potassium);
      const nutrientAbundance = Math.min(nAvail, pAvail, kAvail); // roughly "days of food banked"

      soil.npk.nitrogen = clampNpk(soil.npk.nitrogen - def.npkUptakePerDay.nitrogen);
      soil.npk.phosphorus = clampNpk(soil.npk.phosphorus - def.npkUptakePerDay.phosphorus);
      soil.npk.potassium = clampNpk(soil.npk.potassium - def.npkUptakePerDay.potassium);

      // --- Health adjustments -------------------------------------------------
      let healthDelta = 0;
      if (soil.floodedDays >= 2) healthDelta -= 12; // root rot from overwatering
      if (soil.droughtDays >= 2) healthDelta -= 10; // wilting from underwatering
      if (!moistureOk) healthDelta -= 2;
      if (!phOk) healthDelta -= 2;
      if (weather === "frost") healthDelta -= 18;
      if (weather === "thunderstorm") healthDelta -= 3;
      if (moistureOk && phOk && nutrientAbundance > 3) healthDelta += 3;

      tile.health = clamp(tile.health + healthDelta, 0, 100);

      if (tile.health <= 0) {
        tile.stage = "rotten";
        this.emit({ kind: "crop_died", coord: tile.coord, reason: soil.floodedDays >= 2 ? "rot" : "drought" });
        continue;
      }

      // --- Mega-growth check (overfertilization comedic event) ---------------
      if (def.megaGrowthEligible && !tile.isMegaGrown && nutrientAbundance > 8 && tile.stage !== "seed") {
        tile.isMegaGrown = true;
        this.emit({ kind: "mega_growth", coord: tile.coord, species: tile.species });
      }

      // --- Stage progression ---------------------------------------------------
      if (tile.stage === "harvestable") {
        tile.daysHarvestable += 1;
        if (tile.daysHarvestable > def.harvestWindowDays) {
          tile.stage = "rotten";
          this.emit({ kind: "crop_died", coord: tile.coord, reason: "old_age" });
        }
        continue;
      }

      // Growth halts entirely (no stage progress) while wilting or rotting from stress —
      // it doesn't reverse, it just stalls, matching the "underwatering halts growth" spec.
      const growthStalled = soil.droughtDays >= 1 || tile.health < 25;
      if (growthStalled) continue;

      const stageIndex = stageToIndex(tile.stage);
      const durationDays = def.stageDurationDays[stageIndex] ?? 1;
      tile.stageProgress += 1 / durationDays;

      if (tile.stageProgress >= 1) {
        tile.stageProgress = 0;
        tile.stage = nextStage(tile.stage);
        this.emit({ kind: "stage_advanced", coord: tile.coord, stage: tile.stage });
      }

      void currentDay; // reserved for future season-based growth modifiers
    }
  }
}

function stageToIndex(stage: CropStage): number {
  switch (stage) {
    case "seed":
      return 0;
    case "sprout":
      return 1;
    case "vegetative":
      return 2;
    case "flowering":
      return 3;
    default:
      return 0;
  }
}

function nextStage(stage: CropStage): CropStage {
  switch (stage) {
    case "seed":
      return "sprout";
    case "sprout":
      return "vegetative";
    case "vegetative":
      return "flowering";
    case "flowering":
      return "harvestable";
    default:
      return stage;
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
function clamp01(v: number): number {
  return clamp(v, 0, 1);
}
function clampNpk(v: number): number {
  return clamp(v, 0, 100);
}
function clampPh(v: number): number {
  return clamp(v, 0, 14);
}
