// =============================================================================
// TimeSystem
// Owns the sim clock (day/hour/season/year), the weather state machine, and
// market-day scheduling. Runs on the fixed-timestep simulation tick supplied
// by Game.ts — it does NOT read wall-clock time directly, so the whole game
// can be paused, fast-forwarded, or replayed deterministically.
// =============================================================================

import type { Season, TimeState, WeatherKind } from "@/state/types";

/** How many real seconds one in-game hour takes at normal speed. */
export const SECONDS_PER_GAME_HOUR = 45;

export const SEASON_ORDER: Season[] = ["spring", "summer", "autumn", "winter"];
const DAYS_PER_SEASON = 28;

export type TimeListener = (event: TimeEvent) => void;

export type TimeEvent =
  | { kind: "hour_changed"; hour: number }
  | { kind: "day_changed"; day: number; season: Season; year: number }
  | { kind: "season_changed"; season: Season }
  | { kind: "weather_changed"; weather: WeatherKind; previous: WeatherKind }
  | { kind: "market_day_started" }
  | { kind: "market_day_ended" };

/** Transition weights, tuned per season. Rows sum to 1.0 (soft normalized on read). */
const WEATHER_TABLE: Record<Season, Partial<Record<WeatherKind, number>>> = {
  spring: { sunny: 0.45, overcast: 0.2, rain: 0.25, thunderstorm: 0.08, drought: 0.0, frost: 0.02 },
  summer: { sunny: 0.55, overcast: 0.15, rain: 0.12, thunderstorm: 0.1, drought: 0.08, frost: 0.0 },
  autumn: { sunny: 0.35, overcast: 0.3, rain: 0.22, thunderstorm: 0.08, drought: 0.02, frost: 0.03 },
  winter: { sunny: 0.3, overcast: 0.3, rain: 0.05, thunderstorm: 0.02, drought: 0.0, frost: 0.33 },
};

const MARKET_DAY_INTERVAL = 7;

export class TimeSystem {
  private state: TimeState;
  private listeners = new Set<TimeListener>();
  private lastHourBucket: number;
  private rng: () => number;

  constructor(rng: () => number = Math.random, initial?: Partial<TimeState>) {
    this.rng = rng;
    this.state = {
      day: 1,
      hour: 6,
      season: "spring",
      year: 1,
      weather: { current: "sunny", hoursRemaining: 6, consecutiveDryDays: 0, windStrength: 0.2 },
      isMarketDay: false,
      ...initial,
    };
    this.lastHourBucket = Math.floor(this.state.hour);
  }

  getState(): Readonly<TimeState> {
    return this.state;
  }

  subscribe(listener: TimeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: TimeEvent) {
    for (const l of this.listeners) l(event);
  }

  /** Normalized 0..1 sun height, 0 at midnight, 1 at noon. Used for lighting & moisture sun-exposure. */
  getSunHeight(): number {
    const h = this.state.hour;
    // Cosine curve centered at noon (12:00), zero-crossings near 0:00/24:00.
    const radians = ((h - 12) / 12) * Math.PI;
    return Math.max(0, Math.cos(radians));
  }

  isNight(): boolean {
    return this.state.hour < 5.5 || this.state.hour >= 20;
  }

  /**
   * Advances the clock by `deltaSeconds` of real time, converted via the
   * fixed game-hour scale. Call this once per fixed-timestep tick.
   */
  update(deltaSeconds: number, timeScale = 1): void {
    const deltaHours = (deltaSeconds / SECONDS_PER_GAME_HOUR) * timeScale;
    if (deltaHours <= 0) return;

    this.state.hour += deltaHours;

    // Tick weather duration down at the same rate as clock hours.
    this.state.weather.hoursRemaining -= deltaHours;
    if (this.state.weather.hoursRemaining <= 0) {
      this.rollWeather();
    }

    while (this.state.hour >= 24) {
      this.state.hour -= 24;
      this.advanceDay();
    }

    const bucket = Math.floor(this.state.hour);
    if (bucket !== this.lastHourBucket) {
      this.lastHourBucket = bucket;
      this.emit({ kind: "hour_changed", hour: bucket });
    }
  }

  private advanceDay(): void {
    this.state.day += 1;

    if (this.state.weather.current === "drought" || this.state.weather.current === "sunny") {
      this.state.weather.consecutiveDryDays += 1;
    } else {
      this.state.weather.consecutiveDryDays = 0;
    }

    const dayInSeason = ((this.state.day - 1) % DAYS_PER_SEASON) + 1;
    if (dayInSeason === 1 && this.state.day > 1) {
      const idx = SEASON_ORDER.indexOf(this.state.season);
      const nextSeason = SEASON_ORDER[(idx + 1) % SEASON_ORDER.length]!;
      this.state.season = nextSeason;
      if (nextSeason === "spring") this.state.year += 1;
      this.emit({ kind: "season_changed", season: nextSeason });
    }

    const wasMarketDay = this.state.isMarketDay;
    this.state.isMarketDay = this.state.day % MARKET_DAY_INTERVAL === 0;
    if (this.state.isMarketDay && !wasMarketDay) this.emit({ kind: "market_day_started" });
    if (!this.state.isMarketDay && wasMarketDay) this.emit({ kind: "market_day_ended" });

    this.emit({ kind: "day_changed", day: this.state.day, season: this.state.season, year: this.state.year });
  }

  /** Weighted-random pick of the next weather system, then schedules its duration. */
  private rollWeather(): void {
    const table = WEATHER_TABLE[this.state.season];
    let weights = Object.entries(table) as [WeatherKind, number][];

    // Drought becomes drastically more likely after several dry days in summer.
    if (this.state.weather.consecutiveDryDays >= 4) {
      weights = weights.map(([k, w]) => (k === "drought" ? [k, w + 0.3] : [k, w]));
    }

    const total = weights.reduce((sum, [, w]) => sum + w, 0);
    let roll = this.rng() * total;
    let chosen: WeatherKind = "sunny";
    for (const [kind, weight] of weights) {
      roll -= weight;
      if (roll <= 0) {
        chosen = kind;
        break;
      }
    }

    const previous = this.state.weather.current;
    this.state.weather.current = chosen;
    this.state.weather.hoursRemaining = 4 + this.rng() * 10;
    this.state.weather.windStrength =
      chosen === "thunderstorm" ? 0.7 + this.rng() * 0.3 : chosen === "rain" ? 0.3 + this.rng() * 0.3 : this.rng() * 0.25;

    if (chosen !== previous) {
      this.emit({ kind: "weather_changed", weather: chosen, previous });
    }
  }

  /** Directional light intensity/angle helper consumed by Game.ts's sun rig. */
  getSunAngleRadians(): number {
    // Full 24h cycle mapped to a full rotation, sunrise at 6:00, sunset at 20:00.
    return ((this.state.hour / 24) * Math.PI * 2) - Math.PI / 2;
  }

  serialize(): TimeState {
    return JSON.parse(JSON.stringify(this.state));
  }

  static deserialize(state: TimeState, rng?: () => number): TimeSystem {
    return new TimeSystem(rng, state);
  }
}
