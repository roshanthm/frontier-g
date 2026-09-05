// =============================================================================
// Minimap
// Two small HUD widgets modeled on the reference screenshot:
//  1. A top-left "MARKET · 37M" compass chip — an arrow that rotates to point
//     at the merchant's spawn location plus a live walking-distance readout.
//  2. A bottom-left rotating minimap disc showing the player as a fixed
//     center dot with nearby animals/crops/structures as blips, and a
//     player-forward wedge so orientation reads at a glance.
// Pure canvas 2D — no Three.js dependency, redraws only every ~150ms since a
// minimap doesn't need 60fps precision.
// =============================================================================

export interface MinimapBlip {
  x: number;
  z: number;
  kind: "animal" | "crop" | "structure" | "predator";
}

export interface MinimapUpdateInput {
  playerX: number;
  playerZ: number;
  playerHeadingRad: number;
  merchantX: number | null;
  merchantZ: number | null;
  merchantPresent: boolean;
  blips: MinimapBlip[];
  worldRadius: number;
}

const BLIP_COLOR: Record<MinimapBlip["kind"], string> = {
  animal: "#e8d9a6",
  crop: "#8fd06a",
  structure: "#c9c2b4",
  predator: "#e0554f",
};

export class Minimap {
  private compassEl: HTMLElement;
  private compassArrow: HTMLElement;
  private compassDistance: HTMLElement;
  private mapCanvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private lastDrawAt = 0;
  private readonly redrawIntervalMs = 120;
  private readonly mapPixelSize = 148;

  constructor(root: HTMLElement) {
    this.compassEl = document.createElement("div");
    this.compassEl.className = "hud-compass hud-hidden";
    this.compassEl.innerHTML = `
      <div class="hud-compass-arrow">▲</div>
      <div class="hud-compass-label">
        <div class="hud-compass-title">MARKET</div>
        <div class="hud-compass-distance">—</div>
      </div>
    `;
    this.compassArrow = this.compassEl.querySelector(".hud-compass-arrow") as HTMLElement;
    this.compassDistance = this.compassEl.querySelector(".hud-compass-distance") as HTMLElement;

    const mapWrap = document.createElement("div");
    mapWrap.className = "hud-minimap";
    this.mapCanvas = document.createElement("canvas");
    this.mapCanvas.width = this.mapPixelSize;
    this.mapCanvas.height = this.mapPixelSize;
    mapWrap.appendChild(this.mapCanvas);
    const compassNorth = document.createElement("div");
    compassNorth.className = "hud-minimap-north";
    compassNorth.textContent = "N";
    mapWrap.appendChild(compassNorth);

    this.ctx = this.mapCanvas.getContext("2d")!;

    root.append(this.compassEl, mapWrap);
  }

  update(input: MinimapUpdateInput): void {
    this.updateCompass(input);

    const now = performance.now();
    if (now - this.lastDrawAt < this.redrawIntervalMs) return;
    this.lastDrawAt = now;
    this.drawMinimap(input);
  }

  private updateCompass(input: MinimapUpdateInput): void {
    if (!input.merchantPresent || input.merchantX === null || input.merchantZ === null) {
      this.compassEl.classList.add("hud-hidden");
      return;
    }
    this.compassEl.classList.remove("hud-hidden");

    const dx = input.merchantX - input.playerX;
    const dz = input.merchantZ - input.playerZ;
    const distanceMeters = Math.sqrt(dx * dx + dz * dz);
    const angleToTarget = Math.atan2(dx, dz);
    const relativeAngle = angleToTarget - input.playerHeadingRad;

    this.compassArrow.style.transform = `rotate(${relativeAngle}rad)`;
    this.compassDistance.textContent = `${Math.round(distanceMeters)}M`;
  }

  private drawMinimap(input: MinimapUpdateInput): void {
    const ctx = this.ctx;
    const size = this.mapPixelSize;
    const center = size / 2;
    const scale = center / input.worldRadius;

    ctx.clearRect(0, 0, size, size);

    // Circular clip + backdrop
    ctx.save();
    ctx.beginPath();
    ctx.arc(center, center, center - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = "rgba(30, 45, 25, 0.9)";
    ctx.fillRect(0, 0, size, size);

    // Subtle radial grid rings for depth cues
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    for (let r = 1; r <= 3; r++) {
      ctx.beginPath();
      ctx.arc(center, center, (center - 2) * (r / 3), 0, Math.PI * 2);
      ctx.stroke();
    }

    // World-space -> map-space, centered on the player, rotated so "up" = player forward.
    const cosH = Math.cos(-input.playerHeadingRad);
    const sinH = Math.sin(-input.playerHeadingRad);
    const toMap = (wx: number, wz: number): [number, number] => {
      const relX = wx - input.playerX;
      const relZ = wz - input.playerZ;
      const rotX = relX * cosH - relZ * sinH;
      const rotZ = relX * sinH + relZ * cosH;
      return [center + rotX * scale, center - rotZ * scale];
    };

    for (const blip of input.blips) {
      const [mx, mz] = toMap(blip.x, blip.z);
      if (mx < 0 || mx > size || mz < 0 || mz > size) continue;
      ctx.fillStyle = BLIP_COLOR[blip.kind];
      ctx.beginPath();
      ctx.arc(mx, mz, blip.kind === "predator" ? 3.5 : 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    if (input.merchantPresent && input.merchantX !== null && input.merchantZ !== null) {
      const [mx, mz] = toMap(input.merchantX, input.merchantZ);
      ctx.fillStyle = "#ffcf6b";
      ctx.beginPath();
      ctx.moveTo(mx, mz - 5);
      ctx.lineTo(mx + 4, mz + 4);
      ctx.lineTo(mx - 4, mz + 4);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();

    // Player wedge, always centered, pointing "up" since the map itself rotates.
    ctx.save();
    ctx.translate(center, center);
    ctx.fillStyle = "#ffe9b8";
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Ring border
    ctx.beginPath();
    ctx.arc(center, center, center - 2, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(243,236,216,0.35)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}
