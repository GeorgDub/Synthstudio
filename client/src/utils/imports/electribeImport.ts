/**
 * Synthstudio – electribeImport.ts
 *
 * KORG Electribe (.esx / .elst / .e2sallpat) Pattern-Parser.
 *
 * Format-Übersicht (vereinfacht):
 *   - Electribe 2 / Sampler (.e2sallpat / .e2spat):
 *     Container mit mehreren Patterns. Header: "KORG"-Magic + Version.
 *   - ESX-1 (.esx-Endung als ZIP-Container):
 *     SmartMedia/CompactFlash-Image mit Pattern-Bank.
 *
 *  Da das echte Korg-Format proprietär und teilweise binär ist, extrahiert
 *  dieser Parser:
 *    - Magic-Validierung
 *    - BPM aus festem Offset (variiert pro Version)
 *    - Pattern-Namen aus ASCII-Strings
 *
 *  Step-Daten sind in der Praxis ohne offizielle Spec nicht zuverlässig
 *  extrahierbar. Heuristische Step-Erkennung wird als Fallback genutzt.
 */

import type { ImportResult, ImportedPattern, ImportedPart } from "./types";
import { ImportError } from "./types";
import { parseEsxBank, type EsxBank } from "../korg/esxParser";
import { convertEsxPatternsToSynthstudio } from "../korg/esxPatternConvert";
import { decodePatternBody, type E2PatternDecoded } from "../korg/e2Sysex";
// ─── Echter E2/E2S-Decode-Pfad (.e2sallpat / .e2spat) ────────────────────────
// Nutzt den verifizierten `decodePatternBody` (Name/BPM/Steps/Osc). Layout-
// Konstanten kommen aus der gemeinsamen Quelle e2Layout.ts (nicht mehr lokal
// dupliziert). E2-allpat: 250 Bodies @ 0x10100 + i*0x4000; ein einzelnes
// .e2spat trägt den 0x100-KORG-Header vor dem 0x4000-Body.
import {
  E2_ALLPAT_PATTERN_OFFSET,
  E2_ALLPAT_PATTERN_STRIDE as E2_PATTERN_STRIDE,
  E2_ALLPAT_SLOT_COUNT as E2_ALLPAT_PATTERN_COUNT,
  E2_FILE_HEADER_SIZE as E2_FILE_HEADER,
} from "../korg/e2Layout";

function e2PartToImported(
  part: E2PatternDecoded["parts"][number],
  index: number
): ImportedPart {
  const label = part.sampleRef > 0 ? `#${part.sampleRef}` : `Part ${index + 1}`;
  return {
    name: label,
    sampleName: part.sampleRef > 0 ? label : undefined,
    volume: part.volume / 127,
    pan: (part.pan - 64) / 64, // Hinweis: pan@0x22 unbestätigt (nur Anzeige-Import)
    steps: part.steps.map(s => ({ active: s.active, velocity: s.velocity })),
  };
}

function e2DecodedToImported(dec: E2PatternDecoded): ImportedPattern {
  return {
    name: dec.name || "E2 Pattern",
    stepCount: dec.stepLength,
    bpm: dec.bpm,
    parts: dec.parts.map(e2PartToImported),
  };
}

/** true, wenn ein Pattern echten Inhalt trägt (aktive Steps oder ein Name). */
function e2HasContent(dec: E2PatternDecoded): boolean {
  if (dec.name.trim().length > 0) return true;
  return dec.parts.some(p => p.activeCount > 0);
}

/**
 * Dekodiert eine E2/E2S-Pattern-Datei zu einem ImportResult mit ECHTEN Steps.
 * Leere/Init-Patterns werden übersprungen; wenn alles leer ist, bleibt Pattern 0
 * erhalten, damit der Import nicht still leer ist. Pure Funktion (unit-testbar).
 */
export function e2sAllpatToImportResult(
  buffer: Uint8Array,
  fileName: string
): ImportResult {
  const decoded: E2PatternDecoded[] = [];
  const isAllpat =
    buffer.length >= E2_ALLPAT_PATTERN_OFFSET + E2_PATTERN_STRIDE; // mind. 1 allpat-Slot
  if (isAllpat) {
    for (let i = 0; i < E2_ALLPAT_PATTERN_COUNT; i++) {
      const off = E2_ALLPAT_PATTERN_OFFSET + i * E2_PATTERN_STRIDE;
      if (off + E2_PATTERN_STRIDE > buffer.length) break;
      decoded.push(
        decodePatternBody(buffer.subarray(off, off + E2_PATTERN_STRIDE))
      );
    }
  } else {
    // Einzel-.e2spat: 0x100-Header vor dem Body (falls groß genug), sonst roh.
    const body =
      buffer.length >= E2_FILE_HEADER + E2_PATTERN_STRIDE
        ? buffer.subarray(E2_FILE_HEADER, E2_FILE_HEADER + E2_PATTERN_STRIDE)
        : buffer;
    decoded.push(decodePatternBody(body));
  }

  let kept = decoded.filter(e2HasContent);
  if (kept.length === 0 && decoded.length > 0) kept = [decoded[0]];
  const patterns = kept.map(e2DecodedToImported);

  return {
    sourceFormat: "elst",
    fileName,
    bpm: patterns[0]?.bpm,
    patterns,
    warnings: [
      `E2/E2S-Bank dekodiert: ${patterns.length} Pattern(s) mit echten Steps ` +
        `(via verifiziertem decodePatternBody). Sample-Audio wird nicht verlinkt — ` +
        `nur Osc-/Sample-Referenzen (#NNN).`,
    ],
  };
}

// ─── Datei-Endung → Variante ──────────────────────────────────────────────────

function detectVariant(fileName: string): "esx" | "elst" {
  const lower = fileName.toLowerCase();
  if (
    lower.endsWith(".elst") ||
    lower.endsWith(".e2spat") ||
    lower.endsWith(".e2sallpat")
  ) {
    return "elst";
  }
  return "esx";
}

// ─── ASCII-Strings extrahieren ──────────────────────────────────────────────

function extractAsciiStrings(buffer: Uint8Array, minLength = 4): string[] {
  const result: string[] = [];
  let current = "";
  for (let i = 0; i < buffer.length; i++) {
    const c = buffer[i];
    // Druckbare ASCII (Buchstaben, Ziffern, Bindestriche, Leerzeichen)
    if (c >= 0x20 && c <= 0x7e) {
      current += String.fromCharCode(c);
    } else {
      if (current.length >= minLength) result.push(current);
      current = "";
    }
  }
  if (current.length >= minLength) result.push(current);
  return result;
}

// ─── BPM heuristisch finden ──────────────────────────────────────────────────

function findBpm(view: DataView): number | undefined {
  // Suche nach 2- oder 4-Byte-Werten die plausibel als BPM aussehen
  // (40–250 BPM mit Dezimalstellen, gespeichert als BPM*10 oder *100)
  for (let i = 0; i < view.byteLength - 4; i++) {
    const u16 = view.getUint16(i, true);
    if (u16 >= 400 && u16 <= 2500) {
      const bpm = u16 / 10;
      if (Number.isFinite(bpm)) return bpm;
    }
  }
  return undefined;
}

// ─── Echter ESX-1-Bank-Pfad (Steps werden dekodiert, nicht geraten) ──────────

/**
 * Bridge: geparste ESX-1-Bank → ImportResult mit ECHTEN Step-Daten.
 *
 * Synth.md-Fix: der alte heuristische Pfad (unten) erzeugte nur leere
 * Step-Templates ("Steps musst du manuell rekonstruieren") — beim Import über
 * den ProjectManager sah man deshalb nur Part-Slots, aber keine Steps. Diese
 * Bridge nutzt stattdessen den vollständigen KORG-Parser (`parseEsxBank` →
 * `convertEsxPatternsToSynthstudio`), der die Trigger pro Step real dekodiert —
 * exakt wie der KORG-Bank-Modal-Pfad. Pure Funktion (kein Binär-Parsing) →
 * direkt unit-testbar mit handgebauten EsxBank-Objekten.
 *
 * Hinweis: Sample-Audio (Blob-URLs) wird hier NICHT verlinkt — das ImportResult-
 * Format trägt nur `sampleName`. Für hörbare Samples ist der KORG-Bank-Modal-
 * Pfad zuständig (`enrichPatternWithSampleUrls`). Eine Warnung weist darauf hin.
 */
export function esxBankToImportResult(
  bank: EsxBank,
  fileName: string
): ImportResult {
  const converted = convertEsxPatternsToSynthstudio(bank.patterns);

  // v3.287: echte Sample-Namen aus der Bank per Slot-Index (== part.sampleId).
  const nameBySampleId = new Map<number, string>();
  for (const s of [...bank.monoSamples, ...bank.stereoSamples]) {
    if (s.name) nameBySampleId.set(s.index, s.name);
  }

  const patterns: ImportedPattern[] = converted.map(
    (pat): ImportedPattern => ({
      name: pat.name,
      stepCount: pat.stepCount,
      bpm: pat.bpm,
      parts: pat.drumParts.map((dp): ImportedPart => {
        // Echter Sample-Name aus der Bank, sonst der generische Hint.
        const realName = nameBySampleId.get(dp.sampleId);
        return {
          name: realName || dp.sampleHint,
          sampleName: realName || dp.sampleHint,
          // sampleId erhalten → der Controller kann das PCM des passenden
          // Bank-Slots als Blob-URL nachreichen (hörbares „In Sequenzer laden").
          sampleId: dp.sampleId,
          volume: dp.volume,
          pan: dp.pan,
          muted: dp.muted, // v3.287: Mute-Zustand aus dem ESX-Pattern.
          steps: dp.steps.map((active, i) => ({
            active,
            velocity: dp.velocities[i] ?? 100,
            // v3.286: Per-Step-Pitch (Synth/Keyboard-Melodie) durchreichen.
            pitch: dp.pitches[i] ?? 0,
          })),
        };
      }),
    })
  );

  const warnings: string[] = [];
  const sampleCount = bank.monoSamples.length + bank.stereoSamples.length;
  warnings.push(
    `ESX-1-Bank dekodiert: ${patterns.length} Pattern(s) mit echten Steps, ` +
      `${sampleCount} Sample(s) erkannt.`
  );
  if (sampleCount > 0) {
    warnings.push(
      "Sample-Referenzen (sampleId) sind pro Part erhalten — der Import-" +
        "Controller reicht die passenden Slot-Audios als Blob-URLs nach " +
        "(hoerbares In-Sequenzer-Laden)."
    );
  }
  warnings.push(...bank.warnings);

  return {
    sourceFormat: "esx",
    fileName,
    bpm: patterns[0]?.bpm,
    patterns,
    warnings,
  };
}

// ─── Hauptfunktion ────────────────────────────────────────────────────────────

export async function importElectribe(file: File): Promise<ImportResult> {
  const arrayBuffer = await file.arrayBuffer();
  const buffer = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  const variant = detectVariant(file.name);

  if (buffer.length < 16) {
    throw new ImportError("Datei zu klein für Electribe-Format", variant);
  }

  // Echter E2/E2S-Pfad (.e2sallpat / .e2spat): verifizierter decodePatternBody
  // statt Heuristik. Nur wenn er inhaltstragende Patterns findet, nutzen wir ihn.
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".e2sallpat") || lower.endsWith(".e2spat")) {
    try {
      const result = e2sAllpatToImportResult(buffer, file.name);
      if (
        result.patterns.some(p =>
          p.parts.some(pt => pt.steps.some(s => s.active))
        )
      ) {
        return result;
      }
    } catch {
      // Decode-Fehler → heuristischer Fallback unten.
    }
  }

  // Echter ESX-1-Pfad: den vollständigen KORG-Parser versuchen, der die
  // Step-Trigger real dekodiert. Nur wenn er Patterns findet, nutzen wir ihn;
  // sonst (E2S/.elst, leere Bank, unbekanntes Layout) fällt der Code auf den
  // heuristischen Pfad unten zurück.
  if (variant === "esx") {
    try {
      const bank = parseEsxBank(buffer, file.name);
      if (bank.patterns.length > 0) {
        return esxBankToImportResult(bank, file.name);
      }
    } catch {
      // Parser-Fehler → heuristischer Fallback unten.
    }
  }

  // Magic-Validierung (KORG-Header oder ZIP-Container)
  const magic = String.fromCharCode(buffer[0], buffer[1], buffer[2], buffer[3]);
  const isZip = magic === "PK\x03\x04";
  const isKorg = magic.includes("KORG") || magic.includes("FSC");
  const isRiff = magic === "RIFF";

  if (!isZip && !isKorg && !isRiff) {
    throw new ImportError(
      `Unbekanntes Electribe-Format. Magic: "${magic}". ` +
        `Unterstützt werden .esx (SmartMedia), .elst, .e2spat, .e2sallpat.`,
      variant
    );
  }

  const warnings: string[] = [];
  if (isZip) {
    warnings.push(
      "ESX-1 Pattern-Bank im ZIP-Container erkannt – derzeit wird nur die Datei-Liste extrahiert, keine Pattern-Daten."
    );
  }

  // BPM heuristisch ermitteln
  const bpm = findBpm(view);

  // Pattern-Namen aus ASCII-Strings extrahieren (typisch 8–12 Zeichen)
  const strings = extractAsciiStrings(buffer, 4)
    .filter(s => s.length <= 24)
    .filter(s => !/^(KORG|FSC|RIFF|WAVE|fmt|data|TONE)$/i.test(s));

  // Erste sinnvolle Strings als Pattern-Namen interpretieren
  const patternNames = strings.slice(0, 16).filter(s => /[a-zA-Z]/.test(s));

  // Default-Parts (Electribe hat typischerweise 16 Drum-Slots)
  const defaultPartNames = [
    "Kick 1",
    "Kick 2",
    "Snare 1",
    "Snare 2",
    "Clap",
    "Hi-Tom",
    "Lo-Tom",
    "Hi-Hat closed",
    "Hi-Hat open",
    "Crash",
    "Ride",
    "Perc 1",
    "Perc 2",
    "FX 1",
    "FX 2",
    "Synth",
  ];

  const patterns: ImportedPattern[] =
    patternNames.length > 0
      ? patternNames.map((name, i) => ({
          name: name.trim() || `Pattern ${i + 1}`,
          stepCount: 16,
          bpm,
          parts: defaultPartNames.slice(0, 8).map(
            (partName): ImportedPart => ({
              name: partName,
              steps: Array.from({ length: 16 }, () => ({ active: false })),
            })
          ),
        }))
      : [
          {
            name: file.name.replace(/\.(esx|elst|e2spat|e2sallpat)$/i, ""),
            stepCount: 16,
            bpm,
            parts: defaultPartNames.slice(0, 8).map(
              (partName): ImportedPart => ({
                name: partName,
                steps: Array.from({ length: 16 }, () => ({ active: false })),
              })
            ),
          },
        ];

  warnings.push(
    "Electribe-Step-Daten werden ohne offizielle Spec nicht zuverlässig extrahiert. " +
      "BPM + Pattern-Namen werden bestmöglich erkannt. Pattern-Slots werden als Templates erzeugt – " +
      "Steps musst du manuell rekonstruieren."
  );

  return {
    sourceFormat: variant,
    fileName: file.name,
    bpm,
    patterns,
    warnings,
  };
}
