/**
 * tests/features/auto-mix.test.ts  (v3.122.0)
 *
 * Smart Auto-Mix — LUFS-driven Gain-Staging.
 *
 * Pure-Helper-Tests (computeSuggestion / applySuggestions / clamp) + Store-
 * Tests (target / duration / category-defaults).
 *
 * Mind. 9 Tests laut Task — wir liefern 14.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  computeSuggestion,
  applySuggestions,
  clampGainSuggestion,
  volumeLinearToDb,
  volumeDbToLinear,
  MAX_GAIN_ADJUST_DB,
  MIN_MEASURED_LUFS,
  type MixSuggestion,
} from "../../client/src/utils/autoMixSuggestions";
import {
  __resetAutoMixStoreForTests,
  __getAutoMixStateForTests,
  setChannelTarget,
  setMeasurementDuration,
  setDefaultTarget,
  getChannelTarget,
  MEASUREMENT_DURATION_MIN_MS,
  MEASUREMENT_DURATION_MAX_MS,
  DEFAULT_TARGET_BY_CATEGORY,
  type DrumCategoryLike,
} from "../../client/src/store/useAutoMixStore";

// ─── (1) computeSuggestion ──────────────────────────────────────────────────

describe("v3.122 computeSuggestion", () => {
  it("target=-10, measured=-7 → suggest -3 dB (zu laut)", () => {
    const s = computeSuggestion("kick", 0, -7, -10);
    expect(s.channelId).toBe("kick");
    expect(s.suggestedGainDb).toBeCloseTo(-3, 6);
    expect(s.measuredLufs).toBe(-7);
    expect(s.targetLufs).toBe(-10);
  });

  it("target=-10, measured=-14 → suggest +4 dB (zu leise)", () => {
    const s = computeSuggestion("snare", 0, -14, -10);
    expect(s.suggestedGainDb).toBeCloseTo(4, 6);
  });

  it("clamp suggested > +24 dB", () => {
    // target=-10, measured=-60 → +50 dB roh → clamped auf +24.
    const s = computeSuggestion("hat", 0, -60, -10);
    expect(s.suggestedGainDb).toBe(MAX_GAIN_ADJUST_DB);
  });

  it("clamp suggested < -24 dB", () => {
    // target=-30, measured=+5 → -35 dB roh → clamped auf -24.
    const s = computeSuggestion("perc", 0, 5, -30);
    expect(s.suggestedGainDb).toBe(-MAX_GAIN_ADJUST_DB);
  });

  it("measured = -Infinity (silence) → suggest 0 (keine Aussage)", () => {
    const s = computeSuggestion("muted", 0, -Infinity, -10);
    expect(s.suggestedGainDb).toBe(0);
  });

  it("measured < MIN_MEASURED_LUFS → suggest 0", () => {
    const s = computeSuggestion("sub", 0, MIN_MEASURED_LUFS - 1, -10);
    expect(s.suggestedGainDb).toBe(0);
  });

  it("measured = NaN → suggest 0", () => {
    const s = computeSuggestion("nan", 0, NaN, -10);
    expect(s.suggestedGainDb).toBe(0);
  });

  it("target = -Infinity → suggest 0 (defensive)", () => {
    const s = computeSuggestion("bad", 0, -10, -Infinity);
    expect(s.suggestedGainDb).toBe(0);
  });
});

// ─── (2) clampGainSuggestion ────────────────────────────────────────────────

describe("v3.122 clampGainSuggestion", () => {
  it("erhaelt Vorzeichen + Magnitude im Range", () => {
    expect(clampGainSuggestion(0)).toBe(0);
    expect(clampGainSuggestion(5)).toBe(5);
    expect(clampGainSuggestion(-10)).toBe(-10);
  });

  it("clamped Excess auf +/- MAX", () => {
    expect(clampGainSuggestion(100)).toBe(MAX_GAIN_ADJUST_DB);
    expect(clampGainSuggestion(-100)).toBe(-MAX_GAIN_ADJUST_DB);
  });

  it("non-finite → 0", () => {
    expect(clampGainSuggestion(NaN)).toBe(0);
    expect(clampGainSuggestion(Infinity)).toBe(0);
    expect(clampGainSuggestion(-Infinity)).toBe(0);
  });
});

// ─── (3) applySuggestions ──────────────────────────────────────────────────

describe("v3.122 applySuggestions", () => {
  const suggestions: MixSuggestion[] = [
    { channelId: "kick",  currentVolumeDb:  0, measuredLufs:  -7, targetLufs: -10, suggestedGainDb: -3 },
    { channelId: "snare", currentVolumeDb: -3, measuredLufs: -14, targetLufs: -12, suggestedGainDb:  2 },
    { channelId: "hat",   currentVolumeDb: -6, measuredLufs: -16, targetLufs: -15, suggestedGainDb:  1 },
  ];

  it("applyMap filters which to apply (nur true-Eintraege)", () => {
    const map = new Map<string, boolean>([
      ["kick",  true],
      ["snare", false],
      ["hat",   true],
    ]);
    const out = applySuggestions(suggestions, map);
    expect(out.map(o => o.channelId).sort()).toEqual(["hat", "kick"]);
  });

  it("returns new volumes (currentVolumeDb + suggestedGainDb)", () => {
    const map = new Map<string, boolean>([
      ["kick",  true],
      ["snare", true],
      ["hat",   true],
    ]);
    const out = applySuggestions(suggestions, map);
    const kick  = out.find(o => o.channelId === "kick");
    const snare = out.find(o => o.channelId === "snare");
    const hat   = out.find(o => o.channelId === "hat");
    expect(kick?.newVolDb).toBeCloseTo(-3, 6);   //  0 + (-3) = -3
    expect(snare?.newVolDb).toBeCloseTo(-1, 6);  // -3 + 2    = -1
    expect(hat?.newVolDb).toBeCloseTo(-5, 6);    // -6 + 1    = -5
  });

  it("empty applyMap → leeres Ergebnis", () => {
    const out = applySuggestions(suggestions, new Map());
    expect(out).toEqual([]);
  });
});

// ─── (4) Volume <-> dB Helpers ──────────────────────────────────────────────

describe("v3.122 volumeLinearToDb / volumeDbToLinear", () => {
  it("Round-Trip Identitaet im sinnvollen Range", () => {
    for (const db of [-24, -12, -6, 0, 6, 12]) {
      const lin = volumeDbToLinear(db);
      const back = volumeLinearToDb(lin);
      expect(back).toBeCloseTo(db, 6);
    }
  });

  it("Edge-Cases: 0 → -Inf, 1 → 0 dB", () => {
    expect(volumeLinearToDb(1)).toBe(0);
    expect(volumeLinearToDb(0)).toBe(-Infinity);
    expect(volumeDbToLinear(0)).toBeCloseTo(1, 6);
    expect(volumeDbToLinear(-Infinity)).toBe(0);
  });
});

// ─── (5) useAutoMixStore ───────────────────────────────────────────────────

describe("v3.122 useAutoMixStore", () => {
  beforeEach(() => {
    __resetAutoMixStoreForTests();
  });

  it("defaultTargetByCategory: Kick -10, Hat -15, Snare -12, Bass -10", () => {
    expect(DEFAULT_TARGET_BY_CATEGORY.kick).toBe(-10);
    expect(DEFAULT_TARGET_BY_CATEGORY.snare).toBe(-12);
    expect(DEFAULT_TARGET_BY_CATEGORY["hihat-closed"]).toBe(-15);
    expect(DEFAULT_TARGET_BY_CATEGORY["hihat-open"]).toBe(-15);
    expect(DEFAULT_TARGET_BY_CATEGORY.bass).toBe(-10);
    expect(DEFAULT_TARGET_BY_CATEGORY.synth).toBe(-14);
  });

  it("Store channelTarget overrides default", () => {
    setChannelTarget("part-1", -8);
    const t = getChannelTarget("part-1", "kick");
    expect(t).toBe(-8);
    // Ohne Override: fallt auf Category-Default zurueck.
    const noOverride = getChannelTarget("part-2", "snare");
    expect(noOverride).toBe(-12);
  });

  it("Store measurementDuration validates 5s-120s", () => {
    setMeasurementDuration(20000);
    expect(__getAutoMixStateForTests().measurementDurationMs).toBe(20000);

    // Zu kurz → clamped auf min.
    setMeasurementDuration(1000);
    expect(__getAutoMixStateForTests().measurementDurationMs).toBe(MEASUREMENT_DURATION_MIN_MS);

    // Zu lang → clamped auf max.
    setMeasurementDuration(999999);
    expect(__getAutoMixStateForTests().measurementDurationMs).toBe(MEASUREMENT_DURATION_MAX_MS);
  });

  it("setDefaultTarget aendert die Category-Default-Werte", () => {
    setDefaultTarget("kick" as DrumCategoryLike, -8);
    const t = getChannelTarget("anyChannel", "kick");
    expect(t).toBe(-8);
  });
});
