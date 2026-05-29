/**
 * tests/features/flp-sample-loader.test.ts
 *
 * Reiner Matcher für FLP-Sample-Auflösung (Stage 3). Die IPC-Orchestrierung
 * (Ordner-Dialog, Scan, Zuweisung, Audio-Wiedergabe) ist nicht hier testbar und
 * muss vom User verifiziert werden.
 */
import { describe, it, expect } from "vitest";
import {
  basenameOf,
  matchSamplesByBasename,
  collectSampleNames,
} from "../../client/src/utils/imports/flpSampleLoader";

describe("basenameOf", () => {
  it("Windows-Pfad", () => {
    expect(basenameOf("C:\\smp\\CB_Kick.wav")).toBe("CB_Kick.wav");
  });
  it("POSIX-Pfad", () => {
    expect(basenameOf("/home/x/snare.wav")).toBe("snare.wav");
  });
  it("nackter Name bleibt unverändert", () => {
    expect(basenameOf("hat.wav")).toBe("hat.wav");
  });
});

describe("matchSamplesByBasename", () => {
  const files = [
    { absolutePath: "E:\\proj\\CB_Kick.wav" },
    { absolutePath: "E:\\proj\\sub\\Kore Snare_6.wav" },
    { absolutePath: "E:\\proj\\FX04.WAV" },
  ];

  it("matcht exakte Basenames (Pfad ignoriert, auch Subordner)", () => {
    const r = matchSamplesByBasename(["CB_Kick.wav", "Kore Snare_6.wav"], files);
    expect(r.matched["CB_Kick.wav"]).toBe("E:\\proj\\CB_Kick.wav");
    expect(r.matched["Kore Snare_6.wav"]).toBe("E:\\proj\\sub\\Kore Snare_6.wav");
    expect(r.missing).toEqual([]);
  });

  it("ist case-insensitive (FX04.WAV ↔ fx04.wav)", () => {
    const r = matchSamplesByBasename(["fx04.wav"], files);
    expect(r.matched["fx04.wav"]).toBe("E:\\proj\\FX04.WAV");
  });

  it("meldet fehlende Samples in missing", () => {
    const r = matchSamplesByBasename(["CB_Kick.wav", "ghost.wav"], files);
    expect(Object.keys(r.matched)).toEqual(["CB_Kick.wav"]);
    expect(r.missing).toEqual(["ghost.wav"]);
  });

  it("bei Duplikat-Basename gewinnt die erste Datei", () => {
    const dup = [
      { absolutePath: "E:\\a\\loop.wav" },
      { absolutePath: "E:\\b\\loop.wav" },
    ];
    expect(matchSamplesByBasename(["loop.wav"], dup).matched["loop.wav"]).toBe("E:\\a\\loop.wav");
  });

  it("dedupliziert Eingabe-Namen + ignoriert leere", () => {
    const r = matchSamplesByBasename(["CB_Kick.wav", "CB_Kick.wav", ""], files);
    expect(Object.keys(r.matched)).toEqual(["CB_Kick.wav"]);
    expect(r.missing).toEqual([]);
  });

  it("leere Datei-Liste → alles missing", () => {
    const r = matchSamplesByBasename(["a.wav", "b.wav"], []);
    expect(r.matched).toEqual({});
    expect(r.missing).toEqual(["a.wav", "b.wav"]);
  });
});

describe("collectSampleNames", () => {
  it("sammelt eindeutige, nicht-leere sampleNames über Patterns/Parts", () => {
    const patterns = [
      { parts: [{ sampleName: "kick.wav" }, { sampleName: "snare.wav" }, { sampleName: undefined }] },
      { parts: [{ sampleName: "kick.wav" }, { sampleName: "hat.wav" }] },
    ];
    expect(collectSampleNames(patterns).sort()).toEqual(["hat.wav", "kick.wav", "snare.wav"]);
  });

  it("leer wenn keine sampleNames", () => {
    expect(collectSampleNames([{ parts: [{}, {}] }])).toEqual([]);
  });
});
