// @vitest-environment jsdom
/**
 * pattern-cache.test.ts — Sprint-104 localStorage Pattern-Persistence.
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  loadPatternCache, savePatternCache, clearPatternCache,
  getDefaultPattern,
} from "../../client/src/utils/patternCache";

const CACHE_KEY = "synthstudio:omnitribe.pattern.v1";
const CACHE_KEY_V2 = "synthstudio:omnitribe.patternBank.v2";

describe("patternCache", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns defaults when empty", () => {
    const p = loadPatternCache();
    expect(p.steps).toEqual(Array(16).fill(false));
    expect(p.velocities).toEqual(Array(16).fill(100));
    expect(p.bpm).toBe(120);
    expect(p.root).toBe(60);
  });

  it("getDefaultPattern liefert fresh copy", () => {
    const a = getDefaultPattern();
    const b = getDefaultPattern();
    a.steps[0] = true;
    expect(b.steps[0]).toBe(false);
  });

  it("roundtrip steps + velocities + bpm + root", () => {
    const steps = [true, false, true, false, true, false, true, false,
                    true, false, true, false, true, false, true, false];
    const velocities = [10, 20, 30, 40, 50, 60, 70, 80,
                         90, 100, 110, 120, 127, 1, 64, 100];
    savePatternCache({ steps, velocities, bpm: 90, root: 72 });
    const loaded = loadPatternCache();
    expect(loaded.steps).toEqual(steps);
    expect(loaded.velocities).toEqual(velocities);
    expect(loaded.bpm).toBe(90);
    expect(loaded.root).toBe(72);
  });

  it("clamps bpm zu 40..240", () => {
    savePatternCache({ ...getDefaultPattern(), bpm: 999 });
    expect(loadPatternCache().bpm).toBe(240);
    savePatternCache({ ...getDefaultPattern(), bpm: -10 });
    expect(loadPatternCache().bpm).toBe(40);
  });

  it("clamps root zu 0..127", () => {
    savePatternCache({ ...getDefaultPattern(), root: 200 });
    expect(loadPatternCache().root).toBe(127);
  });

  it("ignoriert kaputtes JSON, gibt defaults", () => {
    window.localStorage.setItem(CACHE_KEY, "{nope");
    expect(loadPatternCache().bpm).toBe(120);
  });

  it("ignoriert falsches schema (steps nicht array)", () => {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({
      steps: "string", velocities: 5, bpm: "xx", root: null,
    }));
    const p = loadPatternCache();
    expect(p.steps.length).toBe(16);
    expect(p.bpm).toBe(120);
  });

  it("ignoriert falsche array-laenge", () => {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({
      steps: [true, true, true],   // nur 3 statt 16
      velocities: [50, 60, 70],
      bpm: 120, root: 60,
    }));
    expect(loadPatternCache().steps.length).toBe(16);
  });

  it("clearPatternCache loescht den Eintrag", () => {
    // Sprint-107: savePatternCache schreibt jetzt in v2-Bank (CACHE_KEY_V2)
    savePatternCache(getDefaultPattern());
    expect(window.localStorage.getItem(CACHE_KEY_V2)).toBeTruthy();
    clearPatternCache();
    expect(window.localStorage.getItem(CACHE_KEY_V2)).toBeNull();
    expect(window.localStorage.getItem(CACHE_KEY)).toBeNull();
  });

  it("save ueberlebt Quota-Errors ohne throw", () => {
    const orig = window.localStorage.setItem;
    window.localStorage.setItem = () => { throw new Error("Quota"); };
    expect(() => savePatternCache(getDefaultPattern())).not.toThrow();
    window.localStorage.setItem = orig;
  });
});
