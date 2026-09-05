// =============================================================================
// Terrain
// Builds the ground plane, the per-tile grid overlay used for raycasting +
// hover highlighting, and the directional "sun" + hemisphere sky lighting rig
// that TimeSystem drives across the day/night cycle.
// =============================================================================

import * as THREE from "three";
import type { GridCoord } from "@/state/types";

export const TILE_SIZE = 1;

export interface TerrainConfig {
  widthTiles: number;
  depthTiles: number;
}

const SOIL_COLOR_DRY = new THREE.Color(0x8a6d4b);
const SOIL_COLOR_WET = new THREE.Color(0x4a3826);
const GRASS_COLOR = new THREE.Color(0x5f9a4a);

export class Terrain {
  readonly group = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly ambient: THREE.AmbientLight;

  private config: TerrainConfig;
  private grassMesh: THREE.Mesh;
  private tileHighlight: THREE.Mesh;
  private soilTileMeshes = new Map<string, THREE.Mesh>();
  private soilTileGroup = new THREE.Group();

  constructor(config: TerrainConfig) {
    this.config = config;

    const groundGeo = new THREE.PlaneGeometry(config.widthTiles * TILE_SIZE, config.depthTiles * TILE_SIZE, config.widthTiles, config.depthTiles);
    groundGeo.rotateX(-Math.PI / 2);
    const groundMat = new THREE.MeshStandardMaterial({ color: GRASS_COLOR, roughness: 1 });
    this.grassMesh = new THREE.Mesh(groundGeo, groundMat);
    this.grassMesh.receiveShadow = true;
    this.grassMesh.name = "ground";
    this.group.add(this.grassMesh);

    const highlightGeo = new THREE.PlaneGeometry(TILE_SIZE * 0.95, TILE_SIZE * 0.95);
    highlightGeo.rotateX(-Math.PI / 2);
    const highlightMat = new THREE.MeshBasicMaterial({ color: 0xfff27a, transparent: true, opacity: 0.55 });
    this.tileHighlight = new THREE.Mesh(highlightGeo, highlightMat);
    this.tileHighlight.visible = false;
    this.tileHighlight.position.y = 0.011;
    this.group.add(this.tileHighlight);

    this.group.add(this.soilTileGroup);

    // --- Lighting rig -------------------------------------------------------
    this.sun = new THREE.DirectionalLight(0xfff1d0, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const shadowSpan = Math.max(config.widthTiles, config.depthTiles) * 0.6;
    this.sun.shadow.camera.left = -shadowSpan;
    this.sun.shadow.camera.right = shadowSpan;
    this.sun.shadow.camera.top = shadowSpan;
    this.sun.shadow.camera.bottom = -shadowSpan;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 80;
    this.sun.shadow.bias = -0.0015;

    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x3a2f22, 0.6);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.15);
  }

  worldToGrid(point: THREE.Vector3): GridCoord {
    return {
      x: Math.floor(point.x / TILE_SIZE + this.config.widthTiles / 2),
      z: Math.floor(point.z / TILE_SIZE + this.config.depthTiles / 2),
    };
  }

  /** Swaps the ground plane's material — used to install the wind-sway shader material. */
  setGroundMaterial(material: THREE.Material): void {
    this.grassMesh.material = material;
  }

  gridToWorldCenter(coord: GridCoord): THREE.Vector3 {
    return new THREE.Vector3(
      (coord.x - this.config.widthTiles / 2 + 0.5) * TILE_SIZE,
      0,
      (coord.z - this.config.depthTiles / 2 + 0.5) * TILE_SIZE
    );
  }

  isInBounds(coord: GridCoord): boolean {
    return coord.x >= 0 && coord.x < this.config.widthTiles && coord.z >= 0 && coord.z < this.config.depthTiles;
  }

  showHighlight(coord: GridCoord | null): void {
    if (!coord || !this.isInBounds(coord)) {
      this.tileHighlight.visible = false;
      return;
    }
    const center = this.gridToWorldCenter(coord);
    this.tileHighlight.position.set(center.x, 0.011, center.z);
    this.tileHighlight.visible = true;
  }

  /** Creates or updates the visible soil patch mesh for a tilled/wet tile. */
  upsertSoilVisual(coord: GridCoord, tilth: "untilled" | "tilled" | "hardpan", moisture: number): void {
    const key = `${coord.x},${coord.z}`;
    let mesh = this.soilTileMeshes.get(key);

    if (tilth === "untilled") {
      if (mesh) {
        this.soilTileGroup.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        this.soilTileMeshes.delete(key);
      }
      return;
    }

    if (!mesh) {
      const geo = new THREE.PlaneGeometry(TILE_SIZE * 0.92, TILE_SIZE * 0.92);
      geo.rotateX(-Math.PI / 2);
      const material = new THREE.MeshStandardMaterial({ roughness: 1 });
      mesh = new THREE.Mesh(geo, material);
      mesh.receiveShadow = true;
      const center = this.gridToWorldCenter(coord);
      mesh.position.set(center.x, 0.006, center.z);
      this.soilTileGroup.add(mesh);
      this.soilTileMeshes.set(key, mesh);
    }

    const color = SOIL_COLOR_DRY.clone().lerp(SOIL_COLOR_WET, moisture);
    if (tilth === "hardpan") color.lerp(new THREE.Color(0x555044), 0.5);
    (mesh.material as THREE.MeshStandardMaterial).color.copy(color);
  }

  /** Drives sun position/intensity + hemisphere tint from TimeSystem's angle & sun height. */
  updateSun(sunAngleRadians: number, sunHeight: number): void {
    const radius = 30;
    this.sun.position.set(Math.cos(sunAngleRadians) * radius, Math.max(2, Math.sin(sunAngleRadians) * radius), 8);
    this.sun.intensity = 0.15 + sunHeight * 2.2;

    const warmth = new THREE.Color(0xfff1d0).lerp(new THREE.Color(0xffa552), 1 - sunHeight);
    this.sun.color.copy(warmth);

    const dayColor = new THREE.Color(0xbfd8ff);
    const nightColor = new THREE.Color(0x1a2338);
    this.hemi.color.copy(nightColor.clone().lerp(dayColor, sunHeight));
    this.hemi.intensity = 0.25 + sunHeight * 0.6;
  }
}
