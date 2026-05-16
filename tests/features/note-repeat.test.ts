/**
 * tests/features/note-repeat.test.ts (TASK-CVG-NOTEREPEAT / v2.61)
 *
 * Pure-Coverage für client/src/utils/noteRepeat.ts (75 LOC).
 *
 * Note-Repeat (MPC-Style Live-Retrigger) Rate-Tabelle + BPM-Math.
 * Falsche Werte führen zu fühlbaren Timing-Fehlern beim Live-Spiel.
 */
import { describe, it, expect } from "vitest";
import {
  NOTE_REPEAT_RATES,
  MIN_INTERVAL_MS,
  getRateDef,
  rateToIntervalMs,
  safeIntervalMs,
  type NoteRepeatRate,
} from "@/utils/noteRepeat";

describe("NoteRepeat – Schema", () => {
  it("NOTE_REPEAT_RATES enthält genau 8 Raten (4 Standard + 4 Triplet)", () => {
    expect(NOTE_REPEAT_RATES).toHaveLength(8);
  });

  it("Jede Rate hat label, rate und positive beats", () => {
    for (const r of NOTE_REPEAT_RATES) {
      expect(r.rate).toBeTruthy();
      expect(r.label).toBeTruthy();
      expect(r.beats).toBeGreaterThan(0);
    }
  });

  it("Triplet-Raten haben kürzere beats als ihre Standard-Pendants", () => {
    const std = getRateDef("1/8").beats;
    const trip = getRateDef("1/8T").beats;
    expect(trip).toBeLessThan(std);
  });

  it("MIN_INTERVAL_MS ist konservativ (≥ 4ms wegen Browser-Timer-Overhead)", () => {
    expect(MIN_INTERVAL_MS).toBeGreaterThanOrEqual(4);
  });
});

describe("NoteRepeat – getRateDef", () => {
  it("liefert 1/4 mit beats=1", () => {
    expect(getRateDef("1/4").beats).toBe(1);
  });

  it("liefert 1/8 mit beats=0.5", () => {
    expect(getRateDef("1/8").beats).toBe(0.5);
  });

  it("liefert 1/16 mit beats=0.25", () => {
    expect(getRateDef("1/16").beats).toBe(0.25);
  });

  it("liefert 1/32 mit beats=0.125", () => {
    expect(getRateDef("1/32").beats).toBe(1 / 8);
  });

  it("1/4T triplet: beats=2/3 (drei Trigger pro 1/2-Beat)", () => {
    expect(getRateDef("1/4T").beats).toBeCloseTo(2 / 3, 10);
  });

  it("1/8T triplet: beats=1/3", () => {
    expect(getRateDef("1/8T").beats).toBeCloseTo(1 / 3, 10);
  });

  it("wirft für unbekannte Rate", () => {
    expect(() => getRateDef("99/123" as NoteRepeatRate)).toThrow(/Unknown note-repeat rate/);
  });
});

describe("NoteRepeat – rateToIntervalMs", () => {
  it("1/4 @ 120 BPM = 500ms (60_000/120 * 1)", () => {
    expect(rateToIntervalMs("1/4", 120)).toBe(500);
  });

  it("1/8 @ 120 BPM = 250ms", () => {
    expect(rateToIntervalMs("1/8", 120)).toBe(250);
  });

  it("1/16 @ 120 BPM = 125ms", () => {
    expect(rateToIntervalMs("1/16", 120)).toBe(125);
  });

  it("1/32 @ 120 BPM = 62.5ms", () => {
    expect(rateToIntervalMs("1/32", 120)).toBeCloseTo(62.5, 5);
  });

  it("1/4 @ 60 BPM = 1000ms", () => {
    expect(rateToIntervalMs("1/4", 60)).toBe(1000);
  });

  it("1/4 @ 240 BPM = 250ms", () => {
    expect(rateToIntervalMs("1/4", 240)).toBe(250);
  });

  it("1/8T @ 120 BPM ≈ 166.67ms (1/3 Beat)", () => {
    expect(rateToIntervalMs("1/8T", 120)).toBeCloseTo(166.666, 2);
  });

  it("wirft bei BPM=0", () => {
    expect(() => rateToIntervalMs("1/4", 0)).toThrow(/BPM must be > 0/);
  });

  it("wirft bei negativem BPM", () => {
    expect(() => rateToIntervalMs("1/4", -120)).toThrow(/BPM must be > 0/);
  });
});

describe("NoteRepeat – safeIntervalMs", () => {
  it("Normaler Bereich: 1/4 @ 120 = 500ms (über MIN)", () => {
    expect(safeIntervalMs("1/4", 120)).toBe(500);
  });

  it("Extrem hohes BPM + fine grain: clamp auf MIN_INTERVAL_MS", () => {
    // 1/32T @ 999 BPM → sehr kurz, sollte auf MIN_INTERVAL_MS clamped werden
    const result = safeIntervalMs("1/32T", 999);
    expect(result).toBe(MIN_INTERVAL_MS);
  });

  it("1/4 @ 60 BPM = 1000ms (kein Clamp)", () => {
    expect(safeIntervalMs("1/4", 60)).toBe(1000);
  });

  it("wirft bei BPM=0 (gleich wie rateToIntervalMs)", () => {
    expect(() => safeIntervalMs("1/4", 0)).toThrow(/BPM must be > 0/);
  });
});
