/**
 * Synthstudio – padBankPersistence (v2.80)
 *
 * Schema + localStorage-Persistenz für die Custom-Pad-Bank-Slots aus
 * MidiSettings (v2.79). Eigenständig testbar — keine React-Abhängigkeit.
 */

export type PadBankSlotKind = "perf-pad" | "macro" | "script" | "action" | "slice";

export interface PadBankSlot {
  kind: PadBankSlotKind;
  /**
   * Per-Kind-Bedeutung:
   *  - perf-pad: 0..15 (Index ins Performance-Pad-Grid).
   *  - macro:    0..7  (Index in useMacroStore).
   *  - script:   scriptId aus useScriptStore.
   *  - action:   action-key aus CHAIN_BUILDER_ACTIONS.
   *  - slice:    0..15 (Index in useSlicePadStore, v2.91).
   */
  param: string;
}

export const PAD_BANK_STORAGE_KEY = "ss-pad-bank:v1";

/** Anzahl Slice-Pad-Slots — gespiegelt von MAX_SLICE_PADS in useSlicePadStore.ts. */
export const PAD_BANK_SLICE_MAX = 16;

/** Default-Setup: 16 Performance-Pad-Slots. */
export function defaultPadBankSlots(): PadBankSlot[] {
  return Array.from({ length: 16 }, (_, i) => ({
    kind: "perf-pad",
    param: String(i),
  }));
}

/**
 * Quick-Action-Helper (v2.91): liefert 16 Slice-Pads-Slots {kind:slice,
 * sliceIndex:0..15}. Wird vom Pad-Bank-Builder als "Slices → Pads (Auto)"
 * angeboten.
 */
export function sliceAutoConfigureSlots(): PadBankSlot[] {
  return Array.from({ length: PAD_BANK_SLICE_MAX }, (_, i) => ({
    kind: "slice" as const,
    param: String(i),
  }));
}

const VALID_KINDS: ReadonlySet<PadBankSlotKind> = new Set([
  "perf-pad", "macro", "script", "action", "slice",
]);

/**
 * Type-Guard: prüft ob ein unbekannter Wert ein valides PadBankSlot-Objekt ist.
 * Defensive an Persistenz-Boundary (User-modifiziertes localStorage, alte
 * Schema-Versionen, etc.).
 */
export function isValidPadBankSlot(s: unknown): s is PadBankSlot {
  if (!s || typeof s !== "object") return false;
  const o = s as { kind?: unknown; param?: unknown };
  if (typeof o.kind !== "string" || !VALID_KINDS.has(o.kind as PadBankSlotKind)) return false;
  if (typeof o.param !== "string") return false;
  return true;
}

/**
 * Liest die Pad-Bank-Slot-Liste aus localStorage. Wenn der Eintrag fehlt,
 * invalid JSON ist oder ein non-Array zurückgibt → Default. Invalid-Items
 * im Array werden silent gefiltert.
 */
export function loadPadBankSlots(): PadBankSlot[] {
  try {
    if (typeof localStorage === "undefined") return defaultPadBankSlots();
    const raw = localStorage.getItem(PAD_BANK_STORAGE_KEY);
    if (!raw) return defaultPadBankSlots();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaultPadBankSlots();
    const filtered: PadBankSlot[] = parsed.filter(isValidPadBankSlot);
    // Leeres Array nach Filterung → User hat alle Slots gelöscht; das ist ein
    // valider Zustand. Defaults greifen nur wenn das Schema komplett kaputt war.
    return filtered;
  } catch {
    return defaultPadBankSlots();
  }
}

/**
 * Persistiert die Pad-Bank-Slot-Liste in localStorage. Best-effort —
 * Quota-Errors werden silent geschluckt (Pad-Bank ist kein kritischer State).
 */
export function savePadBankSlots(slots: PadBankSlot[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(PAD_BANK_STORAGE_KEY, JSON.stringify(slots));
  } catch {
    // localStorage full / disabled — silent ignore
  }
}

/** Test-Hook: localStorage-Eintrag löschen + auf Defaults zurücksetzen. */
export function __resetPadBankForTests(): void {
  try {
    localStorage.removeItem(PAD_BANK_STORAGE_KEY);
  } catch {
    // ignore
  }
}
