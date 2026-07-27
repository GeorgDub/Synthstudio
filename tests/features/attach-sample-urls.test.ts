import { describe, it, expect } from "vitest";
import { attachSampleUrlsToImportResult } from "../../client/src/utils/imports/attachSampleUrls";
import type {
  ImportResult,
  ImportedPart,
} from "../../client/src/utils/imports/types";

function part(name: string, sampleId?: number): ImportedPart {
  return {
    name,
    sampleId,
    steps: [{ active: true }],
    volume: 0.8,
    pan: 0,
  };
}

function result(parts: ImportedPart[]): ImportResult {
  return {
    sourceFormat: "esx",
    fileName: "t.esx",
    patterns: [{ name: "P1", stepCount: 16, bpm: 120, parts }],
    warnings: [],
  };
}

describe("attachSampleUrlsToImportResult", () => {
  it("hängt URLs an Parts mit passender sampleId und zählt Treffer", () => {
    const res = result([part("a", 0), part("b", 5), part("c", 99)]);
    const map = new Map<number, string>([
      [0, "blob:zero"],
      [5, "blob:five"],
    ]);
    const { result: out, linkedCount } = attachSampleUrlsToImportResult(
      res,
      map
    );
    expect(linkedCount).toBe(2);
    expect(out.patterns[0].parts[0].sampleUrl).toBe("blob:zero");
    expect(out.patterns[0].parts[1].sampleUrl).toBe("blob:five");
    // sampleId 99 hat keinen Map-Eintrag → bleibt stumm.
    expect(out.patterns[0].parts[2].sampleUrl).toBeUndefined();
  });

  it("leere Map → ref-stabiler No-op (gleiche Referenz, 0 Treffer)", () => {
    const res = result([part("a", 0)]);
    const { result: out, linkedCount } = attachSampleUrlsToImportResult(
      res,
      new Map()
    );
    expect(linkedCount).toBe(0);
    expect(out).toBe(res);
  });

  it("kein Treffer trotz gefüllter Map → ref-stabiler No-op", () => {
    const res = result([part("a", 7), part("b", undefined)]);
    const { result: out, linkedCount } = attachSampleUrlsToImportResult(
      res,
      new Map([[0, "blob:zero"]])
    );
    expect(linkedCount).toBe(0);
    expect(out).toBe(res);
  });

  it("Parts ohne sampleId bleiben unangetastet", () => {
    const res = result([part("noid", undefined), part("hit", 3)]);
    const { result: out, linkedCount } = attachSampleUrlsToImportResult(
      res,
      new Map([[3, "blob:three"]])
    );
    expect(linkedCount).toBe(1);
    expect(out.patterns[0].parts[0].sampleUrl).toBeUndefined();
    expect(out.patterns[0].parts[1].sampleUrl).toBe("blob:three");
  });

  it("kopiert nur betroffene Patterns (ref-stabil für unberührte)", () => {
    const p1 = part("hit", 3);
    const untouchedPart = part("noid", undefined);
    const res: ImportResult = {
      sourceFormat: "esx",
      fileName: "t.esx",
      patterns: [
        { name: "hasHit", stepCount: 16, bpm: 120, parts: [p1] },
        { name: "noHit", stepCount: 16, bpm: 120, parts: [untouchedPart] },
      ],
      warnings: [],
    };
    const { result: out } = attachSampleUrlsToImportResult(
      res,
      new Map([[3, "blob:three"]])
    );
    // Pattern 0 wurde kopiert (Part bekam URL), Pattern 1 blieb dieselbe Ref.
    expect(out.patterns[0]).not.toBe(res.patterns[0]);
    expect(out.patterns[1]).toBe(res.patterns[1]);
  });
});
