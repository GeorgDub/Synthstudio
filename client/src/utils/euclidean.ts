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
