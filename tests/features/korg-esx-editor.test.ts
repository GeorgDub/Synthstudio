/**
 * tests/features/korg-esx-editor.test.ts
 *
 * v3.29.0 — ESX-1 Bank-Editor State + IPC wiring tests.
 *
 * Scope:
 *   (1) buildEsxSlotOverview produces 256 dense rows from a parsed bank
 *       (parser skips empty slots — overview synthesises empty placeholders).
 *   (2) stageEsxPatch / unstageEsxPatch — immutable Map operations.
 *   (3) commitEsxPatches applies all staged patches in deterministic order
 *       and bit-exactly preserves every other slot (FNV-1a hash check).
 *   (4) Init-filter hides "init pattern"-named slots only.
 *   (5) Search-filter matches against index OR name.
 *   (6) IPC validator round-trip — validateEsxBankSaveFilename accepts our
 *       proposed default name, validateEsxBankBuffer accepts a synthetic
 *       bank's first 16 bytes.
 *
 * Env: node (no jsdom, no DOM/file APIs).
 */

import { describe, it, expect } from "vitest";

import {
  buildEsxSlotOverview,
  commitEsxPatches,
  countPendingEsxPatches,
  filterEsxRows,
  hasPendingEsxPatches,
  isInitPatternName,
  stageEsxPatch,
  unstageEsxPatch,
  type EsxSlotRow,
} from "../../client/src/utils/korg/esxBankEditorState";
import {
  buildEsxPatternBlock,
  type EsxDrumPartInput,
  type EsxStepInput,
  type EsxPatternInput,
} from "../../client/src/utils/korg/esxPatternBuilder";
import {
  convertSynthstudioPatternToEsx,
} from "../../client/src/utils/korg/esxPatternConvert";
import { fnv1aHash32 } from "../../client/src/utils/korg/esxBankPatcher";
import {
  parseEsxBank,
  parseEsxPattern,
} from "../../client/src/utils/korg/esxParser";
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
import {
  validateEsxBankSaveFilename,
  validateEsxBankBuffer,
} from "../../electron/ipcValidators";

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
 * Build a minimal but structurally-valid .esx bank with the given pattern
 * blocks placed at slots 0..N. Mirrors buildSyntheticEsxBank from
 * korg-esx-bank-patch.test.ts so commit-tests can share semantics.
 */
function buildSyntheticEsxBank(patternBlocks: Uint8Array[]): Uint8Array {
  const size = ESX1_SIZE_FILE_MIN + 1024;
  const buf = new Uint8Array(size);

  // Magic + sub-magic + second-magic
  buf.set(ESX1_SIGNATURE, 0);
  buf.set(ESX1_SUBMAGIC, ESX1_SUBMAGIC_OFFSET);
  buf.set(ESX1_SIGNATURE, ESX1_ADDR_VALID_CHECK_2);

  // Sample counters all zero, sample headers all empty.
  const dv = new DataView(buf.buffer);
  dv.setUint32(ESX1_ADDR_NUM_MONO_SAMPLES + 0, 0, false);
  dv.setUint32(ESX1_ADDR_NUM_MONO_SAMPLES + 4, 0, false);
  dv.setUint32(ESX1_ADDR_NUM_MONO_SAMPLES + 8, 0, false);
  for (let i = 0; i < 256; i++) {
    const off =
      ESX1_ADDR_SAMPLE_HEADER_MONO + i * ESX1_CHUNKSIZE_SAMPLE_HEADER_MONO;
    dv.setUint32(off + 8, ESX1_EMPTY_OFFSET, false);
    dv.setUint32(off + 12, ESX1_EMPTY_OFFSET, false);
  }
  for (let i = 0; i < 128; i++) {
    const off =
      ESX1_ADDR_SAMPLE_HEADER_STEREO + i * ESX1_CHUNKSIZE_SAMPLE_HEADER_STEREO;
    dv.setUint32(off + 8, ESX1_EMPTY_OFFSET, false);
    dv.setUint32(off + 12, ESX1_EMPTY_OFFSET, false);
    dv.setUint32(off + 16, ESX1_EMPTY_OFFSET, false);
    dv.setUint32(off + 20, ESX1_EMPTY_OFFSET, false);
  }

  // Pattern blocks at 0x0200 + i*4280
  for (let i = 0; i < Math.min(patternBlocks.length, ESX1_NUM_PATTERNS); i++) {
    const off = ESX1_ADDR_PATTERN_DATA + i * ESX1_CHUNKSIZE_PATTERN;
    if (off + ESX1_CHUNKSIZE_PATTERN > buf.length) break;
    buf.set(patternBlocks[i], off);
  }

  // Garbage in the song region so we can detect any accidental write.
  for (let i = ESX1_ADDR_SONG_DATA; i < ESX1_ADDR_VALID_CHECK_2; i++) {
    buf[i] = (i * 7 + 11) & 0xff;
  }
  return buf;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("esxBankEditorState — buildEsxSlotOverview", () => {
  it("synthesises 256 dense rows from a bank with 3 seed patterns", () => {
    const block0 = new Uint8Array(
      buildEsxPatternBlock(makePatternInput({ name: "SEED0", bpm: 120 })),
    );
    const block1 = new Uint8Array(
      buildEsxPatternBlock(makePatternInput({ name: "SEED1", bpm: 140 })),
    );
    const block5 = new Uint8Array(
      buildEsxPatternBlock(makePatternInput({ name: "SEED5", bpm: 175 })),
    );
    // Fill slots 0,1 directly and slot 5 (with empties at 2,3,4).
    const seeds = new Array<Uint8Array>(6).fill(new Uint8Array(4280));
    seeds[0] = block0;
    seeds[1] = block1;
    seeds[5] = block5;

    const bank = parseEsxBank(buildSyntheticEsxBank(seeds));
    const rows = buildEsxSlotOverview(bank);

    expect(rows.length).toBe(256);
    expect(rows[0]).toEqual({
      index: 0,
      empty: false,
      name: "SEED0",
      bpm: 120,
      stepLength: 16,
    });
    expect(rows[1].name).toBe("SEED1");
    expect(rows[1].bpm).toBeCloseTo(140, 1);
    expect(rows[2].empty).toBe(true);
    expect(rows[3].empty).toBe(true);
    expect(rows[5].name).toBe("SEED5");
    expect(rows[5].bpm).toBeCloseTo(175, 1);
    expect(rows[255].empty).toBe(true);
  });

  it("returns all-empty rows when the bank has no patterns", () => {
    const bank = parseEsxBank(buildSyntheticEsxBank([]));
    const rows = buildEsxSlotOverview(bank);
    expect(rows.length).toBe(256);
    expect(rows.every((r) => r.empty)).toBe(true);
    expect(rows[0]).toEqual({
      index: 0,
      empty: true,
      name: "",
      bpm: 0,
      stepLength: 0,
    });
  });
});

describe("esxBankEditorState — stageEsxPatch / unstageEsxPatch", () => {
  it("stages a patch immutably and counts it as pending", () => {
    const block = buildEsxPatternBlock(makePatternInput({ name: "P1" }));
    const empty = new Map<number, ArrayBuffer>();
    const next = stageEsxPatch(empty, 7, block);
    expect(empty.size).toBe(0); // input unchanged
    expect(next.size).toBe(1);
    expect(next.has(7)).toBe(true);
    expect(hasPendingEsxPatches(next)).toBe(true);
    expect(countPendingEsxPatches(next)).toBe(1);
  });

  it("replaces an existing patch when staging the same slot twice", () => {
    const block1 = buildEsxPatternBlock(makePatternInput({ name: "P1", bpm: 100 }));
    const block2 = buildEsxPatternBlock(makePatternInput({ name: "P2", bpm: 175 }));
    const s1 = stageEsxPatch(new Map(), 3, block1);
    const s2 = stageEsxPatch(s1, 3, block2);
    expect(s2.size).toBe(1);
    expect(s2.get(3)).toBe(block2);
  });

  it("unstages a patch and returns the same map when slot is unknown", () => {
    const block = buildEsxPatternBlock(makePatternInput({ name: "X" }));
    const staged = stageEsxPatch(new Map(), 9, block);
    const reverted = unstageEsxPatch(staged, 9);
    expect(reverted.size).toBe(0);
    // Unstage non-existent → returns SAME reference (no allocation).
    const sameRef = unstageEsxPatch(reverted, 42);
    expect(sameRef).toBe(reverted);
  });

  it("throws on invalid slot index", () => {
    const block = buildEsxPatternBlock(makePatternInput({ name: "X" }));
    expect(() => stageEsxPatch(new Map(), -1, block)).toThrow();
    expect(() => stageEsxPatch(new Map(), 256, block)).toThrow();
    expect(() => stageEsxPatch(new Map(), 1.5, block)).toThrow();
  });

  it("throws when the staged block is not exactly 4280 bytes", () => {
    expect(() =>
      stageEsxPatch(new Map(), 0, new ArrayBuffer(4279)),
    ).toThrow();
    expect(() =>
      stageEsxPatch(new Map(), 0, new ArrayBuffer(4281)),
    ).toThrow();
  });
});

describe("esxBankEditorState — commitEsxPatches (bit-exact preservation)", () => {
  it("applies a single staged patch and preserves all other 255 slots", () => {
    const seeds = new Array<Uint8Array>(8).fill(new Uint8Array(4280));
    for (let i = 0; i < 8; i++) {
      seeds[i] = new Uint8Array(
        buildEsxPatternBlock(makePatternInput({ name: `SEED${i}`, bpm: 100 + i })),
      );
    }
    const bank = buildSyntheticEsxBank(seeds);

    // Pre-patch per-slot hashes.
    const slotHashes: Record<number, number> = {};
    for (let i = 0; i < ESX1_NUM_PATTERNS; i++) {
      const off = ESX1_ADDR_PATTERN_DATA + i * ESX1_CHUNKSIZE_PATTERN;
      slotHashes[i] = fnv1aHash32(bank, off, off + ESX1_CHUNKSIZE_PATTERN);
    }

    const newBlock = buildEsxPatternBlock(
      makePatternInput({ name: "PATCH5", bpm: 175 }),
    );
    const staged = stageEsxPatch(new Map(), 5, newBlock);
    const committed = commitEsxPatches(bank.buffer, staged);
    const committedU8 = new Uint8Array(committed);

    expect(committed.byteLength).toBe(bank.byteLength);

    // Slot 5 is replaced with the new block.
    const off5 = ESX1_ADDR_PATTERN_DATA + 5 * ESX1_CHUNKSIZE_PATTERN;
    for (let i = 0; i < ESX1_CHUNKSIZE_PATTERN; i++) {
      expect(committedU8[off5 + i]).toBe(new Uint8Array(newBlock)[i]);
    }

    // All other slots bit-exact identical via FNV-1a.
    for (let i = 0; i < ESX1_NUM_PATTERNS; i++) {
      if (i === 5) continue;
      const off = ESX1_ADDR_PATTERN_DATA + i * ESX1_CHUNKSIZE_PATTERN;
      const hash = fnv1aHash32(committedU8, off, off + ESX1_CHUNKSIZE_PATTERN);
      expect(hash).toBe(slotHashes[i]);
    }

    // Round-trip via parser: slot 5 now has new name+BPM.
    const reparsed = parseEsxBank(committed);
    const patchedSlot = reparsed.patterns.find((p) => p.index === 5);
    expect(patchedSlot).toBeDefined();
    expect(patchedSlot!.name).toBe("PATCH5");
    expect(patchedSlot!.bpm).toBeCloseTo(175, 1);
  });

  it("applies multiple staged patches in deterministic slot-index order", () => {
    const bank = buildSyntheticEsxBank([]);
    const blockA = buildEsxPatternBlock(
      makePatternInput({ name: "PATCH_A", bpm: 100 }),
    );
    const blockB = buildEsxPatternBlock(
      makePatternInput({ name: "PATCH_B", bpm: 200 }),
    );
    const blockC = buildEsxPatternBlock(
      makePatternInput({ name: "PATCH_C", bpm: 150 }),
    );

    // Stage in reverse order; commit should still apply correctly.
    let staged = new Map<number, ArrayBuffer>();
    staged = stageEsxPatch(staged, 255, blockC);
    staged = stageEsxPatch(staged, 0, blockA);
    staged = stageEsxPatch(staged, 100, blockB);

    const committed = commitEsxPatches(bank.buffer, staged);
    const reparsed = parseEsxBank(committed);
    const byIndex = new Map(reparsed.patterns.map((p) => [p.index, p]));

    expect(byIndex.get(0)!.name).toBe("PATCH_A");
    expect(byIndex.get(0)!.bpm).toBeCloseTo(100, 1);
    expect(byIndex.get(100)!.name).toBe("PATCH_B");
    expect(byIndex.get(100)!.bpm).toBeCloseTo(200, 1);
    expect(byIndex.get(255)!.name).toBe("PATCH_C");
    expect(byIndex.get(255)!.bpm).toBeCloseTo(150, 1);
  });

  it("empty pending map returns a fresh copy with identical bytes", () => {
    const bank = buildSyntheticEsxBank([]);
    const committed = commitEsxPatches(bank.buffer, new Map());
    expect(committed.byteLength).toBe(bank.byteLength);
    const committedU8 = new Uint8Array(committed);
    // Should be byte-identical (commit just copies on empty map).
    expect(fnv1aHash32(committedU8)).toBe(fnv1aHash32(bank));
    // ...but a *new* buffer object (caller cannot mutate the input).
    expect(committed).not.toBe(bank.buffer);
  });
});

describe("esxBankEditorState — isInitPatternName", () => {
  it("recognises common init-pattern names case-insensitively", () => {
    expect(isInitPatternName("Init Pattern")).toBe(true);
    expect(isInitPatternName("INIT PATTERN")).toBe(true);
    expect(isInitPatternName("init pattern")).toBe(true);
    expect(isInitPatternName("  Init Pattern  ")).toBe(true);
    expect(isInitPatternName("Init Pat")).toBe(true);
    expect(isInitPatternName("init")).toBe(true);
  });

  it("does not match unrelated names", () => {
    expect(isInitPatternName("KICK")).toBe(false);
    expect(isInitPatternName("SEED0")).toBe(false);
    expect(isInitPatternName("MyInitial")).toBe(false);
    expect(isInitPatternName("")).toBe(false);
  });
});

describe("esxBankEditorState — filterEsxRows", () => {
  function makeRow(index: number, name: string, empty = false): EsxSlotRow {
    return {
      index,
      empty,
      name,
      bpm: empty ? 0 : 120,
      stepLength: empty ? 0 : 16,
    };
  }

  it("hides empty rows when hideEmpty=true", () => {
    const rows: EsxSlotRow[] = [
      makeRow(0, "KICK"),
      makeRow(1, "", true),
      makeRow(2, "SNARE"),
    ];
    const filtered = filterEsxRows(rows, "", false, true);
    expect(filtered.map((r) => r.name)).toEqual(["KICK", "SNARE"]);
  });

  it("hides Init Pattern rows when hideInit=true (but keeps empties)", () => {
    const rows: EsxSlotRow[] = [
      makeRow(0, "KICK"),
      makeRow(1, "Init Pattern"),
      makeRow(2, "init"),
      makeRow(3, "SNARE"),
    ];
    const filtered = filterEsxRows(rows, "", true, false);
    expect(filtered.map((r) => r.name)).toEqual(["KICK", "SNARE"]);
  });

  it("filters by case-insensitive name substring", () => {
    const rows: EsxSlotRow[] = [
      makeRow(0, "KICK"),
      makeRow(1, "SnareRoll"),
      makeRow(2, "HiHat"),
    ];
    const filtered = filterEsxRows(rows, "snare", false, false);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe("SnareRoll");
  });

  it("filters by exact index string", () => {
    const rows: EsxSlotRow[] = [
      makeRow(0, "KICK"),
      makeRow(5, "SNARE"),
      makeRow(127, "HiHat"),
    ];
    const filtered = filterEsxRows(rows, "5", false, false);
    expect(filtered.map((r) => r.index)).toEqual([5]);
    const padded = filterEsxRows(rows, "005", false, false);
    expect(padded.map((r) => r.index)).toEqual([5]);
  });
});

describe("ESX-Editor → Save flow (end-to-end via convert + IPC validators)", () => {
  it("convert→build→stage→commit→IPC-validators all accept the result", () => {
    // 1. Synthstudio-Pattern → ESX-Block (mimics what the editor does on
    //    "Replace with current pattern" click).
    const synthPattern = {
      name: "MY_BEAT",
      bpm: 128,
      stepCount: 16,
      parts: [
        {
          volume: 0.9,
          pan: 0,
          steps: [
            { active: true, velocity: 110 },
            { active: false },
            { active: true, velocity: 90 },
            { active: false },
          ],
        },
      ],
    };
    const esxInput = convertSynthstudioPatternToEsx(synthPattern);
    const block = buildEsxPatternBlock(esxInput);
    expect(block.byteLength).toBe(4280);

    // 2. Stage + commit on a synthetic bank.
    const bank = buildSyntheticEsxBank([]);
    const staged = stageEsxPatch(new Map(), 12, block);
    const committed = commitEsxPatches(bank.buffer, staged);

    // 3. IPC validators accept the produced bank.
    const filename = "my_beat.esx";
    const filenameCheck = validateEsxBankSaveFilename(filename);
    expect(filenameCheck.ok).toBe(true);

    const prefix = new Uint8Array(committed.slice(0, 16));
    const bufCheck = validateEsxBankBuffer(committed.byteLength, prefix);
    expect(bufCheck.ok).toBe(true);

    // 4. Round-trip parse confirms the patched slot.
    const reparsed = parseEsxBank(committed);
    const patched = reparsed.patterns.find((p) => p.index === 12);
    expect(patched).toBeDefined();
    expect(patched!.name).toBe("MY_BEAT");
    expect(patched!.bpm).toBeCloseTo(128, 1);
  });

  it("IPC filename validator rejects unsafe variants", () => {
    expect(validateEsxBankSaveFilename("my.all").ok).toBe(false); // wrong ext
    expect(validateEsxBankSaveFilename("../etc/passwd.esx").ok).toBe(false);
    expect(validateEsxBankSaveFilename("a\0b.esx").ok).toBe(false);
    expect(validateEsxBankSaveFilename("no_slash/in_name.esx").ok).toBe(false);
    expect(validateEsxBankSaveFilename("").ok).toBe(false);
    expect(validateEsxBankSaveFilename("ok_name.esx").ok).toBe(true);
  });

  it("parseEsxPattern of the patched slot returns identical name+BPM+stepLength", () => {
    const block = buildEsxPatternBlock(
      makePatternInput({ name: "ROUND", bpm: 175, stepLength: 16 }),
    );
    const bank = buildSyntheticEsxBank([]);
    const staged = stageEsxPatch(new Map(), 42, block);
    const committed = commitEsxPatches(bank.buffer, staged);

    const off = ESX1_ADDR_PATTERN_DATA + 42 * ESX1_CHUNKSIZE_PATTERN;
    const slotBytes = new Uint8Array(committed).subarray(
      off,
      off + ESX1_CHUNKSIZE_PATTERN,
    );
    const parsed = parseEsxPattern(slotBytes, 42);
    expect(parsed).not.toBeNull();
    expect(parsed!.name).toBe("ROUND");
    expect(parsed!.bpm).toBeCloseTo(175, 1);
    expect(parsed!.lengthSteps).toBe(16);
  });
});
