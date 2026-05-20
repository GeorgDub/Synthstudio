/**
 * tests/features/pattern-evolve.test.ts (v3.188.0)
 *
 * Unit-Tests fuer patternEvolve.ts - Pattern-Evolution via crossover + mutation.
 * Verifiziert Public API (evolvePattern, crossover, mutate), Determinismus,
 * defensive Sanitizer, Edge-Cases (empty source, populationSize=1, unterschiedliche
 * Parent-Laengen).
 */
import { describe, it, expect } from "vitest";
import {
  evolvePattern,
  crossover,
  mutate,
  type EvolveOptions,
} from "../../client/src/utils/patternEvolve";

const SOURCE_8: readonly boolean[] = [
  true, false, true, false,
  true, false, true, false,
];

const SOURCE_16: readonly boolean[] = [
  true,  false, false, true,
  false, true,  false, false,
  true,  true,  false, false,
  false, false, true,  false,
];

// --- 1. evolvePattern: empty / defaults --------------------------------------
describe("evolvePattern - empty + defaults", () => {
  it("empty source -> { generation: 0, population: [] } (no work)", () => {
    const result = evolvePattern([]);
    expect(result.generation).toBe(0);
    expect(result.population).toEqual([]);
  });

  it("defaults -> populationSize=8, generation=4", () => {
    const result = evolvePattern(SOURCE_8);
    expect(result.generation).toBe(4);
    expect(result.population.length).toBe(8);
    // Alle individuen haben dieselbe length wie source (no length-changes in mutate).
    for (const ind of result.population) {
      expect(ind.length).toBe(SOURCE_8.length);
    }
  });

  it("source wird nicht mutiert (pure)", () => {
    const before = JSON.stringify(SOURCE_8);
    evolvePattern(SOURCE_8, { generations: 5, populationSize: 6 });
    expect(JSON.stringify(SOURCE_8)).toBe(before);
  });
});

// --- 2. evolvePattern: Determinismus ----------------------------------------
describe("evolvePattern - determinism via seed", () => {
  it("gleicher seed -> deep-equal population", () => {
    const a = evolvePattern(SOURCE_16, { seed: 42, generations: 3, populationSize: 6 });
    const b = evolvePattern(SOURCE_16, { seed: 42, generations: 3, populationSize: 6 });
    expect(a.population).toEqual(b.population);
    expect(a.generation).toBe(b.generation);
  });

  it("verschiedene seeds -> mind. ein abweichendes Individuum", () => {
    const a = evolvePattern(SOURCE_16, { seed: 1,   generations: 4, populationSize: 8 });
    const b = evolvePattern(SOURCE_16, { seed: 999, generations: 4, populationSize: 8 });
    // Mindestens ein Pop-Index unterscheidet sich (Elite kann gleich bleiben).
    const allSame = a.population.every((ind, i) =>
      JSON.stringify(ind) === JSON.stringify(b.population[i]),
    );
    expect(allSame).toBe(false);
  });
});

// --- 3. evolvePattern: Sanitizer / Defensive --------------------------------
describe("evolvePattern - defensive sanitizers", () => {
  it("NaN options -> defaults greifen (populationSize=8, generations=4)", () => {
    const opts: EvolveOptions = {
      generations: NaN,
      populationSize: NaN,
      mutationRate: NaN,
      crossoverRate: NaN,
      seed: NaN,
    };
    const r = evolvePattern(SOURCE_8, opts);
    expect(r.population.length).toBe(8);
    expect(r.generation).toBe(4);
  });

  it("populationSize=0 oder -3 -> default 8", () => {
    const r0 = evolvePattern(SOURCE_8, { populationSize: 0 });
    expect(r0.population.length).toBe(8);
    const rNeg = evolvePattern(SOURCE_8, { populationSize: -3 });
    expect(rNeg.population.length).toBe(8);
  });

  it("generations=0 -> Population entsteht (initial), aber kein generations-Loop", () => {
    const r = evolvePattern(SOURCE_8, { generations: 0, populationSize: 4, seed: 7 });
    expect(r.generation).toBe(0);
    expect(r.population.length).toBe(4);
  });

  it("mutationRate > 1 wird auf 1 geclamped (alle flips moeglich, kein throw)", () => {
    const r = evolvePattern(SOURCE_8, {
      mutationRate: 5,
      generations: 1,
      populationSize: 2,
      crossoverRate: 0,  // skip crossover branch
      seed: 1,
    });
    expect(r.population.length).toBe(2);
    // Wenigstens nichts crasht; structure ok.
    for (const ind of r.population) {
      expect(ind.length).toBe(SOURCE_8.length);
    }
  });

  it("crossoverRate < 0 wird auf 0 geclamped (kein throw)", () => {
    const r = evolvePattern(SOURCE_8, {
      crossoverRate: -2,
      generations: 2,
      populationSize: 4,
      seed: 11,
    });
    expect(r.population.length).toBe(4);
  });
});

// --- 4. evolvePattern: populationSize=1 -------------------------------------
describe("evolvePattern - populationSize=1 edge case", () => {
  it("populationSize=1 -> Population bleibt 1-elementig, kein throw", () => {
    const r = evolvePattern(SOURCE_8, {
      populationSize: 1,
      generations: 3,
      seed: 5,
    });
    expect(r.population.length).toBe(1);
    expect(r.population[0].length).toBe(SOURCE_8.length);
    expect(r.generation).toBe(3);
  });

  it("populationSize=1 -> deterministisch via seed", () => {
    const a = evolvePattern(SOURCE_8, { populationSize: 1, generations: 2, seed: 99 });
    const b = evolvePattern(SOURCE_8, { populationSize: 1, generations: 2, seed: 99 });
    expect(a.population).toEqual(b.population);
  });
});

// --- 5. crossover: deterministic via rng ------------------------------------
describe("crossover", () => {
  it("rng() < 0.5 -> immer a (output gleich a)", () => {
    const a = [true, false, true, false];
    const b = [false, true, false, true];
    const rng = () => 0.4;
    expect(crossover(a, b, rng)).toEqual(a);
  });

  it("rng() >= 0.5 -> immer b (output gleich b)", () => {
    const a = [true, false, true, false];
    const b = [false, true, false, true];
    const rng = () => 0.6;
    expect(crossover(a, b, rng)).toEqual(b);
  });

  it("unterschiedliche Laengen -> output length = max(a.length, b.length)", () => {
    const a = [true, false, true];
    const b = [false, true, true, false, true];
    const rng = () => 0.0;  // immer a
    const out = crossover(a, b, rng);
    expect(out.length).toBe(5);
    // Indices >= a.length sind via readStep -> false.
    expect(out[3]).toBe(false);
    expect(out[4]).toBe(false);
  });

  it("a leer, b nicht leer -> output length = b.length, rng>=0.5 nimmt b", () => {
    const a: boolean[] = [];
    const b = [true, true, false];
    const out = crossover(a, b, () => 0.9);
    expect(out).toEqual([true, true, false]);
  });

  it("inputs werden nicht mutiert (pure)", () => {
    const a = [true, false, true];
    const b = [false, true, false];
    const beforeA = JSON.stringify(a);
    const beforeB = JSON.stringify(b);
    crossover(a, b, () => 0.5);
    expect(JSON.stringify(a)).toBe(beforeA);
    expect(JSON.stringify(b)).toBe(beforeB);
  });
});

// --- 6. mutate: rate-based flips --------------------------------------------
describe("mutate", () => {
  it("rate=0 -> output gleich input (kein flip)", () => {
    const p = [true, false, true, false];
    expect(mutate(p, 0, () => 0.99)).toEqual(p);
  });

  it("rate=1 -> output ist inverse von input (immer flip)", () => {
    const p = [true, false, true, false];
    const out = mutate(p, 1, () => 0.0);
    expect(out).toEqual([false, true, false, true]);
  });

  it("rng>=rate -> kein flip", () => {
    const p = [true, false, true, false];
    // rate=0.5, rng() = 0.7 -> nie flip
    expect(mutate(p, 0.5, () => 0.7)).toEqual(p);
  });

  it("input wird nicht mutiert (pure)", () => {
    const p = [true, false, true];
    const before = JSON.stringify(p);
    mutate(p, 1, () => 0.0);
    expect(JSON.stringify(p)).toBe(before);
  });

  it("empty input -> empty output", () => {
    expect(mutate([], 0.5, () => 0.1)).toEqual([]);
  });
});

// --- 7. Elite carry-over ----------------------------------------------------
describe("evolvePattern - elite", () => {
  it("pop[0] der finalen Generation ist Elite (kommt aus prev[0])", () => {
    // Bei mutationRate=0 + crossoverRate=0 sollte source als Elite durchkommen.
    // Initial pop[0] = source-copy, mutate(rate=0) liefert clone -> nach
    // generationen-loop ist next[0] = pop[0].slice() = source-copy.
    const r = evolvePattern(SOURCE_8, {
      generations: 3,
      populationSize: 4,
      mutationRate: 0,
      crossoverRate: 0,
      seed: 1,
    });
    expect(r.population[0]).toEqual([...SOURCE_8]);
  });
});
