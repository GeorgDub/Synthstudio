/**
 * tests/features/esx-library-samples.test.ts
 *
 * v3.290: buildEsxLibrarySamples — die beim ESX-Import mitgeladenen Samples
 * erscheinen als Project-Store-`Sample[]` im Sample-Browser (zum Tauschen).
 */
import { describe, it, expect } from "vitest";
import {
  buildEsxLibrarySamples,
  ESX_LIBRARY_CATEGORY,
} from "@/utils/korg/esxLibrarySamples";
import type { EsxBank, EsxSample } from "@/utils/korg/esxParser";
import { base64ToUint8Array } from "@/utils/sampleEmbedding";

function sample(index: number, name: string, channels: 1 | 2 = 1): EsxSample {
  return {
    index,
    name,
    channels,
    sampleRate: 44100,
    frames: 4,
    pcmData: new Float32Array(channels === 2 ? 8 : 4),
  };
}

function bank(mono: EsxSample[], stereo: EsxSample[] = []): EsxBank {
  return {
    source: "test.esx",
    monoSamples: mono,
    stereoSamples: stereo,
    patterns: [],
    songs: [],
    declaredMonoCount: mono.length,
    declaredStereoCount: stereo.length,
    warnings: [],
  };
}

describe("buildEsxLibrarySamples", () => {
  it("baut Sample-Einträge nur für Slots mit Blob-URL (Name, Pfad, Kategorie)", () => {
    const b = bank([sample(3, "kick tou"), sample(7, "clap")]);
    const urls = new Map([
      [3, "blob:file:///aaa"],
      [7, "blob:file:///bbb"],
    ]);
    const out = buildEsxLibrarySamples(b, urls);
    expect(out.length).toBe(2);
    const kick = out.find(s => s.name === "kick tou")!;
    expect(kick.path).toBe("blob:file:///aaa");
    expect(kick.category).toBe(ESX_LIBRARY_CATEGORY);
    expect(kick.tags).toContain("esx");
  });

  it("überspringt Slots ohne passende URL und ohne Bank-Eintrag", () => {
    const b = bank([sample(1, "snare")]);
    // URL für 1 (existiert) + 99 (kein Bank-Slot → skip).
    const urls = new Map([
      [1, "blob:x"],
      [99, "blob:y"],
    ]);
    const out = buildEsxLibrarySamples(b, urls);
    expect(out.length).toBe(1);
    expect(out[0].name).toBe("snare");
  });

  it("leere URL-Map → leeres Ergebnis", () => {
    const b = bank([sample(1, "x")]);
    expect(buildEsxLibrarySamples(b, new Map())).toEqual([]);
  });

  it("Fallback-Name für namenlose Slots; Stereo bekommt stereo-Tag", () => {
    const b = bank([sample(5, "   ")], [sample(12, "wide", 2)]);
    const urls = new Map([
      [5, "blob:a"],
      [12, "blob:b"],
    ]);
    const out = buildEsxLibrarySamples(b, urls);
    const nameless = out.find(s => s.path === "blob:a")!;
    expect(nameless.name).toBe("ESX 5");
    const stereo = out.find(s => s.path === "blob:b")!;
    expect(stereo.tags).toContain("stereo");
  });

  it("bettet WAV-Bytes als Base64 ein (persistenz-fähig), size gesetzt", () => {
    const b = bank([sample(2, "hat")]);
    const urls = new Map([[2, "blob:h"]]);
    const wav = new Uint8Array([1, 2, 3, 4, 5]);
    const wavMap = new Map([[2, wav]]);
    const out = buildEsxLibrarySamples(b, urls, wavMap);
    expect(out[0].size).toBe(5);
    expect(out[0].embeddedData).toBeDefined();
    expect([...base64ToUint8Array(out[0].embeddedData!)]).toEqual([1, 2, 3, 4, 5]);
  });

  it("stabile IDs enthalten sampleId + bank-source", () => {
    const b = bank([sample(4, "tom")]);
    const out = buildEsxLibrarySamples(b, new Map([[4, "blob:t"]]));
    expect(out[0].id).toContain("4");
    expect(out[0].id).toContain("test.esx");
  });
});
