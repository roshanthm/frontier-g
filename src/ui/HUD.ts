// =============================================================================
// HUD
// Pure HTML5/CSS overlay layered on top of the WebGL canvas (per spec: keeps
// draw calls low, avoids stuffing UI into the 3D scene graph). Owns the
// hotbar, clock/weather readout, event toast log, and merchant trade panel.
// Talks to the rest of the game only through plain callbacks — no Three.js
// imports here.
// =============================================================================

import type { ComedicEventRecord, InventoryItem, MerchantState, Season, WeatherKind } from "@/state/types";

export interface HotbarSlotView {
  index: number;
  item: InventoryItem | null;
  keyLabel: string;
}

export interface HudCallbacks {
  onSelectSlot: (index: number) => void;
  onBuyOffer: (itemDefId: string) => void;
  onCloseMerchant: () => void;
}

const WEATHER_ICON: Record<WeatherKind, string> = {
  sunny: "☀",
  overcast: "☁",
  rain: "🌧",
  thunderstorm: "⛈",
  drought: "🔥",
  frost: "❄",
};

export class Hud {
  private root: HTMLElement;
  private hotbarEl: HTMLElement;
  private clockEl: HTMLElement;
  private toastLogEl: HTMLElement;
  private merchantPanelEl: HTMLElement;
  private promptEl: HTMLElement;
  private callbacks: HudCallbacks;

  constructor(root: HTMLElement, callbacks: HudCallbacks) {
    this.root = root;
    this.callbacks = callbacks;

    this.clockEl = div("hud-clock");
    this.promptEl = div("hud-prompt hud-prompt-hidden");
    this.hotbarEl = div("hud-hotbar");
    this.toastLogEl = div("hud-toast-log");
    this.merchantPanelEl = div("hud-merchant hud-hidden");

    this.root.append(this.clockEl, this.promptEl, this.toastLogEl, this.hotbarEl, this.merchantPanelEl);

    window.addEventListener("keydown", (e) => {
      const n = Number(e.key);
      if (!Number.isNaN(n) && n >= 1 && n <= 9) this.callbacks.onSelectSlot(n - 1);
    });
  }

  setPrompt(text: string | null): void {
    if (!text) {
      this.promptEl.classList.add("hud-prompt-hidden");
      return;
    }
    this.promptEl.textContent = text;
    this.promptEl.classList.remove("hud-prompt-hidden");
  }

  updateClock(day: number, hour: number, season: Season, year: number, weather: WeatherKind, isMarketDay: boolean): void {
    const h = Math.floor(hour);
    const m = Math.floor((hour - h) * 60);
    const hh = String(h).padStart(2, "0");
    const mm = String(m).padStart(2, "0");
    this.clockEl.innerHTML = `
      <div class="hud-clock-time">${hh}:${mm}</div>
      <div class="hud-clock-meta">${WEATHER_ICON[weather]} &nbsp; ${capitalize(season)} · Day ${day} · Year ${year}${
      isMarketDay ? ' <span class="hud-market-tag">MARKET DAY</span>' : ""
    }</div>
    `;
  }

  renderHotbar(slots: HotbarSlotView[]): void {
    this.hotbarEl.innerHTML = "";
    for (const slot of slots) {
      const el = div("hud-slot" + (slot.item ? "" : " hud-slot-empty"));
      el.dataset.index = String(slot.index);
      el.innerHTML = `
        <div class="hud-slot-key">${slot.keyLabel}</div>
        <div class="hud-slot-icon">${slot.item ? iconFor(slot.item.itemDefId) : ""}</div>
        <div class="hud-slot-label">${slot.item?.displayName ?? ""}</div>
        ${slot.item && slot.item.stackable ? `<div class="hud-slot-qty">${slot.item.quantity}</div>` : ""}
      `;
      el.addEventListener("click", () => this.callbacks.onSelectSlot(slot.index));
      this.hotbarEl.appendChild(el);
    }
  }

  setSelectedSlot(index: number): void {
    this.hotbarEl.querySelectorAll<HTMLElement>(".hud-slot").forEach((el) => {
      el.classList.toggle("hud-slot-selected", Number(el.dataset.index) === index);
    });
  }

  pushToast(record: ComedicEventRecord): void {
    const el = div("hud-toast");
    el.textContent = record.message;
    this.toastLogEl.prepend(el);
    requestAnimationFrame(() => el.classList.add("hud-toast-visible"));
    setTimeout(() => {
      el.classList.remove("hud-toast-visible");
      setTimeout(() => el.remove(), 400);
    }, 5200);

    while (this.toastLogEl.children.length > 5) {
      this.toastLogEl.lastElementChild?.remove();
    }
  }

  showMerchant(merchant: MerchantState, coins: number): void {
    if (!merchant.isPresent) {
      this.merchantPanelEl.classList.add("hud-hidden");
      return;
    }
    this.merchantPanelEl.classList.remove("hud-hidden");
    this.merchantPanelEl.innerHTML = `
      <div class="hud-merchant-header">
        <span>${merchant.name}</span>
        <span class="hud-merchant-coins">${coins}c</span>
        <button class="hud-merchant-close" type="button">✕</button>
      </div>
      <div class="hud-merchant-offers">
        ${merchant.offers
          .map(
            (o) => `
          <button class="hud-merchant-offer" data-item="${o.itemDefId}" ${o.quantityAvailable <= 0 ? "disabled" : ""}>
            <span class="${o.isExotic ? "hud-exotic" : ""}">${o.displayName}</span>
            <span class="hud-merchant-price">${o.price}c</span>
            <span class="hud-merchant-stock">x${o.quantityAvailable}</span>
          </button>`
          )
          .join("")}
      </div>
    `;
    this.merchantPanelEl.querySelector(".hud-merchant-close")?.addEventListener("click", () => this.callbacks.onCloseMerchant());
    this.merchantPanelEl.querySelectorAll<HTMLButtonElement>(".hud-merchant-offer").forEach((btn) => {
      btn.addEventListener("click", () => this.callbacks.onBuyOffer(btn.dataset.item!));
    });
  }

  hideBootScreen(): void {
    document.getElementById("boot-screen")?.classList.add("boot-screen-hidden");
  }

  setBootProgress(pct: number): void {
    const fill = document.getElementById("boot-bar-fill");
    if (fill) fill.style.width = `${Math.round(pct * 100)}%`;
  }
}

function div(className: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = className;
  return el;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const ICONS: Record<string, string> = {
  shovel: "⛏",
  hoe: "🚜",
  watering_can: "💧",
  axe: "🪓",
  seed_wheat: "🌾",
  seed_corn: "🌽",
  seed_pumpkin: "🎃",
  compost: "🪴",
  manure: "💩",
  milk: "🥛",
  fleece: "🧶",
  bear_trap: "🪤",
  fence_post: "🪵",
};

function iconFor(itemDefId: string): string {
  return ICONS[itemDefId] ?? "❔";
}
