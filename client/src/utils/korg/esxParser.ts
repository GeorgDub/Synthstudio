/**
 * Synthstudio – ESX-1 Sample-Bank Parser (v3.3.0)
 *
 * Port aus dem Python-Tool `G:/IdeaProjects/Korg Editor`.
 * SoT: G:/IdeaProjects/Korg Editor/esx_e2s_editor/services/esx_parser.py
 * SoT: G:/IdeaProjects/Korg Editor/esx_e2s_editor/services/audio_processor.py
 *
 * READ-ONLY-SCOPE für v3.3:
 *   - Magic-Validierung "KORG" + "ESX\0"
 *   - Sample-Counters
 *   - 256 Mono-Headers + 128 Stereo-Headers
 *   - PCM-Extraction mit BE→LE-Swap + Int16→Float32-Konvertierung
 *   - Patterns / Songs werden NICHT geparst (FOLLOWUP v3.5)
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
  ESX1_ADDR_SAMPLE_DATA,
  ESX1_ADDR_SAMPLE_HEADER_MONO,
  ESX1_ADDR_SAMPLE_HEADER_STEREO,
  ESX1_ADDR_VALID_CHECK_2,
  ESX1_CHUNKSIZE_SAMPLE_HEADER_MONO,
  ESX1_CHUNKSIZE_SAMPLE_HEADER_STEREO,
  ESX1_EMPTY_OFFSET,
  ESX1_MAX_MONO_SLOTS,
  ESX1_MAX_SAMPLE_MEM_IN_BYTES,
  ESX1_MAX_STEREO_SLOTS,
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

/** Pattern/Song-Skeleton — wir parsen v3.3 keine Step-Daten. */
export interface EsxPattern {
  index: number;
  /** Rohbytes des Pattern-Blocks (4280 Bytes); nicht weiter dekodiert. */
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

  return {
    source,
    monoSamples,
    stereoSamples,
    patterns: [], // FOLLOWUP v3.5
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
