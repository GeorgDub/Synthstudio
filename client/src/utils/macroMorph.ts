/**
 * Synthstudio – macroMorph (v3.115.0)
 *
 * Pure Helper für Macro-Snapshot-Morphing: lineare Interpolation zweier
 * Macro-Value-Arrays (8 Werte 0..1) mit einem Morph-Amount (0..1).
 *
 * Side-effect-frei: keine DOM-/Audio-/React-Abhängigkeiten — direkt in
 * Node ausführbar (tests/features/macro-snapshot-morph.test.ts).
 */

/** Anzahl Macro-Slots (muss mit useMacroStore.MACRO_COUNT übereinstimmen). */
export const MACRO_VALUES_LENGTH = 8;

/**
 * Clamped 0..1 — defensiv gegen NaN/Infinity (NaN-Fallback = 0).
 */
function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/**
 * Normalisiert ein Macro-Values-Array auf MACRO_VALUES_LENGTH Einträge:
 *  - kürzere Arrays werden mit 0 gepadded
 *  - längere Arrays werden truncated
 *  - jeder Eintrag wird clamp01-gefiltert (NaN→0)
 *
 * Pure: liefert immer ein neues Array.
 */
export function normalizeMacroValues(arr: readonly number[] | undefined | null): number[] {
  const out: number[] = new Array(MACRO_VALUES_LENGTH);
  for (let i = 0; i < MACRO_VALUES_LENGTH; i++) {
    const raw = arr && i < arr.length ? arr[i] : 0;
    out[i] = clamp01(typeof raw === "number" ? raw : 0);
  }
  return out;
}

/**
 * Lineare Interpolation zweier Macro-Values-Arrays.
 *
 * result[i] = a[i] + (b[i] - a[i]) * amount
 *
 * `amount` wird auf 0..1 geclampt (NaN→0). Arrays werden via
 * normalizeMacroValues auf MACRO_VALUES_LENGTH normalisiert.
 *
 * @returns immer ein Array mit MACRO_VALUES_LENGTH Einträgen, jeder 0..1
 */
export function morphValues(
  a: readonly number[] | undefined | null,
  b: readonly number[] | undefined | null,
  amount: number,
): number[] {
  const aa = normalizeMacroValues(a);
  const bb = normalizeMacroValues(b);
  const t = clamp01(amount);
  const out: number[] = new Array(MACRO_VALUES_LENGTH);
  for (let i = 0; i < MACRO_VALUES_LENGTH; i++) {
    const av = aa[i];
    const bv = bb[i];
    out[i] = clamp01(av + (bv - av) * t);
  }
  return out;
}
