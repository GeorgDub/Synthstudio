/**
 * Synthstudio – usePluginChainPresetStore (v3.47.0)
 *
 * Library für gespeicherte Plugin-Chain-Presets pro Channel. Schließt die
 * letzte verbleibende v3.45-Caveat: User kann eine konfigurierte Plugin-
 * Chain (max 4 Slots) unter einem Namen ablegen und auf andere Channels
 * "loaden". Default-Inhalt sind 3 Built-In-Presets damit User die Funktion
 * auch ohne eigenes Setup ausprobieren können.
 *
 * v3.47.0 — Plugin-Preset JSON-Sharing (closes v3.46-Caveat).
 *   - exportPresetAsJson(presetId) → string mit envelope-wrapped Preset
 *   - exportAllPresetsAsJson()      → Array of envelope-wrapped Presets
 *   - importPresetFromJson(json)    → validates + dedupliziert via name+slot-hash
 *     - Missing-Plugin Handling: importiert mit warning; fehlende Plugin-Slots
 *       werden NICHT gestrippt (Slot bleibt, UI zeigt "Plugin nicht gefunden").
 *       Hintergrund: User soll wissen welcher Slot fehlt; entfernt er das
 *       Plugin später, wird der Slot ohnehin unsichtbar (Render-Defensive).
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
import { getPlugin as getRegisteredPlugin } from "@/audio/PluginRegistry";

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

// ─── v3.47.0: JSON-Sharing (Export/Import) ──────────────────────────────────
//
// Envelope-Format: { schema: "synthstudio-plugin-preset-v1", preset: {...} }
// Beim Bulk-Export: { schema: "synthstudio-plugin-preset-bundle-v1", presets: [...] }
//
// Datei-Endung: `.synthpreset.json` (vom Drag-Drop-Dispatcher geroutet).

/** Schema-Identifier für einzelne Presets (Round-Trip-stable). */
export const PRESET_EXPORT_SCHEMA = "synthstudio-plugin-preset-v1" as const;

/** Schema-Identifier für Bulk-Export (Array of Presets). */
export const PRESET_BUNDLE_SCHEMA = "synthstudio-plugin-preset-bundle-v1" as const;

export interface PluginPresetExportEnvelope {
  schema: typeof PRESET_EXPORT_SCHEMA;
  preset: PluginChainPreset;
  /** Optional: app-version für Debug. */
  appVersion?: string;
}

export interface PluginPresetBundleEnvelope {
  schema: typeof PRESET_BUNDLE_SCHEMA;
  presets: PluginChainPreset[];
  appVersion?: string;
}

export interface PluginPresetImportResult {
  /** True wenn mindestens ein Preset importiert wurde. */
  success: boolean;
  /** IDs der neu erzeugten Presets (Cardinality = imported count). */
  importedIds: string[];
  /** Strukturfehler — Schema-Mismatch, fehlende Felder etc. */
  errors: string[];
  /** Soft-Warnings — z.B. fehlende Plugin-IDs, Trim auf MAX. */
  warnings: string[];
  /** Anzahl Duplikate die übersprungen wurden. */
  duplicatesSkipped: number;
}

/**
 * Liefert den serialisierten Preset (envelope-wrapped) als JSON-String.
 * Wirft NICHT — liefert "" bei unbekannter ID.
 */
export function exportPresetAsJson(presetId: string): string {
  const preset = getPluginChainPresetById(presetId);
  if (!preset) return "";
  const envelope: PluginPresetExportEnvelope = {
    schema: PRESET_EXPORT_SCHEMA,
    preset: {
      ...preset,
      slots: preset.slots.map(cloneSlot),
    },
  };
  return JSON.stringify(envelope, null, 2);
}

/**
 * Liefert ALLE Presets (Built-In + User) als JSON-Bundle. Nützlich für
 * Backup / Migration zwischen Installationen.
 */
export function exportAllPresetsAsJson(): string {
  const envelope: PluginPresetBundleEnvelope = {
    schema: PRESET_BUNDLE_SCHEMA,
    presets: _presets.map((p) => ({
      ...p,
      slots: p.slots.map(cloneSlot),
    })),
  };
  return JSON.stringify(envelope, null, 2);
}

/**
 * Pure-fn: deterministischer Hash über Slot-Inhalt (für Dedup-Heuristik).
 * Identische Chains liefern identischen Hash — independent von User-Slot-
 * Reihenfolge zwischen Installationen ist hier *nicht* gewünscht, weil
 * Slot-Order audio-relevant ist.
 */
export function hashPresetSlots(slots: MixerPluginSlot[]): string {
  const parts: string[] = [];
  for (const s of slots) {
    const paramPairs = Object.keys(s.params)
      .sort()
      .map((k) => `${k}=${s.params[k]}`)
      .join(",");
    parts.push(`${s.pluginId}|${paramPairs}|${s.bypassed === true ? "1" : "0"}`);
  }
  return parts.join(";");
}

/**
 * Validates und importiert einen JSON-String. Akzeptiert sowohl Single-
 * Preset-Envelope als auch Bundle-Envelope.
 *
 * Dedupliziert über (name + slot-hash): identische Chains mit gleichem
 * Namen werden NICHT doppelt gespeichert — der User bekommt eine warning.
 *
 * Missing-Plugin-Handling: Slots referenzieren `pluginId`-Strings. Wenn
 * eine ID nicht in der lokalen PluginRegistry registriert ist, bleibt der
 * Slot trotzdem im Preset (für späteren Re-Install). UI-Hinweis via warning.
 */
export function importPresetFromJson(jsonString: string): PluginPresetImportResult {
  const result: PluginPresetImportResult = {
    success: false,
    importedIds: [],
    errors: [],
    warnings: [],
    duplicatesSkipped: 0,
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch (e) {
    result.errors.push(
      `JSON-Parse-Fehler: ${e instanceof Error ? e.message : String(e)}`,
    );
    return result;
  }

  if (!parsed || typeof parsed !== "object") {
    result.errors.push("Envelope ist kein Objekt");
    return result;
  }

  const env = parsed as Record<string, unknown>;
  let candidatePresets: unknown[] = [];

  if (env.schema === PRESET_EXPORT_SCHEMA) {
    if (!env.preset) {
      result.errors.push("Single-Envelope ohne 'preset'-Feld");
      return result;
    }
    candidatePresets = [env.preset];
  } else if (env.schema === PRESET_BUNDLE_SCHEMA) {
    if (!Array.isArray(env.presets)) {
      result.errors.push("Bundle-Envelope ohne 'presets'-Array");
      return result;
    }
    candidatePresets = env.presets;
  } else {
    result.errors.push(
      `Unbekanntes Schema: "${String(env.schema)}". Erwartet: ${PRESET_EXPORT_SCHEMA} oder ${PRESET_BUNDLE_SCHEMA}`,
    );
    return result;
  }

  // Pro Kandidat: sanitize → Plugin-Lookup → Dedup → addPluginChainPreset.
  const existing = _presets;
  for (const raw of candidatePresets) {
    const sanitized = sanitizePreset(raw);
    if (!sanitized) {
      result.errors.push("Ein Preset ist strukturell ungültig (skip)");
      continue;
    }

    // Built-Ins können beim Import nicht überschrieben werden — sie bleiben
    // code-controlled. Wenn der Import ein Built-In meint, normalisieren wir
    // den Namen damit es als User-Variante landet.
    let nameToUse = sanitized.name;
    if (sanitized.builtIn === true) {
      nameToUse = `${sanitized.name} (imported)`;
      result.warnings.push(
        `Built-In "${sanitized.name}" als User-Preset importiert`,
      );
    }

    // Missing-Plugin-Check (warnings only, kein Skip)
    const missing = sanitized.slots
      .map((s) => s.pluginId)
      .filter((id) => !getRegisteredPlugin(id));
    if (missing.length > 0) {
      // dedupe message list
      const uniqueMissing = Array.from(new Set(missing));
      for (const id of uniqueMissing) {
        result.warnings.push(
          `Plugin "${id}" nicht gefunden — Slot wird beim Anwenden übersprungen`,
        );
      }
    }

    // Dedup: same name + same slot-hash → skip
    const incomingHash = hashPresetSlots(sanitized.slots);
    const duplicate = existing.find(
      (p) =>
        p.name === nameToUse && hashPresetSlots(p.slots) === incomingHash,
    );
    if (duplicate) {
      result.duplicatesSkipped += 1;
      result.warnings.push(`Duplikat übersprungen: "${nameToUse}"`);
      continue;
    }

    const newId = addPluginChainPreset(nameToUse, sanitized.slots);
    if (newId) {
      result.importedIds.push(newId);
    } else {
      result.errors.push(
        `Preset "${nameToUse}" konnte nicht gespeichert werden (Storage-Limit?)`,
      );
    }
  }

  result.success = result.importedIds.length > 0;
  return result;
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
