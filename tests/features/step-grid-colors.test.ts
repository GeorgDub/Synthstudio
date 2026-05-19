/**
 * Synthstudio – step-grid-colors.test.ts (v3.125.0)
 *
 * Pure-Helper-Tests für stepCellColors.ts. Kein DOM, kein JSX.
 */

import { describe, it, expect } from "vitest";
import {
  parseHexColor,
  withAlpha,
  lightenHex,
  getStepCellColor,
  getStepCellBgStyle,
  STEP_CELL_FALLBACK_COLOR,
  STEP_CELL_OPACITY_INACTIVE,
  STEP_CELL_OPACITY_HOVER_INACTIVE,
} from "../../client/src/components/DrumMachine/stepCellColors";

describe("parseHexColor", () => {
  it("parses #RRGGBB", () => {
    expect(parseHexColor("#ef4444")).toEqual({ r: 0xef, g: 0x44, b: 0x44 });
  });

  it("parses #RGB (short form)", () => {
    // #abc → #aabbcc
    expect(parseHexColor("#abc")).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc });
  });

  it("returns undefined for invalid hex", () => {
    expect(parseHexColor("ef4444")).toBeUndefined(); // no leading #
    expect(parseHexColor("#xy")).toBeUndefined();
    expect(parseHexColor("#ef44")).toBeUndefined(); // wrong length
    expect(parseHexColor("")).toBeUndefined();
    expect(parseHexColor(null)).toBeUndefined();
    expect(parseHexColor(undefined)).toBeUndefined();
    expect(parseHexColor(123 as unknown)).toBeUndefined();
  });

  it("handles uppercase hex", () => {
    expect(parseHexColor("#EF4444")).toEqual({ r: 0xef, g: 0x44, b: 0x44 });
  });
});

describe("withAlpha", () => {
  it("produces rgba string with clamped alpha", () => {
    expect(withAlpha("#ef4444", 0.5)).toBe("rgba(239, 68, 68, 0.5)");
    expect(withAlpha("#ef4444", -1)).toBe("rgba(239, 68, 68, 0)");
    expect(withAlpha("#ef4444", 5)).toBe("rgba(239, 68, 68, 1)");
  });

  it("returns fallback CSS-Var on invalid hex", () => {
    expect(withAlpha("garbage", 0.5)).toBe(STEP_CELL_FALLBACK_COLOR);
    expect(withAlpha(undefined, 0.5)).toBe(STEP_CELL_FALLBACK_COLOR);
    expect(withAlpha(null, 0.5)).toBe(STEP_CELL_FALLBACK_COLOR);
  });
});

describe("lightenHex", () => {
  it("lightens toward white", () => {
    // #000000 + 0.5 → #808080
    expect(lightenHex("#000000", 0.5)).toBe("#808080");
    // amount=0 → unchanged (lowercase)
    expect(lightenHex("#ef4444", 0)).toBe("#ef4444");
    // amount=1 → white
    expect(lightenHex("#ef4444", 1)).toBe("#ffffff");
  });

  it("returns undefined for invalid hex", () => {
    expect(lightenHex("garbage", 0.5)).toBeUndefined();
    expect(lightenHex(undefined, 0.5)).toBeUndefined();
  });
});

describe("getStepCellColor", () => {
  it("active step: full color (rgb)", () => {
    const result = getStepCellColor("#ef4444", true, false);
    expect(result).toBe("rgb(239, 68, 68)");
  });

  it("inactive step: low-opacity rgba", () => {
    const result = getStepCellColor("#ef4444", false, false);
    expect(result).toBe(`rgba(239, 68, 68, ${STEP_CELL_OPACITY_INACTIVE})`);
  });

  it("hover on active: brighter variant (lightened hex)", () => {
    const result = getStepCellColor("#000000", true, true);
    // Lighten amount = 0.12 → r=g=b=round(0+255*0.12)=31 → #1f1f1f
    expect(result).toBe("#1f1f1f");
  });

  it("hover on inactive: medium-opacity rgba", () => {
    const result = getStepCellColor("#ef4444", false, true);
    expect(result).toBe(`rgba(239, 68, 68, ${STEP_CELL_OPACITY_HOVER_INACTIVE})`);
  });

  it("fallback color when channel-color missing/invalid", () => {
    expect(getStepCellColor(undefined, true, false)).toBe(STEP_CELL_FALLBACK_COLOR);
    expect(getStepCellColor(null, false, false)).toBe(STEP_CELL_FALLBACK_COLOR);
    expect(getStepCellColor("not-a-hex", true, true)).toBe(STEP_CELL_FALLBACK_COLOR);
    expect(getStepCellColor("", false, true)).toBe(STEP_CELL_FALLBACK_COLOR);
  });

  it("handles uppercase hex", () => {
    expect(getStepCellColor("#EF4444", true, false)).toBe("rgb(239, 68, 68)");
  });

  it("getStepCellBgStyle wraps result in CSS-Object", () => {
    const style = getStepCellBgStyle("#ef4444", true, false);
    expect(style).toEqual({ backgroundColor: "rgb(239, 68, 68)" });
    const styleFallback = getStepCellBgStyle(undefined, true, false);
    expect(styleFallback).toEqual({ backgroundColor: STEP_CELL_FALLBACK_COLOR });
  });
});
