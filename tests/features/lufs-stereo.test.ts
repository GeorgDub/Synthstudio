/**
 * tests/features/lufs-stereo.test.ts (v3.101.0)
 *
 * Schliesst v3.78-Caveat: K-Weighting separat pro Kanal (true stereo)
 * + Phase-Correlation-Meter + L/R-Imbalance-Detection.
 *
 * BS.1770-4 Stereo-Loudness:
 *   MS = (1/N) * Σ(L²_k + R²_k)   (Kanal-Gewicht 1.0 fuer L+R)
 *   lufs = -0.691 + 10 * log10(MS)
 *
 * Mind. 8 Tests — wir liefern 15.
 */
import { describe, it, expect } from "vitest";
import {
  LufsAnalyzer,
  LUFS_SILENCE,
  analyzeStereo,
  analyzeFromBuffer,
  phaseCorrelation,
  lrImbalanceDb,
  isPhaseCorrelationRisky,
  lrImbalanceForDisplay,
  type AudioBufferLike,
} from "../../client/src/audio/LufsAnalyzer";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSine(N: number, freqHz: number, amp: number, sampleRate: number): Float32Array {
  const out = new Float32Array(N);
  const twoPi = 2 * Math.PI;
  for (let i = 0; i < N; i++) {
    out[i] = amp * Math.sin((twoPi * freqHz * i) / sampleRate);
  }
  return out;
}

/** Reproduzierbares Pseudo-Rauschen (Mulberry32). */
function makeNoise(N: number, amp: number, seed: number): Float32Array {
  let s = seed >>> 0;
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296; // 0..1
    out[i] = (r * 2 - 1) * amp;
  }
  return out;
}

/** Inverted Copy (out-of-phase). */
function invertedCopy(src: Float32Array): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = -src[i];
  return out;
}

/** Skalierte Kopie (linear gain). */
function scaledCopy(src: Float32Array, factor: number): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = src[i] * factor;
  return out;
}

// ─── (1) True-Stereo K-Weighting ─────────────────────────────────────────────

describe("v3.101 LufsAnalyzer — true stereo K-weighting", () => {
  it("Identical L+R yields identical channel-summed result as Stereo-Engine", () => {
    // BS.1770-4 sum = msL + msR mit identischen Signalen → 2*ms_single.
    // LUFS_stereo = lufs_mono + 10*log10(2) ≈ lufs_mono + 3.0103.
    const sr = 48000;
    const peak = Math.pow(10, -23 / 20) * Math.SQRT2;
    const sig = makeSine(sr * 2, 1000, peak, sr);

    const mono = new LufsAnalyzer({ sampleRate: sr, channelCount: 1 });
    mono.processBlock(sig);
    const monoLufs = mono.getMomentary();

    const stereo = new LufsAnalyzer({ sampleRate: sr, channelCount: 2 });
    stereo.processBlock(sig, sig); // L = R (identisch)
    const stereoLufs = stereo.getMomentary();

    // Stereo soll exakt +3dB ueber Mono liegen (Channel-Sum).
    expect(stereoLufs - monoLufs).toBeCloseTo(10 * Math.log10(2), 1);
  });

  it("Different L+R weights correctly — R 6dB louder than L", () => {
    // RMS-Test: L bei -23dBFS, R bei -17dBFS.
    // ms_R = 4 * ms_L  → summed_ms = 5 * ms_L.
    // Stereo-LUFS vs nur-L-LUFS = 10*log10(5) ≈ +6.99dB.
    const sr = 48000;
    const peakL = Math.pow(10, -23 / 20) * Math.SQRT2;
    const peakR = Math.pow(10, -17 / 20) * Math.SQRT2;
    const L = makeSine(sr * 2, 1000, peakL, sr);
    const R = makeSine(sr * 2, 1000, peakR, sr);

    const a = new LufsAnalyzer({ sampleRate: sr, channelCount: 2 });
    a.processBlock(L, R);
    const stereo = a.getMomentaryStereo();
    // R muss 6dB lauter als L sein (innerhalb K-weighting-Toleranz).
    expect(stereo.R - stereo.L).toBeCloseTo(6, 0);
    // Sum > beide einzeln.
    expect(stereo.sum).toBeGreaterThan(stereo.L);
    expect(stereo.sum).toBeGreaterThan(stereo.R);
  });

  it("getMomentaryStereo: mono analyzer returns L==R==sum", () => {
    const sr = 48000;
    const sig = makeSine(sr, 1000, 0.5, sr);
    const a = new LufsAnalyzer({ sampleRate: sr, channelCount: 1 });
    a.processBlock(sig);
    const s = a.getMomentaryStereo();
    expect(s.L).toBe(s.R);
    expect(s.L).toBe(s.sum);
  });

  it("processBlock(L) without R on stereo-analyzer spiegelt L auf R (mono-equivalent)", () => {
    const sr = 48000;
    const sig = makeSine(sr, 1000, 0.4, sr);
    const a = new LufsAnalyzer({ sampleRate: sr, channelCount: 2 });
    // R weggelassen → L wird intern als R verwendet.
    a.processBlock(sig);
    const s = a.getMomentaryStereo();
    // L und R sollen identisch sein.
    expect(s.L).toBeCloseTo(s.R, 5);
  });
});

// ─── (2) Phase-Correlation ───────────────────────────────────────────────────

describe("v3.101 phaseCorrelation — Pearson r in [-1..+1]", () => {
  it("Identische Signale → +1 (perfectly correlated)", () => {
    const sig = makeSine(2048, 1000, 0.5, 48000);
    const r = phaseCorrelation(sig, sig);
    expect(r).toBeCloseTo(1, 4);
  });

  it("Invertierte Signale → -1 (out-of-phase)", () => {
    const sig = makeSine(2048, 1000, 0.5, 48000);
    const inv = invertedCopy(sig);
    const r = phaseCorrelation(sig, inv);
    expect(r).toBeCloseTo(-1, 4);
  });

  it("Uncorrelated Noise → ~0 (Toleranz 0.15 fuer N=4096)", () => {
    const L = makeNoise(4096, 0.5, 12345);
    const R = makeNoise(4096, 0.5, 67890);
    const r = phaseCorrelation(L, R);
    expect(Math.abs(r)).toBeLessThan(0.15);
  });

  it("Scaled Copy (gleiche Phase, andere Lautstaerke) → +1 (Korrelation skalenunabhaengig)", () => {
    const L = makeSine(2048, 1000, 0.5, 48000);
    const R = scaledCopy(L, 0.3); // R ist 0.3x leiser, aber gleiche Phase
    const r = phaseCorrelation(L, R);
    expect(r).toBeCloseTo(1, 4);
  });

  it("L/R length mismatch throws", () => {
    const L = new Float32Array(100);
    const R = new Float32Array(50);
    expect(() => phaseCorrelation(L, R)).toThrow(/length mismatch/);
  });

  it("isPhaseCorrelationRisky: < -0.2 = true, sonst false", () => {
    expect(isPhaseCorrelationRisky(-0.5)).toBe(true);
    expect(isPhaseCorrelationRisky(-0.1)).toBe(false);
    expect(isPhaseCorrelationRisky(0.5)).toBe(false);
    expect(isPhaseCorrelationRisky(NaN)).toBe(false);
  });
});

// ─── (3) L/R Imbalance ───────────────────────────────────────────────────────

describe("v3.101 lrImbalanceDb — RMS-Differenz in dB", () => {
  it("Equal L+R → 0 dB (balanced)", () => {
    const sig = makeSine(2048, 1000, 0.5, 48000);
    const db = lrImbalanceDb(sig, sig);
    expect(Math.abs(db)).toBeLessThan(0.01);
  });

  it("R 6dB lauter → +6 dB (positiv = rechts)", () => {
    const L = makeSine(2048, 1000, 0.5, 48000);
    const R = scaledCopy(L, 2.0); // +6dB Linear = factor 2
    const db = lrImbalanceDb(L, R);
    expect(db).toBeCloseTo(6, 1);
  });

  it("L 6dB lauter → -6 dB (negativ = links)", () => {
    const L = makeSine(2048, 1000, 0.5, 48000);
    const R = scaledCopy(L, 0.5); // -6dB
    const db = lrImbalanceDb(L, R);
    expect(db).toBeCloseTo(-6, 1);
  });

  it("L silent → +Infinity (rechts unendlich lauter)", () => {
    const L = new Float32Array(2048); // silence
    const R = makeSine(2048, 1000, 0.5, 48000);
    expect(lrImbalanceDb(L, R)).toBe(Infinity);
  });

  it("R silent → -Infinity (links unendlich lauter)", () => {
    const L = makeSine(2048, 1000, 0.5, 48000);
    const R = new Float32Array(2048);
    expect(lrImbalanceDb(L, R)).toBe(-Infinity);
  });

  it("Beide silent → 0 (kein NaN)", () => {
    expect(lrImbalanceDb(new Float32Array(100), new Float32Array(100))).toBe(0);
  });

  it("Length mismatch throws", () => {
    expect(() => lrImbalanceDb(new Float32Array(100), new Float32Array(50)))
      .toThrow(/length mismatch/);
  });

  it("lrImbalanceForDisplay clamped auf maxAbsDb (default 12)", () => {
    expect(lrImbalanceForDisplay(15)).toBe(12);
    expect(lrImbalanceForDisplay(-99)).toBe(-12);
    expect(lrImbalanceForDisplay(3.4)).toBe(3.4);
    expect(lrImbalanceForDisplay(Infinity)).toBe(12);
    expect(lrImbalanceForDisplay(-Infinity)).toBe(-12);
  });
});

// ─── (4) analyzeStereo + analyzeFromBuffer ───────────────────────────────────

describe("v3.101 analyzeStereo offline-Convenience", () => {
  it("analyzeStereo: identisches L/R-Signal liefert finite Werte", () => {
    const sr = 48000;
    const peak = Math.pow(10, -23 / 20) * Math.SQRT2;
    const L = makeSine(sr, 1000, peak, sr);
    const result = analyzeStereo(L, L, sr);
    expect(Number.isFinite(result.momentary)).toBe(true);
    expect(Number.isFinite(result.shortTerm)).toBe(true);
    expect(result.channels.L).toBe(result.channels.R);
  });

  it("analyzeStereo mit L/R length mismatch throws", () => {
    const L = new Float32Array(100);
    const R = new Float32Array(50);
    expect(() => analyzeStereo(L, R, 48000)).toThrow(/length mismatch/);
  });

  it("analyzeStereo backward-compat: nur left → mono-equivalent", () => {
    const sr = 48000;
    const L = makeSine(sr, 1000, 0.4, sr);
    const result = analyzeStereo(L, undefined, sr);
    // L wird intern als R gespiegelt → channels.L == channels.R.
    expect(result.channels.L).toBeCloseTo(result.channels.R, 5);
  });

  it("analyzeFromBuffer: Stereo-AudioBufferLike", () => {
    const sr = 48000;
    const L = makeSine(sr, 1000, 0.4, sr);
    const R = makeSine(sr, 1000, 0.4, sr);
    const buf: AudioBufferLike = {
      numberOfChannels: 2,
      sampleRate:       sr,
      getChannelData:   (i: number) => (i === 0 ? L : R),
    };
    const result = analyzeFromBuffer(buf);
    expect(Number.isFinite(result.momentary)).toBe(true);
    expect(result.channels.L).toBeCloseTo(result.channels.R, 3);
  });

  it("analyzeFromBuffer: Mono-AudioBufferLike (channels=1)", () => {
    const sr = 48000;
    const L = makeSine(sr, 1000, 0.4, sr);
    const buf: AudioBufferLike = {
      numberOfChannels: 1,
      sampleRate:       sr,
      getChannelData:   (_i: number) => L,
    };
    const result = analyzeFromBuffer(buf);
    expect(Number.isFinite(result.momentary)).toBe(true);
    // Mono auf channelCount=2-Analyzer → L wird auf R gespiegelt.
    expect(result.channels.L).toBeCloseTo(result.channels.R, 3);
  });

  it("analyzeFromBuffer: ungueltiger Buffer → throw", () => {
    expect(() => analyzeFromBuffer(null as unknown as AudioBufferLike)).toThrow();
    expect(() => analyzeFromBuffer({} as AudioBufferLike)).toThrow();
    const badSr: AudioBufferLike = {
      numberOfChannels: 1,
      sampleRate:       0,
      getChannelData:   () => new Float32Array(10),
    };
    expect(() => analyzeFromBuffer(badSr)).toThrow(/invalid sampleRate/);
    const noCh: AudioBufferLike = {
      numberOfChannels: 0,
      sampleRate:       48000,
      getChannelData:   () => new Float32Array(10),
    };
    expect(() => analyzeFromBuffer(noCh)).toThrow(/>=1 channel/);
  });
});

// ─── (5) Backwards-Compat ────────────────────────────────────────────────────

describe("v3.101 backwards-compat: mono input still works", () => {
  it("v3.78-API unveraendert: getMomentary/Short/Integrated bei mono-Analyzer", () => {
    const sr = 48000;
    const a = new LufsAnalyzer({ sampleRate: sr, channelCount: 1 });
    const sig = makeSine(sr * 2, 1000, 0.5, sr);
    a.processBlock(sig);
    expect(Number.isFinite(a.getMomentary())).toBe(true);
    expect(Number.isFinite(a.getShortTerm())).toBe(true);
    expect(Number.isFinite(a.getIntegrated())).toBe(true);
  });

  it("Silence weiterhin LUFS_SILENCE in beiden API-Varianten", () => {
    const sr = 48000;
    const a = new LufsAnalyzer({ sampleRate: sr, channelCount: 2 });
    a.processBlock(new Float32Array(sr), new Float32Array(sr));
    expect(a.getMomentary()).toBe(LUFS_SILENCE);
    const s = a.getMomentaryStereo();
    expect(s.L).toBe(LUFS_SILENCE);
    expect(s.R).toBe(LUFS_SILENCE);
    expect(s.sum).toBe(LUFS_SILENCE);
  });
});
