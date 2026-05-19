/**
 * Synthstudio – useMidiTemplateStore.ts (v3.121.0)
 *
 * Companion-Store für die neue Templates-Library (TemplatesLibrary.tsx).
 * Zwei Aufgaben:
 *  1) **Recently-Used**: Trackt die letzten 5 angewendeten Template-IDs
 *     (Hardware + User). Wird als Quick-Access-Liste im UI angezeigt.
 *  2) **Import/Export**: JSON-Roundtrip von HardwareTemplate-Schema zu/von
 *     einem teilbaren Community-Format. Validiert + warnt bei fehlenden
 *     Feldern, schreibt nicht in den User-Templates-Store direkt (Caller
 *     entscheidet via `saveUserMidiTemplate`).
 *
 * Komplementär zu:
 *   - midiHardwareTemplates.ts (read-only built-in Templates)
 *   - useUserMidiTemplatesStore.ts (User-defined Templates, Save/Load/Rename/Delete)
 *
 * Persistenz: localStorage `ss-midi-templates:v1` (nur recentlyUsed).
 * Singleton-Observer-Pattern (analog useThemeStore, useUserMidiTemplatesStore).
 */
import { useEffect, useReducer } from "react";
import type { MidiMapping, MidiNoteMapping } from "@/hooks/useMidi";
import type {
  HardwareTemplate,
  HardwareTemplateCategory,
} from "@/utils/midiHardwareTemplates";

const STORAGE_KEY = "ss-midi-templates:v1";
const MAX_RECENT = 5;
/** Max-Größe einer importierten JSON-Datei (Sicherheitsschranke). */
export const MAX_IMPORT_BYTES = 32 * 1024;

type Listener = () => void;

interface PersistedState {
  recentlyUsed: string[];
}

let _state: PersistedState = loadFromStorage();
const _listeners = new Set<Listener>();

function loadFromStorage(): PersistedState {
  try {
    if (typeof localStorage === "undefined") return { recentlyUsed: [] };
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { recentlyUsed: [] };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { recentlyUsed: [] };
    const recent = Array.isArray((parsed as { recentlyUsed?: unknown }).recentlyUsed)
      ? ((parsed as { recentlyUsed: unknown[] }).recentlyUsed.filter(
          (x): x is string => typeof x === "string",
        ) as string[])
      : [];
    return { recentlyUsed: recent.slice(0, MAX_RECENT) };
  } catch {
    return { recentlyUsed: [] };
  }
}

function persist(): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_state));
  } catch {
    /* quota / unavailable — ignore */
  }
}

function notify(): void {
  _listeners.forEach((fn) => fn());
}

// ─── Recently-Used API ──────────────────────────────────────────────────────

export function getRecentlyUsed(): string[] {
  return [..._state.recentlyUsed];
}

/**
 * Markiert ein Template als zuletzt verwendet. Bestehende Einträge mit
 * derselben ID werden an die Spitze verschoben (Dedupe). Maximal MAX_RECENT
 * Einträge bleiben gespeichert.
 */
export function markRecentlyUsed(templateId: string): void {
  if (!templateId) return;
  const filtered = _state.recentlyUsed.filter((id) => id !== templateId);
  _state = {
    ..._state,
    recentlyUsed: [templateId, ...filtered].slice(0, MAX_RECENT),
  };
  persist();
  notify();
}

export function clearRecentlyUsed(): void {
  _state = { ..._state, recentlyUsed: [] };
  persist();
  notify();
}

// ─── Import / Export ────────────────────────────────────────────────────────

/** JSON-Format-Version. Bumpen bei breaking changes. */
export const TEMPLATE_EXPORT_VERSION = "v1";

/** Exportierter Template-Eintrag (JSON-Schema). */
export interface ExportedTemplate {
  synthstudioTemplate: string;        // "v1"
  id: string;
  name: string;
  manufacturer: string;
  category: HardwareTemplateCategory;
  description: string;
  tips?: string[];
  ccMappings: Omit<MidiMapping, "label">[];
  noteMappings: Omit<MidiNoteMapping, "label">[];
}

/**
 * Serialisiert ein HardwareTemplate (oder ein eigenes User-Mapping-Set) in
 * den Export-JSON-Dialekt. Pretty-printed damit User die Datei manuell
 * inspizieren können.
 */
export function exportTemplateToJson(t: HardwareTemplate): string {
  const payload: ExportedTemplate = {
    synthstudioTemplate: TEMPLATE_EXPORT_VERSION,
    id: t.id,
    name: t.name,
    manufacturer: t.manufacturer,
    category: t.category,
    description: t.description,
    tips: t.tips,
    ccMappings: t.ccMappings,
    noteMappings: t.noteMappings,
  };
  return JSON.stringify(payload, null, 2);
}

export interface ImportTemplateOk {
  ok: true;
  template: HardwareTemplate;
  warnings?: string[];
}
export interface ImportTemplateErr {
  ok: false;
  error: string;
}
export type ImportTemplateResult = ImportTemplateOk | ImportTemplateErr;

const VALID_CATEGORIES = new Set<HardwareTemplateCategory>([
  "pad-grid",
  "controller",
  "sequencer",
  "drum-machine",
]);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Parsed + validiert JSON-Text. Returnt das geparste HardwareTemplate oder
 * eine Error-Beschreibung. Schema-Check: synthstudioTemplate-Marker, alle
 * required Felder vorhanden, ccMappings + noteMappings sind Arrays.
 */
export function importTemplateFromJson(text: string): ImportTemplateResult {
  if (!text || text.trim().length === 0) {
    return { ok: false, error: "Datei ist leer." };
  }
  if (text.length > MAX_IMPORT_BYTES) {
    return {
      ok: false,
      error: `Datei zu groß: ${text.length} Bytes (max ${MAX_IMPORT_BYTES}).`,
    };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `JSON-Parse-Fehler: ${msg}` };
  }
  if (!isObject(raw)) {
    return { ok: false, error: "Top-Level muss ein Objekt sein." };
  }
  if (raw.synthstudioTemplate !== TEMPLATE_EXPORT_VERSION) {
    return {
      ok: false,
      error: `Fehlender oder falscher "synthstudioTemplate"-Marker (erwartet "${TEMPLATE_EXPORT_VERSION}").`,
    };
  }
  if (typeof raw.id !== "string" || raw.id.length === 0) {
    return { ok: false, error: '"id" fehlt oder ist leer.' };
  }
  if (typeof raw.name !== "string" || raw.name.length === 0) {
    return { ok: false, error: '"name" fehlt oder ist leer.' };
  }
  if (typeof raw.manufacturer !== "string") {
    return { ok: false, error: '"manufacturer" fehlt.' };
  }
  if (typeof raw.description !== "string") {
    return { ok: false, error: '"description" fehlt.' };
  }
  const warnings: string[] = [];
  let category: HardwareTemplateCategory = "controller";
  if (typeof raw.category === "string" && VALID_CATEGORIES.has(raw.category as HardwareTemplateCategory)) {
    category = raw.category as HardwareTemplateCategory;
  } else {
    warnings.push(
      `Unbekannte Kategorie "${String(raw.category)}" — fällt zurück auf "controller".`,
    );
  }
  if (!Array.isArray(raw.ccMappings)) {
    return { ok: false, error: '"ccMappings" muss ein Array sein.' };
  }
  if (!Array.isArray(raw.noteMappings)) {
    return { ok: false, error: '"noteMappings" muss ein Array sein.' };
  }
  const tips = Array.isArray(raw.tips)
    ? raw.tips.filter((s): s is string => typeof s === "string")
    : undefined;

  const template: HardwareTemplate = {
    id: raw.id,
    name: raw.name,
    manufacturer: raw.manufacturer,
    category,
    description: raw.description,
    tips,
    ccMappings: raw.ccMappings as Omit<MidiMapping, "label">[],
    noteMappings: raw.noteMappings as Omit<MidiNoteMapping, "label">[],
  };

  return warnings.length > 0
    ? { ok: true, template, warnings }
    : { ok: true, template };
}

// ─── Test-Hook ──────────────────────────────────────────────────────────────

/** Reset für Tests. */
export function __resetMidiTemplateStoreForTests(): void {
  _state = { recentlyUsed: [] };
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* ignore */
  }
  notify();
}

// ─── React-Hook ─────────────────────────────────────────────────────────────

/** Returnt die `recentlyUsed`-Liste reaktiv. */
export function useMidiTemplateStore(): { recentlyUsed: string[] } {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => {
      _listeners.delete(rerender);
    };
  }, []);
  return { recentlyUsed: _state.recentlyUsed };
}
