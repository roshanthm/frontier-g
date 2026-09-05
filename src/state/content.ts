// =============================================================================
// Static content database: crop species, item defs, animal base stats.
// Kept separate from types.ts so designers can tune numbers without touching
// the shape definitions.
// =============================================================================

import type { CropSpeciesDef, CropSpeciesId, ItemCategory } from "./types";

export const CROP_SPECIES: Record<CropSpeciesId, CropSpeciesDef> = {
  wheat: {
    id: "wheat",
    displayName: "Wheat",
    stageDurationDays: [1, 2, 2, 2],
    idealMoisture: { min: 0.3, max: 0.6 },
    idealPh: { min: 6.0, max: 7.5 },
    npkUptakePerDay: { nitrogen: 3, phosphorus: 1, potassium: 1 },
    harvestWindowDays: 4,
    baseValue: 6,
    megaGrowthEligible: false,
  },
  corn: {
    id: "corn",
    displayName: "Corn",
    stageDurationDays: [1, 3, 3, 3],
    idealMoisture: { min: 0.45, max: 0.7 },
    idealPh: { min: 5.8, max: 7.0 },
    npkUptakePerDay: { nitrogen: 5, phosphorus: 2, potassium: 2 },
    harvestWindowDays: 5,
    baseValue: 10,
    megaGrowthEligible: true,
  },
  carrot: {
    id: "carrot",
    displayName: "Carrot",
    stageDurationDays: [1, 2, 2, 1],
    idealMoisture: { min: 0.35, max: 0.55 },
    idealPh: { min: 6.0, max: 6.8 },
    npkUptakePerDay: { nitrogen: 2, phosphorus: 3, potassium: 2 },
    harvestWindowDays: 3,
    baseValue: 5,
    megaGrowthEligible: false,
  },
  pumpkin: {
    id: "pumpkin",
    displayName: "Pumpkin",
    stageDurationDays: [2, 4, 4, 4],
    idealMoisture: { min: 0.5, max: 0.75 },
    idealPh: { min: 6.0, max: 7.5 },
    npkUptakePerDay: { nitrogen: 4, phosphorus: 3, potassium: 4 },
    harvestWindowDays: 6,
    baseValue: 18,
    // Pumpkins are the canonical "requires a horse to pull out" mega-crop.
    megaGrowthEligible: true,
  },
  tomato: {
    id: "tomato",
    displayName: "Tomato",
    stageDurationDays: [1, 3, 2, 3],
    idealMoisture: { min: 0.4, max: 0.65 },
    idealPh: { min: 6.0, max: 6.8 },
    npkUptakePerDay: { nitrogen: 3, phosphorus: 2, potassium: 3 },
    harvestWindowDays: 5,
    baseValue: 9,
    megaGrowthEligible: true,
  },
  potato: {
    id: "potato",
    displayName: "Potato",
    stageDurationDays: [1, 3, 3, 2],
    idealMoisture: { min: 0.4, max: 0.6 },
    idealPh: { min: 5.0, max: 6.5 },
    npkUptakePerDay: { nitrogen: 3, phosphorus: 3, potassium: 4 },
    harvestWindowDays: 6,
    baseValue: 7,
    megaGrowthEligible: false,
  },
  cabbage: {
    id: "cabbage",
    displayName: "Cabbage",
    stageDurationDays: [1, 2, 3, 2],
    idealMoisture: { min: 0.45, max: 0.65 },
    idealPh: { min: 6.0, max: 7.0 },
    npkUptakePerDay: { nitrogen: 4, phosphorus: 1, potassium: 2 },
    harvestWindowDays: 4,
    baseValue: 8,
    megaGrowthEligible: false,
  },
  sunflower: {
    id: "sunflower",
    displayName: "Sunflower",
    stageDurationDays: [1, 3, 3, 3],
    idealMoisture: { min: 0.3, max: 0.55 },
    idealPh: { min: 6.0, max: 7.5 },
    npkUptakePerDay: { nitrogen: 2, phosphorus: 2, potassium: 1 },
    harvestWindowDays: 5,
    baseValue: 4,
    megaGrowthEligible: true,
  },
};

export interface ItemDef {
  id: string;
  displayName: string;
  category: ItemCategory;
  stackable: boolean;
  maxStack: number;
  unitValue: number;
  maxDurability?: number;
}

export const ITEM_DEFS: Record<string, ItemDef> = {
  shovel: { id: "shovel", displayName: "Shovel", category: "tool", stackable: false, maxStack: 1, unitValue: 25, maxDurability: 120 },
  watering_can: { id: "watering_can", displayName: "Watering Can", category: "tool", stackable: false, maxStack: 1, unitValue: 20, maxDurability: 150 },
  hoe: { id: "hoe", displayName: "Hoe", category: "tool", stackable: false, maxStack: 1, unitValue: 22, maxDurability: 120 },
  axe: { id: "axe", displayName: "Red Axe", category: "tool", stackable: false, maxStack: 1, unitValue: 30, maxDurability: 100 },
  seed_wheat: { id: "seed_wheat", displayName: "Wheat Seeds", category: "seed", stackable: true, maxStack: 99, unitValue: 2 },
  seed_corn: { id: "seed_corn", displayName: "Corn Seeds", category: "seed", stackable: true, maxStack: 99, unitValue: 3 },
  seed_pumpkin: { id: "seed_pumpkin", displayName: "Pumpkin Seeds", category: "seed", stackable: true, maxStack: 99, unitValue: 5 },
  compost: { id: "compost", displayName: "Compost", category: "material", stackable: true, maxStack: 50, unitValue: 4 },
  manure: { id: "manure", displayName: "Manure", category: "material", stackable: true, maxStack: 50, unitValue: 2 },
  milk: { id: "milk", displayName: "Fresh Milk", category: "animal_product", stackable: true, maxStack: 20, unitValue: 6 },
  fleece: { id: "fleece", displayName: "Alpaca Fleece", category: "animal_product", stackable: true, maxStack: 20, unitValue: 14 },
  bear_trap: { id: "bear_trap", displayName: "Bear Trap", category: "trap", stackable: true, maxStack: 10, unitValue: 40 },
  fence_post: { id: "fence_post", displayName: "Fence Post", category: "material", stackable: true, maxStack: 40, unitValue: 3 },
};
