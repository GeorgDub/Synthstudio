/**
 * Synthstudio – korg-e2-file-roundtrip-original-body.test.ts
 *
 * Datei-Import → Datei-Export soll verlustfrei sein — auf Step-Ebene.
 *
 * Der GERÄTE-Pfad kann das schon: `buildE2PatternBody(input, { base })`
 * überlagert nur die Bytes, die SynthStudio wirklich kennt, alles andere
 * (Gate-Flag, Gate-Länge, Motion-Bytes +0x05..+0x0B, Part-Config, FX,
 * Groove …) bleibt aus dem Original stehen —
 * `korg-e2-push-original-body.test.ts` beweist das mit 250/250
 * byte-gleichen Werks-Patterns. Der DATEI-Pfad baute dagegen auf dem
 * Init-Template auf: Noten wurden zu C5 plattgedrückt, Ties (0xFF)
 * gingen verloren, Gate-Längen wurden Konstanten.
 *
 * Derselbe Mechanismus, keine Neuerfindung: der Parser merkt sich den
 * Original-Body je Pattern (`ParsedPattern.body`), eine kleine Registry
 * hält ihn je Store-Pattern-ID, und der Export reicht ihn als `base`
 * durch. Die Probe ist scharf und braucht kein Gerät: ein echtes
 * Werks-Pattern importieren, NICHTS ändern, exportieren — Byte für Byte
 * das Original. Die Werksbank enthält 14 448 Ties und 530 Mutes; jede
 * Abweichung wäre ein Feld, das der Export zerstören würde.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  parseElectribeBank,
  convertParsedPatternToSynthstudio,
} from "../../client/src/utils/electribeImport";
import { synthstudioImportToPatternData } from "../../client/src/utils/korg/synthstudioImportToPatternData";
import { convertSynthstudioPatternToE2 } from "../../client/src/utils/electribePatternConvert";
import {
  buildE2PatternBody,
  buildE2PatternFileV2,
  buildE2AllPatFile,
} from "../../client/src/utils/e2sExport";
import {
  rememberE2OriginalBody,
  getE2OriginalBody,
  clearE2OriginalBodies,
} from "../../client/src/utils/korg/e2OriginalBodies";
import {
  E2_ALLPAT_PATTERN_OFFSET,
  E2_ALLPAT_PATTERN_STRIDE,
  E2_PATTERN_BODY_SIZE,
  E2_FILE_HEADER_SIZE,
  E2_PART_TABLE_OFFSET,
  E2_PART_STRIDE,
  E2_PART_COUNT,
} from "../../client/src/utils/korg/e2Layout";
import type { PatternData } from "../../client/src/audio/AudioEngine";

const HIER = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HIER, "..", "fixtures", "e2s", "werksbank-pattern.bin");
const WERKSBANK = join(HIER, "..", "..", "e2s-2016", "e2s-2016.e2sallpat");

// ─── Helfer (wie in korg-e2-push-original-body.test.ts) ─────────────────────

/** Ordnet einen Offset dem zu, was dort liegt — sonst sagt die Zahl nichts. */
function deute(offset: number): string {
  if (offset < E2_PART_TABLE_OFFSET)
    return `Pattern-Kopf +0x${offset.toString(16)}`;
  const rel = offset - E2_PART_TABLE_OFFSET;
  const part = Math.floor(rel / E2_PART_STRIDE);
  if (part >= E2_PART_COUNT)
    return `hinter der Part-Tabelle +0x${offset.toString(16)}`;
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

/** Baut aus einem 16384-Byte-PTST-Body eine gültige .e2spat-Datei. */
function alsE2spat(body: Uint8Array): Uint8Array {
  const datei = new Uint8Array(E2_FILE_HEADER_SIZE + E2_PATTERN_BODY_SIZE);
  for (let i = 0; i < 4; i++) datei[i] = "KORG".charCodeAt(i);
  const id = "e2sampler";
  for (let i = 0; i < id.length; i++) datei[0x10 + i] = id.charCodeAt(i);
  datei[0x20] = 0x01;
  datei.fill(0xff, 0x24, 0x100);
  datei.set(body, E2_FILE_HEADER_SIZE);
  return datei;
}

/** Baut eine minimale, aber gültige .e2sallpat mit genau einem Slot. */
function alsE2sallpat(body: Uint8Array): Uint8Array {
  const datei = new Uint8Array(
    E2_ALLPAT_PATTERN_OFFSET + E2_ALLPAT_PATTERN_STRIDE
  );
  for (let i = 0; i < 4; i++) datei[i] = "KORG".charCodeAt(i);
  const id = "e2sampler";
  for (let i = 0; i < id.length; i++) datei[0x10 + i] = id.charCodeAt(i);
  datei[0x20] = 0x01;
  datei.fill(0xff, 0x24, 0x100);
  for (let i = 0; i < 4; i++) datei[0x100 + i] = "GLST".charCodeAt(i);
  for (let i = 0; i < 4; i++) datei[0x1fc + i] = "GLED".charCodeAt(i);
  datei.fill(0xff, 0x200, E2_ALLPAT_PATTERN_OFFSET);
  datei.set(body, E2_ALLPAT_PATTERN_OFFSET);
  return datei;
}

function fixtureBody(): Uint8Array {
  return new Uint8Array(readFileSync(FIXTURE));
}

/** Der komplette Datei-Import-Weg als pure Kette (wie die beiden UI-Pfade). */
function importiere(datei: Uint8Array): {
  pattern: PatternData;
  body: Uint8Array | undefined;
} {
  const bank = parseElectribeBank(datei);
  const conv = convertParsedPatternToSynthstudio(bank.patterns[0]);
  return {
    pattern: synthstudioImportToPatternData(conv),
    body: bank.patterns[0].body,
  };
}

// ─── Original-Body wird beim Parsen mitgeführt ───────────────────────────────

describe("Parser merkt sich den Original-Body", () => {
  it(".e2spat: patterns[0].body ist der 16384-Byte-Body, byte-gleich", () => {
    const body = fixtureBody();
    const bank = parseElectribeBank(alsE2spat(body));
    expect(bank.patterns[0].body).toBeDefined();
    expect(unterschiede(body, bank.patterns[0].body!)).toEqual([]);
    expect(bank.patterns[0].body!.length).toBe(E2_PATTERN_BODY_SIZE);
  });

  it(".e2sallpat: jeder Slot trägt seinen Body", () => {
    const body = fixtureBody();
    const bank = parseElectribeBank(alsE2sallpat(body));
    expect(bank.patterns[0].body).toBeDefined();
    expect(unterschiede(body, bank.patterns[0].body!)).toEqual([]);
  });

  it("der Body ist eine KOPIE, kein View auf den Datei-Puffer", () => {
    // Eine .e2sallpat ist 4 MB — ein subarray-View hielte die ganze Datei
    // am Leben und würde bei nachträglicher Puffer-Mutation mitkippen.
    const body = fixtureBody();
    const datei = alsE2spat(body);
    const bank = parseElectribeBank(datei);
    datei.fill(0x00);
    expect(unterschiede(body, bank.patterns[0].body!)).toEqual([]);
  });
});

// ─── Per-Step-Noten überleben den Import (Voraussetzung für den Roundtrip) ──

describe("Konverter führt die Step-Noten mit", () => {
  it("drumParts[i].pitches = Note − 0x48, Tie (0xFF) bleibt unterscheidbar", () => {
    const body = fixtureBody();
    // Part 1, Step 1: aktive Note gezielt setzen (0x3C = C4 → pitch −12),
    // Step 2: Tie (0xFF).
    const so = E2_PART_TABLE_OFFSET + 0x30;
    body[so + 0] = 1;
    body[so + 1] = 0x3c;
    body[so + 12] = 1;
    body[so + 12 + 1] = 0xff;
    const bank = parseElectribeBank(alsE2spat(body));
    const conv = convertParsedPatternToSynthstudio(bank.patterns[0]);
    expect(conv.drumParts[0].pitches[0]).toBe(0x3c - 0x48);
    expect(conv.drumParts[0].pitches[1]).toBe(0xff - 0x48);
  });

  it("Mapper schreibt sie als StepData.pitch in den Store", () => {
    const body = fixtureBody();
    const so = E2_PART_TABLE_OFFSET + 0x30;
    body[so + 0] = 1;
    body[so + 1] = 0x3c;
    const bank = parseElectribeBank(alsE2spat(body));
    const conv = convertParsedPatternToSynthstudio(bank.patterns[0]);
    const pd = synthstudioImportToPatternData(conv);
    expect(pd.parts[0].steps[0].pitch).toBe(-12);
  });
});

// ─── Der eigentliche Roundtrip ───────────────────────────────────────────────

describe("Datei-Import → Export auf dem Original-Body", () => {
  it("gibt ein unverändert importiertes Werks-Pattern Byte für Byte zurück", () => {
    const original = fixtureBody();
    const { pattern, body } = importiere(alsE2spat(original));

    const eingabe = convertSynthstudioPatternToE2(pattern, { globalBpm: 120 });
    const zurueck = buildE2PatternBody(eingabe, { base: body });

    expect(unterschiede(original, zurueck)).toEqual([]);
    expect(zurueck.length).toBe(original.length);
  });

  it("Gegenprobe: geänderte Lautstärke wird trotzdem durchgeschrieben", () => {
    // Ein „Exporter", der das Original zurückgibt, bestünde den Test oben —
    // und wäre wertlos.
    const original = fixtureBody();
    const { pattern, body } = importiere(alsE2spat(original));
    pattern.parts[0].volume = 0.25;

    const zurueck = buildE2PatternBody(
      convertSynthstudioPatternToE2(pattern, { globalBpm: 120 }),
      { base: body }
    );

    expect(zurueck[E2_PART_TABLE_OFFSET + 0x18]).toBe(Math.round(0.25 * 127));
  });

  it("Gegenprobe: Mute aus der App wird durchgeschrieben (Part+0x01)", () => {
    const original = fixtureBody();
    expect(original[E2_PART_TABLE_OFFSET + 0x01]).toBe(0);
    const { pattern, body } = importiere(alsE2spat(original));
    pattern.parts[0].muted = true;

    const zurueck = buildE2PatternBody(
      convertSynthstudioPatternToE2(pattern, { globalBpm: 120 }),
      { base: body }
    );

    expect(zurueck[E2_PART_TABLE_OFFSET + 0x01]).toBe(1);
  });

  it("buildE2PatternFileV2 nimmt den Original-Body als base", () => {
    const original = fixtureBody();
    const { pattern, body } = importiere(alsE2spat(original));

    const datei = new Uint8Array(
      buildE2PatternFileV2(
        convertSynthstudioPatternToE2(pattern, { globalBpm: 120 }),
        { base: body }
      )
    );

    expect(
      unterschiede(original, datei.subarray(E2_FILE_HEADER_SIZE))
    ).toEqual([]);
  });

  it("buildE2AllPatFile nimmt je Slot einen Original-Body (bases)", () => {
    const original = fixtureBody();
    const { pattern, body } = importiere(alsE2spat(original));

    const datei = new Uint8Array(
      buildE2AllPatFile(
        [convertSynthstudioPatternToE2(pattern, { globalBpm: 120 })],
        { bases: [body] }
      )
    );

    const slot0 = datei.subarray(
      E2_ALLPAT_PATTERN_OFFSET,
      E2_ALLPAT_PATTERN_OFFSET + E2_PATTERN_BODY_SIZE
    );
    expect(unterschiede(original, slot0)).toEqual([]);
  });

  it.skipIf(!existsSync(WERKSBANK))(
    "gibt ALLE 250 Werks-Patterns unverändert zurück (Datei-Pfad)",
    () => {
      // Ein Treffer ist keine Trennschärfe: die Werksbank deckt Ties (14 448),
      // Mutes (530), Akkorde und alle drei Schrittzahlen ab. Gitignored
      // (4 MB, Korg) → übersprungen statt rot; das Einzel-Fixture oben trägt
      // die Prüfung in der CI.
      const bank = parseElectribeBank(
        new Uint8Array(readFileSync(WERKSBANK))
      );
      const kaputt: string[] = [];
      for (let i = 0; i < bank.patterns.length; i++) {
        const parsed = bank.patterns[i];
        if (!parsed.body) {
          kaputt.push(`Pattern ${i}: kein body`);
          continue;
        }
        const original = parsed.body;
        const conv = convertParsedPatternToSynthstudio(parsed);
        const pattern = synthstudioImportToPatternData(conv);
        const zurueck = buildE2PatternBody(
          convertSynthstudioPatternToE2(pattern, { globalBpm: 120 }),
          { base: original }
        );
        const diff = unterschiede(original, zurueck);
        if (diff.length)
          kaputt.push(`Pattern ${i}: ${diff.slice(0, 3).join("; ")}`);
      }
      expect(bank.patterns.length).toBe(250);
      expect(kaputt).toEqual([]);
    }
  );
});

// ─── Die Registry: Original-Body je Store-Pattern-ID ─────────────────────────

describe("e2OriginalBodies-Registry", () => {
  beforeEach(() => clearE2OriginalBodies());

  it("merkt sich eine KOPIE und liefert sie byte-gleich zurück", () => {
    const body = fixtureBody();
    rememberE2OriginalBody("pat-1", body);
    body.fill(0x00); // Mutation der Quelle darf den Merker nicht treffen
    const zurueck = getE2OriginalBody("pat-1");
    expect(zurueck).toBeDefined();
    expect(unterschiede(fixtureBody(), zurueck!)).toEqual([]);
  });

  it("falsche Länge speichert nichts und räumt einen Alt-Eintrag weg", () => {
    // Ein zweiter Import (z. B. Legacy-Datei ohne Body) auf dasselbe Pattern
    // muss den alten Body VERGESSEN — sonst überlagert der Export auf einem
    // Original, das nicht mehr zum Store-Inhalt gehört.
    rememberE2OriginalBody("pat-1", fixtureBody());
    rememberE2OriginalBody("pat-1", new Uint8Array(123));
    expect(getE2OriginalBody("pat-1")).toBeUndefined();
    rememberE2OriginalBody("pat-2", fixtureBody());
    rememberE2OriginalBody("pat-2", undefined);
    expect(getE2OriginalBody("pat-2")).toBeUndefined();
  });

  it("unbekannte IDs liefern undefined (Export fällt aufs Template zurück)", () => {
    expect(getE2OriginalBody("nie-gesehen")).toBeUndefined();
  });
});

// ─── Gate über DrumMachine.tsx: beide Richtungen sind verdrahtet ─────────────
//
// Dieselbe Fehlerklasse wie beim Mute: zwei Import-Pfade, zwei Export-Buttons.
// Ein Fix an einer Stelle ist kein Fix — die Regel gilt für die ganze Datei:
// jeder Datei-Import MERKT sich den Body, jeder Datei-Export FRAGT ihn ab.
describe("Gate: DrumMachine.tsx verdrahtet die Original-Bodies", () => {
  const DRUM_MACHINE = join(
    HIER,
    "..",
    "..",
    "client",
    "src",
    "components",
    "DrumMachine",
    "DrumMachine.tsx"
  );

  function ohneKommentare(quelle: string): string {
    return quelle.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  }

  it("beide Import-Pfade merken sich den Original-Body", () => {
    const code = ohneKommentare(readFileSync(DRUM_MACHINE, "utf8"));
    const merker = code.match(/rememberE2OriginalBody\(/g) ?? [];
    expect(merker.length).toBeGreaterThanOrEqual(2);
  });

  it("beide Export-Buttons fragen den Original-Body ab", () => {
    const code = ohneKommentare(readFileSync(DRUM_MACHINE, "utf8"));
    const abfragen = code.match(/getE2OriginalBody\(/g) ?? [];
    expect(abfragen.length).toBeGreaterThanOrEqual(2);
  });
});
