/**
 * tests/features/e2-filter-import.test.ts
 *
 * v3.296: E2/E2S Per-Part Filter-Import — Decode (Type@0x0C, Cutoff@0x0D,
 * Resonance@0x0E, EG-Int@0x0F; dreifach verifizierte TABLE-6-Offsets) und das
 * sichere Mapping auf ChannelFx (Typ-Tabelle fünffach verifiziert:
 * 0=OFF, 1..6=LPF, 7..11=HPF, 12..16=BPF).
 */
import { describe, it, expect } from "vitest";
import {
  decodePatternBody,
  PART_TABLE_OFFSET,
  PART_STRIDE,
} from "@/utils/korg/e2Sysex";
import {
  E2_FILTER_TYPE_NAMES,
  e2FilterClass,
  e2FilterToImportedFilter,
} from "@/utils/korg/e2FilterMap";
import { esxCutoffToHz, esxResonanceToQ } from "@/utils/korg/esxFilterMap";

const BODY_SIZE = 16384;

function makeBody(): Uint8Array {
  return new Uint8Array(BODY_SIZE);
}

describe("v3.296 E2 Filter-Decode (TABLE-6-Offsets)", () => {
  it("liest Type@0x0C, Cutoff@0x0D, Resonance@0x0E, EG-Int@0x0F pro Part", () => {
    const body = makeBody();
    const p3 = PART_TABLE_OFFSET + 3 * PART_STRIDE;
    body[p3 + 0x0c] = 2; // MS20 LPF
    body[p3 + 0x0d] = 64; // cutoff
    body[p3 + 0x0e] = 90; // resonance
    body[p3 + 0x0f] = 0xc1; // -63 als i8
    const dec = decodePatternBody(body);
    expect(dec.parts[3].filterType).toBe(2);
    expect(dec.parts[3].cutoff).toBe(64);
    expect(dec.parts[3].resonance).toBe(90);
    expect(dec.parts[3].egInt).toBe(-63);
  });

  it("Null-Body → Type 0 (OFF), egInt 0 (keine Fantasiewerte)", () => {
    const dec = decodePatternBody(makeBody());
    expect(dec.parts[0].filterType).toBe(0);
    expect(dec.parts[0].egInt).toBe(0);
  });
});

describe("v3.296 E2-Filtertyp-Tabelle + Klassifizierung", () => {
  it("Tabelle hat exakt 17 verifizierte Einträge (0..16)", () => {
    expect(E2_FILTER_TYPE_NAMES.length).toBe(17);
    expect(E2_FILTER_TYPE_NAMES[0]).toBe("Off");
    expect(E2_FILTER_TYPE_NAMES[1]).toBe("electribe LPF");
    expect(E2_FILTER_TYPE_NAMES[6]).toBe("Acid LPF");
    expect(E2_FILTER_TYPE_NAMES[7]).toBe("electribe HPF");
    expect(E2_FILTER_TYPE_NAMES[11]).toBe("Acid HPF");
    expect(E2_FILTER_TYPE_NAMES[12]).toBe("electribe BPF");
    expect(E2_FILTER_TYPE_NAMES[16]).toBe("Acid BPF");
  });

  it("Klassen: 0→off, 1..6→lowpass, 7..11→highpass, 12..16→bandpass", () => {
    expect(e2FilterClass(0)).toBe("off");
    for (let t = 1; t <= 6; t++) expect(e2FilterClass(t)).toBe("lowpass");
    for (let t = 7; t <= 11; t++) expect(e2FilterClass(t)).toBe("highpass");
    for (let t = 12; t <= 16; t++) expect(e2FilterClass(t)).toBe("bandpass");
    expect(e2FilterClass(99)).toBe("off"); // defensiv
  });
});

describe("v3.296 E2-Filter → ChannelFx (Safe-Mapping)", () => {
  it("OFF (0) und BPF (12..16) → undefined (kein Auto-Filter)", () => {
    expect(e2FilterToImportedFilter(0, 64, 0)).toBeUndefined();
    expect(e2FilterToImportedFilter(12, 64, 0)).toBeUndefined();
    expect(e2FilterToImportedFilter(16, 127, 100)).toBeUndefined();
  });

  it("offener LPF (cutoff 127) / offener HPF (cutoff 0) → undefined", () => {
    expect(e2FilterToImportedFilter(3, 127, 0)).toBeUndefined();
    expect(e2FilterToImportedFilter(8, 0, 0)).toBeUndefined();
  });

  it("geschlossener LPF (z.B. Acid LPF, cutoff 40) → enabled lowpass", () => {
    const f = e2FilterToImportedFilter(6, 40, 80)!;
    expect(f.enabled).toBe(true);
    expect(f.type).toBe("lowpass");
    expect(f.freq).toBe(esxCutoffToHz(40));
    expect(f.q).toBe(esxResonanceToQ(80));
  });

  it("aktiver HPF (z.B. MS20 HPF, cutoff 30) → enabled highpass", () => {
    const f = e2FilterToImportedFilter(8, 30, 10)!;
    expect(f.enabled).toBe(true);
    expect(f.type).toBe("highpass");
  });
});
