/**
 * tests/features/korg-slice-bridge.test.ts (v3.8.0)
 *
 * Tests für client/src/utils/korg/sliceBridge.ts:
 *   - ESLI-Slice ↔ Onset Konversion (round-trip)
 *   - slicesToOnsets filter empty entries
 *   - onsetsToSlices respektiert ESLI_SLICES_COUNT cap (64)
 *   - Defensive Edge Cases (out-of-bound onsets, length-Berechnung,
 *     attackLength/amplitude defaults)
 */

import { describe, it, expect } from "vitest";
import {
  esliSliceToOnset,
  onsetToEsliSlice,
  slicesToOnsets,
  onsetsToSlices,
  MAX_ESLI_SLICES,
} from "@/utils/korg/sliceBridge";
import type { E2sSlice } from "@/utils/korg/e2sBankReader";
import type { OnsetCandidate } from "@/utils/sampleSlicing";

describe("sliceBridge — single slice/onset conversion", () => {
  it("esliSliceToOnset maps start → frame", () => {
    const slice: E2sSlice = { start: 1234, length: 500, attackLength: 0, amplitude: 0 };
    const onset = esliSliceToOnset(slice);
    expect(onset.frame).toBe(1234);
    expect(onset.strength).toBe(1);
  });

  it("esliSliceToOnset clamps negative start to 0", () => {
    const slice: E2sSlice = { start: -50, length: 100, attackLength: 0, amplitude: 0 };
    const onset = esliSliceToOnset(slice);
    expect(onset.frame).toBe(0);
  });

  it("onsetToEsliSlice computes length = nextFrame - start", () => {
    const onset: OnsetCandidate = { frame: 100, strength: 0.5 };
    const slice = onsetToEsliSlice(onset, 250);
    expect(slice.start).toBe(100);
    expect(slice.length).toBe(150);
    expect(slice.attackLength).toBe(0);
    expect(slice.amplitude).toBe(0);
  });

  it("onsetToEsliSlice clamps negative length to 0", () => {
    const onset: OnsetCandidate = { frame: 200, strength: 1 };
    // Defensive: wenn nextFrame < start, length = 0 statt negativ
    const slice = onsetToEsliSlice(onset, 50);
    expect(slice.length).toBe(0);
  });

  it("onsetToEsliSlice floors fractional frames", () => {
    const onset: OnsetCandidate = { frame: 100.7, strength: 1 };
    const slice = onsetToEsliSlice(onset, 250.4);
    expect(slice.start).toBe(100);
    expect(slice.length).toBe(150);
  });
});

describe("sliceBridge — slicesToOnsets (filter empty + sort)", () => {
  it("returns empty for empty array", () => {
    expect(slicesToOnsets([])).toEqual([]);
  });

  it("filters all-zero (empty) slices", () => {
    const slices: E2sSlice[] = [
      { start: 0, length: 0, attackLength: 0, amplitude: 0 },
      { start: 0, length: 0, attackLength: 0, amplitude: 0 },
    ];
    expect(slicesToOnsets(slices)).toEqual([]);
  });

  it("keeps slice with start=0 but length>0 (it's a valid first slice)", () => {
    const slices: E2sSlice[] = [
      { start: 0, length: 1000, attackLength: 0, amplitude: 0 },
      { start: 1000, length: 500, attackLength: 0, amplitude: 0 },
    ];
    const onsets = slicesToOnsets(slices);
    expect(onsets).toHaveLength(2);
    expect(onsets[0].frame).toBe(0);
    expect(onsets[1].frame).toBe(1000);
  });

  it("sorts onsets by frame (defensive against unsorted ESLI input)", () => {
    const slices: E2sSlice[] = [
      { start: 500, length: 100, attackLength: 0, amplitude: 0 },
      { start: 100, length: 100, attackLength: 0, amplitude: 0 },
      { start: 300, length: 100, attackLength: 0, amplitude: 0 },
    ];
    const onsets = slicesToOnsets(slices);
    expect(onsets.map((o) => o.frame)).toEqual([100, 300, 500]);
  });
});

describe("sliceBridge — onsetsToSlices (cap + length calc)", () => {
  it("returns empty for empty input", () => {
    expect(onsetsToSlices([], 1000)).toEqual([]);
  });

  it("returns empty when totalFrames <= 0", () => {
    expect(onsetsToSlices([{ frame: 0, strength: 1 }], 0)).toEqual([]);
  });

  it("computes length to next onset or totalFrames", () => {
    const onsets: OnsetCandidate[] = [
      { frame: 0, strength: 1 },
      { frame: 1000, strength: 1 },
      { frame: 2500, strength: 1 },
    ];
    const slices = onsetsToSlices(onsets, 5000);
    expect(slices).toHaveLength(3);
    expect(slices[0]).toEqual({ start: 0, length: 1000, attackLength: 0, amplitude: 0 });
    expect(slices[1]).toEqual({ start: 1000, length: 1500, attackLength: 0, amplitude: 0 });
    expect(slices[2]).toEqual({ start: 2500, length: 2500, attackLength: 0, amplitude: 0 });
  });

  it("respects MAX_ESLI_SLICES cap (64)", () => {
    expect(MAX_ESLI_SLICES).toBe(64);
    const onsets: OnsetCandidate[] = Array.from({ length: 100 }, (_, i) => ({
      frame: i * 100,
      strength: 1,
    }));
    const slices = onsetsToSlices(onsets, 100_000);
    expect(slices).toHaveLength(MAX_ESLI_SLICES);
    expect(slices[0].start).toBe(0);
    expect(slices[63].start).toBe(63 * 100);
  });

  it("filters out-of-bound onsets (frame >= totalFrames)", () => {
    const onsets: OnsetCandidate[] = [
      { frame: 0, strength: 1 },
      { frame: 500, strength: 1 },
      { frame: 2000, strength: 1 }, // out-of-bound for totalFrames=1000
    ];
    const slices = onsetsToSlices(onsets, 1000);
    expect(slices).toHaveLength(2);
    expect(slices[1].start).toBe(500);
    expect(slices[1].length).toBe(500); // ends at totalFrames=1000
  });

  it("filters negative onsets", () => {
    const onsets: OnsetCandidate[] = [
      { frame: -10, strength: 1 },
      { frame: 100, strength: 1 },
    ];
    const slices = onsetsToSlices(onsets, 500);
    expect(slices).toHaveLength(1);
    expect(slices[0].start).toBe(100);
  });
});

describe("sliceBridge — round-trip property", () => {
  it("onsetsToSlices → slicesToOnsets ≈ original onset frames", () => {
    const onsets: OnsetCandidate[] = [
      { frame: 0, strength: 1 },
      { frame: 1234, strength: 0.8 },
      { frame: 5678, strength: 0.5 },
      { frame: 9000, strength: 0.3 },
    ];
    const total = 10_000;
    const slices = onsetsToSlices(onsets, total);
    const back = slicesToOnsets(slices);
    // strength wird nicht erhalten (ESLI hat kein strength-Feld), aber frame muss matchen.
    expect(back.map((o) => o.frame)).toEqual(onsets.map((o) => o.frame));
  });

  it("slicesToOnsets → onsetsToSlices preserves start + length (bit-equal)", () => {
    const slices: E2sSlice[] = [
      { start: 0, length: 1000, attackLength: 0, amplitude: 0 },
      { start: 1000, length: 2500, attackLength: 0, amplitude: 0 },
      { start: 3500, length: 1500, attackLength: 0, amplitude: 0 },
    ];
    const total = 5000;
    const onsets = slicesToOnsets(slices);
    const back = onsetsToSlices(onsets, total);
    expect(back).toEqual(slices);
  });
});
