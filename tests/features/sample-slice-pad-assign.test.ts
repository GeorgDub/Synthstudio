/**
 * tests/features/sample-slice-pad-assign.test.ts
 *
 * TASK-238-FOLLOWUP-1 (v2.90) — Tests fuer den useSlicePadStore (Bridge
 * zwischen sample-slicer:apply-Event und 16 Pad-Slots).
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  MAX_SLICE_PADS,
  assignSlicesToPads,
  getAllSlicePadSlots,
  getSlicePadSlot,
  setSlicePadSlot,
  clearSlicePadSlot,
  clearAllSlicePads,
  __resetSlicePadStoreForTests,
} from "../../client/src/store/useSlicePadStore";

beforeEach(() => {
  __resetSlicePadStoreForTests();
});

// ─── Default-State ──────────────────────────────────────────────────────────

describe("useSlicePadStore default state", () => {
  it("hat MAX_SLICE_PADS leere Slots beim Start", () => {
    const slots = getAllSlicePadSlots();
    expect(slots).toHaveLength(MAX_SLICE_PADS);
    expect(slots.every(s => s.buffer === null)).toBe(true);
  });

  it("MAX_SLICE_PADS ist 16 (entspricht Performance-Pad-Anzahl)", () => {
    expect(MAX_SLICE_PADS).toBe(16);
  });

  it("getSlicePadSlot liefert null bei ungueltigem Index", () => {
    expect(getSlicePadSlot(-1)).toBeNull();
    expect(getSlicePadSlot(MAX_SLICE_PADS)).toBeNull();
    expect(getSlicePadSlot(99)).toBeNull();
    expect(getSlicePadSlot(1.5)).toBeNull();
  });
});

// ─── setSlicePadSlot / clearSlicePadSlot ────────────────────────────────────

describe("setSlicePadSlot / clearSlicePadSlot", () => {
  it("setzt einen Buffer in Slot 0", () => {
    const buf = new Float32Array([0.1, 0.2, 0.3]);
    const ok = setSlicePadSlot(0, buf, {
      sampleRate: 48000,
      sampleName: "test.wav",
      sliceIndex: 0,
    });
    expect(ok).toBe(true);
    const slot = getSlicePadSlot(0);
    expect(slot?.buffer).toBe(buf);
    expect(slot?.sampleRate).toBe(48000);
    expect(slot?.sampleName).toBe("test.wav");
  });

  it("setSlicePadSlot lehnt out-of-range Index ab", () => {
    const buf = new Float32Array([0.5]);
    expect(setSlicePadSlot(-1, buf, { sampleRate: 44100, sampleName: "x", sliceIndex: 0 })).toBe(false);
    expect(setSlicePadSlot(MAX_SLICE_PADS, buf, { sampleRate: 44100, sampleName: "x", sliceIndex: 0 })).toBe(false);
  });

  it("clearSlicePadSlot leert nur den angegebenen Slot", () => {
    setSlicePadSlot(0, new Float32Array([0.1]), { sampleRate: 44100, sampleName: "a", sliceIndex: 0 });
    setSlicePadSlot(1, new Float32Array([0.2]), { sampleRate: 44100, sampleName: "b", sliceIndex: 1 });
    clearSlicePadSlot(0);
    expect(getSlicePadSlot(0)?.buffer).toBeNull();
    expect(getSlicePadSlot(1)?.buffer).not.toBeNull();
  });

  it("clearAllSlicePads leert alle Slots", () => {
    for (let i = 0; i < 5; i++) {
      setSlicePadSlot(i, new Float32Array([i]), { sampleRate: 44100, sampleName: "x", sliceIndex: i });
    }
    clearAllSlicePads();
    expect(getAllSlicePadSlots().every(s => s.buffer === null)).toBe(true);
  });

  it("clampt unguelte sampleRate auf 44100", () => {
    setSlicePadSlot(0, new Float32Array([0.1]), { sampleRate: -1, sampleName: "x", sliceIndex: 0 });
    expect(getSlicePadSlot(0)?.sampleRate).toBe(44100);

    setSlicePadSlot(1, new Float32Array([0.1]), { sampleRate: NaN, sampleName: "x", sliceIndex: 0 });
    expect(getSlicePadSlot(1)?.sampleRate).toBe(44100);
  });
});

// ─── assignSlicesToPads (Bulk) ──────────────────────────────────────────────

describe("assignSlicesToPads", () => {
  it("legt N Slices auf N Pads ab", () => {
    const slices = Array.from({ length: 5 }, (_, i) => new Float32Array([i + 1]));
    const assigned = assignSlicesToPads(slices, {
      sampleRate: 48000,
      sampleName: "drum-loop.wav",
    });
    expect(assigned).toBe(5);
    for (let i = 0; i < 5; i++) {
      const slot = getSlicePadSlot(i);
      expect(slot?.buffer).toBe(slices[i]);
      expect(slot?.sampleRate).toBe(48000);
      expect(slot?.sampleName).toBe("drum-loop.wav");
      expect(slot?.sliceIndex).toBe(i);
    }
    // Restliche Slots bleiben leer
    expect(getSlicePadSlot(5)?.buffer).toBeNull();
  });

  it("mehr als 16 Slices werden auf 16 abgeschnitten", () => {
    const slices = Array.from({ length: 25 }, (_, i) => new Float32Array([i]));
    const assigned = assignSlicesToPads(slices, {
      sampleRate: 44100,
      sampleName: "big.wav",
    });
    expect(assigned).toBe(MAX_SLICE_PADS);
    // Slot 15 ist letzte, alle 16 belegt.
    expect(getSlicePadSlot(15)?.buffer).not.toBeNull();
    expect(getAllSlicePadSlots().filter(s => s.buffer !== null)).toHaveLength(MAX_SLICE_PADS);
  });

  it("replace:true (default) leert vorherige Slots ausserhalb des neuen Range", () => {
    // Erst: 5 Slices.
    assignSlicesToPads(
      Array.from({ length: 5 }, (_, i) => new Float32Array([i])),
      { sampleRate: 44100, sampleName: "a.wav" },
    );
    expect(getSlicePadSlot(3)?.buffer).not.toBeNull();
    // Dann: 2 Slices replace=true → Slot 2..4 wieder leer.
    assignSlicesToPads(
      [new Float32Array([0.1]), new Float32Array([0.2])],
      { sampleRate: 44100, sampleName: "b.wav", replace: true },
    );
    expect(getSlicePadSlot(0)?.sampleName).toBe("b.wav");
    expect(getSlicePadSlot(2)?.buffer).toBeNull();
    expect(getSlicePadSlot(3)?.buffer).toBeNull();
  });

  it("replace:false ueberschreibt nur die uebergebenen Indices", () => {
    assignSlicesToPads(
      Array.from({ length: 5 }, (_, i) => new Float32Array([i])),
      { sampleRate: 44100, sampleName: "a.wav" },
    );
    assignSlicesToPads(
      [new Float32Array([99])],
      { sampleRate: 44100, sampleName: "b.wav", replace: false },
    );
    // Slot 0 → b.wav, Slot 1..4 bleibt a.wav.
    expect(getSlicePadSlot(0)?.sampleName).toBe("b.wav");
    expect(getSlicePadSlot(1)?.sampleName).toBe("a.wav");
  });

  it("leeres Slices-Array ohne replace → 0 assigned, kein State-Change", () => {
    assignSlicesToPads(
      [new Float32Array([1])],
      { sampleRate: 44100, sampleName: "pre.wav" },
    );
    const before = getSlicePadSlot(0)?.sampleName;
    const assigned = assignSlicesToPads([], { sampleRate: 44100, sampleName: "ignored.wav", replace: false });
    expect(assigned).toBe(0);
    expect(getSlicePadSlot(0)?.sampleName).toBe(before);
  });
});

// ─── End-to-End: sample-slicer:apply Event-Simulation ───────────────────────

describe("sample-slicer:apply event handler logic (mock)", () => {
  it("simuliert die App.tsx-Bridge: Event-Payload → assignSlicesToPads", () => {
    // Payload wie in DrumMachine.tsx Zeile 599-605 dispatched.
    const eventDetail = {
      sampleName: "808-loop.wav",
      sampleRate: 48000,
      slices: [
        new Float32Array([0.1, 0.2]),
        new Float32Array([0.3, 0.4]),
        new Float32Array([0.5, 0.6]),
      ],
    };

    // Bridge-Logik (analog App.tsx handleSlicerApply).
    const slices: Float32Array[] = [];
    for (const item of eventDetail.slices) {
      if (item instanceof Float32Array) slices.push(item);
    }
    const assigned = assignSlicesToPads(slices, {
      sampleName: eventDetail.sampleName,
      sampleRate: eventDetail.sampleRate,
      replace: true,
    });

    expect(assigned).toBe(3);
    expect(getSlicePadSlot(0)?.sampleName).toBe("808-loop.wav");
    expect(getSlicePadSlot(0)?.sampleRate).toBe(48000);
    expect(getSlicePadSlot(2)?.buffer?.[1]).toBeCloseTo(0.6, 5);
  });

  it("ignoriert non-Float32Array-Items im Payload (Robustheit)", () => {
    const garbage = [
      new Float32Array([1]),
      "not-a-buffer" as unknown as Float32Array,
      null as unknown as Float32Array,
      new Float32Array([2]),
    ];
    const slices: Float32Array[] = [];
    for (const item of garbage) {
      if (item instanceof Float32Array) slices.push(item);
    }
    const assigned = assignSlicesToPads(slices, { sampleName: "x", sampleRate: 44100 });
    expect(assigned).toBe(2);
  });
});
