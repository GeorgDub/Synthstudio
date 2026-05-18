/**
 * Synthstudio – dragDropDispatch.ts (v3.1.0)
 *
 * Pure-Helpers fuer das globale Drag-Drop-File-Routing.
 * Kein React, kein DOM-Side-Effect — alles ueber CustomEvents und reine
 * Type-Detection-Funktionen. Damit ist die Modul-Logik vollstaendig
 * Vitest-pruefbar in Node ohne JSDOM-Drag-Event-Emulation.
 *
 * Verwendung:
 *   import { detectFileType, dispatchFileDrop } from "@/utils/dragDropDispatch";
 *
 *   const type = detectFileType("kick.wav"); // "audio"
 *   dispatchFileDrop(file); // feuert das passende CustomEvent
 */

// ─── Konstanten ───────────────────────────────────────────────────────────────

/** Audio-Sample-Endungen (WAV, MP3, OGG, FLAC, AIFF, M4A). */
export const AUDIO_EXTENSIONS: ReadonlySet<string> = new Set([
  ".wav",
  ".mp3",
  ".ogg",
  ".flac",
  ".aiff",
  ".aif",
  ".m4a",
]);

/** Projekt-Endungen (.synth + .json als Legacy). */
export const PROJECT_EXTENSIONS: ReadonlySet<string> = new Set([".synth"]);

/** ZIP-Sample-Pack-Endung. */
export const ZIP_EXTENSIONS: ReadonlySet<string> = new Set([".zip"]);

/** MIDI-Standard-Endungen. */
export const MIDI_EXTENSIONS: ReadonlySet<string> = new Set([".mid", ".midi"]);

/**
 * KORG Electribe Pattern/Bank-Endungen.
 *   .e2spat / .e2sallpat → Electribe 2 / Sampler
 *   .esx / .elst        → AeltereVarianten
 *
 * v3.1.0: vollstaendige Drop-Unterstuetzung — der bestehende
 * `electribe:fileImport`-Listener in DrumMachine.tsx greift das CustomEvent.
 */
export const ELECTRIBE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".e2spat",
  ".e2sallpat",
  ".e2pattern", // user-input alias — wird vom Parser akzeptiert (importElectribe matcht via endsWith)
  ".esx",
  ".elst",
]);

// ─── Typen ────────────────────────────────────────────────────────────────────

export type FileType = "audio" | "project" | "zip" | "midi" | "electribe" | "unknown";

/**
 * Ergebnis eines Dispatch-Aufrufs.
 *
 * `handled=true`  → das CustomEvent wurde gefeuert, ein Konsument hat
 *                   die Verantwortung uebernommen.
 * `handled=false` → unbekannte Endung; der Aufrufer soll typischerweise
 *                   einen Toast `Nicht unterstuetzt: <ext>` zeigen.
 */
export interface DispatchResult {
  handled: boolean;
  type: FileType;
  extension: string;
}

// ─── Pure-Helpers ─────────────────────────────────────────────────────────────

/**
 * Extrahiert die kleingeschriebene Endung (inkl. Punkt) aus einem Dateinamen.
 * Gibt "" zurueck wenn kein Punkt im Namen ist.
 */
export function getFileExtension(name: string): string {
  if (typeof name !== "string" || name.length === 0) return "";
  const dot = name.lastIndexOf(".");
  if (dot < 0 || dot === name.length - 1) return "";
  return name.slice(dot).toLowerCase();
}

/**
 * Erkennt den Synthstudio-File-Typ aus einem Dateinamen.
 * Schmaler Lookup-Switch — keine MIME-Type-Sniffing-Heuristiken.
 *
 * @example
 *   detectFileType("Track 01.WAV")     // "audio"
 *   detectFileType("Project.synth")    // "project"
 *   detectFileType("foo.e2sallpat")    // "electribe"
 *   detectFileType("unbekannt.xyz")    // "unknown"
 */
export function detectFileType(name: string): FileType {
  const ext = getFileExtension(name);
  if (ext === "") return "unknown";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (PROJECT_EXTENSIONS.has(ext)) return "project";
  if (ZIP_EXTENSIONS.has(ext)) return "zip";
  if (MIDI_EXTENSIONS.has(ext)) return "midi";
  if (ELECTRIBE_EXTENSIONS.has(ext)) return "electribe";
  return "unknown";
}

/** Auch der DataTransferItemList-Geschmack: bewahrt die Erst-Datei-Heuristik. */
export function detectFileTypeFromFiles(files: ReadonlyArray<{ name: string }>): FileType {
  if (!files || files.length === 0) return "unknown";
  // Bei Multi-File-Drop nutzen wir den Typ der ersten Datei fuer die
  // Overlay-Farbe. Das tatsaechliche Drop-Handling iteriert weiter alle
  // Files und dispatcht pro File ein passendes Event.
  return detectFileType(files[0].name);
}

// ─── CustomEvent-Dispatch ─────────────────────────────────────────────────────

/**
 * Feuert das passende CustomEvent fuer einen einzelnen File-Drop.
 *
 * Receiver:
 *   audio     → "drop:audio"      detail = File
 *   project   → "drop:project"    detail = File
 *   zip       → "drop:zip"        detail = File
 *   midi      → "midi:fileImport" detail = File   (bestehender Listener in DrumMachine.tsx)
 *   electribe → "electribe:fileImport" detail = File (bestehender Listener in DrumMachine.tsx)
 *   unknown   → kein Event; result.handled=false
 *
 * Defensive: bei kaputtem File-Objekt (z.B. nur `name` und kein Blob-Body)
 * wird das Event dennoch gefeuert — die Receiver pruefen instanceof File.
 */
export function dispatchFileDrop(file: { name: string }): DispatchResult {
  const ext = getFileExtension(file?.name ?? "");
  const type = detectFileType(file?.name ?? "");
  if (type === "unknown") {
    return { handled: false, type, extension: ext };
  }

  // Browser/Test-Env muss CustomEvent + window.dispatchEvent kennen.
  if (typeof window === "undefined" || typeof CustomEvent === "undefined") {
    return { handled: false, type, extension: ext };
  }

  const eventNameMap: Record<Exclude<FileType, "unknown">, string> = {
    audio: "drop:audio",
    project: "drop:project",
    zip: "drop:zip",
    midi: "midi:fileImport",
    electribe: "electribe:fileImport",
  };

  const eventName = eventNameMap[type];
  try {
    window.dispatchEvent(new CustomEvent(eventName, { detail: file }));
    return { handled: true, type, extension: ext };
  } catch {
    return { handled: false, type, extension: ext };
  }
}

/**
 * Iteriert ueber eine FileList/File[]-Sammlung und dispatcht jedes File
 * einzeln. Zaehlt erfolgreich gerouted vs. unbekannt.
 */
export function dispatchAllFiles(
  files: ReadonlyArray<{ name: string }>,
): { handled: number; unknown: number; types: FileType[] } {
  const types: FileType[] = [];
  let handled = 0;
  let unknown = 0;
  for (const f of files) {
    const r = dispatchFileDrop(f);
    types.push(r.type);
    if (r.handled) handled++;
    else if (r.type === "unknown") unknown++;
  }
  return { handled, unknown, types };
}
