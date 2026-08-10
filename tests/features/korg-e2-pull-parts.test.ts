/**
 * Synthstudio – korg-e2-pull-parts.test.ts (v3.318.0)
 *
 * Am Gerät gefunden (HW-Sitzung 2026-08-10): Ein neues Projekt hat 9 Kanäle,
 * ein E2/E2S liefert beim Pull immer 16 Parts. Der Pull-Pfad lief über
 * `Math.min(decoded.parts.length, active.parts.length)` — die Parts 10..16 des
 * Geräts fielen still weg. Nichts meldete das; im Raster fehlten sie einfach.
 *
 * Zwei Bausteine, beide pur und hier direkt geprüft:
 *   1. `applyEnsureParts`  — legt fehlende Parts an, damit 16 Platz haben.
 *   2. `e2PulledPartName`  — schreibt die Sample-Nummer in den Part-Namen,
 *      denn der Push-Pfad (`parseSampleIdFromName`) liest sie von dort. Ohne
 *      das verliert ein Pull→Push-Roundtrip die Sample-Zuordnung.
 */
import { describe, it, expect } from "vitest";
import { applyEnsureParts } from "../../client/src/store/useDrumMachineStore";
import { e2PulledPartName } from "../../client/src/utils/korg/e2PatternToSynthstudio";
import { parseSampleIdFromName } from "../../client/src/utils/korg/synthstudioToE2Pattern";
import type { PatternData, PartData } from "../../client/src/audio/AudioEngine";

function makeTestPart(id: string, name: string, steps: number): PartData {
  return {
    id,
    name,
    muted: false,
    soloed: false,
    volume: 1,
    pan: 0,
    steps: Array.from({ length: steps }, () => ({
      active: false,
      velocity: 100,
      pitch: 0,
    })),
    fx: {} as PartData["fx"],
  };
}

function makeTestPattern(id: string, partCount: number): PatternData {
  return {
    id,
    name: `Pattern ${id}`,
    stepCount: 64,
    stepResolution: "1/16",
    bpm: null,
    parts: Array.from({ length: partCount }, (_, i) =>
      makeTestPart(`${id}-p${i}`, `Kanal ${i + 1}`, 64)
    ),
  } as PatternData;
}

describe("applyEnsureParts — fehlende Parts für einen Geräte-Pull anlegen", () => {
  it("wächst von 9 auf 16 Parts, wenn 7 neue IDs übergeben werden", () => {
    const patterns = [makeTestPattern("a", 9)];
    const neu = ["n1", "n2", "n3", "n4", "n5", "n6", "n7"];

    const out = applyEnsureParts(patterns, "a", neu);

    expect(out[0].parts).toHaveLength(16);
  });

  it("gibt den neuen Parts genau die übergebenen IDs", () => {
    const patterns = [makeTestPattern("a", 9)];

    const out = applyEnsureParts(patterns, "a", ["n1", "n2"]);

    expect(out[0].parts.slice(9).map(p => p.id)).toEqual(["n1", "n2"]);
  });

  it("gibt neuen Parts so viele Steps wie das Pattern lang ist", () => {
    const patterns = [makeTestPattern("a", 9)];

    const out = applyEnsureParts(patterns, "a", ["n1"]);

    expect(out[0].parts[9].steps).toHaveLength(64);
    expect(out[0].parts[9].steps.every(s => !s.active)).toBe(true);
  });

  it("lässt andere Patterns unangetastet", () => {
    const patterns = [makeTestPattern("a", 9), makeTestPattern("b", 9)];

    const out = applyEnsureParts(patterns, "a", ["n1"]);

    expect(out[1].parts).toHaveLength(9);
  });

  it("ändert nichts, wenn keine neuen IDs kommen", () => {
    const patterns = [makeTestPattern("a", 16)];

    const out = applyEnsureParts(patterns, "a", []);

    expect(out).toBe(patterns);
  });
});

describe("e2PulledPartName — Sample-Nummer im Part-Namen führen", () => {
  it("hängt die Sample-Nummer an den bestehenden Namen", () => {
    expect(e2PulledPartName("Kick", 519, 0)).toBe("Kick · #519");
  });

  it("ersetzt beim zweiten Pull die alte Nummer, statt sie zu verdoppeln", () => {
    expect(e2PulledPartName("Kick · #519", 520, 0)).toBe("Kick · #520");
  });

  it("nimmt die Nummer wieder weg, wenn der Part kein Sample mehr hat", () => {
    expect(e2PulledPartName("Kick · #519", 0, 0)).toBe("Kick");
  });

  // Der Fallback muss dieselbe Basis liefern wie `applyEnsureParts` beim
  // Anlegen ("Kanal N") — sonst heissen die frisch angelegten Parts nach dem
  // Umbenennen anders als vorher, und ein zweiter Pull haengt die Nummer an
  // einen anderen Namen als der erste.
  it("benennt einen frisch angelegten Part wie der Store ihn angelegt hat", () => {
    expect(e2PulledPartName(undefined, 501, 9)).toBe("Kanal 10 · #501");
  });

  it("erzeugt einen Namen, aus dem der Push-Pfad die Nummer zurückliest", () => {
    const name = e2PulledPartName("Kick", 519, 0);

    expect(parseSampleIdFromName(name)).toBe(519);
  });

  // v3.320: Das Pattern trägt nur die NUMMER. Liegt eine .all-Bank im Projekt,
  // kann die Nummer zu einem echten Namen aufgelöst werden — dann soll der
  // Kanal so heissen wie das Sample, nicht wie Synthstudios Vorbelegung.
  it("nimmt den aufgelösten Sample-Namen als Basis, wenn eine Bank ihn liefert", () => {
    expect(e2PulledPartName("Kick", 584, 0, "Jumpkick")).toBe("Jumpkick · #584");
  });

  it("bleibt beim bisherigen Namen, wenn die Bank die Nummer nicht kennt", () => {
    expect(e2PulledPartName("Kick", 584, 0, undefined)).toBe("Kick · #584");
  });

  it("faellt bei leerem Sample-Namen nicht auf einen leeren Kanalnamen zurueck", () => {
    expect(e2PulledPartName("Kick", 584, 0, "   ")).toBe("Kick · #584");
  });

  it("ersetzt beim zweiten Pull den aufgelösten Namen sauber", () => {
    expect(e2PulledPartName("Jumpkick · #584", 590, 0, "clydesna")).toBe(
      "clydesna · #590"
    );
  });
});
