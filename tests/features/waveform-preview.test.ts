/**
 * @vitest-environment jsdom
 *
 * Synthstudio – waveform-preview.test.ts  (v3.130.0)
 *
 * Tests fuer:
 *  - computeWaveformPreview (pure)
 *  - LRU-Cache via getOrComputeWaveform / invalidateWaveform / clearWaveformCache
 *  - useWaveformPreviewStore (settings persistence)
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  computeWaveformPreview,
  getOrComputeWaveform,
  invalidateWaveform,
  clearWaveformCache,
  waveformCacheSize,
  WAVEFORM_CACHE_MAX_ENTRIES,
  __setCachedWaveformForTests,
  type AudioBufferLike,
} from "@/utils/waveformPreview";
import {
  getWaveformPreviewSettings,
  setShowStepWaveforms,
  toggleShowStepWaveforms,
  __resetWaveformPreviewStoreForTests,
} from "@/store/useWaveformPreviewStore";

// ─── Mock-Helpers ────────────────────────────────────────────────────────────

function makeMockBuffer(channels: Float32Array[]): AudioBufferLike {
  return {
    numberOfChannels: channels.length,
    length: channels[0]?.length ?? 0,
    getChannelData(c: number): Float32Array {
      return channels[c];
    },
  };
}

function makeSineBuffer(length: number, freq: number, sampleRate = 44100): AudioBufferLike {
  const data = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    data[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }
  return makeMockBuffer([data]);
}

function makeConstantBuffer(length: number, value: number, channels = 1): AudioBufferLike {
  const chans: Float32Array[] = [];
  for (let c = 0; c < channels; c++) {
    const d = new Float32Array(length);
    d.fill(value);
    chans.push(d);
  }
  return makeMockBuffer(chans);
}

beforeEach(() => {
  clearWaveformCache();
  __resetWaveformPreviewStoreForTests();
});

// ─── computeWaveformPreview ──────────────────────────────────────────────────

describe("computeWaveformPreview", () => {
  it("returns array of exact `width` length", () => {
    const buf = makeSineBuffer(4410, 440);
    const env = computeWaveformPreview(buf, 32);
    expect(env).toHaveLength(32);
  });

  it("uses default width when not specified", () => {
    const buf = makeSineBuffer(4410, 440);
    const env = computeWaveformPreview(buf);
    expect(env).toHaveLength(32); // WAVEFORM_PREVIEW_DEFAULT_WIDTH
  });

  it("returns all zeros for empty buffer", () => {
    const empty = makeMockBuffer([new Float32Array(0)]);
    const env = computeWaveformPreview(empty, 32);
    expect(env).toHaveLength(32);
    expect(env.every(v => v === 0)).toBe(true);
  });

  it("returns all zeros for buffer with no channels", () => {
    const noCh: AudioBufferLike = {
      numberOfChannels: 0,
      length: 1000,
      getChannelData: () => new Float32Array(0),
    };
    const env = computeWaveformPreview(noCh, 16);
    expect(env).toHaveLength(16);
    expect(env.every(v => v === 0)).toBe(true);
  });

  it("returns empty array when width <= 0", () => {
    const buf = makeSineBuffer(1000, 440);
    expect(computeWaveformPreview(buf, 0)).toEqual([]);
    expect(computeWaveformPreview(buf, -5)).toEqual([]);
  });

  it("returns empty array when width is NaN", () => {
    const buf = makeSineBuffer(1000, 440);
    expect(computeWaveformPreview(buf, NaN)).toEqual([]);
  });

  it("constant +0.5 buffer → all bars ≈ 0.5", () => {
    const buf = makeConstantBuffer(4410, 0.5);
    const env = computeWaveformPreview(buf, 16);
    expect(env).toHaveLength(16);
    env.forEach(v => {
      expect(v).toBeGreaterThanOrEqual(0.49);
      expect(v).toBeLessThanOrEqual(0.51);
    });
  });

  it("constant -0.7 buffer → all bars ≈ 0.7 (abs value)", () => {
    const buf = makeConstantBuffer(4410, -0.7);
    const env = computeWaveformPreview(buf, 16);
    env.forEach(v => {
      expect(v).toBeGreaterThanOrEqual(0.69);
      expect(v).toBeLessThanOrEqual(0.71);
    });
  });

  it("pure sine buffer → all bars near 1.0 (peak amplitude)", () => {
    // 4410 samples @ 44.1kHz = 0.1s, 440Hz → 44 cycles, jedes Segment
    // enthält mehrere volle Zyklen → peak |s| sehr nahe 1.
    const buf = makeSineBuffer(4410, 440);
    const env = computeWaveformPreview(buf, 16);
    // Erlauben kleine numerische Unschärfe.
    env.forEach(v => {
      expect(v).toBeGreaterThan(0.95);
      expect(v).toBeLessThanOrEqual(1.0);
    });
  });

  it("clamps values >1 to 1.0", () => {
    const oversized = new Float32Array(100);
    oversized.fill(2.5);
    const env = computeWaveformPreview(makeMockBuffer([oversized]), 4);
    env.forEach(v => expect(v).toBe(1));
  });

  it("treats NaN/Infinity samples as zero", () => {
    const data = new Float32Array(100);
    for (let i = 0; i < 100; i++) data[i] = i === 50 ? Number.NaN : 0;
    const env = computeWaveformPreview(makeMockBuffer([data]), 4);
    env.forEach(v => expect(v).toBe(0));
  });

  it("stereo: takes max(|L|, |R|) per sample", () => {
    // L: konst 0.2, R: konst 0.8 → Output sollte 0.8 sein.
    const L = new Float32Array(1000);
    const R = new Float32Array(1000);
    L.fill(0.2);
    R.fill(0.8);
    const env = computeWaveformPreview(makeMockBuffer([L, R]), 8);
    env.forEach(v => {
      expect(v).toBeGreaterThanOrEqual(0.79);
      expect(v).toBeLessThanOrEqual(0.81);
    });
  });

  it("mono and stereo (with second channel zero) produce equivalent results", () => {
    const data = new Float32Array(1000);
    for (let i = 0; i < 1000; i++) data[i] = Math.sin(i * 0.1);
    const mono = makeMockBuffer([data]);
    const stereoZeroR = makeMockBuffer([data, new Float32Array(1000)]);
    const envMono = computeWaveformPreview(mono, 16);
    const envStereo = computeWaveformPreview(stereoZeroR, 16);
    envMono.forEach((v, i) => {
      expect(envStereo[i]).toBeCloseTo(v, 4);
    });
  });

  it("decay-shaped buffer → bars decrease monotonically", () => {
    // Exponential decay: |sample[i]| = exp(-i/1000)
    const data = new Float32Array(4000);
    for (let i = 0; i < 4000; i++) data[i] = Math.exp(-i / 1000);
    const env = computeWaveformPreview(makeMockBuffer([data]), 8);
    for (let i = 1; i < env.length; i++) {
      expect(env[i]).toBeLessThan(env[i - 1]);
    }
  });
});

// ─── Cache: LRU + invalidation ──────────────────────────────────────────────

describe("waveform cache (LRU)", () => {
  it("caches computed envelope: second call hits cache (no buffer needed)", () => {
    const buf = makeSineBuffer(1000, 440);
    const env1 = getOrComputeWaveform("sample-a", buf, 16);
    expect(env1).toBeDefined();
    expect(waveformCacheSize()).toBe(1);

    // Zweiter Aufruf OHNE Buffer — sollte gecached zurückgegeben werden.
    const env2 = getOrComputeWaveform("sample-a", null, 16);
    expect(env2).toBe(env1); // same Reference
  });

  it("returns undefined when no buffer and no cache", () => {
    const env = getOrComputeWaveform("missing-sample", null, 16);
    expect(env).toBeUndefined();
  });

  it("returns undefined for empty sampleId", () => {
    const buf = makeSineBuffer(1000, 440);
    expect(getOrComputeWaveform("", buf, 16)).toBeUndefined();
  });

  it("caches per-width independently", () => {
    const buf = makeSineBuffer(1000, 440);
    const env16 = getOrComputeWaveform("s", buf, 16);
    const env32 = getOrComputeWaveform("s", buf, 32);
    expect(env16).toHaveLength(16);
    expect(env32).toHaveLength(32);
    expect(waveformCacheSize()).toBe(2);
  });

  it("LRU evicts oldest entry when exceeding MAX_ENTRIES (64)", () => {
    // 65 unique sampleIds → erste sollte rausfliegen.
    for (let i = 0; i < WAVEFORM_CACHE_MAX_ENTRIES + 1; i++) {
      __setCachedWaveformForTests(`s${i}`, [0.5], 32);
    }
    expect(waveformCacheSize()).toBe(WAVEFORM_CACHE_MAX_ENTRIES);
    // s0 sollte evicted sein, s1+ noch da.
    expect(getOrComputeWaveform("s0", null, 32)).toBeUndefined();
    expect(getOrComputeWaveform("s1", null, 32)).toBeDefined();
  });

  it("LRU touches existing entry on access (moves to end)", () => {
    // Fülle Cache, dann access s0 — bei nächstem overflow sollte s0 BLEIBEN.
    for (let i = 0; i < WAVEFORM_CACHE_MAX_ENTRIES; i++) {
      __setCachedWaveformForTests(`s${i}`, [0.1 * i], 32);
    }
    expect(waveformCacheSize()).toBe(WAVEFORM_CACHE_MAX_ENTRIES);
    // s0 zugreifen → wird ans Ende verschoben.
    getOrComputeWaveform("s0", null, 32);
    // Neuen Eintrag hinzufügen → s1 sollte raus (jetzt ältester).
    __setCachedWaveformForTests("snew", [0.99], 32);
    expect(getOrComputeWaveform("s0", null, 32)).toBeDefined(); // s0 noch da
    expect(getOrComputeWaveform("s1", null, 32)).toBeUndefined(); // s1 evicted
  });

  it("invalidateWaveform removes all widths for a sample", () => {
    const buf = makeSineBuffer(1000, 440);
    getOrComputeWaveform("s", buf, 16);
    getOrComputeWaveform("s", buf, 32);
    expect(waveformCacheSize()).toBe(2);
    invalidateWaveform("s");
    expect(waveformCacheSize()).toBe(0);
  });

  it("invalidateWaveform leaves other samples untouched", () => {
    const buf = makeSineBuffer(1000, 440);
    getOrComputeWaveform("a", buf, 32);
    getOrComputeWaveform("b", buf, 32);
    invalidateWaveform("a");
    expect(getOrComputeWaveform("a", null, 32)).toBeUndefined();
    expect(getOrComputeWaveform("b", null, 32)).toBeDefined();
  });

  it("invalidateWaveform with empty sampleId is no-op", () => {
    const buf = makeSineBuffer(1000, 440);
    getOrComputeWaveform("a", buf, 32);
    invalidateWaveform("");
    expect(waveformCacheSize()).toBe(1);
  });

  it("clearWaveformCache empties the cache", () => {
    const buf = makeSineBuffer(1000, 440);
    getOrComputeWaveform("a", buf, 32);
    getOrComputeWaveform("b", buf, 32);
    clearWaveformCache();
    expect(waveformCacheSize()).toBe(0);
  });
});

// ─── Settings Store ──────────────────────────────────────────────────────────

describe("useWaveformPreviewStore", () => {
  it("default settings: showStepWaveforms = true (visual default-on)", () => {
    const s = getWaveformPreviewSettings();
    expect(s.showStepWaveforms).toBe(true);
  });

  it("setShowStepWaveforms(false) → persists", () => {
    setShowStepWaveforms(false);
    expect(getWaveformPreviewSettings().showStepWaveforms).toBe(false);
    // localStorage check
    const raw = localStorage.getItem("ss-waveform-preview:v1");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({ showStepWaveforms: false });
  });

  it("toggleShowStepWaveforms flips state", () => {
    const initial = getWaveformPreviewSettings().showStepWaveforms;
    toggleShowStepWaveforms();
    expect(getWaveformPreviewSettings().showStepWaveforms).toBe(!initial);
    toggleShowStepWaveforms();
    expect(getWaveformPreviewSettings().showStepWaveforms).toBe(initial);
  });

  it("coerces truthy/falsy to boolean", () => {
    // setShowStepWaveforms uses !!show internally
    setShowStepWaveforms(1 as unknown as boolean);
    expect(getWaveformPreviewSettings().showStepWaveforms).toBe(true);
    setShowStepWaveforms(0 as unknown as boolean);
    expect(getWaveformPreviewSettings().showStepWaveforms).toBe(false);
  });
});
