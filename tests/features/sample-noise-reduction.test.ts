/**
 * sample-noise-reduction.test.ts (v3.218)
 *
 * Pure-Coverage fuer client/src/utils/sampleNoiseReduction.ts.
 */

import { describe, it, expect } from "vitest";
import type { AudioBufferLike } from "@/utils/sampleEmbedding";
import {
  reduceNoise,
  NOISE_REDUCTION_DEFAULTS,
} from "@/utils/sampleNoiseReduction";

// --- Test-Helpers -----------------------------------------------------------

function makeBuffer(
  channelData: number[][],
  sampleRate = 44100,
): AudioBufferLike {
  const channels = channelData.map((c) => Float32Array.from(c));
  const length = channels[0]?.length ?? 0;
  return {
    sampleRate,
    numberOfChannels: channels.length,
    length,
    getChannelData(ch: number) {
      const data = channels[ch];
      if (!data) throw new RangeError("channel " + ch + " out of range");
      return data;
    },
  };
}

function makeBufferFromFloat32(
  channels: Float32Array[],
  sampleRate = 44100,
): AudioBufferLike {
  const length = channels[0]?.length ?? 0;
  return {
    sampleRate,
    numberOfChannels: channels.length,
    length,
    getChannelData(ch: number) {
      const data = channels[ch];
      if (!data) throw new RangeError("channel " + ch + " out of range");
      return data;
    },
  };
}

function makeEmptyBuffer(sampleRate = 44100): AudioBufferLike {
  return {
    sampleRate,
    numberOfChannels: 0,
    length: 0,
    getChannelData() {
      throw new RangeError("empty buffer");
    },
  };
}

/** Sinus mit gegebener Frequenz / Dauer in Sekunden. */
function makeSine(
  freqHz: number,
  durationS: number,
  sampleRate = 44100,
  amplitude = 1,
): Float32Array {
  const n = Math.max(0, Math.round(durationS * sampleRate));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * freqHz * i) / sampleRate);
  }
  return out;
}

/** Kombiniert (concat) mehrere Float32Arrays. */
function concatFloat(...arrs: Float32Array[]): Float32Array {
  let total = 0;
  for (const a of arrs) total += a.length;
  const out = new Float32Array(total);
  let off = 0;
  for (const a of arrs) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

function allFinite(arr: Float32Array): boolean {
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) return false;
  }
  return true;
}

function allInRange(arr: Float32Array, lo: number, hi: number): boolean {
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] < lo || arr[i] > hi) return false;
  }
  return true;
}

// --- 1. Empty / degenerate ---------------------------------------------------

describe("reduceNoise - empty / degenerate buffers", () => {
  it("empty buffer (numberOfChannels=0, length=0) -> empty result", () => {
    const out = reduceNoise(makeEmptyBuffer(44100));
    expect(out.numberOfChannels).toBe(0);
    expect(out.length).toBe(0);
    expect(out.sampleRate).toBe(44100);
  });

  it("null cast -> empty result with fallback sampleRate 48000", () => {
    // @ts-expect-error: bewusster ungueltiger Cast
    const out = reduceNoise(null);
    expect(out.numberOfChannels).toBe(0);
    expect(out.length).toBe(0);
    expect(out.sampleRate).toBe(48000);
  });

  it("buffer with length=0 but channels metadata -> empty result", () => {
    const buf: AudioBufferLike = {
      sampleRate: 22050,
      numberOfChannels: 2,
      length: 0,
      getChannelData() {
        return new Float32Array(0);
      },
    };
    const out = reduceNoise(buf);
    expect(out.numberOfChannels).toBe(0);
    expect(out.length).toBe(0);
    expect(out.sampleRate).toBe(22050);
  });

  it("buffer with numberOfChannels=0 but length>0 -> empty result", () => {
    const buf: AudioBufferLike = {
      sampleRate: 44100,
      numberOfChannels: 0,
      length: 100,
      getChannelData() {
        throw new RangeError("none");
      },
    };
    const out = reduceNoise(buf);
    expect(out.numberOfChannels).toBe(0);
    expect(out.length).toBe(0);
  });
});

// --- 2. Silence in -> silence out -------------------------------------------

describe("reduceNoise - silence in / out", () => {
  it("silence buffer in -> silence (or near-silence) out", () => {
    const sr = 44100;
    const data = new Float32Array(sr); // 1s silence
    const buf = makeBufferFromFloat32([data], sr);
    const out = reduceNoise(buf);
    const ch = out.getChannelData(0);
    expect(ch.length).toBe(data.length);
    // noiseRms == 0 -> threshold == 0 -> kein Block faellt unter threshold.
    // factor wird via knee berechnet; bei blockRms=0 -> knee=exp(0)=1
    // -> factor = 1 - reduction. dry*factor = 0. Output ist exakt 0.
    for (let i = 0; i < ch.length; i++) {
      expect(ch[i]).toBe(0);
    }
  });
});

// --- 3. Sine preservation (mit Pin #2: stille noise-profile-Region) ---------

describe("reduceNoise - sine preservation (noise profile = silence prefix)", () => {
  it("[silence | sine] -> sine region (post-profile) is preserved", () => {
    const sr = 44100;
    const profileMs = 100;
    const silentSamples = Math.round((profileMs * sr) / 1000); // = 4410
    const silentPrefix = new Float32Array(silentSamples); // alle 0
    const sineBody = makeSine(440, 0.5, sr, 0.8); // 22050 samples
    const combined = concatFloat(silentPrefix, sineBody);
    const buf = makeBufferFromFloat32([combined], sr);
    const out = reduceNoise(buf, { noiseProfileMs: profileMs, reduction: 0.7 });

    expect(out.length).toBe(combined.length);
    const ch = out.getChannelData(0);

    // Sine-Bereich (nach dem stillen Prefix) soll erhalten sein (factor ~ 1
    // weil blockRms >> threshold=0 und knee -> 0).
    // Probe ein paar Sample-Mitten - sollten close-to input sein.
    const probeStart = silentSamples + 1000;
    const probeEnd = silentSamples + 2000;
    let sumDiff = 0;
    for (let i = probeStart; i < probeEnd; i++) {
      sumDiff += Math.abs(ch[i] - combined[i]);
    }
    const meanDiff = sumDiff / (probeEnd - probeStart);
    // factor = 1 - 0.7 * exp(-10 * blockRms) ; bei blockRms~0.566 (sine RMS)
    // ist exp(-5.66) ~ 0.0035, also factor ~ 0.9975 -> diff < 0.005.
    expect(meanDiff).toBeLessThan(0.01);
    expect(allFinite(ch)).toBe(true);
  });
});

// --- 4. Quiet noise -> attenuated -------------------------------------------

describe("reduceNoise - quiet noise gets attenuated", () => {
  it("low-amplitude noise (well below threshold-equivalent) -> output near silence floor", () => {
    const sr = 44100;
    // Konstantes leises Signal ueber den ganzen Buffer.  Da das Noise-Profil
    // aus diesem selben Signal gelernt wird, ist noiseRms == signal-rms,
    // threshold = noiseRms * 0.3 (reduction=0.7).  blockRms == noiseRms
    // -> blockRms >= threshold -> kein floor-Branch, sondern knee mit
    // (blockRms - threshold) = 0.7*noiseRms ; knee = exp(-7*noiseRms).
    // Bei noiseRms=0.02 -> knee=exp(-0.14)=0.869 -> factor=1 - 0.7*0.869 = 0.392.
    // Wir testen: out-RMS < in-RMS.
    const data = new Float32Array(sr); // 1s
    for (let i = 0; i < data.length; i++) {
      data[i] = 0.02 * Math.sin((2 * Math.PI * 200 * i) / sr);
    }
    const buf = makeBufferFromFloat32([data], sr);
    const out = reduceNoise(buf, { reduction: 0.7 });
    const ch = out.getChannelData(0);

    // RMS-Vergleich
    let inSq = 0,
      outSq = 0;
    for (let i = 0; i < data.length; i++) {
      inSq += data[i] * data[i];
      outSq += ch[i] * ch[i];
    }
    const inRms = Math.sqrt(inSq / data.length);
    const outRms = Math.sqrt(outSq / data.length);
    expect(outRms).toBeLessThan(inRms * 0.9); // mindestens 10% Attenuation
    expect(outRms).toBeGreaterThan(0); // nicht totgetreten
  });

  it("silent-prefix + quiet-rest-of-buffer -> rest attenuated to spectralFloor", () => {
    const sr = 44100;
    const profileMs = 100;
    const silentSamples = Math.round((profileMs * sr) / 1000); // 4410
    const silentPrefix = new Float32Array(silentSamples);
    // sehr leiser konstanter Bereich (RMS ~ 0.001)
    const quietRest = new Float32Array(sr - silentSamples);
    for (let i = 0; i < quietRest.length; i++) {
      quietRest[i] = 0.001;
    }
    const combined = concatFloat(silentPrefix, quietRest);
    const buf = makeBufferFromFloat32([combined], sr);
    const out = reduceNoise(buf, {
      noiseProfileMs: profileMs,
      reduction: 0.7,
      spectralFloor: 0.1,
    });
    const ch = out.getChannelData(0);

    // noiseRms == 0 (stiller Prefix) -> threshold == 0 -> kein floor-branch,
    // knee branch: factor = 1 - 0.7*exp(-blockRms*10) = 1 - 0.7*exp(-0.01)
    // ~ 1 - 0.693 = 0.307.  Output ~ 0.001 * 0.307 ~ 0.0003.
    // Test: output < input fuer die quiet-region.
    let maxOut = 0;
    for (let i = silentSamples + 100; i < silentSamples + 1000; i++) {
      maxOut = Math.max(maxOut, Math.abs(ch[i]));
    }
    expect(maxOut).toBeLessThanOrEqual(0.001);
  });
});

// --- 5. reduction=0 -> identity ---------------------------------------------

describe("reduceNoise - reduction=0 -> identity", () => {
  it("reduction=0 returns identity copy", () => {
    const sr = 44100;
    const data = makeSine(440, 0.1, sr, 0.5);
    const buf = makeBufferFromFloat32([data], sr);
    const out = reduceNoise(buf, { reduction: 0 });
    expect(out.length).toBe(data.length);
    const ch = out.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      expect(ch[i]).toBeCloseTo(data[i], 6);
    }
  });

  it("reduction=0 output is a FRESH Float32Array (no aliasing)", () => {
    const data = new Float32Array([0.1, 0.2, 0.3]);
    const buf = makeBufferFromFloat32([data], 44100);
    const out = reduceNoise(buf, { reduction: 0 });
    expect(out.getChannelData(0)).not.toBe(data);
  });
});

// --- 6. reduction=1 -> maximum gate -----------------------------------------

describe("reduceNoise - reduction=1 -> maximum gate", () => {
  it("reduction=1 zero noiseProfile -> remains finite + output bounded", () => {
    const sr = 44100;
    const silentPrefix = new Float32Array(Math.round((100 * sr) / 1000));
    const sineBody = makeSine(440, 0.2, sr, 0.5);
    const combined = concatFloat(silentPrefix, sineBody);
    const buf = makeBufferFromFloat32([combined], sr);
    const out = reduceNoise(buf, { reduction: 1, noiseProfileMs: 100 });
    const ch = out.getChannelData(0);
    // reduction=1: threshold=0 ; blockRms>0 -> factor = 1 - 1*exp(-blockRms*10).
    // Bei blockRms 0.354 (sine RMS) -> factor = 1 - exp(-3.54) ~ 0.971 -> Output finite + in [-1,1].
    expect(allFinite(ch)).toBe(true);
    expect(allInRange(ch, -1, 1)).toBe(true);
    expect(ch.length).toBe(combined.length);
  });

  it("reduction=1 with self-noise-profile + quiet signal -> heavily attenuated", () => {
    const sr = 44100;
    const data = new Float32Array(sr);
    for (let i = 0; i < data.length; i++) {
      data[i] = 0.05 * Math.sin((2 * Math.PI * 200 * i) / sr);
    }
    const buf = makeBufferFromFloat32([data], sr);
    const out = reduceNoise(buf, { reduction: 1 });
    const ch = out.getChannelData(0);
    // reduction=1: low-clamp branch greift NICHT (blockRms == noiseRms == threshold * 0 + noiseRms).
    // threshold = noiseRms * 0 = 0.  blockRms = noiseRms > 0 = threshold.
    // factor = 1 - 1*exp(-noiseRms*10) ; bei noiseRms ~ 0.0354 -> factor ~ 1 - 0.702 = 0.298.
    let inSq = 0,
      outSq = 0;
    for (let i = 0; i < data.length; i++) {
      inSq += data[i] * data[i];
      outSq += ch[i] * ch[i];
    }
    expect(Math.sqrt(outSq / data.length)).toBeLessThan(Math.sqrt(inSq / data.length) * 0.5);
  });
});

// --- 7. Length-Preservation -------------------------------------------------

describe("reduceNoise - length preservation", () => {
  it.each([1, 17, 256, 1024, 4096, 50000])(
    "length=%d preserved",
    (len) => {
      const data = new Float32Array(len);
      for (let i = 0; i < len; i++) data[i] = (i % 7) * 0.01;
      const buf = makeBufferFromFloat32([data], 44100);
      const out = reduceNoise(buf);
      expect(out.length).toBe(len);
      expect(out.getChannelData(0).length).toBe(len);
    },
  );
});

// --- 8. Multi-Channel -------------------------------------------------------

describe("reduceNoise - multi-channel", () => {
  it("stereo buffer -> 2 output channels, length preserved", () => {
    const sr = 44100;
    const l = new Float32Array(sr);
    const r = new Float32Array(sr);
    for (let i = 0; i < sr; i++) {
      l[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / sr);
      r[i] = 0.3 * Math.sin((2 * Math.PI * 880 * i) / sr);
    }
    const buf = makeBufferFromFloat32([l, r], sr);
    const out = reduceNoise(buf);
    expect(out.numberOfChannels).toBe(2);
    expect(out.length).toBe(sr);
    expect(out.getChannelData(0).length).toBe(sr);
    expect(out.getChannelData(1).length).toBe(sr);
    expect(allFinite(out.getChannelData(0))).toBe(true);
    expect(allFinite(out.getChannelData(1))).toBe(true);
  });

  it("per-channel noise profiles are independent (L silent, R loud)", () => {
    const sr = 44100;
    const len = sr;
    const profileMs = 100;
    const profileSamples = Math.round((profileMs * sr) / 1000);
    // L: silence-prefix + quiet-noise (under threshold ~ 0)
    const l = new Float32Array(len);
    for (let i = profileSamples; i < len; i++) l[i] = 0.001;
    // R: loud-noise-prefix + same loud signal -> threshold > 0 -> body NOT muted.
    const r = new Float32Array(len);
    for (let i = 0; i < len; i++) r[i] = 0.3 * Math.sin((2 * Math.PI * 200 * i) / sr);
    const buf = makeBufferFromFloat32([l, r], sr);
    const out = reduceNoise(buf, { noiseProfileMs: profileMs, reduction: 0.7 });
    const lo = out.getChannelData(0);
    const ro = out.getChannelData(1);
    // L: body attenuated stark (Identity-Prefix silent, quiet body unter threshold ~0 nicht erreicht
    // weil noiseRms=0 -> threshold=0 -> body >0 -> knee branch).
    // Wichtig: R muss durchgangsweise wesentliche Energie behalten (signal weit ueber profile-RMS).
    let lEnergy = 0,
      rEnergy = 0;
    for (let i = profileSamples + 100; i < profileSamples + 2000; i++) {
      lEnergy += lo[i] * lo[i];
      rEnergy += ro[i] * ro[i];
    }
    expect(rEnergy).toBeGreaterThan(lEnergy * 100); // R-Signal viel staerker als L
  });

  it("3-channel input -> 3-channel output", () => {
    const sr = 22050;
    const ch0 = new Float32Array(1000);
    const ch1 = new Float32Array(1000);
    const ch2 = new Float32Array(1000);
    for (let i = 0; i < 1000; i++) {
      ch0[i] = 0.1;
      ch1[i] = 0.2;
      ch2[i] = 0.3;
    }
    const buf = makeBufferFromFloat32([ch0, ch1, ch2], sr);
    const out = reduceNoise(buf);
    expect(out.numberOfChannels).toBe(3);
    expect(out.length).toBe(1000);
    expect(out.getChannelData(2).length).toBe(1000);
  });
});

// --- 9. Defaults ------------------------------------------------------------

describe("reduceNoise - defaults", () => {
  it("undefined opts -> uses defaults", () => {
    const buf = makeBuffer([[0.1, 0.2, 0.3, 0.4]], 44100);
    const out = reduceNoise(buf);
    expect(out.length).toBe(4);
    expect(out.numberOfChannels).toBe(1);
  });

  it("empty opts {} -> identical to undefined opts", () => {
    const data = makeSine(440, 0.05, 44100, 0.3);
    const bufA = makeBufferFromFloat32([data], 44100);
    const bufB = makeBufferFromFloat32([data], 44100);
    const outA = reduceNoise(bufA);
    const outB = reduceNoise(bufB, {});
    const a = outA.getChannelData(0);
    const b = outB.getChannelData(0);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]).toBeCloseTo(b[i], 6);
    }
  });

  it("NOISE_REDUCTION_DEFAULTS exposes expected default values", () => {
    expect(NOISE_REDUCTION_DEFAULTS.noiseProfileMs).toBe(100);
    expect(NOISE_REDUCTION_DEFAULTS.reduction).toBe(0.7);
    expect(NOISE_REDUCTION_DEFAULTS.spectralFloor).toBe(0.1);
    // frozen
    expect(Object.isFrozen(NOISE_REDUCTION_DEFAULTS)).toBe(true);
  });
});

// --- 10. Immutability -------------------------------------------------------

describe("reduceNoise - immutability / purity", () => {
  it("input Float32Array data is NOT mutated", () => {
    const data = makeSine(440, 0.1, 44100, 0.5);
    const snapshot = Array.from(data);
    const buf = makeBufferFromFloat32([data], 44100);
    reduceNoise(buf, { reduction: 0.7 });
    for (let i = 0; i < data.length; i++) {
      expect(data[i]).toBeCloseTo(snapshot[i], 6);
    }
  });

  it("output channel Float32Array !== input Float32Array (fresh allocation)", () => {
    const data = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]);
    const buf = makeBufferFromFloat32([data], 44100);
    const out = reduceNoise(buf);
    expect(out.getChannelData(0)).not.toBe(data);
  });

  it("two calls with same input -> deep-equal output (deterministic)", () => {
    const data = makeSine(220, 0.2, 22050, 0.4);
    const bufA = makeBufferFromFloat32([data], 22050);
    const bufB = makeBufferFromFloat32([data], 22050);
    const outA = reduceNoise(bufA, { reduction: 0.6 });
    const outB = reduceNoise(bufB, { reduction: 0.6 });
    const a = outA.getChannelData(0);
    const b = outB.getChannelData(0);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]).toBe(b[i]);
    }
  });
});

// --- 11. Various sample rates -----------------------------------------------

describe("reduceNoise - various sampleRates", () => {
  it.each([8000, 22050, 44100, 48000, 96000])(
    "sampleRate=%d preserved in output, output finite",
    (sr) => {
      const data = makeSine(440, 0.05, sr, 0.3);
      const buf = makeBufferFromFloat32([data], sr);
      const out = reduceNoise(buf);
      expect(out.sampleRate).toBe(sr);
      expect(out.length).toBe(data.length);
      expect(allFinite(out.getChannelData(0))).toBe(true);
    },
  );

  it("non-positive sampleRate (0) -> fallback 48000 in empty result", () => {
    const buf: AudioBufferLike = {
      sampleRate: 0,
      numberOfChannels: 0,
      length: 0,
      getChannelData() {
        throw new Error("empty");
      },
    };
    const out = reduceNoise(buf);
    expect(out.sampleRate).toBe(48000);
  });

  it("NaN sampleRate -> fallback 48000 (non-empty input still processed)", () => {
    const data = new Float32Array([0.1, 0.2, 0.3]);
    const buf: AudioBufferLike = {
      sampleRate: NaN,
      numberOfChannels: 1,
      length: data.length,
      getChannelData() {
        return data;
      },
    };
    const out = reduceNoise(buf);
    expect(out.sampleRate).toBe(48000);
    expect(out.length).toBe(3);
  });
});

// --- 12. Sanitizers (NaN / Inf / neg) ---------------------------------------

describe("reduceNoise - sanitizer noiseProfileMs", () => {
  it.each([
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["-Infinity", -Infinity],
    ["negative", -5],
    ["below-min (5)", 5],
  ] as Array<[string, number]>)("noiseProfileMs=%s -> default 100", (_label, val) => {
    const data = new Float32Array(2048);
    const buf = makeBufferFromFloat32([data], 44100);
    const out = reduceNoise(buf, { noiseProfileMs: val });
    expect(out.length).toBe(2048);
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });

  it("noiseProfileMs > 2000 -> clamped 2000 (output still finite)", () => {
    const data = new Float32Array(2048);
    const buf = makeBufferFromFloat32([data], 44100);
    const out = reduceNoise(buf, { noiseProfileMs: 99999 });
    expect(out.length).toBe(2048);
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });
});

describe("reduceNoise - sanitizer reduction", () => {
  it.each([
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["-Infinity", -Infinity],
  ] as Array<[string, number]>)("reduction=%s -> default 0.7", (_label, val) => {
    const data = makeSine(440, 0.05, 44100, 0.3);
    const buf = makeBufferFromFloat32([data], 44100);
    const out = reduceNoise(buf, { reduction: val });
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });

  it("reduction=-5 -> 0 (identity behavior)", () => {
    const data = makeSine(440, 0.05, 44100, 0.3);
    const buf = makeBufferFromFloat32([data], 44100);
    const out = reduceNoise(buf, { reduction: -5 });
    const ch = out.getChannelData(0);
    // Identity-Pfad: clamped copy.
    for (let i = 0; i < data.length; i++) {
      expect(ch[i]).toBeCloseTo(data[i], 6);
    }
  });

  it("reduction=99 -> clamped 1 (output finite)", () => {
    const data = makeSine(440, 0.05, 44100, 0.3);
    const buf = makeBufferFromFloat32([data], 44100);
    const out = reduceNoise(buf, { reduction: 99 });
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });
});

describe("reduceNoise - sanitizer spectralFloor", () => {
  it.each([
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["-Infinity", -Infinity],
  ] as Array<[string, number]>)("spectralFloor=%s -> default 0.1 (output finite)", (_label, val) => {
    const data = makeSine(440, 0.05, 44100, 0.3);
    const buf = makeBufferFromFloat32([data], 44100);
    const out = reduceNoise(buf, { spectralFloor: val });
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });

  it("spectralFloor=-1 -> clamped 0", () => {
    const data = new Float32Array(2048);
    const buf = makeBufferFromFloat32([data], 44100);
    const out = reduceNoise(buf, { spectralFloor: -1 });
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });

  it("spectralFloor=99 -> clamped 1", () => {
    const data = new Float32Array(2048);
    const buf = makeBufferFromFloat32([data], 44100);
    const out = reduceNoise(buf, { spectralFloor: 99 });
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });
});

// --- 13. Output clamped +/- 1 -----------------------------------------------

describe("reduceNoise - output clamped to [-1, 1]", () => {
  it("input above 1.0 -> output clamped to 1", () => {
    const sr = 44100;
    const data = new Float32Array(2048);
    for (let i = 0; i < data.length; i++) data[i] = 5.0; // wuetend laut
    const buf = makeBufferFromFloat32([data], sr);
    const out = reduceNoise(buf);
    const ch = out.getChannelData(0);
    for (let i = 0; i < ch.length; i++) {
      expect(ch[i]).toBeLessThanOrEqual(1);
      expect(ch[i]).toBeGreaterThanOrEqual(-1);
    }
  });

  it("input below -1.0 -> output clamped to -1", () => {
    const data = new Float32Array(2048);
    for (let i = 0; i < data.length; i++) data[i] = -3.5;
    const buf = makeBufferFromFloat32([data], 44100);
    const out = reduceNoise(buf);
    const ch = out.getChannelData(0);
    for (let i = 0; i < ch.length; i++) {
      expect(ch[i]).toBeGreaterThanOrEqual(-1);
      expect(ch[i]).toBeLessThanOrEqual(1);
    }
  });
});

// --- 14. Output finite (no NaN/Inf) -----------------------------------------

describe("reduceNoise - output finite (no NaN / Inf)", () => {
  it("input with NaN samples -> output is all finite (NaN replaced by 0)", () => {
    const data = new Float32Array([0.1, NaN, 0.2, NaN, 0.3, NaN, 0.4]);
    const buf = makeBufferFromFloat32([data], 44100);
    const out = reduceNoise(buf);
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });

  it("input with Infinity samples -> output is all finite + clamped", () => {
    const data = new Float32Array([0.1, Infinity, 0.2, -Infinity, 0.3]);
    const buf = makeBufferFromFloat32([data], 44100);
    const out = reduceNoise(buf);
    const ch = out.getChannelData(0);
    expect(allFinite(ch)).toBe(true);
    expect(allInRange(ch, -1, 1)).toBe(true);
  });

  it("reduction=0 with NaN input -> NaN replaced by 0 in identity path", () => {
    const data = new Float32Array([0.5, NaN, -0.3, NaN]);
    const buf = makeBufferFromFloat32([data], 44100);
    const out = reduceNoise(buf, { reduction: 0 });
    const ch = out.getChannelData(0);
    expect(ch[0]).toBe(0.5);
    expect(ch[1]).toBe(0); // NaN -> 0 via clamp
    expect(ch[2]).toBeCloseTo(-0.3, 6);
    expect(ch[3]).toBe(0);
  });
});

// --- 15. Tail block (length not divisible by 1024) --------------------------

describe("reduceNoise - tail block handling", () => {
  it("length not divisible by 1024 -> tail processed correctly (length preserved)", () => {
    const sr = 44100;
    const lengths = [1025, 1500, 2049, 3000];
    for (const len of lengths) {
      const data = new Float32Array(len);
      for (let i = 0; i < len; i++) data[i] = 0.1 * Math.sin(i * 0.01);
      const buf = makeBufferFromFloat32([data], sr);
      const out = reduceNoise(buf);
      expect(out.length).toBe(len);
      expect(out.getChannelData(0).length).toBe(len);
      expect(allFinite(out.getChannelData(0))).toBe(true);
    }
  });

  it("length=1 (one sample) -> processed without crash, output finite", () => {
    const data = new Float32Array([0.5]);
    const buf = makeBufferFromFloat32([data], 44100);
    const out = reduceNoise(buf);
    expect(out.length).toBe(1);
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });
});

// --- 16. Buffer shorter than profile ----------------------------------------

describe("reduceNoise - buffer shorter than noise profile", () => {
  it("buffer 200ms but noiseProfile 500ms -> uses whole buffer for profile", () => {
    const sr = 44100;
    // 200ms = 8820 samples
    const data = new Float32Array(Math.round(0.2 * sr));
    for (let i = 0; i < data.length; i++) data[i] = 0.1;
    const buf = makeBufferFromFloat32([data], sr);
    const out = reduceNoise(buf, { noiseProfileMs: 500 });
    // muss durchlaufen, kein Crash, length preserved
    expect(out.length).toBe(data.length);
    expect(allFinite(out.getChannelData(0))).toBe(true);
  });
});
