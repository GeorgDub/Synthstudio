/**
 * tests/features/korg-esx-bank-patch.test.ts
 *
 * v3.28.0 — ESX-1 Bank Pattern-Patch Library tests.
 *
 * Goldstandard-Coverage:
 *   (1) Single-slot patch overwrites exactly 4280 bytes at the right offset
 *   (2) All other 255 slots remain bit-exact identical (FNV-1a hash check)
 *   (3) Global parameters region (0x20..0x200) preserved bit-exact
 *   (4) Sample section (0x1B0000..EOF) preserved bit-exact
 *   (5) Invalid magic → throw
 *   (6) Pattern-index out of range → throw
 *   (7) Wrong patch-data size → throw
 *   (8) Bulk-patch with multiple slots in one pass
 *   (9) Empty patches array → no-op (returns identical copy)
 *  (10) ROUND-TRIP: parse → patch slot 5 → re-parse → other 255 slots intact
 *  (11) Optional real-file test against BOTTROP.ESX (conditional skip)
 *  (12) FNV-1a hash helper sanity
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  patchEsxBankPattern,
  patchEsxBankPatterns,
  validateBankBuffer,
  looksLikeEsxBank,
  getEsxPatternSlotOffset,
  fnv1aHash32,
  EsxBankPatchError,
  type EsxBankPatch,
} from "../../client/src/utils/korg/esxBankPatcher";
import {
  parseEsxBank,
  parseEsxPattern,
} from "../../client/src/utils/korg/esxParser";
import {
  buildEsxPatternBlock,
  type EsxPatternInput,
  type EsxDrumPartInput,
  type EsxStepInput,
} from "../../client/src/utils/korg/esxPatternBuilder";
import {
  ESX1_ADDR_NUM_MONO_SAMPLES,
  ESX1_ADDR_PATTERN_DATA,
  ESX1_ADDR_SAMPLE_HEADER_MONO,
  ESX1_ADDR_SAMPLE_HEADER_STEREO,
  ESX1_ADDR_SONG_DATA,
  ESX1_ADDR_VALID_CHECK_2,
  ESX1_CHUNKSIZE_PATTERN,
  ESX1_CHUNKSIZE_SAMPLE_HEADER_MONO,
  ESX1_CHUNKSIZE_SAMPLE_HEADER_STEREO,
  ESX1_EMPTY_OFFSET,
  ESX1_NUM_PATTERNS,
  ESX1_SIGNATURE,
  ESX1_SIZE_FILE_MIN,
  ESX1_SUBMAGIC,
  ESX1_SUBMAGIC_OFFSET,
} from "../../client/src/utils/korg/constants";

// ─── Test helpers ────────────────────────────────────────────────────────────

function emptyStepArr(): EsxStepInput[] {
  return new Array(16).fill(0).map(() => ({ active: false }));
}

function emptyDrumPart(): EsxDrumPartInput {
  return { steps: emptyStepArr() };
}

function makePatternInput(overrides: Partial<EsxPatternInput> = {}): EsxPatternInput {
  return {
    name: "TEST",
    bpm: 120,
    stepLength: 16,
    drumParts: new Array(10).fill(0).map(() => emptyDrumPart()),
    stretchPart: emptyDrumPart(),
    shortParts: new Array(4).fill(0).map(() => emptyDrumPart()),
    ...overrides,
  };
}

/**
 * Builds a minimal but structurally-valid .esx bank buffer with the given
 * pattern blocks placed at slots 0..N. Magic + sub-magic + second-magic +
 * empty sample headers are filled so `validateBankBuffer` + `parseEsxBank`
 * both succeed.
 *
 * Sample-section bytes (after 0x001B0000) are filled with a non-zero "garbage"
 * pattern so we can detect any accidental write into that region. We
 * deliberately set the garbage FIRST and the parser-required fields LAST so
 * the latter take precedence.
 */
function buildSyntheticEsxBank(patternBlocks: Uint8Array[]): Uint8Array {
  // Allocate enough room for the full structure plus a small sample-section
  // tail (1024 bytes of stub data after the sample-section magic).
  const size = ESX1_SIZE_FILE_MIN + 1024;
  const buf = new Uint8Array(size);

  // ── 1. Fill global region (0x20..0x200) with a deterministic pattern ────
  for (let i = 0x20; i < ESX1_ADDR_PATTERN_DATA; i++) {
    buf[i] = (i * 17 + 5) & 0xff;
  }

  // ── 2. Fill song region with garbage (0x130000..0x1B0000) ───────────────
  for (let i = ESX1_ADDR_SONG_DATA; i < ESX1_ADDR_VALID_CHECK_2; i++) {
    buf[i] = (i * 23 + 11) & 0xff;
  }

  // ── 3. Garbage in the sample-section tail (after the magic at 0x1B0000) —
  //       LATER overwritten with magic + counters + headers below.
  for (let i = ESX1_ADDR_VALID_CHECK_2; i < buf.length; i++) {
    buf[i] = (i * 31 + 3) & 0xff;
  }

  // ── 4. Magic bytes (overrides any garbage at those exact positions) ─────
  buf.set(ESX1_SIGNATURE, 0);
  buf.set(ESX1_SUBMAGIC, ESX1_SUBMAGIC_OFFSET);
  buf.set(ESX1_SIGNATURE, ESX1_ADDR_VALID_CHECK_2);

  // ── 5. Sample counters all zero, sample headers all empty ───────────────
  const dv = new DataView(buf.buffer);
  dv.setUint32(ESX1_ADDR_NUM_MONO_SAMPLES + 0, 0, false);
  dv.setUint32(ESX1_ADDR_NUM_MONO_SAMPLES + 4, 0, false);
  dv.setUint32(ESX1_ADDR_NUM_MONO_SAMPLES + 8, 0, false);
  for (let i = 0; i < 256; i++) {
    const off = ESX1_ADDR_SAMPLE_HEADER_MONO + i * ESX1_CHUNKSIZE_SAMPLE_HEADER_MONO;
    dv.setUint32(off + 8, ESX1_EMPTY_OFFSET, false);
    dv.setUint32(off + 12, ESX1_EMPTY_OFFSET, false);
  }
  for (let i = 0; i < 128; i++) {
    const off = ESX1_ADDR_SAMPLE_HEADER_STEREO + i * ESX1_CHUNKSIZE_SAMPLE_HEADER_STEREO;
    dv.setUint32(off + 8, ESX1_EMPTY_OFFSET, false);
    dv.setUint32(off + 12, ESX1_EMPTY_OFFSET, false);
    dv.setUint32(off + 16, ESX1_EMPTY_OFFSET, false);
    dv.setUint32(off + 20, ESX1_EMPTY_OFFSET, false);
  }

  // ── 6. Pattern blocks at 0x0200 + i*4280 ────────────────────────────────
  for (let i = 0; i < Math.min(patternBlocks.length, ESX1_NUM_PATTERNS); i++) {
    const off = ESX1_ADDR_PATTERN_DATA + i * ESX1_CHUNKSIZE_PATTERN;
    if (off + ESX1_CHUNKSIZE_PATTERN > buf.length) break;
    buf.set(patternBlocks[i], off);
  }

  return buf;
}

function bytesEqualRange(
  a: Uint8Array,
  b: Uint8Array,
  start: number,
  end: number,
): boolean {
  if (a.length < end || b.length < end) return false;
  for (let i = start; i < end; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// Optional real-file test fixture path (mirrors korg-esx-patterns.test.ts).
const REAL_FILE_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "fixtures",
  "esx",
  "BOTTROP.ESX",
);
const HAS_REAL_FILE = fs.existsSync(REAL_FILE_PATH);

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("esxBankPatcher — validateBankBuffer + looksLikeEsxBank", () => {
  it("validates a synthetic ESX bank successfully", () => {
    const bank = buildSyntheticEsxBank([]);
    expect(() => validateBankBuffer(bank)).not.toThrow();
    expect(looksLikeEsxBank(bank)).toBe(true);
  });

  it("throws on invalid KORG magic", () => {
    const bank = buildSyntheticEsxBank([]);
    bank[0] = 0x00; // corrupt magic
    expect(() => validateBankBuffer(bank)).toThrowError(EsxBankPatchError);
    expect(looksLikeEsxBank(bank)).toBe(false);
  });

  it("throws on invalid ESX sub-magic", () => {
    const bank = buildSyntheticEsxBank([]);
    bank[ESX1_SUBMAGIC_OFFSET] = 0x00; // corrupt sub-magic
    expect(() => validateBankBuffer(bank)).toThrowError(EsxBankPatchError);
  });

  it("throws on buffer too small (below ESX1_SIZE_FILE_MIN)", () => {
    const tiny = new Uint8Array(100);
    tiny.set(ESX1_SIGNATURE, 0);
    tiny.set(ESX1_SUBMAGIC, ESX1_SUBMAGIC_OFFSET);
    expect(() => validateBankBuffer(tiny)).toThrowError(EsxBankPatchError);
  });
});

describe("esxBankPatcher — getEsxPatternSlotOffset", () => {
  it("returns 0x0200 for slot 0", () => {
    expect(getEsxPatternSlotOffset(0)).toBe(ESX1_ADDR_PATTERN_DATA);
    expect(getEsxPatternSlotOffset(0)).toBe(0x0200);
  });

  it("returns 0x0200 + 5*4280 for slot 5", () => {
    expect(getEsxPatternSlotOffset(5)).toBe(0x0200 + 5 * 4280);
  });

  it("throws on slot index out of range", () => {
    expect(() => getEsxPatternSlotOffset(-1)).toThrowError(EsxBankPatchError);
    expect(() => getEsxPatternSlotOffset(256)).toThrowError(EsxBankPatchError);
    expect(() => getEsxPatternSlotOffset(1.5)).toThrowError(EsxBankPatchError);
  });
});

describe("esxBankPatcher — single-slot patch", () => {
  it("overwrites exactly 4280 bytes at the right offset", () => {
    const bank = buildSyntheticEsxBank([]);
    const newBlock = buildEsxPatternBlock(makePatternInput({ name: "PATCHED", bpm: 175 }));

    const patched = patchEsxBankPattern(bank.buffer, 5, newBlock);
    const patchedU8 = new Uint8Array(patched);

    expect(patched.byteLength).toBe(bank.byteLength);
    // Slot 5 content is now the new block.
    const slotOff = ESX1_ADDR_PATTERN_DATA + 5 * 4280;
    for (let i = 0; i < 4280; i++) {
      expect(patchedU8[slotOff + i]).toBe(new Uint8Array(newBlock)[i]);
    }
  });

  it("output buffer has the same byteLength as the input", () => {
    const bank = buildSyntheticEsxBank([]);
    const newBlock = buildEsxPatternBlock(makePatternInput());
    const patched = patchEsxBankPattern(bank, 0, newBlock);
    expect(patched.byteLength).toBe(bank.byteLength);
  });

  it("accepts Uint8Array input as well as ArrayBuffer", () => {
    const bank = buildSyntheticEsxBank([]);
    const newBlock = buildEsxPatternBlock(makePatternInput());
    const patchedFromBuf = patchEsxBankPattern(bank.buffer, 0, newBlock);
    const patchedFromU8 = patchEsxBankPattern(bank, 0, new Uint8Array(newBlock));
    expect(patchedFromBuf.byteLength).toBe(patchedFromU8.byteLength);
    // Both should produce identical bytes.
    expect(fnv1aHash32(patchedFromBuf)).toBe(fnv1aHash32(patchedFromU8));
  });

  it("does not mutate the input bank buffer", () => {
    const bank = buildSyntheticEsxBank([]);
    const bankHashBefore = fnv1aHash32(bank);
    const newBlock = buildEsxPatternBlock(makePatternInput({ name: "MUT" }));
    patchEsxBankPattern(bank, 7, newBlock);
    const bankHashAfter = fnv1aHash32(bank);
    expect(bankHashAfter).toBe(bankHashBefore);
  });
});

describe("esxBankPatcher — bit-exact preservation (FNV-1a)", () => {
  it("slots [0..N-1] and [N+1..255] remain bit-exact when patching slot N", () => {
    const bank = buildSyntheticEsxBank([]);
    const SLOT = 17;
    const newBlock = buildEsxPatternBlock(makePatternInput({ name: "SLOT17", bpm: 140 }));
    const patched = new Uint8Array(patchEsxBankPattern(bank, SLOT, newBlock));

    // Compare slot-by-slot via hash.
    for (let i = 0; i < ESX1_NUM_PATTERNS; i++) {
      const off = ESX1_ADDR_PATTERN_DATA + i * 4280;
      const end = off + 4280;
      // Skip the patched slot — that's expected to differ.
      if (i === SLOT) {
        expect(fnv1aHash32(patched, off, end)).not.toBe(fnv1aHash32(bank, off, end));
      } else {
        expect(fnv1aHash32(patched, off, end)).toBe(fnv1aHash32(bank, off, end));
      }
    }
  });

  it("global parameter region [0x20..0x200) remains bit-exact", () => {
    const bank = buildSyntheticEsxBank([]);
    const newBlock = buildEsxPatternBlock(makePatternInput());
    const patched = new Uint8Array(patchEsxBankPattern(bank, 0, newBlock));
    expect(fnv1aHash32(patched, 0x20, 0x200)).toBe(fnv1aHash32(bank, 0x20, 0x200));
    expect(bytesEqualRange(patched, bank, 0x20, 0x200)).toBe(true);
  });

  it("magic header [0x00..0x20) remains bit-exact", () => {
    const bank = buildSyntheticEsxBank([]);
    const newBlock = buildEsxPatternBlock(makePatternInput());
    const patched = new Uint8Array(patchEsxBankPattern(bank, 42, newBlock));
    expect(fnv1aHash32(patched, 0, 0x20)).toBe(fnv1aHash32(bank, 0, 0x20));
  });

  it("song region [0x130000..0x1B0000) remains bit-exact", () => {
    const bank = buildSyntheticEsxBank([]);
    const newBlock = buildEsxPatternBlock(makePatternInput());
    const patched = new Uint8Array(patchEsxBankPattern(bank, 0, newBlock));
    expect(
      fnv1aHash32(patched, ESX1_ADDR_SONG_DATA, ESX1_ADDR_VALID_CHECK_2),
    ).toBe(fnv1aHash32(bank, ESX1_ADDR_SONG_DATA, ESX1_ADDR_VALID_CHECK_2));
  });

  it("sample section [0x1B0000..EOF) remains bit-exact", () => {
    const bank = buildSyntheticEsxBank([]);
    const newBlock = buildEsxPatternBlock(makePatternInput());
    const patched = new Uint8Array(patchEsxBankPattern(bank, 200, newBlock));
    expect(
      fnv1aHash32(patched, ESX1_ADDR_VALID_CHECK_2, bank.byteLength),
    ).toBe(fnv1aHash32(bank, ESX1_ADDR_VALID_CHECK_2, bank.byteLength));
  });
});

describe("esxBankPatcher — validation errors", () => {
  it("throws on pattern-index out of range", () => {
    const bank = buildSyntheticEsxBank([]);
    const newBlock = buildEsxPatternBlock(makePatternInput());
    expect(() => patchEsxBankPattern(bank, -1, newBlock)).toThrowError(EsxBankPatchError);
    expect(() => patchEsxBankPattern(bank, 256, newBlock)).toThrowError(EsxBankPatchError);
    expect(() => patchEsxBankPattern(bank, 1.5, newBlock)).toThrowError(EsxBankPatchError);
  });

  it("throws on wrong pattern-data size", () => {
    const bank = buildSyntheticEsxBank([]);
    const tooSmall = new ArrayBuffer(4279);
    const tooBig = new ArrayBuffer(4281);
    expect(() => patchEsxBankPattern(bank, 0, tooSmall)).toThrowError(EsxBankPatchError);
    expect(() => patchEsxBankPattern(bank, 0, tooBig)).toThrowError(EsxBankPatchError);
  });

  it("throws on invalid magic in bank buffer", () => {
    const bank = buildSyntheticEsxBank([]);
    bank[0] = 0x00; // wipe magic
    const newBlock = buildEsxPatternBlock(makePatternInput());
    expect(() => patchEsxBankPattern(bank, 0, newBlock)).toThrowError(EsxBankPatchError);
  });

  it("throws when bulk-patch has duplicate slot indices", () => {
    const bank = buildSyntheticEsxBank([]);
    const block = buildEsxPatternBlock(makePatternInput());
    const patches: EsxBankPatch[] = [
      { index: 3, data: block },
      { index: 3, data: block },
    ];
    expect(() => patchEsxBankPatterns(bank, patches)).toThrowError(EsxBankPatchError);
  });

  it("rejects non-array `patches` argument", () => {
    const bank = buildSyntheticEsxBank([]);
    // @ts-expect-error — intentional bad input
    expect(() => patchEsxBankPatterns(bank, null)).toThrowError(EsxBankPatchError);
  });
});

describe("esxBankPatcher — bulk patch", () => {
  it("replaces multiple slots in one pass (independent indices)", () => {
    const bank = buildSyntheticEsxBank([]);
    const blockA = buildEsxPatternBlock(makePatternInput({ name: "AAAAA", bpm: 130 }));
    const blockB = buildEsxPatternBlock(makePatternInput({ name: "BBBBB", bpm: 145 }));
    const blockC = buildEsxPatternBlock(makePatternInput({ name: "CCCCC", bpm: 175 }));
    const patches: EsxBankPatch[] = [
      { index: 0, data: blockA },
      { index: 100, data: blockB },
      { index: 255, data: blockC },
    ];
    const patched = new Uint8Array(patchEsxBankPatterns(bank, patches));

    // Each patched slot is the new block.
    expect(bytesEqualRange(patched, new Uint8Array(blockA), 0, 0)).toBe(true);
    for (let i = 0; i < 4280; i++) {
      expect(patched[ESX1_ADDR_PATTERN_DATA + 0 * 4280 + i]).toBe(new Uint8Array(blockA)[i]);
      expect(patched[ESX1_ADDR_PATTERN_DATA + 100 * 4280 + i]).toBe(new Uint8Array(blockB)[i]);
      expect(patched[ESX1_ADDR_PATTERN_DATA + 255 * 4280 + i]).toBe(new Uint8Array(blockC)[i]);
    }

    // Other 253 slots unchanged.
    const patchedIndices = new Set([0, 100, 255]);
    for (let i = 0; i < ESX1_NUM_PATTERNS; i++) {
      if (patchedIndices.has(i)) continue;
      const off = ESX1_ADDR_PATTERN_DATA + i * 4280;
      expect(fnv1aHash32(patched, off, off + 4280)).toBe(fnv1aHash32(bank, off, off + 4280));
    }
  });

  it("empty `patches` array → identical-bytes copy", () => {
    const bank = buildSyntheticEsxBank([]);
    const patched = patchEsxBankPatterns(bank, []);
    expect(patched.byteLength).toBe(bank.byteLength);
    expect(fnv1aHash32(patched)).toBe(fnv1aHash32(bank));
    // But it must be a NEW buffer (defensive copy).
    expect(patched).not.toBe(bank.buffer);
  });
});

describe("esxBankPatcher — round-trip via parser", () => {
  it("parse → patch slot 5 → re-parse: slot 5 changes, others unchanged", () => {
    // Seed the bank with synthetic pattern blocks at slots 0..7 so the parser
    // returns at least one well-formed pattern at the slot we patch.
    const seedBlocks: Uint8Array[] = [];
    for (let i = 0; i < 8; i++) {
      const blk = buildEsxPatternBlock(
        makePatternInput({ name: `SEED${i}`, bpm: 100 + i * 5 }),
      );
      seedBlocks.push(new Uint8Array(blk));
    }
    const bank = buildSyntheticEsxBank(seedBlocks);

    // Parse first
    const parsedBefore = parseEsxBank(bank);
    const slot5Before = parsedBefore.patterns.find((p) => p.index === 5);
    expect(slot5Before).toBeTruthy();
    expect(slot5Before!.name).toBe("SEED5");
    expect(slot5Before!.bpm).toBeCloseTo(125, 3);

    // Patch slot 5 with a fresh pattern.
    const newBlock = buildEsxPatternBlock(
      makePatternInput({ name: "PATCH5", bpm: 175 }),
    );
    const patched = new Uint8Array(patchEsxBankPattern(bank, 5, newBlock));

    // Re-parse
    const parsedAfter = parseEsxBank(patched);
    const slot5After = parsedAfter.patterns.find((p) => p.index === 5);
    expect(slot5After).toBeTruthy();
    expect(slot5After!.name).toBe("PATCH5");
    expect(slot5After!.bpm).toBeCloseTo(175, 3);

    // All other seeded slots must still be exactly the same as before patching.
    for (let i = 0; i < 8; i++) {
      if (i === 5) continue;
      const before = parsedBefore.patterns.find((p) => p.index === i);
      const after = parsedAfter.patterns.find((p) => p.index === i);
      expect(after).toBeTruthy();
      expect(after!.name).toBe(before!.name);
      expect(after!.bpm).toBeCloseTo(before!.bpm, 3);
    }

    // And the raw bytes of slot 0..4 + 6..7 must be bit-exact identical.
    for (let i = 0; i < 8; i++) {
      if (i === 5) continue;
      const off = ESX1_ADDR_PATTERN_DATA + i * 4280;
      expect(fnv1aHash32(patched, off, off + 4280)).toBe(fnv1aHash32(bank, off, off + 4280));
    }
  });

  it("parseEsxPattern of the patched slot returns exactly the new BPM + name", () => {
    const bank = buildSyntheticEsxBank([]);
    const newBlock = buildEsxPatternBlock(
      makePatternInput({ name: "ROUND", bpm: 128, stepLength: 32 }),
    );
    const patched = new Uint8Array(patchEsxBankPattern(bank, 10, newBlock));
    // Slice slot 10 from the patched bank and parse standalone.
    const off = ESX1_ADDR_PATTERN_DATA + 10 * 4280;
    const slotBytes = patched.subarray(off, off + 4280);
    const pat = parseEsxPattern(slotBytes, 10);
    expect(pat).not.toBeNull();
    expect(pat!.name).toBe("ROUND");
    expect(pat!.bpm).toBeCloseTo(128, 3);
    expect(pat!.lengthSteps).toBe(32);
  });
});

describe("esxBankPatcher — FNV-1a hash helper sanity", () => {
  it("returns identical hash for identical bytes", () => {
    const a = new Uint8Array([1, 2, 3, 4, 5]);
    const b = new Uint8Array([1, 2, 3, 4, 5]);
    expect(fnv1aHash32(a)).toBe(fnv1aHash32(b));
  });

  it("returns different hash if a single byte changes", () => {
    const a = new Uint8Array([1, 2, 3, 4, 5]);
    const b = new Uint8Array([1, 2, 3, 4, 6]);
    expect(fnv1aHash32(a)).not.toBe(fnv1aHash32(b));
  });

  it("honours the start/end slice arguments", () => {
    const a = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const b = new Uint8Array([99, 2, 3, 4, 5, 6, 7, 99]);
    // Hashing the middle [1..7) excludes the differing first + last byte.
    expect(fnv1aHash32(a, 1, 7)).toBe(fnv1aHash32(b, 1, 7));
  });
});

// ─── Conditional real-file test ──────────────────────────────────────────────

(HAS_REAL_FILE ? describe : describe.skip)(
  "esxBankPatcher — real-file BOTTROP.ESX (conditional)",
  () => {
    it("patches slot 0 in a real .esx and preserves every other slot bit-exact", () => {
      const raw = fs.readFileSync(REAL_FILE_PATH);
      const bank = new Uint8Array(
        raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
      );
      expect(looksLikeEsxBank(bank)).toBe(true);

      const newBlock = buildEsxPatternBlock(
        makePatternInput({ name: "RTSLOT0", bpm: 175 }),
      );
      const patched = new Uint8Array(patchEsxBankPattern(bank, 0, newBlock));
      expect(patched.byteLength).toBe(bank.byteLength);

      // Slot 0 has changed.
      const off0 = ESX1_ADDR_PATTERN_DATA;
      expect(fnv1aHash32(patched, off0, off0 + 4280)).not.toBe(
        fnv1aHash32(bank, off0, off0 + 4280),
      );

      // All other 255 slots remain bit-exact.
      for (let i = 1; i < ESX1_NUM_PATTERNS; i++) {
        const off = ESX1_ADDR_PATTERN_DATA + i * 4280;
        expect(fnv1aHash32(patched, off, off + 4280)).toBe(
          fnv1aHash32(bank, off, off + 4280),
        );
      }

      // Sample section bit-exact too.
      expect(
        fnv1aHash32(patched, ESX1_ADDR_VALID_CHECK_2, bank.byteLength),
      ).toBe(fnv1aHash32(bank, ESX1_ADDR_VALID_CHECK_2, bank.byteLength));
    });
  },
);
