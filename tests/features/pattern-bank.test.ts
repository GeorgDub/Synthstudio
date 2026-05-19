// @vitest-environment jsdom
/**
 * pattern-bank.test.ts — Sprint-107 Pattern-Bank Cache-Tests.
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  loadPatternBank, savePatternBank, clearPatternBank,
  getDefaultBank, getDefaultPattern, PATTERN_BANK_SIZE,
  loadPatternCache, savePatternCache,   // deprecated-API
} from "../../client/src/utils/patternCache";

const KEY_V1 = "synthstudio:omnitribe.pattern.v1";
const KEY_V2 = "synthstudio:omnitribe.patternBank.v2";


describe("PatternBank (Sprint-107)", () => {
  beforeEach(() => window.localStorage.clear());

  // ─── Defaults ─────────────────────────────────────────

  it("getDefaultBank liefert 8 leere Slots", () => {
    const b = getDefaultBank();
    expect(b.patterns.length).toBe(PATTERN_BANK_SIZE);
    expect(PATTERN_BANK_SIZE).toBe(8);
    expect(b.activeSlot).toBe(0);
    for (const p of b.patterns) {
      expect(p.steps).toEqual(Array(16).fill(false));
    }
  });

  it("loadPatternBank ohne Storage → default", () => {
    const b = loadPatternBank();
    expect(b.activeSlot).toBe(0);
    expect(b.patterns.length).toBe(8);
  });

  // ─── Roundtrip ────────────────────────────────────────

  it("save+load roundtrip preserves alle Slots", () => {
    const bank = getDefaultBank();
    bank.patterns[0].steps[0] = true;
    bank.patterns[3].steps[7] = true;
    bank.patterns[3].velocities[7] = 42;
    bank.patterns[3].bpm = 90;
    bank.activeSlot = 3;
    savePatternBank(bank);
    const loaded = loadPatternBank();
    expect(loaded.activeSlot).toBe(3);
    expect(loaded.patterns[0].steps[0]).toBe(true);
    expect(loaded.patterns[3].steps[7]).toBe(true);
    expect(loaded.patterns[3].velocities[7]).toBe(42);
    expect(loaded.patterns[3].bpm).toBe(90);
  });

  it("activeSlot wird auf [0, BANK_SIZE-1] clamped", () => {
    const bank = getDefaultBank();
    bank.activeSlot = 99 as unknown as number;
    savePatternBank(bank);
    expect(loadPatternBank().activeSlot).toBe(PATTERN_BANK_SIZE - 1);
  });

  // ─── v1 → v2 Migration ───────────────────────────────

  it("Migration: v1-Daten landen in v2-Slot 0", () => {
    window.localStorage.setItem(KEY_V1, JSON.stringify({
      steps: [true, false, true, false, false, false, false, false,
               false, false, false, false, false, false, false, false],
      velocities: Array(16).fill(80),
      pitchOffsets: Array(16).fill(0),
      bpm: 90, root: 64,
    }));
    const bank = loadPatternBank();
    expect(bank.patterns[0].steps[0]).toBe(true);
    expect(bank.patterns[0].steps[2]).toBe(true);
    expect(bank.patterns[0].bpm).toBe(90);
    expect(bank.patterns[0].root).toBe(64);
    // Slot 1..7 bleiben default
    expect(bank.patterns[1].steps.every((s) => !s)).toBe(true);
    expect(bank.activeSlot).toBe(0);
  });

  it("Nach Migration: v2-Eintrag existiert (kein erneutes Migrate-Loop)", () => {
    window.localStorage.setItem(KEY_V1, JSON.stringify({
      ...getDefaultPattern(),
      steps: [true, ...Array(15).fill(false)],
    }));
    loadPatternBank();   // triggert Migration
    expect(window.localStorage.getItem(KEY_V2)).toBeTruthy();
  });

  // ─── Deprecated-API Layer ────────────────────────────

  it("loadPatternCache liefert activeSlot des Bank", () => {
    const bank = getDefaultBank();
    bank.activeSlot = 2;
    bank.patterns[2].bpm = 180;
    savePatternBank(bank);
    expect(loadPatternCache().bpm).toBe(180);
  });

  it("savePatternCache schreibt nur in activeSlot", () => {
    const bank = getDefaultBank();
    bank.activeSlot = 1;
    bank.patterns[0].bpm = 100;   // unverändert
    savePatternBank(bank);
    // Save via deprecated API in Slot 1
    savePatternCache({
      ...getDefaultPattern(),
      bpm: 150,
    });
    const reloaded = loadPatternBank();
    expect(reloaded.patterns[0].bpm).toBe(100);   // Slot 0 unchanged
    expect(reloaded.patterns[1].bpm).toBe(150);   // Slot 1 changed
  });

  // ─── Schema-Validation / Corruption ──────────────────

  it("kaputtes v2-JSON → defaults", () => {
    window.localStorage.setItem(KEY_V2, "{not-json");
    const b = loadPatternBank();
    expect(b.activeSlot).toBe(0);
  });

  it("falsche patterns-Laenge → defaults", () => {
    window.localStorage.setItem(KEY_V2, JSON.stringify({
      patterns: [getDefaultPattern()],   // nur 1 statt 8
      activeSlot: 0,
    }));
    const b = loadPatternBank();
    expect(b.patterns.length).toBe(PATTERN_BANK_SIZE);
  });

  it("clearPatternBank loescht v1 und v2", () => {
    window.localStorage.setItem(KEY_V1, "x");
    savePatternBank(getDefaultBank());
    clearPatternBank();
    expect(window.localStorage.getItem(KEY_V1)).toBeNull();
    expect(window.localStorage.getItem(KEY_V2)).toBeNull();
  });

  it("save swallowed Quota-Errors ohne throw", () => {
    const orig = window.localStorage.setItem;
    window.localStorage.setItem = () => { throw new Error("Quota"); };
    expect(() => savePatternBank(getDefaultBank())).not.toThrow();
    window.localStorage.setItem = orig;
  });
});
