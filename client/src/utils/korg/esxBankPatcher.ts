/**
 * Synthstudio – KORG ESX-1 Bank Pattern-Patcher (v3.28.0)
 *
 * Pure-TypeScript, isomorphic library to **replace** individual pattern slots
 * in an existing `.esx` bank-file **bit-exactly** preserving everything else
 * (global parameters, song data, sample-section, all other pattern slots).
 *
 * Rationale (Pragmatic Mirror of v3.6.0 E2S Raw-RIFF-Passthrough):
 *   ESX-1 `.esx`-Files weigh ~24-28 MB (256 patterns + 384 samples + sample
 *   PCM up to 24 MB). Building a full bank from scratch would require
 *   reconstructing every sample-header, sample PCM payload, slice tables,
 *   song data and the global section — a massive endeavour. Instead, v3.28
 *   offers a **slot-replace** workflow analogous to the E2S
 *   `preserveRawRiff`-Pfad in `e2sBankBuilder.ts`: load existing .esx →
 *   replace one or more 4280-byte pattern slots → write back.
 *
 * SCOPE (v3.28.0):
 *   - Single-slot patch + bulk-patch with multiple slot replacements.
 *   - Each new pattern-data block MUST be exactly ESX1_CHUNKSIZE_PATTERN
 *     (4280 bytes) — typically produced by `buildEsxPatternBlock(...)` from
 *     `esxPatternBuilder.ts` (v3.27).
 *   - Defensive validation: magic-bytes check, pattern-index bounds,
 *     pattern-data size, input/output buffer integrity.
 *   - **NO** sample/song/global modifications — those bytes are bit-exact
 *     preserved.
 *
 * Bit-Exact-Guarantee (verified via tests):
 *   - The output buffer has the same byteLength as the input.
 *   - Bytes [0, 0x200) (header + global parameters) are unchanged.
 *   - Bytes [0x200, 0x200 + patternIndex*4280) are unchanged.
 *   - Bytes [0x200 + patternIndex*4280, 0x200 + (patternIndex+1)*4280) are
 *     overwritten with the new pattern data (exactly 4280 bytes).
 *   - Bytes [0x200 + (patternIndex+1)*4280, EOF) are unchanged.
 *
 * Layout reference (from `constants.ts`):
 *   0x00000000   "KORG" magic
 *   0x00000008   "ESX\0" sub-magic
 *   0x00000020   Global parameters (192 B)
 *   0x00000200   Pattern data (256 × 4280 B = 1,096,448 B)
 *   0x00130000   Song data
 *   0x001B0000   Sample section (sample headers + PCM)
 */

import {
  ESX1_ADDR_PATTERN_DATA,
  ESX1_CHUNKSIZE_PATTERN,
  ESX1_NUM_PATTERNS,
  ESX1_SIGNATURE,
  ESX1_SIZE_FILE_MIN,
  ESX1_SUBMAGIC,
  ESX1_SUBMAGIC_OFFSET,
  ESX_FILE_MAX_BYTES,
} from "./constants";

// ─── Public types ────────────────────────────────────────────────────────────

/** One slot replacement entry for `patchEsxBankPatterns`. */
export interface EsxBankPatch {
  /** Pattern-slot index 0..255. */
  index: number;
  /** Raw 4280-byte pattern data (produced by `buildEsxPatternBlock`). */
  data: ArrayBuffer | Uint8Array;
}

export class EsxBankPatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EsxBankPatchError";
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Replace a single pattern slot in an .esx bank-buffer, returning a new
 * buffer with the same byteLength.
 *
 * @param bankBuffer  Full .esx bank as ArrayBuffer or Uint8Array (~24-28 MB).
 * @param patternIndex  Slot index 0..255.
 * @param newPatternData  Exact 4280-byte pattern block.
 * @throws EsxBankPatchError on invalid magic, index out of range, wrong size,
 *         or input too small to contain a pattern table.
 */
export function patchEsxBankPattern(
  bankBuffer: ArrayBuffer | Uint8Array,
  patternIndex: number,
  newPatternData: ArrayBuffer | Uint8Array,
): ArrayBuffer {
  return patchEsxBankPatterns(bankBuffer, [
    { index: patternIndex, data: newPatternData },
  ]);
}

/**
 * Replace **multiple** pattern slots in a single pass. Each patch overwrites
 * exactly 4280 bytes at offset `0x200 + index × 4280`.
 *
 * Defensive: All patches are validated **before** any byte is written, so a
 * single bad input causes a clean throw with the original buffer untouched.
 *
 * @throws EsxBankPatchError on validation errors (see throws of
 *         `validatePatchInputs`).
 */
export function patchEsxBankPatterns(
  bankBuffer: ArrayBuffer | Uint8Array,
  patches: EsxBankPatch[],
): ArrayBuffer {
  // ── 1. Validate bank buffer ────────────────────────────────────────────────
  const inputBytes = toUint8(bankBuffer);
  validateBankBuffer(inputBytes);

  // ── 2. Validate every patch up-front (fail-fast, atomic semantics) ─────────
  if (!Array.isArray(patches)) {
    throw new EsxBankPatchError("patches must be an array");
  }
  if (patches.length === 0) {
    // No-op: still return a fresh copy so the caller cannot mutate the input
    // via the returned buffer.
    const out = new ArrayBuffer(inputBytes.byteLength);
    new Uint8Array(out).set(inputBytes);
    return out;
  }

  const seenIndices = new Set<number>();
  for (let i = 0; i < patches.length; i++) {
    const p = patches[i];
    if (!p || typeof p !== "object") {
      throw new EsxBankPatchError(`patch[${i}] is not an object`);
    }
    if (
      typeof p.index !== "number" ||
      !Number.isInteger(p.index) ||
      p.index < 0 ||
      p.index >= ESX1_NUM_PATTERNS
    ) {
      throw new EsxBankPatchError(
        `patch[${i}].index ${p.index} out of range [0,${ESX1_NUM_PATTERNS})`,
      );
    }
    if (seenIndices.has(p.index)) {
      throw new EsxBankPatchError(
        `patch[${i}].index ${p.index} appears more than once`,
      );
    }
    seenIndices.add(p.index);

    const dataBytes = toUint8(p.data);
    if (dataBytes.byteLength !== ESX1_CHUNKSIZE_PATTERN) {
      throw new EsxBankPatchError(
        `patch[${i}].data size ${dataBytes.byteLength} != ${ESX1_CHUNKSIZE_PATTERN}`,
      );
    }

    // Ensure the bank is large enough to hold this slot.
    const slotEnd =
      ESX1_ADDR_PATTERN_DATA + (p.index + 1) * ESX1_CHUNKSIZE_PATTERN;
    if (slotEnd > inputBytes.byteLength) {
      throw new EsxBankPatchError(
        `bank buffer too small for pattern slot ${p.index} (need >= ${slotEnd}, got ${inputBytes.byteLength})`,
      );
    }
  }

  // ── 3. Copy bank → fresh buffer ────────────────────────────────────────────
  const outBuffer = new ArrayBuffer(inputBytes.byteLength);
  const outBytes = new Uint8Array(outBuffer);
  outBytes.set(inputBytes);

  // ── 4. Apply patches sequentially ──────────────────────────────────────────
  for (const p of patches) {
    const dataBytes = toUint8(p.data);
    const offset = ESX1_ADDR_PATTERN_DATA + p.index * ESX1_CHUNKSIZE_PATTERN;
    outBytes.set(dataBytes, offset);
  }

  return outBuffer;
}

// ─── Validation helpers (also exported for tests) ────────────────────────────

/**
 * Defensive structural validation. Verifies size + KORG/ESX magic. Pattern-
 * data content is **not** decoded — that's the parser's job.
 *
 * @throws EsxBankPatchError on size or magic violations.
 */
export function validateBankBuffer(buf: ArrayBuffer | Uint8Array): void {
  const bytes = toUint8(buf);
  if (bytes.byteLength < ESX1_SIZE_FILE_MIN) {
    throw new EsxBankPatchError(
      `bank buffer too small: ${bytes.byteLength} bytes (need >= ${ESX1_SIZE_FILE_MIN})`,
    );
  }
  if (bytes.byteLength > ESX_FILE_MAX_BYTES) {
    throw new EsxBankPatchError(
      `bank buffer size ${bytes.byteLength} exceeds max ${ESX_FILE_MAX_BYTES}`,
    );
  }
  // "KORG" @ 0x00
  for (let i = 0; i < ESX1_SIGNATURE.length; i++) {
    if (bytes[i] !== ESX1_SIGNATURE[i]) {
      throw new EsxBankPatchError(
        `invalid ESX-1 signature at offset 0x00 (expected 'KORG')`,
      );
    }
  }
  // "ESX\0" @ 0x08
  for (let i = 0; i < ESX1_SUBMAGIC.length; i++) {
    if (bytes[ESX1_SUBMAGIC_OFFSET + i] !== ESX1_SUBMAGIC[i]) {
      throw new EsxBankPatchError(
        `invalid ESX-1 sub-magic at offset 0x${ESX1_SUBMAGIC_OFFSET.toString(
          16,
        )} (expected 'ESX\\0')`,
      );
    }
  }
}

/**
 * Quick structural check WITHOUT throwing. Returns true if the buffer looks
 * like a valid ESX-1 bank (size + magic only). Used by UI gating.
 */
export function looksLikeEsxBank(buf: ArrayBuffer | Uint8Array): boolean {
  try {
    validateBankBuffer(buf);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the absolute byte-offset of pattern slot `index` within an .esx
 * bank. Useful for callers that want to do their own slot reads.
 *
 * @throws EsxBankPatchError if index is out of range.
 */
export function getEsxPatternSlotOffset(index: number): number {
  if (
    typeof index !== "number" ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= ESX1_NUM_PATTERNS
  ) {
    throw new EsxBankPatchError(
      `pattern index ${index} out of range [0,${ESX1_NUM_PATTERNS})`,
    );
  }
  return ESX1_ADDR_PATTERN_DATA + index * ESX1_CHUNKSIZE_PATTERN;
}

// ─── Bit-Exact-Verification helpers (FNV-1a 32-bit) ──────────────────────────

/**
 * FNV-1a 32-bit hash of a byte-range. Used by tests to verify that
 * non-modified regions remain **bit-exactly** identical after a patch. Pure,
 * isomorphic, no DOM/Node-dependencies.
 *
 * @param bytes  Source bytes.
 * @param start  Inclusive start offset (default 0).
 * @param end    Exclusive end offset (default bytes.byteLength).
 */
export function fnv1aHash32(
  bytes: ArrayBuffer | Uint8Array,
  start = 0,
  end?: number,
): number {
  const u8 = toUint8(bytes);
  const lo = Math.max(0, Math.floor(start));
  const hi =
    typeof end === "number" ? Math.min(u8.byteLength, Math.floor(end)) : u8.byteLength;
  // FNV-1a offset basis and prime (32-bit).
  let hash = 0x811c9dc5 >>> 0;
  const PRIME = 0x01000193 >>> 0;
  for (let i = lo; i < hi; i++) {
    hash ^= u8[i];
    // Math.imul yields a proper 32-bit signed multiplication; >>>0 normalises.
    hash = Math.imul(hash, PRIME) >>> 0;
  }
  return hash;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function toUint8(buf: ArrayBuffer | Uint8Array): Uint8Array {
  if (buf instanceof Uint8Array) return buf;
  if (buf instanceof ArrayBuffer) return new Uint8Array(buf);
  throw new EsxBankPatchError(
    "expected ArrayBuffer or Uint8Array",
  );
}
