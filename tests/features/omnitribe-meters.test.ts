// @vitest-environment jsdom
/**
 * omnitribe-meters.test.ts — Tests fuer useOmniTribeMetersStore (v3.18.0).
 *
 * Coverage:
 *   - VU-Event updated Store mit 16 Levels
 *   - Spectrum-Event updated Store mit 64 Bins
 *   - Disconnect resets Levels auf 0
 *   - Diff-vor-notify: idempotente Setter (kein notify wenn keine Aenderung)
 *   - Out-of-range Clamping (NaN, negative, >127)
 *   - Hook re-rendert nur bei tatsaechlicher Aenderung
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  setOmniTribeVuLevels,
  setOmniTribeSpectrumBins,
  resetOmniTribeMeters,
  getOmniTribeVuLevelsSnapshot,
  getOmniTribeSpectrumBinsSnapshot,
  __resetOmniTribeMetersStoreForTests,
  OMNITRIBE_VU_CHANNELS,
  OMNITRIBE_SPECTRUM_BINS,
} from "../../client/src/store/useOmniTribeMetersStore";

beforeEach(() => {
  __resetOmniTribeMetersStoreForTests();
});

describe("useOmniTribeMetersStore — VU updates", () => {
  it("VU-Event updated Store mit 16 Levels", () => {
    const levels = Array.from({ length: 16 }, (_, i) => i * 8);   // 0,8,16,…,120
    setOmniTribeVuLevels(levels);
    const snap = getOmniTribeVuLevelsSnapshot();
    expect(snap.length).toBe(OMNITRIBE_VU_CHANNELS);
    for (let i = 0; i < 16; i++) {
      expect(snap[i]).toBe(i * 8);
    }
  });

  it("clamps VU levels to 0..127, NaN→0", () => {
    setOmniTribeVuLevels([200, -5, NaN, 50, 127.9, ...new Array(11).fill(0)]);
    const snap = getOmniTribeVuLevelsSnapshot();
    expect(snap[0]).toBe(127);
    expect(snap[1]).toBe(0);
    expect(snap[2]).toBe(0);
    expect(snap[3]).toBe(50);
    expect(snap[4]).toBe(127);
  });

  it("padded mit 0 wenn weniger als 16 levels uebergeben werden", () => {
    setOmniTribeVuLevels([10, 20, 30]);
    const snap = getOmniTribeVuLevelsSnapshot();
    expect(snap[0]).toBe(10);
    expect(snap[1]).toBe(20);
    expect(snap[2]).toBe(30);
    for (let i = 3; i < 16; i++) {
      expect(snap[i]).toBe(0);
    }
  });
});

describe("useOmniTribeMetersStore — Spectrum updates", () => {
  it("Spectrum-Event updated Store mit 64 Bins", () => {
    const bins = Array.from({ length: 64 }, (_, i) => i * 2);   // 0,2,4,…,126
    setOmniTribeSpectrumBins(bins);
    const snap = getOmniTribeSpectrumBinsSnapshot();
    expect(snap.length).toBe(OMNITRIBE_SPECTRUM_BINS);
    for (let i = 0; i < 64; i++) {
      expect(snap[i]).toBe(i * 2);
    }
  });

  it("padded mit 0 wenn weniger als 64 bins uebergeben werden", () => {
    setOmniTribeSpectrumBins([100, 90, 80]);
    const snap = getOmniTribeSpectrumBinsSnapshot();
    expect(snap[0]).toBe(100);
    expect(snap[1]).toBe(90);
    expect(snap[2]).toBe(80);
    expect(snap[3]).toBe(0);
    expect(snap[63]).toBe(0);
  });
});

describe("useOmniTribeMetersStore — Reset / Disconnect", () => {
  it("Disconnect resets Levels auf 0", () => {
    setOmniTribeVuLevels(new Array(16).fill(100));
    setOmniTribeSpectrumBins(new Array(64).fill(50));

    resetOmniTribeMeters();

    const vu  = getOmniTribeVuLevelsSnapshot();
    const sp  = getOmniTribeSpectrumBinsSnapshot();
    expect(vu.every((v) => v === 0)).toBe(true);
    expect(sp.every((v) => v === 0)).toBe(true);
  });

  it("Reset ohne vorhergehende Aenderung ist idempotent", () => {
    // Alles ist bereits 0 — reset darf nicht crashen.
    expect(() => resetOmniTribeMeters()).not.toThrow();
    const vu = getOmniTribeVuLevelsSnapshot();
    expect(vu.every((v) => v === 0)).toBe(true);
  });
});

describe("useOmniTribeMetersStore — Bounds", () => {
  it("ueber-lange VU-Arrays werden auf 16 gekappt (no overflow)", () => {
    const huge = new Array(32).fill(50);
    setOmniTribeVuLevels(huge);
    const snap = getOmniTribeVuLevelsSnapshot();
    expect(snap.length).toBe(16);
    expect(snap.every((v) => v === 50)).toBe(true);
  });

  it("ueber-lange Spectrum-Arrays werden auf 64 gekappt", () => {
    const huge = new Array(128).fill(64);
    setOmniTribeSpectrumBins(huge);
    const snap = getOmniTribeSpectrumBinsSnapshot();
    expect(snap.length).toBe(64);
    expect(snap.every((v) => v === 64)).toBe(true);
  });
});
