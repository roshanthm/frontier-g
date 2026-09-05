// =============================================================================
// ComedicEvents
// Orchestrates the "quirky" half of the design brief: wandering merchants on
// market days, and random funny misfortunes (mega-crop reveal flavor text,
// crow gangs, mud slips). Listens to FarmingSystem/TimeSystem events and
// produces ComedicEventRecord entries the UI toasts + save file both consume.
// =============================================================================

import type { FarmEvent } from "@/systems/FarmingSystem";
import type { TimeEvent } from "@/systems/TimeSystem";
import type { ComedicEventKind, ComedicEventRecord, MerchantOffer, MerchantState } from "@/state/types";

const MERCHANT_NAMES = [
  "Old Man Higgins",
  "Wandering Bess",
  "Countess Marigold",
  "Pockets the Tinker",
  "Sable Vance",
  "Two-Bucket Tom",
];

const EXOTIC_SEED_POOL = ["seed_pumpkin", "seed_corn", "seed_wheat"];

const MEGA_CROP_LINES = [
  "The pumpkin has achieved sentience and possibly a mortgage.",
  "Somewhere, a physicist is very upset about this tomato.",
  "You will need the horse. You will always need the horse.",
];

const CROW_GANG_LINES = [
  "A crow gang has unionized around your scarecrow. Demands are unclear.",
  "The scarecrow has been renamed 'Big Steve' by the local crows.",
];

const MUD_SLIP_LINES = ["You hit a slick patch of mud and go down like a sack of potatoes.", "Gravity wins. The mud remembers."];

const ALPACA_SPIT_LINES = ["The alpaca was startled and has made its opinion extremely clear.", "You've been spat on. This is now a rivalry."];

const DONKEY_TANTRUM_LINES = ["The donkey has decided today is a protest.", "The donkey sits down. Negotiations have failed."];

const FOX_RAID_LINES = ["A fox slinks along the fence line, eyeing the coop.", "Something rustles near the henhouse. It's not the wind."];

export type ComedicEventListener = (record: ComedicEventRecord) => void;

export class ComedicEvents {
  private listeners = new Set<ComedicEventListener>();
  private rng: () => number;
  merchant: MerchantState;

  constructor(rng: () => number = Math.random) {
    this.rng = rng;
    this.merchant = { isPresent: false, name: "", archetype: "seed_peddler", offers: [], arrivalDay: 0, departsAtHour: 18 };
  }

  subscribe(listener: ComedicEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private fire(kind: ComedicEventKind, day: number, hour: number, message: string): void {
    const record: ComedicEventRecord = { kind, day, hour, message };
    for (const l of this.listeners) l(record);
  }

  private pick<T>(pool: T[]): T {
    const item = pool[Math.floor(this.rng() * pool.length)];
    return item as T;
  }

  /** Wire this up to TimeSystem.subscribe(). */
  onTimeEvent(event: TimeEvent, currentDay: number, currentHour: number): void {
    if (event.kind === "market_day_started") {
      this.spawnMerchant(currentDay);
    }
    if (event.kind === "market_day_ended") {
      this.merchant.isPresent = false;
    }
    if (event.kind === "weather_changed" && event.weather === "thunderstorm") {
      // Thunderstorms occasionally spook livestock into their own comedic beat,
      // but the actual fear-spike is applied by AnimalAI; this just narrates it.
      if (this.rng() < 0.3) {
        this.fire("mud_slip", currentDay, currentHour, "The storm turns the yard into a proper skating rink.");
      }
    }
    if (event.kind === "hour_changed" && event.hour === 20 && this.rng() < 0.15) {
      this.fire("fox_raid", currentDay, currentHour, this.pick(FOX_RAID_LINES));
    }
    if (event.kind === "hour_changed" && event.hour === 9 && this.rng() < 0.08) {
      this.fire("crow_gang", currentDay, currentHour, this.pick(CROW_GANG_LINES));
    }
  }

  /** Wire this up to FarmingSystem.subscribe(). */
  onFarmEvent(event: FarmEvent, currentDay: number, currentHour: number): void {
    if (event.kind === "mega_growth") {
      this.fire("mega_crop", currentDay, currentHour, this.pick(MEGA_CROP_LINES));
    }
  }

  /** Call from the player controller when a slip-on-mud roll succeeds. */
  triggerMudSlip(currentDay: number, currentHour: number): void {
    this.fire("mud_slip", currentDay, currentHour, this.pick(MUD_SLIP_LINES));
  }

  triggerAlpacaSpit(currentDay: number, currentHour: number): void {
    this.fire("alpaca_spit", currentDay, currentHour, this.pick(ALPACA_SPIT_LINES));
  }

  triggerDonkeyTantrum(currentDay: number, currentHour: number): void {
    this.fire("donkey_tantrum", currentDay, currentHour, this.pick(DONKEY_TANTRUM_LINES));
  }

  private spawnMerchant(day: number): void {
    const archetypes: MerchantState["archetype"][] = ["seed_peddler", "livestock_trader", "gadget_hawker", "wandering_oddity"];
    const archetype = this.pick(archetypes);
    const offers: MerchantOffer[] = [];

    if (archetype === "seed_peddler" || archetype === "wandering_oddity") {
      for (const seedId of EXOTIC_SEED_POOL) {
        offers.push({
          itemDefId: seedId,
          displayName: seedId.replace("seed_", "").replace(/^\w/, (c) => c.toUpperCase()) + " Seeds",
          price: 4 + Math.floor(this.rng() * 6),
          quantityAvailable: 3 + Math.floor(this.rng() * 5),
          isExotic: this.rng() < 0.3,
        });
      }
    }
    if (archetype === "gadget_hawker") {
      offers.push({ itemDefId: "bear_trap", displayName: "Bear Trap", price: 45, quantityAvailable: 2, isExotic: false });
      offers.push({ itemDefId: "fence_post", displayName: "Reinforced Fence Post", price: 6, quantityAvailable: 10, isExotic: false });
    }
    if (archetype === "livestock_trader") {
      offers.push({ itemDefId: "compost", displayName: "Premium Compost", price: 5, quantityAvailable: 20, isExotic: false });
      offers.push({ itemDefId: "manure", displayName: "Aged Manure", price: 3, quantityAvailable: 20, isExotic: false });
    }

    this.merchant = {
      isPresent: true,
      name: this.pick(MERCHANT_NAMES),
      archetype,
      offers,
      arrivalDay: day,
      departsAtHour: 18 + Math.floor(this.rng() * 4),
    };
  }
}
