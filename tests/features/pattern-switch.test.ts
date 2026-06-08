/**
 * tests/features/pattern-switch.test.ts (v3.269)
 *
 * Pure-Coverage für shouldQuantizeSwitch — die Entscheidung, ob ein
 * Performance-Pad-Switch quantisiert (Engine-Queue) oder sofort läuft.
 */
import { describe, it, expect } from "vitest";
import { shouldQuantizeSwitch } from "@/utils/patternSwitch";

describe("shouldQuantizeSwitch", () => {
  it("playing + bar → quantisiert (true)", () => {
    expect(shouldQuantizeSwitch(true, "bar")).toBe(true);
  });

  it("playing + beat → quantisiert (true)", () => {
    expect(shouldQuantizeSwitch(true, "beat")).toBe(true);
  });

  it("playing + step → sofort (false, step ist effektiv sofort)", () => {
    expect(shouldQuantizeSwitch(true, "step")).toBe(false);
  });

  it("gestoppt → immer sofort, egal welcher Quantize-Modus", () => {
    expect(shouldQuantizeSwitch(false, "bar")).toBe(false);
    expect(shouldQuantizeSwitch(false, "beat")).toBe(false);
    expect(shouldQuantizeSwitch(false, "step")).toBe(false);
  });
});
