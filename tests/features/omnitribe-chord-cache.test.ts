// @vitest-environment jsdom
/**
 * omnitribe-chord-cache.test.ts — Sprint-97 localStorage-Cache fuer
 * Chord-User-Slots. Tests fuer chordUserSlotsCache.ts.
 *
 * Schema-Verifikation: v1, Defaults bei Cache-Miss, Schema-Mismatch Fallback.
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  loadChordUserSlotsCache,
  saveChordUserSlotsCache,
  clearChordUserSlotsCache,
  getDefaultChordUserSlots,
} from "../../client/src/utils/chordUserSlotsCache";

const CACHE_KEY = "omnitribe.chordUserSlots.v1";

describe("chordUserSlotsCache", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  // ─── Defaults ───────────────────────────────────────────

  it("returns defaults when cache is empty", () => {
    const slots = loadChordUserSlotsCache();
    expect(slots[11]).toBe("0,4,7");
    expect(slots[12]).toBe("0,3,7");
    expect(slots[13]).toBe("0,4,7,11");
    expect(slots[14]).toBe("0,5,7");
  });

  it("getDefaultChordUserSlots returns a fresh copy each time", () => {
    const a = getDefaultChordUserSlots();
    const b = getDefaultChordUserSlots();
    a[11] = "modified";
    expect(b[11]).toBe("0,4,7");
  });

  // ─── Save + Load Roundtrip ─────────────────────────────

  it("roundtrips user-defined slot definitions", () => {
    saveChordUserSlotsCache({
      11: "0,3,7,10",
      12: "0,5,7",
      13: "0,4,7,12",
      14: "0,2,5,9",
    });
    const loaded = loadChordUserSlotsCache();
    expect(loaded[11]).toBe("0,3,7,10");
    expect(loaded[12]).toBe("0,5,7");
    expect(loaded[13]).toBe("0,4,7,12");
    expect(loaded[14]).toBe("0,2,5,9");
  });

  it("partial save still loads with defaults for missing slots", () => {
    // Nur Slot 11 setzen — andere sollten Defaults sein
    saveChordUserSlotsCache({ 11: "0,1,2,3" });
    const loaded = loadChordUserSlotsCache();
    expect(loaded[11]).toBe("0,1,2,3");
    expect(loaded[12]).toBe("0,3,7");      // default
  });

  it("save writes valid JSON with schema v1 key", () => {
    saveChordUserSlotsCache({ 11: "0,4,7" });
    const raw = window.localStorage.getItem(CACHE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as {
      slots: Array<{ slotId: number; csv: string }>;
      savedAt: number;
    };
    expect(Array.isArray(parsed.slots)).toBe(true);
    expect(typeof parsed.savedAt).toBe("number");
  });

  // ─── Schema-Mismatch / Corruption Handling ─────────────

  it("ignores corrupted JSON and returns defaults", () => {
    window.localStorage.setItem(CACHE_KEY, "{not valid json");
    const slots = loadChordUserSlotsCache();
    expect(slots[11]).toBe("0,4,7");   // defaults restored
  });

  it("ignores wrong schema (non-array slots) and returns defaults", () => {
    window.localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ slots: "not-an-array", savedAt: 0 }),
    );
    const slots = loadChordUserSlotsCache();
    expect(slots[11]).toBe("0,4,7");
  });

  it("filters out invalid slotIds during load", () => {
    window.localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        slots: [
          { slotId: 5, csv: "should-be-ignored" },   // < 11
          { slotId: 99, csv: "also-ignored" },        // > 14
          { slotId: 12, csv: "0,2,4" },               // valid
        ],
        savedAt: 0,
      }),
    );
    const slots = loadChordUserSlotsCache();
    expect(slots[12]).toBe("0,2,4");
    expect(slots[5]).toBeUndefined();
    expect(slots[99]).toBeUndefined();
  });

  // ─── Clear ────────────────────────────────────────────

  it("clearChordUserSlotsCache wipes the cache", () => {
    saveChordUserSlotsCache({ 11: "1,2,3" });
    clearChordUserSlotsCache();
    expect(window.localStorage.getItem(CACHE_KEY)).toBeNull();
    const loaded = loadChordUserSlotsCache();
    expect(loaded[11]).toBe("0,4,7");   // back to default
  });

  // ─── Resilience ───────────────────────────────────────

  it("save does not throw when localStorage throws (Quota etc.)", () => {
    const origSetItem = window.localStorage.setItem;
    window.localStorage.setItem = () => {
      throw new Error("QuotaExceeded");
    };
    expect(() => saveChordUserSlotsCache({ 11: "0,4,7" })).not.toThrow();
    window.localStorage.setItem = origSetItem;
  });

  it("load returns defaults when localStorage throws on getItem", () => {
    const origGetItem = window.localStorage.getItem;
    window.localStorage.getItem = () => {
      throw new Error("AccessDenied");
    };
    const slots = loadChordUserSlotsCache();
    expect(slots[11]).toBe("0,4,7");
    window.localStorage.getItem = origGetItem;
  });
});
