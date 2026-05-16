/**
 * Synthstudio – timeStretch Tests (v2.56)
 *
 * Pure-Funktion-Coverage für die bisher untestete utils/timeStretch.ts.
 * Mathematik: stretchRatio + playbackRate-Inversion + detune-Kompensation.
 */
import { describe, it, expect } from "vitest";
import {
  STRETCH_MIN,
  STRETCH_MAX,
  STRETCH_PRESETS,
  computeStretch,
  applyStretch,
  formatStretch,
  stretchFromBpm,
} from "../../client/src/utils/timeStretch";

describe("computeStretch — Mathematik", () => {
  it("ratio=1.0 ist Identity: playbackRate=1, detune=0, effectiveDuration=original", () => {
    const r = computeStretch(1.0, 2.0);
    expect(r.stretchRatio).toBe(1);
    expect(r.playbackRate).toBe(1);
    // -log2(1) ist mathematisch 0, JS liefert aber -0 — beides ist semantisch korrekt.
    expect(r.detune).toBeCloseTo(0, 10);
    expect(r.effectiveDuration).toBe(2);
  });

  it("ratio=2.0: doppelt so lang, halbe playbackRate, detune+1200 (eine Oktave)", () => {
    const r = computeStretch(2.0, 1.0);
    expect(r.stretchRatio).toBe(2);
    expect(r.playbackRate).toBeCloseTo(0.5, 6);
    expect(r.detune).toBeCloseTo(1200, 1);
    expect(r.effectiveDuration).toBe(2);
  });

  it("ratio=0.5: halb so lang, doppelte playbackRate, detune=-1200", () => {
    const r = computeStretch(0.5, 4.0);
    expect(r.stretchRatio).toBe(0.5);
    expect(r.playbackRate).toBeCloseTo(2.0, 6);
    expect(r.detune).toBeCloseTo(-1200, 1);
    expect(r.effectiveDuration).toBe(2);
  });

  it("ratio=1.5: 1.5× länger, detune ≈ +702 (Quint)", () => {
    const r = computeStretch(1.5, 1.0);
    // -log2(1/1.5) * 1200 = log2(1.5) * 1200 ≈ 701.96
    expect(r.detune).toBeCloseTo(701.96, 1);
  });
});

describe("computeStretch — Clamp + Edge-Cases", () => {
  it("Clamp: ratio < STRETCH_MIN wird auf MIN gesetzt", () => {
    const r = computeStretch(0.01, 1);
    expect(r.stretchRatio).toBe(STRETCH_MIN);
  });

  it("Clamp: ratio > STRETCH_MAX wird auf MAX gesetzt", () => {
    const r = computeStretch(100, 1);
    expect(r.stretchRatio).toBe(STRETCH_MAX);
  });

  it("Negative ratio wird ebenfalls auf MIN geclampt (kein NaN)", () => {
    const r = computeStretch(-5, 1);
    expect(r.stretchRatio).toBe(STRETCH_MIN);
    expect(Number.isFinite(r.playbackRate)).toBe(true);
  });

  it("originalDuration=0: effectiveDuration=0 (kein Crash)", () => {
    const r = computeStretch(1.5, 0);
    expect(r.effectiveDuration).toBe(0);
  });

  it("STRETCH_PRESETS sind ein Subset des erlaubten Bereichs", () => {
    for (const p of STRETCH_PRESETS) {
      expect(p).toBeGreaterThanOrEqual(STRETCH_MIN);
      expect(p).toBeLessThanOrEqual(STRETCH_MAX);
    }
  });
});

describe("applyStretch", () => {
  it("Setzt playbackRate.value + detune.value auf den AudioBufferSourceNode", () => {
    const src = {
      playbackRate: { value: 999 },
      detune: { value: 999 },
    } as unknown as AudioBufferSourceNode;
    applyStretch(src, {
      stretchRatio: 1.5,
      playbackRate: 0.667,
      detune: 700,
      effectiveDuration: 1.5,
    });
    expect(src.playbackRate.value).toBeCloseTo(0.667, 3);
    expect(src.detune.value).toBe(700);
  });
});

describe("formatStretch", () => {
  it("ratio=1 (±0.01-Toleranz) → '1× (Original)'", () => {
    expect(formatStretch(1)).toBe("1× (Original)");
    expect(formatStretch(1.005)).toBe("1× (Original)");
    expect(formatStretch(0.995)).toBe("1× (Original)");
  });

  it("ratio=1.5 → '1.50×'", () => {
    expect(formatStretch(1.5)).toBe("1.50×");
  });

  it("ratio=0.75 → '0.75×'", () => {
    expect(formatStretch(0.75)).toBe("0.75×");
  });

  it("Vier-Stellen-Ratio wird auf zwei Decimals gerundet", () => {
    expect(formatStretch(1.2345)).toBe("1.23×");
  });
});

describe("stretchFromBpm", () => {
  it("originalBpm=targetBpm → 1.0 (kein Stretch)", () => {
    expect(stretchFromBpm(120, 120)).toBe(1);
  });

  it("Ziel-BPM doppelt so hoch → stretch=0.5 (Sample doppelt so schnell)", () => {
    expect(stretchFromBpm(120, 240)).toBe(0.5);
  });

  it("Ziel-BPM halb so hoch → stretch=2 (Sample doppelt so lang)", () => {
    expect(stretchFromBpm(120, 60)).toBe(2);
  });

  it("originalBpm=0 → fallback 1 (kein Crash, Division-by-Zero geschützt)", () => {
    expect(stretchFromBpm(0, 120)).toBe(1);
  });

  it("targetBpm=0 → fallback 1", () => {
    expect(stretchFromBpm(120, 0)).toBe(1);
  });

  it("Negative BPM-Werte → fallback 1", () => {
    expect(stretchFromBpm(-120, 120)).toBe(1);
    expect(stretchFromBpm(120, -60)).toBe(1);
  });
});

describe("Round-Trip: computeStretch + stretchFromBpm", () => {
  it("Stretch von BPM 120 → 90 ergibt korrekte effektive Dauer", () => {
    // 4-sec Loop bei 120 BPM → wenn auf 90 BPM gemappt, 120/90 ≈ 1.333 ratio → 5.33 sec
    const ratio = stretchFromBpm(120, 90);
    const r = computeStretch(ratio, 4);
    expect(r.effectiveDuration).toBeCloseTo(4 * (120 / 90), 5);
  });
});
