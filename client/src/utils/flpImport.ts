/**
 * client/src/utils/flpImport.ts
 *
 * FL-Studio .flp Project-Parser.
 *
 * Das FLP-Format ist proprietär aber community-dokumentiert
 * (siehe https://github.com/monadgroup/PyFLP). Wir extrahieren NUR:
 *   - Header (Format, PPQ)
 *   - Pattern-Events (NotesEvent, 0xE7 → 24-byte note records)
 *
 * Out of scope: Samples, Plugins, Automation, Mixer, Arrangement.
 *
 * Format-Übersicht:
 *   Header (14 Bytes):
 *     "FLhd"           4 bytes
 *     header-size      4 bytes LE (= 6)
 *     format           2 bytes LE (0=full, 1=score, 2=automation)
 *     n-channels       2 bytes LE
 *     ppq              2 bytes LE (pulses per quarter, typ. 96)
 *
 *   Data Chunk:
 *     "FLdt"           4 bytes
 *     data-size        4 bytes LE
 *     events           variable
 *
 *   Event-IDs sind 1 Byte; die ID bestimmt die Payload-Größe:
 *     0x00–0x3F  →  1 Byte data         (BYTE)
 *     0x40–0x7F  →  2 Bytes data LE     (WORD)
 *     0x80–0xBF  →  4 Bytes data LE     (DWORD)
 *     0xC0–0xFF  →  varlen size + data  (TEXT/DATA)
 *
 *   varlen: MIDI-style 7-bit groups, high bit = continuation.
 *
 *   Wichtige Event-IDs:
 *     0x4F (79)  NewPattern         WORD pattern-index (1-based)
 *     0xC1 (193) PatternName        TEXT (null-terminated UTF-16LE? oder ANSI?)
 *     0xE7 (231) NotesEvent         DATA array of 24-byte note records
 *
 *   Note-Record (24 Bytes):
 *     position     4 bytes LE int     (in PPQ ticks ab Pattern-Start)
 *     flags        2 bytes LE
 *     channel      2 bytes LE         (FL-channel-index)
 *     duration     4 bytes LE int     (in PPQ ticks)
 *     key          1 byte             (MIDI note number)
 *     fine-pitch   1 byte
 *     u1           1 byte
 *     release      1 byte
 *     midi-channel 1 byte
 *     pan          1 byte
 *     velocity     1 byte             (0–127)
 *     mod-x        1 byte
 *     mod-y        1 byte
 *     _padding     3 bytes
 */

// ─── Typen ────────────────────────────────────────────────────────────────────

export interface FlpHeader {
  format: number;
  numChannels: number;
  ppq: number;
}

export interface FlpNote {
  position: number;    // PPQ ticks
  channel: number;
  duration: number;
  key: number;         // MIDI note number 0-127
  velocity: number;    // 0-127
}

export interface FlpPattern {
  index: number;       // 1-based wie in FL Studio
  notes: FlpNote[];
}

export interface FlpParsed {
  header: FlpHeader;
  patterns: FlpPattern[];
  /**
   * Pro FL-Channel-Index der extrahierte Anzeigename aus dem 0xC3
   * TEXT_CHANNEL_NAME (alias TEXT_DEFPLUGNAME)-Event. Ein Channel ohne
   * Name-Event taucht hier nicht auf. Hilft beim Mapping
   * FL-Channel → Synthstudio-Drum-Part / Melodic-Part-Anzeigename
   * (FLP-CHANNEL-NAMES Phase 3, v1.68).
   */
  channelNames: Map<number, string>;
}

// ─── Reader-Helper ────────────────────────────────────────────────────────────

class Reader {
  pos = 0;
  constructor(private view: DataView) {}

  readBytes(n: number): Uint8Array {
    const out = new Uint8Array(this.view.buffer, this.view.byteOffset + this.pos, n);
    this.pos += n;
    return out;
  }
  readU8(): number {
    const v = this.view.getUint8(this.pos);
    this.pos += 1;
    return v;
  }
  readU16LE(): number {
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }
  readU32LE(): number {
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  readVarLen(): number {
    let result = 0;
    let shift = 0;
    while (this.pos < this.view.byteLength) {
      const b = this.readU8();
      result |= (b & 0x7f) << shift;
      shift += 7;
      if ((b & 0x80) === 0) return result;
    }
    return result;
  }
  readAscii(n: number): string {
    const bytes = this.readBytes(n);
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return s;
  }
  eof(): boolean {
    return this.pos >= this.view.byteLength;
  }
}

// ─── Note-Record Parser ──────────────────────────────────────────────────────

/** Parsed ein 24-Byte Note-Record (siehe Format-Doku oben). */
export function parseNoteRecord(view: DataView, offset: number): FlpNote {
  return {
    position: view.getUint32(offset + 0, true),
    channel:  view.getUint16(offset + 6, true),
    duration: view.getUint32(offset + 8, true),
    key:      view.getUint8(offset + 12),
    velocity: view.getUint8(offset + 18),
  };
}

/** Parsed einen NotesEvent (Array von 24-Byte Note-Records). */
export function parseNotesEvent(data: Uint8Array): FlpNote[] {
  if (data.length % 24 !== 0) {
    // Manche FLP-Versionen haben andere Note-Sizes. Wir verwenden 24-byte
    // (FL 12+). Bei mismatch geben wir an was wir können zurück.
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const notes: FlpNote[] = [];
  const count = Math.floor(data.length / 24);
  for (let i = 0; i < count; i++) {
    notes.push(parseNoteRecord(view, i * 24));
  }
  return notes;
}

// ─── TEXT-Decoder (UTF-16LE vs Latin-1) ──────────────────────────────────────

/**
 * Dekodiert ein TEXT-Event-Payload aus einem FLP-File. FL Studio nutzt je nach
 * Version + Event-Typ unterschiedliche Encodings:
 *   - FL 11+: UTF-16LE für die meisten User-strings (Channel-Namen, Pattern-Namen)
 *   - Ältere Versionen / interne Strings: ASCII / Latin-1
 * Beide sind null-terminated.
 *
 * Heuristik: ist die Payload-Länge gerade UND mindestens 25% der odd-indexed
 * Bytes sind 0 → wir interpretieren als UTF-16LE. Sonst Latin-1.
 *
 * Pure Funktion — public exportiert für Unit-Tests.
 */
export function decodeFlpText(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";

  // Erkenne UTF-16LE auf den ROHEN bytes (vor Null-Trimming):
  // ASCII-Chars in UTF-16LE haben ein 0-Byte hinter dem ASCII-Byte. Wenn
  // bytes[1] === 0 UND (length<4 ODER bytes[3] === 0) → UTF-16LE.
  // Diese Heuristik unterscheidet zuverlässig zwischen:
  //   "Kick" ASCII = [4b 69 63 6b]                → bytes[1]=0x69 → Latin-1
  //   "Kick" UTF-16LE = [4b 00 69 00 63 00 6b 00] → bytes[1]=0,bytes[3]=0 → UTF-16LE
  //   "Snare\0\0\0" ASCII = [53 6e 61 72 65 00 00 00] → bytes[1]=0x6e → Latin-1
  const isUtf16Le =
    bytes.length % 2 === 0 &&
    bytes.length >= 2 &&
    bytes[1] === 0 &&
    (bytes.length < 4 || bytes[3] === 0);

  if (isUtf16Le) {
    let s = "";
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      const code = bytes[i] | (bytes[i + 1] << 8);
      if (code === 0) break;
      s += String.fromCharCode(code);
    }
    return s;
  }

  let s = "";
  for (const b of bytes) {
    if (b === 0) break;
    s += String.fromCharCode(b);
  }
  return s;
}

// ─── Haupt-Parser ─────────────────────────────────────────────────────────────

/**
 * Parsed einen .flp Binär-Buffer und gibt strukturierte Patterns zurück.
 *
 * Wirft Error bei invalid Header.
 */
export function parseFlp(buffer: ArrayBuffer): FlpParsed {
  const view = new DataView(buffer);
  const reader = new Reader(view);

  // ── Header ─────────────────────────────────────────────────────────────────
  const magicHdr = reader.readAscii(4);
  if (magicHdr !== "FLhd") {
    throw new Error(`FLP: ungültige Header-Signatur "${magicHdr}" (erwartet "FLhd")`);
  }
  const hdrSize = reader.readU32LE();
  if (hdrSize !== 6) {
    throw new Error(`FLP: unerwartete Header-Größe ${hdrSize} (erwartet 6)`);
  }
  const format = reader.readU16LE();
  const numChannels = reader.readU16LE();
  const ppq = reader.readU16LE();

  const header: FlpHeader = { format, numChannels, ppq };

  // ── Data Chunk ────────────────────────────────────────────────────────────
  const magicData = reader.readAscii(4);
  if (magicData !== "FLdt") {
    throw new Error(`FLP: ungültige Data-Signatur "${magicData}" (erwartet "FLdt")`);
  }
  const dataSize = reader.readU32LE();
  const dataEnd = reader.pos + dataSize;

  // ── Event-Loop ────────────────────────────────────────────────────────────
  const patternsByIndex = new Map<number, FlpPattern>();
  const channelNames = new Map<number, string>();
  let currentPatternIndex = 0; // FL state — "currently selected" pattern
  let currentChannel = -1;     // FL state — "currently selected" channel (gesetzt durch 0x40 NewChannel)

  while (reader.pos < dataEnd && !reader.eof()) {
    const eventId = reader.readU8();

    if (eventId < 0x40) {
      // BYTE event
      reader.readU8();
    } else if (eventId < 0x80) {
      // WORD event (2-byte LE)
      const w = reader.readU16LE();
      if (eventId === 0x4F) {
        // NewPattern — set current
        currentPatternIndex = w;
        if (!patternsByIndex.has(w)) {
          patternsByIndex.set(w, { index: w, notes: [] });
        }
      } else if (eventId === 0x40) {
        // NewChannel — set current channel index (FLP-CHANNEL-NAMES v1.68)
        currentChannel = w;
      }
    } else if (eventId < 0xC0) {
      // DWORD event (4-byte LE)
      reader.readU32LE();
    } else {
      // TEXT/DATA event — varlen size prefix
      const size = reader.readVarLen();
      // Safety: wenn size jenseits des restlichen Buffers ist, abbrechen statt
      // OOM-Allokation. Defekte oder unbekannte FLP-Varianten würden hier sonst
      // riesige Allokationen versuchen → Parser-Crash. Wir brechen graceful ab.
      const remaining = dataEnd - reader.pos;
      if (size < 0 || size > remaining) {
        break;
      }
      const data = reader.readBytes(size);
      // NotesEvent kann unterschiedliche IDs haben je nach FL-Version:
      //   0xE7 (231) — FL 11–19 legacy
      //   0xE0 (224) — FL 20+ (per-channel notes innerhalb des aktuellen Patterns)
      // Beide kommen als 24-byte Note-Record-Arrays. Wir akzeptieren beide.
      if ((eventId === 0xE7 || eventId === 0xE0) && data.length >= 24 && data.length % 24 === 0) {
        const notes = parseNotesEvent(data);
        let pattern = patternsByIndex.get(currentPatternIndex);
        if (!pattern) {
          const idx = currentPatternIndex || 1;
          pattern = { index: idx, notes: [] };
          patternsByIndex.set(idx, pattern);
        }
        pattern.notes.push(...notes);
      } else if (eventId === 0xC3 && currentChannel >= 0) {
        // TEXT_CHANNEL_NAME (alias TEXT_DEFPLUGNAME) — Anzeigename des aktuell
        // selektierten FL-Channels (FLP-CHANNEL-NAMES v1.68).
        const name = decodeFlpText(data);
        if (name.length > 0) {
          channelNames.set(currentChannel, name);
        }
      }
    }
  }

  const patterns = Array.from(patternsByIndex.values()).sort((a, b) => a.index - b.index);
  return { header, patterns, channelNames };
}

// ─── Synthstudio-Pattern-Konvertierung ───────────────────────────────────────

/**
 * Konvertiert eine FLP-Note in einen Step-Index für ein 16-Step-Pattern bei
 * angenommener Bar-Länge von 4 Vierteln.
 *
 * Bei PPQ=96: ein Vierteltakt = 96 Ticks; ein Step (1/16) = 24 Ticks.
 * Bei einem 1-Bar-Pattern (16 Steps × 24 Ticks = 384 Ticks) → step = pos/24.
 *
 * Wenn das FLP-Pattern länger als 16 Steps ist, wird modulo gerechnet
 * (Caller-Verantwortung zu erkennen / mehrere Patterns zu generieren).
 */
export function flpPositionToStep(positionTicks: number, ppq: number, stepsPerBeat: number = 4): number {
  const ticksPerStep = ppq / stepsPerBeat;
  if (ticksPerStep <= 0) return 0;
  return Math.floor(positionTicks / ticksPerStep);
}

/** Velocity 0..127 → 0..1 (Synthstudio interne Range). */
export function flpVelocityToUnit(velocity: number): number {
  return Math.max(0, Math.min(1, velocity / 127));
}

/**
 * Group notes nach FL-channel-index → Liste pro Drum-Part.
 * Synthstudio's Drum-Machine hat eine feste Part-Reihenfolge; das Mapping
 * muss vom UI durchgeführt werden (User wählt welcher FL-Channel = welcher Part).
 */
export function groupNotesByChannel(notes: FlpNote[]): Map<number, FlpNote[]> {
  const map = new Map<number, FlpNote[]>();
  for (const n of notes) {
    if (!map.has(n.channel)) map.set(n.channel, []);
    map.get(n.channel)!.push(n);
  }
  return map;
}

/**
 * Gruppiert Notes nach Bar (1 bar = stepCount × ticksPerStep ticks).
 * Bei PPQ=96 + stepCount=16 + stepsPerBeat=4: bar = 384 ticks.
 *
 * Output-Map ist absolute Bar-Indizes → Notes mit *bar-relativen* Positions.
 * Z.B. Note bei position=400 mit PPQ=96 + 16-step bars → bar 1, position=16
 * (relativ zum Bar-Start).
 */
export function groupNotesByBar(
  notes: FlpNote[],
  ppq: number,
  stepCount: number = 16,
  stepsPerBeat: number = 4,
): Map<number, FlpNote[]> {
  const ticksPerStep = ppq / stepsPerBeat;
  const ticksPerBar = ticksPerStep * stepCount;
  if (ticksPerBar <= 0) return new Map();
  const map = new Map<number, FlpNote[]>();
  for (const n of notes) {
    const barIndex = Math.floor(n.position / ticksPerBar);
    const relPos = n.position - barIndex * ticksPerBar;
    const relNote: FlpNote = { ...n, position: relPos };
    if (!map.has(barIndex)) map.set(barIndex, []);
    map.get(barIndex)!.push(relNote);
  }
  return map;
}

/**
 * Berechnet wie viele Bars notwendig sind um alle Notes abzudecken.
 * Returns mindestens 1.
 */
export function calculateBarCount(
  notes: FlpNote[],
  ppq: number,
  stepCount: number = 16,
  stepsPerBeat: number = 4,
): number {
  if (!notes.length) return 1;
  const ticksPerBar = (ppq / stepsPerBeat) * stepCount;
  if (ticksPerBar <= 0) return 1;
  const maxPos = notes.reduce((m, n) => Math.max(m, n.position), 0);
  return Math.max(1, Math.floor(maxPos / ticksPerBar) + 1);
}
