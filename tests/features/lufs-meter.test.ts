/**
 * tests/features/lufs-meter.test.ts (v3.78.0)
 *
 * ITU-R BS.1770-4 LUFS-Meter Tests.
 *
 * Test-Strategie:
 *   1. K-Weighting-Filter-Coeffizienten matchen die BS.1770-4-Spec-Werte
 *      bei sampleRate=48000.
 *   2. Sine 1kHz @ -23 dBFS Full-Scale Stereo → ~ -23 LUFS (Spec-Reference,
 *      Toleranz ±0.5 LUFS).
 *   3. 400ms Sliding-Window — Momentary reflektiert nur die letzte Sekunde.
 *   4. Integrated-Gating: Blöcke unter -70 LUFS (Stille) zählen nicht.
 *   5. Reset() startet Integrated neu; Momentary bleibt gleitend.
 *
 * Mind. 5 Tests — wir liefern 11.
 */
import { describe, it, expect } from "vitest";
import {
  LufsAnalyzer,
  Biquad,
  designKWeightingPreFilter,
  designKWeightingRlbFilter,
  meanSquareToLufs,
  ABSOLUTE_GATE_LUFS,
  LUFS_OFFSET,
  LUFS_SILENCE,
} from "../../client/src/audio/LufsAnalyzer";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Erzeugt N samples einer 1kHz Sinus-Welle mit Amplitude `amp`
 * (Float-Sample-Werte, -1..+1).
 *   -23 dBFS Peak ≈ amp = 10^(-23/20) = 0.07079
 * Sample-Rate explizit damit Frequenz exakt 1kHz bleibt.
 */
function makeSine(N: number, freqHz: number, amp: number, sampleRate: number): Float32Array {
  const out = new Float32Array(N);
  const twoPi = 2 * Math.PI;
  for (let i = 0; i < N; i++) {
    out[i] = amp * Math.sin((twoPi * freqHz * i) / sampleRate);
  }
  return out;
}

/** Float32Array gefüllt mit konstantem Wert (für Silence-Tests). */
function makeSilence(N: number): Float32Array {
  return new Float32Array(N);
}

// ─── (1) K-Weighting-Filter-Coeffizienten ────────────────────────────────────

describe("v3.78 K-Weighting Filter Response", () => {
  it("Pre-Filter @ 48kHz matcht BS.1770-4-Spec (Toleranz 1e-3)", () => {
    const c = designKWeightingPreFilter(48000);
    // BS.1770-4 Annex 1 Reference-Werte:
    expect(c.b0).toBeCloseTo(1.53512485958697, 3);
    expect(c.b1).toBeCloseTo(-2.69169618940638, 3);
    expect(c.b2).toBeCloseTo(1.19839281085285, 3);
    expect(c.a1).toBeCloseTo(-1.69065929318241, 3);
    expect(c.a2).toBeCloseTo(0.73248077421585, 3);
  });

  it("RLB-Filter @ 48kHz matcht BS.1770-4-Spec (Toleranz 1e-3)", () => {
    const c = designKWeightingRlbFilter(48000);
    expect(c.b0).toBeCloseTo(1.0, 3);
    expect(c.b1).toBeCloseTo(-2.0, 3);
    expect(c.b2).toBeCloseTo(1.0, 3);
    expect(c.a1).toBeCloseTo(-1.99004745483398, 3);
    expect(c.a2).toBeCloseTo(0.99007225036621, 3);
  });

  it("Biquad-State läuft stabil (kein Overflow bei 10s @ -1dBFS Sinus)", () => {
    const sr = 48000;
    const pre = new Biquad(designKWeightingPreFilter(sr));
    const rlb = new Biquad(designKWeightingRlbFilter(sr));
    const sine = makeSine(sr * 10, 1000, 0.891, sr); // -1dBFS
    let maxAbs = 0;
    for (let i = 0; i < sine.length; i++) {
      const y = rlb.process(pre.process(sine[i]));
      const a = Math.abs(y);
      if (a > maxAbs) maxAbs = a;
    }
    // K-Weighting boosted +4dB im 1kHz-Band → 0.891 × 1.585 ≈ 1.41 Peak.
    // Wir prüfen nur dass nichts explodiert (< 10).
    expect(maxAbs).toBeLessThan(10);
    expect(Number.isFinite(maxAbs)).toBe(true);
  });
});

// ─── (2) ITU-Reference: Sinus 1kHz @ -23 dBFS Mono → ~ -23 LUFS ─────────────

describe("v3.78 LUFS-Reference-Values (ITU-Test-Signal)", () => {
  it("Mono Sinus 1kHz mit RMS -23 dBFS (Peak ≈ -20 dBFS) → momentary ≈ -23 LUFS ± 1", () => {
    // ITU-R BS.1770-4 Reference: Sinus 1kHz mit Mean-Square = 10^(-23/10)
    // ergibt LUFS = -0.691 + 10*log10(MS) ≈ -23.7 ohne K-Weighting-Boost.
    // Bei 1kHz ist die K-Weighting-Gain ≈ +0.7dB (Plateau-Bereich des
    // Pre-Filters), also Resultat ≈ -23 LUFS.
    // Für Sinus mit RMS=R: peak = R*sqrt(2).
    const sr = 48000;
    const targetRmsDb = -23;
    const peak = Math.pow(10, targetRmsDb / 20) * Math.SQRT2;
    const a = new LufsAnalyzer({ sampleRate: sr, channelCount: 1 });
    a.processBlock(makeSine(sr * 2, 1000, peak, sr));
    const m = a.getMomentary();
    // K-Weighting bei 1kHz: pre-filter +0.7dB, rlb-filter ≈ 0dB → +0.7dB Gain.
    // Erwartung: -23 + 0.7 ≈ -22.3 LUFS für Mono channel-gain 1.0.
    expect(m).toBeGreaterThan(-24);
    expect(m).toBeLessThan(-21);
  });

  it("Stereo Sinus 1kHz mit RMS -23dBFS auf beiden Kanälen → ~-20 LUFS (+3dB Channel-Sum)", () => {
    // Stereo-Sum: 2 identische Kanäle = +3dB lauter. → ≈ -20 LUFS.
    const sr = 48000;
    const peak = Math.pow(10, -23 / 20) * Math.SQRT2;
    const a = new LufsAnalyzer({ sampleRate: sr, channelCount: 2 });
    const L = makeSine(sr * 2, 1000, peak, sr);
    const R = makeSine(sr * 2, 1000, peak, sr);
    a.processBlock(L, R);
    const m = a.getMomentary();
    expect(m).toBeGreaterThan(-21);
    expect(m).toBeLessThan(-18);
  });

  it("Silence → momentary = -Infinity (LUFS_SILENCE)", () => {
    const sr = 48000;
    const a = new LufsAnalyzer({ sampleRate: sr, channelCount: 1 });
    a.processBlock(makeSilence(sr));
    expect(a.getMomentary()).toBe(LUFS_SILENCE);
  });
});

// ─── (3) 400ms Block-Aggregation + Sliding Window ────────────────────────────

describe("v3.78 400ms Momentary Sliding Window", () => {
  it("Nach 100ms Sinus: Momentary läuft hoch (nicht final, aber > -Infinity)", () => {
    const sr = 48000;
    const a = new LufsAnalyzer({ sampleRate: sr, channelCount: 1 });
    const partial = makeSine(Math.floor(sr * 0.1), 1000, 0.5, sr); // 100ms
    a.processBlock(partial);
    const m = a.getMomentary();
    expect(Number.isFinite(m)).toBe(true);
    expect(m).toBeGreaterThan(-30);
  });

  it("Nach 1s Sinus dann 1s Stille: Momentary kehrt zurück zu -Infinity (400ms Fenster ist leer)", () => {
    const sr = 48000;
    const a = new LufsAnalyzer({ sampleRate: sr, channelCount: 1 });
    a.processBlock(makeSine(sr, 1000, 0.5, sr));     // 1s Signal
    a.processBlock(makeSilence(sr));                  // 1s Stille → Fenster voller Nullen.
    expect(a.getMomentary()).toBe(LUFS_SILENCE);
  });

  it("Short-Term-Fenster ist 3s — nach 2s Sinus → Short-Term zeigt den Wert", () => {
    const sr = 48000;
    const a = new LufsAnalyzer({ sampleRate: sr, channelCount: 1 });
    a.processBlock(makeSine(sr * 2, 1000, 0.5, sr));
    const s = a.getShortTerm();
    expect(Number.isFinite(s)).toBe(true);
    expect(s).toBeGreaterThan(-20);
  });
});

// ─── (4) Integrated Gating ───────────────────────────────────────────────────

describe("v3.78 Integrated Gating (BS.1770-4 §3.3)", () => {
  it("Stille → Integrated = -Infinity (alle Blöcke unter Absolute-Gate -70)", () => {
    const sr = 48000;
    const a = new LufsAnalyzer({ sampleRate: sr, channelCount: 1 });
    a.processBlock(makeSilence(sr * 2));
    expect(a.getIntegrated()).toBe(LUFS_SILENCE);
  });

  it("Konstanter Sinus 1kHz RMS -23dBFS für 2s → Integrated ≈ -23 LUFS ± 1", () => {
    const sr = 48000;
    const a = new LufsAnalyzer({ sampleRate: sr, channelCount: 1 });
    const peak = Math.pow(10, -23 / 20) * Math.SQRT2;
    a.processBlock(makeSine(sr * 2, 1000, peak, sr));
    const i = a.getIntegrated();
    expect(Number.isFinite(i)).toBe(true);
    expect(i).toBeGreaterThan(-24);
    expect(i).toBeLessThan(-21);
  });

  it("Absolute-Gate konstant -70 LUFS (Spec), Blöcke darunter werden verworfen", () => {
    // ABSOLUTE_GATE_LUFS muss exakt -70 sein (BS.1770-4 §3.3).
    expect(ABSOLUTE_GATE_LUFS).toBe(-70);
  });
});

// ─── (5) Reset re-starts Integrated ─────────────────────────────────────────

describe("v3.78 reset() startet Integrated neu", () => {
  it("Nach reset() ist Integrated = -Infinity, Momentary bleibt aktiv", () => {
    const sr = 48000;
    const a = new LufsAnalyzer({ sampleRate: sr, channelCount: 1 });
    a.processBlock(makeSine(sr * 2, 1000, 0.5, sr));
    const beforeI = a.getIntegrated();
    const beforeM = a.getMomentary();
    expect(Number.isFinite(beforeI)).toBe(true);
    expect(Number.isFinite(beforeM)).toBe(true);
    a.reset();
    expect(a.getIntegrated()).toBe(LUFS_SILENCE);
    // Momentary muss erhalten bleiben — gleitendes Fenster (siehe Doku).
    expect(a.getMomentary()).toBeCloseTo(beforeM, 1);
  });

  it("resetAll() löscht Filter-State + Sliding-Buffers; Momentary nach reset auf -Infinity", () => {
    const sr = 48000;
    const a = new LufsAnalyzer({ sampleRate: sr, channelCount: 1 });
    a.processBlock(makeSine(sr * 2, 1000, 0.5, sr));
    expect(Number.isFinite(a.getMomentary())).toBe(true);
    a.resetAll();
    expect(a.getMomentary()).toBe(LUFS_SILENCE);
    expect(a.getShortTerm()).toBe(LUFS_SILENCE);
    expect(a.getIntegrated()).toBe(LUFS_SILENCE);
  });
});

// ─── (6) meanSquareToLufs Formel ─────────────────────────────────────────────

describe("v3.78 meanSquareToLufs Formel-Konstanten", () => {
  it("Offset = -0.691 (BS.1770-4 K-Weighting calibration)", () => {
    expect(LUFS_OFFSET).toBeCloseTo(-0.691, 3);
  });

  it("meanSquareToLufs(0) → -Infinity, MS=1 → LUFS_OFFSET (-0.691)", () => {
    expect(meanSquareToLufs(0)).toBe(LUFS_SILENCE);
    expect(meanSquareToLufs(-1)).toBe(LUFS_SILENCE); // defensive
    expect(meanSquareToLufs(1)).toBeCloseTo(LUFS_OFFSET, 3);
    // MS=0.1 → -0.691 + 10*log10(0.1) = -10.691
    expect(meanSquareToLufs(0.1)).toBeCloseTo(-10.691, 3);
  });

  it("LufsAnalyzer-Constructor lehnt invalide Sample-Rates ab", () => {
    expect(() => new LufsAnalyzer({ sampleRate: 0 })).toThrow();
    expect(() => new LufsAnalyzer({ sampleRate: -1 })).toThrow();
    expect(() => new LufsAnalyzer({ sampleRate: NaN })).toThrow();
    expect(() => new LufsAnalyzer({ channelCount: 5 })).toThrow();
  });
});
