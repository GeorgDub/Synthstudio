/**
 * Synthstudio – euclidean.ts (legacy, v1.x)
 *
 * Canonical Euclidean-Rhythm-Generator für DrumMachine-Store + EuclideanControls.
 * Bucket-Variante des Bjorklund-Toussaint-Algorithmus.  Exportiert NUR eine
 * Funktion: `euclidean(hits, steps, rotation)` → boolean[].
 *
 * Verhältnis zu `euclideanRhythm.ts` (v3.157+):
 *   - `euclidean.ts`        → genau eine Funktion, Bjorklund-Bucket-Implementation,
 *                              wird vom DrumMachine-Store für Live-Pattern-Generation
 *                              und von `EuclideanControls.tsx` für den
 *                              Step-Generator-Button genutzt.
 *   - `euclideanRhythm.ts`  → erweiterte Pure-API mit Bresenham-Variante,
 *                              Rotation, Hit-Counter UND populäre Presets
 *                              (Tresillo, Cinquillo, Bossa, Techno …). Wird
 *                              für UX-Vorlagen + Preset-Picker konsumiert.
 *
 * Beide Module liefern äquivalente Boolean-Patterns für identische (hits, steps)
 * Inputs — Bjorklund-Bucket und Bresenham-Floor-Increment sind mathematisch
 * äquivalent für die Euclidean-Distribution. Sie KOEXISTIEREN bewusst, weil:
 *   1. `euclidean.ts` ist die kürzere, ältere, Audio-Loop-tauglich Variante.
 *   2. `euclideanRhythm.ts` bündelt Presets + zusätzliche Helpers (rotatePattern,
 *      countHits) für den Preset-Picker und Vorlagen-Workflow.
 *
 * Wenn du nur ein Pattern erzeugen musst → `euclidean()` aus dieser Datei.
 * Wenn du Presets, Rotation als separater Step, oder countHits brauchst →
 * `euclideanRhythm.ts`.
 */

/**
 * Bjorklund-Algorithmus: Erzeugt ein Euclidean-Rhythm-Pattern.
 *
 * @param hits     Anzahl der aktiven Pulse (0 ≤ hits ≤ steps)
 * @param steps    Gesamtanzahl der Steps (> 0)
 * @param rotation Verschiebung des Patterns nach rechts (kann negativ sein)
 * @returns boolean[] der Länge steps
 *
 * @example euclidean(3, 8, 0) → [true, false, false, true, false, false, true, false]
 * @example euclidean(4, 4, 0) → [true, true, true, true]
 * @example euclidean(0, 8, 0) → [false, false, false, false, false, false, false, false]
 */
export function euclidean(hits: number, steps: number, rotation = 0): boolean[] {
  if (steps <= 0) return [];
  hits = Math.max(0, Math.min(hits, steps));
  if (hits === 0) return Array(steps).fill(false);
  if (hits === steps) return Array(steps).fill(true);

  // Toussaint-/Bjorklund-Algorithmus (liefert das kanonische Pattern beginnend mit true)
  let pattern: boolean[][] = Array.from({ length: hits }, () => [true]);
  let remainder: boolean[][] = Array.from({ length: steps - hits }, () => [false]);

  while (remainder.length > 1) {
    const count = Math.min(pattern.length, remainder.length);
    const merged: boolean[][] = [];
    for (let i = 0; i < count; i++) {
      merged.push([...pattern[i], ...remainder[i]]);
    }
    if (pattern.length > remainder.length) {
      pattern = [...merged, ...pattern.slice(remainder.length)];
      remainder = [];
    } else if (pattern.length < remainder.length) {
      pattern = merged;
      remainder = remainder.slice(pattern.length);
    } else {
      pattern = merged;
      remainder = [];
    }
  }

  const result: boolean[] = [
    ...pattern.flat(),
    ...remainder.flat(),
  ];

  // Rotation anwenden (positiv = nach rechts verschieben)
  if (rotation === 0) return result;
  const r = (((rotation % steps) + steps) % steps);
  return [...result.slice(r), ...result.slice(0, r)];
}
