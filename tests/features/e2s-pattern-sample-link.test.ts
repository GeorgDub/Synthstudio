/**
 * tests/features/e2s-pattern-sample-link.test.ts
 *
 * v3.272 — verifiziert die VALUE-basierte Verknüpfung von E2-Pattern-Parts mit
 * Samples einer separaten .all-Bank über die Geräte-Sample-Nummer (OSC_0index).
 *
 *   Pattern-Part.sampleId (+0x08, z.B. 501+)  ==  E2sSlot.sampleNumber (+0x08)
 *
 * Pure-Map-Test immer; Full-Chain gegen die generierten BOTTROP-Artefakte nur
 * wenn vorhanden (examples/e2s/).
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  bankSamplesToLibraryEntries,
  buildE2sSampleMap,
  countLinkableE2Parts,
  e2sLibraryEntryId,
} from "../../client/src/utils/korg/e2sPatternSampleLink";
import { parseE2sBank } from "../../client/src/utils/korg/e2sBankReader";
import { parseElectribeAllPatBank } from "../../client/src/utils/electribeImport";

describe("e2sPatternSampleLink — buildE2sSampleMap (pure)", () => {
  it("keyed by sampleNumber (OSC_0index), skips 0, first-wins", () => {
    const bank = {
      version: 1,
      slots: [
        { sampleNumber: 501, name: "a" },
        null,
        { sampleNumber: 502, name: "b" },
        { sampleNumber: 0, name: "empty" }, // ignored
        { sampleNumber: 501, name: "dup" }, // first wins → "a"
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const map = buildE2sSampleMap(bank);
    expect(map.size).toBe(2);
    expect(map.get(501)?.name).toBe("a");
    expect(map.get(502)?.name).toBe("b");
    expect(map.has(0)).toBe(false);
    expect(countLinkableE2Parts([501, 502, 999], map)).toBe(2);
  });
});

const EXAMPLE_DIR = path.resolve(process.cwd(), "examples", "e2s");
const ALL = path.join(EXAMPLE_DIR, "bottrop-samples.all");
const PAT = path.join(EXAMPLE_DIR, "bottrop-test.e2sallpat");
const AVAILABLE = (() => {
  try {
    return fs.existsSync(ALL) && fs.existsSync(PAT);
  } catch {
    return false;
  }
})();

(AVAILABLE ? describe : describe.skip)("e2sPatternSampleLink — BOTTROP full-chain", () => {
  it("every active pattern part resolves to a sample by device number", () => {
    const bank = parseE2sBank(new Uint8Array(fs.readFileSync(ALL)), "bottrop-samples.all");
    const map = buildE2sSampleMap(bank);
    // The .all numbers run 501..N; the bank parser must expose them.
    expect(map.size).toBeGreaterThan(0);
    expect([...map.keys()].every((k) => k >= 501)).toBe(true);

    const patBank = parseElectribeAllPatBank(new Uint8Array(fs.readFileSync(PAT)));
    let activeParts = 0;
    let linked = 0;
    let repointed = 0; // active parts that carry a user-sample ref (>= 501)
    let repointedLinked = 0;
    for (const pat of patBank.patterns) {
      for (const part of pat.parts) {
        if (!part.steps.some((s) => s.active)) continue;
        activeParts++;
        const isUserRef = part.sampleId >= 501;
        if (isUserRef) repointed++;
        if (map.has(part.sampleId)) {
          linked++;
          if (isUserRef) repointedLinked++;
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`[BOTTROP link] ${activeParts} active parts, ${linked} linked (${(100 * linked / activeParts).toFixed(0)}%), repointed(>=501)=${repointed}, map size ${map.size}`);
    expect(activeParts).toBeGreaterThan(0);
    // Every part repointed to a user sample (>= 501) MUST resolve — both sides
    // were written from the same map, so this is exact. Parts whose ESX sample
    // wasn't extractable keep a template ref (< 501) and legitimately don't link.
    expect(repointed).toBeGreaterThan(0);
    expect(repointedLinked).toBe(repointed);
  });
});

// ─── v3.299 — Library-Eintraege für den Sample-Browser ────────────────────────

describe("bankSamplesToLibraryEntries", () => {
  /** Minimale Bank-Attrappe; nur die Felder, die der Helfer anfasst. */
  function fakeBank(
    slots: Array<{ sampleNumber: number; categoryName?: string } | null>,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { version: 1, slots, warnings: [] } as any;
  }
  const resolveOk = (n: number) => ({ url: `blob:${n}`, name: `S${n}` });

  it("macht aus jedem belegten Slot einen Library-Eintrag", () => {
    const entries = bankSamplesToLibraryEntries(
      fakeBank([
        { sampleNumber: 501, categoryName: "Drum" },
        { sampleNumber: 502, categoryName: "Vocal" },
      ]),
      "e2sSample.all",
      resolveOk,
    );
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      id: "e2s:e2sSample.all:501",
      name: "S501",
      path: "blob:501",
      category: "E2S · Drum",
    });
    expect(entries[1].category).toBe("E2S · Vocal");
  });

  it("überspringt leere Slots und Sample-Nummer 0", () => {
    // Dieselbe Bedingung wie buildE2sSampleMap — sonst zeigte der Browser
    // Samples an, die kein Pattern-Part je treffen kann.
    const entries = bankSamplesToLibraryEntries(
      fakeBank([null, { sampleNumber: 0 }, { sampleNumber: 501 }]),
      "b.all",
      resolveOk,
    );
    expect(entries.map(e => e.id)).toEqual(["e2s:b.all:501"]);
  });

  it("deckt sich mit dem, was buildE2sSampleMap auflösen kann", () => {
    const bank = fakeBank([
      null,
      { sampleNumber: 0 },
      { sampleNumber: 501 },
      { sampleNumber: 777 },
    ]);
    const map = buildE2sSampleMap(bank);
    const entries = bankSamplesToLibraryEntries(bank, "b.all", resolveOk);
    expect(entries).toHaveLength(map.size);
  });

  it("lässt bereits bekannte IDs aus — zweiter Import legt nichts doppelt an", () => {
    // addSamples dedupliziert über `path`, und Blob-URLs sind bei jedem Import
    // neu. Ohne den stabilen Schlüssel wäre die Library nach dem zweiten
    // Import derselben Bank doppelt so lang.
    const bank = fakeBank([{ sampleNumber: 501 }, { sampleNumber: 502 }]);
    const known = new Set(["e2s:b.all:501"]);
    const entries = bankSamplesToLibraryEntries(bank, "b.all", resolveOk, known);
    expect(entries.map(e => e.id)).toEqual(["e2s:b.all:502"]);
  });

  it("trennt gleiche Nummern aus verschiedenen Bänken", () => {
    const bank = fakeBank([{ sampleNumber: 501 }]);
    const a = bankSamplesToLibraryEntries(bank, "a.all", resolveOk);
    const b = bankSamplesToLibraryEntries(bank, "b.all", resolveOk);
    expect(a[0].id).not.toBe(b[0].id);
  });

  it("entdoppelt auch innerhalb einer Bank", () => {
    const entries = bankSamplesToLibraryEntries(
      fakeBank([{ sampleNumber: 501 }, { sampleNumber: 501 }]),
      "b.all",
      resolveOk,
    );
    expect(entries).toHaveLength(1);
  });

  it("überspringt Slots, die der Resolver nicht auflöst", () => {
    const entries = bankSamplesToLibraryEntries(
      fakeBank([{ sampleNumber: 501 }, { sampleNumber: 502 }]),
      "b.all",
      n => (n === 501 ? resolveOk(n) : null),
    );
    expect(entries.map(e => e.id)).toEqual(["e2s:b.all:501"]);
  });

  it("benutzt den Namen des Resolvers, nicht den Slot-Namen", () => {
    // Der Resolver hat den Fallback "Sample <n>" für namenlose Slots; ihn zu
    // umgehen hiesse, im Browser leere Namen zu zeigen.
    const entries = bankSamplesToLibraryEntries(
      fakeBank([{ sampleNumber: 501 }]),
      "b.all",
      () => ({ url: "blob:x", name: "Sample 501" }),
    );
    expect(entries[0].name).toBe("Sample 501");
  });

  it("liefert eine leere Liste statt zu werfen, wenn die Bank leer ist", () => {
    expect(bankSamplesToLibraryEntries(fakeBank([]), "b.all", resolveOk)).toEqual([]);
    expect(bankSamplesToLibraryEntries(fakeBank([null, null]), "b.all", resolveOk)).toEqual([]);
  });

  it("e2sLibraryEntryId ist stabil und bankspezifisch", () => {
    expect(e2sLibraryEntryId("e2sSample.all", 501)).toBe("e2s:e2sSample.all:501");
    expect(e2sLibraryEntryId("e2sSample.all", 501)).toBe(
      e2sLibraryEntryId("e2sSample.all", 501),
    );
    expect(e2sLibraryEntryId("x.all", 501)).not.toBe(e2sLibraryEntryId("y.all", 501));
  });
});
