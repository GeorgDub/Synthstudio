/**
 * Synthstudio – korg-e2-push-original-body.test.ts
 *
 * Der Bedienende: „alle gepullten Daten sollen genauso übernommen werden wie
 * sie sind und beim Push auch genauso wieder geschickt werden."
 *
 * Das geht nur, wenn der Push den ORIGINAL-Body patcht statt einen neuen zu
 * bauen. `buildE2PatternBody` setzt auf einem festen Init-Template auf und
 * schreibt die Felder hinein, die SynthStudio kennt. Alles andere im
 * 0x4000-Body — FX-Routing, Groove, Motion, was der Dekoder gar nicht erst
 * liest — kam damit als WERKSEINSTELLUNG zurück aufs Gerät, bei jedem Push,
 * unbemerkt.
 *
 * Die Probe ist scharf und braucht kein Gerät: ein echtes Pattern dekodieren,
 * NICHTS ändern, zurückbauen — das Ergebnis muss Byte für Byte das Original
 * sein. Jede Abweichung ist ein Feld, das ein Push am Gerät zerstören würde.
 *
 * ★ Die Fehlermeldung nennt die Offsets und ordnet sie dem Part zu. „Bodies
 * ungleich" hieße nur, das Raten zu verschieben.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import { decodePatternBody } from "../../client/src/utils/korg/e2Sysex";
import { e2PatternToSynthstudio } from "../../client/src/utils/korg/e2PatternToSynthstudio";
import { synthstudioPatternToE2 } from "../../client/src/utils/korg/synthstudioToE2Pattern";
import { buildE2PatternBody } from "../../client/src/utils/e2sExport";
import {
  E2_ALLPAT_PATTERN_OFFSET,
  E2_ALLPAT_PATTERN_STRIDE,
  E2_PATTERN_BODY_SIZE,
  E2_PART_TABLE_OFFSET,
  E2_PART_STRIDE,
  E2_PART_COUNT,
} from "../../client/src/utils/korg/e2Layout";

const BANK = path.resolve(
  __dirname,
  "../../examples/e2s/bottrop-test.e2sallpat"
);

function patternBody(index: number): Uint8Array {
  const datei = fs.readFileSync(BANK);
  const start = E2_ALLPAT_PATTERN_OFFSET + index * E2_ALLPAT_PATTERN_STRIDE;
  return new Uint8Array(
    datei.subarray(start, start + E2_PATTERN_BODY_SIZE)
  );
}

/** Ordnet einen Offset dem zu, was dort liegt — sonst sagt die Zahl nichts. */
function deute(offset: number): string {
  if (offset < E2_PART_TABLE_OFFSET) return `Pattern-Kopf +0x${offset.toString(16)}`;
  const rel = offset - E2_PART_TABLE_OFFSET;
  const part = Math.floor(rel / E2_PART_STRIDE);
  if (part >= E2_PART_COUNT) return `hinter der Part-Tabelle +0x${offset.toString(16)}`;
  const imPart = rel % E2_PART_STRIDE;
  const wo =
    imPart < 0x30
      ? `Part-Kopf +0x${imPart.toString(16)}`
      : `Step ${Math.floor((imPart - 0x30) / 12) + 1} +0x${((imPart - 0x30) % 12).toString(16)}`;
  return `Part ${part + 1} ${wo}`;
}

function unterschiede(a: Uint8Array, b: Uint8Array): string[] {
  const raus: string[] = [];
  for (let i = 0; i < a.length && raus.length < 25; i++) {
    if (a[i] !== b[i]) {
      raus.push(`${deute(i)}: 0x${a[i].toString(16)} → 0x${b[i].toString(16)}`);
    }
  }
  return raus;
}

describe("Push auf dem Original-Body", () => {
  const vorhanden = fs.existsSync(BANK);

  it.skipIf(!vorhanden)(
    "gibt ein unverändert gepulltes Pattern Byte für Byte zurück",
    () => {
      const original = patternBody(0);
      const decoded = decodePatternBody(original);
      const pattern = e2PatternToSynthstudio(decoded);
      const eingabe = synthstudioPatternToE2(pattern, { bpm: decoded.bpm });

      const zurueck = buildE2PatternBody(eingabe, { base: original });

      expect(unterschiede(original, zurueck)).toEqual([]);
      expect(zurueck.length).toBe(original.length);
    }
  );

  it.skipIf(!vorhanden)(
    "schreibt eine geänderte Lautstärke trotzdem durch",
    () => {
      // Gegenprobe zum Test oben: ein Patcher, der einfach das Original
      // zurückgibt, bestünde jenen — und wäre wertlos.
      const original = patternBody(0);
      const decoded = decodePatternBody(original);
      const pattern = e2PatternToSynthstudio(decoded);
      pattern.parts[0].volume = 0.25;
      const eingabe = synthstudioPatternToE2(pattern, { bpm: decoded.bpm });

      const zurueck = buildE2PatternBody(eingabe, { base: original });

      expect(zurueck[E2_PART_TABLE_OFFSET + 0x18]).toBe(Math.round(0.25 * 127));
    }
  );

  // ── Die eigentliche Probe: von Korg selbst geschriebene Patterns ──────────
  //
  // `bottrop-test` stammt aus genau diesem Builder — dagegen zu prüfen hieße,
  // den Builder gegen sich selbst zu prüfen. Die Werksbank e2s-2016 hat das
  // Gerät geschrieben; nur sie enthält, was SynthStudio gar nicht liest.

  const FIXTURE = path.resolve(
    __dirname,
    "../fixtures/e2s/werksbank-pattern.bin"
  );
  const WERKSBANK = path.resolve(__dirname, "../../e2s-2016/e2s-2016.e2sallpat");

  it("gibt ein Werks-Pattern (Korg, 64 Steps, Akkorde, Ties) unverändert zurück", () => {
    const original = new Uint8Array(fs.readFileSync(FIXTURE));
    const decoded = decodePatternBody(original);
    const eingabe = synthstudioPatternToE2(e2PatternToSynthstudio(decoded), {
      bpm: decoded.bpm,
    });

    const zurueck = buildE2PatternBody(eingabe, { base: original });

    expect(unterschiede(original, zurueck)).toEqual([]);
  });

  it.skipIf(!fs.existsSync(WERKSBANK))(
    "gibt ALLE 250 Werks-Patterns unverändert zurück",
    () => {
      // Ein Treffer ist keine Trennschärfe. Die Werksbank deckt Randfälle ab,
      // die ein einzelnes Pattern nicht hat — Ties (0xFF), Akkorde, alle drei
      // Schrittzahlen, leere Parts. Die Datei ist gitignored (4 MB, Korg);
      // deshalb hier übersprungen statt rot, und das Einzel-Fixture oben trägt
      // die Prüfung in der CI.
      const datei = fs.readFileSync(WERKSBANK);
      const kaputt: string[] = [];
      for (let i = 0; i < 250; i++) {
        const start = E2_ALLPAT_PATTERN_OFFSET + i * E2_ALLPAT_PATTERN_STRIDE;
        const original = new Uint8Array(
          datei.subarray(start, start + E2_PATTERN_BODY_SIZE)
        );
        const decoded = decodePatternBody(original);
        const zurueck = buildE2PatternBody(
          synthstudioPatternToE2(e2PatternToSynthstudio(decoded), {
            bpm: decoded.bpm,
          }),
          { base: original }
        );
        const diff = unterschiede(original, zurueck);
        if (diff.length) kaputt.push(`Pattern ${i}: ${diff.slice(0, 3).join("; ")}`);
      }
      expect(kaputt).toEqual([]);
    }
  );

  it("baut ohne Original weiterhin auf dem Init-Template auf", () => {
    // Patterns aus einer Datei sind nie durch den Geräte-Pull gelaufen; für
    // die gibt es kein Original. Der bisherige Weg muss bleiben.
    const body = buildE2PatternBody({
      name: "OHNEBASE",
      bpm: 120,
      stepLength: 16,
      parts: [],
    });
    expect(body.length).toBe(E2_PATTERN_BODY_SIZE);
  });
});
