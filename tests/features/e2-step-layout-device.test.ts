/**
 * Step-Layout gegen eine echte Gerätemessung (2026-07-30).
 *
 * Dieser Test hält den Befund fest, der die v3.306-Korrektur ausgelöst hat.
 * Der Nutzer setzte an einer Korg Electribe 2 Sampler (Hacktribe) auf Part 1
 * vier Steps mit deutlich unterschiedlicher Betonung — Step 1 laut, 5 leise,
 * 9 laut, 13 leise — und SynthStudio zeigte danach für **alle vier** die
 * Velocity 72 an. Das per Sysex zurückgeholte Pattern enthielt:
 *
 *   Step  1: 01 48 7f 01 3d …     Step  5: 01 48 08 01 3d …
 *   Step  9: 01 48 7f 01 3d …     Step 13: 01 48 19 01 3d …
 *   inaktiv: 00 48 60 00 00 …
 *
 * Byte 1 ist konstant 0x48 (= 72, alle Steps dieselbe Tonhöhe), Byte 2 folgt
 * exakt der eingestellten Betonung. Die angezeigte 72 war also das Noten-Byte.
 *
 * Die Bytes unten sind wörtlich die gemessenen. Fällt dieser Test, ist die
 * Zuordnung wieder verrutscht — und zwar gegen echte Hardware, nicht gegen
 * eine Annahme.
 */
import { describe, it, expect } from "vitest";
import { parseElectribePattern } from "@/utils/electribeImport";
import {
  buildE2PatternFile,
  type E2PatternInput,
} from "@/utils/electribePatternBuilder";

const PARTS_OFFSET = 0x900; // datei-absolut (0x100 Header + PTST+0x800)
const PART_STRIDE = 816;
const STEPS_OFFSET = 0x30;
const STEP_SIZE = 12;
const FILE_SIZE = 16640;

/** Genau die am Gerät gemessenen Records (Step-Index → erste 5 Bytes). */
const MEASURED: Record<number, number[]> = {
  0: [0x01, 0x48, 0x7f, 0x01, 0x3d], // Step 1  — laut
  4: [0x01, 0x48, 0x08, 0x01, 0x3d], // Step 5  — leise
  8: [0x01, 0x48, 0x7f, 0x01, 0x3d], // Step 9  — laut
  12: [0x01, 0x48, 0x19, 0x01, 0x3d], // Step 13 — leise
};
const INACTIVE = [0x00, 0x48, 0x60, 0x00, 0x00];

/**
 * Gültiger Container über den echten Builder, dann werden NUR die
 * Step-Records mit den gemessenen Bytes überschrieben. So hängt der Test
 * nicht an handgebauten Headern, prüft aber weiterhin exakt die Bytes vom
 * Gerät.
 */
function buildMeasuredFile(): ArrayBuffer {
  const input: E2PatternInput = {
    name: "Device",
    bpm: 120,
    stepLength: 16,
    parts: new Array(16).fill(0).map(() => ({
      steps: new Array(64).fill(0).map(() => ({ active: false })),
    })),
  };
  const f = new Uint8Array(buildE2PatternFile(input));
  expect(f.length).toBe(FILE_SIZE);
  for (let p = 0; p < 16; p++) {
    const stepBase = PARTS_OFFSET + p * PART_STRIDE + STEPS_OFFSET;
    for (let s = 0; s < 64; s++) {
      const rec = p === 0 && MEASURED[s] ? MEASURED[s] : INACTIVE;
      f.set(rec, stepBase + s * STEP_SIZE);
    }
  }
  return f.buffer;
}

describe("Step-Layout gegen die Gerätemessung vom 2026-07-30", () => {
  const parsed = () => parseElectribePattern(buildMeasuredFile());

  it("liest die gesetzten Betonungen — nicht die Note 72", () => {
    // Der eigentliche Fehler: vorher kam hier viermal die 72 heraus.
    const st = parsed().parts[0].steps;
    expect([0, 4, 8, 12].map(i => st[i].velocity)).toEqual([127, 8, 127, 25]);
  });

  it("erkennt genau die vier gesetzten Steps als aktiv", () => {
    const active = parsed()
      .parts[0].steps.map((s, i) => (s.active ? i : -1))
      .filter(i => i >= 0);
    expect(active).toEqual([0, 4, 8, 12]);
  });

  it("liefert für alle vier dieselbe Tonhöhe C5", () => {
    // Der Nutzer hat die Tonhöhe nicht verändert — 0x48 auf Byte 1.
    const st = parsed().parts[0].steps;
    expect([0, 4, 8, 12].map(i => st[i].note)).toEqual([0x48, 0x48, 0x48, 0x48]);
  });

  it("führt Gate-Flag und Gate-Länge mit", () => {
    // Ohne diese beiden verliert ein Parse→Build-Round-Trip Byte 3 und 4.
    const st = parsed().parts[0].steps;
    expect(st[0].gate).toBe(true);
    expect(st[0].gateLength).toBe(0x3d);
  });

  it("lässt inaktive Steps stumm und auf der Vorgabe", () => {
    const st = parsed().parts[0].steps;
    expect(st[1].active).toBe(false);
    expect(st[1].velocity).toBe(96); // 0x60 Vorgabe
    expect(st[1].gateLength).toBe(0x00);
  });

  it("die leisen Steps sind hörbar leiser als die lauten", () => {
    // Die Beobachtung, die alles ausgelöst hat: der Pegel schwankt.
    const st = parsed().parts[0].steps;
    expect(st[4].velocity).toBeLessThan(st[0].velocity / 2);
    expect(st[12].velocity).toBeLessThan(st[8].velocity / 2);
  });
});
