/**
 * Synthstudio – sampleSort.ts (v3.148.0)
 *
 * Pure-Helper für Sort-Modes der Sample-Library.  Bisher waren Samples in der
 * UI nur in Import-Reihenfolge sortiert (Array-Order aus useProjectStore).
 * v3.148 ergänzt Name/Datum/Kategorie-Sortierung.
 *
 * Public API:
 *  - SampleSortMode union
 *  - SAMPLE_SORT_LABELS: Record<SampleSortMode, string>
 *  - SAMPLE_SORT_MODES: readonly SampleSortMode[]
 *  - sortSamples(samples, mode): Sample[] — pure, returns new array
 *
 * Pure & Node-testbar.
 *
 * Tests: tests/features/sample-sort.test.ts
 */

// ─── Public Types ────────────────────────────────────────────────────────────

export type SampleSortMode =
  | "import"      // default — keine Sortierung, Import-Reihenfolge
  | "name-asc"    // alphabetisch A-Z
  | "name-desc"   // alphabetisch Z-A
  | "newest"      // neueste zuerst (per createdAt oder id-suffix-numeric)
  | "category";   // nach category, dann name

export const SAMPLE_SORT_MODES: readonly SampleSortMode[] = [
  "import",
  "name-asc",
  "name-desc",
  "newest",
  "category",
];

export const SAMPLE_SORT_LABELS: Record<SampleSortMode, string> = {
  "import": "Import-Reihenfolge",
  "name-asc": "Name A → Z",
  "name-desc": "Name Z → A",
  "newest": "Neueste zuerst",
  "category": "Kategorie",
};

/**
 * Minimal-Sample-Interface das wir hier brauchen.  Kein harter Import auf
 * useProjectStore.Sample (vermeidet Circular-Risiko und entkoppelt Tests).
 */
export interface SortableSample {
  id: string;
  name: string;
  category?: string;
  /** Optional v3.124+: createdAt-Timestamp (ms). */
  createdAt?: number;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Sortiert ein Sample-Array nach mode.  Liefert neues Array (immutable);
 * Mode "import" liefert exakt das Input-Array zurück (kein Re-Order).
 *
 * Defensive bei missing fields:
 *  - name fehlt → leerer String (sortet vorne)
 *  - category fehlt → "" → in "category"-Mode am Ende
 *  - createdAt fehlt → fallback auf id-string-compare (neuere IDs sind
 *    typischerweise später generiert; sample-IDs sind oft `slice-<timestamp>-…`).
 *
 * Pure & deterministisch.
 */
export function sortSamples<T extends SortableSample>(
  samples: readonly T[],
  mode: SampleSortMode,
): T[] {
  if (!Array.isArray(samples) || samples.length === 0) return [...samples];
  if (mode === "import") return [...samples];

  const arr = [...samples];

  switch (mode) {
    case "name-asc":
      return arr.sort(byName(1));
    case "name-desc":
      return arr.sort(byName(-1));
    case "newest":
      return arr.sort(byNewest);
    case "category":
      return arr.sort(byCategory);
    default:
      return arr;
  }
}

// ─── Internal comparators ────────────────────────────────────────────────────

function safeName(s: SortableSample): string {
  return typeof s.name === "string" ? s.name.toLowerCase() : "";
}

function byName(dir: 1 | -1) {
  return (a: SortableSample, b: SortableSample): number => {
    const an = safeName(a);
    const bn = safeName(b);
    if (an < bn) return -1 * dir;
    if (an > bn) return 1 * dir;
    return 0;
  };
}

function timestampFromSample(s: SortableSample): number {
  if (typeof s.createdAt === "number" && Number.isFinite(s.createdAt)) {
    return s.createdAt;
  }
  // Fallback: extract numeric suffix from id (e.g. "slice-1700000000-0" → 1700000000).
  if (typeof s.id === "string") {
    const m = s.id.match(/(\d{10,})/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n)) return n;
    }
  }
  return 0;
}

function byNewest(a: SortableSample, b: SortableSample): number {
  const at = timestampFromSample(a);
  const bt = timestampFromSample(b);
  if (at > bt) return -1;
  if (at < bt) return 1;
  return safeName(a).localeCompare(safeName(b));
}

function byCategory(a: SortableSample, b: SortableSample): number {
  const ac = typeof a.category === "string" ? a.category : "";
  const bc = typeof b.category === "string" ? b.category : "";
  if (ac < bc) return -1;
  if (ac > bc) return 1;
  // gleicher Category: sortiere nach Name.
  return safeName(a).localeCompare(safeName(b));
}
