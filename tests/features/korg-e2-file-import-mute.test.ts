/**
 * Synthstudio – korg-e2-file-import-mute.test.ts
 *
 * Der DATEI-Import (.e2spat/.e2sallpat) las das Mute-Flag nicht.
 *
 * Im Pattern-Body liegt Mute bei Part+0x01 (0 = spielt, 1 = stumm) — am Gerät
 * belegt (HW-Sitzung 2026-08-10). Der Sysex-Pull übernimmt es seit v3.319
 * (`decodePatternBody` → `applyE2DecodedToActivePattern`), der Datei-Pfad
 * über `electribeImport.ts` nicht: ein am Gerät gemuteter Part klang nach
 * dem Datei-Import einfach mit. Die Werksbank e2s-2016 trägt 530 gemutete
 * Parts in 122 Patterns — das ist kein Randfall.
 *
 * Geprüft wird die ganze Kette: Parser → Konverter → PatternData-Mapper,
 * plus ein Quell-Gate über DrumMachine.tsx (die Datei hat ZWEI Schwester-
 * Import-Pfade; ein Fix an einer Stelle ist kein Fix).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  parseElectribeBank,
  convertParsedPatternToSynthstudio,
} from "../../client/src/utils/electribeImport";
import { synthstudioImportToPatternData } from "../../client/src/utils/korg/synthstudioImportToPatternData";
import {
  E2_PART_TABLE_OFFSET,
  E2_PART_STRIDE,
  E2_FILE_HEADER_SIZE,
  E2_PATTERN_BODY_SIZE,
} from "../../client/src/utils/korg/e2Layout";

const HIER = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HIER, "..", "fixtures", "e2s", "werksbank-pattern.bin");

/** Baut aus einem 16384-Byte-PTST-Body eine gültige .e2spat-Datei (0x100-Header). */
function alsE2spat(body: Uint8Array): Uint8Array {
  const datei = new Uint8Array(E2_FILE_HEADER_SIZE + E2_PATTERN_BODY_SIZE);
  const kopf = "KORG";
  for (let i = 0; i < kopf.length; i++) datei[i] = kopf.charCodeAt(i);
  const id = "e2sampler";
  for (let i = 0; i < id.length; i++) datei[0x10 + i] = id.charCodeAt(i);
  datei[0x20] = 0x01; // Version u32 LE = 1
  datei.fill(0xff, 0x24, 0x100);
  datei.set(body, E2_FILE_HEADER_SIZE);
  return datei;
}

/** Werksbank-Body mit gezielt gesetzten Mute-Bytes (Part 1 + Part 6 stumm). */
function bodyMitMutes(): Uint8Array {
  const body = new Uint8Array(readFileSync(FIXTURE));
  body[E2_PART_TABLE_OFFSET + 0 * E2_PART_STRIDE + 0x01] = 1;
  body[E2_PART_TABLE_OFFSET + 5 * E2_PART_STRIDE + 0x01] = 1;
  body[E2_PART_TABLE_OFFSET + 1 * E2_PART_STRIDE + 0x01] = 0;
  return body;
}

describe("Datei-Import liest das Mute-Flag (Part+0x01)", () => {
  it("Parser: parts[i].muted kommt aus dem Byte Part+0x01", () => {
    const bank = parseElectribeBank(alsE2spat(bodyMitMutes()));
    const parts = bank.patterns[0].parts;
    expect(parts[0].muted).toBe(true);
    expect(parts[5].muted).toBe(true);
    expect(parts[1].muted).toBe(false);
  });

  it("Konverter: drumParts[i].muted wird durchgereicht", () => {
    const bank = parseElectribeBank(alsE2spat(bodyMitMutes()));
    const conv = convertParsedPatternToSynthstudio(bank.patterns[0]);
    expect(conv.drumParts[0].muted).toBe(true);
    expect(conv.drumParts[5].muted).toBe(true);
    expect(conv.drumParts[1].muted).toBe(false);
  });

  it("Mapper: PatternData.parts[i].muted landet im Store-Format", () => {
    const bank = parseElectribeBank(alsE2spat(bodyMitMutes()));
    const conv = convertParsedPatternToSynthstudio(bank.patterns[0]);
    const pd = synthstudioImportToPatternData(conv);
    expect(pd.parts).toHaveLength(16);
    expect(pd.parts[0].muted).toBe(true);
    expect(pd.parts[5].muted).toBe(true);
    expect(pd.parts[1].muted).toBe(false);
    // Der Mapper ist die EINE Stelle, die Import-Werte in Store-Werte
    // übersetzt — Grundform gleich mitprüfen, damit kein Pfad eigene
    // (doppelte) Normalisierung nachschiebt.
    expect(pd.stepCount).toBe(conv.stepCount);
    expect(pd.parts[0].steps).toHaveLength(conv.stepCount);
    expect(pd.parts[0].volume).toBe(conv.drumParts[0].volume);
    expect(pd.parts[0].pan).toBe(conv.drumParts[0].pan);
  });
});

// ── Gate über die ganze Datei ────────────────────────────────────────────────
//
// DrumMachine.tsx hat ZWEI Schwester-Pfade für den Datei-Import
// (`importElectribePatternIntoActive` und `importElectribeBankAsPatterns`) —
// dieselbe Fehlerklasse, die schon Part-Truncation und Pan doppelt getroffen
// hat. Regel: BEIDE Pfade übersetzen über den einen Mapper, und Mute wird
// im Einzel-Pfad explizit gesetzt (der Bank-Pfad bekommt es via Mapper).
describe("Gate: beide Datei-Import-Pfade in DrumMachine.tsx", () => {
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

  it("beide Import-Pfade laufen über synthstudioImportToPatternData", () => {
    const code = ohneKommentare(readFileSync(DRUM_MACHINE, "utf8"));
    const aufrufe = code.match(/synthstudioImportToPatternData\(/g) ?? [];
    expect(aufrufe.length).toBeGreaterThanOrEqual(2);
  });

  it("Mute wird angewendet: setPartMuted IM Einzel-Datei-Import-Pfad", () => {
    // ☠ Nicht über die ganze Datei zählen — der Mute-Button der UI ruft
    // setPartMuted auch, und schon wäre das Gate satt, ohne dass der Import
    // je gemutet hätte. Also den Funktionsrumpf ausschneiden und DORT prüfen.
    const code = ohneKommentare(readFileSync(DRUM_MACHINE, "utf8"));
    const start = code.indexOf("const importElectribePatternIntoActive");
    const ende = code.indexOf("const importElectribeBankAsPatterns");
    expect(start).toBeGreaterThan(-1);
    expect(ende).toBeGreaterThan(start);
    const rumpf = code.slice(start, ende);
    expect(rumpf).toMatch(/dm\.setPartMuted\(/);
  });

  it("keine doppelte Normalisierung: e2VolumeToUnit/e2PanToUnit nur im Geräte-Pfad", () => {
    // v3.319 hatte die Geräte-Umrechnung auch auf den Datei-Pfad kopiert —
    // dessen Werte sind aber SCHON normalisiert (convertParsedPatternToSynthstudio
    // liefert 0..1 bzw. −1..+1). Ergebnis: Volume ÷127 ein zweites Mal (~stumm)
    // und Pan hart links. Die Umrechnung gehört genau EINMAL in die Datei —
    // in den Geräte-Pfad, dessen Quelle rohe 0..127-Werte liefert.
    const code = ohneKommentare(readFileSync(DRUM_MACHINE, "utf8"));
    expect(code.match(/e2VolumeToUnit\(/g) ?? []).toHaveLength(1);
    expect(code.match(/e2PanToUnit\(/g) ?? []).toHaveLength(1);
  });
});
