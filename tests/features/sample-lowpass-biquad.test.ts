// @vitest-environment node
/**
 * sample-lowpass-biquad.test.ts — v3.232.0
 *
 * Tests fuer RBJ-Biquad-Lowpass Pure-Helper:
 *   - applyLowPassBiquad (-12 dB/Oct, zwei-pol)
 *   - DC-Pass-Through, High-Freq-Daempfung, defensive Defaults
 *   - Q-Effekt, Stereo-Isolation, Numerische Stabilitaet
 *
 * Konstante Sample-Rate 48000 fuer alle DSP-Assertions.
 */

import { describe, it, expect } from "vitest";
import {
  applyLowPassBiquad,
  LOWPASS_BIQUAD_PRESETS,
  DEFAULT_CUTOFF_HZ,
  DEFAULT_Q,
} from "../../client/src/utils/sampleLowPassBiquad";
import type { AudioBufferLike } from "../../client/src/utils/sampleEmbedding";

// ─── Inline Helpers ──────────────────────────────────────────────────────────

const SR = 48000;

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

function makeConst(value: number, len: number, sampleRate = SR): AudioBufferLike {
  return makeBuffer(new Array(len).fill(value), sampleRate);
}

function makeSine(len: number, freqHz: number, sampleRate = SR): AudioBufferLike {
  const data: number[] = new Array(len);
  for (let i = 0; i < len; i++) {
    data[i] = Math.sin((2 * Math.PI * freqHz * i) / sampleRate);
  }
  return makeBuffer(data, sampleRate);
}

function rms(data: Float32Array, startIdx = 0): number {
  let sum = 0;
  let n = 0;
  for (let i = startIdx; i < data.length; i++) {
    sum += data[i] * data[i];
    n++;
  }
  return n > 0 ? Math.sqrt(sum / n) : 0;
}

function peak(data: Float32Array, startIdx = 0): number {
  let p = 0;
  for (let i = startIdx; i < data.length; i++) {
    const a = Math.abs(data[i]);
    if (a > p) p = a;
  }
  return p;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("v3.232 applyLowPassBiquad - Happy Path", () => {
  it("DC (Konstantsignal) passiert ungeaendert (Gain @ DC = 1)", () => {
    const out = applyLowPassBiquad(makeConst(0.7, 4096), { cutoffHz: 2000 });
    // Nach Einschwingen (~ein paar Hundert Samples) sollte DC durchpassen.
    const d = out.getChannelData(0);
    const tail = rms(d, 3000);
    expect(tail).toBeCloseTo(0.7, 2);
  });

  it("passt tiefe Frequenzen weitgehend ungedaempft durch", () => {
    // 100 Hz Sine, Cutoff 5000 Hz -> klar im Pass-Band
    const sine = makeSine(4096, 100, SR);
    const out = applyLowPassBiquad(sine, { cutoffHz: 5000, q: DEFAULT_Q });
    const rmsIn = rms(sine.getChannelData(0), 500);
    const rmsOut = rms(out.getChannelData(0), 500);
    expect(rmsOut).toBeGreaterThan(rmsIn * 0.9);
    expect(rmsOut).toBeLessThan(rmsIn * 1.1);
  });

  it("daempft Frequenzen weit oberhalb der Cutoff stark", () => {
    // 10 kHz Sine, Cutoff 500 Hz -> ueber 4 Oktaven drueber
    const sine = makeSine(4096, 10000, SR);
    const out = applyLowPassBiquad(sine, { cutoffHz: 500, q: DEFAULT_Q });
    const rmsIn = rms(sine.getChannelData(0), 1024);
    const rmsOut = rms(out.getChannelData(0), 1024);
    expect(rmsOut).toBeLessThan(rmsIn * 0.05);
  });

  it("erzeugt einen neuen Buffer ohne den Input zu mutieren", () => {
    const input = makeSine(512, 1000, SR);
    const original = Array.from(input.getChannelData(0));
    const out = applyLowPassBiquad(input, { cutoffHz: 800 });
    const after = Array.from(input.getChannelData(0));
    expect(after).toEqual(original);
    expect(out.getChannelData(0)).not.toBe(input.getChannelData(0));
  });
});

describe("v3.232 applyLowPassBiquad - Edge Cases", () => {
  it("empty buffer ergibt empty output", () => {
    const out = applyLowPassBiquad(makeEmpty());
    expect(out.length).toBe(0);
    expect(out.numberOfChannels).toBe(0);
    expect(out.getChannelData(0).length).toBe(0);
  });

  it("ein-Sample Buffer liefert ein-Sample Output (kein Crash)", () => {
    const out = applyLowPassBiquad(makeBuffer([0.5]), { cutoffHz: 2000 });
    expect(out.length).toBe(1);
    expect(out.getChannelData(0).length).toBe(1);
    expect(Number.isFinite(out.getChannelData(0)[0])).toBe(true);
  });

  it("sehr kurzer Buffer (4 samples) bleibt finite", () => {
    const out = applyLowPassBiquad(makeBuffer([1, -1, 1, -1]), { cutoffHz: 1000 });
    const d = out.getChannelData(0);
    expect(d.length).toBe(4);
    for (let i = 0; i < 4; i++) expect(Number.isFinite(d[i])).toBe(true);
  });

  it("Stereo: beide Channels werden unabhaengig gefiltert (kein Cross-Coupling)", () => {
    // Linker Channel: 8 kHz (sollte gedaempft werden)
    // Rechter Channel: DC 0.4 (sollte durchpassen)
    const left: number[] = [];
    for (let i = 0; i < 2048; i++) left.push(Math.sin((2 * Math.PI * 8000 * i) / SR));
    const right = new Array(2048).fill(0.4);
    const buf = makeStereo(left, right);
    const out = applyLowPassBiquad(buf, { cutoffHz: 1000 });
    expect(out.numberOfChannels).toBe(2);
    // Rechter Channel: DC -> durchpasst
    expect(rms(out.getChannelData(1), 1500)).toBeCloseTo(0.4, 2);
    // Linker Channel: 8 kHz >> 1 kHz -> stark gedaempft
    expect(rms(out.getChannelData(0), 1024)).toBeLessThan(0.05);
  });

  it("getChannelData out-of-range wirft RangeError", () => {
    const out = applyLowPassBiquad(makeBuffer([0.1, 0.2, 0.3]));
    expect(() => out.getChannelData(5)).toThrow(RangeError);
    expect(() => out.getChannelData(-1)).toThrow(RangeError);
  });

  it("cutoffHz NaN/undefined faellt auf Default zurueck (keine NaN-Propagation)", () => {
    const sine = makeSine(1024, 1000, SR);
    const outNaN = applyLowPassBiquad(sine, { cutoffHz: NaN });
    const outUndef = applyLowPassBiquad(sine, {});
    const a = outNaN.getChannelData(0);
    const b = outUndef.getChannelData(0);
    for (let i = 0; i < 1024; i++) {
      expect(Number.isFinite(a[i])).toBe(true);
      expect(a[i]).toBeCloseTo(b[i], 6);
    }
  });

  it("cutoffHz >= Nyquist wird auf Nyquist/2 geclampt (stabil, finite)", () => {
    const sine = makeSine(1024, 1000, SR);
    const out = applyLowPassBiquad(sine, { cutoffHz: SR / 2 + 1000 });
    const d = out.getChannelData(0);
    for (let i = 0; i < 1024; i++) expect(Number.isFinite(d[i])).toBe(true);
  });
});

describe("v3.232 applyLowPassBiquad - Math Properties", () => {
  it("Linearitaet: LP(2*x) ~= 2*LP(x)", () => {
    const x = makeSine(2048, 800, SR);
    const x2: number[] = [];
    for (let i = 0; i < 2048; i++) x2.push(x.getChannelData(0)[i] * 2);
    const ya = applyLowPassBiquad(x, { cutoffHz: 2000 }).getChannelData(0);
    const yb = applyLowPassBiquad(makeBuffer(x2), { cutoffHz: 2000 }).getChannelData(0);
    for (let i = 500; i < 1500; i++) {
      expect(yb[i]).toBeCloseTo(ya[i] * 2, 5);
    }
  });

  it("Stabilitaet: hohes Q produziert weiterhin finite-output und beschraenkten Peak", () => {
    const sine = makeSine(8192, 2000, SR);
    const out = applyLowPassBiquad(sine, { cutoffHz: 2000, q: 40 });
    const d = out.getChannelData(0);
    let allFinite = true;
    for (let i = 0; i < d.length; i++) {
      if (!Number.isFinite(d[i])) {
        allFinite = false;
        break;
      }
    }
    expect(allFinite).toBe(true);
    expect(peak(d)).toBeLessThan(50);
  });

  it("Monotonic Roll-Off: hoehere Cutoff -> staerker passierende hohe Frequenz", () => {
    // 3000 Hz Test-Sine
    const sine = makeSine(4096, 3000, SR);
    // Cutoff 6000 Hz: 3000 Hz unter Cutoff -> wenig Daempfung
    const wideCut = applyLowPassBiquad(sine, { cutoffHz: 6000, q: DEFAULT_Q });
    // Cutoff 600 Hz: 3000 Hz weit drueber -> starke Daempfung
    const narrowCut = applyLowPassBiquad(sine, { cutoffHz: 600, q: DEFAULT_Q });
    const rmsWide = rms(wideCut.getChannelData(0), 1024);
    const rmsNarrow = rms(narrowCut.getChannelData(0), 1024);
    expect(rmsWide).toBeGreaterThan(rmsNarrow);
  });

  it("hoeheres Q -> ausgepraegterer Resonanz-Peak bei Cutoff-Frequenz", () => {
    const sine = makeSine(8192, 1000, SR);
    const lowQ = applyLowPassBiquad(sine, { cutoffHz: 1000, q: 0.5 });
    const highQ = applyLowPassBiquad(sine, { cutoffHz: 1000, q: 6 });
    const rmsLow = rms(lowQ.getChannelData(0), 2048);
    const rmsHigh = rms(highQ.getChannelData(0), 2048);
    expect(rmsHigh).toBeGreaterThan(rmsLow * 1.5);
  });

  it("Impulse-Response klingt ab (BIBO-Stabilitaet, kein unbounded growth)", () => {
    const impulse = new Array(4096).fill(0);
    impulse[0] = 1;
    const out = applyLowPassBiquad(makeBuffer(impulse), { cutoffHz: 1500, q: DEFAULT_Q });
    const d = out.getChannelData(0);
    const tailPeak = peak(d, 3500);
    expect(tailPeak).toBeLessThan(1e-3);
  });

  it("Komplementaritaet zu HP-Konzept: -3 dB-Punkt bei Cutoff (Butterworth)", () => {
    // Bei Cutoff-Frequenz sollte ein Butterworth-LP ungefaehr -3 dB (Faktor ~0.707) liefern.
    const fc = 1000;
    const sine = makeSine(16384, fc, SR);
    const out = applyLowPassBiquad(sine, { cutoffHz: fc, q: DEFAULT_Q });
    const rmsIn = rms(sine.getChannelData(0), 4096);
    const rmsOut = rms(out.getChannelData(0), 4096);
    const ratio = rmsOut / rmsIn;
    // -3 dB ~ 0.707. Toleranz wegen Window/Sampling-Effekten.
    expect(ratio).toBeGreaterThan(0.55);
    expect(ratio).toBeLessThan(0.85);
  });
});

describe("v3.232 LOWPASS_BIQUAD_PRESETS", () => {
  it("Presets sind alle anwendbar und liefern finite output", () => {
    const sine = makeSine(2048, 1500, SR);
    for (const key of Object.keys(LOWPASS_BIQUAD_PRESETS) as Array<
      keyof typeof LOWPASS_BIQUAD_PRESETS
    >) {
      const preset = LOWPASS_BIQUAD_PRESETS[key];
      const out = applyLowPassBiquad(sine, preset);
      const d = out.getChannelData(0);
      let allFinite = true;
      for (let i = 0; i < d.length; i++) {
        if (!Number.isFinite(d[i])) {
          allFinite = false;
          break;
        }
      }
      expect(allFinite).toBe(true);
    }
  });

  it("DEFAULT_CUTOFF_HZ und DEFAULT_Q haben sinnvolle Werte", () => {
    expect(DEFAULT_CUTOFF_HZ).toBeGreaterThan(0);
    expect(DEFAULT_CUTOFF_HZ).toBeLessThan(SR / 2);
    expect(DEFAULT_Q).toBeGreaterThan(0);
    expect(DEFAULT_Q).toBeCloseTo(0.707, 2);
  });
});
