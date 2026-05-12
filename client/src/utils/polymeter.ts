/**
 * Synthstudio – Polymeter / Polyrhythmische Steps
 *
 * Erlaubt jedem Drum-Part eine eigene Loop-Länge, unabhängig von der
 * Pattern-Step-Anzahl. Beispiel:
 *   Pattern.stepCount = 16, Part.stepLength = 12
 *   → Part loopt nach 12 Steps zurück, während das Pattern weiter bis 16 läuft.
 *   → Polymeter-Effekt: Drum-Part verschiebt sich mit jedem Pattern-Durchlauf.
 *
 * Die `part.steps`-Array bleibt pattern.stepCount lang (für Daten-Kompatibilität);
 * nur der Schedule-Lookup wird via Modulo gewrappt.
 */

export const MIN_PART_STEP_LENGTH = 1;
export const MAX_PART_STEP_LENGTH = 32;

/**
 * Clampt eine Step-Länge auf den gültigen Bereich [1, max].
 * Liefert `undefined` für ungültige Werte (NaN, ≤0) — bedeutet "Default verwenden".
 */
export function clampStepLength(
  length: number | undefined | null,
  max: number = MAX_PART_STEP_LENGTH
): number | undefined {
  if (length === undefined || length === null) return undefined;
  if (!Number.isFinite(length)) return undefined;
  const n = Math.round(length);
  if (n < MIN_PART_STEP_LENGTH) return undefined;
  if (n > max) return max;
  return n;
}

/**
 * Liefert den effektiven Part-Step-Index für einen gegebenen Pattern-Step-Index.
 * Wenn der Part eine eigene `stepLength` hat, wird modular gewrappt;
 * sonst wird `globalStepIndex` unverändert zurückgegeben.
 *
 * Beispiel: globalStepIndex=14, partStepLength=12 → 14 % 12 = 2
 */
export function effectiveStepIndex(
  globalStepIndex: number,
  partStepLength: number | undefined
): number {
  if (partStepLength === undefined || partStepLength <= 0) {
    return globalStepIndex;
  }
  return ((globalStepIndex % partStepLength) + partStepLength) % partStepLength;
}

/**
 * Prüft, ob ein Step-Index innerhalb der Part-Länge "anzeigbar" ist.
 * Wird genutzt um Step-Cells visuell zu markieren, die nicht zum Part gehören.
 */
export function isStepWithinPart(
  stepIndex: number,
  partStepLength: number | undefined
): boolean {
  if (partStepLength === undefined || partStepLength <= 0) return true;
  return stepIndex < partStepLength;
}

/**
 * Liefert den nächsten "Wrap"-Punkt des Parts: der Step-Index, an dem
 * der Part wieder bei 0 startet.
 *
 * Beispiel: globalStep=10, partLength=4 → returns 12 (nächster Multipel von 4 nach 10).
 */
export function nextWrapStep(
  globalStepIndex: number,
  partStepLength: number | undefined
): number | null {
  if (partStepLength === undefined || partStepLength <= 0) return null;
  return (Math.floor(globalStepIndex / partStepLength) + 1) * partStepLength;
}
