/**
 * tests/features/korg-esx-bank-compact.test.ts
 *
 * v3.32.0 — Compact-Action für die ESX-1 PCM-Region.
 *
 * Scope:
 *   (1) compactEsxBank removes orphan bytes ohne Daten-Loss
 *   (2) Sample-Header-Inhalt bleibt preserved (only offset-fields updated)
 *   (3) Pattern-Region bit-exact
 *   (4) 0-orphan input → output bit-identical
 *   (5) Round-Trip via parseEsxBank liefert gleiche Samples
 *   (6) Stereo-Samples bleiben round-trip-safe
 *   (7) inspectEsxBankWaste-Helper
 *
 * Env: node (no jsdom).
 */

import { describe, it, expect } from "vitest";

import {
  compactEsxBank,
  inspectEsxBankWaste,
  EsxBankCompactError,
} from "../../client/src/utils/korg/esxBankCompacter";
import {
  encodeEsxName,
  float32ToBe16Pcm,
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

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeFloat32Sine(frames: number, freq = 440, sr = 44100): Float32Array {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    out[i] = Math.sin((2 * Math.PI * freq * i) / sr) * 0.5;
  }
  return out;
}

/**
 * Build a minimal valid .esx bank with optional pre-filled mono samples.
 * Mirror of buildSyntheticEsxBank from other test-files.
 */
function buildSyntheticEsxBank(opts: {
  prefilledMonoSamples?: Array<{
    index: number;
    pcmBytes: Uint8Array;
    sampleRate: number;
    name: string;
  }>;
} = {}): Uint8Array {
  const prefilledMono = opts.prefilledMonoSamples ?? [];
  const prefillTotalBytes = prefilledMono.reduce(
    (sum, p) => sum + p.pcmBytes.byteLength,
    0,
  );
  const size = ESX1_SIZE_FILE_MIN + prefillTotalBytes + 1024;
  const buf = new Uint8Array(size);

  buf.set(ESX1_SIGNATURE, 0);
  buf.set(ESX1_SUBMAGIC, ESX1_SUBMAGIC_OFFSET);
  buf.set(ESX1_SIGNATURE, ESX1_ADDR_VALID_CHECK_2);

  const dv = new DataView(buf.buffer);
  dv.setUint32(ESX1_ADDR_NUM_MONO_SAMPLES + 0, prefilledMono.length, false);
  dv.setUint32(ESX1_ADDR_NUM_MONO_SAMPLES + 4, 0, false);
  dv.setUint32(ESX1_ADDR_NUM_MONO_SAMPLES + 8, prefillTotalBytes, false);

  // Empty all headers
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

  // Pre-fill mono sample slots
  let nextRel = 0;
  for (const p of prefilledMono) {
    const len = p.pcmBytes.byteLength;
    const off = ESX1_ADDR_SAMPLE_HEADER_MONO + p.index * ESX1_CHUNKSIZE_SAMPLE_HEADER_MONO;
    buf.set(encodeEsxName(p.name), off);
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

  // Garbage in pattern region (so we can verify it's bit-preserved)
  for (let i = ESX1_ADDR_PATTERN_DATA; i < ESX1_ADDR_PATTERN_DATA + 4096; i++) {
    buf[i] = (i * 31 + 7) & 0xff;
  }
  // Garbage in song region too
  for (let i = ESX1_ADDR_SONG_DATA; i < ESX1_ADDR_VALID_CHECK_2; i++) {
    buf[i] = (i * 13 + 5) & 0xff;
  }

  return buf;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("compactEsxBank — orphan removal", () => {
  it("removes orphan bytes from a bank where slot was re-replaced multiple times", () => {
    // Build bank with seed sample at slot 5 (256 bytes PCM).
    const seed = new Uint8Array(256);
    for (let i = 0; i < seed.length; i++) seed[i] = (i * 17 + 3) & 0xff;
    const startBytes = buildSyntheticEsxBank({
      prefilledMonoSamples: [
        { index: 5, pcmBytes: seed, sampleRate: 44100, name: "ORIG" },
      ],
    });

    // Re-replace slot 5 three times → orphans pile up.
    let buf: ArrayBuffer = startBytes.buffer.slice(0);
    for (let pass = 0; pass < 3; pass++) {
      buf = patchEsxBankSample(buf, {
        index: 5,
        channels: 1,
        pcmData: makeFloat32Sine(128 + pass * 32),
        sampleRate: 44100,
        name: `R${pass}`,
        level: 100,
      });
    }
    const beforeCompactSize = buf.byteLength;

    // Inspect waste — should be > 0.
    const report = inspectEsxBankWaste(buf);
    expect(report).not.toBeNull();
    expect(report!.orphanBytes).toBeGreaterThan(0);

    // Compact.
    const compacted = compactEsxBank(buf);
    expect(compacted.byteLength).toBeLessThan(beforeCompactSize);

    // After compaction, orphan-bytes should be 0.
    const after = inspectEsxBankWaste(compacted);
    expect(after).not.toBeNull();
    expect(after!.orphanBytes).toBe(0);

    // Slot 5 should still be parseable + have the LAST-written values.
    const parsed = parseEsxBank(compacted);
    const s5 = parsed.monoSamples.find((s) => s.index === 5);
    expect(s5).toBeDefined();
    expect(s5!.name).toBe("R2");
    expect(s5!.frames).toBe(128 + 2 * 32);
    expect(s5!.sampleRate).toBe(44100);
  });

  it("preserves sample-header content (only offset-fields updated)", () => {
    const seed = new Uint8Array(64);
    for (let i = 0; i < seed.length; i++) seed[i] = i & 0xff;
    const bytes = buildSyntheticEsxBank({
      prefilledMonoSamples: [
        { index: 10, pcmBytes: seed, sampleRate: 48000, name: "KEEP" },
      ],
    });

    // Append a 2nd sample via patcher so we have orphan-causing growth-room
    // — but the test simulates the simpler case: only one slot, no orphans.
    // To force orphans, patch slot 10 once.
    let buf: ArrayBuffer = patchEsxBankSample(bytes.buffer, {
      index: 10,
      channels: 1,
      pcmData: makeFloat32Sine(96),
      sampleRate: 48000,
      name: "NEW",
      level: 100,
    });

    // Capture header BEFORE compact.
    const beforeDv = new DataView(buf);
    const monoOff =
      ESX1_ADDR_SAMPLE_HEADER_MONO + 10 * ESX1_CHUNKSIZE_SAMPLE_HEADER_MONO;
    const beforeName = new Uint8Array(buf, monoOff, 8);
    const beforeStart = beforeDv.getUint32(monoOff + 16, false);
    const beforeEnd = beforeDv.getUint32(monoOff + 20, false);
    const beforeLoopStart = beforeDv.getUint32(monoOff + 24, false);
    const beforeSampleRate = beforeDv.getUint32(monoOff + 28, false);
    const beforeSampleTune = beforeDv.getInt16(monoOff + 32, false);
    const beforeLevel = new Uint8Array(buf)[monoOff + 34];

    // Compact.
    const compacted = compactEsxBank(buf);
    const afterDv = new DataView(compacted);
    const afterName = new Uint8Array(compacted, monoOff, 8);
    const afterStart = afterDv.getUint32(monoOff + 16, false);
    const afterEnd = afterDv.getUint32(monoOff + 20, false);
    const afterLoopStart = afterDv.getUint32(monoOff + 24, false);
    const afterSampleRate = afterDv.getUint32(monoOff + 28, false);
    const afterSampleTune = afterDv.getInt16(monoOff + 32, false);
    const afterLevel = new Uint8Array(compacted)[monoOff + 34];

    // Name + non-offset fields must be bit-identical.
    expect(Array.from(afterName)).toEqual(Array.from(beforeName));
    expect(afterStart).toBe(beforeStart);
    expect(afterEnd).toBe(beforeEnd);
    expect(afterLoopStart).toBe(beforeLoopStart);
    expect(afterSampleRate).toBe(beforeSampleRate);
    expect(afterSampleTune).toBe(beforeSampleTune);
    expect(afterLevel).toBe(beforeLevel);

    // off1Start/End MAY differ (compacted layout) — must be valid + non-empty.
    const afterOff1Start = afterDv.getUint32(monoOff + 8, false);
    const afterOff1End = afterDv.getUint32(monoOff + 12, false);
    expect(afterOff1Start).not.toBe(ESX1_EMPTY_OFFSET);
    expect(afterOff1End).toBeGreaterThan(afterOff1Start);
  });

  it("preserves Pattern-region bit-exact", () => {
    const seed = new Uint8Array(64);
    for (let i = 0; i < seed.length; i++) seed[i] = i & 0xff;
    const bytes = buildSyntheticEsxBank({
      prefilledMonoSamples: [
        { index: 1, pcmBytes: seed, sampleRate: 44100, name: "X" },
      ],
    });
    const patternRegionStart = ESX1_ADDR_PATTERN_DATA;
    const patternRegionEnd = ESX1_ADDR_SONG_DATA; // 0x130000

    // Hash pattern region BEFORE.
    const beforeHash = fnv1aHash32(bytes, patternRegionStart, patternRegionEnd);

    // Patch + compact (forces full PCM rewrite + might shift things).
    const patched = patchEsxBankSample(bytes.buffer, {
      index: 50,
      channels: 1,
      pcmData: makeFloat32Sine(200),
      sampleRate: 44100,
      name: "NEW",
    });
    const compacted = compactEsxBank(patched);

    const afterHash = fnv1aHash32(
      new Uint8Array(compacted),
      patternRegionStart,
      patternRegionEnd,
    );
    expect(afterHash).toBe(beforeHash);

    // Also: globals region [0x20, 0x200).
    const beforeGlobals = fnv1aHash32(bytes, 0x20, 0x200);
    const afterGlobals = fnv1aHash32(
      new Uint8Array(compacted),
      0x20,
      0x200,
    );
    expect(afterGlobals).toBe(beforeGlobals);

    // Song region too.
    const beforeSong = fnv1aHash32(
      bytes,
      ESX1_ADDR_SONG_DATA,
      ESX1_ADDR_VALID_CHECK_2,
    );
    const afterSong = fnv1aHash32(
      new Uint8Array(compacted),
      ESX1_ADDR_SONG_DATA,
      ESX1_ADDR_VALID_CHECK_2,
    );
    expect(afterSong).toBe(beforeSong);
  });

  it("0-orphan input → output equals input bit-for-bit (live bytes only)", () => {
    // Build a bank with NO PCM region waste (single sample, no re-replace).
    // The buildSyntheticEsxBank-Helper allocates 1024 trailing bytes for safety
    // — so we trim the buffer to exactly ESX1_ADDR_SAMPLE_DATA + live PCM
    // bytes to simulate a clean "already compact" bank.
    const seed = new Uint8Array(128);
    for (let i = 0; i < seed.length; i++) seed[i] = (i * 7) & 0xff;
    const padded = buildSyntheticEsxBank({
      prefilledMonoSamples: [
        { index: 0, pcmBytes: seed, sampleRate: 44100, name: "OK" },
      ],
    });
    // Trim to exact file-end = 0x250000 + seed.length.
    const bytes = padded.subarray(0, ESX1_ADDR_SAMPLE_DATA + seed.length);

    const report = inspectEsxBankWaste(bytes);
    expect(report).not.toBeNull();
    expect(report!.orphanBytes).toBe(0);

    const compacted = compactEsxBank(bytes);
    const compactedReport = inspectEsxBankWaste(compacted);
    expect(compactedReport!.orphanBytes).toBe(0);
    expect(compactedReport!.liveBytes).toBe(report!.liveBytes);

    // Header region must match bit-exact (offset fields point to same location).
    const beforeHeaderHash = fnv1aHash32(bytes, 0, ESX1_ADDR_SAMPLE_DATA);
    const afterHeaderHash = fnv1aHash32(
      new Uint8Array(compacted),
      0,
      ESX1_ADDR_SAMPLE_DATA,
    );
    expect(afterHeaderHash).toBe(beforeHeaderHash);

    // Full file should also be bit-identical when input is already compact.
    expect(compacted.byteLength).toBe(bytes.byteLength);
    expect(fnv1aHash32(new Uint8Array(compacted))).toBe(fnv1aHash32(bytes));
  });

  it("round-trip via parseEsxBank produces the same samples", () => {
    // Build bank with three live samples.
    const seedA = new Uint8Array(64);
    for (let i = 0; i < seedA.length; i++) seedA[i] = (i * 11 + 1) & 0xff;
    const seedB = new Uint8Array(96);
    for (let i = 0; i < seedB.length; i++) seedB[i] = (i * 13 + 2) & 0xff;
    const seedC = new Uint8Array(128);
    for (let i = 0; i < seedC.length; i++) seedC[i] = (i * 17 + 3) & 0xff;

    const bytes = buildSyntheticEsxBank({
      prefilledMonoSamples: [
        { index: 2, pcmBytes: seedA, sampleRate: 44100, name: "AAA" },
        { index: 9, pcmBytes: seedB, sampleRate: 44100, name: "BBB" },
        { index: 20, pcmBytes: seedC, sampleRate: 22050, name: "CCC" },
      ],
    });

    // Create orphan-waste by re-replacing slot 9.
    let buf: ArrayBuffer = patchEsxBankSample(bytes.buffer, {
      index: 9,
      channels: 1,
      pcmData: makeFloat32Sine(72),
      sampleRate: 44100,
      name: "BBB2",
    });

    // Snapshot parsed samples BEFORE compact.
    const before = parseEsxBank(buf);
    const beforeByIdx = new Map(before.monoSamples.map((s) => [s.index, s]));

    // Compact.
    const compacted = compactEsxBank(buf);
    const after = parseEsxBank(compacted);
    const afterByIdx = new Map(after.monoSamples.map((s) => [s.index, s]));

    // Same set of indices.
    expect(Array.from(afterByIdx.keys()).sort()).toEqual(
      Array.from(beforeByIdx.keys()).sort(),
    );

    // Each sample: same name, frames, sampleRate, and PCM (within int16 quant
    // error).
    for (const [idx, beforeSmp] of beforeByIdx) {
      const afterSmp = afterByIdx.get(idx);
      expect(afterSmp).toBeDefined();
      expect(afterSmp!.name).toBe(beforeSmp.name);
      expect(afterSmp!.frames).toBe(beforeSmp.frames);
      expect(afterSmp!.sampleRate).toBe(beforeSmp.sampleRate);
      // PCM bit-exact (compaction only moves bytes, doesn't re-quantize).
      expect(afterSmp!.pcmData.length).toBe(beforeSmp.pcmData.length);
      for (let i = 0; i < afterSmp!.pcmData.length; i++) {
        expect(afterSmp!.pcmData[i]).toBeCloseTo(beforeSmp.pcmData[i], 6);
      }
    }
  });

  it("throws on invalid bank-buffer", () => {
    const tooSmall = new Uint8Array(100);
    expect(() => compactEsxBank(tooSmall)).toThrow(EsxBankCompactError);

    // Corrupt magic
    const bytes = buildSyntheticEsxBank();
    bytes[0] = 0x00;
    expect(() => compactEsxBank(bytes.buffer)).toThrow(EsxBankCompactError);
  });

  it("inspectEsxBankWaste returns null on invalid input (does not throw)", () => {
    const tooSmall = new Uint8Array(50);
    expect(inspectEsxBankWaste(tooSmall)).toBeNull();
  });
});

describe("compactEsxBank — stereo round-trip", () => {
  it("preserves stereo samples (round-trip via parseEsxBank yields L+R contiguous)", () => {
    // Build empty bank, then patch a stereo slot via patcher.
    const bytes = buildSyntheticEsxBank();
    const stereoPcm = new Float32Array(64 * 2);
    for (let i = 0; i < 64; i++) {
      stereoPcm[i * 2] = Math.sin((i / 64) * Math.PI) * 0.4; // L
      stereoPcm[i * 2 + 1] = Math.cos((i / 64) * Math.PI) * 0.4; // R
    }
    const patched = patchEsxBankSample(bytes.buffer, {
      index: 0,
      channels: 2,
      pcmData: stereoPcm,
      sampleRate: 44100,
      name: "STER",
    });

    // Add a 2nd patch (different stereo slot) → no orphans yet, but exercise.
    const stereoPcm2 = new Float32Array(32 * 2);
    for (let i = 0; i < 32; i++) {
      stereoPcm2[i * 2] = 0.2;
      stereoPcm2[i * 2 + 1] = -0.2;
    }
    const patched2 = patchEsxBankSample(patched, {
      index: 5,
      channels: 2,
      pcmData: stereoPcm2,
      sampleRate: 44100,
      name: "STER2",
    });

    // Now re-replace slot 0 to create orphans.
    const stereoPcm3 = new Float32Array(48 * 2);
    for (let i = 0; i < 48; i++) {
      stereoPcm3[i * 2] = 0.5;
      stereoPcm3[i * 2 + 1] = -0.5;
    }
    const patched3 = patchEsxBankSample(patched2, {
      index: 0,
      channels: 2,
      pcmData: stereoPcm3,
      sampleRate: 44100,
      name: "STER3",
    });

    // Compact.
    const compacted = compactEsxBank(patched3);

    // Parse + verify both stereo slots survive.
    const parsed = parseEsxBank(compacted);
    expect(parsed.stereoSamples.length).toBe(2);
    const s0 = parsed.stereoSamples.find((s) => s.index === 256 + 0);
    const s5 = parsed.stereoSamples.find((s) => s.index === 256 + 5);
    expect(s0).toBeDefined();
    expect(s5).toBeDefined();
    expect(s0!.name).toBe("STER3");
    expect(s0!.channels).toBe(2);
    expect(s0!.frames).toBe(48);
    expect(s5!.name).toBe("STER2");
    expect(s5!.frames).toBe(32);
  });
});
