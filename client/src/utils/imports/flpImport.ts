/**
 * Synthstudio – flpImport.ts
 *
 * Vereinfachter FL Studio (.flp) Projekt-Parser.
 *
 * Format-Übersicht:
 *   Datei beginnt mit "FLhd" Header-Chunk (6 Bytes nach Chunk-Header):
 *     - format (uint16): 0 = Pattern, 1 = Score
 *     - nChannels (uint16)
 *     - ppq (uint16): Pulses per Quarter Note
 *
 *   Danach "FLdt" Data-Chunk mit Events:
 *     Events haben einen Event-ID (uint8) + variable Datengröße:
 *       0x00-0x3F: 1 Byte Daten   (z.B. Tempo: 0x9C)
 *       0x40-0x7F: 2 Bytes Daten
 *       0x80-0xBF: 4 Bytes Daten  (z.B. Tempo Float)
 *       0xC0-0xFF: variable Länge (TEXT events – Pattern-Namen etc.)
 *
 * Diese Implementierung extrahiert nur:
 *   - PPQ + Tempo
 *   - Pattern-Namen
 *   - Pattern-Nummer
 *
 * Vollständige Step-Daten würden komplexes XXSubChannel-Parsing brauchen
 * (Channel-Settings, Pattern-Events, Piano-Roll-Notes). Das ist als
 * zukünftige Erweiterung markiert.
 */

import type { ImportResult, ImportedPattern, ImportedPart, ImportedStep, ImportedMelodicPart, ImportedMelodicNote } from "./types";
import { ImportError } from "./types";
import {
  parseFlp as parseFlpFull,
  calculateBarCount,
  groupNotesByBar,
  flpPositionToStep,
  type FlpNote,
} from "../flpImport";

// ─── Reader ──────────────────────────────────────────────────────────────────

class FlpReader {
  private view: DataView;
  private offset = 0;

  constructor(buffer: ArrayBuffer) {
    this.view = new DataView(buffer);
  }

  get remaining() {
    return this.view.byteLength - this.offset;
  }

  readString(n: number): string {
    let s = "";
    for (let i = 0; i < n; i++) {
      s += String.fromCharCode(this.view.getUint8(this.offset + i));
    }
    this.offset += n;
    return s;
  }

  readU8(): number {
    return this.view.getUint8(this.offset++);
  }

  readU16(): number {
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }

  readU32(): number {
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  /** Liest eine variable-length-Quantity (LEB128) für TEXT-Events. */
  readVarLen(): number {
    let result = 0;
    let shift = 0;
    while (true) {
      const byte = this.readU8();
      result |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
      if (shift > 28) throw new ImportError("VarLen overflow", "flp");
    }
    return result;
  }

  /** Liest n Bytes als Latin-1 String (FLP nutzt teilweise UTF-16LE für TEXT). */
  readUtf16Le(n: number): string {
    let s = "";
    for (let i = 0; i < n; i += 2) {
      const code = this.view.getUint16(this.offset + i, true);
      if (code === 0) break;
      s += String.fromCharCode(code);
    }
    this.offset += n;
    return s;
  }

  skip(n: number): void {
    this.offset += n;
  }
}

// ─── Hauptfunktion ────────────────────────────────────────────────────────────

const STEP_COUNT = 16;
/** Max. Bars die EIN FL-Pattern erzeugen darf (lange Arrangement-Patterns). */
const MAX_BARS = 64;
/** Sicherheits-Obergrenze für die Gesamtzahl erzeugter Synthstudio-Patterns.
 *  Großzügig, da pro Pattern nur dessen genutzte Channels als Parts entstehen
 *  (≈4 KB/Pattern) — reale große Projekte (~360 Patterns) passen vollständig. */
const MAX_TOTAL_PATTERNS = 512;
/** Fallback-Part-Anzahl nur für den degenerierten "keine Notes"-Fall. */
const DEFAULT_PART_COUNT = 8;

interface ChannelPartMeta {
  name: string;
  sampleName?: string;
}

function emptyPart(name: string, stepCount: number, sampleName?: string): ImportedPart {
  const steps: ImportedStep[] = [];
  for (let i = 0; i < stepCount; i++) steps.push({ active: false, velocity: 100 });
  return sampleName ? { name, sampleName, steps } : { name, steps };
}

/**
 * Baut die Parts EINES Bars. Jeder genutzte FL-Channel bekommt einen eigenen
 * Part in einer über alle Patterns konsistenten Reihenfolge (channelOrder),
 * damit Layout + Part-Index stabil sind und das Melodic-Routing exakt denselben
 * Index verwenden kann (kein modulo-Folding mehr auf 8 Parts). Notes werden
 * direkt per channelToPartIndex platziert.
 */
function buildPartsForBar(
  barNotes: FlpNote[],
  ppq: number,
  channelOrder: number[],
  channelToPartIndex: Map<number, number>,
  channelMeta: Map<number, ChannelPartMeta>,
): ImportedPart[] {
  const parts: ImportedPart[] = channelOrder.map(ch => {
    const meta = channelMeta.get(ch);
    return emptyPart(meta?.name ?? `Ch ${ch}`, STEP_COUNT, meta?.sampleName);
  });
  for (const note of barNotes) {
    const partIdx = channelToPartIndex.get(note.channel);
    if (partIdx === undefined) continue;
    const step = flpPositionToStep(note.position, ppq) % STEP_COUNT;
    // pitch wird mitgeführt (Drum-Machine ignoriert es, Piano-Roll/MIDI nutzen es).
    parts[partIdx].steps[step] = { active: true, velocity: note.velocity, pitch: note.key };
  }
  return parts;
}

/**
 * Liest das initiale Projekt-Tempo. FL 11+ speichert es als FineTempo-Event
 * 0x9C (FLP_Int+28, DWORD = BPM × 1000); das alte WORD-Tempo 0x42 dient als
 * Fallback. Vorher wurde 0x9C fälschlich im WORD-Zweig geprüft und nie
 * getroffen → bpm blieb undefined (verifiziert: reale Datei liefert 190000 → 190).
 */
function readFlpTempo(arrayBuffer: ArrayBuffer): number | undefined {
  const reader = new FlpReader(arrayBuffer);
  reader.readString(4); reader.readU32();              // FLhd + size
  reader.readU16(); reader.readU16(); reader.readU16(); // format, nChannels, ppq
  reader.readString(4); reader.readU32();              // FLdt + size
  const plausible = (v: number) => (v >= 10 && v <= 999 ? v : undefined);
  let bpm: number | undefined;
  let wordTempo: number | undefined;
  while (reader.remaining > 0) {
    const eventId = reader.readU8();
    if (eventId < 0x40) {
      reader.readU8();
    } else if (eventId < 0x80) {
      const d = reader.readU16();
      if (eventId === 0x42 && wordTempo === undefined) wordTempo = d; // alt-FL WORD-Tempo
    } else if (eventId < 0xC0) {
      const d = reader.readU32();
      if (eventId === 0x9C && bpm === undefined) {
        bpm = plausible(d > 1000 ? d / 1000 : d);
      }
    } else {
      const len = reader.readVarLen();
      if (len > reader.remaining) break;
      reader.skip(len);
    }
  }
  return bpm ?? (wordTempo !== undefined ? plausible(wordTempo > 1000 ? wordTempo / 1000 : wordTempo) : undefined);
}

/**
 * Liefert pro FL-Channel die Menge der gespielten Pitches (MIDI-Keys).
 * Ein Channel mit nur einer Pitch ist drum-artig (gleicher Sample-Trigger),
 * ein Channel mit ≥2 Pitches ist melodisch (Synth/Sampler mit Notes).
 */
export function detectChannelPitches(notes: FlpNote[]): Map<number, Set<number>> {
  const map = new Map<number, Set<number>>();
  for (const n of notes) {
    let set = map.get(n.channel);
    if (!set) {
      set = new Set();
      map.set(n.channel, set);
    }
    set.add(n.key);
  }
  return map;
}

/**
 * Median einer Zahlenliste — bei gerader Länge gerundeter Mittelwert der
 * zwei mittleren Werte, bei ungerader Länge der mittlere Wert. Leerer Input
 * liefert C4 (60) als sicheren Default. Pure Funktion, public für Tests.
 *
 * Verwendung: Pitch-Median pro ImportedMelodicPart als baseNote, damit der
 * Piano-Roll-View nach dem Import auf den tatsächlichen Notenbereich
 * zentriert (FLP-MELODIC-POLISH v1.69).
 */
export function pitchMedian(pitches: number[]): number {
  if (pitches.length === 0) return 60;
  const sorted = [...pitches].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Konvertiert melodische FL-Channels in strukturierte `ImportedMelodicPart`s.
 * Phase 1 (v1.65): nur Extraktion — keinem Konsumenten zugewiesen.
 * Phase 2: MelodicPart-Routing im ProjectManager → echte Pattern-Erzeugung.
 *
 * Position-Umrechnung: PPQ-Ticks → Steps (1/16, Float erlaubt für off-grid).
 */
export function buildMelodicParts(
  notes: FlpNote[],
  ppq: number,
  channelNames: Map<number, string> = new Map(),
): ImportedMelodicPart[] {
  const pitchesByChannel = detectChannelPitches(notes);
  const ticksPerStep = ppq / 4;
  if (ticksPerStep <= 0) return [];

  const parts: ImportedMelodicPart[] = [];
  for (const [channel, pitches] of pitchesByChannel) {
    if (pitches.size < 2) continue; // drum-like — skip
    const channelNotes = notes.filter(n => n.channel === channel);
    const melodicNotes: ImportedMelodicNote[] = channelNotes
      .map<ImportedMelodicNote>(n => ({
        startStep: n.position / ticksPerStep,
        durationSteps: n.duration / ticksPerStep,
        pitch: n.key,
        velocity: n.velocity,
      }))
      .sort((a, b) => a.startStep - b.startStep);
    parts.push({
      sourceChannel: channel,
      name: channelNames.get(channel) ?? `Channel ${channel}`,
      notes: melodicNotes,
      // FLP-MELODIC-POLISH v1.69: Piano-Roll-View zentriert auf diesen Pitch
      baseNote: pitchMedian(melodicNotes.map(n => n.pitch)),
    });
  }
  return parts;
}

export async function importFlp(file: File): Promise<ImportResult> {
  const arrayBuffer = await file.arrayBuffer();

  // FLP-IMPORT v1.62: nutzt den vollwertigen Parser aus utils/flpImport.ts
  // (Headers + NotesEvents 0xE0/0xE7 + Channel-Namen 0xC0 + Sample-Namen 0xC4).
  let parsed;
  try {
    parsed = parseFlpFull(arrayBuffer);
  } catch (err) {
    throw new ImportError((err as Error).message, "flp");
  }

  const warnings: string[] = [];
  const bpm = readFlpTempo(arrayBuffer);
  const ppq = parsed.header.ppq;
  const filenameStem = file.name.replace(/\.flp$/i, "");

  const nonEmptyPatterns = parsed.patterns.filter(p => p.notes.length > 0);

  if (nonEmptyPatterns.length === 0) {
    warnings.push("Keine Notes im FLP gefunden — FL Studio Versionen vor 11 oder leere Projekte werden nicht unterstützt.");
    return {
      sourceFormat: "flp",
      fileName: file.name,
      bpm,
      patterns: [{
        name: filenameStem,
        stepCount: STEP_COUNT,
        bpm,
        parts: Array.from({ length: DEFAULT_PART_COUNT }, (_, i) => emptyPart(`Part ${i + 1}`, STEP_COUNT)),
      }],
      warnings,
    };
  }

  // ── Channel-Metadaten (Name 0xC0 + Sample 0xC4) global pro FL-Channel ────────
  const channelMeta = new Map<number, ChannelPartMeta>();
  const channelMetaFor = (ch: number): ChannelPartMeta => {
    let meta = channelMeta.get(ch);
    if (!meta) {
      const name = parsed.channelNames.get(ch);
      const sampleName = parsed.sampleNames.get(ch);
      meta = { name: name && name.length > 0 ? name : (sampleName ?? `Ch ${ch}`), sampleName };
      channelMeta.set(ch, meta);
    }
    return meta;
  };

  // ── Pro FL-Pattern: NUR die in DIESEM Pattern genutzten Channels werden zu
  // eigenen Parts (FL-treu: jedes Pattern bekommt seine echten Channels, kein
  // 70-Part-Rack in jedem Pattern → ~10× kleinere Projektgröße). Der Part-Index
  // ist innerhalb eines FL-Patterns konstant; Melodic-Notes werden auf konkrete
  // (patternIndex, partIndex, step-im-Bar)-Koordinaten aufgelöst. ────────────────
  const patternsList: ImportedPattern[] = [];
  const melodicParts: ImportedMelodicPart[] = [];
  const melodicChannels = new Set<number>();
  const allUsedChannels = new Set<number>();
  let droppedBeyondBars = 0;
  let truncated = false;

  for (const flPattern of nonEmptyPatterns) {
    if (patternsList.length >= MAX_TOTAL_PATTERNS) { truncated = true; break; }

    // Channel-Set dieses FL-Patterns (sortiert → stabiler Part-Index pro Pattern)
    const patChannels = [...new Set(flPattern.notes.map(n => n.channel))].sort((a, b) => a - b);
    const channelToPartIndex = new Map<number, number>(patChannels.map((ch, i) => [ch, i]));
    for (const ch of patChannels) {
      allUsedChannels.add(ch);
      channelMetaFor(ch); // Metadaten cachen
    }

    const totalBars = Math.min(MAX_BARS, calculateBarCount(flPattern.notes, ppq, STEP_COUNT));
    const byBar = groupNotesByBar(flPattern.notes, ppq, STEP_COUNT);

    const parsedName = parsed.patternNames.get(flPattern.index);
    const baseName = parsedName && parsedName.length > 0
      ? parsedName
      : (nonEmptyPatterns.length === 1 ? filenameStem : `Pattern ${flPattern.index}`);

    const firstBarPatternIndex = patternsList.length;
    let imported = 0;
    let barsCreated = 0;
    for (let bar = 0; bar < totalBars; bar++) {
      if (patternsList.length >= MAX_TOTAL_PATTERNS) { truncated = true; break; }
      const barNotes = byBar.get(bar) ?? [];
      imported += barNotes.length;
      patternsList.push({
        name: totalBars === 1 ? baseName : `${baseName} bar ${bar + 1}`,
        stepCount: STEP_COUNT,
        bpm,
        parts: buildPartsForBar(barNotes, ppq, patChannels, channelToPartIndex, channelMeta),
      });
      barsCreated++;
    }
    droppedBeyondBars += flPattern.notes.length - imported;

    // Melodische Parts dieses FL-Patterns (Pitch-Varianz ≥2) → konkrete
    // (patternIndex, partIndex, step-im-Bar)-Auflösung. Notes außerhalb der
    // tatsächlich erzeugten Bars werden verworfen (kein Cross-Pattern-Bleed).
    const mp = buildMelodicParts(flPattern.notes, ppq, parsed.channelNames);
    for (const part of mp) {
      melodicChannels.add(part.sourceChannel);
      const partIdx = channelToPartIndex.get(part.sourceChannel);
      if (partIdx === undefined) continue;
      const resolved = part.notes
        .map(n => {
          const bar = Math.floor(n.startStep / STEP_COUNT);
          return { ...n, patternIndex: firstBarPatternIndex + bar, startStep: n.startStep - bar * STEP_COUNT };
        })
        .filter(n => n.patternIndex < firstBarPatternIndex + barsCreated);
      if (resolved.length === 0) continue;
      melodicParts.push({ ...part, targetPartIndex: partIdx, notes: resolved });
    }
  }

  // ── Warnungen / Hinweise ─────────────────────────────────────────────────────
  const distinctWithSample = [...allUsedChannels].filter(ch => channelMeta.get(ch)?.sampleName).length;
  warnings.push(
    `${nonEmptyPatterns.length} FL-Pattern(s) → ${patternsList.length} Pattern(s); ` +
    `${allUsedChannels.size} genutzte FL-Channel(s) als Parts angelegt (pro Pattern nur dessen eigene Channels).`,
  );
  if (distinctWithSample > 0) {
    warnings.push(
      `${distinctWithSample}/${allUsedChannels.size} Channel(s) tragen eine Sample-Referenz (Name übernommen). ` +
      `Die .flp enthält kein Audio — die Sample-Dateien werden, falls vorhanden, aus dem Projektordner nachgeladen.`,
    );
  }
  if (melodicChannels.size > 0) {
    warnings.push(`${melodicChannels.size} melodische Channel(s) zusätzlich in den Piano Roll geroutet (16-Step-quantisiert).`);
  }
  if (droppedBeyondBars > 0) {
    warnings.push(`${droppedBeyondBars} Note(s) jenseits ${MAX_BARS} Bars pro Pattern ignoriert.`);
  }
  if (truncated) {
    warnings.push(`Pattern-Limit ${MAX_TOTAL_PATTERNS} erreicht — weitere Patterns nicht importiert.`);
  }

  return {
    sourceFormat: "flp",
    fileName: file.name,
    bpm,
    patterns: patternsList,
    melodicParts: melodicParts.length > 0 ? melodicParts : undefined,
    warnings,
  };
}
