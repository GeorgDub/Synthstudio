/**
 * Synthstudio – useMacroStore
 *
 * 8 Makro-Knöpfe die beliebig viele Parameter gleichzeitig steuern.
 * Jede Binding mappt einen Makro-Wert (0–1) auf einen Parameter-Bereich.
 *
 * Target-Typen:
 *  "channel-vol"   → Kanal-Volume (partId)
 *  "channel-pan"   → Kanal-Pan (partId)
 *  "channel-send"  → Send-Level (partId + bus)
 *  "master-vol"    → Master-Volume
 *  "bpm"           → BPM (mapped auf min-max Bereich)
 *  "lfo-rate"      → LFO-Rate eines Synth-Parts (partId)
 *  "lfo-depth"     → LFO-Tiefe eines Synth-Parts (partId)
 */
import { useEffect, useReducer } from "react";

const STORAGE_KEY = "ss-macros:v1";
export const MACRO_COUNT = 8;

export type MacroTargetType =
  | "channel-vol"
  | "channel-pan"
  | "channel-send-rev"
  | "channel-send-dly"
  | "master-vol"
  | "bpm"
  | "lfo-rate"
  | "lfo-depth";

export interface MacroBinding {
  id: string;
  target: MacroTargetType;
  /** Für channel-* Targets: die Part-ID */
  partId?: string;
  partName?: string;
  /** Wertebereich der Binding */
  minValue: number;
  maxValue: number;
}

/**
 * Makro-Modus:
 *  - "knob"   → klassischer Slider/Knob (0..1), triggert Audio-Bindings
 *  - "button" → großer Button, triggert ein Skript (scriptId) per Edge
 *
 * Default ist "knob" (Backwards-Compat zu pre-v1.16 Daten ohne `mode`-Feld).
 */
export type MacroMode = "knob" | "button";

/**
 * Wie das Skript/Pad getriggert wird, wenn `mode === "button"`:
 *  - "edge" → einmaliger Run pro Press (mouseDown bzw. tastendruck-äquivalent)
 *  - "hold" → re-fire solange gehalten (Script: 200ms-Loop, Pad: 100ms-Loop;
 *            App.tsx hört auf `macro:button:trigger` zum Start und
 *            `macro:button:release` zum Stop)
 */
export type MacroTriggerMode = "edge" | "hold";

/**
 * Was der Button im `mode === "button"` triggert (v1.20+ discriminated union):
 *  - "script" → führt das per `scriptId` referenzierte Skript aus (klassisch seit v1.17)
 *  - "pad"    → queued/triggert den Performance-Pad an `padIndex` (v1.20.x)
 *
 * Default "script" (Backwards-Compat zu pre-v1.20 Daten ohne `triggerKind`-Feld).
 */
export type MacroTriggerKind = "script" | "pad";

export interface Macro {
  index: number;   // 0–7
  label: string;
  value: number;   // 0–1 (aktueller Makro-Wert)
  bindings: MacroBinding[];
  color: string;
  /** Default "knob" wenn fehlt (Migration aus pre-v1.16 localStorage). */
  mode: MacroMode;
  /** Gesetzt wenn mode === "button" + triggerKind === "script". Verweis auf Script aus useScriptStore. */
  scriptId?: string;
  /** Was der Button triggert. Default "script" (Backwards-Compat zu v1.17-Daten). */
  triggerKind?: MacroTriggerKind;
  /** Gesetzt wenn mode === "button" + triggerKind === "pad". Pad-Index 0..15 in usePerformanceStore. */
  padIndex?: number;
  /**
   * Default "edge" wenn fehlt. v1.22.0: "hold" implementiert (re-fire-Loop in App.tsx).
   *  - "edge": single-shot bei mouseDown
   *  - "hold": loop solange Button gedrückt (Stop via `macro:button:release`)
   */
  triggerMode?: MacroTriggerMode;
}

export const MACRO_COLORS = [
  "#f59e0b", "#06b6d4", "#10b981", "#f43f5e",
  "#a855f7", "#ff6b35", "#0ea5e9", "#84cc16",
];

/**
 * Anzahl Performance-Pads (muss mit usePerformanceStore.PAD_COUNT übereinstimmen).
 * Inline statt Import, um Cycle-Risk zu vermeiden — useMacroStore wird sehr früh geladen.
 */
const PAD_COUNT = 16;

type Listener = () => void;

function makeBindingId() { return `mb-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`; }

function defaultMacros(): Macro[] {
  return Array.from({ length: MACRO_COUNT }, (_, i) => ({
    index: i,
    label: `Macro ${i + 1}`,
    value: 0,
    bindings: [],
    color: MACRO_COLORS[i % MACRO_COLORS.length],
    mode: "knob" as MacroMode,
    triggerKind: "script" as MacroTriggerKind,
    triggerMode: "edge" as MacroTriggerMode,
  }));
}

/**
 * Migriert ein Macro-Objekt aus älteren localStorage-Versionen:
 *  - mode fehlt → "knob" (pre-v1.16)
 *  - triggerMode fehlt → "edge"
 *  - triggerMode invalide → "edge" (defensiv)
 *  - triggerKind fehlt → "script" (pre-v1.20 Daten ohne discriminated union)
 *  - triggerKind invalide → "script"
 *  - padIndex außerhalb [0..PAD_COUNT) oder kein Integer → undefined
 *  - bindings ist kein Array → []
 *  - scriptId nur durchreichen wenn String
 */
function migrateMacro(raw: unknown, fallback: Macro): Macro {
  if (!raw || typeof raw !== "object") return fallback;
  const m = raw as Partial<Macro> & Record<string, unknown>;
  const mode: MacroMode = m.mode === "button" ? "button" : "knob";
  const triggerKind: MacroTriggerKind = m.triggerKind === "pad" ? "pad" : "script";
  const triggerMode: MacroTriggerMode = m.triggerMode === "hold" ? "hold" : "edge";
  const padIndexRaw = m.padIndex;
  const padIndex =
    typeof padIndexRaw === "number" &&
    Number.isInteger(padIndexRaw) &&
    padIndexRaw >= 0 &&
    padIndexRaw < PAD_COUNT
      ? padIndexRaw
      : undefined;
  return {
    index: typeof m.index === "number" ? m.index : fallback.index,
    label: typeof m.label === "string" ? m.label : fallback.label,
    value: typeof m.value === "number" ? Math.max(0, Math.min(1, m.value)) : 0,
    bindings: Array.isArray(m.bindings) ? (m.bindings as MacroBinding[]) : [],
    color: typeof m.color === "string" ? m.color : fallback.color,
    mode,
    scriptId: typeof m.scriptId === "string" ? m.scriptId : undefined,
    triggerKind,
    padIndex,
    triggerMode,
  };
}

function load(): Macro[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        const defaults = defaultMacros();
        const migrated: Macro[] = [];
        for (let i = 0; i < MACRO_COUNT; i++) {
          migrated.push(migrateMacro(parsed[i], defaults[i]));
        }
        return migrated;
      }
    }
  } catch { /* ignore */ }
  return defaultMacros();
}

function persist(macros: Macro[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(macros)); } catch { /* ignore */ }
}

let _macros: Macro[] = load();
const _listeners = new Set<Listener>();
function notify() { _listeners.forEach(l => l()); }

export function setMacroValue(index: number, value: number): void {
  _macros = _macros.map((m, i) => i === index ? { ...m, value: Math.max(0, Math.min(1, value)) } : m);
  notify();
  // CustomEvent dispatchen damit App.tsx auf Bindings reagieren kann
  window.dispatchEvent(new CustomEvent("macro:change", { detail: { index, value: _macros[index].value } }));
}

export function setMacroLabel(index: number, label: string): void {
  _macros = _macros.map((m, i) => i === index ? { ...m, label } : m);
  persist(_macros);
  notify();
}

export function addMacroBinding(index: number, binding: Omit<MacroBinding, "id">): void {
  const b = { ...binding, id: makeBindingId() };
  _macros = _macros.map((m, i) => i === index ? { ...m, bindings: [...m.bindings, b] } : m);
  persist(_macros);
  notify();
}

export function removeMacroBinding(macroIndex: number, bindingId: string): void {
  _macros = _macros.map((m, i) =>
    i === macroIndex ? { ...m, bindings: m.bindings.filter(b => b.id !== bindingId) } : m
  );
  persist(_macros);
  notify();
}

export function resetMacros(): void {
  _macros = defaultMacros();
  persist(_macros);
  notify();
}

/**
 * Setzt den Modus eines Macros ("knob" oder "button").
 *
 * Wichtig: Bindings werden NICHT gelöscht beim Wechsel — wenn der User
 * zurück auf "knob" wechselt sind seine Audio-Routings noch da.
 * Genauso bleibt `scriptId` erhalten beim Switch nach "knob" (verhindert
 * versehentlichen Datenverlust).
 *
 * No-op bei out-of-range index.
 */
export function setMacroMode(macroIndex: number, mode: MacroMode): void {
  if (macroIndex < 0 || macroIndex >= MACRO_COUNT) return;
  if (mode !== "knob" && mode !== "button") return;
  _macros = _macros.map((m, i) => i === macroIndex ? { ...m, mode } : m);
  persist(_macros);
  notify();
}

/**
 * Setzt die Script-ID eines Macros (für mode === "button" + triggerKind === "script").
 * `null` löscht die Bindung.
 *
 * No-op bei out-of-range index.
 */
export function setMacroScriptId(macroIndex: number, scriptId: string | null): void {
  if (macroIndex < 0 || macroIndex >= MACRO_COUNT) return;
  const nextId = scriptId == null ? undefined : scriptId;
  _macros = _macros.map((m, i) => i === macroIndex ? { ...m, scriptId: nextId } : m);
  persist(_macros);
  notify();
}

/**
 * Setzt den Trigger-Kind eines Macros (für mode === "button"):
 *  - "script" → Button triggert ein Skript (klassisches v1.17-Verhalten)
 *  - "pad"    → Button triggert einen Performance-Pad
 *
 * Bestehende `scriptId`/`padIndex`-Werte bleiben erhalten beim Wechsel
 * (kein Datenverlust, User kann zurück-wechseln). No-op bei out-of-range
 * index oder invalidem kind-String.
 */
export function setMacroTriggerKind(macroIndex: number, kind: MacroTriggerKind): void {
  if (macroIndex < 0 || macroIndex >= MACRO_COUNT) return;
  if (kind !== "script" && kind !== "pad") return;
  _macros = _macros.map((m, i) => i === macroIndex ? { ...m, triggerKind: kind } : m);
  persist(_macros);
  notify();
}

/**
 * Setzt den Trigger-Mode eines Macros (für mode === "button"):
 *  - "edge" → einmaliger Run pro Press (default)
 *  - "hold" → re-fire-Loop solange Button gedrückt
 *
 * Validierung defensiv: invalide Strings (z.B. "loop") → no-op.
 * No-op bei out-of-range index.
 */
export function setMacroTriggerMode(macroIndex: number, mode: MacroTriggerMode): void {
  if (macroIndex < 0 || macroIndex >= MACRO_COUNT) return;
  if (mode !== "edge" && mode !== "hold") return;
  _macros = _macros.map((m, i) => i === macroIndex ? { ...m, triggerMode: mode } : m);
  persist(_macros);
  notify();
}

/**
 * Setzt den Performance-Pad-Index eines Macros (für mode === "button" + triggerKind === "pad").
 * `null` löscht die Pad-Bindung.
 *
 * Validierung:
 *  - macroIndex außerhalb [0..MACRO_COUNT) → no-op
 *  - padIndex außerhalb [0..PAD_COUNT) (außer null) → no-op
 *  - padIndex muss ein Integer sein, sonst no-op
 */
export function setMacroPadIndex(macroIndex: number, padIndex: number | null): void {
  if (macroIndex < 0 || macroIndex >= MACRO_COUNT) return;
  let nextPadIndex: number | undefined;
  if (padIndex === null) {
    nextPadIndex = undefined;
  } else if (
    typeof padIndex !== "number" ||
    !Number.isInteger(padIndex) ||
    padIndex < 0 ||
    padIndex >= PAD_COUNT
  ) {
    return;
  } else {
    nextPadIndex = padIndex;
  }
  _macros = _macros.map((m, i) => i === macroIndex ? { ...m, padIndex: nextPadIndex } : m);
  persist(_macros);
  notify();
}

/**
 * Triggert einen Macro-Button: dispatched ein `macro:button:trigger` Event,
 * das in App.tsx von einem Subscriber abgefangen wird.
 *
 * Event-Detail (v1.22):
 *   { macroIndex, triggerKind, triggerMode, scriptId?, padIndex? }
 *
 * `triggerMode` gibt an, ob das Event single-shot (edge) oder Start einer
 * Hold-Loop ist. Hold-Loop wird via `macro:button:release` gestoppt.
 *
 * Kein direkter Import von useScriptSandbox/usePerformanceStore um Cycle-Risk
 * zu vermeiden — App.tsx routet das Event an die richtige Implementation.
 *
 * Returns:
 *  - null, wenn das Macro nicht im Button-Mode ist oder die jeweilige Ziel-
 *    Referenz (scriptId bzw. padIndex) für den triggerKind fehlt
 *  - bei triggerKind="script": die scriptId (Convenience)
 *  - bei triggerKind="pad":    "pad:<padIndex>" als Sentinel-String
 */
export function triggerMacroButton(macroIndex: number): string | null {
  if (macroIndex < 0 || macroIndex >= MACRO_COUNT) return null;
  const macro = _macros[macroIndex];
  if (!macro || macro.mode !== "button") return null;

  const triggerKind: MacroTriggerKind = macro.triggerKind === "pad" ? "pad" : "script";
  const triggerMode: MacroTriggerMode = macro.triggerMode === "hold" ? "hold" : "edge";

  if (triggerKind === "script" && !macro.scriptId) return null;
  if (triggerKind === "pad" && (macro.padIndex === undefined || macro.padIndex === null)) return null;

  if (typeof window !== "undefined" && typeof CustomEvent !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("macro:button:trigger", {
        detail: {
          macroIndex,
          triggerKind,
          triggerMode,
          scriptId: macro.scriptId,
          padIndex: macro.padIndex,
        },
      }),
    );
  }
  if (triggerKind === "pad") return `pad:${macro.padIndex}`;
  return macro.scriptId ?? null;
}

/**
 * Signalisiert, dass ein Macro-Button losgelassen wurde — stoppt eine
 * laufende Hold-Loop in App.tsx. No-op bei Edge-Mode (App.tsx-seitig).
 *
 * Event-Detail (v1.22):
 *   { macroIndex }
 *
 * Wird auch dann gefeuert, wenn der Macro nicht im Hold-Mode ist — App.tsx
 * prüft selbst, ob eine Loop aktiv ist. So bleibt MacroPanel.tsx einfach.
 */
export function triggerMacroButtonRelease(macroIndex: number): void {
  if (macroIndex < 0 || macroIndex >= MACRO_COUNT) return;
  if (typeof window !== "undefined" && typeof CustomEvent !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("macro:button:release", {
        detail: { macroIndex },
      }),
    );
  }
}

export function getMacros(): Macro[] { return _macros; }

export function useMacroStore(): { macros: Macro[] } {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => { _listeners.delete(rerender); };
  }, []);
  return { macros: _macros };
}

// ─── Routing-Helfer ───────────────────────────────────────────────────────────
// Diese Funktionen sind pur und ohne Browser-/Audio-Abhängigkeiten testbar.
// App.tsx subscribed auf das "macro:change" Event und ruft applyMacroBindings
// mit den passenden Settern auf.

/**
 * Mappt einen normalisierten Macro-Wert (0..1) auf den Wertebereich
 * eines Bindings (binding.minValue..binding.maxValue).
 *
 * Beispiel: value=0.5, min=80, max=160 → 120
 */
export function mapMacroValue(binding: MacroBinding, normalizedValue: number): number {
  const clamped = Math.max(0, Math.min(1, normalizedValue));
  return binding.minValue + clamped * (binding.maxValue - binding.minValue);
}

/**
 * Setter-Bag den `applyMacroBindings` für die Audio-Routings benötigt.
 * Jeder Setter ist optional, damit Tests einzelne Pfade isoliert prüfen können
 * und Aufrufer (App.tsx) den realen `AudioEngine` + `useDrumMachineStore` injizieren.
 */
export interface MacroRouteSetters {
  setMasterVolume?: (value: number) => void;
  setBpm?: (value: number) => void;
  setChannelVolume?: (partId: string, value: number) => void;
  setChannelPan?: (partId: string, value: number) => void;
  setChannelSend?: (partId: string, bus: "reverb" | "delay", value: number) => void;
  /** Optional: LFO-Routings sind aktuell nicht implementiert (siehe TODO). */
  setLfoRate?: (partId: string, value: number) => void;
  setLfoDepth?: (partId: string, value: number) => void;
  /** Optional: zusätzlicher Hook für unbekannte Targets (z.B. Logging). */
  onUnhandled?: (binding: MacroBinding) => void;
}

/**
 * Wendet alle Bindings eines Macros auf die übergebenen Setter an.
 * Reine Funktion ohne Seiteneffekte außer den Setter-Aufrufen.
 *
 * Aufruf-Beispiel (App.tsx):
 *   applyMacroBindings(macro, value, {
 *     setMasterVolume: AudioEngine.setMasterVolume.bind(AudioEngine),
 *     setBpm: (v) => project.setBpm(Math.round(v)),
 *     setChannelVolume: (id, v) => { dm.setPartVolume(id, v); AudioEngine.setChannelVolume(id, v); },
 *     ...
 *   });
 */
export function applyMacroBindings(
  macro: Macro,
  normalizedValue: number,
  setters: MacroRouteSetters,
): void {
  if (!macro || !macro.bindings || macro.bindings.length === 0) return;
  for (const binding of macro.bindings) {
    const mapped = mapMacroValue(binding, normalizedValue);
    switch (binding.target) {
      case "master-vol":
        setters.setMasterVolume?.(mapped);
        break;
      case "bpm":
        setters.setBpm?.(Math.round(mapped));
        break;
      case "channel-vol":
        if (binding.partId) setters.setChannelVolume?.(binding.partId, mapped);
        break;
      case "channel-pan":
        if (binding.partId) setters.setChannelPan?.(binding.partId, mapped);
        break;
      case "channel-send-rev":
        if (binding.partId) setters.setChannelSend?.(binding.partId, "reverb", mapped);
        break;
      case "channel-send-dly":
        if (binding.partId) setters.setChannelSend?.(binding.partId, "delay", mapped);
        break;
      case "lfo-rate":
        if (binding.partId) {
          if (setters.setLfoRate) setters.setLfoRate(binding.partId, mapped);
          else setters.onUnhandled?.(binding);
        }
        break;
      case "lfo-depth":
        if (binding.partId) {
          if (setters.setLfoDepth) setters.setLfoDepth(binding.partId, mapped);
          else setters.onUnhandled?.(binding);
        }
        break;
      default:
        setters.onUnhandled?.(binding);
        break;
    }
  }
}
