/**
 * tests/features/esx-import-steps.test.ts
 *
 * Synth.md-Fix: der generische Import-Pfad (ProjectManager → importElectribe)
 * erzeugte für .esx nur LEERE Step-Templates ("nur die Sampler, keine Steps").
 * esxBankToImportResult() bridged stattdessen die echt-dekodierte ESX-Bank in
 * ein ImportResult mit realen Step-Triggern. Pure Funktion → mit handgebauten
 * EsxBank-Objekten testbar (kein 25-MB-Binär-Parsing nötig).
 */
import { describe, it, expect } from "vitest";
import { esxBankToImportResult } from "../../client/src/utils/imports/electribeImport";
import type {
  EsxBank,
  EsxPattern,
  EsxPart,
  EsxStepEvent,
} from "../../client/src/utils/korg/esxParser";

function step(active: boolean, velocity = 100): EsxStepEvent {
  return { active, velocity };
}

function makePart(
  partIndex: number,
  activeSteps: number[],
  opts: Partial<EsxPart> = {}
): EsxPart {
  const steps: EsxStepEvent[] = Array.from({ length: 16 }, (_, i) =>
    step(activeSteps.includes(i), activeSteps.includes(i) ? 110 : 100)
  );
  return {
    partIndex,
    sampleId: opts.sampleId ?? partIndex,
    volume: opts.volume ?? 100,
    pan: opts.pan ?? 64,
    pitch: opts.pitch ?? 0,
    fxAmount: 0,
    steps,
  };
}

function makePattern(
  index: number,
  name: string,
  parts: EsxPart[]
): EsxPattern {
  // Fülle bis 16 Parts mit leeren Slots auf (wie der echte Parser).
  const full = [...parts];
  for (let i = full.length; i < 16; i++) full.push(makePart(i, []));
  return { index, name, bpm: 140, lengthSteps: 16, swing: 0, parts: full };
}

function makeBank(
  patterns: EsxPattern[],
  opts: Partial<EsxBank> = {}
): EsxBank {
  return {
    source: "TEST.esx",
    monoSamples: opts.monoSamples ?? [],
    stereoSamples: opts.stereoSamples ?? [],
    patterns,
    songs: [],
    declaredMonoCount: opts.declaredMonoCount ?? 0,
    declaredStereoCount: opts.declaredStereoCount ?? 0,
    warnings: opts.warnings ?? [],
  };
}

describe("esxBankToImportResult", () => {
  it("überträgt echte Step-Trigger (nicht leere Templates)", () => {
    const bank = makeBank([
      makePattern(0, "KICKPAT", [
        makePart(0, [0, 4, 8, 12]), // Kick auf jedem Viertel
        makePart(1, [4, 12]), // Snare auf 2 + 4
      ]),
    ]);
    const result = esxBankToImportResult(bank, "TEST.esx");

    expect(result.sourceFormat).toBe("esx");
    expect(result.patterns).toHaveLength(1);
    const pat = result.patterns[0];
    expect(pat.name).toBe("KICKPAT");
    expect(pat.bpm).toBe(140);

    const kick = pat.parts[0];
    const activeIdx = kick.steps
      .map((s, i) => (s.active ? i : -1))
      .filter(i => i >= 0);
    expect(activeIdx).toEqual([0, 4, 8, 12]);
    // Velocity der aktiven Steps kommt aus der Bank durch, nicht Default.
    expect(kick.steps[0].velocity).toBe(110);

    const snare = pat.parts[1];
    const snareIdx = snare.steps
      .map((s, i) => (s.active ? i : -1))
      .filter(i => i >= 0);
    expect(snareIdx).toEqual([4, 12]);
  });

  it("liefert Parts mit Sample-Hint-Namen (v3.286-Layout)", () => {
    // makePattern füllt bis 16 Parts auf; der Converter mappt jeden. Die Labels
    // folgen dem verifizierten 14-Part-Layout (9 Drum, 3 Stretch/Slice, 2 Synth).
    const bank = makeBank([makePattern(0, "P1", [makePart(0, [0])])]);
    const result = esxBankToImportResult(bank, "TEST.esx");
    expect(result.patterns[0].parts[0].name).toBe("ESX Drum 1");
    expect(result.patterns[0].parts[9].name).toBe("ESX Stretch/Slice 1");
    expect(result.patterns[0].parts[12].name).toBe("ESX Synth 1");
  });

  it("top-level bpm = bpm des ersten Patterns", () => {
    const bank = makeBank([
      makePattern(0, "A", [makePart(0, [0])]),
      makePattern(1, "B", [makePart(0, [2])]),
    ]);
    const result = esxBankToImportResult(bank, "TEST.esx");
    expect(result.patterns).toHaveLength(2);
    expect(result.bpm).toBe(140);
  });

  it("meldet erkannte Samples + Hinweis auf Blob-URL-Nachreichung", () => {
    const bank = makeBank([makePattern(0, "P1", [makePart(0, [0])])], {
      monoSamples: [{} as never, {} as never],
      stereoSamples: [{} as never],
    });
    const result = esxBankToImportResult(bank, "TEST.esx");
    expect(result.warnings.some(w => /3 Sample/.test(w))).toBe(true);
    // Sample-Audio ist jetzt via Controller verlinkbar (sampleId erhalten) —
    // der Hinweis nennt die Blob-URL-Nachreichung statt „KORG-Bank öffnen".
    expect(result.warnings.some(w => /Blob-URL|sampleId/.test(w))).toBe(true);
  });

  it("reicht Parser-Warnungen der Bank durch", () => {
    const bank = makeBank([makePattern(0, "P1", [makePart(0, [0])])], {
      warnings: ["pattern area truncated: foo"],
    });
    const result = esxBankToImportResult(bank, "TEST.esx");
    expect(result.warnings).toContain("pattern area truncated: foo");
  });

  it("leere Bank → 0 Patterns, kein Throw", () => {
    const result = esxBankToImportResult(makeBank([]), "EMPTY.esx");
    expect(result.patterns).toHaveLength(0);
    expect(result.bpm).toBeUndefined();
  });
});
