/**
 * Synthstudio – useQuickActionStore (v3.68.0)
 *
 * Quick-Action Macros: vom User definierte Multi-Action-Shortcuts.
 *
 * Unterscheidet sich vom existierenden useMacroStore (8 Knob-/Button-
 * Makros mit fester Slot-Anzahl). Hier sind Quick-Action-Macros eine
 * frei wachsende Liste von sequenziellen Action-Listen, die per
 * Keyboard-Shortcut getriggert werden — DAW-Standard "macro recorder
 * + custom shortcut".
 *
 * State:
 *   - macros: QuickActionMacro[]
 *
 * Persistenz:
 *   - localStorage "ss-quick-action-macros:v1"
 *
 * Beispiel: "Mute all drums + set reverb 50% + jump to pattern B"
 *   = MacroAction[] sequenziell ausgeführt mit optionalen Delays.
 */
import { useEffect, useReducer } from "react";

const STORAGE_KEY = "ss-quick-action-macros:v1";

// ─── Action-Typen ────────────────────────────────────────────────────────────

/**
 * Discriminated Union aller unterstützten Action-Typen.
 *
 * Jede Action-Kind hat ihre eigenen Felder + optional ein Delay über
 * eine separate `{kind:"delay"}` Action (sequenziell zwischen den
 * eigentlichen Actions).
 *
 * Kind-Liste (v3.68.0):
 *   1. mute-all-drum-parts       — Alle Drum-Parts (un-)muten
 *   2. set-channel-volume        — Volume eines Kanals setzen
 *   3. set-channel-pan           — Pan eines Kanals setzen
 *   4. set-channel-mute          — Mute eines einzelnen Kanals
 *   5. switch-pattern            — Aktives Pattern wechseln
 *   6. set-bpm                   — BPM setzen
 *   7. trigger-scene             — Scene per Index abfeuern
 *   8. play-pad                  — Performance-Pad per Index queuen
 *   9. set-master-volume         — Master-Volume
 *  10. delay                     — Wartet `ms` Millisekunden (sequenzierungs-Helper)
 */
export type QuickActionMacroAction =
  | { kind: "mute-all-drum-parts"; value: boolean }
  | { kind: "set-channel-volume"; channelId: string; value: number }
  | { kind: "set-channel-pan"; channelId: string; value: number }
  | { kind: "set-channel-mute"; channelId: string; value: boolean }
  | { kind: "switch-pattern"; patternId: string }
  | { kind: "set-bpm"; bpm: number }
  | { kind: "trigger-scene"; sceneIndex: number }
  | { kind: "play-pad"; padIndex: number }
  | { kind: "set-master-volume"; value: number }
  | { kind: "delay"; ms: number };

export type QuickActionKind = QuickActionMacroAction["kind"];

/** Alle bekannten Action-Kinds (auch für UI-Dropdowns nutzbar). */
export const QUICK_ACTION_KINDS: QuickActionKind[] = [
  "mute-all-drum-parts",
  "set-channel-volume",
  "set-channel-pan",
  "set-channel-mute",
  "switch-pattern",
  "set-bpm",
  "trigger-scene",
  "play-pad",
  "set-master-volume",
  "delay",
];

// ─── Macro-Typ ───────────────────────────────────────────────────────────────

export interface QuickActionMacro {
  id: string;
  name: string;
  description?: string;
  /**
   * Tastatur-Shortcut zum Triggern. Format: lowercased key, optional mit
   * "ctrl+", "shift+", "alt+", "meta+" Präfixen.
   * Beispiele: "d", "shift+1", "ctrl+alt+r".
   * `undefined` = nicht an Keyboard gebunden (nur manuell triggerbar).
   */
  keybind?: string;
  actions: QuickActionMacroAction[];
  createdAt: number;
}

type Listener = () => void;

// ─── Persistenz / Defaults ───────────────────────────────────────────────────

function makeId(): string {
  return `qam-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Built-in Macros (pre-installed beim ersten Laden).
 * Werden NUR initial geladen — User kann sie löschen/anpassen, sie tauchen
 * nicht wieder auf.
 */
export function builtInQuickActionMacros(): QuickActionMacro[] {
  const now = Date.now();
  return [
    {
      id: "builtin-mute-drums",
      name: "Mute All Drums",
      description: "Mute alle Drum-Parts auf einen Schlag.",
      keybind: "shift+d",
      actions: [{ kind: "mute-all-drum-parts", value: true }],
      createdAt: now,
    },
    {
      id: "builtin-unmute-drums",
      name: "Unmute All Drums",
      description: "Hebt Mute-All wieder auf.",
      keybind: "shift+u",
      actions: [{ kind: "mute-all-drum-parts", value: false }],
      createdAt: now + 1,
    },
    {
      id: "builtin-reset-fx",
      name: "Reset Master Volume",
      description: "Master-Volume auf 0.8 zurücksetzen.",
      keybind: "shift+r",
      actions: [{ kind: "set-master-volume", value: 0.8 }],
      createdAt: now + 2,
    },
  ];
}

function isValidAction(raw: unknown): raw is QuickActionMacroAction {
  if (!raw || typeof raw !== "object") return false;
  const a = raw as { kind?: unknown } & Record<string, unknown>;
  if (typeof a.kind !== "string") return false;
  switch (a.kind) {
    case "mute-all-drum-parts":
      return typeof a.value === "boolean";
    case "set-channel-volume":
    case "set-channel-pan":
      return typeof a.channelId === "string" && typeof a.value === "number";
    case "set-channel-mute":
      return typeof a.channelId === "string" && typeof a.value === "boolean";
    case "switch-pattern":
      return typeof a.patternId === "string";
    case "set-bpm":
      return typeof a.bpm === "number" && a.bpm > 0;
    case "trigger-scene":
      return typeof a.sceneIndex === "number" && Number.isInteger(a.sceneIndex) && a.sceneIndex >= 0;
    case "play-pad":
      return typeof a.padIndex === "number" && Number.isInteger(a.padIndex) && a.padIndex >= 0;
    case "set-master-volume":
      return typeof a.value === "number";
    case "delay":
      return typeof a.ms === "number" && a.ms >= 0;
    default:
      return false;
  }
}

function isValidMacro(raw: unknown): raw is QuickActionMacro {
  if (!raw || typeof raw !== "object") return false;
  const m = raw as Partial<QuickActionMacro>;
  if (typeof m.id !== "string" || typeof m.name !== "string") return false;
  if (!Array.isArray(m.actions)) return false;
  if (typeof m.createdAt !== "number") return false;
  return m.actions.every(isValidAction);
}

/**
 * Public Validator-Export (v3.69.0). Wird vom projectSerializer beim
 * Lade-Pfad genutzt, damit nur valide Macros aus dem .synth-File in den
 * Store wandern. Identisch zur Internal-Variante.
 */
export function isValidQuickActionMacro(raw: unknown): raw is QuickActionMacro {
  return isValidMacro(raw);
}

function load(): QuickActionMacro[] {
  try {
    const raw = (typeof localStorage !== "undefined")
      ? localStorage.getItem(STORAGE_KEY)
      : null;
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter(isValidMacro);
      }
    }
  } catch { /* ignore */ }
  // Erste Initialisierung: Built-ins ablegen.
  const defaults = builtInQuickActionMacros();
  persist(defaults);
  return defaults;
}

function persist(macros: QuickActionMacro[]): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(macros));
    }
  } catch { /* ignore */ }
}

let _macros: QuickActionMacro[] = load();
const _listeners = new Set<Listener>();

function notify(): void {
  _listeners.forEach((l) => l());
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function getQuickActionMacros(): QuickActionMacro[] {
  return _macros;
}

export function addQuickActionMacro(input: {
  name: string;
  description?: string;
  keybind?: string;
  actions?: QuickActionMacroAction[];
}): QuickActionMacro {
  const macro: QuickActionMacro = {
    id: makeId(),
    name: input.name,
    description: input.description,
    keybind: normalizeKeybind(input.keybind),
    actions: input.actions ?? [],
    createdAt: Date.now(),
  };
  _macros = [..._macros, macro];
  persist(_macros);
  notify();
  return macro;
}

export function updateQuickActionMacro(
  id: string,
  changes: Partial<Pick<QuickActionMacro, "name" | "description" | "keybind" | "actions">>,
): void {
  _macros = _macros.map((m) => {
    if (m.id !== id) return m;
    const next: QuickActionMacro = { ...m };
    if (changes.name !== undefined) next.name = changes.name;
    if ("description" in changes) next.description = changes.description;
    if ("keybind" in changes) next.keybind = normalizeKeybind(changes.keybind);
    if (changes.actions !== undefined) next.actions = changes.actions.filter(isValidAction);
    return next;
  });
  persist(_macros);
  notify();
}

export function removeQuickActionMacro(id: string): void {
  _macros = _macros.filter((m) => m.id !== id);
  persist(_macros);
  notify();
}

export function reorderQuickActionMacro(
  macroId: string,
  fromIndex: number,
  toIndex: number,
): void {
  const macro = _macros.find((m) => m.id === macroId);
  if (!macro) return;
  if (
    fromIndex < 0 ||
    fromIndex >= macro.actions.length ||
    toIndex < 0 ||
    toIndex >= macro.actions.length ||
    fromIndex === toIndex
  ) return;
  const actions = [...macro.actions];
  const [item] = actions.splice(fromIndex, 1);
  actions.splice(toIndex, 0, item);
  updateQuickActionMacro(macroId, { actions });
}

export function resetQuickActionMacros(): void {
  _macros = builtInQuickActionMacros();
  persist(_macros);
  notify();
}

/**
 * Bulk-Replacement aller Macros (v3.69.0, Project-Restore-Pfad).
 * Wird vom App.tsx restoreProject-Callback gerufen wenn das .synth-File
 * Macros enthält (Schema v1.25+). Invalide Einträge werden silent gefiltert.
 * Leerer Array → leere Macro-Liste (User-Intent "keine Macros").
 */
export function setAllQuickActionMacros(list: unknown[]): void {
  const filtered = Array.isArray(list) ? list.filter(isValidMacro) : [];
  _macros = filtered as QuickActionMacro[];
  persist(_macros);
  notify();
}

export function __resetQuickActionStoreForTests(): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
  _macros = builtInQuickActionMacros();
  persist(_macros);
  notify();
}

// ─── Keybind-Matching (pur, getestet) ────────────────────────────────────────

/**
 * Normalisiert einen Keybind-String: lower-case + sortierte Modifier vorne.
 * `undefined`/leerer String → undefined (= ungebunden).
 *
 * Beispiele:
 *   "D"            → "d"
 *   "Ctrl+Shift+R" → "ctrl+shift+r"
 *   "shift+ctrl+r" → "ctrl+shift+r"
 */
export function normalizeKeybind(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const trimmed = input.trim().toLowerCase();
  if (trimmed.length === 0) return undefined;
  const parts = trimmed.split("+").map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length === 0) return undefined;
  const mods = new Set<string>();
  let key: string | undefined;
  for (const p of parts) {
    if (p === "ctrl" || p === "control") mods.add("ctrl");
    else if (p === "shift") mods.add("shift");
    else if (p === "alt" || p === "option") mods.add("alt");
    else if (p === "meta" || p === "cmd" || p === "command") mods.add("meta");
    else key = p;
  }
  if (!key) return undefined;
  const orderedMods: string[] = [];
  if (mods.has("ctrl")) orderedMods.push("ctrl");
  if (mods.has("shift")) orderedMods.push("shift");
  if (mods.has("alt")) orderedMods.push("alt");
  if (mods.has("meta")) orderedMods.push("meta");
  return [...orderedMods, key].join("+");
}

/**
 * Baut den normalisierten Keybind-String aus einem KeyboardEvent.
 * Single-char-Keys werden lower-cased; benannte Keys (z.B. "ArrowUp") bleiben
 * lower-case dargestellt.
 */
export function eventToKeybind(e: KeyboardEvent): string {
  const rawKey = e.key;
  const key = rawKey.length === 1 ? rawKey.toLowerCase() : rawKey.toLowerCase();
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("ctrl");
  if (e.shiftKey) parts.push("shift");
  if (e.altKey) parts.push("alt");
  if (e.metaKey) parts.push("meta");
  parts.push(key);
  return parts.join("+");
}

/**
 * Sucht das Macro, das mit dem gegebenen Keybind übereinstimmt.
 * Pure-Helper für `useQuickActionKeyBindings` + Tests.
 */
export function findMacroForKeybind(
  macros: QuickActionMacro[],
  keybind: string,
): QuickActionMacro | null {
  const normalized = normalizeKeybind(keybind);
  if (!normalized) return null;
  for (const m of macros) {
    if (m.keybind && m.keybind === normalized) return m;
  }
  return null;
}

// ─── React-Hook ──────────────────────────────────────────────────────────────

export function useQuickActionStore(): { macros: QuickActionMacro[] } {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => { _listeners.delete(rerender); };
  }, []);
  return { macros: _macros };
}
