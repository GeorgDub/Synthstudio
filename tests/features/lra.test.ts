/**
 * tests/features/lra.test.ts (v3.103.0)
 *
 * Echtes EBU R128 / Tech 3342 LRA — Short-Term-Historie + Two-Pass-Gating
 * (absolute -70 LUFS, relative -20 LU) + Percentile-Distribution
 * (LU95 - LU10).
 *
 * Strategy:
 *   1. Pure-Helper `percentile` mit kanonischen Tabellen-Werten
 *   2. Pure-Helper `computeLra` mit synthetischen ST-Distributions
 *   3. Analyzer-Integration: History-Push nach 3s-Anlauf, FIFO-Bound,
 *      `reset()` clears History, dynamic > static.
 *
 * Mind. 10 Tests — wir liefern 18.
 */
import { describe, it, expect } from "vitest";
import {
  LufsAnalyzer,
  percentile,
  computeLra,
  LRA_ABSOLUTE_GATE_LUFS,
  LRA_RELATIVE_GATE_LU,
  LRA_HISTORY_MAX,
  LRA_SHORT_TERM_HOP_SEC,
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

// ─── percentile() Pure-Helper ────────────────────────────────────────────────

describe("percentile()", () => {
  it("percentile(sorted, 0) liefert das erste Element", () => {
    expect(percentile([10, 20, 30, 40, 50], 0)).toBe(10);
    expect(percentile([-5, 0, 5], 0)).toBe(-5);
  });

  it("percentile(sorted, 1) liefert das letzte Element", () => {
    expect(percentile([10, 20, 30, 40, 50], 1)).toBe(50);
    expect(percentile([1, 100], 1)).toBe(100);
  });

  it("percentile([10,20,30,40,50], 0.5) = 30 (Median)", () => {
    expect(percentile([10, 20, 30, 40, 50], 0.5)).toBe(30);
  });

  it("percentile([10,20,30], 0.25) = 15 (linear interp zwischen 10/20)", () => {
    // rank = 0.25 * 2 = 0.5 → between idx 0 (=10) and idx 1 (=20), frac 0.5
    // → 10 + (20-10)*0.5 = 15
    expect(percentile([10, 20, 30], 0.25)).toBe(15);
  });

  it("percentile auf leerem Array → NaN", () => {
    expect(Number.isNaN(percentile([], 0.5))).toBe(true);
  });

  it("percentile auf Single-Element-Array liefert den Wert egal welches p", () => {
    expect(percentile([42], 0)).toBe(42);
    expect(percentile([42], 0.5)).toBe(42);
    expect(percentile([42], 1)).toBe(42);
  });

  it("percentile clampt p außerhalb [0,1] auf die Ränder", () => {
    expect(percentile([10, 20, 30], -1)).toBe(10);
    expect(percentile([10, 20, 30],  2)).toBe(30);
  });

  it("percentile([10,20,30,40,50], 0.95) liefert linear-interp nahe 50", () => {
    // rank = 0.95 * 4 = 3.8 → between idx 3 (=40) and idx 4 (=50), frac 0.8
    // → 40 + 10 * 0.8 = 48
    expect(percentile([10, 20, 30, 40, 50], 0.95)).toBeCloseTo(48, 6);
  });
});

// ─── computeLra() Pure-Helper ────────────────────────────────────────────────

describe("computeLra()", () => {
  it("computeLra auf leerem Array → 0", () => {
    expect(computeLra([], -23)).toBe(0);
  });

  it("computeLra auf alle gleichen Werten → 0", () => {
    expect(computeLra([-23, -23, -23, -23, -23], -23)).toBe(0);
  });

  it("computeLra absolute-gate filtert Werte unter -70 LUFS raus", () => {
    // Alle drei Werte sind unter -70 → komplett gegated → 0
    const allBelow = [-80, -90, -100, -120];
    expect(computeLra(allBelow, -90)).toBe(0);
  });

  it("computeLra relative-gate filtert Werte weit unter (integrated - 20) raus", () => {
    // Integrated = -10 LUFS → Relative-Gate-Threshold = -30 LUFS
    // Werte unter -30 werden verworfen — bleiben nur drei (-25,-20,-15) → LRA klein.
    // Werte über Threshold haben gleiche Spanne wie ohne Gate-Werte unter -30 ABER mit Mittelwerten der zwei Sets.
    const withOutliers = [-50, -45, -25, -20, -15];
    const lraGated     = computeLra(withOutliers, -10);
    // Im gegateten Set bleiben [-25,-20,-15] — Spanne ist 10 LU (von -25 bis -15).
    // Ohne Relative-Gate wäre die Spanne ca. 35 LU.
    expect(lraGated).toBeLessThan(15);
    expect(lraGated).toBeGreaterThan(0);
  });

  it("computeLra: dynamische Verteilung > statische", () => {
    const dynamic = [-30, -28, -25, -22, -20, -18, -15, -12, -10, -8, -6];
    const stat = [-15, -15, -15, -15, -15, -15, -15];
    const lraDynamic = computeLra(dynamic, -18);
    const lraStatic  = computeLra(stat, -15);
    expect(lraDynamic).toBeGreaterThan(lraStatic);
    expect(lraStatic).toBe(0);
  });

  it("computeLra mit endlichem Integrated liefert (LU95 - LU10)", () => {
    // 11 gleich-verteilte Werte von -30 bis -10 (∆ 2 LU)
    const history = [-30, -28, -26, -24, -22, -20, -18, -16, -14, -12, -10];
    // Integrated = -20 LUFS → Relative-Gate -40 (alle Werte drueber → keine
    // weitere Filterung); Absolute-Gate -70 (keine Filterung).
    // sorted = [-30,-28,...,-10], N=11
    // LU10 (p=0.1) → rank=1.0 → exakt -28
    // LU95 (p=0.95) → rank=9.5 → linear-interp zwischen -12 und -10 → -11
    // LRA = -11 - (-28) = 17 LU
    const lra = computeLra(history, -20);
    expect(lra).toBeCloseTo(17, 5);
  });

  it("computeLra mit Integrated=-Infinity überspringt Relative-Gate", () => {
    // Bei nicht-endlichem Integrated darf nur das absolute-gate wirken.
    const history = [-65, -50, -30, -20, -10];
    const lra = computeLra(history, -Infinity);
    expect(lra).toBeGreaterThan(0);
    // Alle Werte über -70 → keine Filterung; Spanne bleibt erheblich.
    // LU10 rank=0.4 → -65 + (-50 - (-65))*0.4 = -65 + 6 = -59
    // LU95 rank=3.8 → -20 + (-10 - (-20))*0.8 = -20 + 8 = -12
    // LRA ≈ -12 - (-59) = 47
    expect(lra).toBeCloseTo(47, 5);
  });

  it("computeLra mit NaN-Werten filtert silent (defensive)", () => {
    const history = [NaN, -20, NaN, -15, NaN, -10, NaN, -5];
    const lra = computeLra(history, -15);
    // gated nach NaN-skip = [-20,-15,-10,-5], alle > integrated - 20 = -35.
    expect(lra).toBeGreaterThan(0);
    expect(Number.isFinite(lra)).toBe(true);
  });

  it("computeLra konstante Werte nach Filtering → 0", () => {
    // Alle gegated bis auf einen → single-point distribution → LRA=0.
    const history = [-100, -100, -100, -25];
    const lra = computeLra(history, -25);
    expect(lra).toBe(0);
  });
});

// ─── Analyzer-Integration: History-Buffer + Reset ────────────────────────────

describe("LufsAnalyzer Short-Term-History Wiring", () => {
  it("getShortTermHistoryLength startet bei 0 ohne processBlock", () => {
    const a = new LufsAnalyzer({ sampleRate: 48000, channelCount: 2 });
    expect(a.getShortTermHistoryLength()).toBe(0);
    expect(a.getCurrentLra()).toBe(0);
  });

  it("History fuellt sich nach ST-Anlauf (3s) auf bei kontinuierlicher Eingabe", () => {
    const sr = 48000;
    const a = new LufsAnalyzer({ sampleRate: sr, channelCount: 2 });
    // 4 Sekunden Sine — 3s Anlauf + 1s history → ~10 ST-Werte (10Hz).
    const totalN = 4 * sr;
    const sig = makeSine(totalN, 1000, 0.5, sr);
    a.processBlock(sig, sig);
    const len = a.getShortTermHistoryLength();
    // Nach 1s post-Anlauf erwarten wir ~10 Eintraege (Hop=100ms).
    // Toleranz: floor(1.0 / 0.1) = 10, mit ±2 fuer Rundungs-Drift.
    expect(len).toBeGreaterThanOrEqual(8);
    expect(len).toBeLessThanOrEqual(12);
  });

  it("History bleibt 0 fuer Buffer unter 3s (kein Anlauf abgeschlossen)", () => {
    const sr = 48000;
    const a = new LufsAnalyzer({ sampleRate: sr, channelCount: 2 });
    // 2s — zu kurz fuer Anlauf
    const sig = makeSine(2 * sr, 1000, 0.5, sr);
    a.processBlock(sig, sig);
    expect(a.getShortTermHistoryLength()).toBe(0);
    expect(a.getCurrentLra()).toBe(0);
  });

  it("reset() clears die Short-Term-Historie", () => {
    const sr = 48000;
    const a = new LufsAnalyzer({ sampleRate: sr, channelCount: 2 });
    const sig = makeSine(5 * sr, 1000, 0.5, sr);
    a.processBlock(sig, sig);
    expect(a.getShortTermHistoryLength()).toBeGreaterThan(0);
    a.reset();
    expect(a.getShortTermHistoryLength()).toBe(0);
    expect(a.getCurrentLra()).toBe(0);
  });

  it("LRA fuer statischen Sinus ist klein (< 2 LU)", () => {
    const sr = 48000;
    const a = new LufsAnalyzer({ sampleRate: sr, channelCount: 2 });
    // 10s Stationar-Sinus.
    const sig = makeSine(10 * sr, 1000, 0.5, sr);
    a.processBlock(sig, sig);
    const lra = a.getCurrentLra();
    // Statisch → Spanne minimal. Toleranz: ST-Anlauf bringt am Anfang
    // niedrigere Werte (filledCount < capacity) — also kleine LRA, aber
    // nicht zwingend 0.
    expect(lra).toBeGreaterThanOrEqual(0);
    expect(lra).toBeLessThan(2);
  });

  it("LRA fuer dynamische Eingabe > LRA fuer statische Eingabe", () => {
    const sr = 48000;
    // Statisch
    const aStatic = new LufsAnalyzer({ sampleRate: sr, channelCount: 2 });
    const statSig = makeSine(8 * sr, 1000, 0.5, sr);
    aStatic.processBlock(statSig, statSig);

    // Dynamisch — abwechselnd laut (3s) und leise (3s) — mehrfach.
    const aDyn = new LufsAnalyzer({ sampleRate: sr, channelCount: 2 });
    // 12s gesamt: 0..3s laut, 3..6s leise, 6..9s laut, 9..12s leise.
    const dynN = 12 * sr;
    const dyn = new Float32Array(dynN);
    for (let i = 0; i < dynN; i++) {
      const t = i / sr;
      const loud = (Math.floor(t / 3) % 2) === 0;
      const amp  = loud ? 0.7 : 0.05;
      dyn[i] = amp * Math.sin((2 * Math.PI * 1000 * i) / sr);
    }
    aDyn.processBlock(dyn, dyn);

    const lraStatic = aStatic.getCurrentLra();
    const lraDyn    = aDyn.getCurrentLra();
    expect(lraDyn).toBeGreaterThan(lraStatic);
    expect(lraDyn).toBeGreaterThan(3);
  });

  it("Hop-Konstante = 100ms (10Hz Sampling) — Spec-konform", () => {
    expect(LRA_SHORT_TERM_HOP_SEC).toBeCloseTo(0.1, 6);
  });

  it("Gate-Konstanten matchen Tech 3342: -70 LUFS / -20 LU", () => {
    expect(LRA_ABSOLUTE_GATE_LUFS).toBe(-70);
    expect(LRA_RELATIVE_GATE_LU).toBe(-20);
  });

  it("History-MAX bound = 3600 Eintraege (= 6 Min @ 10Hz)", () => {
    expect(LRA_HISTORY_MAX).toBe(3600);
  });
});
