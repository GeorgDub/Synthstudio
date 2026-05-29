/**
 * client/src/utils/patternManager.ts
 *
 * Reine Helfer für den Pattern-Manager-Tab: Suche NACH INHALT (Kanal-/Sample-
 * Name, nicht nur Nummer — damit man "den Beat mit SNARE 1" findet, egal welche
 * Pattern-Nummer) + Sortierung + Dichte-Metriken. Bewusst store-/UI-agnostisch
 * und unit-testbar.
 */

export interface PMStep {
  active: boolean;
}
export interface PMPart {
  name: string;
  sampleName?: string;
  steps: PMStep[];
}
export interface PMPattern {
  id?: string;
  name: string;
  stepCount?: number;
  parts: PMPart[];
}

export type PatternSortKey = "original" | "name" | "density" | "channels";

/** Summe aller aktiven Steps über alle Parts. */
export function countActiveSteps(p: PMPattern): number {
  let n = 0;
  for (const part of p.parts) for (const s of part.steps) if (s.active) n++;
  return n;
}

/** Anzahl Parts (Kanäle), die mindestens einen aktiven Step haben. */
export function countActiveChannels(p: PMPattern): number {
  let n = 0;
  for (const part of p.parts) if (part.steps.some(s => s.active)) n++;
  return n;
}

/**
 * Such-/Anzeige-Labels eines Patterns: Pattern-Name + alle Part-Namen +
 * Sample-Namen, dedupliziert, in Reihenfolge.
 */
export function collectPatternLabels(p: PMPattern): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (s?: string) => {
    if (!s) return;
    const key = s.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(s);
  };
  add(p.name);
  for (const part of p.parts) { add(part.name); add(part.sampleName); }
  return out;
}

/**
 * Matcht ein Pattern gegen eine Suchanfrage (case-insensitive). Trifft, wenn der
 * Pattern-Name ODER irgendein Part-/Sample-Name das Query als Substring enthält.
 * Leeres/whitespace-Query trifft immer.
 */
export function patternMatchesQuery(p: PMPattern, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (p.name.toLowerCase().includes(q)) return true;
  for (const part of p.parts) {
    if (part.name.toLowerCase().includes(q)) return true;
    if (part.sampleName && part.sampleName.toLowerCase().includes(q)) return true;
  }
  return false;
}

/**
 * Sortiert eine Pattern-Liste (Kopie) nach dem Schlüssel. "original" = stabile
 * Eingabereihenfolge; "density"/"channels" absteigend (vollste zuerst); "name"
 * alphabetisch (locale-aware, numerisch für "Pattern 9" < "Pattern 10").
 */
export function sortPatternsBy<T extends PMPattern>(patterns: T[], key: PatternSortKey): T[] {
  const arr = patterns.map((p, i) => ({ p, i }));
  const cmp: Record<PatternSortKey, (a: { p: T; i: number }, b: { p: T; i: number }) => number> = {
    original: (a, b) => a.i - b.i,
    name: (a, b) => a.p.name.localeCompare(b.p.name, undefined, { numeric: true, sensitivity: "base" }) || a.i - b.i,
    density: (a, b) => (countActiveSteps(b.p) - countActiveSteps(a.p)) || a.i - b.i,
    channels: (a, b) => (countActiveChannels(b.p) - countActiveChannels(a.p)) || a.i - b.i,
  };
  arr.sort(cmp[key]);
  return arr.map(x => x.p);
}
