/**
 * Synthstudio – Browser-ZIP-Import Tests
 *
 * Testet die Browser-Side ZIP-Sample-Import-Util. Erstellt ein In-Memory ZIP
 * mit jszip und überprüft, dass extractSamplesFromZip nur Audio-Dateien
 * extrahiert und korrekte Sample-Objekte zurückgibt.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import JSZip from "jszip";
import {
  extractSamplesFromZip,
  isZipFile,
  ZIP_AUDIO_EXTENSIONS,
} from "../client/src/utils/zipSampleImport";

beforeAll(() => {
  // jsdom liefert kein URL.createObjectURL → mocken
  if (typeof URL.createObjectURL !== "function") {
    Object.defineProperty(URL, "createObjectURL", {
      value: vi.fn((blob: Blob) => `blob:mock://${blob.size}`),
      configurable: true,
    });
  } else {
    vi.spyOn(URL, "createObjectURL").mockImplementation(
      (blob: Blob) => `blob:mock://${blob.size}`
    );
  }
});

async function buildZip(entries: Record<string, Uint8Array>): Promise<File> {
  const zip = new JSZip();
  for (const [name, data] of Object.entries(entries)) {
    zip.file(name, data);
  }
  const blob = await zip.generateAsync({ type: "blob" });
  return new File([blob], "test.zip", { type: "application/zip" });
}

describe("isZipFile", () => {
  it("erkennt .zip Dateinamen", () => {
    expect(isZipFile(new File([], "samples.zip"))).toBe(true);
    expect(isZipFile(new File([], "PACK.ZIP"))).toBe(true);
  });

  it("erkennt application/zip MIME", () => {
    expect(
      isZipFile(new File([], "no-ext", { type: "application/zip" }))
    ).toBe(true);
  });

  it("lehnt Nicht-ZIP-Dateien ab", () => {
    expect(isZipFile(new File([], "kick.wav"))).toBe(false);
    expect(isZipFile(new File([], "song.mp3", { type: "audio/mpeg" }))).toBe(false);
  });
});

describe("ZIP_AUDIO_EXTENSIONS", () => {
  it("enthält die erwarteten Audio-Formate", () => {
    expect(ZIP_AUDIO_EXTENSIONS).toContain("wav");
    expect(ZIP_AUDIO_EXTENSIONS).toContain("mp3");
    expect(ZIP_AUDIO_EXTENSIONS).toContain("flac");
  });
});

describe("extractSamplesFromZip", () => {
  it("extrahiert Audio-Dateien und ignoriert Nicht-Audio-Dateien", async () => {
    const file = await buildZip({
      "kick.wav": new Uint8Array([1, 2, 3, 4]),
      "snare.mp3": new Uint8Array([5, 6, 7, 8]),
      "readme.txt": new Uint8Array([9]),
      "preset.json": new Uint8Array([10]),
    });

    const result = await extractSamplesFromZip(file);
    expect(result.audioCount).toBe(2);
    expect(result.samples).toHaveLength(2);
    const names = result.samples.map((s) => s.name).sort();
    expect(names).toEqual(["kick", "snare"]);
    for (const sample of result.samples) {
      expect(sample.category).toBe("imported");
      expect(sample.path).toMatch(/^blob:/);
    }
  });

  it("liefert audioCount=0 wenn keine Audio-Dateien enthalten sind", async () => {
    const file = await buildZip({
      "readme.txt": new Uint8Array([1]),
      "config.json": new Uint8Array([2]),
    });

    const result = await extractSamplesFromZip(file);
    expect(result.audioCount).toBe(0);
    expect(result.samples).toHaveLength(0);
  });

  it("ruft den Progress-Callback pro Datei auf", async () => {
    const file = await buildZip({
      "drums/kick.wav": new Uint8Array([1, 2]),
      "drums/snare.wav": new Uint8Array([3, 4]),
      "drums/hat.wav": new Uint8Array([5, 6]),
    });

    const progressCalls: number[] = [];
    const result = await extractSamplesFromZip(file, (p) => {
      progressCalls.push(p.percentage);
    });

    expect(result.audioCount).toBe(3);
    expect(progressCalls).toEqual([33, 67, 100]);
  });

  it("strippt Pfad und Endung aus dem Sample-Namen", async () => {
    const file = await buildZip({
      "drums/kicks/Big Kick 808.wav": new Uint8Array([1, 2]),
    });

    const result = await extractSamplesFromZip(file);
    expect(result.samples[0].name).toBe("Big Kick 808");
  });

  it("erkennt .aiff und .flac als Audio", async () => {
    const file = await buildZip({
      "loop.flac": new Uint8Array([1]),
      "vox.aiff": new Uint8Array([2]),
    });

    const result = await extractSamplesFromZip(file);
    expect(result.audioCount).toBe(2);
  });
});
