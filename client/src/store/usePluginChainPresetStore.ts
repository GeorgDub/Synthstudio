/**
 * Synthstudio – usePluginChainPresetStore (v3.46.0)
 *
 * Library für gespeicherte Plugin-Chain-Presets pro Channel. Schließt die
 * letzte verbleibende v3.45-Caveat: User kann eine konfigurierte Plugin-
 * Chain (max 4 Slots) unter einem Namen ablegen und auf andere Channels
 * "loaden". Default-Inhalt sind 3 Built-In-Presets damit User die Funktion
 * auch ohne eigenes Setup ausprobieren können.
 *
 * Custom-Observer-Pattern (Modul-Singleton + React-Hook), konsistent mit
 * usePatchStore / useSceneStore. Persistenz: localStorage Key
 * "ss-plugin-chain-presets:v1".
 *
 * Datenstruktur:
 *   PluginChainPreset {
 *     id: string;          // nano-id-like, sortierbar
 *     name: string;        // User-facing label
 *     createdAt: number;   // ms epoch
 *     builtIn?: true;      // gesperrt gegen rename/remove
 *     slots: MixerPluginSlot[]; // max 4 (MAX_PLUGIN_SLOTS_PER_CHANNEL)
 *   }
 *
 * Isomorphic: läuft im Browser, in Node (Tests) und in Electron.
 */

import { useEffect, useReducer } from "react";
import {
  MAX_PLUGIN_SLOTS_PER_CHANNEL,
  type MixerPluginSlot,
} from "./useMixerStore";

export interface PluginChainPreset {
  id: string;
  name: string;
  createdAt: number;
  builtIn?: boolean;
  slots: MixerPluginSlot[];
}

const STORAGE_KEY = "ss-plugin-chain-presets:v1";
const MAX_PRESETS = 50;

// ─── Built-In Presets ────────────────────────────────────────────────────────
// Drei Beispiele, die typische Mixing-Use-Cases abdecken. IDs starten mit
// "builtin." damit sie nie mit User-Presets kollidieren.

export const BUILT_IN_TAPE_WARMTH: PluginChainPreset = {
  id: "builtin.tape-warmth",
  name: "Tape-Warmth",
  createdAt: 0,
  builtIn: true,
  slots: [
    // Sanftes Sättigen + Notch flach für analog-tape Färbung
    {
      pluginId: "synthstudio.tape-sat",
      params: { drive: 0.65, mix: 0.9 },
      bypassed: false,
    },
    {
      pluginId: "synthstudio.notch",
      params: { frequency: 6000, q: 1.5, mix: 0.4 },
      bypassed: false,
    },
  ],
};

export const BUILT_IN_STEREO_WIDE: PluginChainPreset = {
  id: "builtin.stereo-wide",
  name: "Stereo-Wide",
  createdAt: 0,
  builtIn: true,
  slots: [
    {
      pluginId: "synthstudio.width",
      params: { width: 1.6 },
      bypassed: false,
    },
  ],
};

export const BUILT_IN_BASS_CUT: PluginChainPreset = {
  id: "builtin.bass-cut",
  name: "Bass-Cut",
  createdAt: 0,
  builtIn: true,
  slots: [
    {
      pluginId: "synthstudio.notch",
      params: { frequency: 80, q: 4.0, mix: 1.0 },
      bypassed: false,
    },
    {
      pluginId: "synthstudio.tape-sat",
      params: { drive: 0.2, mix: 0.5 },
      bypassed: false,
    },
  ],
};

export const BUILT_IN_PLUGIN_CHAIN_PRESETS: PluginChainPreset[] = [
  BUILT_IN_TAPE_WARMTH,
  BUILT_IN_STEREO_WIDE,
  BUILT_IN_BASS_CUT,
];

// ─── Module-State ────────────────────────────────────────────────────────────

let _presets: PluginChainPreset[] = loadInitial();
const _listeners = new Set<() => void>();

function notify(): void {
  _listeners.forEach((l) => l());
}

function isLocalStorageAvailable(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage !== null;
  } catch {
    return false;
  }
}

function sanitizeSlot(raw: unknown): MixerPluginSlot | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<MixerPluginSlot>;
  if (typeof s.pluginId !== "string" || s.pluginId.length === 0) return null;
  return {
    pluginId: s.pluginId,
    params:
      s.params && typeof s.params === "object"
        ? { ...(s.params as Record<string, number>) }
        : {},
    bypassed: s.bypassed === true,
  };
}

function sanitizePreset(raw: unknown): PluginChainPreset | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Partial<PluginChainPreset> & { slots?: unknown };
  if (typeof p.id !== "string" || p.id.length === 0) return null;
  if (typeof p.name !== "string" || p.name.length === 0) return null;
  const createdAt =
    typeof p.createdAt === "number" && Number.isFinite(p.createdAt)
      ? p.createdAt
      : Date.now();
  const slotsRaw = Array.isArray(p.slots) ? p.slots : [];
  const cleanedSlots = slotsRaw
    .map(sanitizeSlot)
    .filter((s): s is MixerPluginSlot => s !== null)
    .slice(0, MAX_PLUGIN_SLOTS_PER_CHANNEL);
  return {
    id: p.id,
    name: p.name,
    createdAt,
    builtIn: p.builtIn === true ? true : undefined,
    slots: cleanedSlots,
  };
}

function loadInitial(): PluginChainPreset[] {
  const presets: PluginChainPreset[] = [];
  // Built-Ins zuerst — werden bei jedem Boot wieder erzeugt damit User die
  // nicht versehentlich verlieren können (kein "wir laden sie aus dem
  // Storage" Pfad — sie sind in Code definiert, immer aktuell).
  for (const builtIn of BUILT_IN_PLUGIN_CHAIN_PRESETS) {
    presets.push({ ...builtIn, slots: builtIn.slots.map(cloneSlot) });
  }
  try {
    if (!isLocalStorageAvailable()) return presets;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return presets;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return presets;
    const builtInIds = new Set(
      BUILT_IN_PLUGIN_CHAIN_PRESETS.map((p) => p.id),
    );
    for (const item of parsed) {
      const s = sanitizePreset(item);
      // Skip wenn ID einer Built-In gehört (built-ins sind code-controlled).
      if (s && !builtInIds.has(s.id)) {
        presets.push(s);
      }
    }
    return presets.slice(0, MAX_PRESETS);
  } catch {
    return presets;
  }
}

function cloneSlot(slot: MixerPluginSlot): MixerPluginSlot {
  return {
    pluginId: slot.pluginId,
    params: { ...slot.params },
    bypassed: slot.bypassed === true,
  };
}

function persist(): void {
  try {
    if (!isLocalStorageAvailable()) return;
    // Nur User-Presets persistieren — Built-Ins werden aus Code wiederhergestellt.
    const userPresets = _presets.filter((p) => !p.builtIn);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(userPresets));
  } catch {
    // Quota / privacy-mode — best effort.
  }
}

function makeId(): string {
  // Einfacher monotoner ID-Generator. Nicht kryptographisch — genügt für lokale
  // Library-Presets. Lokal eindeutig dank Date.now()+random suffix.
  return `preset.${Date.now()}.${Math.floor(Math.random() * 1e6).toString(36)}`;
}

// ─── Public-API ──────────────────────────────────────────────────────────────

/** Liefert alle Presets (Built-In + User). */
export function getPluginChainPresets(): PluginChainPreset[] {
  return _presets;
}

export function getPluginChainPresetById(
  id: string,
): PluginChainPreset | undefined {
  return _presets.find((p) => p.id === id);
}

/**
 * Speichert eine Chain als Preset. Wird normalisiert (clone der slots,
 * trim auf MAX_PLUGIN_SLOTS_PER_CHANNEL). Liefert die generierte Preset-ID.
 */
export function addPluginChainPreset(
  name: string,
  slots: MixerPluginSlot[],
): string | null {
  const trimmedName = name.trim();
  if (!trimmedName) return null;
  if (!Array.isArray(slots) || slots.length === 0) return null;

  const cleaned = slots
    .map(sanitizeSlot)
    .filter((s): s is MixerPluginSlot => s !== null)
    .slice(0, MAX_PLUGIN_SLOTS_PER_CHANNEL);
  if (cleaned.length === 0) return null;

  const preset: PluginChainPreset = {
    id: makeId(),
    name: trimmedName,
    createdAt: Date.now(),
    slots: cleaned,
  };

  // User-Presets vorn anhängen — Built-Ins behalten ihre Position.
  const builtIns = _presets.filter((p) => p.builtIn);
  const userPresets = _presets.filter((p) => !p.builtIn);
  _presets = [...builtIns, preset, ...userPresets].slice(0, MAX_PRESETS);

  persist();
  notify();
  return preset.id;
}

/**
 * Entfernt ein User-Preset. Built-In-Presets können nicht entfernt werden
 * (NO-OP — defensive: User kann nicht versehentlich Code-Defaults killen).
 */
export function removePluginChainPreset(id: string): boolean {
  const existing = _presets.find((p) => p.id === id);
  if (!existing || existing.builtIn) return false;
  _presets = _presets.filter((p) => p.id !== id);
  persist();
  notify();
  return true;
}

/** Renamed ein User-Preset. Built-In bleibt unverändert. */
export function renamePluginChainPreset(id: string, name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  let changed = false;
  _presets = _presets.map((p) => {
    if (p.id === id && !p.builtIn && p.name !== trimmed) {
      changed = true;
      return { ...p, name: trimmed };
    }
    return p;
  });
  if (changed) {
    persist();
    notify();
  }
  return changed;
}

/** Liefert das Slot-Array eines Presets — bereit zum Apply. */
export function cloneSlotsFromPreset(id: string): MixerPluginSlot[] | null {
  const preset = getPluginChainPresetById(id);
  if (!preset) return null;
  return preset.slots.map(cloneSlot);
}

/** Test-Helper: setzt den Store zurück auf nur die Built-Ins. */
export function __resetPluginChainPresetStoreForTests(): void {
  _presets = BUILT_IN_PLUGIN_CHAIN_PRESETS.map((p) => ({
    ...p,
    slots: p.slots.map(cloneSlot),
  }));
  try {
    if (isLocalStorageAvailable()) localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  notify();
}

// ─── React-Hook ──────────────────────────────────────────────────────────────

export function usePluginChainPresetStore(): {
  presets: PluginChainPreset[];
} {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => {
      _listeners.delete(rerender);
    };
  }, []);
  return { presets: _presets };
}
