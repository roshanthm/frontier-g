// =============================================================================
// AudioManager
// Thin wrapper around the Web Audio API. Handles:
//  - Day/night background music cross-fading (two looping beds, gain-automated)
//  - Surface-dependent footstep switching (soil vs wood vs stone vs mud)
//  - One-shot action/spatial SFX via PannerNode for positional audio
// All buffers are loaded lazily and cached; missing/failed assets degrade
// silently (game must remain playable with zero audio files present, since
// this scaffold ships without binary assets).
// =============================================================================

export type SurfaceKind = "soil" | "wood" | "stone" | "grass" | "mud";

export type SfxId =
  | "till_soil"
  | "water_pour"
  | "chop_wood"
  | "metal_clink"
  | "harvest_pick"
  | "animal_moo"
  | "animal_bray"
  | "animal_spit"
  | "dog_bark"
  | "fox_yip"
  | "merchant_greet"
  | "coin_purchase"
  | "mud_slip"
  | "thunder_crack"
  | "tantrum_stomp";

interface Loaded {
  buffer: AudioBuffer | null; // null if the source file failed to load — silent no-op playback
}

export class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGainDay: GainNode | null = null;
  private musicGainNight: GainNode | null = null;
  private daySource: AudioBufferSourceNode | null = null;
  private nightSource: AudioBufferSourceNode | null = null;

  private sfxCache = new Map<SfxId, Loaded>();
  private footstepCache = new Map<SurfaceKind, Loaded>();
  private musicCache = new Map<"day" | "night", Loaded>();

  private lastFootstepAt = 0;
  private readonly footstepIntervalMs = 340;
  private unlocked = false;

  private basePath: string;

  constructor(basePath = "/audio") {
    this.basePath = basePath;
  }

  /**
   * Must be called from a user-gesture handler (click/keydown) — browsers
   * block AudioContext creation otherwise. Safe to call multiple times.
   */
  unlock(): void {
    if (this.unlocked) return;
    this.ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.85;
    this.masterGain.connect(this.ctx.destination);

    this.musicGainDay = this.ctx.createGain();
    this.musicGainNight = this.ctx.createGain();
    this.musicGainDay.gain.value = 1;
    this.musicGainNight.gain.value = 0;
    this.musicGainDay.connect(this.masterGain);
    this.musicGainNight.connect(this.masterGain);

    this.unlocked = true;
    void this.startMusicBeds();
  }

  setMasterVolume(v: number): void {
    if (this.masterGain) this.masterGain.gain.value = clamp01(v);
  }

  // ---------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------

  private async loadBuffer(url: string): Promise<AudioBuffer | null> {
    if (!this.ctx) return null;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const arrayBuffer = await res.arrayBuffer();
      return await this.ctx.decodeAudioData(arrayBuffer);
    } catch {
      // Missing asset in this scaffold — fail silently, gameplay continues muted.
      return null;
    }
  }

  private async ensureSfx(id: SfxId): Promise<Loaded> {
    let entry = this.sfxCache.get(id);
    if (!entry) {
      const buffer = await this.loadBuffer(`${this.basePath}/sfx/${id}.mp3`);
      entry = { buffer };
      this.sfxCache.set(id, entry);
    }
    return entry;
  }

  private async ensureFootstep(surface: SurfaceKind): Promise<Loaded> {
    let entry = this.footstepCache.get(surface);
    if (!entry) {
      const buffer = await this.loadBuffer(`${this.basePath}/footsteps/${surface}.mp3`);
      entry = { buffer };
      this.footstepCache.set(surface, entry);
    }
    return entry;
  }

  private async ensureMusic(bed: "day" | "night"): Promise<Loaded> {
    let entry = this.musicCache.get(bed);
    if (!entry) {
      const buffer = await this.loadBuffer(`${this.basePath}/music/${bed}.mp3`);
      entry = { buffer };
      this.musicCache.set(bed, entry);
    }
    return entry;
  }

  // ---------------------------------------------------------------------
  // Music
  // ---------------------------------------------------------------------

  private async startMusicBeds(): Promise<void> {
    if (!this.ctx || !this.musicGainDay || !this.musicGainNight) return;
    const [day, night] = await Promise.all([this.ensureMusic("day"), this.ensureMusic("night")]);

    if (day.buffer) {
      this.daySource = this.ctx.createBufferSource();
      this.daySource.buffer = day.buffer;
      this.daySource.loop = true;
      this.daySource.connect(this.musicGainDay);
      this.daySource.start();
    }
    if (night.buffer) {
      this.nightSource = this.ctx.createBufferSource();
      this.nightSource.buffer = night.buffer;
      this.nightSource.loop = true;
      this.nightSource.connect(this.musicGainNight);
      this.nightSource.start();
    }
  }

  /**
   * Cross-fades between day/night beds. `nightAmount` is 0 (full day) to
   * 1 (full night) — feed it TimeSystem's sun-height inverse for a smooth
   * dusk/dawn transition rather than a hard cut.
   */
  setNightAmount(nightAmount: number, rampSeconds = 3): void {
    if (!this.ctx || !this.musicGainDay || !this.musicGainNight) return;
    const clamped = clamp01(nightAmount);
    const now = this.ctx.currentTime;
    this.musicGainDay.gain.cancelScheduledValues(now);
    this.musicGainNight.gain.cancelScheduledValues(now);
    this.musicGainDay.gain.linearRampToValueAtTime(1 - clamped, now + rampSeconds);
    this.musicGainNight.gain.linearRampToValueAtTime(clamped, now + rampSeconds);
  }

  // ---------------------------------------------------------------------
  // Footsteps
  // ---------------------------------------------------------------------

  /** Call every frame the player is moving; internally throttled to a walk cadence. */
  playFootstepIfDue(surface: SurfaceKind, isRunning: boolean): void {
    if (!this.ctx) return;
    const now = performance.now();
    const interval = isRunning ? this.footstepIntervalMs * 0.6 : this.footstepIntervalMs;
    if (now - this.lastFootstepAt < interval) return;
    this.lastFootstepAt = now;

    void this.ensureFootstep(surface).then((entry) => {
      if (!entry.buffer || !this.ctx || !this.masterGain) return;
      const src = this.ctx.createBufferSource();
      src.buffer = entry.buffer;
      const gain = this.ctx.createGain();
      // Slight per-step pitch/volume jitter so footsteps don't sound robotic.
      src.playbackRate.value = 0.94 + Math.random() * 0.12;
      gain.gain.value = 0.5 + Math.random() * 0.15;
      src.connect(gain).connect(this.masterGain);
      src.start();
    });
  }

  // ---------------------------------------------------------------------
  // One-shot / spatial SFX
  // ---------------------------------------------------------------------

  /** Plays a one-shot sound. If `position` + `listenerPosition` are given, pans/attenuates it in 3D space. */
  playSfx(
    id: SfxId,
    options?: { position?: { x: number; y: number; z: number }; listenerPosition?: { x: number; y: number; z: number }; volume?: number }
  ): void {
    if (!this.ctx || !this.masterGain) return;
    void this.ensureSfx(id).then((entry) => {
      if (!entry.buffer || !this.ctx || !this.masterGain) return;
      const src = this.ctx.createBufferSource();
      src.buffer = entry.buffer;

      let outputNode: AudioNode = this.masterGain;
      if (options?.position) {
        const panner = this.ctx.createPanner();
        panner.panningModel = "HRTF";
        panner.distanceModel = "inverse";
        panner.refDistance = 3;
        panner.maxDistance = 40;
        panner.rolloffFactor = 1.2;
        panner.positionX.value = options.position.x;
        panner.positionY.value = options.position.y;
        panner.positionZ.value = options.position.z;
        if (options.listenerPosition) {
          this.ctx.listener.positionX.value = options.listenerPosition.x;
          this.ctx.listener.positionY.value = options.listenerPosition.y;
          this.ctx.listener.positionZ.value = options.listenerPosition.z;
        }
        panner.connect(this.masterGain);
        outputNode = panner;
      }

      const gain = this.ctx.createGain();
      gain.gain.value = options?.volume ?? 0.8;
      src.connect(gain).connect(outputNode);
      src.start();
    });
  }
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
