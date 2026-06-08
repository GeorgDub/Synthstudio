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

// ─── Datei-Endung → Variante ──────────────────────────────────────────────────

function detectVariant(fileName: string): "esx" | "elst" {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".elst") || lower.endsWith(".e2spat") || lower.endsWith(".e2sallpat")) {
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
    if ((c >= 0x20 && c <= 0x7e)) {
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
export function esxBankToImportResult(bank: EsxBank, fileName: string): ImportResult {
  const converted = convertEsxPatternsToSynthstudio(bank.patterns);

  const patterns: ImportedPattern[] = converted.map((pat): ImportedPattern => ({
    name: pat.name,
    stepCount: pat.stepCount,
    bpm: pat.bpm,
    parts: pat.drumParts.map((dp): ImportedPart => ({
      name: dp.sampleHint,
      sampleName: dp.sampleHint,
      volume: dp.volume,
      pan: dp.pan,
      steps: dp.steps.map((active, i) => ({
        active,
        velocity: dp.velocities[i] ?? 100,
      })),
    })),
  }));

  const warnings: string[] = [];
  const sampleCount = bank.monoSamples.length + bank.stereoSamples.length;
  warnings.push(
    `ESX-1-Bank dekodiert: ${patterns.length} Pattern(s) mit echten Steps, ` +
    `${sampleCount} Sample(s) erkannt.`,
  );
  if (sampleCount > 0) {
    warnings.push(
      "Sample-Audio wird über diesen Import-Pfad NICHT verlinkt — für hörbare " +
      "Slots die Datei stattdessen über die KORG-Bank öffnen (Samples + Pattern + Audio).",
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
      variant,
    );
  }

  const warnings: string[] = [];
  if (isZip) {
    warnings.push(
      "ESX-1 Pattern-Bank im ZIP-Container erkannt – derzeit wird nur die Datei-Liste extrahiert, keine Pattern-Daten.",
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
    "Kick 1", "Kick 2", "Snare 1", "Snare 2",
    "Clap", "Hi-Tom", "Lo-Tom", "Hi-Hat closed",
    "Hi-Hat open", "Crash", "Ride", "Perc 1",
    "Perc 2", "FX 1", "FX 2", "Synth",
  ];

  const patterns: ImportedPattern[] = patternNames.length > 0
    ? patternNames.map((name, i) => ({
        name: name.trim() || `Pattern ${i + 1}`,
        stepCount: 16,
        bpm,
        parts: defaultPartNames.slice(0, 8).map((partName): ImportedPart => ({
          name: partName,
          steps: Array.from({ length: 16 }, () => ({ active: false })),
        })),
      }))
    : [{
        name: file.name.replace(/\.(esx|elst|e2spat|e2sallpat)$/i, ""),
        stepCount: 16,
        bpm,
        parts: defaultPartNames.slice(0, 8).map((partName): ImportedPart => ({
          name: partName,
          steps: Array.from({ length: 16 }, () => ({ active: false })),
        })),
      }];

  warnings.push(
    "Electribe-Step-Daten werden ohne offizielle Spec nicht zuverlässig extrahiert. " +
    "BPM + Pattern-Namen werden bestmöglich erkannt. Pattern-Slots werden als Templates erzeugt – " +
    "Steps musst du manuell rekonstruieren.",
  );

  return {
    sourceFormat: variant,
    fileName: file.name,
    bpm,
    patterns,
    warnings,
  };
}
