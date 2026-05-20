/**
 * Synthstudio – midiFileEncoder.ts (v3.175)
 *
 * Pure-Helper: encodiert eine MIDI-Note-Liste zu einem echten Standard MIDI
 * File (SMF) Format 0 — single track. Schließt das v3.174-Caveat
 * "Echtes .mid-Binary statt JSON".
 *
 * SMF-Format Specification:
 *  - Header-Chunk: "MThd" + length(6) + format(0) + tracks(1) + division(ppqn)
 *  - Track-Chunk:  "MTrk" + length(uint32 BE) + track-data
 *  - Track-Data:   VLQ delta-time + event-bytes (repeated)
 *  - Multi-byte values: big-endian
 *
 * Bibliographie: https://midi.org/standard-midi-files-specification
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MidiNote {
  /** Absolute Tick-Position (vom Start). */
  tickPos: number;
  /** Dauer in Ticks. */
  tickDuration: number;
  /** MIDI-Note-Number 0..127. */
  note: number;
  /** Velocity 1..127. */
  velocity: number;
  /** MIDI-Channel 0..15. Default 9 (GM-Drum). */
  channel?: number;
}

export interface MidiFileOptions {
  /** Ticks per quarter note. Default 480. */
  ppqn?: number;
  /** Tempo in BPM. Default 120. */
  bpm?: number;
  /** Track-Name. Default "Synthstudio Pattern". */
  trackName?: string;
  /** Time-Signature. Default { numerator: 4, denominator: 4 }. */
  timeSignature?: { numerator: number; denominator: number };
}

// ─── Public Pure Helpers ──────────────────────────────────────────────────────

/**
 * Encodiert einen variable-length quantity (VLQ) für SMF delta-times.
 *
 * Beispiele:
 *  - 0       → [0x00]
 *  - 127     → [0x7F]
 *  - 128     → [0x81, 0x00]
 *  - 8192    → [0xC0, 0x00]
 *  - 0x1FFFFF → [0xFF, 0xFF, 0x7F]
 *
 * Negative Werte werden auf 0 geclampt. Floats werden via floor abgerundet.
 */
export function encodeVLQ(value: number): Uint8Array {
  const v = Math.max(0, Math.floor(value));
  const bytes: number[] = [];
  let n = v;
  // LSB-Byte ohne Continuation-Flag — wird IMMER emittiert (auch bei n === 0).
  bytes.push(n & 0x7f);
  n >>>= 7;
  while (n > 0) {
    // Höherwertige Bytes mit Continuation-Flag, vorn anhängen.
    bytes.unshift((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  return new Uint8Array(bytes);
}

/** Big-endian uint32 → 4 bytes. */
export function encodeUint32BE(value: number): Uint8Array {
  const v = value >>> 0;
  return new Uint8Array([
    (v >>> 24) & 0xff,
    (v >>> 16) & 0xff,
    (v >>> 8) & 0xff,
    v & 0xff,
  ]);
}

// ─── Private Helpers ──────────────────────────────────────────────────────────

/** Big-endian uint16 → 2 bytes. (Intern für Header-Chunk.) */
function encodeUint16BE(value: number): Uint8Array {
  const v = value & 0xffff;
  return new Uint8Array([(v >>> 8) & 0xff, v & 0xff]);
}

/** ASCII string → bytes. */
function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    out[i] = text.charCodeAt(i) & 0xff;
  }
  return out;
}

/** UTF-8 (für Track-Name) → bytes. */
function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Concat-Helper für mehrere Uint8Arrays. */
function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Tempo (BPM) → 3-byte uint24 BE (microsec per quarter). */
function tempoBytes(bpm: number): Uint8Array {
  const usPerQuarter = Math.max(1, Math.round(60_000_000 / bpm));
  return new Uint8Array([
    (usPerQuarter >>> 16) & 0xff,
    (usPerQuarter >>> 8) & 0xff,
    usPerQuarter & 0xff,
  ]);
}

/** Denominator in SMF-Form (log2). 4 → 2, 8 → 3, 16 → 4. */
function denomPow2(denominator: number): number {
  const d = Math.max(1, Math.floor(denominator));
  let p = 0;
  let n = d;
  while (n > 1) {
    n >>>= 1;
    p++;
  }
  return p & 0xff;
}

// ─── Absolute Event-Liste ─────────────────────────────────────────────────────

type AbsEvent = {
  tick: number;
  kind: "on" | "off";
  note: number;
  velocity: number;
  channel: number;
};

function buildAbsEvents(notes: readonly MidiNote[]): AbsEvent[] {
  const events: AbsEvent[] = [];
  for (const n of notes) {
    const channel = (n.channel ?? 9) & 0x0f;
    const note = n.note & 0x7f;
    const velocity = Math.min(127, Math.max(1, n.velocity | 0));
    const tickPos = Math.max(0, Math.floor(n.tickPos));
    const dur = Math.max(1, Math.floor(n.tickDuration));
    events.push({ tick: tickPos, kind: "on", note, velocity, channel });
    events.push({ tick: tickPos + dur, kind: "off", note, velocity: 0, channel });
  }
  // Off vor On bei gleichem Tick (verhindert überlappende Note-Off-Hänger).
  events.sort((a, b) => a.tick - b.tick || (a.kind === "off" ? -1 : 1));
  return events;
}

// ─── Track-Builder ────────────────────────────────────────────────────────────

function buildTrackData(
  notes: readonly MidiNote[],
  opts: Required<MidiFileOptions>,
): Uint8Array {
  const parts: Uint8Array[] = [];

  // 1) Track-Name Meta-Event: 0x00 0xFF 0x03 [VLQ len] [name-bytes]
  const nameBytes = utf8Bytes(opts.trackName);
  parts.push(new Uint8Array([0x00, 0xff, 0x03]));
  parts.push(encodeVLQ(nameBytes.length));
  parts.push(nameBytes);

  // 2) Tempo Meta-Event: 0x00 0xFF 0x51 0x03 [3 bytes us-per-quarter]
  parts.push(new Uint8Array([0x00, 0xff, 0x51, 0x03]));
  parts.push(tempoBytes(opts.bpm));

  // 3) Time-Signature Meta-Event: 0x00 0xFF 0x58 0x04 [num] [denom-pow2] [24] [8]
  parts.push(
    new Uint8Array([
      0x00,
      0xff,
      0x58,
      0x04,
      opts.timeSignature.numerator & 0xff,
      denomPow2(opts.timeSignature.denominator),
      0x18, // 24 MIDI clocks per metronome click
      0x08, // 8 32nd-notes per quarter
    ]),
  );

  // 4) Note-Events
  const events = buildAbsEvents(notes);
  let lastTick = 0;
  for (const ev of events) {
    const delta = ev.tick - lastTick;
    lastTick = ev.tick;
    parts.push(encodeVLQ(delta));
    if (ev.kind === "on") {
      parts.push(new Uint8Array([0x90 | ev.channel, ev.note, ev.velocity]));
    } else {
      parts.push(new Uint8Array([0x80 | ev.channel, ev.note, 0]));
    }
  }

  // 5) End-of-Track Meta-Event: 0x00 0xFF 0x2F 0x00
  parts.push(new Uint8Array([0x00, 0xff, 0x2f, 0x00]));

  return concat(parts);
}

// ─── Main API ─────────────────────────────────────────────────────────────────

/**
 * Encodiert eine MIDI-Note-Liste zu einem SMF Format 0 .mid Binary.
 *
 * Defensive: leere notes → Track mit nur Meta-Events + End-of-Track.
 */
export function encodeMidiFile(
  notes: readonly MidiNote[],
  options?: MidiFileOptions,
): Uint8Array {
  const opts: Required<MidiFileOptions> = {
    ppqn: Math.max(1, Math.floor(options?.ppqn ?? 480)),
    bpm: Math.max(1, options?.bpm ?? 120),
    trackName: options?.trackName ?? "Synthstudio Pattern",
    timeSignature: options?.timeSignature ?? { numerator: 4, denominator: 4 },
  };

  // Track-Data zuerst, da wir die Länge fürs Track-Header brauchen.
  const trackData = buildTrackData(notes, opts);

  // Header-Chunk: "MThd" + length(6) + format(0) + tracks(1) + division(ppqn)
  const headerChunk = concat([
    asciiBytes("MThd"),
    encodeUint32BE(6),
    encodeUint16BE(0), // Format 0
    encodeUint16BE(1), // 1 Track
    encodeUint16BE(opts.ppqn & 0x7fff), // top-bit 0 = ticks-per-quarter
  ]);

  // Track-Chunk: "MTrk" + length(uint32 BE) + track-data
  const trackChunk = concat([
    asciiBytes("MTrk"),
    encodeUint32BE(trackData.length),
    trackData,
  ]);

  return concat([headerChunk, trackChunk]);
}
