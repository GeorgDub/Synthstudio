/**
 * Synthstudio – Sample-Library Helpers (v3.54.0)
 *
 * Pure-functions für Tag-Management, Search und Filter.
 * Wird vom SampleBrowser, useProjectStore und Tests genutzt.
 *
 * Design-Prinzipien:
 *  - Pure-fn, deterministisch, ohne Side-Effects (testbar in env:node)
 *  - Backward-Compat: Samples ohne `tags`-Property werden als `[]` behandelt
 *  - Tag-Normalisierung: trim + lowercase, leere/ungültige Tags werden ignoriert
 */
import type { Sample } from "@/store/useProjectStore";
import { autoTagFromFilename } from "@/hooks/useBpmDetection";

// ─── Konstanten ──────────────────────────────────────────────────────────────

/**
 * Vordefinierte Kategorie-IDs (mit dem CATEGORIES-Block im SampleBrowser
 * konsistent gehalten).  Pure-fn liefert eine Kopie; UI darf nicht mutieren.
 */
export const SAMPLE_CATEGORIES = [
  "drum",
  "synth",
  "vox",
  "fx",
  "loop",
  "other",
] as const;

export type SampleCategory = (typeof SAMPLE_CATEGORIES)[number];

/** Standard-Filtermodus für `filterByTags`. */
export const DEFAULT_FILTER_MODE: FilterMode = "OR";

export type FilterMode = "AND" | "OR";

// ─── Tag-Normalisierung ──────────────────────────────────────────────────────

/**
 * Bringt einen Tag in eine kanonische Form: trim + lowercase.
 * Liefert null bei leerem/whitespace-only Input.
 */
export function normalizeTag(tag: unknown): string | null {
  if (typeof tag !== "string") return null;
  const t = tag.trim().toLowerCase();
  return t.length > 0 ? t : null;
}

/**
 * Liefert die Tag-Liste eines Samples als unverändertes Array.
 * Backward-Compat: Samples ohne `tags`-Feld → `[]`.
 */
export function getSampleTags(sample: Sample): string[] {
  return Array.isArray(sample.tags) ? sample.tags : [];
}

// ─── Tag-Mutations (Pure, geben neues Sample zurück) ─────────────────────────

/**
 * Fügt einen Tag zu einem Sample hinzu (immutable).
 * Idempotent: Doppelte Tags werden NICHT erneut angehängt.
 * Bei ungültigem Tag (leer/non-string) wird das Sample unverändert returniert.
 */
export function addTagToSample(sample: Sample, tag: string): Sample {
  const t = normalizeTag(tag);
  if (t === null) return sample;
  const existing = getSampleTags(sample);
  if (existing.includes(t)) return sample;
  return { ...sample, tags: [...existing, t] };
}

/**
 * Entfernt einen Tag aus einem Sample (immutable).
 * Existiert der Tag nicht, wird das Sample unverändert returniert (kein
 * neues Objekt — wichtig für Referenz-Vergleiche im React-Renderer).
 */
export function removeTagFromSample(sample: Sample, tag: string): Sample {
  const t = normalizeTag(tag);
  if (t === null) return sample;
  const existing = getSampleTags(sample);
  if (!existing.includes(t)) return sample;
  return { ...sample, tags: existing.filter((x) => x !== t) };
}

/**
 * Ersetzt alle Tags eines Samples (immutable).
 * Tags werden normalisiert (lowercase/trim) und dedupliziert.
 */
export function setSampleTags(sample: Sample, tags: string[]): Sample {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of tags) {
    const t = normalizeTag(raw);
    if (t !== null && !seen.has(t)) {
      seen.add(t);
      cleaned.push(t);
    }
  }
  return { ...sample, tags: cleaned };
}

// ─── Auto-Tagging beim Import ────────────────────────────────────────────────

/**
 * Wendet `autoTagFromFilename` auf ein Sample an und merged die Resultate
 * mit bestehenden Tags (keine Duplikate).  Wenn keine Auto-Tags gefunden
 * werden, wird das Sample unverändert zurückgegeben.
 */
export function applyAutoTagsFromFilename(sample: Sample): Sample {
  const auto = autoTagFromFilename(sample.path);
  if (auto.length === 0) return sample;
  const existing = getSampleTags(sample);
  const seen = new Set(existing);
  const merged = [...existing];
  for (const t of auto) {
    const n = normalizeTag(t);
    if (n !== null && !seen.has(n)) {
      seen.add(n);
      merged.push(n);
    }
  }
  if (merged.length === existing.length) return sample;
  return { ...sample, tags: merged };
}

// ─── Search + Filter ─────────────────────────────────────────────────────────

/**
 * Prüft ob ein Sample auf den Search-String passt.
 * Match-Regeln:
 *  - leerer Query → match=true (kein Filter)
 *  - case-insensitive Substring-Match auf `name`
 *  - case-insensitive Substring-Match auf jedem Tag
 *  - kein Trim am Query: User-Whitespace ist signifikant (z.B. " kick" matched
 *    nichts), aber leading/trailing whitespace wird normalisiert
 */
export function matchesSearchQuery(sample: Sample, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return true;
  if (sample.name.toLowerCase().includes(q)) return true;
  for (const tag of getSampleTags(sample)) {
    if (tag.includes(q)) return true;
  }
  return false;
}

/**
 * Filtert eine Sample-Liste nach Tags + Mode.
 *
 *  - mode='OR':  Sample passt, wenn MINDESTENS einer der `tags` enthalten ist
 *  - mode='AND': Sample passt nur, wenn ALLE `tags` enthalten sind
 *
 * Leere Tag-Liste → returnt die Sample-Liste unverändert.
 */
export function filterByTags(
  samples: Sample[],
  tags: string[],
  mode: FilterMode = DEFAULT_FILTER_MODE,
): Sample[] {
  const normalizedTags = tags
    .map(normalizeTag)
    .filter((t): t is string => t !== null);
  if (normalizedTags.length === 0) return samples.slice();

  if (mode === "AND") {
    return samples.filter((s) => {
      const own = new Set(getSampleTags(s));
      return normalizedTags.every((t) => own.has(t));
    });
  }
  // OR
  return samples.filter((s) => {
    const own = new Set(getSampleTags(s));
    return normalizedTags.some((t) => own.has(t));
  });
}

/**
 * Filtert nach Kategorie.  "all" als Kategorie liefert die unveränderte Liste.
 */
export function filterByCategory(
  samples: Sample[],
  category: string,
): Sample[] {
  if (category === "all" || category === "") return samples.slice();
  return samples.filter((s) => s.category === category);
}

/**
 * Sammelt alle eindeutigen Tags einer Sample-Liste, sortiert alphabetisch.
 */
export function extractAllTags(samples: Sample[]): string[] {
  const set = new Set<string>();
  for (const s of samples) {
    for (const t of getSampleTags(s)) {
      const n = normalizeTag(t);
      if (n !== null) set.add(n);
    }
  }
  return Array.from(set).sort();
}

/**
 * v3.55.0: Vordefinierte Tag-Suggestions (DAW-übliche Drum/Synth-Begriffe).
 * Werden als Fallback in die Auto-Complete-Liste eingefügt wenn der User
 * noch wenig eigene Tags hat.  Wird vom SampleBrowser für die Datalist
 * konsumiert.
 */
export const COMMON_TAG_SUGGESTIONS: ReadonlyArray<string> = [
  "kick", "snare", "hihat", "clap", "perc", "tom", "cymbal", "ride",
  "bass", "lead", "pad", "pluck", "arp",
  "vox", "vocal", "fx", "loop", "oneshot", "rise", "drop",
];

/**
 * v3.55.0: Liefert die Top-N most-used Tags aus einer Sample-Liste.
 *
 * Verhalten:
 *  - Tags werden über die Sample-Liste gezählt (mehr Vorkommen = höher).
 *  - Bei Gleichstand wird stabil sortiert (lexikografisch alphabetisch).
 *  - Wenn weniger als `limit` eigene Tags vorhanden sind, wird mit
 *    COMMON_TAG_SUGGESTIONS aufgefüllt (ohne Duplikate).
 *  - `limit` (default 10) clampt die Ausgabe.
 */
export function getTopTagSuggestions(
  samples: Sample[],
  limit: number = 10,
): string[] {
  const counts = new Map<string, number>();
  for (const s of samples) {
    for (const t of getSampleTags(s)) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  const own = Array.from(counts.entries())
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
    .map(([t]) => t);

  const out: string[] = own.slice(0, limit);
  if (out.length >= limit) return out;

  const seen = new Set(out);
  for (const t of COMMON_TAG_SUGGESTIONS) {
    if (out.length >= limit) break;
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/**
 * Komposit-Filter: Category + Tags + Search.
 *
 *  - category 'all'/''       → keine Kategorie-Filterung
 *  - tags []                 → keine Tag-Filterung
 *  - query ''                → keine Search-Filterung
 *
 * Liefert immer ein NEUES Array (auch wenn alle Filter inaktiv sind).
 */
export interface SampleFilterOptions {
  category?: string;
  tags?: string[];
  tagMode?: FilterMode;
  query?: string;
}

export function applySampleFilters(
  samples: Sample[],
  opts: SampleFilterOptions = {},
): Sample[] {
  const {
    category = "all",
    tags = [],
    tagMode = DEFAULT_FILTER_MODE,
    query = "",
  } = opts;
  let out = filterByCategory(samples, category);
  out = filterByTags(out, tags, tagMode);
  if (query.trim() !== "") {
    out = out.filter((s) => matchesSearchQuery(s, query));
  }
  return out;
}
