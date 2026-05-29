/**
 * tests/features/pattern-emphasis.test.ts (v3.196)
 *
 * Pure-Coverage fuer client/src/utils/patternEmphasis.ts.
 * Pattern-Emphasis = velocity-Akzent pro Step (downbeat=loud,
 * off=softer, sub=ghost). Foundation fuer Humanize-Workflow,
 * Auto-Accent Pad-Trigger, Pattern-Performance-Layer.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  generateEmphasis,
  applyEmphasisVelocities,
  EMPHASIS_PRESET_LABELS,
  type EmphasisPreset,
  type EmphasizedStep,
} from "@/utils/patternEmphasis";

// --- Helpers -----------------------------------------------------------------

function mkPattern(activeIdx: readonly number[], length = 16): boolean[] {
  const out = new Array(length).fill(false) as boolean[];
  for (const i of activeIdx) {
    if (i >= 0 && i < length) out[i] = true;
  }
  return out;
}

function byStep(steps: readonly EmphasizedStep[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const s of steps) m.set(s.stepIndex, s.velocity);
  return m;
}

// --- Basics / Defensive ------------------------------------------------------

describe("generateEmphasis - basics + defensive", () => {
  it("empty pattern -> []", () => {
    expect(generateEmphasis([])).toEqual([]);
  });

  it("all-false pattern -> []", () => {
    const p = new Array(16).fill(false) as boolean[];
    expect(generateEmphasis(p)).toEqual([]);
  });

  it("invalid preset falls back to 'natural'", () => {
    const p = mkPattern([0, 1, 2, 4]);
    const res = generateEmphasis(p, { preset: "nonsense" as unknown as EmphasisPreset });
    const m = byStep(res);
    // natural: down=110, sub=60 at step 1, off=80 at step 2, beat=95 at step 4
    expect(m.get(0)).toBe(110);
    expect(m.get(1)).toBe(60);
    expect(m.get(2)).toBe(80);
    expect(m.get(4)).toBe(95);
  });

  it("stepsPerBeat <= 0 falls back to default 4", () => {
    const p = mkPattern([0, 4, 8]);
    const res = generateEmphasis(p, { stepsPerBeat: 0 });
    // mit default 4: step 0=down, step 4=beat, step 8=beat
    const m = byStep(res);
    expect(m.get(0)).toBe(110);
    expect(m.get(4)).toBe(95);
    expect(m.get(8)).toBe(95);
  });

  it("stepsPerBeat negative + beatsPerBar NaN -> defaults 4/4", () => {
    const p = mkPattern([0, 4]);
    const res = generateEmphasis(p, {
      stepsPerBeat: -5,
      beatsPerBar: Number.NaN,
    });
    const m = byStep(res);
    expect(m.get(0)).toBe(110);
    expect(m.get(4)).toBe(95);
  });

  it("does not mutate input pattern", () => {
    const original = mkPattern([0, 4, 8, 12]);
    const snapshot = [...original];
    generateEmphasis(original, { preset: "ghost-heavy" });
    expect(original).toEqual(snapshot);
  });

  it("result stepIndex matches active positions in order", () => {
    const p = mkPattern([2, 5, 9, 14]);
    const res = generateEmphasis(p, { preset: "robotic" });
    expect(res.map((s) => s.stepIndex)).toEqual([2, 5, 9, 14]);
  });
});

// --- Natural preset ---------------------------------------------------------

describe("generateEmphasis - natural preset", () => {
  it("4-on-floor with default base=110 -> [110, 95, 95, 95]", () => {
    const p = mkPattern([0, 4, 8, 12]);
    const res = generateEmphasis(p, { preset: "natural" });
    expect(res.map((s) => s.velocity)).toEqual([110, 95, 95, 95]);
  });

  it("off-beat step 2 -> base-30 = 80; sub step 1 -> base-50 = 60", () => {
    const p = mkPattern([0, 1, 2]);
    const m = byStep(generateEmphasis(p, { preset: "natural" }));
    expect(m.get(0)).toBe(110);
    expect(m.get(2)).toBe(80);
    expect(m.get(1)).toBe(60);
  });

  it("baseVelocity scales: base=80 -> down=80, beat=65, off=50, sub=30", () => {
    const p = mkPattern([0, 1, 2, 4]);
    const m = byStep(generateEmphasis(p, { preset: "natural", baseVelocity: 80 }));
    expect(m.get(0)).toBe(80);
    expect(m.get(4)).toBe(65);
    expect(m.get(2)).toBe(50);
    expect(m.get(1)).toBe(30);
  });

  it("low baseVelocity clamps sub to MIN_VELOCITY 1 (no zero)", () => {
    const p = mkPattern([1]); // sub
    const res = generateEmphasis(p, { preset: "natural", baseVelocity: 10 });
    // 10 - 50 = -40 -> clamp 1
    expect(res[0].velocity).toBe(1);
  });
});

// --- Linear preset ----------------------------------------------------------

describe("generateEmphasis - linear preset", () => {
  it("all active steps get base velocity, regardless of position", () => {
    const p = mkPattern([0, 1, 2, 3, 4, 7, 8, 11, 12, 15]);
    const res = generateEmphasis(p, { preset: "linear", baseVelocity: 100 });
    for (const s of res) expect(s.velocity).toBe(100);
  });

  it("linear with default base 110", () => {
    const p = mkPattern([0, 3, 7, 14]);
    const res = generateEmphasis(p, { preset: "linear" });
    for (const s of res) expect(s.velocity).toBe(110);
  });
});

// --- Ghost-heavy preset -----------------------------------------------------

describe("generateEmphasis - ghost-heavy preset", () => {
  it("sub steps get ABSOLUTE ghost velocity 25, regardless of base", () => {
    const p = mkPattern([1, 3, 5, 7]); // alle sub
    const resA = generateEmphasis(p, { preset: "ghost-heavy", baseVelocity: 110 });
    const resB = generateEmphasis(p, { preset: "ghost-heavy", baseVelocity: 60 });
    for (const s of resA) expect(s.velocity).toBe(25);
    for (const s of resB) expect(s.velocity).toBe(25);
  });

  it("downbeat = base, beat = base-10, off = base-50", () => {
    const p = mkPattern([0, 2, 4]);
    const m = byStep(generateEmphasis(p, { preset: "ghost-heavy", baseVelocity: 110 }));
    expect(m.get(0)).toBe(110);
    expect(m.get(4)).toBe(100); // base-10
    expect(m.get(2)).toBe(60);  // base-50
  });
});

// --- Robotic preset ---------------------------------------------------------

describe("generateEmphasis - robotic preset", () => {
  it("all active steps = 127, even with base=50", () => {
    const p = mkPattern([0, 1, 2, 3, 4, 7, 8, 11, 12, 15]);
    const res = generateEmphasis(p, { preset: "robotic", baseVelocity: 50 });
    for (const s of res) expect(s.velocity).toBe(127);
  });
});

// --- Loose preset (random) --------------------------------------------------

describe("generateEmphasis - loose preset", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("velocities are within [base-20, base+20], clamped 1..127", () => {
    const p = mkPattern([0, 1, 2, 3, 4, 5, 6, 7]);
    const res = generateEmphasis(p, { preset: "loose", baseVelocity: 100 });
    for (const s of res) {
      expect(s.velocity).toBeGreaterThanOrEqual(80);
      expect(s.velocity).toBeLessThanOrEqual(120);
    }
  });

  it("low base=10 -> clamp floor at MIN_VELOCITY=1", () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // -> jitter = -20
    const p = mkPattern([0, 4, 8, 12]);
    const res = generateEmphasis(p, { preset: "loose", baseVelocity: 10 });
    // 10 + (-20) = -10 -> clamp 1
    for (const s of res) expect(s.velocity).toBe(1);
  });

  it("high base=120 -> clamp ceiling at MAX_VELOCITY=127", () => {
    vi.spyOn(Math, "random").mockReturnValue(1); // -> jitter = +20
    const p = mkPattern([0, 4, 8, 12]);
    const res = generateEmphasis(p, { preset: "loose", baseVelocity: 120 });
    // 120 + 20 = 140 -> clamp 127
    for (const s of res) expect(s.velocity).toBe(127);
  });

  it("loose with mocked random=0.5 -> jitter exactly 0 -> velocity=base", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const p = mkPattern([0, 1, 2]);
    const res = generateEmphasis(p, { preset: "loose", baseVelocity: 100 });
    for (const s of res) expect(s.velocity).toBe(100);
  });
});

// --- Custom Time-Signature --------------------------------------------------

describe("generateEmphasis - custom time signature", () => {
  it("stepsPerBeat=2 beatsPerBar=2 -> barLength=4; step 0=down, step 2=beat, step 1=off", () => {
    const p = mkPattern([0, 1, 2, 3], 4);
    const m = byStep(
      generateEmphasis(p, {
        preset: "natural",
        stepsPerBeat: 2,
        beatsPerBar: 2,
        baseVelocity: 110,
      }),
    );
    // barLength=4: step 0 -> down=110
    expect(m.get(0)).toBe(110);
    // step 2 % stepsPerBeat(2) === 0 -> beat=95
    expect(m.get(2)).toBe(95);
    // step 1: halfBeat = floor(2/2) = 1, step 1 % 1 === 0 -> off=80
    expect(m.get(1)).toBe(80);
    // step 3 % 1 === 0 -> off=80 (no sub possible bei halfBeat=1)
    expect(m.get(3)).toBe(80);
  });

  it("stepsPerBeat=3 beatsPerBar=4 -> barLength=12; sub auf step 1+2+4+5...", () => {
    const p = mkPattern([0, 1, 2, 3, 6, 9], 12);
    const m = byStep(
      generateEmphasis(p, {
        preset: "natural",
        stepsPerBeat: 3,
        beatsPerBar: 4,
        baseVelocity: 110,
      }),
    );
    expect(m.get(0)).toBe(110);  // down
    expect(m.get(3)).toBe(95);   // beat (3 % 3 === 0)
    expect(m.get(6)).toBe(95);   // beat
    expect(m.get(9)).toBe(95);   // beat
    // halfBeat = floor(3/2) = 1 -> step 1, 2 % 1 === 0 -> off
    expect(m.get(1)).toBe(80);
    expect(m.get(2)).toBe(80);
  });
});

// --- EMPHASIS_PRESET_LABELS -------------------------------------------------

describe("EMPHASIS_PRESET_LABELS", () => {
  it("covers all 5 preset keys with non-empty strings", () => {
    const keys: EmphasisPreset[] = ["natural", "linear", "ghost-heavy", "robotic", "loose"];
    for (const k of keys) {
      const label = EMPHASIS_PRESET_LABELS[k];
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("has exactly 5 entries", () => {
    expect(Object.keys(EMPHASIS_PRESET_LABELS).sort()).toEqual(
      ["ghost-heavy", "linear", "loose", "natural", "robotic"],
    );
  });
});

// ─── v3.241: applyEmphasisVelocities (Apply auf Velocity-Spur) ────────────────

describe("applyEmphasisVelocities", () => {
  it("akzentuierte Steps bekommen die Emphasis-Velocity, Rest bleibt unverändert", () => {
    const emphasized: EmphasizedStep[] = [
      { stepIndex: 0, velocity: 120 },
      { stepIndex: 4, velocity: 90 },
    ];
    const current = [100, 100, 100, 100, 100, 100, 100, 100];
    const out = applyEmphasisVelocities(8, emphasized, current);
    expect(out).toEqual([120, 100, 100, 100, 90, 100, 100, 100]);
  });

  it("inaktive Steps ohne aktuelle Velocity → Fallback 100", () => {
    const out = applyEmphasisVelocities(4, [{ stepIndex: 1, velocity: 80 }], []);
    expect(out).toEqual([100, 80, 100, 100]);
  });

  it("clamped Emphasis- und Current-Velocities auf 1..127", () => {
    const out = applyEmphasisVelocities(
      3,
      [{ stepIndex: 0, velocity: 200 }, { stepIndex: 1, velocity: -5 }],
      [0, 0, 999],
    );
    expect(out).toEqual([127, 1, 127]);
  });

  it("stepCount 0 / negativ / NaN → leeres Array", () => {
    expect(applyEmphasisVelocities(0, [{ stepIndex: 0, velocity: 100 }], [])).toEqual([]);
    expect(applyEmphasisVelocities(-3, [], [])).toEqual([]);
    expect(applyEmphasisVelocities(NaN, [], [])).toEqual([]);
  });

  it("Emphasis-Steps außerhalb der stepCount werden ignoriert", () => {
    const out = applyEmphasisVelocities(2, [{ stepIndex: 5, velocity: 120 }], [100, 100]);
    expect(out).toEqual([100, 100]);
  });

  it("Round-Trip: generateEmphasis → applyEmphasisVelocities setzt nur aktive Steps", () => {
    const rhythm = [true, false, true, false];
    const emp = generateEmphasis(rhythm, { preset: "natural" });
    const out = applyEmphasisVelocities(4, emp, [70, 70, 70, 70]);
    // Aktive Steps (0,2) verändert; inaktive (1,3) bleiben 70.
    expect(out[1]).toBe(70);
    expect(out[3]).toBe(70);
    expect(out[0]).not.toBe(70);
    expect(out[2]).not.toBe(70);
  });
});
