/**
 * tests/features/slice-export.test.ts — v3.300.0
 *
 * Spec: client/src/utils/sliceExport.ts
 *
 * Bis v3.299 gab es keinen Weg, Slices als Dateien aus der App zu bekommen —
 * sie endeten ausschliesslich auf Drum-Kanälen und Performance-Pads. Diese
 * Suite pinnt den neuen Weg: Benennung, Encoding, Archiv.
 */

import { describe, it, expect } from "vitest";
import {
  ZIP_THRESHOLD,
  bundleSlicesToZip,
  encodeSlices,
  sanitizeSliceStem,
  shouldBundle,
  sliceFileName,
} from "../../client/src/utils/sliceExport";

const SR = 44100;

function tone(frames: number): Float32Array {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) out[i] = Math.sin(i / 10) * 0.5;
  return out;
}

// ─── Benennung ───────────────────────────────────────────────────────────────

describe("sanitizeSliceStem", () => {
  it("ersetzt alles, was auf FAT gefährlich ist", () => {
    expect(sanitizeSliceStem("my drum/loop:01?")).toBe("my_drum_loop_01");
  });

  it("wirft die Dateiendung weg", () => {
    expect(sanitizeSliceStem("break.wav")).toBe("break");
  });

  it("faltet Mehrfach-Unterstriche und trimmt die Ränder", () => {
    expect(sanitizeSliceStem("  ...break!!!...  ")).toBe("break");
  });

  it("fällt auf 'slice' zurück, wenn nichts übrig bleibt", () => {
    expect(sanitizeSliceStem("///")).toBe("slice");
    expect(sanitizeSliceStem("")).toBe("slice");
  });

  it("kürzt auf die Maximallänge", () => {
    expect(sanitizeSliceStem("a".repeat(80)).length).toBe(32);
    expect(sanitizeSliceStem("a".repeat(80), 8).length).toBe(8);
  });
});

describe("sliceFileName", () => {
  it("nummeriert ab 1", () => {
    expect(sliceFileName("break", 0, 4)).toBe("break_01.wav");
  });

  it("füllt so weit auf, dass alphabetisch = numerisch sortiert", () => {
    // Ohne Auffüllen stünde _10 vor _2 — im Dateimanager wäre die
    // Slice-Reihenfolge damit unbrauchbar.
    const names = [0, 1, 9, 10, 99].map(i => sliceFileName("b", i, 100));
    expect(names).toEqual(["b_001.wav", "b_002.wav", "b_010.wav", "b_011.wav", "b_100.wav"]);
    expect([...names].sort()).toEqual(names);
  });

  it("nutzt mindestens zwei Stellen", () => {
    expect(sliceFileName("b", 0, 1)).toBe("b_01.wav");
  });

  it("säubert den Stamm mit", () => {
    expect(sliceFileName("my loop!", 0, 2)).toBe("my_loop_01.wav");
  });
});

// ─── Encoding ────────────────────────────────────────────────────────────────

describe("encodeSlices", () => {
  it("macht aus jedem Slice eine WAV-Datei", () => {
    const out = encodeSlices([tone(100), tone(200)], SR, "break");
    expect(out).toHaveLength(2);
    expect(out.map(s => s.name)).toEqual(["break_01.wav", "break_02.wav"]);
    expect(out[0].frames).toBe(100);
    expect(out[1].frames).toBe(200);
  });

  it("schreibt einen gültigen RIFF/WAVE-Kopf", () => {
    const [first] = encodeSlices([tone(64)], SR, "b");
    const head = new Uint8Array(first.bytes, 0, 12);
    expect(String.fromCharCode(...head.subarray(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...head.subarray(8, 12))).toBe("WAVE");
  });

  it("überspringt leere Slices", () => {
    const out = encodeSlices([tone(50), new Float32Array(0), tone(50)], SR, "b");
    expect(out).toHaveLength(2);
  });

  it("behält die Original-Nummerierung, wenn ein Slice ausfällt", () => {
    // slice_03 muss der dritte Abschnitt bleiben, auch wenn der zweite leer
    // war — sonst passt die Nummer nicht mehr zur Wellenform.
    const out = encodeSlices([tone(50), new Float32Array(0), tone(50)], SR, "b");
    expect(out.map(s => s.name)).toEqual(["b_01.wav", "b_03.wav"]);
  });

  it("kann leere Slices auch mitnehmen", () => {
    const out = encodeSlices([new Float32Array(0)], SR, "b", { skipEmpty: false });
    expect(out).toHaveLength(1);
    expect(out[0].frames).toBe(0);
  });

  it("fängt eine unsinnige Sample-Rate ab, statt zu werfen", () => {
    // encodeWavMono wirft bei sampleRate <= 0 — der Slicer soll deswegen nicht
    // mitten im Export abbrechen.
    expect(() => encodeSlices([tone(10)], 0, "b")).not.toThrow();
    expect(() => encodeSlices([tone(10)], Number.NaN, "b")).not.toThrow();
  });

  it("24 Bit erzeugt eine größere Datei als 16 Bit", () => {
    const a = encodeSlices([tone(1000)], SR, "b", { bitDepth: 16 })[0];
    const b = encodeSlices([tone(1000)], SR, "b", { bitDepth: 24 })[0];
    expect(b.bytes.byteLength).toBeGreaterThan(a.bytes.byteLength);
  });

  it("liefert für eine leere Liste eine leere Liste", () => {
    expect(encodeSlices([], SR, "b")).toEqual([]);
  });
});

// ─── ZIP ─────────────────────────────────────────────────────────────────────

/** Minimales JSZip-Double — merkt sich nur, was hineingelegt wurde. */
function makeZipMock() {
  const files: Record<string, unknown> = {};
  class Fake {
    file(name: string, data: ArrayBuffer | Uint8Array | string) {
      files[name] = data;
    }
    async generateAsync() {
      return new ArrayBuffer(256);
    }
  }
  return { Fake: Fake as never, files };
}

describe("bundleSlicesToZip", () => {
  it("legt jede Datei unter ihrem Namen ins Archiv", async () => {
    const { Fake, files } = makeZipMock();
    const encoded = encodeSlices([tone(50), tone(50)], SR, "break");
    const res = await bundleSlicesToZip(encoded, "break", Fake);
    expect(Object.keys(files)).toEqual(["break_01.wav", "break_02.wav"]);
    expect(res.sliceCount).toBe(2);
    expect(res.byteSize).toBe(256);
  });

  it("benennt das Archiv nach dem Sample", async () => {
    const { Fake } = makeZipMock();
    const res = await bundleSlicesToZip([], "my loop!", Fake);
    expect(res.filename).toBe("my_loop_slices.zip");
  });

  it("kommt mit null Slices klar", async () => {
    const { Fake, files } = makeZipMock();
    const res = await bundleSlicesToZip([], "b", Fake);
    expect(Object.keys(files)).toEqual([]);
    expect(res.sliceCount).toBe(0);
  });
});

describe("shouldBundle", () => {
  it("packt erst ab der Schwelle", () => {
    expect(shouldBundle(ZIP_THRESHOLD - 1)).toBe(false);
    expect(shouldBundle(ZIP_THRESHOLD)).toBe(true);
  });

  it("lässt wenige Slices einzeln — Browser blocken Download-Serien", () => {
    expect(shouldBundle(1)).toBe(false);
    expect(shouldBundle(64)).toBe(true);
  });
});
