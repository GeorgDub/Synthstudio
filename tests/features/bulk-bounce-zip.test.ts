/**
 * tests/features/bulk-bounce-zip.test.ts
 *
 * v3.85.0 — Bulk-Bounce ZIP-Bundle (closes v3.84 Caveat).
 *
 * Bulk-Bounce löste bisher N Einzeldownloads aus. Mit OGG-Format wurden viele
 * Channels schnell unübersichtlich. v3.85 packt alle Stems + ein
 * `manifest.json` in ein ZIP.
 *
 * Coverage:
 *  1. `bundleStemResultsToZip` mit injizierter Mock-JSZip-Klasse — bundleAsZip
 *     erzeugt einen ZIP-ArrayBuffer.
 *  2. ZIP enthält N Stem-Files + genau eine `manifest.json`.
 *  3. `buildStemManifest` produziert das vollständige Schema (generated,
 *     project, format, sampleRate, channels[name,file,color?], bitrate? bei ogg).
 *  4. `stemBundleZipFilename` folgt dem Pattern `<projectName>-Stems-<date>-<time>.zip`
 *     mit sanitisiertem Projekt-Namen und compact-Timestamp.
 *  5. Bonus: leere Result-Liste → ZIP enthält nur manifest.json mit channels:[].
 */
import { describe, it, expect } from "vitest";

import {
  bundleStemResultsToZip,
  buildStemManifest,
  stemBundleZipFilename,
  sanitizeProjectNameForZip,
  type BounceAllResult,
  type JSZipCtor,
  type StemBundleManifest,
} from "../../client/src/utils/channelBounce";

// ─── Mock-JSZip ──────────────────────────────────────────────────────────────
// Minimaler JSZip-Klon ohne ZIP-Roundtrip. Wir speichern alle file()-Calls als
// Map und serialisieren generateAsync zu einem ArrayBuffer der die Filenames
// enthält (damit Tests was zum Inspizieren haben).

interface CapturedFile {
  name: string;
  data: ArrayBuffer | Uint8Array | string;
}

function createMockJSZip(): { Ctor: JSZipCtor; lastInstance: { files: CapturedFile[] } } {
  const ref: { files: CapturedFile[] } = { files: [] };
  class MockJSZip {
    private _files: CapturedFile[] = [];
    constructor() {
      ref.files = this._files;
    }
    file(name: string, data: ArrayBuffer | Uint8Array | string) {
      this._files.push({ name, data });
    }
    async generateAsync(opts: { type: "blob" | "arraybuffer" | "uint8array" }) {
      // Serialisiere eine simple Repräsentation:  "FILE:<name>\n" je Eintrag,
      // plus Größe der Daten. Damit kann der byteLength-Check ungleich 0 sein.
      const lines = this._files.map((f) => {
        const len =
          typeof f.data === "string"
            ? f.data.length
            : (f.data as ArrayBuffer | Uint8Array).byteLength;
        return `FILE:${f.name}:${len}`;
      });
      const blob = lines.join("\n");
      const bytes = new TextEncoder().encode(blob);
      if (opts.type === "arraybuffer") {
        // Slice damit wir ein eigenständiges ArrayBuffer zurückgeben.
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      }
      if (opts.type === "uint8array") return bytes;
      // Blob-Fall — Node-Test-Env hat `Blob` global (undici/jsdom).
      return new Blob([bytes]);
    }
  }
  // Cast als JSZipCtor — Interface verlangt nur die zwei Methoden.
  return { Ctor: MockJSZip as unknown as JSZipCtor, lastInstance: ref };
}

function makeStem(
  channelId: string,
  channelName: string,
  filename: string,
  bytes: number,
  format: "wav" | "ogg-opus" = "wav",
): BounceAllResult {
  const data = new ArrayBuffer(bytes);
  return {
    channelId,
    channelName,
    filename,
    wav: data,
    data,
    actualFormat: format,
    mimeType: format === "wav" ? "audio/wav" : "audio/ogg",
  };
}

// ─── 1) bundleAsZip=true erzeugt ZIP-Blob ────────────────────────────────────

describe("bundleStemResultsToZip — happy path", () => {
  it("erzeugt einen ArrayBuffer mit nicht-leerer Byte-Größe", async () => {
    const { Ctor } = createMockJSZip();
    const stems = [
      makeStem("p1", "Kick", "proj-Kick-stem.wav", 1024),
      makeStem("p2", "Snare", "proj-Snare-stem.wav", 2048),
    ];
    const out = await bundleStemResultsToZip(
      stems,
      {
        projectName: "Demo",
        format: "wav",
        sampleRate: 44100,
        generated: "2026-05-19T12:00:00.000Z",
      },
      Ctor,
    );
    expect(out.zip).toBeInstanceOf(ArrayBuffer);
    expect(out.byteSize).toBeGreaterThan(0);
    expect(out.byteSize).toBe(out.zip.byteLength);
    expect(out.stemCount).toBe(2);
    expect(out.filename).toMatch(/^Demo-Stems-\d{8}-\d{6}\.zip$/);
  });
});

// ─── 2) ZIP enthält N files + manifest.json ──────────────────────────────────

describe("bundleStemResultsToZip — ZIP-Inhalt", () => {
  it("packt alle N Stem-Files plus genau eine manifest.json", async () => {
    const { Ctor, lastInstance } = createMockJSZip();
    const stems = [
      makeStem("p1", "Kick", "proj-Kick-stem.wav", 100),
      makeStem("p2", "Snare", "proj-Snare-stem.wav", 200),
      makeStem("p3", "HiHat", "proj-HiHat-stem.wav", 300),
    ];
    await bundleStemResultsToZip(
      stems,
      { projectName: "Demo", format: "wav", sampleRate: 48000 },
      Ctor,
    );
    const names = lastInstance.files.map((f) => f.name);
    expect(names).toContain("proj-Kick-stem.wav");
    expect(names).toContain("proj-Snare-stem.wav");
    expect(names).toContain("proj-HiHat-stem.wav");
    expect(names.filter((n) => n === "manifest.json")).toHaveLength(1);
    // 3 stems + 1 manifest = 4 entries
    expect(lastInstance.files).toHaveLength(4);
  });

  it("serialisiert manifest.json als gültiges JSON mit allen Channel-Metadaten", async () => {
    const { Ctor, lastInstance } = createMockJSZip();
    const stems = [
      makeStem("p1", "Kick", "demo-Kick-stem.ogg", 50, "ogg-opus"),
      makeStem("p2", "Snare", "demo-Snare-stem.ogg", 60, "ogg-opus"),
    ];
    await bundleStemResultsToZip(
      stems,
      {
        projectName: "DemoSet",
        format: "ogg-opus",
        sampleRate: 48000,
        bitrate: 192_000,
        generated: "2026-05-19T08:00:00.000Z",
        colors: { p1: "#ff0000", p2: "#00ff00" },
      },
      Ctor,
    );
    const manifestEntry = lastInstance.files.find((f) => f.name === "manifest.json");
    expect(manifestEntry).toBeDefined();
    expect(typeof manifestEntry!.data).toBe("string");
    const parsed = JSON.parse(manifestEntry!.data as string) as StemBundleManifest;
    expect(parsed.project).toBe("DemoSet");
    expect(parsed.format).toBe("ogg-opus");
    expect(parsed.sampleRate).toBe(48000);
    expect(parsed.bitrate).toBe(192_000);
    expect(parsed.generated).toBe("2026-05-19T08:00:00.000Z");
    expect(parsed.channels).toHaveLength(2);
    expect(parsed.channels[0]).toEqual({ name: "Kick", file: "demo-Kick-stem.ogg", color: "#ff0000" });
    expect(parsed.channels[1]).toEqual({ name: "Snare", file: "demo-Snare-stem.ogg", color: "#00ff00" });
  });
});

// ─── 3) Manifest hat alle channel-metadata (Pure-Helper) ─────────────────────

describe("buildStemManifest", () => {
  it("liefert bitrate nur wenn format='ogg-opus' und bitrate gegeben ist", () => {
    const stems = [makeStem("p1", "Kick", "Kick.wav", 10)];
    const wavManifest = buildStemManifest(stems, {
      projectName: "X",
      format: "wav",
      sampleRate: 44100,
      bitrate: 192_000, // wird ignoriert bei wav
      generated: "2026-01-01T00:00:00.000Z",
    });
    expect(wavManifest.bitrate).toBeUndefined();
    expect(wavManifest.format).toBe("wav");

    const oggManifest = buildStemManifest(stems, {
      projectName: "X",
      format: "ogg-opus",
      sampleRate: 48000,
      bitrate: 128_000,
    });
    expect(oggManifest.bitrate).toBe(128_000);
    expect(oggManifest.format).toBe("ogg-opus");
    // generated darf nicht leer sein wenn nicht explizit gegeben
    expect(oggManifest.generated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("akzeptiert colors als Map und Plain-Object und lässt undefined leer", () => {
    const stems = [
      makeStem("p1", "Kick", "Kick.wav", 10),
      makeStem("p2", "Snare", "Snare.wav", 10),
      makeStem("p3", "Tom", "Tom.wav", 10),
    ];
    const m1 = buildStemManifest(stems, {
      projectName: "X",
      format: "wav",
      sampleRate: 44100,
      colors: new Map([["p1", "#aaa"], ["p3", "#ccc"]]),
    });
    expect(m1.channels[0].color).toBe("#aaa");
    expect(m1.channels[1].color).toBeUndefined();
    expect(m1.channels[2].color).toBe("#ccc");

    const m2 = buildStemManifest(stems, {
      projectName: "X",
      format: "wav",
      sampleRate: 44100,
      colors: { p2: "#bbb" },
    });
    expect(m2.channels[0].color).toBeUndefined();
    expect(m2.channels[1].color).toBe("#bbb");
    expect(m2.channels[2].color).toBeUndefined();
  });
});

// ─── 4) Filename Pattern ─────────────────────────────────────────────────────

describe("stemBundleZipFilename — Pattern", () => {
  it("folgt dem Pattern <projectName>-Stems-<YYYYMMDD>-<HHmmss>.zip", () => {
    const name = stemBundleZipFilename("MySong", "2026-05-19T12:34:56.789Z");
    expect(name).toBe("MySong-Stems-20260519-123456.zip");
  });

  it("sanitisiert Sonderzeichen und nutzt 'synthstudio' bei leerem Namen", () => {
    expect(stemBundleZipFilename("My Song!", "2026-05-19T00:00:00.000Z")).toBe(
      "My_Song-Stems-20260519-000000.zip",
    );
    expect(stemBundleZipFilename("", "2026-05-19T00:00:00.000Z")).toBe(
      "synthstudio-Stems-20260519-000000.zip",
    );
    expect(stemBundleZipFilename("   ", "2026-05-19T00:00:00.000Z")).toBe(
      "synthstudio-Stems-20260519-000000.zip",
    );
  });

  it("sanitizeProjectNameForZip fällt auf 'synthstudio' zurück bei leer/whitespace", () => {
    expect(sanitizeProjectNameForZip("Demo")).toBe("Demo");
    expect(sanitizeProjectNameForZip("")).toBe("synthstudio");
    expect(sanitizeProjectNameForZip("  ")).toBe("synthstudio");
    expect(sanitizeProjectNameForZip("with spaces")).toBe("with_spaces");
  });
});

// ─── 5) Empty / edge-cases ───────────────────────────────────────────────────

describe("bundleStemResultsToZip — edge cases", () => {
  it("leere Result-Liste → ZIP nur mit manifest.json und stemCount=0", async () => {
    const { Ctor, lastInstance } = createMockJSZip();
    const out = await bundleStemResultsToZip(
      [],
      { projectName: "Empty", format: "wav", sampleRate: 44100 },
      Ctor,
    );
    expect(out.stemCount).toBe(0);
    expect(lastInstance.files).toHaveLength(1);
    expect(lastInstance.files[0].name).toBe("manifest.json");
    const parsed = JSON.parse(lastInstance.files[0].data as string) as StemBundleManifest;
    expect(parsed.channels).toEqual([]);
  });

  it("Filename-Timestamp ist auch bei minimaler ISO-Eingabe stabil", () => {
    // 14 Ziffern nach Strip = "20260519123456" — 8 für Datum, 6 für Zeit.
    expect(stemBundleZipFilename("Proj", "2026-05-19T12:34:56.789Z")).toBe(
      "Proj-Stems-20260519-123456.zip",
    );
  });
});
