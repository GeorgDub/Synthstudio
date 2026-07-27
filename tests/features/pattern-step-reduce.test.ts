import { describe, it, expect } from "vitest";
import {
  reduceSteps,
  stepReductionNeeded,
  decimationFactor,
  stepReductionLabel,
  E2_MAX_STEPS,
  STEP_REDUCTION_STRATEGIES,
} from "../../client/src/utils/patternStepReduce";

/** 0..n-1 als eindeutige Marker, um die Auswahl exakt zu prüfen. */
const seq = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("stepReductionNeeded", () => {
  it("true nur wenn source > target", () => {
    expect(stepReductionNeeded(128)).toBe(true);
    expect(stepReductionNeeded(64)).toBe(false);
    expect(stepReductionNeeded(65)).toBe(true);
    expect(stepReductionNeeded(32)).toBe(false);
    expect(stepReductionNeeded(100, 50)).toBe(true);
  });
});

describe("decimationFactor", () => {
  it("128→64 ⇒ Faktor 2 (jeder 2. Step)", () => {
    expect(decimationFactor(128, 64)).toBe(2);
  });
  it("mindestens 1", () => {
    expect(decimationFactor(64, 64)).toBe(1);
    expect(decimationFactor(30, 64)).toBe(1);
  });
});

describe("reduceSteps — decimate (Default)", () => {
  it("128→64 nimmt jeden 2. Step (0,2,4,…,126)", () => {
    const out = reduceSteps(seq(128), 64, "decimate");
    expect(out).toHaveLength(64);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(2);
    expect(out[63]).toBe(126);
  });

  it("bewahrt Trigger auf geraden Steps, verwirft ungerade", () => {
    // aktiv nur auf Step 4 (gerade → bleibt) und Step 5 (ungerade → weg)
    const steps = new Array<boolean>(128).fill(false);
    steps[4] = true;
    steps[5] = true;
    const out = reduceSteps(steps, 64, "decimate");
    expect(out[2]).toBe(true); // Step 4 → Index 2
    expect(out.filter(Boolean)).toHaveLength(1); // Step 5 ging verloren
  });

  it("Default-Strategie ist decimate", () => {
    expect(reduceSteps(seq(128), 64)).toEqual(
      reduceSteps(seq(128), 64, "decimate")
    );
  });
});

describe("reduceSteps — truncate", () => {
  it("128→64 behält Steps 0..63 in voller Auflösung", () => {
    const out = reduceSteps(seq(128), 64, "truncate");
    expect(out).toHaveLength(64);
    expect(out[0]).toBe(0);
    expect(out[63]).toBe(63);
  });
});

describe("reduceSteps — Randfälle", () => {
  it("bereits ≤ target → unveränderte Kopie", () => {
    const src = seq(64);
    const out = reduceSteps(src, 64, "decimate");
    expect(out).toEqual(src);
    expect(out).not.toBe(src); // Kopie, keine Referenz
  });

  it("kürzer als target bleibt unverändert", () => {
    expect(reduceSteps(seq(16), 64)).toEqual(seq(16));
  });

  it("target 0 → leer", () => {
    expect(reduceSteps(seq(128), 0)).toEqual([]);
  });

  it("funktioniert generisch mit Step-Objekten", () => {
    const objs = seq(128).map(i => ({ active: i % 2 === 0, n: i }));
    const out = reduceSteps(objs, 64, "decimate");
    expect(out).toHaveLength(64);
    expect(out[0]).toEqual({ active: true, n: 0 });
    expect(out[1]).toEqual({ active: true, n: 2 });
  });
});

describe("Konstanten + Labels", () => {
  it("E2_MAX_STEPS = 64", () => {
    expect(E2_MAX_STEPS).toBe(64);
  });
  it("beide Strategien exponiert + gelabelt", () => {
    expect(STEP_REDUCTION_STRATEGIES).toEqual(["decimate", "truncate"]);
    expect(stepReductionLabel("decimate")).toMatch(/2\. Step/);
    expect(stepReductionLabel("truncate")).toMatch(/Erste 64/);
  });
});
