/**
 * attachSampleUrls.ts — hängt Blob-/Object-URLs an die Parts eines ImportResult.
 *
 * Trennung der Zuständigkeiten: das PCM→WAV→Blob-URL-Encoding ist ein
 * Browser-Seiteneffekt (URL.createObjectURL) und lebt im Import-Controller.
 * DIESE Funktion ist rein: sie bekommt eine fertige Map `sampleId → URL` und
 * verteilt die URLs auf alle Parts, deren `sampleId` einen Treffer hat.
 *
 * Konservativ: Parts ohne passende sampleId bleiben unverändert (kein Mislink),
 * und die Struktur wird ref-stabil kopiert (neue Objekte nur wo nötig). So bleibt
 * der Load-Pfad testbar, ohne DOM/Audio zu brauchen.
 */

import type { ImportResult, ImportedPart, ImportedPattern } from "./types";

/**
 * Liefert eine neue `ImportResult`-Kopie, bei der jeder Part mit passender
 * `sampleId` ein `sampleUrl` erhält. Gibt zusätzlich zurück, wie viele Parts
 * verlinkt wurden (für User-Feedback: „N Spur(en) mit Sample").
 *
 * @param result        Quell-ImportResult (unverändert).
 * @param urlBySampleId Map Slot-Index (== part.sampleId) → Blob-/Object-URL.
 */
export function attachSampleUrlsToImportResult(
  result: ImportResult,
  urlBySampleId: ReadonlyMap<number, string>
): { result: ImportResult; linkedCount: number } {
  if (urlBySampleId.size === 0) return { result, linkedCount: 0 };

  let linkedCount = 0;
  const patterns: ImportedPattern[] = result.patterns.map(pat => {
    let patternTouched = false;
    const parts: ImportedPart[] = pat.parts.map(part => {
      if (part.sampleId === undefined) return part;
      const url = urlBySampleId.get(part.sampleId);
      if (url === undefined) return part;
      linkedCount++;
      patternTouched = true;
      return { ...part, sampleUrl: url };
    });
    return patternTouched ? { ...pat, parts } : pat;
  });

  if (linkedCount === 0) return { result, linkedCount: 0 };
  return { result: { ...result, patterns }, linkedCount };
}
