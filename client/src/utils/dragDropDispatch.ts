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
 *   .elst                → AeltereVariante
 *
 * v3.1.0: vollstaendige Drop-Unterstuetzung — der bestehende
 * `electribe:fileImport`-Listener in DrumMachine.tsx greift das CustomEvent.
 *
 * v3.3.0: `.esx` und `.all` sind KORG Sample-Banks (ESX-1 + E2S) und werden
 * jetzt separat zu KORG_BANK_EXTENSIONS geroutet — siehe unten.
 */
export const ELECTRIBE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".e2spat",
  ".e2sallpat",
  ".e2pattern", // user-input alias — wird vom Parser akzeptiert (importElectribe matcht via endsWith)
  ".elst",
]);

/**
 * KORG Sample-Bank-Endungen (v3.3.0).
 *   .esx / .ess → ESX-1 Backup (Mono+Stereo PCM samples + Patterns)
 *   .all        → E2S Sample-Bank (250 RIFF/WAVE slots mit korg/esli meta)
 *
 * Drop einer dieser Endungen → CustomEvent "korg:bank:open" wird mit der File
 * als detail dispatched. Listener: `KorgBankModal` in DrumMachine.tsx.
 */
export const KORG_BANK_EXTENSIONS: ReadonlySet<string> = new Set([
  ".esx",
  ".ess",
  ".all",
]);

/**
 * Plugin-Chain-Preset Endung (v3.47.0).
 *   .synthpreset.json → einzelnes Preset ODER Preset-Bundle (Schema-discriminated)
 *
 * Drop → CustomEvent "plugin-preset:import" mit detail=File. Listener in App.tsx
 * liest die Datei und ruft `importPresetFromJson()`.
 *
 * Hinweis: `getFileExtension()` matched die letzte Endung (.json), darum
 * matchen wir den compound-suffix in detectFileType() via endsWith.
 */
export const PLUGIN_PRESET_SUFFIX = ".synthpreset.json" as const;

/**
 * MIDI-Mapping-Share Endung (v3.64.0).
 *   .synthmidi.json → v2-Envelope mit CC + Note-Mappings + metadata.
 *
 * Drop → CustomEvent "midi-mapping:import" mit detail=File. Listener in App.tsx
 * liest die Datei und routet sie über `parseMidiMappingShareJson()`.
 *
 * Compound-Suffix-Routing (analog .synthpreset.json), damit normales `.json`
 * weiterhin als "unknown" durchfällt.
 */
export const MIDI_MAPPING_SUFFIX = ".synthmidi.json" as const;

// ─── Typen ────────────────────────────────────────────────────────────────────

export type FileType =
  | "audio"
  | "project"
  | "zip"
  | "midi"
  | "electribe"
  | "korg-bank"
  | "plugin-preset"
  | "midi-mapping"
  | "unknown";

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
  if (typeof name !== "string" || name.length === 0) return "unknown";
  // Compound-suffix check zuerst — `.synthpreset.json` würde sonst als
  // `.json` interpretiert und unten als `unknown` durchfallen.
  if (name.toLowerCase().endsWith(PLUGIN_PRESET_SUFFIX)) return "plugin-preset";
  if (name.toLowerCase().endsWith(MIDI_MAPPING_SUFFIX)) return "midi-mapping";
  const ext = getFileExtension(name);
  if (ext === "") return "unknown";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (PROJECT_EXTENSIONS.has(ext)) return "project";
  if (ZIP_EXTENSIONS.has(ext)) return "zip";
  if (MIDI_EXTENSIONS.has(ext)) return "midi";
  if (KORG_BANK_EXTENSIONS.has(ext)) return "korg-bank";
  if (ELECTRIBE_EXTENSIONS.has(ext)) return "electribe";
  return "unknown";
}

/**
 * v3.273: Erkennt einen KOMBINIERTEN Electribe-Pattern + .all-Sample-Bank-Drop.
 * True, wenn die Sammlung mindestens eine Electribe-Pattern-Datei
 * (.e2sallpat/.e2spat/.e2pattern) UND mindestens eine .all-Sample-Bank enthält.
 * Dann sollen beide als EIN verknüpfter Import (Samples auf Kanälen) behandelt
 * werden statt getrennt geroutet — siehe ElectronDropZone + DrumMachine.
 */
export function isCombinedElectribeSampleDrop(
  files: ReadonlyArray<{ name: string }>,
): boolean {
  let hasPattern = false;
  let hasSampleBank = false;
  for (const f of files) {
    if (detectFileType(f.name) === "electribe") hasPattern = true;
    if (getFileExtension(f.name) === ".all") hasSampleBank = true;
  }
  return hasPattern && hasSampleBank;
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
    "korg-bank": "korg:bank:open",
    "plugin-preset": "plugin-preset:import",
    "midi-mapping": "midi-mapping:import",
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
