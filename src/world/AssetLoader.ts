// =============================================================================
// AssetLoader
// Wraps GLTFLoader + KTX2Loader (Basis Universal transcoding via WASM) per the
// spec's texture pipeline. This scaffold ships with zero binary .glb/.wasm
// assets (none were provided), so every model load falls back to a low-poly
// primitive builder — swap in real files under /public/models and
// /public/basis and the real path activates automatically with no code
// changes elsewhere in the game.
// =============================================================================

import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";

export type ModelId =
  | "farmer"
  | "barn"
  | "fence"
  | "trough"
  | "tool_shovel"
  | "tool_axe"
  | "tool_watering_can"
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

export class AssetLoader {
  private gltfLoader: GLTFLoader;
  private ktx2Loader: KTX2Loader;
  private cache = new Map<ModelId, THREE.Object3D>();

  constructor(renderer: THREE.WebGLRenderer) {
    this.ktx2Loader = new KTX2Loader();
    this.ktx2Loader.setTranscoderPath("/basis/");
    this.ktx2Loader.detectSupport(renderer);

    const draco = new DRACOLoader();
    draco.setDecoderPath("/draco/");

    this.gltfLoader = new GLTFLoader();
    this.gltfLoader.setKTX2Loader(this.ktx2Loader);
    this.gltfLoader.setDRACOLoader(draco);
  }

  /** Returns a cloned instance of the model, loading + caching the source on first use. */
  async get(id: ModelId): Promise<THREE.Object3D> {
    let source = this.cache.get(id);
    if (!source) {
      source = await this.loadOrFallback(id);
      this.cache.set(id, source);
    }
    return source.clone(true);
  }

  private async loadOrFallback(id: ModelId): Promise<THREE.Object3D> {
    try {
      const gltf: GLTF = await this.gltfLoader.loadAsync(`/models/${id}.glb`);
      gltf.scene.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      return gltf.scene;
    } catch {
      return buildPlaceholder(id);
    }
  }

  dispose(): void {
    this.ktx2Loader.dispose();
  }
}

// -----------------------------------------------------------------------------
// Low-poly primitive fallbacks — deliberately blocky/stylized so the "real"
// glb art can slot in later without a visual language mismatch.
// -----------------------------------------------------------------------------

const PALETTE = {
  farmerSkin: 0xd9a066,
  farmerHat: 0x8a5a2b,
  farmerShirt: 0x3c6e47,
  wood: 0x8a5a34,
  barnRed: 0x7a2e2e,
  barnRoof: 0x2b2f36,
  cowWhite: 0xf2ede3,
  cowBlack: 0x2a2a2a,
  horseBrown: 0x6b4226,
  donkeyGray: 0x9a938a,
  alpacaCream: 0xe8dcc4,
  chickenWhite: 0xfff6e5,
  huskyGray: 0xb9c2c9,
  foxOrange: 0xc85a2e,
  deerFawn: 0xa9714b,
  metal: 0x9aa0a6,
} as const;

function mat(color: number, roughness = 0.8): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.05 });
}

function box(w: number, h: number, d: number, color: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function cylinder(rTop: number, rBottom: number, h: number, color: number, segments = 8): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, segments), mat(color));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function buildPlaceholder(id: ModelId): THREE.Object3D {
  switch (id) {
    case "farmer":
      return buildFarmer();
    case "barn":
      return buildBarn();
    case "fence":
      return buildFence();
    case "trough":
      return buildTrough();
    case "tool_shovel":
      return buildTool(PALETTE.wood, PALETTE.metal, "flat");
    case "tool_axe":
      return buildTool(PALETTE.wood, 0x8b1e1e, "blade");
    case "tool_watering_can":
      return buildWateringCan();
    case "cow":
      return buildQuadruped({ body: PALETTE.cowWhite, accent: PALETTE.cowBlack, scale: 1 });
    case "bull":
      return buildQuadruped({ body: PALETTE.cowBlack, accent: PALETTE.cowWhite, scale: 1.15 });
    case "horse":
      return buildQuadruped({ body: PALETTE.horseBrown, accent: 0x3a2415, scale: 1.2, legLength: 1.3 });
    case "donkey":
      return buildQuadruped({ body: PALETTE.donkeyGray, accent: 0x5a544c, scale: 0.95, legLength: 1.1 });
    case "alpaca":
      return buildQuadruped({ body: PALETTE.alpacaCream, accent: 0xcabb96, scale: 0.9, neckLength: 1.4 });
    case "chicken":
      return buildBird(PALETTE.chickenWhite);
    case "husky":
      return buildQuadruped({ body: PALETTE.huskyGray, accent: 0xffffff, scale: 0.6, legLength: 0.7 });
    case "fox":
      return buildQuadruped({ body: PALETTE.foxOrange, accent: 0xffffff, scale: 0.55, legLength: 0.6 });
    case "deer":
    case "stag":
      return buildQuadruped({ body: PALETTE.deerFawn, accent: 0xf0e6d2, scale: 1.05, legLength: 1.2, antlers: id === "stag" });
    default:
      return box(1, 1, 1, 0xff00ff);
  }
}

function buildFarmer(): THREE.Group {
  const g = new THREE.Group();
  const legHeight = 0.7;
  const legL = box(0.16, legHeight, 0.18, 0x2f4858);
  legL.geometry.translate(0, -legHeight / 2, 0); // pivot at hip (top of leg) for swing rotation
  legL.position.set(0.11, legHeight, 0);
  legL.name = "legFL";
  const legR = legL.clone();
  legR.geometry = legL.geometry.clone();
  legR.position.x = -0.11;
  legR.name = "legFR";
  const torso = box(0.45, 0.55, 0.28, PALETTE.farmerShirt);
  torso.position.y = legHeight + 0.28;
  torso.name = "body";
  const head = box(0.28, 0.28, 0.26, PALETTE.farmerSkin);
  head.position.y = legHeight + 0.7;
  head.name = "head";
  const hatBrim = cylinder(0.32, 0.32, 0.04, PALETTE.farmerHat, 12);
  const hatTop = cylinder(0.16, 0.2, 0.22, PALETTE.farmerHat, 12);
  head.add(hatBrim, hatTop);
  hatBrim.position.y = 0.16;
  hatTop.position.y = 0.28;
  const armHeight = 0.5;
  const armL = box(0.13, armHeight, 0.13, PALETTE.farmerShirt);
  armL.geometry.translate(0, -armHeight / 2, 0); // pivot at shoulder
  armL.position.set(0.32, legHeight + 0.5, 0);
  armL.name = "armL";
  const armR = armL.clone();
  armR.geometry = armL.geometry.clone();
  armR.position.x = -0.32;
  armR.name = "armR";
  g.add(legL, legR, torso, head, armL, armR);
  return g;
}

function buildBarn(): THREE.Group {
  const g = new THREE.Group();
  const walls = box(4.2, 2.6, 3.4, PALETTE.barnRed);
  walls.position.y = 1.3;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(3.1, 1.6, 4), mat(PALETTE.barnRoof));
  roof.rotation.y = Math.PI / 4;
  roof.position.y = 3.3;
  roof.castShadow = true;
  const door = box(1.1, 1.8, 0.1, 0xd8d3c4);
  door.position.set(0, 0.9, 1.71);
  g.add(walls, roof, door);
  return g;
}

function buildFence(): THREE.Group {
  const g = new THREE.Group();
  const postL = cylinder(0.05, 0.06, 1.0, PALETTE.wood, 6);
  postL.position.set(-0.5, 0.5, 0);
  const postR = postL.clone();
  postR.position.x = 0.5;
  const railTop = box(1.1, 0.08, 0.06, PALETTE.wood);
  railTop.position.y = 0.75;
  const railBottom = railTop.clone();
  railBottom.position.y = 0.35;
  g.add(postL, postR, railTop, railBottom);
  return g;
}

function buildTrough(): THREE.Group {
  const g = new THREE.Group();
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.4, 0.35, 10, 1, true), mat(PALETTE.metal, 0.5));
  basin.position.y = 0.2;
  const water = new THREE.Mesh(
    new THREE.CylinderGeometry(0.46, 0.46, 0.05, 10),
    new THREE.MeshStandardMaterial({ color: 0x4a90c4, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.85 })
  );
  water.position.y = 0.32;
  g.add(basin, water);
  return g;
}

function buildTool(handleColor: number, headColor: number, headShape: "flat" | "blade"): THREE.Group {
  const g = new THREE.Group();
  const handle = cylinder(0.03, 0.03, 0.9, handleColor, 6);
  handle.position.y = 0.45;
  const head =
    headShape === "flat"
      ? box(0.22, 0.28, 0.03, headColor)
      : new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 3), mat(headColor));
  head.position.y = headShape === "flat" ? 0.95 : 0.98;
  head.rotation.z = headShape === "blade" ? Math.PI / 2 : 0;
  head.castShadow = true;
  g.add(handle, head);
  return g;
}

function buildWateringCan(): THREE.Group {
  const g = new THREE.Group();
  const body = cylinder(0.16, 0.2, 0.32, PALETTE.metal, 10);
  body.position.y = 0.2;
  const spout = cylinder(0.02, 0.04, 0.35, PALETTE.metal, 6);
  spout.rotation.z = Math.PI / 3;
  spout.position.set(0.22, 0.32, 0);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.015, 6, 12, Math.PI), mat(PALETTE.metal, 0.5));
  handle.position.set(-0.05, 0.42, 0);
  handle.rotation.x = Math.PI / 2;
  g.add(body, spout, handle);
  return g;
}

interface QuadrupedOptions {
  body: number;
  accent: number;
  scale: number;
  legLength?: number;
  neckLength?: number;
  antlers?: boolean;
}

function buildQuadruped(opts: QuadrupedOptions): THREE.Group {
  const g = new THREE.Group();
  const legLen = opts.legLength ?? 0.9;
  const bodyMesh = box(1.0, 0.55, 0.5, opts.body);
  bodyMesh.position.y = legLen + 0.28;
  bodyMesh.name = "body";
  const neckLen = opts.neckLength ?? 1;
  const neck = box(0.24, 0.4 * neckLen, 0.24, opts.body);
  neck.position.set(0.5, legLen + 0.5, 0);
  neck.rotation.z = -0.4;
  neck.name = "neck";
  const head = box(0.3, 0.26, 0.26, opts.accent);
  head.position.set(0.68 + (neckLen - 1) * 0.15, legLen + 0.68 * neckLen, 0);
  head.name = "head";

  const legNames = ["legFL", "legFR", "legBL", "legBR"] as const;
  const legPositions: [number, number][] = [
    [0.35, 0.18],
    [0.35, -0.18],
    [-0.35, 0.18],
    [-0.35, -0.18],
  ];
  const legs = legPositions.map(([lx, lz], i) => {
    const leg = box(0.14, legLen, 0.14, opts.accent);
    leg.geometry.translate(0, -legLen / 2, 0); // pivot at hip/shoulder for swing rotation
    leg.position.set(lx, legLen, lz);
    leg.name = legNames[i] ?? "legFL";
    return leg;
  });

  const tail = box(0.08, 0.08, 0.4, opts.accent);
  tail.geometry.translate(0, 0, 0.2); // pivot at base of tail
  tail.position.set(-0.52, legLen + 0.4, 0);
  tail.name = "tail";

  g.add(bodyMesh, neck, head, tail, ...legs);

  if (opts.antlers) {
    for (const side of [1, -1]) {
      const antler = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.5, 4), mat(0x5a4632));
      antler.position.set(0.6, legLen + 0.95, side * 0.1);
      antler.rotation.z = -0.6;
      antler.rotation.x = side * 0.3;
      head.add(antler);
      antler.position.set(0.05, 0.35, side * 0.1);
    }
  }

  g.scale.setScalar(opts.scale);
  return g;
}

function buildBird(color: number): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), mat(color));
  body.position.y = 0.22;
  body.name = "body";
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), mat(color));
  head.position.set(0.16, 0.32, 0);
  head.name = "head";
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.08, 4), mat(0xd97706));
  beak.rotation.z = Math.PI / 2;
  beak.position.set(0.26, 0.32, 0);
  const legFL = box(0.02, 0.12, 0.02, 0xd97706);
  legFL.geometry.translate(0, -0.06, 0);
  legFL.position.set(0.03, 0.1, 0.04);
  legFL.name = "legFL";
  const legFR = legFL.clone();
  legFR.geometry = legFL.geometry.clone();
  legFR.position.z = -0.04;
  legFR.name = "legFR";
  g.add(body, head, beak, legFL, legFR);
  return g;
}
