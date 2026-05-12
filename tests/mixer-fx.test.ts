import { describe, expect, it } from "vitest";
import {
  computeSidechainGain,
  createDefaultEqBands,
  makeMixerFxSlot,
  moveFxSlot,
  normalizeSidechain,
  normalizeTransientShaper,
  sanitizeEqBands,
  summarizeEqBands,
  toggleFxSlot,
} from "../client/src/utils/mixerFx";

describe("mixerFx utilities", () => {
  it("creates exactly 16 default EQ bands with neutral gain", () => {
    const bands = createDefaultEqBands();
    expect(bands).toHaveLength(16);
    expect(bands.every((band) => band.gain === 0)).toBe(true);
    expect(bands[0].frequency).toBe(25);
    expect(bands[15].frequency).toBe(16000);
  });

  it("sanitizes EQ bands and clamps gain and Q", () => {
    const bands = sanitizeEqBands([{ frequency: 5, gain: 99, q: 99 }]);
    expect(bands).toHaveLength(16);
    expect(bands[0]).toEqual({ frequency: 20, gain: 24, q: 12 });
  });

  it("summarizes EQ bands into low, mid and high averages", () => {
    const bands = createDefaultEqBands();
    bands[0].gain = 5;
    bands[5].gain = -6;
    bands[11].gain = 12;
    const summary = summarizeEqBands(bands);

    expect(summary.low).toBeCloseTo(1);
    expect(summary.mid).toBeCloseTo(-1);
    expect(summary.high).toBeCloseTo(2.4);
  });

  it("moves insert FX slots without mutating the original chain", () => {
    const chain = [
      makeMixerFxSlot("eq16", "a"),
      makeMixerFxSlot("compressor", "b"),
      makeMixerFxSlot("reverb", "c"),
    ];
    const moved = moveFxSlot(chain, 0, 2);

    expect(moved.map((slot) => slot.id)).toEqual(["b", "c", "a"]);
    expect(chain.map((slot) => slot.id)).toEqual(["a", "b", "c"]);
  });

  it("toggles an insert FX slot by id", () => {
    const chain = [makeMixerFxSlot("delay", "slot-1")];
    const toggled = toggleFxSlot(chain, "slot-1");

    expect(chain[0].enabled).toBe(true);
    expect(toggled[0].enabled).toBe(false);
  });

  it("normalizes sidechain settings", () => {
    const settings = normalizeSidechain({
      enabled: true,
      sourcePartId: "kick",
      amount: 9,
      attack: -1,
      release: 99,
    });

    expect(settings).toEqual({
      enabled: true,
      sourcePartId: "kick",
      amount: 1,
      attack: 0.001,
      release: 2,
    });
  });

  it("computes sidechain gain only when enabled and sourced", () => {
    expect(computeSidechainGain(1, normalizeSidechain({ enabled: false, sourcePartId: "kick", amount: 1 }))).toBe(1);
    expect(computeSidechainGain(1, normalizeSidechain({ enabled: true, sourcePartId: null, amount: 1 }))).toBe(1);
    expect(computeSidechainGain(0.5, normalizeSidechain({ enabled: true, sourcePartId: "kick", amount: 0.8 }))).toBeCloseTo(0.6);
  });

  it("normalizes transient shaper settings", () => {
    const settings = normalizeTransientShaper({ enabled: true, attack: 2, sustain: -2, mix: 3 });

    expect(settings).toEqual({
      enabled: true,
      attack: 1,
      sustain: -1,
      mix: 1,
    });
  });
});
