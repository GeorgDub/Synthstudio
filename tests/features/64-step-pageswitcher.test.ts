/**
 * tests/features/64-step-pageswitcher.test.ts
 *
 * v3.40.0: 64-Step Page-Switcher — pure-helpers Tests (kein jsdom nötig).
 *
 * Coverage:
 *   1. getPageCount — Page-Anzahl für 16/32/64/sonstige stepCounts
 *   2. getPageStepRange — start/end für jede Page, Clamping bei out-of-range
 *   3. getPageForStep — Page-Index für laufenden Step (Auto-Follow)
 *   4. getPageRangeLabel — "1-16", "17-32", … Display-Text
 *   5. Edge-Cases: stepCount===16 → kein Switcher, defensive Inputs
 */
import { describe, it, expect } from "vitest";
import {
  STEPS_PER_PAGE,
  getPageCount,
  getPageStepRange,
  getPageForStep,
  getPageLabel,
  getPageRangeLabel,
} from "../../client/src/components/DrumMachine/drumMachineHelpers";

describe("v3.40 64-Step Page-Switcher Helpers", () => {
  describe("getPageCount", () => {
    it("16-step pattern hat 1 Page (KEIN Switcher)", () => {
      expect(getPageCount(16)).toBe(1);
    });

    it("32-step pattern hat 2 Pages", () => {
      expect(getPageCount(32)).toBe(2);
    });

    it("64-step pattern hat 4 Pages", () => {
      expect(getPageCount(64)).toBe(4);
    });

    it("stepCount < 16 (z. B. 8) → 1 Page (kein Switcher)", () => {
      expect(getPageCount(8)).toBe(1);
    });

    it("defensive: stepCount 0 oder NaN → 1 Page", () => {
      expect(getPageCount(0)).toBe(1);
      expect(getPageCount(NaN)).toBe(1);
    });

    it("STEPS_PER_PAGE konstant 16", () => {
      expect(STEPS_PER_PAGE).toBe(16);
    });
  });

  describe("getPageStepRange", () => {
    it("64-step pattern, page 0 → steps [0, 16)", () => {
      expect(getPageStepRange(64, 0)).toEqual({ start: 0, end: 16 });
    });

    it("64-step pattern, page 1 → steps [16, 32)", () => {
      expect(getPageStepRange(64, 1)).toEqual({ start: 16, end: 32 });
    });

    it("64-step pattern, page 2 → steps [32, 48)", () => {
      expect(getPageStepRange(64, 2)).toEqual({ start: 32, end: 48 });
    });

    it("64-step pattern, page 3 → steps [48, 64)", () => {
      expect(getPageStepRange(64, 3)).toEqual({ start: 48, end: 64 });
    });

    it("32-step pattern, page 1 → steps [16, 32)", () => {
      expect(getPageStepRange(32, 1)).toEqual({ start: 16, end: 32 });
    });

    it("Out-of-range Page wird auf maxPage geclamped (z. B. 64-step, page 99 → page 3)", () => {
      expect(getPageStepRange(64, 99)).toEqual({ start: 48, end: 64 });
    });

    it("Negative Page → page 0", () => {
      expect(getPageStepRange(64, -5)).toEqual({ start: 0, end: 16 });
    });
  });

  describe("getPageForStep (Auto-Follow während Playback)", () => {
    it("64-step pattern, step 0 → page 0", () => {
      expect(getPageForStep(0, 64)).toBe(0);
    });

    it("64-step pattern, step 15 (letzter in Page 0) → page 0", () => {
      expect(getPageForStep(15, 64)).toBe(0);
    });

    it("64-step pattern, step 16 (erster in Page 1) → page 1", () => {
      expect(getPageForStep(16, 64)).toBe(1);
    });

    it("64-step pattern, step 48 → page 3", () => {
      expect(getPageForStep(48, 64)).toBe(3);
    });

    it("32-step pattern, step 17 → page 1", () => {
      expect(getPageForStep(17, 32)).toBe(1);
    });

    it("16-step pattern, step 5 → page 0 (kein Switcher)", () => {
      expect(getPageForStep(5, 16)).toBe(0);
    });

    it("defensive: negativer step → page 0", () => {
      expect(getPageForStep(-1, 64)).toBe(0);
      expect(getPageForStep(NaN, 64)).toBe(0);
    });

    it("step >= stepCount wird auf letzten Page-Index geclamped", () => {
      expect(getPageForStep(99, 64)).toBe(3);
    });
  });

  describe("getPageLabel / getPageRangeLabel", () => {
    it("getPageLabel: 64-step page 0 → '1/4'", () => {
      expect(getPageLabel(0, 64)).toBe("1/4");
    });

    it("getPageLabel: 64-step page 2 → '3/4'", () => {
      expect(getPageLabel(2, 64)).toBe("3/4");
    });

    it("getPageLabel: 32-step page 1 → '2/2'", () => {
      expect(getPageLabel(1, 32)).toBe("2/2");
    });

    it("getPageRangeLabel: 64-step page 0 → '1-16'", () => {
      expect(getPageRangeLabel(0, 64)).toBe("1-16");
    });

    it("getPageRangeLabel: 64-step page 1 → '17-32'", () => {
      expect(getPageRangeLabel(1, 64)).toBe("17-32");
    });

    it("getPageRangeLabel: 64-step page 3 → '49-64'", () => {
      expect(getPageRangeLabel(3, 64)).toBe("49-64");
    });

    it("getPageRangeLabel: 32-step page 1 → '17-32'", () => {
      expect(getPageRangeLabel(1, 32)).toBe("17-32");
    });
  });

  describe("Edge: 16-step pattern zeigt KEINEN Page-Switcher", () => {
    it("getPageCount(16) === 1 → UI rendert Switcher nur bei > 1 Pages", () => {
      const pages = getPageCount(16);
      expect(pages).toBe(1);
      // visibleStepRange in DrumMachine ist null bei pageCount <= 1
      const { start, end } = getPageStepRange(16, 0);
      expect(start).toBe(0);
      expect(end).toBe(16);
    });
  });
});
