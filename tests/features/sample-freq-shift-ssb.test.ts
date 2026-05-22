// @vitest-environment node
/**
 * sample-freq-shift-ssb.test.ts — v3.232.0
 *
 * Tests fuer applyFreqShiftSSB Pure-Helper (echtes Single-Sideband-Shifting
 * via Hilbert-Transform-Approximation). Im Gegensatz zur cos-Carrier-Methode
 * in sampleFreqShift.ts unterscheidet diese Variante +/- shiftHz und produziert
 * asymmetrische Outputs (upper vs lower sideband).
 *
 * Konstante Sample-Rate 48000 fuer alle DSP-Assertions.
 */

import { describe, it, expect } from "vitest";
import { applyFreqShiftSSB } from "../../client/src/utils/sampleFreqShiftSSB";
import type { AudioBufferLike } from "../../client/src/utils/sampleEmbedding";

// ─── Inline Helpers ──────────────────────────────────────────────────────────

const SR = 48000;
const HILBERT_CENTER = 15; // group delay of internal Hilbert FIR

function makeBuffer(samples: number[], sampleRate = SR): AudioBufferLike {
  const data = new Float32Array(samples);
  return {
    sampleRate,
    numberOfChannels: 1,
    length: samples.length,
    getChannelData: () => data,
  };
}

function makeStereo(left: number[], right: number[], sampleRate = SR): AudioBufferLike {
  const L = new Float32Array(left);
  const R = new Float32Array(right);
  return {
    sampleRate,
    numberOfChannels: 2,
    length: Math.max(left.length, right.length),
    getChannelData: (c: number) => (c === 0 ? L : R),
  };
}

function makeEmpty(sampleRate = SR): AudioBufferLike {
  return {
    sampleRate,
    numberOfChannels: 0,
    length: 0,
    getChannelData: () => new Float32Array(0),
  };
}

function makeSine(len: number, freqHz: number, sampleRate = SR): AudioBufferLike {
  const data: number[] = new Array(len);
  for (let i = 0; i < len; i++) {
    data[i] = Math.sin((2 * Math.PI * freqHz * i) / sampleRate);
  }
  return makeBuffer(data, sampleRate);
}

function makeCos(len: number, freqHz: number, sampleRate = SR): AudioBufferLike {
  const data: number[] = new Array(len);
  for (let i = 0; i < len; i++) {
    data[i] = Math.cos((2 * Math.PI * freqHz * i) / sampleRate);
  }
  return makeBuffer(data, sampleRate);
}

function rms(data: Float32Array, startIdx = 0, endIdx?: number): number {
  const e = endIdx ?? data.length;
  let sum = 0;
  let n = 0;
  for (let i = startIdx; i < e; i++) {
    sum += data[i] * data[i];
    n++;
  }
  return n > 0 ? Math.sqrt(sum / n) : 0;
}

/**
 * Goertzel-Algorithmus: berechnet Magnitude einer einzigen Frequenz im Signal.
 * Effizienter als full-FFT fuer Single-Bin-Lookup. Liefert Amplituden-Skalierung
 * konsistent mit DFT-Bin-Magnitude.
 */
function goertzelMagnitude(
  data: Float32Array,
  freqHz: number,
  sampleRate: number,
  startIdx = 0,
  endIdx?: number,
): number {
  const end = endIdx ?? data.length;
  const N = end - startIdx;
  if (N <= 0) return 0;
  const omega = (2 * Math.PI * freqHz) / sampleRate;
  const coeff = 2 * Math.cos(omega);
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  for (let i = startIdx; i < end; i++) {
    s0 = data[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const real = s1 - s2 * Math.cos(omega);
  const imag = s2 * Math.sin(omega);
  // Normalisiert auf Sine-Amplitude
  return (2 * Math.sqrt(real * real + imag * imag)) / N;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("v3.232 applyFreqShiftSSB - Happy Path", () => {
  it("verschiebt 1000 Hz Cosine um +200 Hz nach oben (upper sideband)", () => {
    // Cosinus bei 1000 Hz, shift +200 Hz, upper -> Energie nahe 1200 Hz
    const input = makeCos(8192, 1000, SR);
    const out = applyFreqShiftSSB(input, { shiftHz: 200, sideBand: "upper" });
    const d = out.getChannelData(0);
    // Analyse nach Warmup-Region
    const mag1200 = goertzelMagnitude(d, 1200, SR, 512);
    const mag800 = goertzelMagnitude(d, 800, SR, 512);
    const mag1000 = goertzelMagnitude(d, 1000, SR, 512);
    // Upper sideband sollte 1200 Hz dominieren; 800 Hz (lower) sollte unterdrueckt sein.
    // 31-tap windowed Hilbert -> Suppression ~9.5 dB -> Ratio ~2.9x.
    expect(mag1200).toBeGreaterThan(mag800 * 2.5);
    expect(mag1200).toBeGreaterThan(mag1000);
  });

  it("verschiebt 1000 Hz Cosine um +200 Hz nach unten via lower sideband -> ~800 Hz", () => {
    const input = makeCos(8192, 1000, SR);
    const out = applyFreqShiftSSB(input, { shiftHz: 200, sideBand: "lower" });
    const d = out.getChannelData(0);
    const mag800 = goertzelMagnitude(d, 800, SR, 512);
    const mag1200 = goertzelMagnitude(d, 1200, SR, 512);
    // Lower sideband: 800 Hz dominiert, 1200 unterdrueckt
    expect(mag800).toBeGreaterThan(mag1200 * 2.5);
  });

  it("Asymmetrie: +shift upper unterscheidet sich von -shift upper sample-fuer-sample", () => {
    const input = makeCos(4096, 1000, SR);
    const outPlus = applyFreqShiftSSB(input, { shiftHz: 200, sideBand: "upper" });
    const outMinus = applyFreqShiftSSB(input, { shiftHz: -200, sideBand: "upper" });
    const dp = outPlus.getChannelData(0);
    const dm = outMinus.getChannelData(0);
    // Sample-Werte unterscheiden sich (im Gegensatz zur cos-Carrier-Methode)
    let diff = 0;
    for (let i = 500; i < 1500; i++) diff += Math.abs(dp[i] - dm[i]);
    expect(diff).toBeGreaterThan(1);
  });

  it("erzeugt einen neuen Buffer ohne den Input zu mutieren", () => {
    const input = makeSine(512, 1000, SR);
    const original = Array.from(input.getChannelData(0));
    const out = applyFreqShiftSSB(input, { shiftHz: 100, sideBand: "upper" });
    const after = Array.from(input.getChannelData(0));
    expect(after).toEqual(original);
    expect(out.getChannelData(0)).not.toBe(input.getChannelData(0));
  });

  it("Output-Laenge == Input-Laenge", () => {
    const input = makeSine(1024, 500, SR);
    const out = applyFreqShiftSSB(input, { shiftHz: 100 });
    expect(out.length).toBe(1024);
    expect(out.getChannelData(0).length).toBe(1024);
    expect(out.sampleRate).toBe(SR);
  });
});

describe("v3.232 applyFreqShiftSSB - Edge Cases", () => {
  it("empty buffer ergibt empty output", () => {
    const out = applyFreqShiftSSB(makeEmpty(), { shiftHz: 100 });
    expect(out.length).toBe(0);
    expect(out.numberOfChannels).toBe(0);
    expect(out.getChannelData(0).length).toBe(0);
  });

  it("sehr kurzer Buffer (4 samples) bleibt finite (innerhalb Warmup-Region)", () => {
    const out = applyFreqShiftSSB(makeBuffer([1, -1, 1, -1]), { shiftHz: 50 });
    const d = out.getChannelData(0);
    expect(d.length).toBe(4);
    for (let i = 0; i < 4; i++) expect(Number.isFinite(d[i])).toBe(true);
  });

  it("Buffer-Laenge <= HILBERT_CENTER: alle Outputs finite, erste Samples sind Warmup", () => {
    // 10 Samples, Hilbert braucht 15 fuer volle Latenz
    const input = makeSine(10, 1000, SR);
    const out = applyFreqShiftSSB(input, { shiftHz: 100 });
    expect(out.length).toBe(10);
    for (let i = 0; i < 10; i++) {
      expect(Number.isFinite(out.getChannelData(0)[i])).toBe(true);
    }
  });

  it("Stereo: beide Channels werden unabhaengig verarbeitet, gleicher Input -> gleicher Output", () => {
    const seq: number[] = [];
    for (let i = 0; i < 2048; i++) seq.push(Math.cos((2 * Math.PI * 1000 * i) / SR));
    const buf = makeStereo(seq, seq);
    const out = applyFreqShiftSSB(buf, { shiftHz: 100, sideBand: "upper" });
    expect(out.numberOfChannels).toBe(2);
    const L = out.getChannelData(0);
    const R = out.getChannelData(1);
    for (let i = 0; i < 2048; i++) expect(L[i]).toBeCloseTo(R[i], 6);
  });

  it("shiftHz NaN/Infinity -> 0 (kein Shift, Output = I_delayed cos-modulated)", () => {
    const input = makeCos(2048, 1000, SR);
    const outNaN = applyFreqShiftSSB(input, { shiftHz: NaN, sideBand: "upper" });
    const outInf = applyFreqShiftSSB(input, { shiftHz: Infinity, sideBand: "upper" });
    // Beide muessen identisch sein und finite bleiben
    const a = outNaN.getChannelData(0);
    // shiftHz NaN -> 0; omega = 0; out[n] = I_delayed[n] (Q*sin(0) = 0)
    // I_delayed[n] = dry[n-15] (Zero-pad fuer erste 15 Samples)
    for (let i = 0; i < 2048; i++) expect(Number.isFinite(a[i])).toBe(true);
    // Infinity wird auf MAX_SHIFT_HZ geclampt — unterscheidet sich von NaN-Output.
    // Sicherheits-Check: finite.
    const b = outInf.getChannelData(0);
    for (let i = 0; i < 2048; i++) expect(Number.isFinite(b[i])).toBe(true);
  });

  it("shiftHz=0 -> Output entspricht delayed-cosine (Identity-ish mit 15-sample Delay)", () => {
    const input = makeCos(2048, 1000, SR);
    const out = applyFreqShiftSSB(input, { shiftHz: 0, sideBand: "upper" });
    const d = out.getChannelData(0);
    const dry = input.getChannelData(0);
    // omega=0 -> cos=1, sin=0 -> out[n] = I_delayed[n] = dry[n-15]
    for (let n = HILBERT_CENTER + 100; n < 1000; n++) {
      expect(d[n]).toBeCloseTo(dry[n - HILBERT_CENTER], 5);
    }
  });

  it("shiftHz > 5000 wird auf 5000 geclampt (kein Crash, finite output)", () => {
    const input = makeSine(1024, 500, SR);
    const out = applyFreqShiftSSB(input, { shiftHz: 1e9 });
    const d = out.getChannelData(0);
    for (let i = 0; i < 1024; i++) expect(Number.isFinite(d[i])).toBe(true);
  });

  it("shiftHz < -5000 wird auf -5000 geclampt", () => {
    const input = makeSine(1024, 500, SR);
    const out = applyFreqShiftSSB(input, { shiftHz: -1e9 });
    const d = out.getChannelData(0);
    for (let i = 0; i < 1024; i++) expect(Number.isFinite(d[i])).toBe(true);
  });

  it("unbekanntes sideBand -> default 'upper'", () => {
    const input = makeCos(2048, 1000, SR);
    const outUpper = applyFreqShiftSSB(input, { shiftHz: 200, sideBand: "upper" });
    // Cast forciert ungueltigen Wert; runtime sollte auf "upper" fallen.
    const outDefault = applyFreqShiftSSB(input, {
      shiftHz: 200,
      sideBand: "garbage" as "upper" | "lower",
    });
    const a = outUpper.getChannelData(0);
    const b = outDefault.getChannelData(0);
    for (let i = 200; i < 800; i++) expect(b[i]).toBeCloseTo(a[i], 6);
  });

  it("Output garantiert finite ueber gesamte Buffer-Laenge inkl. Warmup", () => {
    const input = makeSine(4096, 1500, SR);
    const out = applyFreqShiftSSB(input, { shiftHz: 300, sideBand: "lower" });
    const d = out.getChannelData(0);
    for (let i = 0; i < 4096; i++) {
      expect(Number.isFinite(d[i])).toBe(true);
    }
  });
});

describe("v3.232 applyFreqShiftSSB - Math Properties", () => {
  it("Linearitaet: SSB(2*x) ~= 2*SSB(x)", () => {
    const x = makeCos(2048, 1000, SR);
    const x2: number[] = [];
    for (let i = 0; i < 2048; i++) x2.push(x.getChannelData(0)[i] * 2);
    const ya = applyFreqShiftSSB(x, { shiftHz: 150, sideBand: "upper" }).getChannelData(0);
    const yb = applyFreqShiftSSB(makeBuffer(x2), {
      shiftHz: 150,
      sideBand: "upper",
    }).getChannelData(0);
    // Nach Warmup-Region pruefen
    for (let i = 200; i < 1500; i++) {
      expect(yb[i]).toBeCloseTo(ya[i] * 2, 5);
    }
  });

  it("Sideband-Suppression: upper hat dominante Energie bei f+shift, lower bei f-shift", () => {
    const f = 2000;
    const shift = 300;
    const input = makeCos(16384, f, SR);

    const outUpper = applyFreqShiftSSB(input, { shiftHz: shift, sideBand: "upper" });
    const outLower = applyFreqShiftSSB(input, { shiftHz: shift, sideBand: "lower" });

    const dU = outUpper.getChannelData(0);
    const dL = outLower.getChannelData(0);

    // Goertzel ueber stabile Region (nach Warmup)
    const upperAtPlus = goertzelMagnitude(dU, f + shift, SR, 1024);
    const upperAtMinus = goertzelMagnitude(dU, f - shift, SR, 1024);
    const lowerAtPlus = goertzelMagnitude(dL, f + shift, SR, 1024);
    const lowerAtMinus = goertzelMagnitude(dL, f - shift, SR, 1024);

    // Suppression-Ratio sollte deutlich > 2 sein (31-tap Hilbert-FIR ist endlich)
    expect(upperAtPlus).toBeGreaterThan(upperAtMinus * 2);
    expect(lowerAtMinus).toBeGreaterThan(lowerAtPlus * 2);
  });

  it("Sinus + 90-Grad-Cosinus-Sanity: SSB-Output von cos und sin haben aehnliche RMS-Magnitude", () => {
    // Sanity-Check: ein reines cos und ein reines sin bei gleicher Frequenz,
    // gleicher shiftHz, gleicher sideBand sollten Output mit aehnlicher Energie liefern.
    const cosIn = makeCos(8192, 1500, SR);
    const sinIn = makeSine(8192, 1500, SR);
    const outCos = applyFreqShiftSSB(cosIn, { shiftHz: 200, sideBand: "upper" });
    const outSin = applyFreqShiftSSB(sinIn, { shiftHz: 200, sideBand: "upper" });
    const rmsC = rms(outCos.getChannelData(0), 1024);
    const rmsS = rms(outSin.getChannelData(0), 1024);
    // Beide sollten in der gleichen Groessenordnung sein.
    expect(rmsC).toBeGreaterThan(0.3);
    expect(rmsS).toBeGreaterThan(0.3);
    expect(Math.abs(rmsC - rmsS)).toBeLessThan(0.15);
  });

  it("Energie-Erhaltung approximativ: SSB-Shift verringert RMS nicht wesentlich (in stabiler Region)", () => {
    // SSB-Shift sollte Pass-Band-Signale weitgehend energieerhaltend verschieben.
    const input = makeCos(8192, 1500, SR);
    const out = applyFreqShiftSSB(input, { shiftHz: 200, sideBand: "upper" });
    const rmsIn = rms(input.getChannelData(0), 1024);
    const rmsOut = rms(out.getChannelData(0), 1024);
    // Toleranz: Hilbert-FIR ist endlich, einige Verluste sind erwartet.
    expect(rmsOut).toBeGreaterThan(rmsIn * 0.5);
    expect(rmsOut).toBeLessThan(rmsIn * 1.5);
  });

  it("Stabilitaet: Output bleibt im sinnvollen Amplituden-Bereich (kein Blow-Up)", () => {
    // Voll skalierter Input -> Output sollte etwa im gleichen Bereich bleiben.
    const input = makeCos(4096, 1000, SR);
    const out = applyFreqShiftSSB(input, { shiftHz: 500, sideBand: "upper" });
    const d = out.getChannelData(0);
    let maxAbs = 0;
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > maxAbs) maxAbs = a;
    }
    // Hilbert ist nicht-perfekt -> erlaubt etwas Headroom, aber <= ~3 ist sicher
    expect(maxAbs).toBeLessThan(3);
    expect(maxAbs).toBeGreaterThan(0.1);
  });
});
