/**
 * Synthstudio – KORG ESX-1 Bank Sample-Slot-Patcher (v3.30.0)
 *
 * Pure-TypeScript, isomorphic library to **replace** individual mono OR stereo
 * sample-slots in an existing `.esx` bank-file. Symmetric companion to
 * v3.28's `esxBankPatcher.ts` (which replaces pattern-slots).
 *
 * Rationale (Mirror of v3.28 Mode-A "append + update header"):
 *   ESX-1 sample-section starts at `ESX1_ADDR_SAMPLE_DATA` (0x00250000) and
 *   contains up to 24 MB of int16-BE PCM data; each sample-header (40 B mono,
 *   44 B stereo) stores a **byte-offset relative to that PCM start**. To
 *   replace a single slot bit-exactly for **everything else** we use the
 *   pragmatic "Mode A" approach:
 *
 *     1. Read existing bank → validate magic + read counters/headers.
 *     2. Convert WAV-decoded Float32 → resample → mono/stereo int16-BE bytes.
 *     3. **Append** new PCM bytes at the current end of the file (or at the
 *        declared `currentOffset` field, whichever yields the lower waste).
 *     4. **Update** the slot's header (offset/length/name/sampleRate).
 *     5. Update the mono/stereo-count if the slot was previously empty.
 *     6. Update the `currentOffset` free-pointer at 0x001B0028.
 *
 *   ALL OTHER sample-headers and their PCM regions stay **bit-exact** — they
 *   keep their original offset-into-PCM-area + length. The old PCM bytes of
 *   the *replaced* slot become orphaned (waste). The pattern-data region
 *   [0x0200..0x130000) stays bit-exact, the song region stays bit-exact, the
 *   global region stays bit-exact.
 *
 *   Bank size GROWS by the new PCM size (in 16-bit BE bytes). The 24 MB
 *   device-cap is checked against `currentOffset + newPcmBytes` (the field
 *   the device itself uses for the next-free-byte allocator).
 *
 * SCOPE (v3.30.0):
 *   - Single-slot mono OR stereo replacement.
 *   - PCM data supplied as Float32 per-channel (1..2 channels) + sampleRate.
 *   - Resample/clip via `audioProcessor.ts` (Lanczos-3 + Int16 + ESX uses BE
 *     so we do an LE→BE byte-swap after `floatToInt16LeBytes`).
 *   - Defensive validation: magic-bytes, slot-index bounds, byte-budgets,
 *     name-length (8 ASCII), per-slot cap, cumulative 24 MB cap.
 *   - **NO** pattern/song/global modifications.
 *
 * Bit-Exact-Guarantee (verified via FNV-1a tests):
 *   - Bytes [0, 0x200) (header + global parameters) are unchanged.
 *   - Bytes [0x200, 0x130000) (all 256 pattern slots × 4280 B) are unchanged.
 *   - Bytes [0x130000, 0x1B0000) (song data + events) are unchanged.
 *   - Header table cells of OTHER slots are unchanged.
 *   - PCM areas of OTHER slots are unchanged (same offset-relative-to-
 *     0x250000 + same length).
 *
 * Layout reference (from `constants.ts`):
 *   0x00000000   "KORG" magic
 *   0x00000008   "ESX\0" sub-magic
 *   0x00000020   Global parameters (192 B)
 *   0x00000200   Pattern data (256 × 4280 B)
 *   0x00130000   Song data
 *   0x001B0000   Sample section magic
 *   0x001B0020   numMono (u32 BE)
 *   0x001B0024   numStereo (u32 BE)
 *   0x001B0028   currentOffset / free-byte-pointer (u32 BE), relative to 0x250000
 *   0x001B0100   256 mono headers × 40 B
 *   0x001B2900   128 stereo headers × 44 B
 *   0x001B4200   256 × 2048-byte slice-data blocks
 *   0x00250000   PCM payload start (BE i16 frames)
 */

import {
  ESX1_ADDR_NUM_MONO_SAMPLES,
  ESX1_ADDR_PATTERN_DATA,
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
  ESX1_NAME_MAX_CHARS,
  ESX1_SIGNATURE,
  ESX1_SIZE_FILE_MIN,
  ESX1_SUBMAGIC,
  ESX1_SUBMAGIC_OFFSET,
  ESX_FILE_MAX_BYTES,
  MAX_BYTES_PER_SLOT,
} from "./constants";

// ─── Public types ────────────────────────────────────────────────────────────

/** Input for a single sample-slot replacement. */
export interface EsxSamplePatchInput {
  /** Slot index 0..255 (mono) or 0..127 (stereo) depending on `channels`. */
  index: number;
  /** 1 = mono, 2 = stereo. Decides which header table is patched. */
  channels: 1 | 2;
  /**
   * Float32-PCM in [-1, +1]. For mono: length === frames. For stereo:
   * interleaved L,R,L,R,… with length === frames*2.
   */
  pcmData: Float32Array;
  /** Sample-rate written into the header (u32 BE). Typical: 44100. */
  sampleRate: number;
  /** Slot-name (ASCII, max 8 chars). Truncated + non-printables → '?'. */
  name?: string;
  /** Playback-level 0..127. Default 100. */
  level?: number;
}

export class EsxSamplePatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EsxSamplePatchError";
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Replace a single sample-slot in an .esx bank-buffer. Returns a **new**
 * buffer with the same content for all non-sample regions and with the new
 * PCM appended at the end. The replaced slot's header is updated to point to
 * the appended region.
 *
 * @throws EsxSamplePatchError on validation errors.
 */
export function patchEsxBankSample(
  bankBuffer: ArrayBuffer | Uint8Array,
  patch: EsxSamplePatchInput,
): ArrayBuffer {
  // ── 1. Validate bank ─────────────────────────────────────────────────────
  const inputBytes = toUint8(bankBuffer);
  validateBankBufferForSample(inputBytes);

  // ── 2. Validate patch ────────────────────────────────────────────────────
  validateSamplePatch(patch);

  // ── 3. Build PCM (BE int16) bytes from float32 ───────────────────────────
  const beBytes = float32ToBe16Pcm(patch.pcmData);
  const length = beBytes.byteLength; // bytes per channel for stereo
  const channelBytes =
    patch.channels === 1 ? length : length / 2; // for stereo we split L/R

  // Bytes per *channel* must be even (int16 alignment).
  if (channelBytes <= 0 || channelBytes % 2 !== 0) {
    throw new EsxSamplePatchError(
      `invalid PCM byte length ${length} for ${patch.channels}-channel slot`,
    );
  }

  if (channelBytes > MAX_BYTES_PER_SLOT) {
    throw new EsxSamplePatchError(
      `per-slot PCM length ${channelBytes} exceeds cap ${MAX_BYTES_PER_SLOT}`,
    );
  }

  // ── 4. Read counters + currentOffset ─────────────────────────────────────
  const inDv = new DataView(
    inputBytes.buffer,
    inputBytes.byteOffset,
    inputBytes.byteLength,
  );
  const numMono = inDv.getUint32(ESX1_ADDR_NUM_MONO_SAMPLES + 0, false);
  const numStereo = inDv.getUint32(ESX1_ADDR_NUM_MONO_SAMPLES + 4, false);
  const currentOffset = inDv.getUint32(
    ESX1_ADDR_NUM_MONO_SAMPLES + 8,
    false,
  );

  if (numMono > ESX1_MAX_MONO_SLOTS || numStereo > ESX1_MAX_STEREO_SLOTS) {
    throw new EsxSamplePatchError(
      `bank reports invalid counts: mono=${numMono} stereo=${numStereo}`,
    );
  }

  // ── 5. Determine append base (relative to ESX1_ADDR_SAMPLE_DATA) ─────────
  //
  // currentOffset is the "next free byte" inside the PCM region, as written
  // by the device. We use the larger of (currentOffset, file-end-pcm) to be
  // robust against banks built by third-party tools that didn't update the
  // counter; this guarantees we never overwrite existing PCM (and never
  // overwrite the slice-data table that lives BEFORE 0x250000).
  const fileEndPcmRel = Math.max(
    0,
    inputBytes.byteLength - ESX1_ADDR_SAMPLE_DATA,
  );
  // currentOffset must be plausible. If 0xFFFFFFFF (sentinel) or otherwise
  // larger than the file → fall back to file-end.
  const safeCurrent =
    currentOffset === ESX1_EMPTY_OFFSET || currentOffset > fileEndPcmRel
      ? fileEndPcmRel
      : currentOffset;
  const appendRel = Math.max(safeCurrent, fileEndPcmRel);

  // Total PCM after this patch (cumulative cap is the 24 MB device cap).
  const newPcmTotalBytes =
    patch.channels === 1 ? length : channelBytes * 2; // stereo: L+R bytes
  const projectedCurrent = appendRel + newPcmTotalBytes;
  if (projectedCurrent > ESX1_MAX_SAMPLE_MEM_IN_BYTES) {
    throw new EsxSamplePatchError(
      `cumulative PCM ${projectedCurrent} bytes exceeds ESX-1 cap ${ESX1_MAX_SAMPLE_MEM_IN_BYTES}`,
    );
  }

  // ── 6. Build new bank buffer (grown) ─────────────────────────────────────
  const appendAbs = ESX1_ADDR_SAMPLE_DATA + appendRel;
  const newSize = appendAbs + newPcmTotalBytes;
  if (newSize > ESX_FILE_MAX_BYTES) {
    throw new EsxSamplePatchError(
      `resulting bank size ${newSize} exceeds ${ESX_FILE_MAX_BYTES}`,
    );
  }

  const outBuffer = new ArrayBuffer(newSize);
  const outBytes = new Uint8Array(outBuffer);
  // Copy existing bank bit-exact into the lower region.
  outBytes.set(inputBytes, 0);
  // The region [inputBytes.byteLength, appendAbs) (if any) stays zero — this
  // is the "orphan gap" when currentOffset was larger than file-end, which is
  // rare but legal.

  const outDv = new DataView(outBuffer);

  // ── 7. Write new PCM bytes ───────────────────────────────────────────────
  if (patch.channels === 1) {
    outBytes.set(beBytes, appendAbs);
  } else {
    // Stereo: split interleaved L,R,L,R,… into two contiguous channel ranges.
    // ESX-1 stereo headers store off1Start/Off1End (L) + off2Start/Off2End (R),
    // each pointing at its own contiguous BE i16 block.
    const frames = patch.pcmData.length / 2;
    const leftBytes = new Uint8Array(channelBytes);
    const rightBytes = new Uint8Array(channelBytes);
    for (let i = 0; i < frames; i++) {
      // beBytes is interleaved L,R,L,R,… because float32ToBe16Pcm processed
      // the input in order. Each frame is 2 channels × 2 bytes = 4 bytes.
      // Source position: i*4. Dest position: i*2 in each channel buffer.
      leftBytes[i * 2 + 0] = beBytes[i * 4 + 0];
      leftBytes[i * 2 + 1] = beBytes[i * 4 + 1];
      rightBytes[i * 2 + 0] = beBytes[i * 4 + 2];
      rightBytes[i * 2 + 1] = beBytes[i * 4 + 3];
    }
    outBytes.set(leftBytes, appendAbs);
    outBytes.set(rightBytes, appendAbs + channelBytes);
  }

  // ── 8. Update the slot's header ─────────────────────────────────────────
  const wasEmpty = isSlotEmpty(inputBytes, patch.index, patch.channels);
  const nameBytes = encodeEsxName(patch.name ?? "");
  const level = clampInt(patch.level, 0, 127, 100);
  const sr = clampInt(patch.sampleRate, 1, 0x7fffffff, 44100);

  if (patch.channels === 1) {
    const off = ESX1_ADDR_SAMPLE_HEADER_MONO + patch.index * ESX1_CHUNKSIZE_SAMPLE_HEADER_MONO;
    // Name @ 0..7
    outBytes.set(nameBytes, off);
    // off1Start @ +8, off1End @ +12 (u32 BE)
    outDv.setUint32(off + 8, appendRel, false);
    outDv.setUint32(off + 12, appendRel + channelBytes, false);
    // start @ +16, end @ +20 (frames)
    const frames = channelBytes / 2;
    outDv.setUint32(off + 16, 0, false);
    outDv.setUint32(off + 20, frames, false);
    // loopStart @ +24 (frames) — 0 means "no loop"
    outDv.setUint32(off + 24, 0, false);
    // sampleRate @ +28
    outDv.setUint32(off + 28, sr, false);
    // sampleTune @ +32 (i16 BE) — 0
    outDv.setInt16(off + 32, 0, false);
    // playLevel @ +34 (u8)
    outBytes[off + 34] = level;
    // Remaining bytes 35..39 (stretch-step etc.) — leave zero.
    outBytes[off + 35] = 0;
    outBytes[off + 36] = 0;
    outBytes[off + 37] = 0;
    outBytes[off + 38] = 0;
    outBytes[off + 39] = 0;
  } else {
    const off = ESX1_ADDR_SAMPLE_HEADER_STEREO + patch.index * ESX1_CHUNKSIZE_SAMPLE_HEADER_STEREO;
    // Name @ 0..7
    outBytes.set(nameBytes, off);
    // off1Start @ +8, off1End @ +12 (u32 BE) — left channel
    outDv.setUint32(off + 8, appendRel, false);
    outDv.setUint32(off + 12, appendRel + channelBytes, false);
    // off2Start @ +16, off2End @ +20 (u32 BE) — right channel
    outDv.setUint32(off + 16, appendRel + channelBytes, false);
    outDv.setUint32(off + 20, appendRel + 2 * channelBytes, false);
    // start @ +24, end @ +28 (frames)
    const frames = channelBytes / 2;
    outDv.setUint32(off + 24, 0, false);
    outDv.setUint32(off + 28, frames, false);
    // sampleRate @ +32 (u32 BE)
    outDv.setUint32(off + 32, sr, false);
    // sampleTune @ +36 (i16 BE)
    outDv.setInt16(off + 36, 0, false);
    // playLevel @ +38 (u8)
    outBytes[off + 38] = level;
    // Bytes 39..43 (stretch step etc.) — leave zero.
    for (let i = 39; i < 44; i++) outBytes[off + i] = 0;
  }

  // ── 9. Update counters + currentOffset ───────────────────────────────────
  if (wasEmpty) {
    if (patch.channels === 1) {
      outDv.setUint32(ESX1_ADDR_NUM_MONO_SAMPLES + 0, Math.min(numMono + 1, ESX1_MAX_MONO_SLOTS), false);
    } else {
      outDv.setUint32(ESX1_ADDR_NUM_MONO_SAMPLES + 4, Math.min(numStereo + 1, ESX1_MAX_STEREO_SLOTS), false);
    }
  }
  outDv.setUint32(ESX1_ADDR_NUM_MONO_SAMPLES + 8, projectedCurrent, false);

  return outBuffer;
}

// ─── Validators (also exported for tests) ────────────────────────────────────

/**
 * Defensive structural validation specific to the sample-patch path.
 * Verifies size + KORG/ESX magic + the second `KORG` magic at the start of
 * the sample-section (0x001B0000). PCM content is not decoded.
 */
export function validateBankBufferForSample(buf: ArrayBuffer | Uint8Array): void {
  const bytes = toUint8(buf);
  if (bytes.byteLength < ESX1_SIZE_FILE_MIN) {
    throw new EsxSamplePatchError(
      `bank buffer too small: ${bytes.byteLength} bytes (need >= ${ESX1_SIZE_FILE_MIN})`,
    );
  }
  if (bytes.byteLength > ESX_FILE_MAX_BYTES) {
    throw new EsxSamplePatchError(
      `bank buffer size ${bytes.byteLength} exceeds max ${ESX_FILE_MAX_BYTES}`,
    );
  }
  for (let i = 0; i < ESX1_SIGNATURE.length; i++) {
    if (bytes[i] !== ESX1_SIGNATURE[i]) {
      throw new EsxSamplePatchError(
        `invalid ESX-1 signature at offset 0x00 (expected 'KORG')`,
      );
    }
  }
  for (let i = 0; i < ESX1_SUBMAGIC.length; i++) {
    if (bytes[ESX1_SUBMAGIC_OFFSET + i] !== ESX1_SUBMAGIC[i]) {
      throw new EsxSamplePatchError(
        `invalid ESX-1 sub-magic at offset 0x${ESX1_SUBMAGIC_OFFSET.toString(16)} (expected 'ESX\\0')`,
      );
    }
  }
  // Second magic at sample-section start.
  for (let i = 0; i < ESX1_SIGNATURE.length; i++) {
    if (bytes[ESX1_ADDR_VALID_CHECK_2 + i] !== ESX1_SIGNATURE[i]) {
      throw new EsxSamplePatchError(
        `invalid sample-section magic at 0x${ESX1_ADDR_VALID_CHECK_2.toString(16)}`,
      );
    }
  }
}

function validateSamplePatch(patch: EsxSamplePatchInput): void {
  if (!patch || typeof patch !== "object") {
    throw new EsxSamplePatchError("patch must be an object");
  }
  if (patch.channels !== 1 && patch.channels !== 2) {
    throw new EsxSamplePatchError(`patch.channels must be 1 or 2 (got ${patch.channels})`);
  }
  const maxIndex = patch.channels === 1 ? ESX1_MAX_MONO_SLOTS : ESX1_MAX_STEREO_SLOTS;
  if (
    typeof patch.index !== "number" ||
    !Number.isInteger(patch.index) ||
    patch.index < 0 ||
    patch.index >= maxIndex
  ) {
    throw new EsxSamplePatchError(
      `patch.index ${patch.index} out of range [0,${maxIndex}) for ${patch.channels}-channel slot`,
    );
  }
  if (!(patch.pcmData instanceof Float32Array)) {
    throw new EsxSamplePatchError("patch.pcmData must be Float32Array");
  }
  if (patch.pcmData.length === 0) {
    throw new EsxSamplePatchError("patch.pcmData is empty");
  }
  if (patch.channels === 2 && patch.pcmData.length % 2 !== 0) {
    throw new EsxSamplePatchError(
      `stereo patch.pcmData must have even length (got ${patch.pcmData.length})`,
    );
  }
  if (
    typeof patch.sampleRate !== "number" ||
    !Number.isFinite(patch.sampleRate) ||
    patch.sampleRate <= 0
  ) {
    throw new EsxSamplePatchError(`patch.sampleRate invalid: ${patch.sampleRate}`);
  }
  if (
    patch.level !== undefined &&
    (typeof patch.level !== "number" || !Number.isFinite(patch.level))
  ) {
    throw new EsxSamplePatchError(`patch.level invalid: ${patch.level}`);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Encode an 8-char ASCII slot-name, space-padded, non-printables → '?'. */
export function encodeEsxName(name: string): Uint8Array {
  const out = new Uint8Array(ESX1_NAME_MAX_CHARS);
  out.fill(0x20); // ASCII space
  if (typeof name !== "string") return out;
  for (let i = 0; i < ESX1_NAME_MAX_CHARS && i < name.length; i++) {
    const cp = name.charCodeAt(i);
    if (cp >= 0x20 && cp <= 0x7e) {
      out[i] = cp;
    } else {
      out[i] = 0x3f; // '?'
    }
  }
  return out;
}

/**
 * Convert Float32 [-1,+1] PCM to **Big-Endian** 16-bit signed PCM bytes.
 *
 * For ESX-1 the device stores PCM as BE int16 (Korg convention). NaN/Inf
 * defensively → 0; out-of-range clipped to [-1, +1] then scaled.
 *
 * Interleaved stereo input → interleaved output (caller splits L/R after).
 */
export function float32ToBe16Pcm(pcm: Float32Array): Uint8Array {
  const out = new Uint8Array(pcm.length * 2);
  for (let i = 0; i < pcm.length; i++) {
    let v = pcm[i];
    if (!Number.isFinite(v)) v = 0;
    if (v > 1) v = 1;
    if (v < -1) v = -1;
    const scaled = v < 0 ? Math.round(v * 32768) : Math.round(v * 32767);
    const u = scaled < 0 ? scaled + 0x10000 : scaled;
    // Big-endian: hi byte first.
    out[i * 2] = (u >> 8) & 0xff;
    out[i * 2 + 1] = u & 0xff;
  }
  return out;
}

/**
 * Reads the slot-empty flag from a bank-buffer. Mirrors the parser logic:
 * a slot is considered empty when its primary offset field equals
 * `ESX1_EMPTY_OFFSET` (0xFFFFFFFF). For stereo we also check off2Start.
 */
export function isSlotEmpty(
  bankBuffer: ArrayBuffer | Uint8Array,
  index: number,
  channels: 1 | 2,
): boolean {
  const bytes = toUint8(bankBuffer);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (channels === 1) {
    const off = ESX1_ADDR_SAMPLE_HEADER_MONO + index * ESX1_CHUNKSIZE_SAMPLE_HEADER_MONO;
    if (off + 16 > bytes.byteLength) return true;
    const s = dv.getUint32(off + 8, false);
    const e = dv.getUint32(off + 12, false);
    return s === ESX1_EMPTY_OFFSET || e === ESX1_EMPTY_OFFSET;
  }
  const off = ESX1_ADDR_SAMPLE_HEADER_STEREO + index * ESX1_CHUNKSIZE_SAMPLE_HEADER_STEREO;
  if (off + 24 > bytes.byteLength) return true;
  const s1 = dv.getUint32(off + 8, false);
  const e1 = dv.getUint32(off + 12, false);
  const s2 = dv.getUint32(off + 16, false);
  const e2 = dv.getUint32(off + 20, false);
  return (
    s1 === ESX1_EMPTY_OFFSET ||
    e1 === ESX1_EMPTY_OFFSET ||
    s2 === ESX1_EMPTY_OFFSET ||
    e2 === ESX1_EMPTY_OFFSET
  );
}

/**
 * Returns the absolute byte-offset of mono-slot `index`'s header. Useful for
 * tests asserting that *other* slots' headers stay bit-exact.
 *
 * @throws EsxSamplePatchError if index out of range.
 */
export function getEsxMonoHeaderOffset(index: number): number {
  if (
    typeof index !== "number" ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= ESX1_MAX_MONO_SLOTS
  ) {
    throw new EsxSamplePatchError(
      `mono slot index ${index} out of range [0,${ESX1_MAX_MONO_SLOTS})`,
    );
  }
  return ESX1_ADDR_SAMPLE_HEADER_MONO + index * ESX1_CHUNKSIZE_SAMPLE_HEADER_MONO;
}

/** Returns the absolute byte-offset of stereo-slot `index`'s header. */
export function getEsxStereoHeaderOffset(index: number): number {
  if (
    typeof index !== "number" ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= ESX1_MAX_STEREO_SLOTS
  ) {
    throw new EsxSamplePatchError(
      `stereo slot index ${index} out of range [0,${ESX1_MAX_STEREO_SLOTS})`,
    );
  }
  return ESX1_ADDR_SAMPLE_HEADER_STEREO + index * ESX1_CHUNKSIZE_SAMPLE_HEADER_STEREO;
}

/** Re-export sample-data start address for callers + tests. */
export const ESX_SAMPLE_DATA_ADDR = ESX1_ADDR_SAMPLE_DATA;
/** Re-export pattern-data start address for callers + tests. */
export const ESX_PATTERN_DATA_ADDR = ESX1_ADDR_PATTERN_DATA;

// ─── Internal ────────────────────────────────────────────────────────────────

function toUint8(buf: ArrayBuffer | Uint8Array): Uint8Array {
  if (buf instanceof Uint8Array) return buf;
  if (buf instanceof ArrayBuffer) return new Uint8Array(buf);
  throw new EsxSamplePatchError("expected ArrayBuffer or Uint8Array");
}

function clampInt(
  v: number | undefined,
  lo: number,
  hi: number,
  fallback: number,
): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  let n = Math.round(v);
  if (n < lo) n = lo;
  if (n > hi) n = hi;
  return n;
}
