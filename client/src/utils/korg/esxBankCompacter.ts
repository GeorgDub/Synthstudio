/**
 * Synthstudio – KORG ESX-1 Bank PCM-Compacter (v3.32.0)
 *
 * Closes the v3.30 caveat "Mode-A append-Strategie → Orphan-Bytes-Waste bei
 * Re-Replace". After repeated calls to `patchEsxBankSample(...)` the bank file
 * grows with each replacement because Mode-A appends new PCM at the file end
 * and only updates the header — the OLD PCM bytes of the replaced slot become
 * orphans (waste). After 10 replacements a bank that originally had 5 MB of
 * sample data can balloon to 15 MB of file, with 10 MB of dead bytes.
 *
 * `compactEsxBank(buffer)` rebuilds the PCM region from scratch:
 *
 *   1. Parse all mono + stereo headers + counters from the bank.
 *   2. Collect every "live" PCM range (referenced by a non-empty header).
 *   3. Re-allocate each live range contiguously at the start of the PCM
 *      region (offset 0x00250000 in absolute file terms, offset 0 in PCM-rel
 *      terms used by header offsetChannel*-fields).
 *   4. Update each header's offsetChannel*-fields to point at the new
 *      packed offset; everything else in the header (name, sampleRate,
 *      sampleTune, playLevel, start, end, loopStart) stays bit-exact.
 *   5. Update `currentOffset` at 0x001B0028 to the new PCM-end.
 *   6. Truncate the file to exactly `ESX1_ADDR_SAMPLE_DATA + newPcmTotal`.
 *
 * Bit-Exact Guarantees:
 *   - Bytes [0, 0x200)            (KORG/ESX magic + globals)        UNCHANGED
 *   - Bytes [0x200, 0x130000)     (256 × 4280 pattern slots)        UNCHANGED
 *   - Bytes [0x130000, 0x1B0000)  (song data + events)              UNCHANGED
 *   - Bytes [0x1B0000, 0x1B0020)  (sample-section magic + padding)  UNCHANGED
 *   - Counters numMono/numStereo @ 0x1B0020/0x1B0024                UNCHANGED
 *   - Sample-header NON-offset fields                               UNCHANGED
 *
 * What CHANGES:
 *   - `currentOffset` @ 0x1B0028 → new packed PCM-end
 *   - mono-header offsetChannel1Start/End @ +8/+12 → new packed offsets
 *   - stereo-header offsetChannel1/2 Start/End @ +8/+12/+16/+20 → new
 *   - The entire PCM payload region [0x250000..EOF) is rewritten contiguously
 *   - File-byte-length shrinks by exactly the orphan-byte total
 *
 * If a bank has zero orphan bytes (already compact) the output equals the
 * input bit-for-bit (caller still gets a fresh ArrayBuffer copy — they can't
 * mutate the input via the return value).
 *
 * Defensive:
 *   - Validates KORG/ESX magic + second-magic at 0x1B0000 (same as patcher).
 *   - Skips slots with sentinel offsets (ESX1_EMPTY_OFFSET = 0xFFFFFFFF).
 *   - Skips slots with inverted/escaping/out-of-bounds PCM ranges.
 *   - Throws on cumulative-cap overflow (should be impossible — input is
 *     already capped at 24 MB by the parser).
 *
 * Pure-TypeScript, isomorphic. No DOM/Electron/AudioEngine dependencies.
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

// ─── Public types ────────────────────────────────────────────────────────────

export class EsxBankCompactError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EsxBankCompactError";
  }
}

export interface EsxCompactReport {
  /** Bytes used by live (non-orphan) PCM in the input bank. */
  liveBytes: number;
  /** Bytes occupied by the PCM region in the input bank (file-end - 0x250000). */
  pcmRegionBytes: number;
  /** Orphan bytes = pcmRegionBytes - liveBytes. */
  orphanBytes: number;
  /** Live sample-headers count (mono + stereo). */
  liveSlotCount: number;
}

/**
 * Compute the orphan-byte count for a bank WITHOUT mutating or rewriting it.
 * Returns `null` if the bank fails magic validation (caller should reload).
 */
export function inspectEsxBankWaste(
  bankBuffer: ArrayBuffer | Uint8Array,
): EsxCompactReport | null {
  try {
    const bytes = toUint8(bankBuffer);
    validateBankBufferForCompact(bytes);
    const ranges = collectLivePcmRanges(bytes);
    let live = 0;
    for (const r of ranges) live += r.byteLength;
    const pcmRegionBytes = Math.max(0, bytes.byteLength - ESX1_ADDR_SAMPLE_DATA);
    return {
      liveBytes: live,
      pcmRegionBytes,
      orphanBytes: Math.max(0, pcmRegionBytes - live),
      liveSlotCount: ranges.length,
    };
  } catch {
    return null;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Rebuild the PCM region of an .esx bank-buffer so that live samples are
 * stored contiguously starting at 0x00250000 (no gaps, no orphans). Headers
 * are updated with the new offsets; everything else stays bit-exact.
 *
 * @throws EsxBankCompactError on validation errors.
 */
export function compactEsxBank(
  bankBuffer: ArrayBuffer | Uint8Array,
): ArrayBuffer {
  // ── 1. Validate ──────────────────────────────────────────────────────────
  const inputBytes = toUint8(bankBuffer);
  validateBankBufferForCompact(inputBytes);

  // ── 2. Collect live PCM ranges ───────────────────────────────────────────
  const ranges = collectLivePcmRanges(inputBytes);

  // ── 3. Compute new total PCM size ────────────────────────────────────────
  let newPcmTotal = 0;
  for (const r of ranges) newPcmTotal += r.byteLength;
  if (newPcmTotal > ESX1_MAX_SAMPLE_MEM_IN_BYTES) {
    throw new EsxBankCompactError(
      `compacted PCM total ${newPcmTotal} exceeds ESX-1 cap ${ESX1_MAX_SAMPLE_MEM_IN_BYTES}`,
    );
  }

  const newSize = ESX1_ADDR_SAMPLE_DATA + newPcmTotal;
  if (newSize > ESX_FILE_MAX_BYTES) {
    throw new EsxBankCompactError(
      `resulting bank size ${newSize} exceeds ${ESX_FILE_MAX_BYTES}`,
    );
  }

  // ── 4. Allocate output buffer ────────────────────────────────────────────
  const outBuffer = new ArrayBuffer(newSize);
  const outBytes = new Uint8Array(outBuffer);
  // Copy the entire header region [0, 0x250000) bit-exact.
  outBytes.set(inputBytes.subarray(0, ESX1_ADDR_SAMPLE_DATA), 0);

  const outDv = new DataView(outBuffer);

  // ── 5. Re-allocate ranges + update headers ───────────────────────────────
  // Group ranges by slot so that stereo gets one contiguous L+R region with
  // the L starting at the slot's start offset, R immediately after.
  // We process slots in deterministic order (mono 0..255, then stereo 0..127)
  // and within stereo we always write L then R.
  let writeRel = 0;
  for (const r of ranges) {
    // Copy bytes from input PCM region to output PCM region.
    const srcStart = ESX1_ADDR_SAMPLE_DATA + r.srcRel;
    const srcEnd = srcStart + r.byteLength;
    outBytes.set(inputBytes.subarray(srcStart, srcEnd), ESX1_ADDR_SAMPLE_DATA + writeRel);

    // Update the header for this range.
    if (r.headerKind === "mono") {
      const off =
        ESX1_ADDR_SAMPLE_HEADER_MONO + r.headerIndex * ESX1_CHUNKSIZE_SAMPLE_HEADER_MONO;
      outDv.setUint32(off + 8, writeRel, false);
      outDv.setUint32(off + 12, writeRel + r.byteLength, false);
    } else if (r.headerKind === "stereo-L") {
      const off =
        ESX1_ADDR_SAMPLE_HEADER_STEREO + r.headerIndex * ESX1_CHUNKSIZE_SAMPLE_HEADER_STEREO;
      outDv.setUint32(off + 8, writeRel, false);
      outDv.setUint32(off + 12, writeRel + r.byteLength, false);
    } else if (r.headerKind === "stereo-R") {
      const off =
        ESX1_ADDR_SAMPLE_HEADER_STEREO + r.headerIndex * ESX1_CHUNKSIZE_SAMPLE_HEADER_STEREO;
      outDv.setUint32(off + 16, writeRel, false);
      outDv.setUint32(off + 20, writeRel + r.byteLength, false);
    }
    writeRel += r.byteLength;
  }

  // ── 6. Update currentOffset @ 0x001B0028 ─────────────────────────────────
  outDv.setUint32(ESX1_ADDR_NUM_MONO_SAMPLES + 8, newPcmTotal, false);

  return outBuffer;
}

// ─── Internal types ──────────────────────────────────────────────────────────

interface LivePcmRange {
  /** Source byte-offset relative to ESX1_ADDR_SAMPLE_DATA. */
  srcRel: number;
  /** Number of bytes in this range. */
  byteLength: number;
  /** Which header table + offset field to update. */
  headerKind: "mono" | "stereo-L" | "stereo-R";
  /** Mono slot index 0..255 OR stereo slot index 0..127. */
  headerIndex: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Walk all mono + stereo headers, collect their live PCM ranges (those that
 * lie fully within the file's PCM region). Returns them ordered: all valid
 * mono slots first (by index), then stereo (by index, L then R per slot).
 *
 * The order is deterministic so two calls on the same input produce
 * byte-identical output.
 */
function collectLivePcmRanges(bytes: Uint8Array): LivePcmRange[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pcmRegionEnd = Math.max(0, bytes.byteLength - ESX1_ADDR_SAMPLE_DATA);
  const ranges: LivePcmRange[] = [];

  // Mono
  for (let i = 0; i < ESX1_MAX_MONO_SLOTS; i++) {
    const off = ESX1_ADDR_SAMPLE_HEADER_MONO + i * ESX1_CHUNKSIZE_SAMPLE_HEADER_MONO;
    if (off + 16 > bytes.byteLength) break;
    const s = dv.getUint32(off + 8, false);
    const e = dv.getUint32(off + 12, false);
    if (s === ESX1_EMPTY_OFFSET || e === ESX1_EMPTY_OFFSET) continue;
    if (e <= s) continue; // skip degenerate
    const len = e - s;
    if (len > MAX_BYTES_PER_SLOT) continue;
    if (e > pcmRegionEnd) continue; // skip out-of-bounds
    ranges.push({
      srcRel: s,
      byteLength: len,
      headerKind: "mono",
      headerIndex: i,
    });
  }

  // Stereo (per slot: L then R)
  for (let i = 0; i < ESX1_MAX_STEREO_SLOTS; i++) {
    const off = ESX1_ADDR_SAMPLE_HEADER_STEREO + i * ESX1_CHUNKSIZE_SAMPLE_HEADER_STEREO;
    if (off + 24 > bytes.byteLength) break;
    const s1 = dv.getUint32(off + 8, false);
    const e1 = dv.getUint32(off + 12, false);
    const s2 = dv.getUint32(off + 16, false);
    const e2 = dv.getUint32(off + 20, false);
    if (
      s1 === ESX1_EMPTY_OFFSET ||
      e1 === ESX1_EMPTY_OFFSET ||
      s2 === ESX1_EMPTY_OFFSET ||
      e2 === ESX1_EMPTY_OFFSET
    ) continue;
    if (e1 <= s1 || e2 <= s2) continue;
    const len1 = e1 - s1;
    const len2 = e2 - s2;
    if (len1 > MAX_BYTES_PER_SLOT || len2 > MAX_BYTES_PER_SLOT) continue;
    if (e1 > pcmRegionEnd || e2 > pcmRegionEnd) continue;
    // Push L then R (so stereo channels stay contiguous in output: L,R).
    ranges.push({
      srcRel: s1,
      byteLength: len1,
      headerKind: "stereo-L",
      headerIndex: i,
    });
    ranges.push({
      srcRel: s2,
      byteLength: len2,
      headerKind: "stereo-R",
      headerIndex: i,
    });
  }

  return ranges;
}

/**
 * Same structural validation as `validateBankBufferForSample` in
 * `esxSamplePatcher.ts`. Kept local so callers don't have to import from two
 * libraries.
 */
function validateBankBufferForCompact(bytes: Uint8Array): void {
  if (bytes.byteLength < ESX1_SIZE_FILE_MIN) {
    throw new EsxBankCompactError(
      `bank buffer too small: ${bytes.byteLength} bytes (need >= ${ESX1_SIZE_FILE_MIN})`,
    );
  }
  if (bytes.byteLength > ESX_FILE_MAX_BYTES) {
    throw new EsxBankCompactError(
      `bank buffer size ${bytes.byteLength} exceeds max ${ESX_FILE_MAX_BYTES}`,
    );
  }
  for (let i = 0; i < ESX1_SIGNATURE.length; i++) {
    if (bytes[i] !== ESX1_SIGNATURE[i]) {
      throw new EsxBankCompactError(
        `invalid ESX-1 signature at offset 0x00 (expected 'KORG')`,
      );
    }
  }
  for (let i = 0; i < ESX1_SUBMAGIC.length; i++) {
    if (bytes[ESX1_SUBMAGIC_OFFSET + i] !== ESX1_SUBMAGIC[i]) {
      throw new EsxBankCompactError(
        `invalid ESX-1 sub-magic at offset 0x${ESX1_SUBMAGIC_OFFSET.toString(16)}`,
      );
    }
  }
  for (let i = 0; i < ESX1_SIGNATURE.length; i++) {
    if (bytes[ESX1_ADDR_VALID_CHECK_2 + i] !== ESX1_SIGNATURE[i]) {
      throw new EsxBankCompactError(
        `invalid sample-section magic at 0x${ESX1_ADDR_VALID_CHECK_2.toString(16)}`,
      );
    }
  }
}

function toUint8(buf: ArrayBuffer | Uint8Array): Uint8Array {
  if (buf instanceof Uint8Array) return buf;
  if (buf instanceof ArrayBuffer) return new Uint8Array(buf);
  throw new EsxBankCompactError("expected ArrayBuffer or Uint8Array");
}
