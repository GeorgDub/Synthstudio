/**
 * client/src/utils/imports/flpSampleLoader.ts
 *
 * Reine Helfer fürs Auflösen von FLP-Sample-Referenzen gegen einen vom User
 * gewählten Ordner. Der Import (importFlp) liefert pro Part nur den Sample-
 * BASENAMEN (z.B. "CB_Kick.wav") als Label — das FLP enthält kein Audio und die
 * gespeicherten Pfade zeigen oft auf fremde/temporäre Orte. Hier matchen wir die
 * Basenames gegen die tatsächlich im Projektordner gefundenen Dateien.
 *
 * Die eigentliche Ordnerwahl + das Lesen laufen Electron-seitig (packChooseFolder
 * / packScanFolder / fs:read-file) und sind hier bewusst NICHT enthalten — diese
 * Datei bleibt rein + unit-testbar.
 */

/** Basename eines Pfads (Windows- oder POSIX-Trenner). */
export function basenameOf(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] ?? p;
}

export interface ScannedFile {
  /** Absoluter Pfad der gefundenen Audio-Datei. */
  absolutePath: string;
}

export interface SampleMatchResult {
  /** sampleName → absoluter Pfad der gefundenen Datei. */
  matched: Record<string, string>;
  /** sampleNames für die keine Datei gefunden wurde. */
  missing: string[];
}

/**
 * Matcht eine Liste von Sample-Namen (Basenames) gegen gescannte Dateien.
 *
 * - Case-insensitive (FL speichert teils "FX04.WAV", der Ordner hat "fx04.wav").
 * - Match über den vollständigen Basenamen inkl. Endung.
 * - Bei mehreren Dateien gleichen Basenames gewinnt die ERSTE (deterministisch
 *   in Eingabereihenfolge).
 * - Duplikate in `sampleNames` werden zusammengefasst.
 */
export function matchSamplesByBasename(
  sampleNames: string[],
  files: ScannedFile[],
): SampleMatchResult {
  const byBasename = new Map<string, string>(); // lowercase basename → absolutePath
  for (const f of files) {
    const key = basenameOf(f.absolutePath).toLowerCase();
    if (!byBasename.has(key)) byBasename.set(key, f.absolutePath);
  }

  const matched: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of new Set(sampleNames)) {
    if (!name) continue;
    const hit = byBasename.get(name.toLowerCase());
    if (hit) matched[name] = hit;
    else missing.push(name);
  }
  return { matched, missing };
}

/** Sammelt die eindeutigen, nicht-leeren Sample-Namen aus konvertierten Patterns. */
export function collectSampleNames(
  patterns: Array<{ parts: Array<{ sampleName?: string }> }>,
): string[] {
  const set = new Set<string>();
  for (const p of patterns) {
    for (const part of p.parts) {
      if (part.sampleName) set.add(part.sampleName);
    }
  }
  return [...set];
}
