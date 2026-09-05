// =============================================================================
// SaveSystem
// Serializes SaveGamePayload to IndexedDB (preferred) with a localStorage
// fallback, guarding every write/read with a SHA-256 checksum of the
// canonicalized body so corrupted or hand-edited saves are rejected instead
// of silently loaded.
// =============================================================================

import { SAVE_VERSION, type SaveGamePayload } from "@/state/types";

const DB_NAME = "hollow-creek-farm";
const STORE_NAME = "saves";
const LOCAL_STORAGE_KEY = "hollow-creek-farm.save.v1";
const DB_VERSION = 1;

/** Deterministic stringify: sorts object keys so checksum is stable across runs. */
function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (!("indexedDB" in window)) {
      resolve(null);
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

export type SaveLoadResult =
  | { ok: true; payload: SaveGamePayload }
  | { ok: false; reason: "not_found" | "checksum_mismatch" | "version_mismatch" | "parse_error" };

export class SaveSystem {
  private dbPromise: Promise<IDBDatabase | null>;

  constructor() {
    this.dbPromise = openDb();
  }

  /** Computes and stamps the checksum, then persists to IndexedDB (falls back to localStorage). */
  async save(payload: Omit<SaveGamePayload, "meta"> & { meta: Omit<SaveGamePayload["meta"], "checksum"> }): Promise<void> {
    const bodyForHash = canonicalize({ ...payload, meta: { ...payload.meta, checksum: "" } });
    const checksum = await sha256Hex(bodyForHash);
    const full: SaveGamePayload = { ...payload, meta: { ...payload.meta, checksum } };
    const serialized = JSON.stringify(full);

    const db = await this.dbPromise;
    if (db) {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(serialized, "current");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }).catch(() => {
        // Fall through to localStorage if the IndexedDB write itself fails mid-flight.
        try {
          localStorage.setItem(LOCAL_STORAGE_KEY, serialized);
        } catch {
          /* storage exhausted — nothing further we can do here */
        }
      });
    } else {
      try {
        localStorage.setItem(LOCAL_STORAGE_KEY, serialized);
      } catch {
        /* storage exhausted */
      }
    }
  }

  async load(): Promise<SaveLoadResult> {
    const db = await this.dbPromise;
    let serialized: string | null = null;

    if (db) {
      serialized = await new Promise<string | null>((resolve) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).get("current");
        req.onsuccess = () => resolve((req.result as string | undefined) ?? null);
        req.onerror = () => resolve(null);
      });
    }
    if (!serialized) {
      serialized = localStorage.getItem(LOCAL_STORAGE_KEY);
    }
    if (!serialized) return { ok: false, reason: "not_found" };

    let payload: SaveGamePayload;
    try {
      payload = JSON.parse(serialized) as SaveGamePayload;
    } catch {
      return { ok: false, reason: "parse_error" };
    }

    if (payload.meta.saveVersion !== SAVE_VERSION) {
      return { ok: false, reason: "version_mismatch" };
    }

    const claimedChecksum = payload.meta.checksum;
    const bodyForHash = canonicalize({ ...payload, meta: { ...payload.meta, checksum: "" } });
    const recomputed = await sha256Hex(bodyForHash);
    if (recomputed !== claimedChecksum) {
      return { ok: false, reason: "checksum_mismatch" };
    }

    return { ok: true, payload };
  }

  async clear(): Promise<void> {
    const db = await this.dbPromise;
    if (db) {
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).delete("current");
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    }
    localStorage.removeItem(LOCAL_STORAGE_KEY);
  }
}
