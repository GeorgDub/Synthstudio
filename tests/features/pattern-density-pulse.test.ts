// @vitest-environment node
/**
 * pattern-density-pulse.test.ts (v3.199)
 *
 * Tests fuer patternDensityPulse.ts — Sliding-Window Density-Pulse-Detection.
 */
import { describe, it, expect } from "vitest";
import {
  detectDensityPulses,
  mergePulses,
  pulseCoverage,
  type DensityPulse,
} from "@/utils/patternDensityPulse";

const F = false;
const T = true;

function pulse(
  startStep: number,
  endStep: number,
  hits: number,
  density: number,
): DensityPulse {
  return { startStep, endStep, hits, density };
}

describe("patternDensityPulse", () => {
  describe("detectDensityPulses — empty / trivial", () => {
    it("empty steps -> []", () => {
      expect(detectDensityPulses([])).toEqual([]);
    });

    it("empty steps mit options -> []", () => {
      expect(
        detectDensityPulses([], { windowSize: 8, minDensity: 0.5, minLength: 1 }),
      ).toEqual([]);
    });

    it("all-false 16 steps -> []", () => {
      const steps = new Array<boolean>(16).fill(F);
      expect(detectDensityPulses(steps)).toEqual([]);
    });

    it("windowSize > length -> []", () => {
      expect(detectDensityPulses([T, T, T], { windowSize: 4 })).toEqual([]);
    });
  });

  describe("detectDensityPulses — happy path", () => {
    it("all-true (8 steps) -> ein Pulse [0,7]", () => {
      const steps = new Array<boolean>(8).fill(T);
      const result = detectDensityPulses(steps);
      expect(result).toHaveLength(1);
      expect(result[0].startStep).toBe(0);
      expect(result[0].endStep).toBe(7);
      expect(result[0].hits).toBe(8);
      expect(result[0].density).toBe(1);
    });

    it("4-on-the-floor (16 steps, windowSize=4 default) -> keine Pulses", () => {
      const steps: boolean[] = [
        T, F, F, F,
        T, F, F, F,
        T, F, F, F,
        T, F, F, F,
      ];
      expect(detectDensityPulses(steps)).toEqual([]);
    });

    it("Burst 4 hits am Anfang -> ein Pulse [0,3]", () => {
      const steps: boolean[] = [
        T, T, T, T,
        F, F, F, F,
        F, F, F, F,
        F, F, F, F,
      ];
      const result = detectDensityPulses(steps);
      expect(result).toHaveLength(1);
      expect(result[0].startStep).toBe(0);
      expect(result[0].endStep).toBe(3);
      expect(result[0].hits).toBe(4);
      expect(result[0].density).toBe(1);
    });

    it("Burst in der Mitte -> ein Pulse mit trimmed Hits", () => {
      const steps: boolean[] = [
        F, F, F, F,
        T, T, T, T,
        F, F, F, F,
        F, F, F, F,
      ];
      const result = detectDensityPulses(steps);
      expect(result).toHaveLength(1);
      expect(result[0].startStep).toBe(4);
      expect(result[0].endStep).toBe(7);
      expect(result[0].hits).toBe(4);
    });

    it("Burst am Ende -> ein Pulse [12,15]", () => {
      const steps: boolean[] = [
        F, F, F, F,
        F, F, F, F,
        F, F, F, F,
        T, T, T, T,
      ];
      const result = detectDensityPulses(steps);
      expect(result).toHaveLength(1);
      expect(result[0].startStep).toBe(12);
      expect(result[0].endStep).toBe(15);
      expect(result[0].hits).toBe(4);
    });

    it("Zwei getrennte Bursts -> zwei Pulses", () => {
      const steps: boolean[] = [
        T, T, T, T,
        F, F, F, F,
        F, F, F, F,
        T, T, T, T,
      ];
      const result = detectDensityPulses(steps);
      expect(result).toHaveLength(2);
      expect(result[0].startStep).toBe(0);
      expect(result[0].endStep).toBe(3);
      expect(result[1].startStep).toBe(12);
      expect(result[1].endStep).toBe(15);
    });

    it("Drei Bursts -> drei Pulses", () => {
      const steps: boolean[] = [
        T, T, T, T,
        F, F, F, F,
        T, T, T, T,
        F, F, F, F,
        T, T, T, T,
        F, F, F, F,
      ];
      const result = detectDensityPulses(steps);
      expect(result).toHaveLength(3);
      expect(result.map((p) => p.startStep)).toEqual([0, 8, 16]);
    });
  });

  describe("detectDensityPulses — minLength filter", () => {
    it("single-hit qualifying window -> getrimmt length=1 -> verworfen", () => {
      const steps: boolean[] = [T, F, T, F, T];
      const result = detectDensityPulses(steps, {
        windowSize: 1,
        minDensity: 1,
      });
      expect(result).toEqual([]);
    });

    it("minLength=1 erlaubt single-step Pulses", () => {
      const steps: boolean[] = [T, F, T, F, T];
      const result = detectDensityPulses(steps, {
        windowSize: 1,
        minDensity: 1,
        minLength: 1,
      });
      expect(result).toHaveLength(3);
      expect(result.map((p) => p.startStep)).toEqual([0, 2, 4]);
    });
  });

  describe("detectDensityPulses — options variation", () => {
    it("minDensity=0.5 + windowSize=4 catches half-full bursts", () => {
      const steps: boolean[] = [
        T, T, F, F,
        F, F, F, F,
        F, F, F, F,
        F, F, F, F,
      ];
      const result = detectDensityPulses(steps, {
        windowSize: 4,
        minDensity: 0.5,
      });
      expect(result).toHaveLength(1);
      expect(result[0].startStep).toBe(0);
      expect(result[0].endStep).toBe(1);
      expect(result[0].hits).toBe(2);
    });

    it("custom windowSize=8 + lower minDensity", () => {
      const steps: boolean[] = [
        T, T, T, T, F, F, F, F,
        F, F, F, F, F, F, F, F,
      ];
      const result = detectDensityPulses(steps, {
        windowSize: 8,
        minDensity: 0.5,
      });
      expect(result).toHaveLength(1);
      expect(result[0].startStep).toBe(0);
      expect(result[0].endStep).toBe(3);
    });
  });

  describe("detectDensityPulses — defensive sanitizers", () => {
    it("negative windowSize -> default 4 angewendet", () => {
      const steps: boolean[] = [T, T, T, T, F, F, F, F];
      const result = detectDensityPulses(steps, { windowSize: -3 });
      expect(result).toHaveLength(1);
      expect(result[0].startStep).toBe(0);
      expect(result[0].endStep).toBe(3);
    });

    it("NaN minDensity -> default 0.75", () => {
      const steps: boolean[] = [T, T, T, T, F, F, F, F];
      const result = detectDensityPulses(steps, { minDensity: NaN });
      expect(result).toHaveLength(1);
    });

    it("minDensity > 1 -> clamped to 1", () => {
      const steps: boolean[] = [
        T, T, T, F,
        T, T, T, T,
        F, F, F, F,
        F, F, F, F,
      ];
      const result = detectDensityPulses(steps, {
        windowSize: 4,
        minDensity: 5,
      });
      expect(result).toHaveLength(1);
      expect(result[0].startStep).toBe(4);
      expect(result[0].endStep).toBe(7);
    });

    it("minDensity < 0 -> clamped to 0", () => {
      const steps: boolean[] = [F, F, F, F, T, T, T, T];
      const result = detectDensityPulses(steps, {
        windowSize: 4,
        minDensity: -1,
      });
      expect(result).toHaveLength(1);
      expect(result[0].startStep).toBe(4);
      expect(result[0].endStep).toBe(7);
    });

    it("negative minLength -> default 2", () => {
      const steps: boolean[] = [T, T, T, T, F, F, F, F];
      const result = detectDensityPulses(steps, { minLength: -5 });
      expect(result).toHaveLength(1);
    });

    it("NaN windowSize -> default 4", () => {
      const steps: boolean[] = [T, T, T, T, F, F, F, F];
      const result = detectDensityPulses(steps, { windowSize: NaN });
      expect(result).toHaveLength(1);
    });

    it("undefined options -> defaults", () => {
      const steps: boolean[] = [T, T, T, T, F, F, F, F];
      const result = detectDensityPulses(steps, undefined);
      expect(result).toHaveLength(1);
    });
  });

  describe("detectDensityPulses — purity", () => {
    it("input wird nicht mutiert", () => {
      const steps: boolean[] = [T, T, T, T, F, F, F, F];
      const snapshot = JSON.stringify(steps);
      detectDensityPulses(steps);
      expect(JSON.stringify(steps)).toBe(snapshot);
    });
  });

  describe("mergePulses", () => {
    it("leeres Array -> []", () => {
      expect(mergePulses([])).toEqual([]);
    });

    it("ein Pulse -> Copy (frische Referenz)", () => {
      const input = [pulse(0, 3, 4, 1)];
      const result = mergePulses(input);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(pulse(0, 3, 4, 1));
      expect(result[0]).not.toBe(input[0]);
    });

    it("zwei disjoint Pulses -> unveraendert (sortiert)", () => {
      const result = mergePulses([
        pulse(0, 3, 4, 1),
        pulse(8, 11, 4, 1),
      ]);
      expect(result).toHaveLength(2);
      expect(result[0].startStep).toBe(0);
      expect(result[1].startStep).toBe(8);
    });

    it("zwei exakt aneinandergrenzende Pulses -> merged", () => {
      const result = mergePulses([
        pulse(0, 3, 4, 1),
        pulse(4, 7, 4, 1),
      ]);
      expect(result).toHaveLength(1);
      expect(result[0].startStep).toBe(0);
      expect(result[0].endStep).toBe(7);
      expect(result[0].hits).toBe(8);
    });

    it("zwei ueberlappende Pulses -> merged mit hits=max", () => {
      const result = mergePulses([
        pulse(0, 5, 5, 5 / 6),
        pulse(3, 8, 4, 4 / 6),
      ]);
      expect(result).toHaveLength(1);
      expect(result[0].startStep).toBe(0);
      expect(result[0].endStep).toBe(8);
      expect(result[0].hits).toBe(5);
    });

    it("unsortierte Pulses werden sortiert + gemerged", () => {
      const result = mergePulses([
        pulse(8, 11, 4, 1),
        pulse(0, 3, 4, 1),
      ]);
      expect(result.map((p) => p.startStep)).toEqual([0, 8]);
    });

    it("drei mit Mittel-Lueck -> 2 Pulses", () => {
      const result = mergePulses([
        pulse(0, 3, 4, 1),
        pulse(4, 7, 4, 1),
        pulse(15, 18, 4, 1),
      ]);
      expect(result).toHaveLength(2);
      expect(result[0].endStep).toBe(7);
      expect(result[1].startStep).toBe(15);
    });

    it("merge mutiert input nicht", () => {
      const input = [
        pulse(0, 3, 4, 1),
        pulse(4, 7, 4, 1),
      ];
      const snapshot = JSON.stringify(input);
      mergePulses(input);
      expect(JSON.stringify(input)).toBe(snapshot);
    });
  });

  describe("pulseCoverage", () => {
    it("keine Pulses -> 0", () => {
      expect(pulseCoverage([], 16)).toBe(0);
    });

    it("ein Pulse ueber die volle Laenge -> 1", () => {
      expect(pulseCoverage([pulse(0, 15, 16, 1)], 16)).toBe(1);
    });

    it("halber Coverage -> 0.5", () => {
      expect(pulseCoverage([pulse(0, 7, 8, 1)], 16)).toBe(0.5);
    });

    it("zwei disjoint Pulses je 4 Steps in 16 -> 0.5", () => {
      const pulses = [pulse(0, 3, 4, 1), pulse(8, 11, 4, 1)];
      expect(pulseCoverage(pulses, 16)).toBe(0.5);
    });

    it("ueberlappende Pulses werden nicht doppelt gezaehlt", () => {
      const pulses = [pulse(0, 5, 6, 1), pulse(3, 7, 5, 1)];
      expect(pulseCoverage(pulses, 16)).toBe(0.5);
    });

    it("totalSteps <= 0 -> 0", () => {
      expect(pulseCoverage([pulse(0, 3, 4, 1)], 0)).toBe(0);
      expect(pulseCoverage([pulse(0, 3, 4, 1)], -5)).toBe(0);
    });

    it("NaN totalSteps -> 0", () => {
      expect(pulseCoverage([pulse(0, 3, 4, 1)], NaN)).toBe(0);
    });

    it("Pulse-Indizes ausserhalb von totalSteps werden geclamped", () => {
      const result = pulseCoverage([pulse(12, 20, 9, 1)], 16);
      expect(result).toBe(0.25);
    });
  });
});
