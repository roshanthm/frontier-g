// =============================================================================
// Hollow Creek Farm — Core State Model
// Every simulation system reads/writes these shapes. Keep them serializable
// (no class instances, no functions, no Three.js objects) so the whole game
// state can be JSON.stringify'd straight into the save system.
// =============================================================================

/** Grid coordinate on the farm's tile lattice. Integers only. */
export interface GridCoord {
  x: number;
  z: number;
}

// -----------------------------------------------------------------------------
// SOIL
// -----------------------------------------------------------------------------

export type TilthState = "untilled" | "tilled" | "hardpan";

/** Acidic (0) .. Neutral (7) .. Alkaline (14). Most crops want 6-7.5. */
export type PhLevel = number;

export interface NpkLevels {
  /** Nitrogen 0-100. Drives vegetative growth/leaf mass. */
  nitrogen: number;
  /** Phosphorus 0-100. Drives root/flower development. */
  phosphorus: number;
  /** Potassium 0-100. Drives disease resistance & fruit quality. */
  potassium: number;
}

export interface SoilState {
  coord: GridCoord;
  /** 0.0 bone dry -> 1.0 flooded. */
  moisture: number;
  tilth: TilthState;
  npk: NpkLevels;
  ph: PhLevel;
  /** Consecutive days this tile has been flooded (moisture >= 0.9). Drives root rot. */
  floodedDays: number;
  /** Consecutive days this tile has been bone dry (moisture <= 0.05). Drives wilting. */
  droughtDays: number;
  /** True once the tile has been irreversibly compacted by heavy foot/hoof traffic. */
  compacted: boolean;
}

export function createDefaultSoil(coord: GridCoord): SoilState {
  return {
    coord,
    moisture: 0.35,
    tilth: "untilled",
    npk: { nitrogen: 55, phosphorus: 55, potassium: 55 },
    ph: 6.8,
    floodedDays: 0,
    droughtDays: 0,
    compacted: false,
  };
}

// -----------------------------------------------------------------------------
// CROPS
// -----------------------------------------------------------------------------

export type CropStage =
  | "seed"
  | "sprout"
  | "vegetative"
  | "flowering"
  | "harvestable"
  | "rotten";

export type CropSpeciesId =
  | "wheat"
  | "corn"
  | "carrot"
  | "pumpkin"
  | "tomato"
  | "potato"
  | "cabbage"
  | "sunflower";

export interface CropSpeciesDef {
  id: CropSpeciesId;
  displayName: string;
  /** Sim-days required to move between each consecutive stage (4 transitions). */
  stageDurationDays: [number, number, number, number];
  /** Ideal moisture band; outside of it growth penalties apply. */
  idealMoisture: { min: number; max: number };
  /** Ideal pH band. */
  idealPh: { min: number; max: number };
  /** Base NPK consumption per day while actively growing. */
  npkUptakePerDay: NpkLevels;
  /** Days a harvestable crop can sit before rotting. */
  harvestWindowDays: number;
  /** Base sale value per harvested unit, in copper coins. */
  baseValue: number;
  /** Multiplier applied when overfertilized past 1.4x uptake — triggers "mega-crop" event. */
  megaGrowthEligible: boolean;
}

export interface CropTile {
  coord: GridCoord;
  species: CropSpeciesId;
  stage: CropStage;
  /** Progress within the current stage, 0.0 - 1.0. */
  stageProgress: number;
  /** Cumulative sim-days spent in the "harvestable" stage before being picked. */
  daysHarvestable: number;
  /** Health 0-100. Driven by moisture/NPK/pH stress. Zero health -> stage forced to "rotten". */
  health: number;
  /** Set true by the overfertilization comedic event; scales render size + yield. */
  isMegaGrown: boolean;
  plantedOnDay: number;
}

// -----------------------------------------------------------------------------
// ANIMALS
// -----------------------------------------------------------------------------

export type AnimalSpeciesId =
  | "cow"
  | "bull"
  | "horse"
  | "donkey"
  | "alpaca"
  | "chicken"
  | "husky"
  | "fox"
  | "deer"
  | "stag";

export type AnimalTemperament = "content" | "grumpy" | "stubborn" | "spooked" | "furious";

export type AnimalActivity =
  | "idle"
  | "wandering"
  | "grazing"
  | "following"
  | "fleeing"
  | "blocking_path"
  | "hunting"
  | "patrolling"
  | "trampling_crops"
  | "tantrum";

export interface AnimalNeeds {
  /** 0 starving -> 100 full. Decays over time; low hunger sours temperament. */
  hunger: number;
  /** 0 neglected -> 100 adored. Decays slower than hunger; raised by petting. */
  affection: number;
  /** 0 calm -> 100 panicking. Spikes near predators/loud events, decays otherwise. */
  fear: number;
  /** 0 exhausted -> 100 rested. Depletes from labor (plowing/cart-pulling). */
  energy: number;
}

export interface AnimalEntity {
  id: string;
  species: AnimalSpeciesId;
  position: { x: number; y: number; z: number };
  /** Yaw in radians. */
  heading: number;
  needs: AnimalNeeds;
  temperament: AnimalTemperament;
  activity: AnimalActivity;
  /** For wandering/patrol AI: current destination, if any. */
  targetPosition: { x: number; y: number; z: number } | null;
  /** Days since last petted/fed — feeds into the stubbornness/tantrum chance. */
  daysSinceLastCare: number;
  /** True if penned; false if free-ranging (and therefore at risk / mischief-prone). */
  isPenned: boolean;
  penId: string | null;
  /** Predator-only: current stalking target animal id, if any. */
  huntTargetId: string | null;
  /** Guardian-only (husky): current patrol route index. */
  patrolIndex: number;
  /** Cosmetic/personality seed so two cows don't act identically. */
  personalitySeed: number;
  age: number;
  health: number;
}

// -----------------------------------------------------------------------------
// INVENTORY / ECONOMY
// -----------------------------------------------------------------------------

export type ItemCategory = "tool" | "seed" | "produce" | "material" | "animal_product" | "trap" | "misc";

export interface InventoryItem {
  id: string;
  itemDefId: string;
  category: ItemCategory;
  displayName: string;
  quantity: number;
  /** Tools are not stackable and carry durability instead of quantity semantics. */
  durability?: number;
  maxDurability?: number;
  stackable: boolean;
  maxStack: number;
  unitValue: number;
}

export interface Inventory {
  slots: (InventoryItem | null)[];
  capacity: number;
  coins: number;
}

// -----------------------------------------------------------------------------
// WEATHER / TIME
// -----------------------------------------------------------------------------

export type WeatherKind = "sunny" | "overcast" | "rain" | "thunderstorm" | "drought" | "frost";

export type Season = "spring" | "summer" | "autumn" | "winter";

export interface WeatherState {
  current: WeatherKind;
  /** Sim-hours remaining before this weather system resolves. */
  hoursRemaining: number;
  /** Rolling drought counter in days; escalates the "drought" weather odds. */
  consecutiveDryDays: number;
  windStrength: number;
}

export interface TimeState {
  /** Total elapsed sim-days since new game. */
  day: number;
  /** 0-24 float hour-of-day. */
  hour: number;
  season: Season;
  year: number;
  weather: WeatherState;
  isMarketDay: boolean;
}

// -----------------------------------------------------------------------------
// MERCHANTS & EVENTS
// -----------------------------------------------------------------------------

export interface MerchantOffer {
  itemDefId: string;
  displayName: string;
  price: number;
  quantityAvailable: number;
  isExotic: boolean;
}

export interface MerchantState {
  isPresent: boolean;
  name: string;
  archetype: "seed_peddler" | "livestock_trader" | "gadget_hawker" | "wandering_oddity";
  offers: MerchantOffer[];
  arrivalDay: number;
  departsAtHour: number;
}

export type ComedicEventKind =
  | "mega_crop"
  | "crow_gang"
  | "mud_slip"
  | "escaped_livestock"
  | "alpaca_spit"
  | "donkey_tantrum"
  | "fox_raid"
  | "merchant_haggle_fail";

export interface ComedicEventRecord {
  kind: ComedicEventKind;
  day: number;
  hour: number;
  /** Human-readable flavor line shown in the event toast log. */
  message: string;
}

// -----------------------------------------------------------------------------
// PLAYER / FARM
// -----------------------------------------------------------------------------

export interface PlayerState {
  position: { x: number; y: number; z: number };
  heading: number;
  stamina: number;
  equippedSlot: number;
  currentSurface: "soil" | "wood" | "stone" | "grass" | "mud";
}

export interface FarmBounds {
  width: number;
  depth: number;
  originX: number;
  originZ: number;
}

// -----------------------------------------------------------------------------
// SAVE GAME PAYLOAD (top-level persistence shape)
// -----------------------------------------------------------------------------

export interface SaveGameMeta {
  saveVersion: number;
  savedAtIso: string;
  /** SHA-256 (hex) of the canonicalized payload body, computed before writing. */
  checksum: string;
  playtimeSeconds: number;
}

export interface SaveGamePayload {
  meta: SaveGameMeta;
  time: TimeState;
  player: PlayerState;
  farmBounds: FarmBounds;
  soil: SoilState[];
  crops: CropTile[];
  animals: AnimalEntity[];
  inventory: Inventory;
  merchant: MerchantState;
  eventLog: ComedicEventRecord[];
  /** Free-form counters for achievements/quests, keyed by id. */
  stats: Record<string, number>;
}

export const SAVE_VERSION = 1;
