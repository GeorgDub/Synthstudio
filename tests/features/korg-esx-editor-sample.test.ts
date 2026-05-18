/**
 * tests/features/korg-esx-editor-sample.test.ts
 *
 * v3.31.0 — ESX-Sample-Tab editor state tests.
 *
 * Scope (pure-fn state model only — no React, no DOM):
 *   (1) buildEsxSampleSlotOverview produces 256 dense mono rows
 *   (2) stageEsxSamplePatch / unstageEsxSamplePatch — immutable Map ops
 *   (3) commitEsxSamplePatches applies all staged samples, growing the bank
 *   (4) commitEsxPatchesAll applies patterns + samples (composite pipeline)
 *   (5) filterEsxSampleRows + formatSampleLength helpers
 *
 * Env: node (no jsdom).
 */

import { describe, it, expect } from "vitest";

import {
  buildEsxSampleSlotOverview,
  buildEsxStereoSampleSlotOverview,
  commitEsxPatches,
  commitEsxPatchesAll,
  commitEsxSamplePatches,
  commitEsxStereoSamplePatches,
  countPendingEsxSamplePatches,
  countPendingEsxStereoSamplePatches,
  filterEsxSampleRows,
  filterEsxStereoSampleRows,
  formatSampleLength,
  hasPendingEsxSamplePatches,
  hasPendingEsxStereoSamplePatches,
  stageEsxPatch,
  stageEsxSamplePatch,
  stageEsxStereoSamplePatch,
  unstageEsxSamplePatch,
  unstageEsxStereoSamplePatch,
  type EsxSamplePatchEntry,
  type EsxSampleSlotRow,
  type EsxStereoSampleSlotRow,
} from "../../client/src/utils/korg/esxBankEditorState";
import {
  buildEsxPatternBlock,
  type EsxDrumPartInput,
  type EsxPatternInput,
  type EsxStepInput,
} from "../../client/src/utils/korg/esxPatternBuilder";
import {
  encodeEsxName,
  patchEsxBankSample,
} from "../../client/src/utils/korg/esxSamplePatcher";
import { fnv1aHash32 } from "../../client/src/utils/korg/esxBankPatcher";
import { parseEsxBank } from "../../client/src/utils/korg/esxParser";
import {
  ESX1_ADDR_NUM_MONO_SAMPLES,
  ESX1_ADDR_PATTERN_DATA,
  ESX1_ADDR_SAMPLE_DATA,
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

function makeFloat32Sine(frames: number, freq = 440, sr = 44100): Float32Array {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    out[i] = Math.sin((2 * Math.PI * freq * i) / sr) * 0.5;
  }
  return out;
}

/**
 * Build a minimal valid .esx bank, optionally pre-filled with a few mono
 * sample slots. Mirrors the helper used in korg-esx-sample-patch.test.ts
 * but adapted to also seed pattern slots so commitEsxPatchesAll tests work.
 */
function buildSyntheticEsxBank(opts: {
  prefilledMonoSamples?: Array<{
    index: number;
    pcmBytes: Uint8Array;
    sampleRate: number;
    name: string;
  }>;
  patternBlocks?: Uint8Array[];
} = {}): Uint8Array {
  const prefilledMono = opts.prefilledMonoSamples ?? [];
  const patternBlocks = opts.patternBlocks ?? [];
  const prefillTotalBytes = prefilledMono.reduce(
    (sum, p) => sum + p.pcmBytes.byteLength,
    0,
  );
  const size = ESX1_SIZE_FILE_MIN + prefillTotalBytes + 1024;
  const buf = new Uint8Array(size);

  // Magic + sub-magic + second-magic
  buf.set(ESX1_SIGNATURE, 0);
  buf.set(ESX1_SUBMAGIC, ESX1_SUBMAGIC_OFFSET);
  buf.set(ESX1_SIGNATURE, ESX1_ADDR_VALID_CHECK_2);

  const dv = new DataView(buf.buffer);

  // Counters
  dv.setUint32(ESX1_ADDR_NUM_MONO_SAMPLES + 0, prefilledMono.length, false);
  dv.setUint32(ESX1_ADDR_NUM_MONO_SAMPLES + 4, 0, false);
  dv.setUint32(ESX1_ADDR_NUM_MONO_SAMPLES + 8, prefillTotalBytes, false);

  // Empty all mono/stereo headers
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

  // Pre-fill mono sample slots
  let nextRel = 0;
  for (const p of prefilledMono) {
    const len = p.pcmBytes.byteLength;
    const off =
      ESX1_ADDR_SAMPLE_HEADER_MONO + p.index * ESX1_CHUNKSIZE_SAMPLE_HEADER_MONO;
    const nameBytes = encodeEsxName(p.name);
    buf.set(nameBytes, off);
    dv.setUint32(off + 8, nextRel, false);
    dv.setUint32(off + 12, nextRel + len, false);
    dv.setUint32(off + 16, 0, false);
    dv.setUint32(off + 20, len / 2, false);
    dv.setUint32(off + 24, 0, false);
    dv.setUint32(off + 28, p.sampleRate, false);
    buf[off + 34] = 100;
    buf.set(p.pcmBytes, ESX1_ADDR_SAMPLE_DATA + nextRel);
    nextRel += len;
  }
  dv.setUint32(ESX1_ADDR_NUM_MONO_SAMPLES + 8, nextRel, false);

  // Seed pattern slots
  for (let i = 0; i < Math.min(patternBlocks.length, ESX1_NUM_PATTERNS); i++) {
    const off = ESX1_ADDR_PATTERN_DATA + i * ESX1_CHUNKSIZE_PATTERN;
    if (off + ESX1_CHUNKSIZE_PATTERN > buf.length) break;
    buf.set(patternBlocks[i], off);
  }

  // Garbage in song region
  for (let i = ESX1_ADDR_SONG_DATA; i < ESX1_ADDR_VALID_CHECK_2; i++) {
    buf[i] = (i * 7 + 11) & 0xff;
  }

  return buf;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("esxBankEditorState — buildEsxSampleSlotOverview", () => {
  it("returns 256 dense mono rows from an empty bank", () => {
    const bank = parseEsxBank(buildSyntheticEsxBank().buffer);
    const rows = buildEsxSampleSlotOverview(bank);
    expect(rows.length).toBe(256);
    expect(rows.every((r) => r.empty)).toBe(true);
    expect(rows[0]).toEqual({
      index: 0,
      empty: true,
      name: "",
      channels: 1,
      sampleRate: 0,
      frames: 0,
      level: 0,
    });
  });

  it("synthesises rows incl. seeded sample slots", () => {
    // Create a synthetic bank with one prefilled mono sample at slot 3.
    const seedPcm = new Uint8Array(64);
    for (let i = 0; i < seedPcm.length; i++) seedPcm[i] = (i * 13 + 5) & 0xff;
    const bankBytes = buildSyntheticEsxBank({
      prefilledMonoSamples: [
        { index: 3, pcmBytes: seedPcm, sampleRate: 44100, name: "KICK" },
      ],
    });
    const bank = parseEsxBank(bankBytes.buffer);
    const rows = buildEsxSampleSlotOverview(bank);
    expect(rows.length).toBe(256);
    // Slot 3 should not be empty.
    expect(rows[3].empty).toBe(false);
    expect(rows[3].name).toBe("KICK");
    expect(rows[3].channels).toBe(1);
    expect(rows[3].sampleRate).toBe(44100);
    expect(rows[3].frames).toBe(32); // 64 bytes / 2 = 32 frames
    // Slot 2 should be empty.
    expect(rows[2].empty).toBe(true);
    expect(rows[255].empty).toBe(true);
  });
});

describe("esxBankEditorState — stageEsxSamplePatch / unstageEsxSamplePatch", () => {
  function makeEntry(frames = 100): EsxSamplePatchEntry {
    return {
      pcmData: makeFloat32Sine(frames),
      sampleRate: 44100,
      channels: 1,
      name: "SYNTH",
      level: 100,
    };
  }

  it("stages a sample patch immutably and counts it as pending", () => {
    const entry = makeEntry();
    const empty = new Map<number, EsxSamplePatchEntry>();
    const next = stageEsxSamplePatch(empty, 7, entry);
    expect(empty.size).toBe(0); // input unchanged
    expect(next.size).toBe(1);
    expect(next.has(7)).toBe(true);
    expect(next.get(7)).toBe(entry);
    expect(hasPendingEsxSamplePatches(next)).toBe(true);
    expect(countPendingEsxSamplePatches(next)).toBe(1);
  });

  it("replaces an existing patch when staging the same slot twice", () => {
    const e1 = makeEntry(100);
    const e2 = makeEntry(200);
    const s1 = stageEsxSamplePatch(new Map(), 3, e1);
    const s2 = stageEsxSamplePatch(s1, 3, e2);
    expect(s2.size).toBe(1);
    expect(s2.get(3)).toBe(e2);
  });

  it("unstages a sample patch and returns SAME ref when slot is unknown", () => {
    const entry = makeEntry();
    const staged = stageEsxSamplePatch(new Map(), 9, entry);
    const reverted = unstageEsxSamplePatch(staged, 9);
    expect(reverted.size).toBe(0);
    // Unstage non-existent → returns SAME reference (no allocation).
    const sameRef = unstageEsxSamplePatch(reverted, 42);
    expect(sameRef).toBe(reverted);
  });

  it("throws on invalid slot index or invalid entry", () => {
    const entry = makeEntry();
    expect(() => stageEsxSamplePatch(new Map(), -1, entry)).toThrow();
    expect(() => stageEsxSamplePatch(new Map(), 256, entry)).toThrow();
    expect(() => stageEsxSamplePatch(new Map(), 1.5, entry)).toThrow();
    // Invalid sample rate
    expect(() =>
      stageEsxSamplePatch(new Map(), 0, { ...entry, sampleRate: 0 }),
    ).toThrow();
    // Empty PCM
    expect(() =>
      stageEsxSamplePatch(new Map(), 0, {
        ...entry,
        pcmData: new Float32Array(0),
      }),
    ).toThrow();
    // Invalid channels
    expect(() =>
      stageEsxSamplePatch(new Map(), 0, { ...entry, channels: 3 as 1 }),
    ).toThrow();
  });
});

describe("esxBankEditorState — commitEsxSamplePatches", () => {
  it("applies a single sample patch and grows the bank by PCM bytes", () => {
    const bank = buildSyntheticEsxBank().buffer;
    const inputSize = bank.byteLength;
    const entry: EsxSamplePatchEntry = {
      pcmData: makeFloat32Sine(256),
      sampleRate: 44100,
      channels: 1,
      name: "BASS",
      level: 100,
    };
    const staged = stageEsxSamplePatch(new Map(), 5, entry);
    const committed = commitEsxSamplePatches(bank, staged);
    // Bank grew by 256 frames × 2 bytes = 512 bytes.
    expect(committed.byteLength).toBe(inputSize + 512);
    // Slot 5 header now reflects the patch — parse & verify.
    const parsed = parseEsxBank(committed);
    const slot5 = parsed.monoSamples.find((s) => s.index === 5);
    expect(slot5).toBeDefined();
    expect(slot5!.name).toBe("BASS");
    expect(slot5!.sampleRate).toBe(44100);
    expect(slot5!.frames).toBe(256);
  });

  it("applies multiple sample patches in ascending-slot order", () => {
    const bank = buildSyntheticEsxBank().buffer;
    const e0: EsxSamplePatchEntry = {
      pcmData: makeFloat32Sine(64),
      sampleRate: 44100,
      channels: 1,
      name: "A",
    };
    const e10: EsxSamplePatchEntry = {
      pcmData: makeFloat32Sine(96),
      sampleRate: 44100,
      channels: 1,
      name: "B",
    };
    const e100: EsxSamplePatchEntry = {
      pcmData: makeFloat32Sine(128),
      sampleRate: 44100,
      channels: 1,
      name: "C",
    };
    // Stage in REVERSE order — commit should apply ascending.
    let staged = stageEsxSamplePatch(new Map(), 100, e100);
    staged = stageEsxSamplePatch(staged, 10, e10);
    staged = stageEsxSamplePatch(staged, 0, e0);
    const committed = commitEsxSamplePatches(bank, staged);
    const parsed = parseEsxBank(committed);
    const s0 = parsed.monoSamples.find((s) => s.index === 0);
    const s10 = parsed.monoSamples.find((s) => s.index === 10);
    const s100 = parsed.monoSamples.find((s) => s.index === 100);
    expect(s0?.name).toBe("A");
    expect(s10?.name).toBe("B");
    expect(s100?.name).toBe("C");
    expect(s0?.frames).toBe(64);
    expect(s10?.frames).toBe(96);
    expect(s100?.frames).toBe(128);
  });

  it("returns a fresh copy when no patches are staged", () => {
    const bank = buildSyntheticEsxBank().buffer;
    const empty = new Map<number, EsxSamplePatchEntry>();
    const committed = commitEsxSamplePatches(bank, empty);
    expect(committed.byteLength).toBe(bank.byteLength);
    // Returns a NEW buffer (caller cannot mutate the input through it).
    expect(committed).not.toBe(bank);
    // But content is bit-identical.
    const a = new Uint8Array(bank);
    const b = new Uint8Array(committed);
    expect(fnv1aHash32(a)).toBe(fnv1aHash32(b));
  });
});

describe("esxBankEditorState — commitEsxPatchesAll (composite pipeline)", () => {
  it("applies both pattern + sample patches in one pass", () => {
    const seed = new Uint8Array(
      buildEsxPatternBlock(makePatternInput({ name: "SEED", bpm: 120 })),
    );
    const bank = buildSyntheticEsxBank({ patternBlocks: [seed] }).buffer;

    const newBlock = new Uint8Array(
      buildEsxPatternBlock(makePatternInput({ name: "NEW", bpm: 175 })),
    );
    const patternStaged = stageEsxPatch(
      new Map<number, ArrayBuffer>(),
      5,
      newBlock.buffer,
    );

    const sampleEntry: EsxSamplePatchEntry = {
      pcmData: makeFloat32Sine(128),
      sampleRate: 44100,
      channels: 1,
      name: "SND",
    };
    const sampleStaged = stageEsxSamplePatch(new Map(), 10, sampleEntry);

    const committed = commitEsxPatchesAll(bank, patternStaged, sampleStaged);

    // Pattern slot 5 should reflect new pattern.
    const parsed = parseEsxBank(committed);
    const pat5 = parsed.patterns.find((p) => p.index === 5);
    expect(pat5).toBeDefined();
    expect(pat5!.name).toBe("NEW");
    expect(pat5!.bpm).toBeCloseTo(175, 1);

    // Sample slot 10 should reflect new sample.
    const smp10 = parsed.monoSamples.find((s) => s.index === 10);
    expect(smp10).toBeDefined();
    expect(smp10!.name).toBe("SND");
    expect(smp10!.frames).toBe(128);

    // Buffer grew (samples are appended).
    expect(committed.byteLength).toBeGreaterThan(bank.byteLength);
  });

  it("works with only sample patches (empty pattern map)", () => {
    const bank = buildSyntheticEsxBank().buffer;
    const sampleEntry: EsxSamplePatchEntry = {
      pcmData: makeFloat32Sine(64),
      sampleRate: 44100,
      channels: 1,
      name: "X",
    };
    const sampleStaged = stageEsxSamplePatch(new Map(), 0, sampleEntry);
    const committed = commitEsxPatchesAll(bank, new Map(), sampleStaged);
    const parsed = parseEsxBank(committed);
    const s0 = parsed.monoSamples.find((s) => s.index === 0);
    expect(s0?.name).toBe("X");
  });

  it("works with only pattern patches (empty sample map)", () => {
    const bank = buildSyntheticEsxBank().buffer;
    const newBlock = new Uint8Array(
      buildEsxPatternBlock(makePatternInput({ name: "P", bpm: 100 })),
    );
    const patternStaged = stageEsxPatch(new Map(), 5, newBlock.buffer);
    const committed = commitEsxPatchesAll(bank, patternStaged, new Map());
    // Same size as pattern-only commit (no PCM appended).
    expect(committed.byteLength).toBe(bank.byteLength);
    const parsed = parseEsxBank(committed);
    const pat5 = parsed.patterns.find((p) => p.index === 5);
    expect(pat5?.name).toBe("P");
  });

  it("is identical to commitEsxPatches when sample map is empty", () => {
    const bank = buildSyntheticEsxBank().buffer;
    const newBlock = new Uint8Array(
      buildEsxPatternBlock(makePatternInput({ name: "Q", bpm: 140 })),
    );
    const patternStaged = stageEsxPatch(new Map(), 3, newBlock.buffer);
    const a = commitEsxPatchesAll(bank, patternStaged, new Map());
    const b = commitEsxPatches(bank, patternStaged);
    expect(a.byteLength).toBe(b.byteLength);
    expect(fnv1aHash32(new Uint8Array(a))).toBe(fnv1aHash32(new Uint8Array(b)));
  });
});

describe("esxBankEditorState — filterEsxSampleRows + formatSampleLength", () => {
  function makeRow(
    index: number,
    name: string,
    empty = false,
  ): EsxSampleSlotRow {
    return {
      index,
      empty,
      name,
      channels: 1,
      sampleRate: empty ? 0 : 44100,
      frames: empty ? 0 : 1000,
      level: empty ? 0 : 100,
    };
  }

  it("hideEmpty hides empty rows", () => {
    const rows = [
      makeRow(0, "KICK"),
      makeRow(1, "", true),
      makeRow(2, "SNARE"),
    ];
    const visible = filterEsxSampleRows(rows, "", true);
    expect(visible.map((r) => r.index)).toEqual([0, 2]);
  });

  it("case-insensitive name substring search", () => {
    const rows = [
      makeRow(0, "KICK"),
      makeRow(1, "SNARE"),
      makeRow(2, "HIHAT"),
    ];
    expect(filterEsxSampleRows(rows, "kick", false).map((r) => r.index)).toEqual([0]);
    expect(filterEsxSampleRows(rows, "snare", false).map((r) => r.index)).toEqual([1]);
    expect(filterEsxSampleRows(rows, "HI", false).map((r) => r.index)).toEqual([2]);
  });

  it("matches exact index or zero-padded index", () => {
    const rows = [makeRow(0, "A"), makeRow(5, "B"), makeRow(100, "C")];
    expect(filterEsxSampleRows(rows, "5", false).map((r) => r.index)).toEqual([5]);
    expect(filterEsxSampleRows(rows, "005", false).map((r) => r.index)).toEqual([5]);
    expect(filterEsxSampleRows(rows, "100", false).map((r) => r.index)).toEqual([100]);
  });

  it("formatSampleLength produces M:SS.ms format", () => {
    expect(formatSampleLength(44100, 44100)).toBe("0:01.000");
    expect(formatSampleLength(22050, 44100)).toBe("0:00.500");
    expect(formatSampleLength(132300, 44100)).toBe("0:03.000");
    expect(formatSampleLength(0, 44100)).toBe("—");
    expect(formatSampleLength(100, 0)).toBe("100 fr"); // bad sample rate fallback
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// v3.32.0 — Stereo Sample-Tab Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("esxBankEditorState — buildEsxStereoSampleSlotOverview (v3.32)", () => {
  it("returns 128 dense stereo rows from an empty bank", () => {
    const bank = parseEsxBank(buildSyntheticEsxBank().buffer);
    const rows = buildEsxStereoSampleSlotOverview(bank);
    expect(rows.length).toBe(128);
    expect(rows.every((r) => r.empty)).toBe(true);
    expect(rows[0]).toEqual({
      index: 0,
      empty: true,
      name: "",
      channels: 2,
      sampleRate: 0,
      frames: 0,
      level: 0,
    });
    // All rows have channels === 2 (per the type contract).
    expect(rows.every((r) => r.channels === 2)).toBe(true);
  });

  it("synthesises rows including a seeded stereo slot", () => {
    // Build empty bank, then patch a stereo slot via the patcher.
    const empty = buildSyntheticEsxBank();
    const stereoPcm = new Float32Array(128 * 2);
    for (let i = 0; i < 128; i++) {
      stereoPcm[i * 2] = Math.sin((i / 128) * 2 * Math.PI) * 0.4;
      stereoPcm[i * 2 + 1] = Math.cos((i / 128) * 2 * Math.PI) * 0.4;
    }
    const patched = patchEsxBankSample(empty.buffer, {
      index: 7,
      channels: 2,
      pcmData: stereoPcm,
      sampleRate: 44100,
      name: "STEREO",
    });
    const bank = parseEsxBank(patched);
    const rows = buildEsxStereoSampleSlotOverview(bank);
    expect(rows.length).toBe(128);
    expect(rows[7].empty).toBe(false);
    expect(rows[7].name).toBe("STEREO");
    expect(rows[7].channels).toBe(2);
    expect(rows[7].sampleRate).toBe(44100);
    expect(rows[7].frames).toBe(128);
    // Other rows still empty.
    expect(rows[6].empty).toBe(true);
    expect(rows[127].empty).toBe(true);
  });
});

describe("esxBankEditorState — stageEsxStereoSamplePatch (v3.32)", () => {
  function makeStereoEntry(frames = 100): EsxSamplePatchEntry {
    const pcm = new Float32Array(frames * 2);
    for (let i = 0; i < frames; i++) {
      pcm[i * 2] = 0.3;
      pcm[i * 2 + 1] = -0.3;
    }
    return {
      pcmData: pcm,
      sampleRate: 44100,
      channels: 2,
      name: "ST",
      level: 100,
    };
  }

  it("stages a stereo patch immutably and counts it as pending", () => {
    const entry = makeStereoEntry();
    const empty = new Map<number, EsxSamplePatchEntry>();
    const next = stageEsxStereoSamplePatch(empty, 7, entry);
    expect(empty.size).toBe(0);
    expect(next.size).toBe(1);
    expect(next.has(7)).toBe(true);
    expect(hasPendingEsxStereoSamplePatches(next)).toBe(true);
    expect(countPendingEsxStereoSamplePatches(next)).toBe(1);
  });

  it("rejects out-of-range stereo-slot index (>= 128)", () => {
    const entry = makeStereoEntry();
    expect(() => stageEsxStereoSamplePatch(new Map(), 128, entry)).toThrow();
    expect(() => stageEsxStereoSamplePatch(new Map(), -1, entry)).toThrow();
    expect(() => stageEsxStereoSamplePatch(new Map(), 1.5, entry)).toThrow();
  });

  it("rejects entries with channels != 2", () => {
    const monoEntry: EsxSamplePatchEntry = {
      pcmData: new Float32Array(100),
      sampleRate: 44100,
      channels: 1,
      name: "X",
    };
    expect(() => stageEsxStereoSamplePatch(new Map(), 0, monoEntry)).toThrow();
  });

  it("rejects stereo pcmData with odd length", () => {
    const badEntry: EsxSamplePatchEntry = {
      pcmData: new Float32Array(101), // odd → cannot be interleaved L,R
      sampleRate: 44100,
      channels: 2,
      name: "X",
    };
    expect(() => stageEsxStereoSamplePatch(new Map(), 0, badEntry)).toThrow();
  });

  it("unstages a stereo patch and returns SAME ref when slot is unknown", () => {
    const entry = makeStereoEntry();
    const staged = stageEsxStereoSamplePatch(new Map(), 5, entry);
    const reverted = unstageEsxStereoSamplePatch(staged, 5);
    expect(reverted.size).toBe(0);
    const sameRef = unstageEsxStereoSamplePatch(reverted, 42);
    expect(sameRef).toBe(reverted);
  });
});

describe("esxBankEditorState — commitEsxStereoSamplePatches (v3.32)", () => {
  it("Stereo-Replace decoded L+R contiguous (NOT interleaved on disk)", () => {
    const bank = buildSyntheticEsxBank().buffer;
    // Build a known L,R interleaved input.
    const frames = 64;
    const pcm = new Float32Array(frames * 2);
    for (let i = 0; i < frames; i++) {
      pcm[i * 2] = 0.5;     // L = 0.5
      pcm[i * 2 + 1] = -0.5; // R = -0.5
    }
    const entry: EsxSamplePatchEntry = {
      pcmData: pcm,
      sampleRate: 44100,
      channels: 2,
      name: "LR",
      level: 100,
    };
    const staged = stageEsxStereoSamplePatch(new Map(), 0, entry);
    const committed = commitEsxStereoSamplePatches(bank, staged);

    // Bank grew by frames × 2 channels × 2 bytes = frames * 4 bytes.
    expect(committed.byteLength).toBe(bank.byteLength + frames * 4);

    // Verify L and R blocks live in contiguous (NOT interleaved) regions:
    // The stereo header at slot 0 will have off1Start (L block) and
    // off2Start = off1End (R block immediately after).
    const dv = new DataView(committed);
    const stereoHdr = 0x001b2900; // ESX1_ADDR_SAMPLE_HEADER_STEREO
    const off1Start = dv.getUint32(stereoHdr + 8, false);
    const off1End = dv.getUint32(stereoHdr + 12, false);
    const off2Start = dv.getUint32(stereoHdr + 16, false);
    const off2End = dv.getUint32(stereoHdr + 20, false);
    expect(off1End).toBe(off1Start + frames * 2);
    expect(off2Start).toBe(off1End); // R starts where L ends → contiguous
    expect(off2End).toBe(off2Start + frames * 2);
  });

  it("Round-Trip Stereo via parseEsxBank liefert L+R-Channels separat (interleaved on read)", () => {
    const bank = buildSyntheticEsxBank().buffer;
    const frames = 100;
    const pcm = new Float32Array(frames * 2);
    for (let i = 0; i < frames; i++) {
      pcm[i * 2] = Math.sin((i / frames) * 2 * Math.PI) * 0.5;
      pcm[i * 2 + 1] = Math.cos((i / frames) * 2 * Math.PI) * 0.5;
    }
    const entry: EsxSamplePatchEntry = {
      pcmData: pcm,
      sampleRate: 44100,
      channels: 2,
      name: "RTSTER",
      level: 100,
    };
    const staged = stageEsxStereoSamplePatch(new Map(), 3, entry);
    const committed = commitEsxStereoSamplePatches(bank, staged);
    const parsed = parseEsxBank(committed);
    expect(parsed.stereoSamples.length).toBe(1);
    const smp = parsed.stereoSamples[0];
    expect(smp.channels).toBe(2);
    expect(smp.frames).toBe(frames);
    expect(smp.name).toBe("RTSTER");
    // Parser returns interleaved L,R,L,R … of length frames*2.
    expect(smp.pcmData.length).toBe(frames * 2);
    // Verify L and R round-tripped (within int16 quantization error).
    for (let i = 0; i < frames; i++) {
      expect(smp.pcmData[i * 2]).toBeCloseTo(pcm[i * 2], 3);
      expect(smp.pcmData[i * 2 + 1]).toBeCloseTo(pcm[i * 2 + 1], 3);
    }
  });

  it("filterEsxStereoSampleRows behaves like its mono counterpart", () => {
    const rows: EsxStereoSampleSlotRow[] = [
      {
        index: 0,
        empty: false,
        name: "BASS",
        channels: 2,
        sampleRate: 44100,
        frames: 1000,
        level: 100,
      },
      {
        index: 1,
        empty: true,
        name: "",
        channels: 2,
        sampleRate: 0,
        frames: 0,
        level: 0,
      },
      {
        index: 2,
        empty: false,
        name: "PAD",
        channels: 2,
        sampleRate: 44100,
        frames: 2000,
        level: 100,
      },
    ];
    expect(filterEsxStereoSampleRows(rows, "", true).map((r) => r.index)).toEqual([0, 2]);
    expect(filterEsxStereoSampleRows(rows, "bass", false).map((r) => r.index)).toEqual([0]);
    expect(filterEsxStereoSampleRows(rows, "2", false).map((r) => r.index)).toEqual([2]);
  });
});
