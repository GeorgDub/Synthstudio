/**
 * tests/pattern-generator.test.ts
 *
 * Unit-Tests für patternGenerator.ts + usePatternGeneratorStore (Phase 3, v1.10).
 * Umgebung: Node – kein DOM.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  generatePattern,
  GENRE_BPM,
  GENRE_LABELS,
} from "@/utils/patternGenerator";
import type { Genre } from "@/utils/patternGenerator";
import {
  __resetForTests,
  setGenre,
  setComplexity,
  getPatternGeneratorState,
} from "@/store/usePatternGeneratorStore";

// ─── generatePattern ──────────────────────────────────────────────────────────

describe("generatePattern()", () => {
  const ALL_GENRES: Genre[] = ["techno", "house", "hiphop", "trap", "dnb", "reggaeton"];

  it("gibt für jeden Genre das korrekte BPM zurück", () => {
    for (const genre of ALL_GENRES) {
      const result = generatePattern({ genre, complexity: 0.5, seed: 42 });
      expect(result.bpm).toBe(GENRE_BPM[genre]);
    }
  });

  it("gibt 5 Parts zurück", () => {
    const result = generatePattern({ genre: "techno", complexity: 0.5, seed: 1 });
    expect(result.parts.length).toBe(5);
  });

  it("jeder Part hat genau 16 Steps (default)", () => {
    const result = generatePattern({ genre: "house", complexity: 0.5, seed: 7 });
    for (const part of result.parts) {
      expect(part.steps.length).toBe(16);
    }
  });

  it("stepCount: 32 ergibt 32 Steps", () => {
    const result = generatePattern({ genre: "techno", complexity: 0.5, seed: 3, stepCount: 32 });
    for (const part of result.parts) {
      expect(part.steps.length).toBe(32);
    }
  });

  it("deterministisch: gleicher Seed → gleiche Ausgabe", () => {
    const a = generatePattern({ genre: "trap", complexity: 0.7, seed: 999 });
    const b = generatePattern({ genre: "trap", complexity: 0.7, seed: 999 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("unterschiedlicher Seed → (fast immer) unterschiedliches Ergebnis", () => {
    const a = generatePattern({ genre: "dnb", complexity: 0.5, seed: 1 });
    const b = generatePattern({ genre: "dnb", complexity: 0.5, seed: 2 });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it("complexity = 0 ergibt minimal aktive Steps", () => {
    const result = generatePattern({ genre: "techno", complexity: 0, seed: 42 });
    const totalActive = result.parts.flatMap(p => p.steps).filter(s => s.active).length;
    expect(totalActive).toBeGreaterThan(0); // Kick bleibt immer aktiv
    expect(totalActive).toBeLessThan(16);
  });

  it("complexity = 1 ergibt viele aktive Steps", () => {
    const result = generatePattern({ genre: "techno", complexity: 1, seed: 42 });
    const totalActive = result.parts.flatMap(p => p.steps).filter(s => s.active).length;
    expect(totalActive).toBeGreaterThan(20);
  });

  it("velocity-Werte sind im Bereich 1–127", () => {
    const result = generatePattern({ genre: "house", complexity: 0.8, seed: 55 });
    for (const part of result.parts) {
      for (const step of part.steps) {
        if (step.active) {
          expect(step.velocity).toBeGreaterThanOrEqual(1);
          expect(step.velocity).toBeLessThanOrEqual(127);
        }
      }
    }
  });
});

// ─── GENRE_LABELS ─────────────────────────────────────────────────────────────

describe("GENRE_LABELS", () => {
  it("enthält Einträge für alle 6 Genres", () => {
    const genres: Genre[] = ["techno", "house", "hiphop", "trap", "dnb", "reggaeton"];
    for (const g of genres) {
      expect(GENRE_LABELS[g]).toBeTruthy();
    }
  });
});

// ─── usePatternGeneratorStore ─────────────────────────────────────────────────

describe("usePatternGeneratorStore", () => {
  beforeEach(() => __resetForTests());

  it("Initialzustand: genre='techno', complexity=0.5", () => {
    const s = getPatternGeneratorState();
    expect(s.selectedGenre).toBe("techno");
    expect(s.complexity).toBe(0.5);
    expect(s.lastGenerated).toBeNull();
  });

  it("setGenre() setzt das Genre", () => {
    setGenre("trap");
    expect(getPatternGeneratorState().selectedGenre).toBe("trap");
  });

  it("setComplexity() klemmt auf [0, 1]", () => {
    setComplexity(2.5);
    expect(getPatternGeneratorState().complexity).toBe(1);
    setComplexity(-0.5);
    expect(getPatternGeneratorState().complexity).toBe(0);
  });
});
