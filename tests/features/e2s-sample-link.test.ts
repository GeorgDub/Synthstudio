/**
 * tests/features/e2s-sample-link.test.ts
 *
 * End-to-End-Verifikation der E2S-Sample-Zuweisung beim Import einer
 * .e2sallpat/.e2spat-Pattern-Datei ZUSAMMEN mit der zugehörigen .all-Sample-Bank.
 *
 * Der User-Report ("beim esx allpat und all import werden dem pattern nicht die
 * passenden Samples zugewiesen") betrifft genau diese Verkettung:
 *
 *   Pattern-Part +0x08 (u16 LE, Geräte-Sample-Nr.)  ──match per VALUE──►
 *   .all-Slot esli +0x08 (OSC_0index)  ──►  E2sSlot  ──►  abspielbares WAV
 *
 * Statt echter Geräte-Files (liegen nicht im Repo) bauen wir Bank + Pattern
 * bit-genau mit den PRODUKTIONS-Buildern (buildE2sBank / buildE2PatternFileV2)
 * und lassen sie durch die PRODUKTIONS-Reader laufen. Wenn die Nummern
 * übereinstimmen, MUSS der Link stehen — sonst ist die Kette gebrochen.
 */
import { describe, it, expect } from "vitest";
import { buildE2sBank } from "../../client/src/utils/korg/e2sBankBuilder";
import { parseE2sBank } from "../../client/src/utils/korg/e2sBankReader";
import {
  buildE2sSampleMap,
  countLinkableE2Parts,
  diagnoseE2sLink,
  summarizeE2sSampleLink,
} from "../../client/src/utils/korg/e2sPatternSampleLink";
import { buildE2PatternFileV2 } from "../../client/src/utils/e2sExport";
import {
  parseElectribePattern,
  convertParsedPatternToSynthstudio,
} from "../../client/src/utils/electribeImport";
import type { E2PatternInput } from "../../client/src/utils/electribePatternBuilder";

/** Kleines Mono-PCM (0.1s @ 44.1k, Sinus) für einen validen Slot. */
function tinyPcm(freq = 440): Float32Array {
  const n = 4410;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.sin((2 * Math.PI * freq * i) / 44100) * 0.5;
  return out;
}

/** Pattern mit einem aktiven Part, der auf `sampleNumber` verweist. */
function patternWithSampleRef(sampleNumber: number): E2PatternInput {
  const activeSteps = Array.from({ length: 16 }, (_, i) => ({
    active: i % 4 === 0,
  }));
  const parts = Array.from({ length: 16 }, (_, p) => ({
    sampleId: p === 0 ? sampleNumber : 0,
    steps: p === 0 ? activeSteps : [],
  }));
  return { name: "LINKTEST", bpm: 128, stepLength: 16, parts };
}

describe("E2S Sample-Link (Pattern-Part +0x08 ↔ .all OSC_0index)", () => {
  it("verlinkt einen Part mit seinem User-Sample (Geräte-Nr. 501)", () => {
    // 1) .all-Bank mit EINEM User-Sample unter Geräte-Nummer 501.
    const bankBuild = buildE2sBank([
      {
        slotIndex: 501,
        sampleNumber: 501,
        name: "KICK 501",
        pcmData: tinyPcm(),
        sampleRate: 44100,
        channels: 1,
      },
    ]);
    const bank = parseE2sBank(new Uint8Array(bankBuild.buffer), "e2sSample.all");
    const map = buildE2sSampleMap(bank);
    expect(map.has(501)).toBe(true);
    expect(map.get(501)?.name).toBe("KICK 501");

    // 2) Pattern-Datei mit Part 0 → sampleId 501.
    const patFile = buildE2PatternFileV2(patternWithSampleRef(501));
    const parsed = parseElectribePattern(patFile);
    expect(parsed.parts[0].sampleId).toBe(501);

    // 3) Konvertierung trägt die sampleId in den Synthstudio-Import.
    const conv = convertParsedPatternToSynthstudio(parsed);
    expect(conv.drumParts[0].sampleId).toBe(501);

    // 4) Der Part würde in der Map einen Treffer finden → Link steht.
    expect(map.has(conv.drumParts[0].sampleId)).toBe(true);
    expect(countLinkableE2Parts([conv.drumParts[0].sampleId], map)).toBe(1);
  });

  it("verlinkt mehrere Parts mit unterschiedlichen Nummern (Lücken erlaubt)", () => {
    const bankBuild = buildE2sBank([
      { slotIndex: 501, sampleNumber: 501, name: "A", pcmData: tinyPcm(220), sampleRate: 44100, channels: 1 },
      { slotIndex: 777, sampleNumber: 777, name: "B", pcmData: tinyPcm(660), sampleRate: 44100, channels: 1 },
    ]);
    const bank = parseE2sBank(new Uint8Array(bankBuild.buffer), "e2sSample.all");
    const map = buildE2sSampleMap(bank);

    const pat: E2PatternInput = {
      name: "MULTI",
      bpm: 120,
      stepLength: 16,
      parts: Array.from({ length: 16 }, (_, p) => ({
        sampleId: p === 0 ? 501 : p === 1 ? 777 : 0,
        steps: p < 2 ? [{ active: true }] : [],
      })),
    };
    const conv = convertParsedPatternToSynthstudio(parseElectribePattern(buildE2PatternFileV2(pat)));
    expect(conv.drumParts[0].sampleId).toBe(501);
    expect(conv.drumParts[1].sampleId).toBe(777);
    expect(countLinkableE2Parts([501, 777], map)).toBe(2);
  });

  it("Parts, deren Nummer NICHT in der Bank ist, bleiben ungelinkt (kein Mislink)", () => {
    // Bank hat nur 501; Pattern verweist auf 999 (z.B. Factory-Sample, das nicht
    // in der User-.all liegt) → korrekt KEIN Treffer.
    const bankBuild = buildE2sBank([
      { slotIndex: 501, sampleNumber: 501, name: "ONLY", pcmData: tinyPcm(), sampleRate: 44100, channels: 1 },
    ]);
    const map = buildE2sSampleMap(
      parseE2sBank(new Uint8Array(bankBuild.buffer), "e2sSample.all")
    );
    const conv = convertParsedPatternToSynthstudio(
      parseElectribePattern(buildE2PatternFileV2(patternWithSampleRef(999)))
    );
    expect(conv.drumParts[0].sampleId).toBe(999);
    expect(map.has(999)).toBe(false);
    expect(countLinkableE2Parts([999], map)).toBe(0);
  });

  it("sampleNumber 0 (kein Sample) wird nie an Slot gebunden", () => {
    const bankBuild = buildE2sBank([
      { slotIndex: 501, sampleNumber: 501, name: "X", pcmData: tinyPcm(), sampleRate: 44100, channels: 1 },
    ]);
    const map = buildE2sSampleMap(
      parseE2sBank(new Uint8Array(bankBuild.buffer), "e2sSample.all")
    );
    expect(map.has(0)).toBe(false);
    expect(countLinkableE2Parts([0], map)).toBe(0);
  });
});

describe("diagnoseE2sLink — erklärt WARUM (nicht) verlinkt wurde", () => {
  function bankMap(nums: number[]) {
    const build = buildE2sBank(
      nums.map(n => ({
        slotIndex: n,
        sampleNumber: n,
        name: `S${n}`,
        pcmData: tinyPcm(),
        sampleRate: 44100,
        channels: 1 as const,
      }))
    );
    return buildE2sSampleMap(
      parseE2sBank(new Uint8Array(build.buffer), "e2sSample.all")
    );
  }

  it("trennt gefundene von fehlenden Nummern und listet die Bank auf", () => {
    const map = bankMap([501, 502, 503]);
    const d = diagnoseE2sLink([501, 999, 503, 0], map);
    expect(d.requested).toEqual([501, 999, 503]); // 0 ignoriert
    expect(d.matched).toEqual([501, 503]);
    expect(d.missing).toEqual([999]);
    expect(d.available).toEqual([501, 502, 503]);
  });

  it("dedupliziert wiederholte Part-Refs", () => {
    const map = bankMap([501]);
    const d = diagnoseE2sLink([501, 501, 501], map);
    expect(d.requested).toEqual([501]);
    expect(d.matched).toEqual([501]);
  });

  it("leere Bank → alles missing, available leer", () => {
    const map = bankMap([]);
    const d = diagnoseE2sLink([501, 777], map);
    expect(d.matched).toEqual([]);
    expect(d.missing).toEqual([501, 777]);
    expect(d.available).toEqual([]);
  });
});

describe("summarizeE2sSampleLink — Toast-Text für den Import", () => {
  function bankMap(nums: number[]) {
    const build = buildE2sBank(
      nums.map(n => ({
        slotIndex: n,
        sampleNumber: n,
        name: `S${n}`,
        pcmData: tinyPcm(),
        sampleRate: 44100,
        channels: 1 as const,
      }))
    );
    return buildE2sSampleMap(
      parseE2sBank(new Uint8Array(build.buffer), "e2sSample.all")
    );
  }

  it("keine Bank + Sample-Refs → Hinweis, .all zusätzlich zu wählen", () => {
    const msg = summarizeE2sSampleLink(false, [501, 502], 0, null);
    expect(msg.summary).toBe("");
    expect(msg.hint).toContain("e2sSample.all");
    expect(msg.hint).toContain("501");
  });

  it("keine Bank + keine Sample-Refs → gar kein Hinweis", () => {
    const msg = summarizeE2sSampleLink(false, [], 0, null);
    expect(msg.summary).toBe("");
    expect(msg.hint).toBeUndefined();
  });

  it("Bank + alle Treffer → nur Summary, kein Hinweis", () => {
    const map = bankMap([501, 502]);
    const msg = summarizeE2sSampleLink(true, [501, 502], 2, map);
    expect(msg.summary).toBe(", 2/2 Spur(en) mit Sample");
    expect(msg.hint).toBeUndefined();
  });

  it("Bank + Teil-Treffer → Summary + Diagnose-Hinweis mit fehlenden Nummern", () => {
    const map = bankMap([501, 502, 503]);
    const msg = summarizeE2sSampleLink(true, [501, 999], 1, map);
    expect(msg.summary).toBe(", 1/2 Spur(en) mit Sample");
    expect(msg.hint).toContain("999"); // fehlt
    expect(msg.hint).toContain("501"); // Bank hat
  });

  it("Bank + null Treffer → Hinweis nennt gesuchte vs. vorhandene Nummern", () => {
    const map = bankMap([501, 502]);
    const msg = summarizeE2sSampleLink(true, [10, 20], 0, map);
    expect(msg.summary).toBe(", 0/2 Spur(en) mit Sample");
    expect(msg.hint).toContain("10");
    expect(msg.hint).toContain("501");
  });
});
