/**
 * tests/features/pattern-step-probability.test.ts (v3.174.0)
 *
 * Unit-Tests fuer patternStepProbability.ts - Per-Step-Probability-Locks.
 * Verifiziert resolveStepProbabilities, expectedDensity, generateRandomLocks,
 * applyLockMode und LOCK_PRESETS. Determinismus via Seed wird ueberprueft.
 */
import { describe, it, expect } from "vitest";
import {
  resolveStepProbabilities,
  expectedDensity,
  generateRandomLocks,
  applyLockMode,
  LOCK_PRESETS,
  type StepWithProbability,
  type LockMode,
} from "../../client/src/utils/patternStepProbability";

function makeSteps(
  activeMask: readonly boolean[],
  probs?: readonly (number | undefined)[],
): StepWithProbability[] {
  return activeMask.map((a, i) => {
    const p = probs?.[i];
    return p === undefined ? { active: a } : { active: a, probability: p };
  });
}

// --- resolveStepProbabilities -------------------------------------------------

describe("resolveStepProbabilities", () => {
  it("returns all-false when all steps inactive", () => {
    const steps = makeSteps([false, false, false, false]);
    const out = resolveStepProbabilities(steps, { seed: 42 });
    expect(out).toEqual([false, false, false, false]);
  });

  it("returns all-true when active + probability=1", () => {
    const steps = makeSteps([true, true, true, true], [1, 1, 1, 1]);
    const out = resolveStepProbabilities(steps, { seed: 1 });
    expect(out).toEqual([true, true, true, true]);
  });

  it("returns all-false when active + probability=0", () => {
    const steps = makeSteps([true, true, true, true], [0, 0, 0, 0]);
    const out = resolveStepProbabilities(steps, { seed: 1 });
    expect(out).toEqual([false, false, false, false]);
  });

  it("is deterministic - same seed + inputs -> same output", () => {
    const steps = makeSteps(
      [true, true, true, true, true, true, true, true],
      [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
    );
    const a = resolveStepProbabilities(steps, { seed: 12345 });
    const b = resolveStepProbabilities(steps, { seed: 12345 });
    expect(a).toEqual(b);
    const c = resolveStepProbabilities(steps, { seed: 999 });
    expect(c).toHaveLength(8);
  });

  it("treats undefined probability as 1 (always-true when active)", () => {
    const steps = makeSteps([true, false, true, false]);
    const out = resolveStepProbabilities(steps, { seed: 7 });
    expect(out).toEqual([true, false, true, false]);
  });

  it("returns [] for empty input", () => {
    expect(resolveStepProbabilities([])).toEqual([]);
  });
});

// --- expectedDensity ----------------------------------------------------------

describe("expectedDensity", () => {
  it("returns 0 for empty array", () => {
    expect(expectedDensity([])).toBe(0);
  });

  it("returns 1.0 when all active + probability=1", () => {
    const steps = makeSteps([true, true, true, true], [1, 1, 1, 1]);
    expect(expectedDensity(steps)).toBeCloseTo(1.0, 10);
  });

  it("returns ~0.25 when half active with probability=0.5", () => {
    const steps = makeSteps(
      [true, false, true, false, true, false, true, false],
      [0.5, undefined, 0.5, undefined, 0.5, undefined, 0.5, undefined],
    );
    expect(expectedDensity(steps)).toBeCloseTo(0.25, 10);
  });

  it("treats undefined probability on active steps as 1.0", () => {
    const steps = makeSteps([true, true, false, false]);
    expect(expectedDensity(steps)).toBeCloseTo(0.5, 10);
  });
});

// --- generateRandomLocks ------------------------------------------------------

describe("generateRandomLocks", () => {
  it("assigns probability only to active steps; inactive remain without prob", () => {
    const steps = makeSteps([true, false, true, false, true, false]);
    const out = generateRandomLocks(steps, { seed: 123 });
    expect(out).toHaveLength(6);
    for (let i = 0; i < out.length; i++) {
      if (steps[i].active) {
        expect(out[i].active).toBe(true);
        expect(typeof out[i].probability).toBe("number");
        expect([1.0, 0.75, 0.5]).toContain(out[i].probability);
      } else {
        expect(out[i].active).toBe(false);
        expect(out[i].probability).toBeUndefined();
      }
    }
  });

  it("is deterministic - same seed -> same locks", () => {
    const steps = makeSteps([true, true, true, true, true, true, true, true]);
    const a = generateRandomLocks(steps, { seed: 42 });
    const b = generateRandomLocks(steps, { seed: 42 });
    expect(a).toEqual(b);
  });
});

// --- applyLockMode ------------------------------------------------------------

describe("applyLockMode", () => {
  it("'all' assigns probability=0.75 to every active step", () => {
    const steps = makeSteps([true, false, true, true, false, true]);
    const out = applyLockMode(steps, "all");
    expect(out).toHaveLength(6);
    out.forEach((s, i) => {
      if (steps[i].active) {
        expect(s.active).toBe(true);
        expect(s.probability).toBeCloseTo(0.75, 10);
      } else {
        expect(s.active).toBe(false);
        expect(s.probability).toBeUndefined();
      }
    });
  });

  it("'downbeats' assigns 1.0 to indices 0/4/8/12 and 0.5 elsewhere (active only)", () => {
    const steps = makeSteps(new Array(16).fill(true));
    const out = applyLockMode(steps, "downbeats");
    for (let i = 0; i < 16; i++) {
      const isDown = i === 0 || i === 4 || i === 8 || i === 12;
      expect(out[i].active).toBe(true);
      expect(out[i].probability).toBeCloseTo(isDown ? 1.0 : 0.5, 10);
    }
    const mixed = makeSteps([true, false, false, false, true, false, false, false]);
    const out2 = applyLockMode(mixed, "downbeats");
    expect(out2[1].active).toBe(false);
    expect(out2[1].probability).toBeUndefined();
    expect(out2[0].probability).toBeCloseTo(1.0, 10);
    expect(out2[4].probability).toBeCloseTo(1.0, 10);
  });

  it("'fills' assigns 0.6 to indices >= 12 and 1.0 otherwise (active only)", () => {
    const steps = makeSteps(new Array(16).fill(true));
    const out = applyLockMode(steps, "fills");
    for (let i = 0; i < 16; i++) {
      expect(out[i].active).toBe(true);
      expect(out[i].probability).toBeCloseTo(i >= 12 ? 0.6 : 1.0, 10);
    }
  });

  it("'offbeats' assigns 0.7 to odd indices and 1.0 to even (active only)", () => {
    const steps = makeSteps(new Array(8).fill(true));
    const out = applyLockMode(steps, "offbeats");
    for (let i = 0; i < 8; i++) {
      const isOdd = (i % 2) === 1;
      expect(out[i].probability).toBeCloseTo(isOdd ? 0.7 : 1.0, 10);
    }
  });
});

// --- LOCK_PRESETS -------------------------------------------------------------

describe("LOCK_PRESETS", () => {
  it("contains all 4 modes with non-empty descriptions", () => {
    expect(LOCK_PRESETS).toHaveLength(4);
    const modes = LOCK_PRESETS.map((p) => p.mode);
    const expected: LockMode[] = ["all", "downbeats", "offbeats", "fills"];
    for (const m of expected) {
      expect(modes).toContain(m);
    }
    for (const preset of LOCK_PRESETS) {
      expect(typeof preset.description).toBe("string");
      expect(preset.description.length).toBeGreaterThan(0);
    }
  });
});

// --- Defensive ----------------------------------------------------------------

describe("defensive edge cases", () => {
  it("probability=NaN is treated as 0 -> step never triggers", () => {
    const steps: StepWithProbability[] = [
      { active: true, probability: NaN },
      { active: true, probability: NaN },
      { active: true, probability: NaN },
      { active: true, probability: NaN },
    ];
    const out = resolveStepProbabilities(steps, { seed: 1 });
    expect(out).toEqual([false, false, false, false]);
    expect(expectedDensity(steps)).toBe(0);
  });

  it("probability > 1 is clamped to 1 (always triggers)", () => {
    const steps: StepWithProbability[] = [
      { active: true, probability: 5 },
      { active: true, probability: 2.5 },
    ];
    const out = resolveStepProbabilities(steps, { seed: 1 });
    expect(out).toEqual([true, true]);
    expect(expectedDensity(steps)).toBeCloseTo(1.0, 10);
  });

  it("negative probability is clamped to 0 (never triggers)", () => {
    const steps: StepWithProbability[] = [
      { active: true, probability: -0.4 },
      { active: true, probability: -10 },
    ];
    expect(resolveStepProbabilities(steps, { seed: 1 })).toEqual([false, false]);
    expect(expectedDensity(steps)).toBe(0);
  });
});
