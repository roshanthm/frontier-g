// =============================================================================
// Game
// The composition root. Owns the Three.js scene/camera/renderer, the fixed-
// timestep simulation loop, and wires every system (Time, Farming, AnimalAI,
// Audio, Save) together with the Terrain/AssetLoader/PlayerController/HUD.
// This is intentionally the only file that imports "everything" — individual
// systems stay decoupled from Three.js and from each other.
// =============================================================================

import * as THREE from "three";

import { TimeSystem } from "@/systems/TimeSystem";
import { FarmingSystem, type FarmEvent } from "@/systems/FarmingSystem";
import { AnimalAI, type Vec3 } from "@/systems/AnimalAI";
import { AudioManager } from "@/systems/AudioManager";
import { SaveSystem } from "@/systems/SaveSystem";
import { ComedicEvents } from "@/events/ComedicEvents";
import { Terrain } from "@/world/Terrain";
import { AssetLoader, type ModelId } from "@/world/AssetLoader";
import { PlayerController } from "@/world/PlayerController";
import { CharacterAnimator, createAnimatorForModel, locomotionFromActivity } from "@/world/CharacterAnimator";
import { ParticleEffects } from "@/world/ParticleEffects";
import { WindMaterialRegistry } from "@/world/WindMaterial";
import { Hud, type HotbarSlotView } from "@/ui/HUD";
import { Minimap, type MinimapBlip } from "@/ui/Minimap";
import { CROP_SPECIES, ITEM_DEFS } from "@/state/content";
import {
  SAVE_VERSION,
  type AnimalEntity,
  type AnimalSpeciesId,
  type CropSpeciesId,
  type GridCoord,
  type Inventory,
  type InventoryItem,
  type SaveGamePayload,
} from "@/state/types";

const FARM_WIDTH_TILES = 24;
const FARM_DEPTH_TILES = 24;
const FIXED_TIMESTEP = 1 / 30; // 30Hz simulation tick, independent of render FPS
const CAMERA_YAW = Math.PI / 4; // isometric-style fixed yaw, matches the reference screenshot framing

type ToolId = "shovel" | "hoe" | "watering_can" | "axe" | null;

const HOTBAR_LAYOUT: { itemDefId: string; qty: number }[] = [
  { itemDefId: "shovel", qty: 1 },
  { itemDefId: "hoe", qty: 1 },
  { itemDefId: "watering_can", qty: 1 },
  { itemDefId: "seed_wheat", qty: 20 },
  { itemDefId: "seed_corn", qty: 12 },
  { itemDefId: "seed_pumpkin", qty: 6 },
  { itemDefId: "compost", qty: 10 },
  { itemDefId: "axe", qty: 1 },
  { itemDefId: "bear_trap", qty: 2 },
];

interface AnimalRig {
  entity: AnimalEntity;
  object: THREE.Object3D;
  animator: CharacterAnimator;
  lastPos: THREE.Vector3;
}

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.OrthographicCamera;
  private clock = new THREE.Clock();
  private accumulator = 0;

  private time: TimeSystem;
  private farming: FarmingSystem;
  private animalAi: AnimalAI;
  private audio: AudioManager;
  private save: SaveSystem;
  private comedic: ComedicEvents;
  private terrain: Terrain;
  private assets: AssetLoader;
  private hud: Hud;
  private minimap: Minimap;
  private particles: ParticleEffects;
  private windMaterials: WindMaterialRegistry;
  private player!: PlayerController;
  private farmerObject = new THREE.Group();
  private farmerAnimator!: CharacterAnimator;
  private farmerLastPos = new THREE.Vector3();

  private animals: AnimalRig[] = [];
  private cropMeshes = new Map<string, THREE.Object3D>();
  private raycaster = new THREE.Raycaster();
  private pointerNdc = new THREE.Vector2();
  private hoveredCoord: GridCoord | null = null;

  private inventory: Inventory = { slots: [], capacity: 9, coins: 120 };
  private selectedSlot = 0;
  private playtimeSeconds = 0;
  private running = false;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    const aspect = window.innerWidth / window.innerHeight;
    const viewSize = 12;
    this.camera = new THREE.OrthographicCamera(-viewSize * aspect, viewSize * aspect, viewSize, -viewSize, 0.1, 200);
    this.positionCameraIsometric();

    this.time = new TimeSystem();
    this.farming = new FarmingSystem();
    this.animalAi = new AnimalAI();
    this.audio = new AudioManager();
    this.save = new SaveSystem();
    this.comedic = new ComedicEvents();
    this.terrain = new Terrain({ widthTiles: FARM_WIDTH_TILES, depthTiles: FARM_DEPTH_TILES });
    this.assets = new AssetLoader(this.renderer);
    this.particles = new ParticleEffects(this.scene);
    this.windMaterials = new WindMaterialRegistry();
    this.hud = new Hud(uiRoot, {
      onSelectSlot: (i) => this.selectSlot(i),
      onBuyOffer: (itemDefId) => this.buyFromMerchant(itemDefId),
      onCloseMerchant: () => this.hud.showMerchant({ ...this.comedic.merchant, isPresent: false }, this.inventory.coins),
    });
    this.minimap = new Minimap(uiRoot);

    this.scene.add(this.terrain.group, this.terrain.sun, this.terrain.hemi, this.terrain.ambient);
    this.scene.fog = new THREE.Fog(0x9fb8c9, 30, 70);

    // Ground gets the wind-sway shader so the whole field has a subtle living
    // ripple instead of a static flat plane.
    this.terrain.setGroundMaterial(this.windMaterials.create(0x5f9a4a, { windStrength: 0.05, heightAttenuation: 0 }));

    this.setupInventory();
    this.wireSystemEvents();
    this.registerInputHandlers(canvas);

    window.addEventListener("resize", () => this.onResize());
  }

  // ---------------------------------------------------------------------
  // Boot sequence
  // ---------------------------------------------------------------------

  async start(): Promise<void> {
    this.hud.setBootProgress(0.1);

    const farmer = await this.assets.get("farmer");
    this.farmerObject.add(farmer);
    this.farmerObject.position.set(0, 0, 0);
    this.farmerAnimator = createAnimatorForModel(farmer);
    this.farmerLastPos.copy(this.farmerObject.position);
    this.scene.add(this.farmerObject);
    this.player = new PlayerController(this.farmerObject, { moveSpeed: 3.2, runMultiplier: 1.9, cameraYawRadians: CAMERA_YAW });
    this.hud.setBootProgress(0.35);

    await this.placeStaticStructures();
    this.hud.setBootProgress(0.6);

    await this.spawnInitialAnimals();
    this.hud.setBootProgress(0.85);

    const loadResult = await this.save.load();
    if (loadResult.ok) {
      this.applySave(loadResult.payload);
    }

    this.hud.setBootProgress(1);
    this.hud.hideBootScreen();
    this.renderHotbar();

    const unlockAudio = () => {
      this.audio.unlock();
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
    window.addEventListener("pointerdown", unlockAudio);
    window.addEventListener("keydown", unlockAudio);

    this.running = true;
    this.clock.start();
    requestAnimationFrame(() => this.loop());

    // Autosave every two minutes of real playtime.
    window.setInterval(() => void this.persist(), 120_000);
    window.addEventListener("beforeunload", () => void this.persist());
  }

  private async placeStaticStructures(): Promise<void> {
    const barn = await this.assets.get("barn");
    barn.position.set(6, 0, -6);
    this.scene.add(barn);

    const fencePositions: [number, number][] = [];
    for (let i = -3; i <= 3; i++) {
      fencePositions.push([i, 4]);
      fencePositions.push([i, -4]);
    }
    for (let i = -3; i <= 4; i++) {
      fencePositions.push([-4, i]);
      fencePositions.push([4, i]);
    }
    for (const [x, z] of fencePositions) {
      const fence = await this.assets.get("fence");
      fence.position.set(x, 0, z + 2);
      this.scene.add(fence);
    }

    const trough = await this.assets.get("trough");
    trough.position.set(-3, 0, 3);
    this.scene.add(trough);
  }

  private async spawnInitialAnimals(): Promise<void> {
    const seedAnimals: { species: AnimalSpeciesId; pos: Vec3 }[] = [
      { species: "cow", pos: { x: -2, y: 0, z: 2 } },
      { species: "cow", pos: { x: -1, y: 0, z: 3 } },
      { species: "bull", pos: { x: -3, y: 0, z: 1 } },
      { species: "horse", pos: { x: 2, y: 0, z: 3 } },
      { species: "donkey", pos: { x: 3, y: 0, z: 2 } },
      { species: "alpaca", pos: { x: 1, y: 0, z: 3 } },
      { species: "chicken", pos: { x: -2, y: 0, z: 3.5 } },
      { species: "chicken", pos: { x: -1.5, y: 0, z: 3.5 } },
      { species: "husky", pos: { x: 0, y: 0, z: -3 } },
    ];

    let idCounter = 0;
    for (const seed of seedAnimals) {
      const entity = AnimalAI.createAnimal(`animal_${idCounter++}`, seed.species, seed.pos, Math.random());
      const model = await this.assets.get(modelIdForAnimal(seed.species));
      model.position.set(seed.pos.x, seed.pos.y, seed.pos.z);
      this.scene.add(model);
      const animator = createAnimatorForModel(model);
      this.animals.push({ entity, object: model, animator, lastPos: new THREE.Vector3(seed.pos.x, seed.pos.y, seed.pos.z) });
    }
  }

  // ---------------------------------------------------------------------
  // Inventory / hotbar
  // ---------------------------------------------------------------------

  private setupInventory(): void {
    this.inventory.slots = HOTBAR_LAYOUT.map((entry, idx) => {
      const def = ITEM_DEFS[entry.itemDefId];
      if (!def) return null;
      const item: InventoryItem = {
        id: `slot_${idx}`,
        itemDefId: def.id,
        category: def.category,
        displayName: def.displayName,
        quantity: entry.qty,
        stackable: def.stackable,
        maxStack: def.maxStack,
        unitValue: def.unitValue,
        durability: def.maxDurability,
        maxDurability: def.maxDurability,
      };
      return item;
    });
  }

  private renderHotbar(): void {
    const views: HotbarSlotView[] = this.inventory.slots.map((item, i) => ({
      index: i,
      item,
      keyLabel: i === this.inventory.slots.length - 2 ? "Q" : i === this.inventory.slots.length - 1 ? "B" : String(i + 1),
    }));
    this.hud.renderHotbar(views);
    this.hud.setSelectedSlot(this.selectedSlot);
  }

  private selectSlot(index: number): void {
    if (index < 0 || index >= this.inventory.slots.length) return;
    this.selectedSlot = index;
    this.hud.setSelectedSlot(index);
  }

  private currentTool(): ToolId {
    const item = this.inventory.slots[this.selectedSlot];
    if (!item) return null;
    if (item.itemDefId === "shovel" || item.itemDefId === "hoe" || item.itemDefId === "watering_can" || item.itemDefId === "axe") {
      return item.itemDefId;
    }
    return null;
  }

  private currentSeedSpecies(): CropSpeciesId | null {
    const item = this.inventory.slots[this.selectedSlot];
    if (!item || item.category !== "seed") return null;
    const speciesId = item.itemDefId.replace("seed_", "") as CropSpeciesId;
    return CROP_SPECIES[speciesId] ? speciesId : null;
  }

  private consumeSelected(amount = 1): void {
    const item = this.inventory.slots[this.selectedSlot];
    if (!item || !item.stackable) return;
    item.quantity -= amount;
    if (item.quantity <= 0) this.inventory.slots[this.selectedSlot] = null;
    this.renderHotbar();
  }

  private addToInventory(itemDefId: string, quantity: number): void {
    const def = ITEM_DEFS[itemDefId];
    if (!def || quantity <= 0) return;
    const existingIndex = this.inventory.slots.findIndex((s) => s?.itemDefId === itemDefId && s.stackable);
    if (existingIndex >= 0) {
      const slot = this.inventory.slots[existingIndex]!;
      slot.quantity = Math.min(slot.maxStack, slot.quantity + quantity);
      this.renderHotbar();
      return;
    }
    const emptyIndex = this.inventory.slots.findIndex((s) => s === null);
    if (emptyIndex < 0) return; // inventory full
    this.inventory.slots[emptyIndex] = {
      id: `slot_${emptyIndex}_${Date.now()}`,
      itemDefId: def.id,
      category: def.category,
      displayName: def.displayName,
      quantity,
      stackable: def.stackable,
      maxStack: def.maxStack,
      unitValue: def.unitValue,
    };
    this.renderHotbar();
  }

  private buyFromMerchant(itemDefId: string): void {
    const offer = this.comedic.merchant.offers.find((o) => o.itemDefId === itemDefId);
    if (!offer || offer.quantityAvailable <= 0 || this.inventory.coins < offer.price) return;
    this.inventory.coins -= offer.price;
    offer.quantityAvailable -= 1;
    this.addToInventory(itemDefId, 1);
    this.audio.playSfx("coin_purchase");
    this.hud.showMerchant(this.comedic.merchant, this.inventory.coins);
  }

  // ---------------------------------------------------------------------
  // System wiring
  // ---------------------------------------------------------------------

  private wireSystemEvents(): void {
    this.time.subscribe((event) => {
      this.comedic.onTimeEvent(event, this.time.getState().day, Math.floor(this.time.getState().hour));

      if (event.kind === "day_changed") {
        const sunAvg = 0.5; // simplified daily-average sun exposure proxy
        this.farming.tickDay(event.day, sunAvg, this.time.getState().weather.current);
        for (const rig of this.animals) this.animalAi.tickDay(rig.entity);
      }
      if (event.kind === "market_day_started") {
        this.hud.showMerchant(this.comedic.merchant, this.inventory.coins);
      }
      if (event.kind === "market_day_ended") {
        this.hud.showMerchant({ ...this.comedic.merchant, isPresent: false }, this.inventory.coins);
      }
    });

    this.farming.subscribe((event: FarmEvent) => {
      this.comedic.onFarmEvent(event, this.time.getState().day, Math.floor(this.time.getState().hour));
      this.onFarmEvent(event);
    });

    this.comedic.subscribe((record) => this.hud.pushToast(record));

    this.animalAi.subscribe((event) => {
      const day = this.time.getState().day;
      const hour = Math.floor(this.time.getState().hour);
      if (event.kind === "alpaca_spit") this.comedic.triggerAlpacaSpit(day, hour);
      if (event.kind === "tantrum" && event.animal.species === "donkey") this.comedic.triggerDonkeyTantrum(day, hour);
      if (event.kind === "prey_caught" || event.kind === "predator_spotted") {
        this.audio.playSfx(event.kind === "prey_caught" ? "animal_bray" : "fox_yip", { position: event.predator.position });
      }
    });
  }

  private onFarmEvent(event: FarmEvent): void {
    if (event.kind === "planted" || event.kind === "stage_advanced") {
      void this.refreshCropMesh(event.coord);
    }
    if (event.kind === "harvested") {
      const key = coordKey(event.coord);
      const mesh = this.cropMeshes.get(key);
      if (mesh) {
        this.scene.remove(mesh);
        this.cropMeshes.delete(key);
      }
      this.inventory.coins += CROP_SPECIES[event.species].baseValue * event.yieldAmount;
      this.audio.playSfx("harvest_pick");
      this.particles.harvestSparkle(this.terrain.gridToWorldCenter(event.coord));
    }
    if (event.kind === "crop_died") {
      const key = coordKey(event.coord);
      const mesh = this.cropMeshes.get(key);
      if (mesh) this.tintDead(mesh);
    }
    if (event.kind === "tilled" || event.kind === "watered") {
      const soil = this.farming.getOrCreateSoil(event.coord);
      this.terrain.upsertSoilVisual(event.coord, soil.tilth, soil.moisture);
    }
    if (event.kind === "mega_growth") {
      this.particles.megaGrowthBurst(this.terrain.gridToWorldCenter(event.coord));
    }
  }

  private tintDead(mesh: THREE.Object3D): void {
    mesh.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
        child.material.color.lerp(new THREE.Color(0x3a2f1e), 0.6);
      }
    });
  }

  private async refreshCropMesh(coord: GridCoord): Promise<void> {
    const tile = this.farming.getCrop(coord);
    const key = coordKey(coord);
    const existing = this.cropMeshes.get(key);
    if (!tile) return;

    if (existing) {
      this.scene.remove(existing);
      this.cropMeshes.delete(key);
    }
    const newMesh = buildCropStageMesh(tile.stage, tile.isMegaGrown, this.windMaterials);
    const center = this.terrain.gridToWorldCenter(coord);
    newMesh.position.set(center.x, 0, center.z);
    this.scene.add(newMesh);
    this.cropMeshes.set(key, newMesh);
  }

  // ---------------------------------------------------------------------
  // Input: raycaster for grid clicks + tool use
  // ---------------------------------------------------------------------

  private registerInputHandlers(canvas: HTMLCanvasElement): void {
    canvas.addEventListener("pointermove", (e) => {
      const rect = canvas.getBoundingClientRect();
      this.pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    });

    canvas.addEventListener("click", () => {
      if (this.hoveredCoord) this.useToolOnTile(this.hoveredCoord);
    });

    window.addEventListener("keydown", (e) => {
      if (e.code === "KeyE") this.interactWithNearestAnimal();
      if (e.code === "KeyF") this.interactWithNearestAnimal(true);
      if (e.code === "Enter" && this.hoveredCoord) this.useToolOnTile(this.hoveredCoord);
    });
  }

  private updateHover(): void {
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hits = this.raycaster.intersectObject(this.terrain.group, true);
    const groundHit = hits.find((h) => h.object.name === "ground");
    if (!groundHit) {
      this.hoveredCoord = null;
      this.terrain.showHighlight(null);
      this.hud.setPrompt(null);
      return;
    }
    const coord = this.terrain.worldToGrid(groundHit.point);
    this.hoveredCoord = this.terrain.isInBounds(coord) ? coord : null;
    this.terrain.showHighlight(this.hoveredCoord);
    this.updateInteractionPrompt();
  }

  private updateInteractionPrompt(): void {
    if (!this.hoveredCoord) return;
    const tool = this.currentTool();
    const seed = this.currentSeedSpecies();
    if (this.farming.getCrop(this.hoveredCoord)?.stage === "harvestable") this.hud.setPrompt("Click to harvest");
    else if (tool === "hoe") this.hud.setPrompt("Click to till this tile");
    else if (tool === "watering_can") this.hud.setPrompt("Click to water this tile");
    else if (seed) this.hud.setPrompt(`Click to plant ${CROP_SPECIES[seed].displayName}`);
    else this.hud.setPrompt(null);
  }

  private useToolOnTile(coord: GridCoord): void {
    const tool = this.currentTool();
    const seed = this.currentSeedSpecies();
    const existingCrop = this.farming.getCrop(coord);

    if (existingCrop?.stage === "harvestable") {
      this.farming.harvest(coord);
      return;
    }

    if (tool === "hoe") {
      if (this.farming.till(coord)) {
        this.audio.playSfx("till_soil", { position: this.terrain.gridToWorldCenter(coord) });
        this.particles.tillDust(this.terrain.gridToWorldCenter(coord));
      }
    } else if (tool === "watering_can") {
      this.farming.water(coord);
      this.audio.playSfx("water_pour", { position: this.terrain.gridToWorldCenter(coord) });
      this.particles.waterSplash(this.terrain.gridToWorldCenter(coord));
    } else if (seed) {
      if (this.farming.plant(coord, seed, this.time.getState().day)) this.consumeSelected(1);
    }
  }

  private interactWithNearestAnimal(feed = false): void {
    const playerPos = this.farmerObject.position;
    let nearest: AnimalRig | null = null;
    let nearestDist = 2.0;
    for (const rig of this.animals) {
      const d = Math.hypot(rig.entity.position.x - playerPos.x, rig.entity.position.z - playerPos.z);
      if (d < nearestDist) {
        nearest = rig;
        nearestDist = d;
      }
    }
    if (!nearest) return;
    if (feed) this.animalAi.feed(nearest.entity);
    else this.animalAi.pet(nearest.entity);
    this.audio.playSfx(nearest.entity.species === "cow" || nearest.entity.species === "bull" ? "animal_moo" : "animal_bray", {
      position: nearest.entity.position,
    });
  }

  // ---------------------------------------------------------------------
  // Main loop — fixed timestep simulation + variable-rate rendering
  // ---------------------------------------------------------------------

  private loop(): void {
    if (!this.running) return;
    const frameDelta = Math.min(0.1, this.clock.getDelta());
    this.playtimeSeconds += frameDelta;
    this.accumulator += frameDelta;

    while (this.accumulator >= FIXED_TIMESTEP) {
      this.fixedUpdate(FIXED_TIMESTEP);
      this.accumulator -= FIXED_TIMESTEP;
    }

    this.render(frameDelta);
    requestAnimationFrame(() => this.loop());
  }

  private fixedUpdate(dt: number): void {
    this.time.update(dt);
    this.audio.setNightAmount(1 - this.time.getSunHeight());
    this.terrain.updateSun(this.time.getSunAngleRadians(), this.time.getSunHeight());
    this.windMaterials.update(dt);
    this.particles.update(dt);
    this.particles.setWeather(
      this.time.getState().weather.current === "thunderstorm" || this.time.getState().weather.current === "rain"
        ? "rain"
        : this.time.getState().weather.current === "frost"
          ? "snow"
          : "none",
      this.farmerObject.position
    );

    const soilAtPlayer = this.farming.getOrCreateSoil(this.terrain.worldToGrid(this.farmerObject.position));
    const didSlip = this.player.update(dt, soilAtPlayer.moisture);
    if (didSlip) {
      this.comedic.triggerMudSlip(this.time.getState().day, Math.floor(this.time.getState().hour));
      this.audio.playSfx("mud_slip", { position: this.farmerObject.position });
      this.particles.mudSlipDebris(this.farmerObject.position);
    }
    if (this.player.isMoving) {
      this.audio.playFootstepIfDue(this.player.currentSurface, this.player.isRunning);
    }

    const farmerTraveled = this.farmerObject.position.distanceTo(this.farmerLastPos);
    const farmerSpeed = dt > 0 ? farmerTraveled / dt : 0;
    this.farmerLastPos.copy(this.farmerObject.position);
    this.farmerAnimator.update(dt, this.player.isMoving ? (this.player.isRunning ? "run" : "walk") : "idle", farmerSpeed);

    this.updateAnimals(dt);
    this.updateHover();
    this.updateMinimap();
  }

  private updateAnimals(dt: number): void {
    const isNight = this.time.isNight();
    for (const rig of this.animals) {
      this.animalAi.update(rig.entity, dt, {
        isNight,
        allAnimals: this.animals.map((r) => r.entity),
        playerPosition: this.farmerObject.position,
        penCenter: { x: -1, y: 0, z: 2 },
        penRadius: 3.5,
        nearbyCropCoord: null,
        randomPointInRadius: (center, radius) => ({
          x: center.x + (Math.random() * 2 - 1) * radius,
          y: 0,
          z: center.z + (Math.random() * 2 - 1) * radius,
        }),
      });
      rig.object.position.set(rig.entity.position.x, rig.entity.position.y, rig.entity.position.z);
      rig.object.rotation.y = rig.entity.heading;

      const traveled = rig.object.position.distanceTo(rig.lastPos);
      const speed = dt > 0 ? traveled / dt : 0;
      rig.lastPos.copy(rig.object.position);
      const locomotion = locomotionFromActivity(rig.entity.activity, speed);
      rig.animator.update(dt, locomotion, speed);
    }
  }

  private updateMinimap(): void {
    const blips: MinimapBlip[] = [];
    for (const rig of this.animals) {
      const isPredator = rig.entity.species === "fox";
      blips.push({ x: rig.entity.position.x, z: rig.entity.position.z, kind: isPredator ? "predator" : "animal" });
    }
    for (const tile of this.farming.allCrops()) {
      const center = this.terrain.gridToWorldCenter(tile.coord);
      blips.push({ x: center.x, z: center.z, kind: "crop" });
    }
    blips.push({ x: 6, z: -6, kind: "structure" }); // barn

    const merchant = this.comedic.merchant;
    // Fixed merchant stall spot near the market road, matching the reference layout's
    // top-left "MARKET" chip pointing toward a stall off the homestead.
    const merchantWorld = { x: -8, z: -10 };

    this.minimap.update({
      playerX: this.farmerObject.position.x,
      playerZ: this.farmerObject.position.z,
      playerHeadingRad: this.farmerObject.rotation.y,
      merchantX: merchant.isPresent ? merchantWorld.x : null,
      merchantZ: merchant.isPresent ? merchantWorld.z : null,
      merchantPresent: merchant.isPresent,
      blips,
      worldRadius: 14,
    });
  }

  private render(frameDelta: number): void {
    void frameDelta;
    this.camera.position.set(
      this.farmerObject.position.x + Math.sin(CAMERA_YAW) * 18,
      18,
      this.farmerObject.position.z + Math.cos(CAMERA_YAW) * 18
    );
    this.camera.lookAt(this.farmerObject.position.x, 0, this.farmerObject.position.z);
    this.hud.updateClock(
      this.time.getState().day,
      this.time.getState().hour,
      this.time.getState().season,
      this.time.getState().year,
      this.time.getState().weather.current,
      this.time.getState().isMarketDay
    );
    this.renderer.render(this.scene, this.camera);
  }

  private positionCameraIsometric(): void {
    this.camera.position.set(Math.sin(CAMERA_YAW) * 18, 18, Math.cos(CAMERA_YAW) * 18);
    this.camera.lookAt(0, 0, 0);
  }

  private onResize(): void {
    const aspect = window.innerWidth / window.innerHeight;
    const viewSize = 12;
    this.camera.left = -viewSize * aspect;
    this.camera.right = viewSize * aspect;
    this.camera.top = viewSize;
    this.camera.bottom = -viewSize;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ---------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------

  private async persist(): Promise<void> {
    const payload: Omit<SaveGamePayload, "meta"> & { meta: Omit<SaveGamePayload["meta"], "checksum"> } = {
      meta: { saveVersion: SAVE_VERSION, savedAtIso: new Date().toISOString(), playtimeSeconds: this.playtimeSeconds },
      time: this.time.serialize(),
      player: {
        position: { x: this.farmerObject.position.x, y: this.farmerObject.position.y, z: this.farmerObject.position.z },
        heading: this.farmerObject.rotation.y,
        stamina: 100,
        equippedSlot: this.selectedSlot,
        currentSurface: this.player?.currentSurface ?? "grass",
      },
      farmBounds: { width: FARM_WIDTH_TILES, depth: FARM_DEPTH_TILES, originX: 0, originZ: 0 },
      soil: this.farming.allSoil(),
      crops: this.farming.allCrops(),
      animals: this.animals.map((r) => r.entity),
      inventory: this.inventory,
      merchant: this.comedic.merchant,
      eventLog: [],
      stats: {},
    };
    await this.save.save(payload);
  }

  private applySave(payload: SaveGamePayload): void {
    this.farmerObject.position.set(payload.player.position.x, payload.player.position.y, payload.player.position.z);
    this.farmerObject.rotation.y = payload.player.heading;
    this.inventory = payload.inventory;
    this.selectedSlot = payload.player.equippedSlot;
    this.playtimeSeconds = payload.meta.playtimeSeconds;
    // Soil/crops/animals restoration into live systems intentionally left as a
    // straightforward extension point — FarmingSystem/AnimalAI expose the same
    // Map-backed storage so re-hydration is a matter of re-inserting the
    // deserialized arrays before start() spawns meshes.
  }
}

function coordKey(c: GridCoord): string {
  return `${c.x},${c.z}`;
}

function modelIdForAnimal(species: AnimalSpeciesId): ModelId {
  return species;
}

function buildCropStageMesh(stage: string, isMega: boolean, windMaterials: WindMaterialRegistry): THREE.Group {
  const g = new THREE.Group();
  const scale = isMega ? 2.4 : 1;
  const colorByStage: Record<string, number> = {
    seed: 0x5a4632,
    sprout: 0x7bbf5e,
    vegetative: 0x4f9a4a,
    flowering: 0xd9c14a,
    harvestable: 0xd97706,
    rotten: 0x4a3826,
  };
  const height = { seed: 0.05, sprout: 0.2, vegetative: 0.45, flowering: 0.6, harvestable: 0.7, rotten: 0.3 }[stage] ?? 0.2;
  const color = colorByStage[stage] ?? 0x5a4632;
  // Growing/flowering stages sway in the wind; seeds and rotten stalks stay still.
  const material =
    stage === "seed" || stage === "rotten"
      ? new THREE.MeshStandardMaterial({ color, roughness: 0.9 })
      : windMaterials.create(color, { windStrength: 0.06 * scale, heightAttenuation: 3 });
  const geometry = new THREE.ConeGeometry(0.18 * scale, height * scale, 6);
  geometry.translate(0, (height * scale) / 2, 0); // pivot at base so the stalk sways from the ground up
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  g.add(mesh);
  return g;
}
