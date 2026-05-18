/**
 * tests/features/korg-esx-sample-patch.test.ts
 *
 * v3.30.0 — ESX-1 Bank Sample-Slot-Patcher tests.
 *
 * Goldstandard-Coverage:
 *   (1) Single-slot patch overwrites only the targeted header
 *   (2) Pattern data region (0x0200..0x130000) stays bit-exact (FNV-1a)
 *   (3) Other sample-headers stay bit-exact
 *   (4) Other PCM bytes (older PCM region) stay bit-exact
 *   (5) Sample-counter increases when slot was previously empty
 *   (6) currentOffset (free-pointer) updated
 *   (7) Invalid magic / out-of-range index → throws
 *   (8) PCM-limit exceeded → throws
 *   (9) Round-Trip via parseEsxBank confirms correct sample-data
 *  (10) Helpers: encodeEsxName, float32ToBe16Pcm, isSlotEmpty
 */

import { describe, it, expect } from "vitest";
import {
  patchEsxBankSample,
  validateBankBufferForSample,
  encodeEsxName,
  float32ToBe16Pcm,
  isSlotEmpty,
  getEsxMonoHeaderOffset,
  getEsxStereoHeaderOffset,
  EsxSamplePatchError,
  type EsxSamplePatchInput,
} from "../../client/src/utils/korg/esxSamplePatcher";
import {
  fnv1aHash32,
} from "../../client/src/utils/korg/esxBankPatcher";
import { parseEsxBank } from "../../client/src/utils/korg/esxParser";
import {
  ESX1_ADDR_NUM_MONO_SAMPLES,
  ESX1_ADDR_PATTERN_DATA,
  ESX1_ADDR_SAMPLE_DATA,
  ESX1_ADDR_SAMPLE_HEADER_MONO,
  ESX1_ADDR_SAMPLE_HEADER_STEREO,
  ESX1_ADDR_SONG_DATA,
  ESX1_ADDR_VALID_CHECK_2,
  ESX1_CHUNKSIZE_SAMPLE_HEADER_MONO,
  ESX1_CHUNKSIZE_SAMPLE_HEADER_STEREO,
  ESX1_EMPTY_OFFSET,
  ESX1_SIGNATURE,
  ESX1_SIZE_FILE_MIN,
  ESX1_SUBMAGIC,
  ESX1_SUBMAGIC_OFFSET,
} from "../../client/src/utils/korg/constants";

// ─── Test helpers ────────────────────────────────────────────────────────────

/**
 * Builds a minimal but structurally-valid .esx bank buffer with:
 *   - All magic bytes
 *   - All headers marked empty (off1Start = 0xFFFFFFFF)
 *   - Optional `prefilled` map: index → {pcmBytes, sampleRate, name}
 *     pre-fills a few mono slots with deterministic PCM at staged offsets so
 *     we can later prove they stay bit-exact.
 *   - Pattern region [0x200..0x130000) filled with a deterministic pattern.
 *   - Song region [0x130000..0x1B0000) filled with deterministic pattern.
 */
function buildSyntheticEsxBank(
  prefilledMono: Array<{
    index: number;
    pcmBytes: Uint8Array;
    sampleRate: number;
    name: string;
  }> = [],
): Uint8Array {
  // Reserve space for prefilled PCM beyond the minimum.
  const prefillTotalBytes = prefilledMono.reduce(
    (sum, p) => sum + p.pcmBytes.byteLength,
    0,
  );
  const size = ESX1_SIZE_FILE_MIN + prefillTotalBytes + 1024;
  const buf = new Uint8Array(size);

  // Pattern region — deterministic garbage so we can verify bit-exact preservation.
  for (let i = ESX1_ADDR_PATTERN_DATA; i < ESX1_ADDR_SONG_DATA && i < buf.length; i++) {
    buf[i] = (i * 13 + 7) & 0xff;
  }
  // Song region.
  for (let i = ESX1_ADDR_SONG_DATA; i < ESX1_ADDR_VALID_CHECK_2; i++) {
    buf[i] = (i * 23 + 11) & 0xff;
  }
  // Sample-section padding (post-magic).
  for (let i = ESX1_ADDR_VALID_CHECK_2 + 4; i < buf.length; i++) {
    buf[i] = (i * 31 + 3) & 0xff;
  }

  // Magic bytes (overwrite any garbage there).
  buf.set(ESX1_SIGNATURE, 0);
  buf.set(ESX1_SUBMAGIC, ESX1_SUBMAGIC_OFFSET);
  buf.set(ESX1_SIGNATURE, ESX1_ADDR_VALID_CHECK_2);

  const dv = new DataView(buf.buffer);

  // Sample counters: numMono = count of prefilled mono, others 0.
  dv.setUint32(ESX1_ADDR_NUM_MONO_SAMPLES + 0, prefilledMono.length, false);
  dv.setUint32(ESX1_ADDR_NUM_MONO_SAMPLES + 4, 0, false);
  dv.setUint32(ESX1_ADDR_NUM_MONO_SAMPLES + 8, prefillTotalBytes, false);

  // All headers → empty (0xFFFFFFFF in offsets).
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

  // Now place each prefilled PCM block at sequential offsets in the PCM area.
  let nextRel = 0;
  for (const p of prefilledMono) {
    const len = p.pcmBytes.byteLength;
    const off = ESX1_ADDR_SAMPLE_HEADER_MONO + p.index * ESX1_CHUNKSIZE_SAMPLE_HEADER_MONO;
    // Name
    const nameBytes = encodeEsxName(p.name);
    buf.set(nameBytes, off);
    // Offsets
    dv.setUint32(off + 8, nextRel, false);
    dv.setUint32(off + 12, nextRel + len, false);
    dv.setUint32(off + 16, 0, false);
    dv.setUint32(off + 20, len / 2, false);
    dv.setUint32(off + 24, 0, false);
    dv.setUint32(off + 28, p.sampleRate, false);
    buf[off + 34] = 100;
    // Write PCM at ESX1_ADDR_SAMPLE_DATA + nextRel
    buf.set(p.pcmBytes, ESX1_ADDR_SAMPLE_DATA + nextRel);
    nextRel += len;
  }

  // currentOffset = end of last prefilled region.
  dv.setUint32(ESX1_ADDR_NUM_MONO_SAMPLES + 8, nextRel, false);

  return buf;
}

/** Make a deterministic Float32 sine wave for tests. */
function makeFloat32Sine(frames: number, freq = 440, sr = 44100): Float32Array {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    out[i] = Math.sin((2 * Math.PI * freq * i) / sr) * 0.5;
  }
  return out;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("esxSamplePatcher — validators", () => {
  it("validates a synthetic ESX bank successfully", () => {
    const bank = buildSyntheticEsxBank();
    expect(() => validateBankBufferForSample(bank)).not.toThrow();
  });

  it("throws on invalid KORG magic", () => {
    const bank = buildSyntheticEsxBank();
    bank[0] = 0x00;
    expect(() => validateBankBufferForSample(bank)).toThrowError(EsxSamplePatchError);
  });

  it("throws on missing sample-section magic", () => {
    const bank = buildSyntheticEsxBank();
    bank[ESX1_ADDR_VALID_CHECK_2] = 0x00;
    expect(() => validateBankBufferForSample(bank)).toThrowError(EsxSamplePatchError);
  });

  it("throws on buffer too small", () => {
    const tiny = new Uint8Array(100);
    tiny.set(ESX1_SIGNATURE, 0);
    tiny.set(ESX1_SUBMAGIC, ESX1_SUBMAGIC_OFFSET);
    expect(() => validateBankBufferForSample(tiny)).toThrowError(EsxSamplePatchError);
  });
});

describe("esxSamplePatcher — encodeEsxName + float32ToBe16Pcm helpers", () => {
  it("encodeEsxName: pads with space and truncates to 8 chars", () => {
    const padded = encodeEsxName("KICK");
    expect(padded.byteLength).toBe(8);
    expect(String.fromCharCode(...padded.slice(0, 4))).toBe("KICK");
    expect(padded[4]).toBe(0x20);
    expect(padded[7]).toBe(0x20);

    const truncated = encodeEsxName("LONGNAME123");
    expect(truncated.byteLength).toBe(8);
    expect(String.fromCharCode(...truncated)).toBe("LONGNAME");
  });

  it("encodeEsxName: non-printables → '?'", () => {
    const out = encodeEsxName("A\x01B");
    expect(out[0]).toBe(0x41); // 'A'
    expect(out[1]).toBe(0x3f); // '?'
    expect(out[2]).toBe(0x42); // 'B'
  });

  it("float32ToBe16Pcm: clips and writes BE bytes", () => {
    const pcm = new Float32Array([0, 1, -1, 0.5, NaN, 2.5, -3.0]);
    const out = float32ToBe16Pcm(pcm);
    expect(out.byteLength).toBe(pcm.length * 2);
    // 0 → 0x0000 BE → [0x00, 0x00]
    expect(out[0]).toBe(0x00);
    expect(out[1]).toBe(0x00);
    // 1 → 0x7FFF BE → [0x7F, 0xFF]
    expect(out[2]).toBe(0x7f);
    expect(out[3]).toBe(0xff);
    // -1 → 0x8000 BE → [0x80, 0x00]
    expect(out[4]).toBe(0x80);
    expect(out[5]).toBe(0x00);
    // NaN → 0x0000 (defensive)
    expect(out[8]).toBe(0x00);
    expect(out[9]).toBe(0x00);
    // 2.5 → clipped to +1 → 0x7FFF
    expect(out[10]).toBe(0x7f);
    expect(out[11]).toBe(0xff);
    // -3.0 → clipped to -1 → 0x8000
    expect(out[12]).toBe(0x80);
    expect(out[13]).toBe(0x00);
  });

  it("isSlotEmpty: returns true for empty slot, false for filled", () => {
    const bank = buildSyntheticEsxBank([
      { index: 3, pcmBytes: new Uint8Array(64), sampleRate: 44100, name: "FOO" },
    ]);
    expect(isSlotEmpty(bank, 3, 1)).toBe(false);
    expect(isSlotEmpty(bank, 4, 1)).toBe(true);
    expect(isSlotEmpty(bank, 0, 2)).toBe(true);
  });
});

describe("esxSamplePatcher — basic mono patch", () => {
  it("appends PCM at end and updates the header", () => {
    const bank = buildSyntheticEsxBank();
    const inputBytes = bank.byteLength;
    const frames = 1024;
    const pcm = makeFloat32Sine(frames);
    const patched = patchEsxBankSample(bank, {
      index: 5,
      channels: 1,
      pcmData: pcm,
      sampleRate: 44100,
      name: "MYKICK",
      level: 100,
    });
    const out = new Uint8Array(patched);
    // Bank grew by exactly frames * 2 bytes.
    expect(out.byteLength).toBe(inputBytes + frames * 2);
    // Header at slot 5 is now filled (off1Start != 0xFFFFFFFF).
    const headerOff = getEsxMonoHeaderOffset(5);
    const dv = new DataView(out.buffer);
    const off1Start = dv.getUint32(headerOff + 8, false);
    const off1End = dv.getUint32(headerOff + 12, false);
    expect(off1End - off1Start).toBe(frames * 2);
    // Name + sample-rate written.
    const nameStr = String.fromCharCode(...out.slice(headerOff, headerOff + 6));
    expect(nameStr).toBe("MYKICK");
    expect(dv.getUint32(headerOff + 28, false)).toBe(44100);
    // playLevel
    expect(out[headerOff + 34]).toBe(100);
  });

  it("increments mono sample-count when slot was previously empty", () => {
    const bank = buildSyntheticEsxBank();
    const dvIn = new DataView(bank.buffer);
    const numMonoBefore = dvIn.getUint32(ESX1_ADDR_NUM_MONO_SAMPLES, false);
    const patched = patchEsxBankSample(bank, {
      index: 0,
      channels: 1,
      pcmData: makeFloat32Sine(256),
      sampleRate: 44100,
      name: "S0",
    });
    const dvOut = new DataView(patched);
    const numMonoAfter = dvOut.getUint32(ESX1_ADDR_NUM_MONO_SAMPLES, false);
    expect(numMonoAfter).toBe(numMonoBefore + 1);
  });

  it("does not increment count when slot already had content", () => {
    const bank = buildSyntheticEsxBank([
      {
        index: 7,
        pcmBytes: float32ToBe16Pcm(makeFloat32Sine(200)),
        sampleRate: 44100,
        name: "OLD",
      },
    ]);
    const dvIn = new DataView(bank.buffer);
    const numMonoBefore = dvIn.getUint32(ESX1_ADDR_NUM_MONO_SAMPLES, false);
    const patched = patchEsxBankSample(bank, {
      index: 7,
      channels: 1,
      pcmData: makeFloat32Sine(300),
      sampleRate: 44100,
      name: "NEW",
    });
    const dvOut = new DataView(patched);
    const numMonoAfter = dvOut.getUint32(ESX1_ADDR_NUM_MONO_SAMPLES, false);
    expect(numMonoAfter).toBe(numMonoBefore); // unchanged — was already filled
  });

  it("updates currentOffset to projected new end-of-pcm", () => {
    const bank = buildSyntheticEsxBank();
    const dvIn = new DataView(bank.buffer);
    const currentBefore = dvIn.getUint32(ESX1_ADDR_NUM_MONO_SAMPLES + 8, false);
    const frames = 512;
    const patched = patchEsxBankSample(bank, {
      index: 1,
      channels: 1,
      pcmData: makeFloat32Sine(frames),
      sampleRate: 44100,
    });
    const dvOut = new DataView(patched);
    const currentAfter = dvOut.getUint32(ESX1_ADDR_NUM_MONO_SAMPLES + 8, false);
    expect(currentAfter).toBeGreaterThan(currentBefore);
    expect(currentAfter).toBe(
      Math.max(currentBefore, bank.byteLength - ESX1_ADDR_SAMPLE_DATA) + frames * 2,
    );
  });
});

describe("esxSamplePatcher — bit-exact preservation (FNV-1a)", () => {
  it("pattern region [0x0200..0x130000) stays bit-exact", () => {
    const bank = buildSyntheticEsxBank();
    const before = fnv1aHash32(bank, ESX1_ADDR_PATTERN_DATA, ESX1_ADDR_SONG_DATA);
    const patched = patchEsxBankSample(bank, {
      index: 0,
      channels: 1,
      pcmData: makeFloat32Sine(512),
      sampleRate: 44100,
    });
    const after = fnv1aHash32(patched, ESX1_ADDR_PATTERN_DATA, ESX1_ADDR_SONG_DATA);
    expect(after).toBe(before);
  });

  it("song region [0x130000..0x1B0000) stays bit-exact", () => {
    const bank = buildSyntheticEsxBank();
    const before = fnv1aHash32(bank, ESX1_ADDR_SONG_DATA, ESX1_ADDR_VALID_CHECK_2);
    const patched = patchEsxBankSample(bank, {
      index: 0,
      channels: 1,
      pcmData: makeFloat32Sine(256),
      sampleRate: 44100,
    });
    const after = fnv1aHash32(patched, ESX1_ADDR_SONG_DATA, ESX1_ADDR_VALID_CHECK_2);
    expect(after).toBe(before);
  });

  it("global region [0x20..0x200) stays bit-exact", () => {
    const bank = buildSyntheticEsxBank();
    const before = fnv1aHash32(bank, 0x20, 0x200);
    const patched = patchEsxBankSample(bank, {
      index: 0,
      channels: 1,
      pcmData: makeFloat32Sine(128),
      sampleRate: 44100,
    });
    const after = fnv1aHash32(patched, 0x20, 0x200);
    expect(after).toBe(before);
  });

  it("magic header [0..0x20) stays bit-exact", () => {
    const bank = buildSyntheticEsxBank();
    const before = fnv1aHash32(bank, 0, 0x20);
    const patched = patchEsxBankSample(bank, {
      index: 12,
      channels: 1,
      pcmData: makeFloat32Sine(64),
      sampleRate: 44100,
    });
    const after = fnv1aHash32(patched, 0, 0x20);
    expect(after).toBe(before);
  });

  it("other (non-targeted) sample-headers stay bit-exact when patching one slot", () => {
    const PREFILL_INDEX = 7;
    const TARGET_INDEX = 12;
    const oldPcm = float32ToBe16Pcm(makeFloat32Sine(200));
    const bank = buildSyntheticEsxBank([
      { index: PREFILL_INDEX, pcmBytes: oldPcm, sampleRate: 44100, name: "OLD" },
    ]);
    const oldHeaderOff = getEsxMonoHeaderOffset(PREFILL_INDEX);
    const otherHashBefore = fnv1aHash32(
      bank,
      oldHeaderOff,
      oldHeaderOff + ESX1_CHUNKSIZE_SAMPLE_HEADER_MONO,
    );
    const patched = patchEsxBankSample(bank, {
      index: TARGET_INDEX,
      channels: 1,
      pcmData: makeFloat32Sine(512),
      sampleRate: 44100,
      name: "NEW",
    });
    const otherHashAfter = fnv1aHash32(
      patched,
      oldHeaderOff,
      oldHeaderOff + ESX1_CHUNKSIZE_SAMPLE_HEADER_MONO,
    );
    expect(otherHashAfter).toBe(otherHashBefore);
  });

  it("other sample-PCM bytes stay bit-exact (older slot's PCM region untouched)", () => {
    const oldPcm = float32ToBe16Pcm(makeFloat32Sine(200));
    const bank = buildSyntheticEsxBank([
      { index: 3, pcmBytes: oldPcm, sampleRate: 44100, name: "OLD" },
    ]);
    // Old slot 3's PCM lives at ESX1_ADDR_SAMPLE_DATA + 0 .. + oldPcm.byteLength.
    const oldStart = ESX1_ADDR_SAMPLE_DATA;
    const oldEnd = oldStart + oldPcm.byteLength;
    const oldHashBefore = fnv1aHash32(bank, oldStart, oldEnd);
    // Patch a *different* slot.
    const patched = patchEsxBankSample(bank, {
      index: 25,
      channels: 1,
      pcmData: makeFloat32Sine(256),
      sampleRate: 44100,
      name: "NEW",
    });
    const oldHashAfter = fnv1aHash32(patched, oldStart, oldEnd);
    expect(oldHashAfter).toBe(oldHashBefore);
  });
});

describe("esxSamplePatcher — validation errors", () => {
  it("throws on out-of-range index (mono)", () => {
    const bank = buildSyntheticEsxBank();
    expect(() =>
      patchEsxBankSample(bank, {
        index: 256,
        channels: 1,
        pcmData: makeFloat32Sine(100),
        sampleRate: 44100,
      }),
    ).toThrowError(EsxSamplePatchError);
    expect(() =>
      patchEsxBankSample(bank, {
        index: -1,
        channels: 1,
        pcmData: makeFloat32Sine(100),
        sampleRate: 44100,
      }),
    ).toThrowError(EsxSamplePatchError);
  });

  it("throws on out-of-range index (stereo)", () => {
    const bank = buildSyntheticEsxBank();
    expect(() =>
      patchEsxBankSample(bank, {
        index: 128,
        channels: 2,
        pcmData: new Float32Array(128),
        sampleRate: 44100,
      }),
    ).toThrowError(EsxSamplePatchError);
  });

  it("throws on invalid channels", () => {
    const bank = buildSyntheticEsxBank();
    expect(() =>
      patchEsxBankSample(bank, {
        // @ts-expect-error invalid channels
        index: 0,
        channels: 3,
        pcmData: makeFloat32Sine(100),
        sampleRate: 44100,
      }),
    ).toThrowError(EsxSamplePatchError);
  });

  it("throws on empty PCM", () => {
    const bank = buildSyntheticEsxBank();
    expect(() =>
      patchEsxBankSample(bank, {
        index: 0,
        channels: 1,
        pcmData: new Float32Array(0),
        sampleRate: 44100,
      }),
    ).toThrowError(EsxSamplePatchError);
  });

  it("throws on PCM exceeding per-slot cap (10 MB)", () => {
    const bank = buildSyntheticEsxBank();
    // 10 MB / 2 bytes-per-sample = 5,242,880 + 1 frames → bytes > MAX_BYTES_PER_SLOT.
    const oversized = new Float32Array(5_242_880 + 1024);
    expect(() =>
      patchEsxBankSample(bank, {
        index: 0,
        channels: 1,
        pcmData: oversized,
        sampleRate: 44100,
      }),
    ).toThrowError(EsxSamplePatchError);
  });

  it("throws on stereo PCM with odd length", () => {
    const bank = buildSyntheticEsxBank();
    expect(() =>
      patchEsxBankSample(bank, {
        index: 0,
        channels: 2,
        pcmData: new Float32Array(101), // odd
        sampleRate: 44100,
      }),
    ).toThrowError(EsxSamplePatchError);
  });

  it("throws on invalid sampleRate", () => {
    const bank = buildSyntheticEsxBank();
    expect(() =>
      patchEsxBankSample(bank, {
        index: 0,
        channels: 1,
        pcmData: makeFloat32Sine(100),
        sampleRate: 0,
      }),
    ).toThrowError(EsxSamplePatchError);
    expect(() =>
      patchEsxBankSample(bank, {
        index: 0,
        channels: 1,
        pcmData: makeFloat32Sine(100),
        sampleRate: NaN,
      }),
    ).toThrowError(EsxSamplePatchError);
  });

  it("throws on corrupt bank buffer", () => {
    const bank = buildSyntheticEsxBank();
    bank[0] = 0x00;
    expect(() =>
      patchEsxBankSample(bank, {
        index: 0,
        channels: 1,
        pcmData: makeFloat32Sine(100),
        sampleRate: 44100,
      }),
    ).toThrowError(EsxSamplePatchError);
  });
});

describe("esxSamplePatcher — round-trip via parseEsxBank", () => {
  it("after patch: parseEsxBank decodes the new sample correctly", () => {
    const bank = buildSyntheticEsxBank();
    const frames = 512;
    const sourcePcm = makeFloat32Sine(frames, 220, 44100);
    const patched = patchEsxBankSample(bank, {
      index: 10,
      channels: 1,
      pcmData: sourcePcm,
      sampleRate: 44100,
      name: "SINE220",
    });
    const parsed = parseEsxBank(patched);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.monoSamples.length).toBe(1);
    const slot = parsed.monoSamples[0];
    expect(slot.index).toBe(10);
    expect(slot.name).toBe("SINE220");
    expect(slot.channels).toBe(1);
    expect(slot.sampleRate).toBe(44100);
    expect(slot.frames).toBe(frames);
    // PCM round-trip: BE16 byte-swap → Float32. Allow small int16 quantisation
    // error (1/32768 ≈ 0.00003).
    for (let i = 0; i < frames; i++) {
      expect(Math.abs(slot.pcmData[i] - sourcePcm[i])).toBeLessThan(0.001);
    }
  });

  it("after patch: previously-existing sample still decodes identically", () => {
    const oldFrames = 200;
    const oldFloat = makeFloat32Sine(oldFrames, 440, 44100);
    const oldPcmBytes = float32ToBe16Pcm(oldFloat);
    const bank = buildSyntheticEsxBank([
      { index: 3, pcmBytes: oldPcmBytes, sampleRate: 44100, name: "OLD" },
    ]);
    const before = parseEsxBank(bank);
    expect(before.monoSamples.length).toBe(1);
    const oldSlot = before.monoSamples[0];

    const patched = patchEsxBankSample(bank, {
      index: 30,
      channels: 1,
      pcmData: makeFloat32Sine(128, 110, 44100),
      sampleRate: 44100,
      name: "NEW",
    });

    const after = parseEsxBank(patched);
    expect(after.monoSamples.length).toBe(2);
    const stillOld = after.monoSamples.find((s) => s.index === 3);
    expect(stillOld).toBeDefined();
    if (stillOld) {
      expect(stillOld.name).toBe("OLD");
      expect(stillOld.frames).toBe(oldSlot.frames);
      // PCM identical (older region wasn't touched).
      for (let i = 0; i < stillOld.frames; i++) {
        expect(stillOld.pcmData[i]).toBe(oldSlot.pcmData[i]);
      }
    }
  });

  it("after stereo-patch: parseEsxBank decodes stereo sample", () => {
    const bank = buildSyntheticEsxBank();
    const frames = 256;
    // Interleaved Float32 L,R,L,R,... where L = sine A, R = sine B.
    const inter = new Float32Array(frames * 2);
    for (let i = 0; i < frames; i++) {
      inter[i * 2] = Math.sin((2 * Math.PI * 110 * i) / 44100) * 0.4;
      inter[i * 2 + 1] = Math.sin((2 * Math.PI * 220 * i) / 44100) * 0.4;
    }
    const patched = patchEsxBankSample(bank, {
      index: 4,
      channels: 2,
      pcmData: inter,
      sampleRate: 44100,
      name: "ST4",
    });
    const parsed = parseEsxBank(patched);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.stereoSamples.length).toBe(1);
    const slot = parsed.stereoSamples[0];
    expect(slot.channels).toBe(2);
    expect(slot.frames).toBe(frames);
    expect(slot.pcmData.length).toBe(frames * 2);
    // Spot-check first L+R against input.
    expect(Math.abs(slot.pcmData[0] - inter[0])).toBeLessThan(0.001);
    expect(Math.abs(slot.pcmData[1] - inter[1])).toBeLessThan(0.001);
  });
});

describe("esxSamplePatcher — header-offset helpers", () => {
  it("getEsxMonoHeaderOffset matches layout", () => {
    expect(getEsxMonoHeaderOffset(0)).toBe(ESX1_ADDR_SAMPLE_HEADER_MONO);
    expect(getEsxMonoHeaderOffset(5)).toBe(
      ESX1_ADDR_SAMPLE_HEADER_MONO + 5 * ESX1_CHUNKSIZE_SAMPLE_HEADER_MONO,
    );
    expect(() => getEsxMonoHeaderOffset(-1)).toThrowError(EsxSamplePatchError);
    expect(() => getEsxMonoHeaderOffset(256)).toThrowError(EsxSamplePatchError);
    expect(() => getEsxMonoHeaderOffset(1.5)).toThrowError(EsxSamplePatchError);
  });

  it("getEsxStereoHeaderOffset matches layout", () => {
    expect(getEsxStereoHeaderOffset(0)).toBe(ESX1_ADDR_SAMPLE_HEADER_STEREO);
    expect(getEsxStereoHeaderOffset(2)).toBe(
      ESX1_ADDR_SAMPLE_HEADER_STEREO + 2 * ESX1_CHUNKSIZE_SAMPLE_HEADER_STEREO,
    );
    expect(() => getEsxStereoHeaderOffset(128)).toThrowError(EsxSamplePatchError);
  });
});
