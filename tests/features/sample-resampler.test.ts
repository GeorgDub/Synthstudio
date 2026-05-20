// @vitest-environment node
/**
 * sample-resampler.test.ts — v3.203.0
 *
 * Pure-Coverage für sampleResampler.ts.
 *
 *  - Identity-Verhalten (targetSampleRate == source) → bit-exact gleicher Output
 *  - Empty / null Inputs → empty Output mit konsistentem sampleRate
 *  - changeSpeedRatio: 1/2/0.5 → identity/half/double length
 *  - targetLengthSamples Override > targetSampleRate
 *  - Sanitizer-Edge-Cases (NaN, Infinity, neg, 0)
 *  - Multi-Channel-Symmetrie
 *  - Immutability
 *  - Verschiedene sampleRates
 *  - Linear-Interp [0,1] → length 3 → [0, 0.5, 1]
 *  - Last-sample Bound-Check (no out-of-range)
 *  - Output-Shape AudioBufferLike-konform
 */

import { describe, it, expect } from "vitest";
import {
  resampleBuffer,
  changeSpeedRatio,
} from "../../client/src/utils/sampleResampler";
import type { AudioBufferLike } from "../../client/src/utils/sampleEmbedding";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeMono(samples: number[], sampleRate = 48000): AudioBufferLike {
  const data = new Float32Array(samples);
  return {
    sampleRate,
    numberOfChannels: 1,
    length: samples.length,
    getChannelData: (c: number) => {
      if (c !== 0) throw new RangeError(`channel ${c} out of range`);
      return data;
    },
  };
}

function makeStereo(L: number[], R: number[], sampleRate = 48000): AudioBufferLike {
  const left = new Float32Array(L);
  const right = new Float32Array(R);
  return {
    sampleRate,
    numberOfChannels: 2,
    length: Math.max(L.length, R.length),
    getChannelData: (c: number) => (c === 0 ? left : right),
  };
}

function makeEmpty(sampleRate = 48000): AudioBufferLike {
  return {
    sampleRate,
    numberOfChannels: 0,
    length: 0,
    getChannelData: () => new Float32Array(0),
  };
}

// ─── resampleBuffer — basics ─────────────────────────────────────────────────

describe("v3.203 resampleBuffer — identity / shape", () => {
  it("targetSampleRate == source.sampleRate → identity (bit-exact)", () => {
    const buf = makeMono([0.1, 0.2, 0.3, 0.4, 0.5], 48000);
    const out = resampleBuffer(buf, { targetSampleRate: 48000 });
    expect(out.length).toBe(5);
    expect(out.sampleRate).toBe(48000);
    expect(out.numberOfChannels).toBe(1);
    const channel = out.getChannelData(0);
    for (let i = 0; i < 5; i++) {
      expect(channel[i]).toBeCloseTo([0.1, 0.2, 0.3, 0.4, 0.5][i], 6);
    }
  });

  it("opts undefined → identity (sampleRate fallback)", () => {
    const buf = makeMono([0.1, 0.2, 0.3], 44100);
    const out = resampleBuffer(buf);
    expect(out.length).toBe(3);
    expect(out.sampleRate).toBe(44100);
    expect(out.getChannelData(0)[0]).toBeCloseTo(0.1, 6);
    expect(out.getChannelData(0)[2]).toBeCloseTo(0.3, 6);
  });

  it("Output ist AudioBufferLike-konform", () => {
    const out = resampleBuffer(makeMono([0, 0.5, 1]), { targetSampleRate: 24000 });
    expect(typeof out.sampleRate).toBe("number");
    expect(typeof out.numberOfChannels).toBe("number");
    expect(typeof out.length).toBe("number");
    expect(typeof out.getChannelData).toBe("function");
    expect(out.getChannelData(0)).toBeInstanceOf(Float32Array);
  });

  it("Linear-Interp src=[0,1] → outLen=3 → [0, 0.5, 1]", () => {
    const out = resampleBuffer(makeMono([0, 1]), { targetLengthSamples: 3 });
    const ch = out.getChannelData(0);
    expect(out.length).toBe(3);
    expect(ch[0]).toBeCloseTo(0.0, 6);
    expect(ch[1]).toBeCloseTo(0.5, 6);
    expect(ch[2]).toBeCloseTo(1.0, 6);
  });

  it("Last-sample edge: no out-of-range read", () => {
    // outLen = 5, srcLen = 3 — output[4] muss src[2] sein (Endpunkt-erhaltend)
    const out = resampleBuffer(makeMono([1, 2, 3]), { targetLengthSamples: 5 });
    expect(out.length).toBe(5);
    const ch = out.getChannelData(0);
    expect(ch[0]).toBeCloseTo(1, 6);
    expect(ch[4]).toBeCloseTo(3, 6);
    for (const v of ch) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

// ─── resampleBuffer — empty / null ───────────────────────────────────────────

describe("v3.203 resampleBuffer — empty / null", () => {
  it("empty buffer → empty output mit erkanntem sampleRate", () => {
    const out = resampleBuffer(makeEmpty(44100), { targetSampleRate: 48000 });
    expect(out.length).toBe(0);
    expect(out.numberOfChannels).toBe(0);
    // numCh=0 → empty-Path; sanitizeSampleRate(48000, 44100) → 48000
    expect(out.sampleRate).toBe(48000);
  });

  it("empty buffer + opts undefined → empty output mit source sampleRate", () => {
    const out = resampleBuffer(makeEmpty(22050));
    expect(out.length).toBe(0);
    expect(out.sampleRate).toBe(22050);
  });

  it("non-empty buffer + targetLengthSamples = 0 → empty output, sampleRate erhalten", () => {
    const out = resampleBuffer(makeMono([1, 2, 3], 48000), {
      targetLengthSamples: 0,
      targetSampleRate: 22050,
    });
    expect(out.length).toBe(0);
    expect(out.numberOfChannels).toBe(1);
    expect(out.sampleRate).toBe(22050);
  });
});

// ─── resampleBuffer — targetSampleRate ──────────────────────────────────────

describe("v3.203 resampleBuffer — targetSampleRate", () => {
  it("Upsample 48000 → 96000 (2x) → doppelte Länge", () => {
    const buf = makeMono([0, 1, 2, 3], 48000);
    const out = resampleBuffer(buf, { targetSampleRate: 96000 });
    expect(out.length).toBe(8); // floor(4 * 96000/48000)
    expect(out.sampleRate).toBe(96000);
  });

  it("Downsample 48000 → 24000 (0.5x) → halbe Länge", () => {
    const buf = makeMono([0, 1, 2, 3, 4, 5], 48000);
    const out = resampleBuffer(buf, { targetSampleRate: 24000 });
    expect(out.length).toBe(3); // floor(6 * 24000/48000)
    expect(out.sampleRate).toBe(24000);
  });

  it("Verschiedene SR-Pairs (44100 → 48000)", () => {
    const buf = makeMono(new Array(441).fill(0).map((_, i) => i / 441), 44100);
    const out = resampleBuffer(buf, { targetSampleRate: 48000 });
    expect(out.length).toBe(Math.floor(441 * 48000 / 44100)); // 480
    expect(out.sampleRate).toBe(48000);
  });
});

// ─── resampleBuffer — targetLengthSamples overrides ─────────────────────────

describe("v3.203 resampleBuffer — targetLengthSamples Override", () => {
  it("targetLengthSamples hat Vorrang vor targetSampleRate (Length)", () => {
    const buf = makeMono([0, 1, 2, 3], 48000);
    const out = resampleBuffer(buf, {
      targetSampleRate: 96000, // would give length 8
      targetLengthSamples: 7,  // override → 7
    });
    expect(out.length).toBe(7);
    // sampleRate folgt trotzdem targetSampleRate
    expect(out.sampleRate).toBe(96000);
  });

  it("targetLengthSamples ohne targetSampleRate → source sampleRate", () => {
    const buf = makeMono([0, 1, 2, 3], 48000);
    const out = resampleBuffer(buf, { targetLengthSamples: 10 });
    expect(out.length).toBe(10);
    expect(out.sampleRate).toBe(48000);
  });

  it("non-integer targetLengthSamples wird floored", () => {
    const out = resampleBuffer(makeMono([0, 1, 2, 3]), {
      targetLengthSamples: 5.9,
    });
    expect(out.length).toBe(5);
  });
});

// ─── resampleBuffer — sanitizer edge cases ──────────────────────────────────

describe("v3.203 resampleBuffer — defensive sanitizers", () => {
  it("targetSampleRate = NaN → identity", () => {
    const buf = makeMono([1, 2, 3], 48000);
    const out = resampleBuffer(buf, { targetSampleRate: NaN });
    expect(out.length).toBe(3);
    expect(out.sampleRate).toBe(48000);
  });

  it("targetSampleRate = Infinity → identity", () => {
    const buf = makeMono([1, 2, 3], 48000);
    const out = resampleBuffer(buf, { targetSampleRate: Infinity });
    expect(out.length).toBe(3);
    expect(out.sampleRate).toBe(48000);
  });

  it("targetSampleRate = -1000 → identity", () => {
    const buf = makeMono([1, 2, 3], 48000);
    const out = resampleBuffer(buf, { targetSampleRate: -1000 });
    expect(out.length).toBe(3);
    expect(out.sampleRate).toBe(48000);
  });

  it("targetSampleRate = 0 → identity", () => {
    const buf = makeMono([1, 2, 3], 48000);
    const out = resampleBuffer(buf, { targetSampleRate: 0 });
    expect(out.length).toBe(3);
    expect(out.sampleRate).toBe(48000);
  });

  it("targetLengthSamples = NaN → fallback auf SR-Berechnung", () => {
    const buf = makeMono([1, 2, 3, 4], 48000);
    const out = resampleBuffer(buf, {
      targetSampleRate: 24000,
      targetLengthSamples: NaN,
    });
    expect(out.length).toBe(2); // floor(4 * 24000/48000)
    expect(out.sampleRate).toBe(24000);
  });

  it("targetLengthSamples = Infinity → fallback", () => {
    const buf = makeMono([1, 2, 3, 4], 48000);
    const out = resampleBuffer(buf, {
      targetSampleRate: 48000,
      targetLengthSamples: Infinity,
    });
    expect(out.length).toBe(4); // identity-fallback
  });

  it("targetLengthSamples = -5 → fallback", () => {
    const buf = makeMono([1, 2, 3, 4], 48000);
    const out = resampleBuffer(buf, { targetLengthSamples: -5 });
    expect(out.length).toBe(4); // identity-fallback (target sampleRate = source)
  });
});

// ─── resampleBuffer — multi-channel ─────────────────────────────────────────

describe("v3.203 resampleBuffer — multi-channel symmetry", () => {
  it("Identische L/R → identische Outputs", () => {
    const samples = [0, 0.25, 0.5, 0.75, 1];
    const stereo = makeStereo(samples, samples);
    const out = resampleBuffer(stereo, { targetLengthSamples: 9 });
    expect(out.numberOfChannels).toBe(2);
    const L = out.getChannelData(0);
    const R = out.getChannelData(1);
    expect(L.length).toBe(9);
    expect(R.length).toBe(9);
    for (let i = 0; i < L.length; i++) {
      expect(L[i]).toBeCloseTo(R[i], 6);
    }
  });

  it("Unterschiedliche L/R → unterschiedliche aber konsistente Outputs", () => {
    const stereo = makeStereo([0, 1, 0, 1], [1, 0, 1, 0]);
    const out = resampleBuffer(stereo, { targetLengthSamples: 7 });
    const L = out.getChannelData(0);
    const R = out.getChannelData(1);
    // Endpoint-erhaltend: L[0]=0, L[6]=1, R[0]=1, R[6]=0
    expect(L[0]).toBeCloseTo(0, 6);
    expect(L[6]).toBeCloseTo(1, 6);
    expect(R[0]).toBeCloseTo(1, 6);
    expect(R[6]).toBeCloseTo(0, 6);
  });

  it("Out-of-range channel access → RangeError", () => {
    const out = resampleBuffer(makeMono([1, 2, 3]), { targetLengthSamples: 5 });
    expect(() => out.getChannelData(1)).toThrow(RangeError);
    expect(() => out.getChannelData(-1)).toThrow(RangeError);
  });
});

// ─── resampleBuffer — immutability ──────────────────────────────────────────

describe("v3.203 resampleBuffer — immutability", () => {
  it("Input wird nicht mutiert", () => {
    const original = [0.1, 0.2, 0.3, 0.4];
    const buf = makeMono(original.slice(), 48000);
    const snapshot = Array.from(buf.getChannelData(0));
    resampleBuffer(buf, { targetSampleRate: 96000 });
    const after = Array.from(buf.getChannelData(0));
    expect(after).toEqual(snapshot);
  });

  it("Wiederholte Aufrufe liefern konsistente Werte", () => {
    const buf = makeMono([0, 0.5, 1], 48000);
    const a = resampleBuffer(buf, { targetLengthSamples: 5 }).getChannelData(0);
    const b = resampleBuffer(buf, { targetLengthSamples: 5 }).getChannelData(0);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]).toBeCloseTo(b[i], 6);
    }
  });
});

// ─── changeSpeedRatio ───────────────────────────────────────────────────────

describe("v3.203 changeSpeedRatio — basics", () => {
  it("ratio = 1 → identity (same length)", () => {
    const buf = makeMono([0.1, 0.2, 0.3, 0.4, 0.5], 48000);
    const out = changeSpeedRatio(buf, 1);
    expect(out.length).toBe(5);
    expect(out.sampleRate).toBe(48000);
    const ch = out.getChannelData(0);
    expect(ch[0]).toBeCloseTo(0.1, 6);
    expect(ch[4]).toBeCloseTo(0.5, 6);
  });

  it("ratio = 2 → half length", () => {
    const buf = makeMono([0, 1, 2, 3, 4, 5, 6, 7], 48000);
    const out = changeSpeedRatio(buf, 2);
    expect(out.length).toBe(4);
    expect(out.sampleRate).toBe(48000);
  });

  it("ratio = 0.5 → double length", () => {
    const buf = makeMono([0, 1, 2, 3], 48000);
    const out = changeSpeedRatio(buf, 0.5);
    expect(out.length).toBe(8);
    expect(out.sampleRate).toBe(48000);
  });
});

describe("v3.203 changeSpeedRatio — defensive", () => {
  it("ratio = NaN → identity", () => {
    const out = changeSpeedRatio(makeMono([1, 2, 3]), NaN);
    expect(out.length).toBe(3);
  });

  it("ratio = Infinity → identity", () => {
    const out = changeSpeedRatio(makeMono([1, 2, 3]), Infinity);
    expect(out.length).toBe(3);
  });

  it("ratio = 0 → identity", () => {
    const out = changeSpeedRatio(makeMono([1, 2, 3]), 0);
    expect(out.length).toBe(3);
  });

  it("ratio = -2 → identity", () => {
    const out = changeSpeedRatio(makeMono([1, 2, 3]), -2);
    expect(out.length).toBe(3);
  });

  it("empty buffer + ratio=2 → empty output", () => {
    const out = changeSpeedRatio(makeEmpty(48000), 2);
    expect(out.length).toBe(0);
    expect(out.sampleRate).toBe(48000);
  });
});

// ─── preservePitch stub ─────────────────────────────────────────────────────

describe("v3.203 resampleBuffer — preservePitch stub", () => {
  it("preservePitch=true verhält sich wie false (v3.203 stub)", () => {
    const buf = makeMono([0, 0.25, 0.5, 0.75, 1.0], 48000);
    const a = resampleBuffer(buf, {
      targetLengthSamples: 9,
      preservePitch: false,
    });
    const b = resampleBuffer(buf, {
      targetLengthSamples: 9,
      preservePitch: true,
    });
    expect(a.length).toBe(b.length);
    const aCh = a.getChannelData(0);
    const bCh = b.getChannelData(0);
    for (let i = 0; i < a.length; i++) {
      expect(aCh[i]).toBeCloseTo(bCh[i], 6);
    }
  });
});
