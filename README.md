# Hollow Creek Farm

A realistic-yet-ridiculous agricultural simulation built with **Three.js + TypeScript (strict) + Vite**.
Till, water, and fertilize real N‑P‑K/pH soil chemistry; grow eight crop species through five
growth stages; raise cows, bulls, horses, donkeys, alpacas, and chickens with genuine hunger/
affection/temperament AI; defend the coop from foxes with a patrolling husky; survive droughts,
frost, and thunderstorms; and get heckled by wandering merchants on market day.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173, hot-reloading
npm run build       # type-checks (tsc -b) then produces dist/
npm run preview     # serves the production build locally
npm run typecheck   # tsc --noEmit only
```

Controls: **WASD** to move, **Shift** to run, mouse to aim the tile cursor, **click / Enter** to
use the selected hotbar tool/seed on the highlighted tile, **1–9** or click to switch hotbar
slots, **E** to pet the nearest animal, **F** to feed it.

## Architecture

```
src/
  state/
    types.ts        # every serializable interface: CropTile, SoilState, AnimalEntity,
                     # InventoryItem, SaveGamePayload, etc. — the single source of truth
                     # for what a "farm" IS, independent of Three.js or rendering.
    content.ts       # static balance data: CROP_SPECIES defs, ITEM_DEFS.
  systems/
    TimeSystem.ts    # day/night clock, season rotation, weighted weather state machine.
    FarmingSystem.ts # tile grid: till/water/fertilize/plant/tickDay/harvest.
    AnimalAI.ts      # per-species behavior profiles: wandering, hunger/affection decay,
                     # stubbornness → tantrums, predator hunting loop, guardian patrol.
    AudioManager.ts  # Web Audio API: day/night music cross-fade, surface footsteps,
                     # positional one-shot SFX via PannerNode.
    SaveSystem.ts    # IndexedDB (localStorage fallback) persistence with a SHA-256
                     # checksum over the canonicalized payload — corrupted/hand-edited
                     # saves are rejected, not silently loaded.
  events/
    ComedicEvents.ts # wandering-merchant scheduling + random funny misfortune flavor
                     # text (mega-crops, crow gangs, mud slips, donkey tantrums...).
  world/
    Terrain.ts        # ground plane, per-tile hover highlight, sun/hemisphere light rig.
    AssetLoader.ts     # GLTFLoader + KTX2Loader(Basis)/DRACOLoader pipeline; falls back
                     # to hand-built low-poly primitive meshes when no .glb is present
                     # (this scaffold ships with zero binary assets — see public/models).
    PlayerController.ts # camera-relative WASD movement, surface detection, mud-slip roll.
  ui/
    HUD.ts           # pure HTML/CSS overlay: hotbar, clock/weather readout, toast log,
                     # merchant trade panel. Zero Three.js imports — talks only via callbacks.
  core/
    Game.ts          # composition root: scene/camera/renderer, raycaster for grid clicks,
                     # fixed-timestep (30Hz) simulation loop decoupled from render FPS,
                     # wires every system + HUD + input together.
  main.ts            # boots Game against #scene-canvas / #ui-root.
```

### Why fixed-timestep?

`Game.loop()` accumulates real frame time and drains it in fixed `1/30s` slices before each
render. Every gameplay system (`TimeSystem.update`, `AnimalAI.update`, soil/crop growth via
`FarmingSystem.tickDay`) only ever sees that fixed `dt`, so simulation stays deterministic and
frame-rate independent — a 30fps laptop and a 240Hz gaming monitor age crops at the same rate.

### Why does FarmingSystem key growth off "day changed" and not every tick?

Per the brief, growth ticks are tied to the sim clock's day boundary, not the render loop —
`TimeSystem` fires a `day_changed` event once per in-game day (`SECONDS_PER_GAME_HOUR` real
seconds × 24 by default), and `Game` forwards that into `FarmingSystem.tickDay()`. This keeps
soil moisture/NPK/pH math, mega-growth overfertilization checks, and stage transitions all
happening in one deterministic daily batch instead of accumulating floating-point drift every frame.

### Extending the asset pipeline

Nothing in `AssetLoader`, `Terrain`, or `Game` needs to change to go from primitives to real art:

1. Drop `.glb` files into `public/models/<id>.glb` (ids: `farmer`, `barn`, `fence`, `trough`,
   `tool_shovel`, `cow`, `bull`, `horse`, `donkey`, `alpaca`, `chicken`, `husky`, `fox`, `deer`,
   `stag`, ...).
2. Drop the Basis Universal transcoder (`basis_transcoder.js`/`.wasm`, from
   `three/examples/jsm/libs/basis/`) into `public/basis/`.
3. If your `.glb`s use Draco mesh compression, drop the Draco decoder into `public/draco/`.
4. Drop audio into `public/audio/{sfx,footsteps,music}/<name>.mp3` per the filenames listed in
   each folder's `README.txt`.

`AssetLoader.get()` tries the real `.glb` first and only falls back to the procedural low-poly
builder (`buildPlaceholder`) on a load failure — so you can add art incrementally, one model at
a time, with no code changes.

### Known scaffolding gaps (intentional, flagged in code)

- `Game.applySave()` restores player position/inventory/playtime but does not yet re-hydrate
  `FarmingSystem`'s soil/crop maps or re-spawn `AnimalEntity` state from a prior save — both
  systems already expose the plain-array shapes (`allSoil()`, `allCrops()`, `SaveGamePayload.animals`)
  needed to do so; wiring it up is a couple of `for` loops once you decide how you want mesh
  re-spawn timing to interact with the boot sequence.
- `FarmingSystem`'s daily "sun exposure" input is currently a flat `0.5` placeholder in
  `Game.wireSystemEvents()` — swap in `TimeSystem`'s actual daily-average `getSunHeight()`
  sample for season-accurate moisture evaporation.
- Fence collision is visual-only; animals currently escape via the temperament/tantrum roll in
  `AnimalAI`, not by colliding with (or breaking) actual fence geometry.
