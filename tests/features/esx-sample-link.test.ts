/**
 * tests/features/esx-sample-link.test.ts
 *
 * Coverage für die ESX-Pattern→Bank-Sample-Zuordnung (Synth.md: ".esx geladen,
 * zugewiesen, aber Play spielt nicht" — Parts hatten keine sampleUrl).
 */
import { describe, it, expect } from "vitest";
import {
  resolveSlotForPart,
  buildSlotIndexMap,
  countLinkablePats,
} from "../../client/src/utils/korg/esxSampleLink";

const slots = [{ index: 0 }, { index: 5 }, { index: 12 }];

describe("resolveSlotForPart", () => {
  it("Happy Path: exakter sampleId-Match liefert Array-Index", () => {
    expect(resolveSlotForPart({ partIndex: 0, sampleId: 5 }, slots)).toBe(1);
    expect(resolveSlotForPart({ partIndex: 1, sampleId: 12 }, slots)).toBe(2);
  });

  it("Edge Case: kein Match → -1 (Part bleibt stumm, keine Regression)", () => {
    expect(resolveSlotForPart({ partIndex: 0, sampleId: 99 }, slots)).toBe(-1);
  });

  it("Edge Case: NaN sampleId → -1", () => {
    expect(resolveSlotForPart({ partIndex: 0, sampleId: NaN }, slots)).toBe(-1);
  });

  it("leere Slot-Liste → -1", () => {
    expect(resolveSlotForPart({ partIndex: 0, sampleId: 0 }, [])).toBe(-1);
  });
});

describe("buildSlotIndexMap", () => {
  it("mappt sampleId → Array-Position", () => {
    const map = buildSlotIndexMap(slots);
    expect(map.get(0)).toBe(0);
    expect(map.get(5)).toBe(1);
    expect(map.get(12)).toBe(2);
    expect(map.has(7)).toBe(false);
  });

  it("Erster-Treffer-gewinnt bei doppeltem Index", () => {
    const map = buildSlotIndexMap([{ index: 3 }, { index: 3 }]);
    expect(map.get(3)).toBe(0);
  });
});

describe("countLinkablePats", () => {
  it("zählt Parts mit auflösbarem Sample", () => {
    const parts = [
      { partIndex: 0, sampleId: 0 },
      { partIndex: 1, sampleId: 5 },
      { partIndex: 2, sampleId: 99 }, // kein Slot
    ];
    expect(countLinkablePats(parts, slots)).toBe(2);
  });

  it("keine Parts → 0", () => {
    expect(countLinkablePats([], slots)).toBe(0);
  });
});
