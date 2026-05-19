/**
 * tests/features/pattern-groove.test.ts (v3.165)
 *
 * Pure-Coverage für client/src/utils/patternGroove.ts.
 *
 * Sichert das Verhalten von applyGroove (Timing-/Velocity-Humanisierung)
 * + GROOVE_PRESETS-Liste. Determinismus über Seed wird explizit verifiziert.
 */
import { describe, it, expect } from "vitest";
import {
  applyGroove,
  GROOVE_PRESETS,
  type GrooveStep,
} from "@/utils/patternGroove";

const ALL_TRUE = (n: number): boolean[] => Array(n).fill(true);
const ALL_FALSE = (n: number): boolean[] => Array(n).fill(false);

describe("applyGroove – Basis", () => {
  it("empty pattern → []", () => {
    expect(applyGroove([])).toEqual([]);
  });

  it("pattern mit nur false → []", () => {
    expect(applyGroove(ALL_FALSE(16))).toEqual([]);
  });

  it("nur aktive (true) Steps werden gemapped", () => {
    const pattern = [true, false, true, false, false, true];
    const result = applyGroove(pattern);
    expect(result).toHaveLength(3);
    expect(result.map((s) => s.stepIndex)).toEqual([0, 2, 5]);
  });

  it("straight (0 jitter, 0 velocity-jitter) → alle aktiven Steps mit timingOffsetMs=0 und velocity=baseVelocity", () => {
    const pattern = [true, true, false, true, true];
    const result = applyGroove(pattern, { timingJitterMs: 0, velocityJitter: 0, baseVelocity: 100 });
    expect(result).toHaveLength(4);
    for (const step of result) {
      expect(step.timingOffsetMs).toBe(0);
      expect(step.velocity).toBe(100);
    }
  });
});

describe("applyGroove – Determinismus", () => {
  it("gleicher Seed + Input → identischer Output (Run twice)", () => {
    const pattern = [true, true, true, true, true, true, true, true];
    const opts = { timingJitterMs: 10, velocityJitter: 20, seed: 42 };
    const a = applyGroove(pattern, opts);
    const b = applyGroove(pattern, opts);
    expect(a).toEqual(b);
  });

  it("unterschiedlicher Seed → mind. ein Step weicht ab", () => {
    const pattern = ALL_TRUE(16);
    const a = applyGroove(pattern, { timingJitterMs: 10, velocityJitter: 20, seed: 1 });
    const b = applyGroove(pattern, { timingJitterMs: 10, velocityJitter: 20, seed: 999 });
    const differs = a.some(
      (step, i) => step.timingOffsetMs !== b[i].timingOffsetMs || step.velocity !== b[i].velocity,
    );
    expect(differs).toBe(true);
  });
});

describe("applyGroove – Clamping", () => {
  it("velocity wird auf [0, 127] geclampt", () => {
    const pattern = ALL_TRUE(64);
    // Extremes velocityJitter + baseVelocity an Grenze
    const lowResult = applyGroove(pattern, { baseVelocity: 0, velocityJitter: 40, seed: 7 });
    for (const s of lowResult) {
      expect(s.velocity).toBeGreaterThanOrEqual(0);
      expect(s.velocity).toBeLessThanOrEqual(127);
    }
    const highResult = applyGroove(pattern, { baseVelocity: 127, velocityJitter: 40, seed: 7 });
    for (const s of highResult) {
      expect(s.velocity).toBeGreaterThanOrEqual(0);
      expect(s.velocity).toBeLessThanOrEqual(127);
    }
  });

  it("timingJitterMs > 50 wird auf 50 geclampt (|timingOffsetMs| <= 25)", () => {
    const pattern = ALL_TRUE(64);
    // Bei timingJitterMs=50 ist max-Wert in der Formel gauss() * 50 * 0.5 = ±25*gauss.
    // gauss kann theoretisch >1 sein, aber wir testen, dass das Clamping greift —
    // d.h. mit Input 9999 verhält sich applyGroove identisch zu Input 50.
    const a = applyGroove(pattern, { timingJitterMs: 9999, velocityJitter: 0, seed: 12 });
    const b = applyGroove(pattern, { timingJitterMs: 50, velocityJitter: 0, seed: 12 });
    expect(a).toEqual(b);
  });

  it("velocityJitter > 40 wird auf 40 geclampt", () => {
    const pattern = ALL_TRUE(32);
    const a = applyGroove(pattern, { velocityJitter: 9999, seed: 5 });
    const b = applyGroove(pattern, { velocityJitter: 40, seed: 5 });
    expect(a).toEqual(b);
  });

  it("baseVelocity > 127 wird auf 127 geclampt, < 0 auf 0", () => {
    const pattern = [true, true, true];
    const high = applyGroove(pattern, { baseVelocity: 999, velocityJitter: 0 });
    expect(high.every((s) => s.velocity === 127)).toBe(true);
    const low = applyGroove(pattern, { baseVelocity: -100, velocityJitter: 0 });
    expect(low.every((s) => s.velocity === 0)).toBe(true);
  });
});

describe("applyGroove – Konfiguration", () => {
  it("custom baseVelocity (80) → straight liefert velocity=80", () => {
    const pattern = [true, true, true];
    const result = applyGroove(pattern, { baseVelocity: 80, timingJitterMs: 0, velocityJitter: 0 });
    expect(result.every((s) => s.velocity === 80)).toBe(true);
  });

  it("NaN baseVelocity → fallback auf 100", () => {
    const pattern = [true, true];
    const result = applyGroove(pattern, { baseVelocity: NaN, velocityJitter: 0 });
    expect(result.every((s) => s.velocity === 100)).toBe(true);
  });

  it("Infinity velocityJitter → fallback auf 0 (kein Velocity-Jitter)", () => {
    const pattern = ALL_TRUE(8);
    const result = applyGroove(pattern, { velocityJitter: Infinity, baseVelocity: 90 });
    expect(result.every((s) => s.velocity === 90)).toBe(true);
  });

  it("großes pattern (100 aktive Steps) → 100 Result-Einträge mit stepIndex 0..99", () => {
    const pattern = ALL_TRUE(100);
    const result: GrooveStep[] = applyGroove(pattern, { timingJitterMs: 5, velocityJitter: 5, seed: 3 });
    expect(result).toHaveLength(100);
    expect(result.map((s) => s.stepIndex)).toEqual(Array.from({ length: 100 }, (_, i) => i));
  });
});

describe("GROOVE_PRESETS", () => {
  it("hat mind. 4 Einträge", () => {
    expect(GROOVE_PRESETS.length).toBeGreaterThanOrEqual(4);
  });

  it("alle Presets haben non-empty id + name", () => {
    for (const p of GROOVE_PRESETS) {
      expect(typeof p.id).toBe("string");
      expect(p.id.length).toBeGreaterThan(0);
      expect(typeof p.name).toBe("string");
      expect(p.name.length).toBeGreaterThan(0);
      expect(typeof p.options).toBe("object");
    }
  });

  it("enthält die Standard-IDs straight/subtle/loose/drunken", () => {
    const ids = GROOVE_PRESETS.map((p) => p.id);
    expect(ids).toContain("straight");
    expect(ids).toContain("subtle");
    expect(ids).toContain("loose");
    expect(ids).toContain("drunken");
  });

  it("straight-Preset liefert deterministisches No-Op-Verhalten", () => {
    const straight = GROOVE_PRESETS.find((p) => p.id === "straight")!;
    const pattern = [true, false, true, true];
    const result = applyGroove(pattern, { ...straight.options, baseVelocity: 110 });
    expect(result).toHaveLength(3);
    for (const s of result) {
      expect(s.timingOffsetMs).toBe(0);
      expect(s.velocity).toBe(110);
    }
  });
});
