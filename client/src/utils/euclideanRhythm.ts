/**
 * Synthstudio – euclideanRhythm.ts (v3.157.0)
 *
 * Pure-Helper für Euclidean Rhythms (Bjorklund-Algorithmus, popularisiert
 * von Godfried Toussaint). Verteilt N Hits gleichmaessig ueber K Steps —
 * liefert weltbekannte Pattern wie E(3,8) Tresillo oder E(5,8) Cinquillo.
 *
 * Public API:
 *  - euclideanPattern(hits, steps, rotation?) → boolean[]
 *  - euclideanPatternBjorklund(hits, steps) → boolean[] (Bresenham, pure)
 *  - rotatePattern(pattern, rotation) → boolean[]
 *  - countHits(pattern) → number
 *  - EUCLIDEAN_PRESETS: Liste populärer Beispiele (Tresillo, Cinquillo, …)
 *
 * Pure & Node-testbar.  Tests: tests/features/euclidean-rhythm.test.ts
 *
 * ─── Verhältnis zu `euclidean.ts` (legacy) ────────────────────────────────
 *
 * `euclidean.ts` (älter, v1.x) exportiert NUR `euclidean(hits, steps, rotation)`
 * via Bjorklund-Bucket-Algorithmus.  Dieses Modul (`euclideanRhythm.ts`,
 * v3.157+) ist die erweiterte Variante mit Bresenham-Floor-Increment-Check
 * (mathematisch äquivalent zur Bucket-Form), zusätzlich:
 *   - Rotation als separat aufrufbare Funktion (rotatePattern)
 *   - Hit-Zähler (countHits)
 *   - EUCLIDEAN_PRESETS Liste für UX (Tresillo, Cinquillo, Bossa, Techno …)
 *
 * Beide Module koexistieren bewusst:
 *   - DrumMachine-Audio-Loop nutzt `euclidean.ts` (etablierter Code-Path).
 *   - Preset-Picker + Rhythm-Library-UX nutzen `euclideanRhythm.ts`.
 *
 * Wer ein simples Pattern braucht → `euclidean()` aus `euclidean.ts`.
 * Wer Presets, Rotation-Separation, oder countHits braucht → dieses Modul.
 */

// ─── Public Types ────────────────────────────────────────────────────────────

export interface EuclideanPreset {
  id: string;
  name: string;
  hits: number;
  steps: number;
  description: string;
}

/** Klassische Euclidean-Patterns mit musikalischen Namen. */
export const EUCLIDEAN_PRESETS: readonly EuclideanPreset[] = [
  { id: "tresillo", name: "Tresillo E(3,8)", hits: 3, steps: 8, description: "Cuban Tresillo, Reggaeton-Foundation" },
  { id: "cinquillo", name: "Cinquillo E(5,8)", hits: 5, steps: 8, description: "Cuban Cinquillo, Habanera-Variante" },
  { id: "afro-7-16", name: "Afro 7-16 E(7,16)", hits: 7, steps: 16, description: "Sub-Sahara Afrikanisch" },
  { id: "rumba-5-16", name: "Rumba E(5,16)", hits: 5, steps: 16, description: "Klassischer Rumba-Clave" },
  { id: "bossa-3-16", name: "Bossa E(3,16)", hits: 3, steps: 16, description: "Bossa Nova Foundation" },
  { id: "york-samba", name: "York-Samba E(7,8)", hits: 7, steps: 8, description: "Dense Funk-Snare Variation" },
  { id: "techno-4-16", name: "Techno E(4,16)", hits: 4, steps: 16, description: "4-on-the-Floor" },
];

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Erzeugt ein Euclidean-Pattern mit `hits` Schlägen verteilt über `steps` Schritte.
 * Liefert ein boolean[steps] Array. Optional kann das Pattern um `rotation` Steps
 * nach rechts rotiert werden (positive Werte = später startend).
 *
 * Defensive:
 *  - hits <= 0 → leeres Pattern (alle false)
 *  - hits >= steps → alle true
 *  - steps <= 0 → leeres []
 *  - non-integer Inputs werden floor'd
 *
 * Pure & deterministisch.
 */
export function euclideanPattern(
  hits: number,
  steps: number,
  rotation = 0,
): boolean[] {
  const k = Math.max(0, Math.floor(hits));
  const n = Math.max(0, Math.floor(steps));
  if (n === 0) return [];
  if (k === 0) return new Array(n).fill(false) as boolean[];
  if (k >= n) return new Array(n).fill(true) as boolean[];

  const pattern = euclideanPatternBjorklund(k, n);
  return rotation === 0 ? pattern : rotatePattern(pattern, rotation);
}

/**
 * Bresenham-Variante des Euclidean-Algorithmus: verteilt k Hits gleichmaessig
 * ueber n Steps via floor-Increment-Check.
 *
 *   pattern[i] = floor(i * k / n) !== floor((i-1) * k / n)
 *
 * Pure O(n), liefert kanonische Form (erster Step immer true).  Aequivalent
 * zum Bjorklund-Bucket-Algorithmus für die Ausgabe.
 */
export function euclideanPatternBjorklund(hits: number, steps: number): boolean[] {
  const k = Math.max(0, Math.floor(hits));
  const n = Math.max(0, Math.floor(steps));
  if (n === 0) return [];
  if (k === 0) return new Array(n).fill(false);
  if (k >= n) return new Array(n).fill(true);

  const result = new Array<boolean>(n);
  for (let i = 0; i < n; i++) {
    const cur = Math.floor((i * k) / n);
    const prev = i === 0 ? -1 : Math.floor(((i - 1) * k) / n);
    result[i] = cur !== prev;
  }
  return result;
}

/**
 * Rotiert ein Pattern um N Steps nach rechts (positive Werte) bzw. links (negativ).
 * Pure: liefert neues Array.
 */
export function rotatePattern(pattern: readonly boolean[], rotation: number): boolean[] {
  const n = pattern.length;
  if (n === 0) return [];
  const r = ((Math.floor(rotation) % n) + n) % n;
  if (r === 0) return [...pattern];
  return [...pattern.slice(n - r), ...pattern.slice(0, n - r)];
}

/**
 * Counts the active steps (true) in a pattern.
 */
export function countHits(pattern: readonly boolean[]): number {
  let n = 0;
  for (const b of pattern) if (b) n++;
  return n;
}
