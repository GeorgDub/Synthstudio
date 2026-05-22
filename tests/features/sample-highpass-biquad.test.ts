// @vitest-environment node
/**
 * sample-highpass-biquad.test.ts — v3.232.0
 *
 * Tests fuer RBJ-Biquad-Highpass Pure-Helper:
 *   - applyHighPassBiquad (-12 dB/Oct, zwei-pol)
 *   - DC-Killing, Pass-Band-Through, defensive Defaults
 *   - Q-Effekt, Stereo-Isolation, Numerische Stabilitaet
 *
 * Konstante Sample-Rate 48000 fuer alle DSP-Assertions.
 */

import { describe, it, expect } from "vitest";
import {
  applyHighPassBiquad,
  HIGHPASS_BIQUAD_PRESETS,
  DEFAULT_CUTOFF_HZ,
  DEFAULT_Q,
} from "../../client/src/utils/sampleHighPassBiquad";
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

describe("v3.232 applyHighPassBiquad - Happy Path", () => {
  it("filtert DC (Konstantsignal) auf ~0", () => {
    const out = applyHighPassBiquad(makeConst(0.5, 2048), { cutoffHz: 200 });
    // HP @ DC has gain 0; after settling everything should be near zero.
    const settled = out.getChannelData(0);
    const rmsTail = rms(settled, 1500);
    expect(rmsTail).toBeLessThan(1e-3);
  });

  it("passt hohe Frequenzen weitgehend ungedaempft durch", () => {
    // 6 kHz sine, cutoff 200 Hz -> deutlich im Pass-Band
    const sine = makeSine(4096, 6000, SR);
    const out = applyHighPassBiquad(sine, { cutoffHz: 200, q: DEFAULT_Q });
    const rmsIn = rms(sine.getChannelData(0), 200);
    const rmsOut = rms(out.getChannelData(0), 200);
    // im Pass-Band sollte RMS sehr nahe am Input liegen.
    expect(rmsOut).toBeGreaterThan(rmsIn * 0.9);
    expect(rmsOut).toBeLessThan(rmsIn * 1.1);
  });

  it("daempft Frequenzen weit unterhalb der Cutoff stark", () => {
    // 50 Hz sine, cutoff 2000 Hz -> 5+ Oktaven unter Cutoff
    const sine = makeSine(4096, 50, SR);
    const out = applyHighPassBiquad(sine, { cutoffHz: 2000, q: DEFAULT_Q });
    const rmsIn = rms(sine.getChannelData(0), 1024);
    const rmsOut = rms(out.getChannelData(0), 1024);
    // Stop-Band: deutlich gedaempft (mind. -20 dB ~ Faktor 10)
    expect(rmsOut).toBeLessThan(rmsIn * 0.1);
  });

  it("erzeugt einen neuen Buffer ohne den Input zu mutieren", () => {
    const input = makeSine(512, 1000, SR);
    const original = Array.from(input.getChannelData(0));
    const out = applyHighPassBiquad(input, { cutoffHz: 500 });
    const after = Array.from(input.getChannelData(0));
    expect(after).toEqual(original);
    // Output ist anderes Array
    expect(out.getChannelData(0)).not.toBe(input.getChannelData(0));
  });
});

describe("v3.232 applyHighPassBiquad - Edge Cases", () => {
  it("empty buffer ergibt empty output", () => {
    const out = applyHighPassBiquad(makeEmpty());
    expect(out.length).toBe(0);
    expect(out.numberOfChannels).toBe(0);
    expect(out.getChannelData(0).length).toBe(0);
  });

  it("ein-Sample Buffer liefert ein-Sample Output (kein Crash)", () => {
    const out = applyHighPassBiquad(makeBuffer([0.5]), { cutoffHz: 200 });
    expect(out.length).toBe(1);
    expect(out.getChannelData(0).length).toBe(1);
    expect(Number.isFinite(out.getChannelData(0)[0])).toBe(true);
  });

  it("sehr kurzer Buffer (4 samples) bleibt finite", () => {
    const out = applyHighPassBiquad(makeBuffer([1, -1, 1, -1]), { cutoffHz: 500 });
    const d = out.getChannelData(0);
    expect(d.length).toBe(4);
    for (let i = 0; i < 4; i++) expect(Number.isFinite(d[i])).toBe(true);
  });

  it("Stereo: beide Channels werden unabhaengig gefiltert (kein Cross-Coupling)", () => {
    // Linker Channel: 50 Hz (sollte gedaempft werden)
    // Rechter Channel: DC 0.7
    const left: number[] = [];
    for (let i = 0; i < 2048; i++) left.push(Math.sin((2 * Math.PI * 50 * i) / SR));
    const right = new Array(2048).fill(0.7);
    const buf = makeStereo(left, right);
    const out = applyHighPassBiquad(buf, { cutoffHz: 1000 });
    expect(out.numberOfChannels).toBe(2);
    // Rechter Channel war DC -> nach Settle nahe 0
    expect(rms(out.getChannelData(1), 1500)).toBeLessThan(1e-3);
    // Linker Channel: 50 Hz << 1000 Hz Cutoff -> stark gedaempft
    expect(rms(out.getChannelData(0), 1024)).toBeLessThan(0.1);
  });

  it("getChannelData out-of-range wirft RangeError", () => {
    const out = applyHighPassBiquad(makeBuffer([0.1, 0.2, 0.3]));
    expect(() => out.getChannelData(5)).toThrow(RangeError);
    expect(() => out.getChannelData(-1)).toThrow(RangeError);
  });

  it("cutoffHz NaN/undefined faellt auf Default zurueck (keine NaN-Propagation)", () => {
    const sine = makeSine(1024, 1000, SR);
    const outNaN = applyHighPassBiquad(sine, { cutoffHz: NaN });
    const outUndef = applyHighPassBiquad(sine, {});
    // Beide muessen identisch sein und finite bleiben
    const a = outNaN.getChannelData(0);
    const b = outUndef.getChannelData(0);
    for (let i = 0; i < 1024; i++) {
      expect(Number.isFinite(a[i])).toBe(true);
      expect(a[i]).toBeCloseTo(b[i], 6);
    }
  });

  it("cutoffHz >= Nyquist wird auf Nyquist/2 geclampt (stabil, finite)", () => {
    const sine = makeSine(1024, 1000, SR);
    const out = applyHighPassBiquad(sine, { cutoffHz: SR / 2 + 1000 });
    const d = out.getChannelData(0);
    for (let i = 0; i < 1024; i++) {
      expect(Number.isFinite(d[i])).toBe(true);
    }
  });
});

describe("v3.232 applyHighPassBiquad - Math Properties", () => {
  it("Linearitaet: HP(2*x) ~= 2*HP(x)", () => {
    const x = makeSine(2048, 1000, SR);
    const x2: number[] = [];
    for (let i = 0; i < 2048; i++) x2.push(x.getChannelData(0)[i] * 2);
    const ya = applyHighPassBiquad(x, { cutoffHz: 500 }).getChannelData(0);
    const yb = applyHighPassBiquad(makeBuffer(x2), { cutoffHz: 500 }).getChannelData(0);
    for (let i = 500; i < 1500; i++) {
      expect(yb[i]).toBeCloseTo(ya[i] * 2, 5);
    }
  });

  it("Stabilitaet: hohes Q produziert weiterhin finite-output und beschraenkten Peak", () => {
    const sine = makeSine(8192, 2000, SR);
    const out = applyHighPassBiquad(sine, { cutoffHz: 2000, q: 40 });
    const d = out.getChannelData(0);
    let allFinite = true;
    for (let i = 0; i < d.length; i++) {
      if (!Number.isFinite(d[i])) {
        allFinite = false;
        break;
      }
    }
    expect(allFinite).toBe(true);
    // Peak bei starker Resonanz darf gross sein, aber nicht explodieren
    expect(peak(d)).toBeLessThan(50);
  });

  it("Monotonic Roll-Off: tiefere Cutoff -> staerker passierende tiefe Frequenz", () => {
    // 200 Hz Test-Sine
    const sine = makeSine(4096, 200, SR);
    // Cutoff 100 Hz: 200 Hz ist eine Oktave drueber -> wenig Daempfung
    const lowCut = applyHighPassBiquad(sine, { cutoffHz: 100, q: DEFAULT_Q });
    // Cutoff 800 Hz: 200 Hz ist 2 Oktaven drunter -> starke Daempfung
    const highCut = applyHighPassBiquad(sine, { cutoffHz: 800, q: DEFAULT_Q });
    const rmsLowCut = rms(lowCut.getChannelData(0), 1024);
    const rmsHighCut = rms(highCut.getChannelData(0), 1024);
    expect(rmsLowCut).toBeGreaterThan(rmsHighCut);
  });

  it("hoeheres Q -> ausgepraegterer Resonanz-Peak bei Cutoff-Frequenz", () => {
    // Test-Sine genau bei Cutoff-Frequenz -> Peak-Resonanz sichtbar
    const sine = makeSine(8192, 1000, SR);
    const lowQ = applyHighPassBiquad(sine, { cutoffHz: 1000, q: 0.5 });
    const highQ = applyHighPassBiquad(sine, { cutoffHz: 1000, q: 6 });
    const rmsLow = rms(lowQ.getChannelData(0), 2048);
    const rmsHigh = rms(highQ.getChannelData(0), 2048);
    // Bei Cutoff-Frequenz sollte high-Q deutlich groessere Amplitude liefern
    expect(rmsHigh).toBeGreaterThan(rmsLow * 1.5);
  });

  it("Impulse-Response klingt ab (BIBO-Stabilitaet, kein unbounded growth)", () => {
    const impulse = new Array(4096).fill(0);
    impulse[0] = 1;
    const out = applyHighPassBiquad(makeBuffer(impulse), { cutoffHz: 500, q: DEFAULT_Q });
    const d = out.getChannelData(0);
    // Ende des Buffers sollte abklingen
    const tailPeak = peak(d, 3500);
    expect(tailPeak).toBeLessThan(1e-3);
  });
});

describe("v3.232 HIGHPASS_BIQUAD_PRESETS", () => {
  it("Presets sind alle anwendbar und liefern finite output", () => {
    const sine = makeSine(2048, 500, SR);
    for (const key of Object.keys(HIGHPASS_BIQUAD_PRESETS) as Array<
      keyof typeof HIGHPASS_BIQUAD_PRESETS
    >) {
      const preset = HIGHPASS_BIQUAD_PRESETS[key];
      const out = applyHighPassBiquad(sine, preset);
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
    // Butterworth ~ 0.707
    expect(DEFAULT_Q).toBeCloseTo(0.707, 2);
  });
});
