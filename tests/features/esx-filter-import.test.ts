/**
 * tests/features/esx-filter-import.test.ts
 *
 * v3.293: Verifizierter ESX-1 Per-Part Filter-Import (open-electribe-editor
 * v1.2.0). Deckt (a) den Filter-Decode im Parser und (b) das Mapping auf
 * Synthstudios ChannelFx ab.
 */
import { describe, it, expect } from "vitest";
import { parseEsxPattern } from "@/utils/korg/esxParser";
import { ESX1_CHUNKSIZE_PATTERN } from "@/utils/korg/constants";
import {
  esxFilterTypeToChannel,
  esxCutoffToHz,
  esxResonanceToQ,
  esxFilterToImportedFilter,
} from "@/utils/korg/esxFilterMap";

function baseBlock(): Uint8Array {
  const b = new Uint8Array(ESX1_CHUNKSIZE_PATTERN);
  for (let i = 0; i < 8; i++) b[i] = "Filt    ".charCodeAt(i) & 0xff;
  const raw = Math.round(120 * 128);
  b[8] = (raw >> 8) & 0xff;
  b[9] = raw & 0xff;
  b[11] = 0x07;
  b[13] = 0x0f;
  return b;
}

const DRUM0 = 24;
const STRETCH0 = 878;
const KB0 = 330;

describe("v3.293 ESX Filter-Decode (verifizierte Offsets)", () => {
  it("Drum: filterType@4, cutoff@5, resonance@6, egInt@7", () => {
    const b = baseBlock();
    b[DRUM0 + 4] = 1; // HPF
    b[DRUM0 + 5] = 64; // cutoff
    b[DRUM0 + 6] = 100; // resonance
    b[DRUM0 + 7] = 30; // egInt
    b[DRUM0 + 14] = (2 << 4) | 1; // modType=Tri(2), modDest=Cutoff(1)
    b[DRUM0 + 15] = 40; // modSpeed
    b[DRUM0 + 16] = 50; // modDepth
    const pat = parseEsxPattern(b, 0)!;
    const f = pat.parts[0].filter!;
    expect(f.filterType).toBe(1);
    expect(f.cutoff).toBe(64);
    expect(f.resonance).toBe(100);
    expect(f.egIntensity).toBe(30);
    expect(f.modType).toBe(2);
    expect(f.modDest).toBe(1);
    expect(f.modSpeed).toBe(40);
    expect(f.modDepth).toBe(50);
  });

  it("Stretch/Slice: Filter-Block −2 verschoben (filterType@2, cutoff@3)", () => {
    const b = baseBlock();
    b[STRETCH0 + 2] = 2; // BPF
    b[STRETCH0 + 3] = 90; // cutoff
    b[STRETCH0 + 4] = 20; // resonance
    const f = parseEsxPattern(b, 0)!.parts[9].filter!;
    expect(f.filterType).toBe(2);
    expect(f.cutoff).toBe(90);
    expect(f.resonance).toBe(20);
  });

  it("Keyboard: Filter-Block +1 verschoben (glide@4 → filterType@5)", () => {
    const b = baseBlock();
    b[KB0 + 5] = 1; // HPF
    b[KB0 + 6] = 77; // cutoff
    b[KB0 + 7] = 10; // resonance
    const f = parseEsxPattern(b, 0)!.parts[12].filter!;
    expect(f.filterType).toBe(1);
    expect(f.cutoff).toBe(77);
    expect(f.resonance).toBe(10);
  });
});

describe("v3.293 Filter→ChannelFx Mapping", () => {
  it("filterType 0/1/2/3 → lowpass/highpass/bandpass/bandpass", () => {
    expect(esxFilterTypeToChannel(0)).toBe("lowpass");
    expect(esxFilterTypeToChannel(1)).toBe("highpass");
    expect(esxFilterTypeToChannel(2)).toBe("bandpass");
    expect(esxFilterTypeToChannel(3)).toBe("bandpass");
  });

  it("cutoff 0→20 Hz, 127→20000 Hz, monoton steigend", () => {
    expect(esxCutoffToHz(0)).toBe(20);
    expect(esxCutoffToHz(127)).toBe(20000);
    expect(esxCutoffToHz(64)).toBeGreaterThan(esxCutoffToHz(32));
  });

  it("resonance 0→0.1, 127→12", () => {
    expect(esxResonanceToQ(0)).toBeCloseTo(0.1, 2);
    expect(esxResonanceToQ(127)).toBeCloseTo(12, 2);
  });

  const mk = (o: Partial<Parameters<typeof esxFilterToImportedFilter>[0] & object>) => ({
    filterType: 0,
    cutoff: 64,
    resonance: 0,
    egIntensity: 0,
    modType: 0,
    modDest: 0,
    modSpeed: 0,
    modDepth: 0,
    ...o,
  });

  it("offener LPF (cutoff 127) → undefined (kein Filter, transparent)", () => {
    expect(esxFilterToImportedFilter(mk({ filterType: 0, cutoff: 127 }))).toBeUndefined();
  });

  it("geschlossener LPF (cutoff < 127) → enabled lowpass mit freq/q", () => {
    const f = esxFilterToImportedFilter(mk({ filterType: 0, cutoff: 64, resonance: 100 }))!;
    expect(f.enabled).toBe(true);
    expect(f.type).toBe("lowpass");
    expect(f.freq).toBe(esxCutoffToHz(64));
    expect(f.q).toBe(esxResonanceToQ(100));
  });

  it("offener HPF (cutoff 0) → undefined; aktiver HPF (cutoff>0) → enabled", () => {
    expect(esxFilterToImportedFilter(mk({ filterType: 1, cutoff: 0 }))).toBeUndefined();
    const f = esxFilterToImportedFilter(mk({ filterType: 1, cutoff: 40 }))!;
    expect(f.enabled).toBe(true);
    expect(f.type).toBe("highpass");
  });

  it("Bandpass/BPF+ (2/3) → undefined (nicht auto-angewandt, Stumm-Gefahr)", () => {
    expect(esxFilterToImportedFilter(mk({ filterType: 2, cutoff: 64 }))).toBeUndefined();
    expect(esxFilterToImportedFilter(mk({ filterType: 3, cutoff: 127 }))).toBeUndefined();
  });

  it("undefined-Filter → undefined", () => {
    expect(esxFilterToImportedFilter(undefined)).toBeUndefined();
  });
});
