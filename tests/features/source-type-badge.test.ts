/**
 * Synthstudio – getSourceTypeBadge Tests (v2.51 / TASK-129 Welle 3)
 */
import { describe, it, expect } from "vitest";
import { getSourceTypeBadge } from "../../client/src/components/DrumMachine/drumMachineHelpers";

describe("getSourceTypeBadge (v2.51)", () => {
  it("undefined → SMP (sample = Default)", () => {
    const b = getSourceTypeBadge(undefined);
    expect(b.label).toBe("SMP");
    expect(b.isSample).toBe(true);
    expect(b.long).toMatch(/sample/i);
  });

  it("'sample' → SMP", () => {
    expect(getSourceTypeBadge("sample").label).toBe("SMP");
    expect(getSourceTypeBadge("sample").isSample).toBe(true);
  });

  it("'wavetable' → WT (kein Sample-Stil)", () => {
    const b = getSourceTypeBadge("wavetable");
    expect(b.label).toBe("WT");
    expect(b.isSample).toBe(false);
    expect(b.long).toMatch(/wavetable/i);
  });

  it("'fm' → FM", () => {
    const b = getSourceTypeBadge("fm");
    expect(b.label).toBe("FM");
    expect(b.isSample).toBe(false);
    expect(b.long).toMatch(/fm/i);
  });

  it("'granular' → GR", () => {
    const b = getSourceTypeBadge("granular");
    expect(b.label).toBe("GR");
    expect(b.isSample).toBe(false);
    expect(b.long).toMatch(/granular/i);
  });

  it("Unbekannter String → SMP-Fallback (kein Crash)", () => {
    const b = getSourceTypeBadge("frobnicate");
    expect(b.label).toBe("SMP");
    expect(b.isSample).toBe(true);
  });

  it("Labels sind kompakt (max 3 Zeichen) für Mini-Badge-UI", () => {
    for (const s of [undefined, "sample", "wavetable", "fm", "granular"]) {
      expect(getSourceTypeBadge(s).label.length).toBeLessThanOrEqual(3);
    }
  });
});
