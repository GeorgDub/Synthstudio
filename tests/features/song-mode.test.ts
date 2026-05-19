// @vitest-environment jsdom
/**
 * song-mode.test.ts — Sprint-108 Song-Mode Cache-Tests.
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  loadPatternBank, savePatternBank, getDefaultBank,
  PATTERN_BANK_SIZE, type SongStep,
} from "../../client/src/utils/patternCache";


describe("Song-Mode Cache (Sprint-108)", () => {
  beforeEach(() => window.localStorage.clear());

  // ─── Defaults ─────────────────────────────────────────

  it("getDefaultBank hat songMode=false + leere songSequence", () => {
    const b = getDefaultBank();
    expect(b.songMode).toBe(false);
    expect(b.songSequence).toEqual([]);
  });

  // ─── Roundtrip ────────────────────────────────────────

  it("Save+Load roundtrip preserves songMode + songSequence", () => {
    const b = getDefaultBank();
    b.songMode = true;
    b.songSequence = [
      { slot: 0, repeats: 2 },
      { slot: 1, repeats: 4 },
      { slot: 2, repeats: 1 },
    ];
    savePatternBank(b);
    const loaded = loadPatternBank();
    expect(loaded.songMode).toBe(true);
    expect(loaded.songSequence.length).toBe(3);
    expect(loaded.songSequence[0]).toEqual({ slot: 0, repeats: 2 });
    expect(loaded.songSequence[1]).toEqual({ slot: 1, repeats: 4 });
  });

  // ─── Defensive Parsing ───────────────────────────────

  it("invalid slot in songStep wird gefiltert", () => {
    window.localStorage.setItem(
      "synthstudio:omnitribe.patternBank.v2",
      JSON.stringify({
        ...getDefaultBank(),
        songSequence: [
          { slot: 0, repeats: 2 },
          { slot: 99, repeats: 1 },   // invalid
          { slot: 2, repeats: 1 },
        ],
      }),
    );
    const b = loadPatternBank();
    // ungueltige slots werden gefiltert ODER auf gueltigen Bereich clamped
    expect(b.songSequence.every(
      (s: SongStep) => s.slot >= 0 && s.slot < PATTERN_BANK_SIZE,
    )).toBe(true);
  });

  it("repeats clamped auf [1, 32]", () => {
    window.localStorage.setItem(
      "synthstudio:omnitribe.patternBank.v2",
      JSON.stringify({
        ...getDefaultBank(),
        songSequence: [
          { slot: 0, repeats: 99 },
          { slot: 1, repeats: 0 },
          { slot: 2, repeats: 5 },
        ],
      }),
    );
    const b = loadPatternBank();
    expect(b.songSequence[0].repeats).toBe(32);
    expect(b.songSequence[1].repeats).toBe(1);
    expect(b.songSequence[2].repeats).toBe(5);
  });

  it("songMode-string statt boolean → false", () => {
    window.localStorage.setItem(
      "synthstudio:omnitribe.patternBank.v2",
      JSON.stringify({
        ...getDefaultBank(),
        songMode: "yes",
      }),
    );
    expect(loadPatternBank().songMode).toBe(false);
  });

  it("songSequence kein array → leeres array", () => {
    window.localStorage.setItem(
      "synthstudio:omnitribe.patternBank.v2",
      JSON.stringify({
        ...getDefaultBank(),
        songSequence: "nope",
      }),
    );
    expect(loadPatternBank().songSequence).toEqual([]);
  });

  // ─── Forward-Compat (v2 ohne songMode-Feld) ────────────

  it("v2-Cache ohne songMode-Feld bekommt defaults", () => {
    window.localStorage.setItem(
      "synthstudio:omnitribe.patternBank.v2",
      JSON.stringify({
        patterns: getDefaultBank().patterns,
        activeSlot: 0,
        // kein songMode + songSequence
      }),
    );
    const b = loadPatternBank();
    expect(b.songMode).toBe(false);
    expect(b.songSequence).toEqual([]);
  });
});
