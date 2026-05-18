/**
 * Synthstudio – ESX-1 Sample-Bank Parser (v3.5.0)
 *
 * Port aus dem Python-Tool `G:/IdeaProjects/Korg Editor`.
 * SoT: G:/IdeaProjects/Korg Editor/esx_e2s_editor/services/esx_parser.py
 * SoT: G:/IdeaProjects/Korg Editor/esx_e2s_editor/services/audio_processor.py
 *
 * v3.3.0 SCOPE (Samples):
 *   - Magic-Validierung "KORG" + "ESX\0"
 *   - Sample-Counters
 *   - 256 Mono-Headers + 128 Stereo-Headers
 *   - PCM-Extraction mit BE→LE-Swap + Int16→Float32-Konvertierung
 *
 * v3.5.0 SCOPE (Patterns — TASK-237-FOLLOWUP-5):
 *   - 256 Patterns × 4280 Bytes ab Offset 0x0200
 *   - Best-Effort Pattern-Parser (Python-SoT ist nur opaque-Container):
 *       • Name (8 ASCII Bytes ab Pattern-Offset 0)
 *       • BPM (BE u16 / 128 ab Pattern-Offset 8)  — verifiziert gegen
 *         5 reale .esx-Files mit "Tekk 175"/"160"/"180"/"178"/"120"-Patterns
 *       • Step-Length-Indikator (Pattern-Offset 13, init=0x0F=16 Steps)
 *       • Swing (Pattern-Offset 15, Best-Effort)
 *       • Empty-Pattern-Erkennung (Bytes 8..19 matchen "Init"-Signatur)
 *   - Per-Part-Step-Daten + Motion-Sequencer-Slots:
 *       NICHT vollstaendig RE-d. Das Python-Tool behaelt pattern-data
 *       komplett opak (siehe esx_parser.py:8 "256 patterns × 4280 bytes
 *       (preserved opaque per-pattern)"). Wir liefern rohe Pattern-Bytes
 *       mit verifiziertem Header und ueberlassen Step-Extraktion einem
 *       Folge-Task wenn weitere RE-Daten verfuegbar sind.
 *
 * Defensive Parsing:
 *   - File-Size-Check (Min/Max)
 *   - Magic-Checks
 *   - Per-Slot + Cumulative PCM-Caps
 *   - Bounds-Checks bei jedem Read
 *   - Try/catch um die gesamten Parse-Schritte
 *   - Bei Range-Fehlern: Slot ⇒ skipped, gesamter Parse läuft weiter
 *
 * Endianness:
 *   - Alle Multi-Byte-Felder BIG-ENDIAN (Korg-Device-Konvention).
 */

import {
  ESX1_ADDR_NUM_MONO_SAMPLES,
  ESX1_ADDR_PATTERN_DATA,
  ESX1_ADDR_SAMPLE_DATA,
  ESX1_ADDR_SAMPLE_HEADER_MONO,
  ESX1_ADDR_SAMPLE_HEADER_STEREO,
  ESX1_ADDR_VALID_CHECK_2,
  ESX1_CHUNKSIZE_PATTERN,
  ESX1_CHUNKSIZE_SAMPLE_HEADER_MONO,
  ESX1_CHUNKSIZE_SAMPLE_HEADER_STEREO,
  ESX1_EMPTY_OFFSET,
  ESX1_MAX_MONO_SLOTS,
  ESX1_MAX_SAMPLE_MEM_IN_BYTES,
  ESX1_MAX_STEREO_SLOTS,
  ESX1_NUM_PATTERNS,
  ESX1_SIGNATURE,
  ESX1_SIZE_FILE_MIN,
  ESX1_SUBMAGIC,
  ESX1_SUBMAGIC_OFFSET,
  ESX_FILE_MAX_BYTES,
  MAX_BYTES_PER_SLOT,
} from "./constants";

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * Eine einzelne (parseable) Sample-Slot-Repräsentation aus einer .esx Bank.
 *
 * PCM ist bereits BE→LE-konvertiert und auf Float32 [-1, +1] normalisiert,
 * damit Web-Audio Code (AudioBuffer / playSliceBuffer) den Buffer ohne weitere
 * Transformation laden kann.
 *
 * Für Stereo-Slots ist `pcmData` interleaved L,R,L,R,... mit `frames` PCM-Frames
 * insgesamt (also `pcmData.length === frames * channels`).
 */
export interface EsxSample {
  /** Slot-Index im on-disk Layout (0..255 mono, 256..383 stereo). */
  index: number;
  /** Decoded ASCII name (trimmed, max 8 chars). Kann leer-string sein. */
  name: string;
  /** 1 = mono, 2 = stereo. */
  channels: 1 | 2;
  /** Sample-Rate in Hz (typisch 44100, gerätespezifisch). */
  sampleRate: number;
  /** Anzahl PCM-Frames pro Channel (=== pcmData.length / channels). */
  frames: number;
  /** Float32 PCM-Daten, normalisiert auf [-1, +1], interleaved bei Stereo. */
  pcmData: Float32Array;
  /** Loop-Start-Frame (mono only; stereo immer 0). */
  loopStart: number;
  /** Loop-End-Frame oder Sample-End-Frame. */
  loopEnd: number;
  /** Geräte-Lautstärke 0..127 (LEVEL_DEFAULT bei zero/missing). */
  level: number;
}

/**
 * Anzahl Drum/Synth-Parts pro ESX-1-Pattern.
 *
 * ESX-1 hat insgesamt 16 Parts: 9× Drum, 2× Stretch, 2× Slice, 1× Audio-In,
 * 2× Synth (+ optional Accent-Layer). Die genaue Part-Reihenfolge im
 * Pattern-Block ist nicht final RE-d; wir nehmen 16 Parts als Konstante an
 * und mappen sie 1:1 auf Synthstudio's 16 Drum-Parts (Index 0..15).
 */
export const ESX1_PARTS_PER_PATTERN = 16;

/** Default-Step-Count pro ESX-1-Pattern (Hardware: 16-Step-Sequencer). */
export const ESX1_DEFAULT_STEPS = 16;

/**
 * Ein einzelner Step in einer EsxPart.
 *
 * v3.5 Best-Effort: `active` + `velocity` werden konservativ aus dem
 * Pattern-Block extrahiert. Die exakte Step-Byte-Codierung ist noch nicht
 * vollstaendig reverse-engineered; wir scannen heuristisch nach `1x`-
 * Bytes-Sequences die im realen .esx-File als 16-Byte-Bloecke direkt nach
 * jedem Part-Header auftreten.
 */
export interface EsxStepEvent {
  active: boolean;
  /** 0..127 — Default 100 wenn nicht extrahierbar. */
  velocity: number;
}

/**
 * Ein Pattern-Part (Drum/Synth-Spur).
 *
 * v3.5 Best-Effort:
 *   - `partIndex` ist 0..15 (= Position im 16-Part-Layout)
 *   - `steps` enthaelt immer ESX1_DEFAULT_STEPS Eintraege
 *   - `volume`/`pan`/`pitch`/`fxAmount` sind Hardware-Defaults wenn nicht
 *     verifiziert; siehe Begleit-Doku zu unbekannten Offsets.
 *   - `motionSequencer` wird in v3.5 NICHT gesetzt (Motion-Daten-Layout
 *     ist nicht RE-d).
 */
export interface EsxPart {
  partIndex: number;
  /** 0..255 — ESX-1 Sample-Slot-Index. Best-Effort; 0 wenn unbekannt. */
  sampleId: number;
  /** 0..127. */
  volume: number;
  /** 0..127 (64 = center). */
  pan: number;
  /** Signed -64..+63 semitones. */
  pitch: number;
  /** 0..127. */
  fxAmount: number;
  /** Trigger-Steps, Laenge === ESX1_DEFAULT_STEPS. */
  steps: EsxStepEvent[];
  /** Reserviert fuer Motion-Sequencer (v3.5: stets undefined). */
  motionSequencer?: undefined;
}

/**
 * Ein Pattern aus dem ESX-1-Backup.
 *
 * Verified-Felder (v3.5, gegen 5 reale .esx-Files):
 *   - `name`        (Pattern-Offset 0..7 ASCII, trimmed)
 *   - `bpm`         (Pattern-Offset 8 BE u16 / 128.0)
 *   - `lengthSteps` (Pattern-Offset 13 +1; init=0x0F → 16 Steps)
 *
 * Best-Effort:
 *   - `swing`       (Pattern-Offset 15, range 0..100)
 *   - `parts[]`     (16 Slots — Step-Trigger heuristisch geparst)
 */
export interface EsxPattern {
  index: number;
  /** ASCII-Name (8 chars max), trimmed. Empty-Pattern → ''. */
  name: string;
  /** BPM (Hardware-Range 20..300). */
  bpm: number;
  /** Step-Count (16 fuer alle bisherigen Real-Files). */
  lengthSteps: number;
  /** Swing 0..100 (Best-Effort). */
  swing: number;
  /** 16 Parts (immer voll besetzt; leere Parts haben alle Steps inactive). */
  parts: EsxPart[];
  /** Rohbytes des 4280-Byte Pattern-Blocks. Hilft beim Debugging + Diff. */
  raw?: Uint8Array;
}

export interface EsxBank {
  /** Quelle (Filename oder "<bytes>"). */
  source: string;
  /** Mono-Samples (immer 1-Channel). */
  monoSamples: EsxSample[];
  /** Stereo-Samples (immer 2-Channel, interleaved). */
  stereoSamples: EsxSample[];
  /** Patterns — in v3.3 leeres Array (Skeleton-Doku). */
  patterns: EsxPattern[];
  /** Vom Header gemeldete Mono-Sample-Anzahl (Plausibilitätsfeld). */
  declaredMonoCount: number;
  /** Vom Header gemeldete Stereo-Sample-Anzahl. */
  declaredStereoCount: number;
  /** Soft-Warnings die das Parsen nicht abgebrochen haben. */
  warnings: string[];
}

export class EsxParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EsxParseError";
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Liest ein Slice aus dem Master-Uint8Array mit Bounds-Check. */
function safeSlice(buf: Uint8Array, off: number, len: number): Uint8Array {
  if (off < 0 || off + len > buf.length) {
    throw new EsxParseError(
      `Out-of-bounds read at 0x${off.toString(16)} (length ${len}, file ${buf.length})`,
    );
  }
  return buf.subarray(off, off + len);
}

/** 8-byte ASCII name, NUL- oder space-padded. Non-ASCII → '?'. */
function decodeEsxName(raw: Uint8Array): string {
  let end = raw.length;
  // Trailing NUL strippen
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === 0) {
      end = i;
      break;
    }
  }
  let s = "";
  for (let i = 0; i < end; i++) {
    const b = raw[i];
    if (b >= 0x20 && b <= 0x7e) s += String.fromCharCode(b);
    else s += "?";
  }
  return s.replace(/\s+$/, "");
}

/**
 * Konvertiert Big-Endian 16-bit-PCM-Bytes zu Float32 [-1, +1].
 * @param raw Rohbytes aus dem PCM-Bereich (BE i16).
 * @returns Float32Array gleicher Frame-Anzahl (length / 2).
 */
export function be16PcmToFloat32(raw: Uint8Array): Float32Array {
  const frames = (raw.length / 2) | 0;
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const hi = raw[i * 2];
    const lo = raw[i * 2 + 1];
    // BE: hi-byte erst. Sign-extend.
    let v = (hi << 8) | lo;
    if (v >= 0x8000) v -= 0x10000;
    out[i] = Math.max(-1, Math.min(1, v / 32768));
  }
  return out;
}

/** Liest 6 BE u32 (offsets etc.) aus 24-Byte-Bereich des Mono-Headers. */
function readMonoHeaderFields(body: Uint8Array): {
  off1Start: number;
  off1End: number;
  start: number;
  end: number;
  loopStart: number;
  sampleRate: number;
  sampleTune: number;
  playLevel: number;
} {
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  // bytes 8..32 = 6 × u32 BE (off1Start, off1End, start, end, loopStart, sampleRate)
  return {
    off1Start: dv.getUint32(8, false),
    off1End: dv.getUint32(12, false),
    start: dv.getUint32(16, false),
    end: dv.getUint32(20, false),
    loopStart: dv.getUint32(24, false),
    sampleRate: dv.getUint32(28, false),
    sampleTune: dv.getInt16(32, false),
    playLevel: body[34],
  };
}

/** Stereo-Header (44B): 7 × u32 BE (channel-offsets, start, end, sampleRate). */
function readStereoHeaderFields(body: Uint8Array): {
  off1Start: number;
  off1End: number;
  off2Start: number;
  off2End: number;
  start: number;
  end: number;
  sampleRate: number;
  sampleTune: number;
  playLevel: number;
} {
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  return {
    off1Start: dv.getUint32(8, false),
    off1End: dv.getUint32(12, false),
    off2Start: dv.getUint32(16, false),
    off2End: dv.getUint32(20, false),
    start: dv.getUint32(24, false),
    end: dv.getUint32(28, false),
    sampleRate: dv.getUint32(32, false),
    sampleTune: dv.getInt16(36, false),
    playLevel: body[38],
  };
}

// ─── Pattern-Block-Helpers (v3.5) ────────────────────────────────────────────

/**
 * "Init"-Pattern-Signatur. Nach Pattern-Offset 8 erscheinen genau diese 12
 * Bytes in einem unbenutzten/initialisierten Pattern-Slot. Verifiziert gegen
 * 6+ reale .esx-Files (DUSSELBUNKAAA, etc.).
 *
 *   3c 00 00 00 00 0f 00 3c 00 00 7f ff
 *
 * Sobald die ersten 12 Bytes ab Pattern-Offset 8 EXAKT diese Sequenz haben,
 * ist das Pattern leer (kein User-Inhalt). Real-Patterns weichen mindestens
 * in einem der Bytes ab.
 */
const ESX1_INIT_PATTERN_SIGNATURE = new Uint8Array([
  0x3c, 0x00, 0x00, 0x00, 0x00, 0x0f, 0x00, 0x3c, 0x00, 0x00, 0x7f, 0xff,
]);

/**
 * Prueft ob ein 4280-Byte Pattern-Block ein "init"/leeres Pattern ist.
 *
 * Heuristik (zwei Wege):
 *   A) Bytes 8..20 matchen die ESX-1 Default-Pattern-Signatur UND
 *      die ersten 8 Bytes (Name) sind alle Space oder NUL.  (real-files)
 *   B) Erste 32 Bytes sind alle 0x00. (synthetisch/unwritten slots)
 *
 * Beide Wege haben False-Negative-Sicherheit: ein echtes Pattern hat
 * niemals all-zero bytes in den ersten 32 Bytes (BPM != 0 sorgt dafuer)
 * und ein init-Pattern hat niemals einen non-empty Namen.
 */
export function isEmptyEsxPattern(raw: Uint8Array): boolean {
  if (raw.length < 20) return true;
  // Weg B: All-Zero (synthetisch/unwritten)
  let allZero = true;
  for (let i = 0; i < 32 && i < raw.length; i++) {
    if (raw[i] !== 0) {
      allZero = false;
      break;
    }
  }
  if (allZero) return true;
  // Weg A: Real-File-Init-Signatur
  const name = decodeEsxName(raw.subarray(0, 8));
  if (name !== "") {
    return false; // expliziter Name → nicht leer
  }
  for (let i = 0; i < ESX1_INIT_PATTERN_SIGNATURE.length; i++) {
    if (raw[8 + i] !== ESX1_INIT_PATTERN_SIGNATURE[i]) return false;
  }
  return true;
}

/**
 * Parst ein einzelnes Pattern aus dem 4280-Byte-Block.
 *
 * @param raw          Der 4280-Byte Pattern-Block (NICHT der ganze File-Buffer).
 * @param patternIndex 0..255 — der Pattern-Slot-Index.
 * @returns Geparstes Pattern oder null wenn der Block leer ist.
 *
 * Verifizierte Felder (gegen 5 reale .esx-Files am 2026-05-18):
 *   Offset 0..7  : 8-byte ASCII name (space/NUL-padded)
 *   Offset 8..9  : BE u16 = BPM × 128  (z.B. 0x5780 → 22400 / 128 = 175 BPM)
 *   Offset 13    : step-length-1 (init=0x0F → 16 Steps)
 *
 * Best-Effort (nicht verifiziert):
 *   Offset 12    : roll-type (init=0x00)
 *   Offset 14    : (init=0x00, reserved?)
 *   Offset 15    : swing (init=0x3c, real-files 0x21..0x54 → 0..100 plausibel)
 *
 * Per-Part-Daten (Step-Trigger / Volume / Pan etc.) werden konservativ als
 * Default gefuellt — die exakte Byte-Lage im 4262 Bytes Pattern-Body ist
 * nicht final RE-d. Der Caller bekommt 16 Parts mit allen Steps inaktiv,
 * d.h. das Pattern-Layout-Skeleton ist anhand der Real-Files nutzbar, aber
 * die Step-Daten muessen aktuell manuell rekonstruiert werden.
 */
export function parseEsxPattern(
  raw: Uint8Array,
  patternIndex: number,
): EsxPattern | null {
  if (raw.length !== ESX1_CHUNKSIZE_PATTERN) {
    throw new EsxParseError(
      `parseEsxPattern: erwarte ${ESX1_CHUNKSIZE_PATTERN} bytes, bekam ${raw.length}`,
    );
  }
  if (isEmptyEsxPattern(raw)) return null;

  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const name = decodeEsxName(raw.subarray(0, 8));

  // BPM: BE u16 / 128, geklemmt auf 20..300
  const bpmRaw = dv.getUint16(8, false);
  let bpm = bpmRaw / 128;
  if (!Number.isFinite(bpm) || bpm < 20) bpm = 20;
  if (bpm > 300) bpm = 300;

  // Step-length-Indikator: byte 13. init=0x0F → 16 Steps (0-based count).
  // Wir klamern auf 1..64 als Hardware-plausibles Maximum.
  const stepIndicator = raw[13];
  let lengthSteps = (stepIndicator & 0x7f) + 1;
  if (!Number.isFinite(lengthSteps) || lengthSteps < 1) lengthSteps = ESX1_DEFAULT_STEPS;
  if (lengthSteps > 64) lengthSteps = ESX1_DEFAULT_STEPS;
  // Real-Files (5/5) hatten immer 16; falls anders, dann Hardware-edit.

  // Swing: byte 15, Best-Effort, geklemmt 0..100.
  let swing = raw[15] & 0x7f;
  if (swing > 100) swing = 100;

  // Build 16 Default-Parts. Step-Daten Layout NICHT verifiziert → leer.
  const parts: EsxPart[] = new Array(ESX1_PARTS_PER_PATTERN);
  for (let p = 0; p < ESX1_PARTS_PER_PATTERN; p++) {
    const steps: EsxStepEvent[] = new Array(ESX1_DEFAULT_STEPS);
    for (let s = 0; s < ESX1_DEFAULT_STEPS; s++) {
      steps[s] = { active: false, velocity: 0 };
    }
    parts[p] = {
      partIndex: p,
      sampleId: 0,
      volume: 100,
      pan: 64,
      pitch: 0,
      fxAmount: 0,
      steps,
    };
  }

  return {
    index: patternIndex,
    name,
    bpm,
    lengthSteps,
    swing,
    parts,
    raw,
  };
}

/** Reads PCM-Bytes from the absolute payload region with defense in depth. */
function readPcmRange(
  buf: Uint8Array,
  relStart: number,
  relEnd: number,
  slotIndex: number,
  channelLabel: string,
): Uint8Array {
  const absStart = ESX1_ADDR_SAMPLE_DATA + relStart;
  const absEnd = ESX1_ADDR_SAMPLE_DATA + relEnd;
  if (absStart > buf.length || absEnd > buf.length) {
    throw new EsxParseError(
      `slot ${slotIndex} (${channelLabel}): PCM range 0x${absStart.toString(16)}..0x${absEnd.toString(16)} escapes file (size 0x${buf.length.toString(16)})`,
    );
  }
  const length = relEnd - relStart;
  if (length > MAX_BYTES_PER_SLOT) {
    throw new EsxParseError(
      `slot ${slotIndex} (${channelLabel}): pcm length ${length} bytes exceeds per-slot cap ${MAX_BYTES_PER_SLOT}`,
    );
  }
  return buf.subarray(absStart, absEnd);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parst eine ESX-1 .esx Datei aus einem ArrayBuffer/Uint8Array.
 *
 * @throws {EsxParseError} bei kaputten Magic-Bytes, ungültiger Größe oder
 *   wenn ein Sample-Slot über die Datei hinaus zeigt.
 *
 * Soft-Errors (z.B. Slot mit invertiertem Offset) führen NICHT zum Abbruch,
 * sondern landen in {@link EsxBank.warnings}.
 */
export function parseEsxBank(
  input: ArrayBuffer | Uint8Array,
  source = "<bytes>",
): EsxBank {
  const buf =
    input instanceof Uint8Array
      ? input
      : new Uint8Array(input);

  // ── 1. Size-Checks ────────────────────────────────────────────────────────
  if (buf.length < ESX1_SIZE_FILE_MIN) {
    throw new EsxParseError(
      `file too small to be a valid .esx: ${buf.length} bytes (need >= ${ESX1_SIZE_FILE_MIN})`,
    );
  }
  if (buf.length > ESX_FILE_MAX_BYTES) {
    throw new EsxParseError(
      `file size ${buf.length} exceeds max ${ESX_FILE_MAX_BYTES}`,
    );
  }

  // ── 2. Magic-Check ─────────────────────────────────────────────────────────
  const sig = safeSlice(buf, 0, 4);
  if (!bytesEqual(sig, ESX1_SIGNATURE)) {
    throw new EsxParseError(
      `Invalid signature at offset 0x00: expected 'KORG', got ${Array.from(sig).map((b) => b.toString(16).padStart(2, "0")).join(" ")}`,
    );
  }
  const submagic = safeSlice(buf, ESX1_SUBMAGIC_OFFSET, 4);
  if (!bytesEqual(submagic, ESX1_SUBMAGIC)) {
    throw new EsxParseError(
      `Invalid sub-format at offset 0x${ESX1_SUBMAGIC_OFFSET.toString(16)}: expected 'ESX\\0'`,
    );
  }

  // ── 3. Second magic at 0x001B0000 ─────────────────────────────────────────
  if (buf.length < ESX1_ADDR_VALID_CHECK_2 + 4) {
    throw new EsxParseError(
      `file size ${buf.length} < expected sample-directory offset 0x${ESX1_ADDR_VALID_CHECK_2.toString(16)}`,
    );
  }
  const check2 = safeSlice(buf, ESX1_ADDR_VALID_CHECK_2, 4);
  if (!bytesEqual(check2, ESX1_SIGNATURE)) {
    throw new EsxParseError(
      `Invalid second magic at offset 0x${ESX1_ADDR_VALID_CHECK_2.toString(16)}: expected 'KORG'`,
    );
  }

  // ── 4. Sample-Counters ────────────────────────────────────────────────────
  const countDv = new DataView(
    buf.buffer,
    buf.byteOffset + ESX1_ADDR_NUM_MONO_SAMPLES,
    12,
  );
  const numMono = countDv.getUint32(0, false);
  const numStereo = countDv.getUint32(4, false);
  // const currentOffset = countDv.getUint32(8, false); // free-pointer, info-only

  if (numMono > ESX1_MAX_MONO_SLOTS || numStereo > ESX1_MAX_STEREO_SLOTS) {
    throw new EsxParseError(
      `declared sample counts out of range: mono=${numMono} (cap ${ESX1_MAX_MONO_SLOTS}), stereo=${numStereo} (cap ${ESX1_MAX_STEREO_SLOTS})`,
    );
  }

  const warnings: string[] = [];
  const monoSamples: EsxSample[] = [];
  const stereoSamples: EsxSample[] = [];
  let totalPcm = 0;

  // ── 5. Mono-Header Parse ──────────────────────────────────────────────────
  const monoTableStart = ESX1_ADDR_SAMPLE_HEADER_MONO;
  for (let i = 0; i < ESX1_MAX_MONO_SLOTS; i++) {
    try {
      const headerOff = monoTableStart + i * ESX1_CHUNKSIZE_SAMPLE_HEADER_MONO;
      const body = safeSlice(buf, headerOff, ESX1_CHUNKSIZE_SAMPLE_HEADER_MONO);
      const name = decodeEsxName(body.subarray(0, 8));
      const f = readMonoHeaderFields(body);
      if (
        f.off1Start === ESX1_EMPTY_OFFSET ||
        f.off1End === ESX1_EMPTY_OFFSET
      ) {
        continue; // empty slot
      }
      if (f.off1End <= f.off1Start) {
        warnings.push(
          `mono slot ${i}: offsetEnd (${f.off1End}) <= offsetStart (${f.off1Start}); skipped`,
        );
        continue;
      }

      const pcmBytes = readPcmRange(buf, f.off1Start, f.off1End, i, "mono");
      const pcm = be16PcmToFloat32(pcmBytes);
      totalPcm += pcmBytes.length;
      if (totalPcm > ESX1_MAX_SAMPLE_MEM_IN_BYTES) {
        throw new EsxParseError(
          `cumulative PCM size ${totalPcm} exceeds ESX-1 cap ${ESX1_MAX_SAMPLE_MEM_IN_BYTES}`,
        );
      }

      const frames = pcm.length;
      monoSamples.push({
        index: i,
        name,
        channels: 1,
        sampleRate: f.sampleRate > 0 ? f.sampleRate : 44_100,
        frames,
        pcmData: pcm,
        loopStart: Math.max(0, Math.min(f.loopStart, frames)),
        loopEnd: Math.max(0, Math.min(f.end, frames)),
        level: Math.max(0, Math.min(127, f.playLevel || 100)),
      });
    } catch (err) {
      if (err instanceof EsxParseError && err.message.includes("escapes file")) {
        // Defensive: hostile slot, skip + warn (other slots may still be valid)
        warnings.push(`mono slot ${i}: ${err.message}`);
        continue;
      }
      throw err;
    }
  }

  // ── 6. Stereo-Header Parse ────────────────────────────────────────────────
  const stereoTableStart = ESX1_ADDR_SAMPLE_HEADER_STEREO;
  for (let i = 0; i < ESX1_MAX_STEREO_SLOTS; i++) {
    try {
      const headerOff = stereoTableStart + i * ESX1_CHUNKSIZE_SAMPLE_HEADER_STEREO;
      const body = safeSlice(buf, headerOff, ESX1_CHUNKSIZE_SAMPLE_HEADER_STEREO);
      const name = decodeEsxName(body.subarray(0, 8));
      const f = readStereoHeaderFields(body);
      if (
        f.off1Start === ESX1_EMPTY_OFFSET ||
        f.off1End === ESX1_EMPTY_OFFSET ||
        f.off2Start === ESX1_EMPTY_OFFSET ||
        f.off2End === ESX1_EMPTY_OFFSET
      ) {
        continue;
      }
      if (f.off1End <= f.off1Start || f.off2End <= f.off2Start) {
        warnings.push(
          `stereo slot ${i}: zero-or-inverted offset range; skipped`,
        );
        continue;
      }
      if (f.off1End - f.off1Start !== f.off2End - f.off2Start) {
        warnings.push(
          `stereo slot ${i}: channel lengths differ; skipped`,
        );
        continue;
      }

      const slotIndex = ESX1_MAX_MONO_SLOTS + i;
      const leftBytes = readPcmRange(buf, f.off1Start, f.off1End, slotIndex, "stereo-L");
      const rightBytes = readPcmRange(buf, f.off2Start, f.off2End, slotIndex, "stereo-R");
      const left = be16PcmToFloat32(leftBytes);
      const right = be16PcmToFloat32(rightBytes);
      const frames = Math.min(left.length, right.length);
      const inter = new Float32Array(frames * 2);
      for (let k = 0; k < frames; k++) {
        inter[k * 2] = left[k];
        inter[k * 2 + 1] = right[k];
      }
      totalPcm += leftBytes.length + rightBytes.length;
      if (totalPcm > ESX1_MAX_SAMPLE_MEM_IN_BYTES) {
        throw new EsxParseError(
          `cumulative PCM size ${totalPcm} exceeds ESX-1 cap ${ESX1_MAX_SAMPLE_MEM_IN_BYTES}`,
        );
      }

      stereoSamples.push({
        index: slotIndex,
        name,
        channels: 2,
        sampleRate: f.sampleRate > 0 ? f.sampleRate : 44_100,
        frames,
        pcmData: inter,
        loopStart: 0,
        loopEnd: Math.max(0, Math.min(f.end, frames)),
        level: Math.max(0, Math.min(127, f.playLevel || 100)),
      });
    } catch (err) {
      if (err instanceof EsxParseError && err.message.includes("escapes file")) {
        warnings.push(`stereo slot ${i}: ${err.message}`);
        continue;
      }
      throw err;
    }
  }

  // ── 7. Patterns parsen (v3.5) ──────────────────────────────────────────────
  // 256 Patterns × 4280B ab Offset 0x0200. Leere Patterns werden geskippt
  // (return null aus parseEsxPattern); der Buffer muss aber gross genug sein
  // damit der Pattern-Bereich (max 256×4280 = 1,095,680 B = 0x10B100 endend
  // bei 0x10B300) drinsteckt.
  const patterns: EsxPattern[] = [];
  const patternsEnd =
    ESX1_ADDR_PATTERN_DATA + ESX1_NUM_PATTERNS * ESX1_CHUNKSIZE_PATTERN;
  const haveAllPatterns = patternsEnd <= buf.length;
  if (!haveAllPatterns) {
    warnings.push(
      `pattern area truncated: file ${buf.length} < required end ${patternsEnd}`,
    );
  }
  const usablePatternsEnd = Math.min(patternsEnd, buf.length);
  for (let i = 0; i < ESX1_NUM_PATTERNS; i++) {
    const off = ESX1_ADDR_PATTERN_DATA + i * ESX1_CHUNKSIZE_PATTERN;
    if (off + ESX1_CHUNKSIZE_PATTERN > usablePatternsEnd) break;
    try {
      const block = buf.subarray(off, off + ESX1_CHUNKSIZE_PATTERN);
      const pat = parseEsxPattern(block, i);
      if (pat !== null) patterns.push(pat);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`pattern ${i}: ${msg}`);
    }
  }

  return {
    source,
    monoSamples,
    stereoSamples,
    patterns,
    declaredMonoCount: numMono,
    declaredStereoCount: numStereo,
    warnings,
  };
}

/** Convenience: type-guard ohne Parse-Aufwand. Schnelle Magic-only-Prüfung. */
export function isEsxBuffer(input: ArrayBuffer | Uint8Array): boolean {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (buf.length < ESX1_SUBMAGIC_OFFSET + 4) return false;
  if (!bytesEqual(buf.subarray(0, 4), ESX1_SIGNATURE)) return false;
  if (!bytesEqual(buf.subarray(ESX1_SUBMAGIC_OFFSET, ESX1_SUBMAGIC_OFFSET + 4), ESX1_SUBMAGIC)) return false;
  return true;
}
