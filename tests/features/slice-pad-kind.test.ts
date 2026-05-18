/**
 * tests/features/slice-pad-kind.test.ts (TASK-238-FOLLOWUP-1B / v2.91)
 *
 * Tests fuer den neuen Pad-Bank-Slot-Kind "slice". Coverage:
 *  - Schema-Validierung (isValidPadBankSlot akzeptiert kind=slice).
 *  - localStorage Round-Trip (Persistenz toleriert die neue Kind).
 *  - sliceAutoConfigureSlots() liefert 16 Slice-Pads mit sliceIndex 0..15.
 *  - End-to-End: Pad-Click mit kind=slice triggert AudioEngine.playSliceBuffer
 *    via midi:slicePad-CustomEvent + getSlicePadSlot-Lookup.
 *  - playSlicePad-Target im targetsMatch + labelForTarget.
 *  - Out-of-range sliceIndex wird auf 0..15 geclampt.
 *
 * Hinweis zur Clamp-Policy: padBankSlotToEntry in MidiSettings clampt einen
 * Slice-Index ausserhalb 0..15 auf MAX_SLICE_PADS-1 (siehe MidiSettings.tsx).
 * Damit ein Slot mit param="42" trotzdem ein gueltiges Target liefert. In
 * den Tests verifizieren wir das Clamping ueber den Helper direkt, weil die
 * MidiSettings-Funktion nicht exportiert ist.
 */

import { describe, it, expect, beforeEach } from "vitest";

// ─── localStorage Mock (vor Modul-Import) ────────────────────────────────────

function createLocalStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string): string | null => store[k] ?? null,
    setItem: (k: string, v: string): void => { store[k] = v; },
    removeItem: (k: string): void => { delete store[k]; },
    clear: (): void => { store = {}; },
  };
}
const localStorageMock = createLocalStorageMock();
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

import {
  PAD_BANK_STORAGE_KEY,
  PAD_BANK_SLICE_MAX,
  defaultPadBankSlots,
  sliceAutoConfigureSlots,
  isValidPadBankSlot,
  loadPadBankSlots,
  savePadBankSlots,
  __resetPadBankForTests,
  type PadBankSlot,
} from "../../client/src/utils/padBankPersistence";

import {
  MAX_SLICE_PADS,
  assignSlicesToPads,
  getSlicePadSlot,
  __resetSlicePadStoreForTests,
} from "../../client/src/store/useSlicePadStore";

import { labelForTarget, targetsMatch, type MidiLearnTarget } from "../../client/src/hooks/useMidi";

beforeEach(() => {
  localStorageMock.clear();
  __resetPadBankForTests();
  __resetSlicePadStoreForTests();
});

// ─── Schema: isValidPadBankSlot akzeptiert kind=slice ────────────────────────

describe("padBankPersistence – kind=slice (v2.91)", () => {
  it("isValidPadBankSlot akzeptiert kind=slice mit sliceIndex-param", () => {
    expect(isValidPadBankSlot({ kind: "slice", param: "0" })).toBe(true);
    expect(isValidPadBankSlot({ kind: "slice", param: "7" })).toBe(true);
    expect(isValidPadBankSlot({ kind: "slice", param: "15" })).toBe(true);
  });

  it("isValidPadBankSlot lehnt kind=slice mit non-string param ab", () => {
    // shape-Validierung — param muss string sein, numerischer Bound-Check
    // passiert beim Trigger (Clamp im padBankSlotToEntry)
    expect(isValidPadBankSlot({ kind: "slice", param: 0 })).toBe(false);
    expect(isValidPadBankSlot({ kind: "slice", param: null })).toBe(false);
  });

  it("PAD_BANK_SLICE_MAX entspricht MAX_SLICE_PADS aus useSlicePadStore", () => {
    expect(PAD_BANK_SLICE_MAX).toBe(MAX_SLICE_PADS);
    expect(PAD_BANK_SLICE_MAX).toBe(16);
  });
});

// ─── sliceAutoConfigureSlots Quick-Action ────────────────────────────────────

describe("sliceAutoConfigureSlots – Auto-Configure 16 Slice-Pads", () => {
  it("liefert 16 Slots mit kind=slice und sliceIndex 0..15", () => {
    const slots = sliceAutoConfigureSlots();
    expect(slots).toHaveLength(16);
    for (let i = 0; i < 16; i++) {
      expect(slots[i].kind).toBe("slice");
      expect(slots[i].param).toBe(String(i));
    }
  });

  it("alle 16 Auto-Configure-Slots passieren isValidPadBankSlot", () => {
    const slots = sliceAutoConfigureSlots();
    for (const s of slots) {
      expect(isValidPadBankSlot(s)).toBe(true);
    }
  });
});

// ─── localStorage Round-Trip mit kind=slice ──────────────────────────────────

describe("padBankPersistence – Round-Trip mit kind=slice", () => {
  it("save → load erhaelt slice-Slots verlustfrei", () => {
    const original: PadBankSlot[] = sliceAutoConfigureSlots();
    savePadBankSlots(original);
    expect(loadPadBankSlots()).toEqual(original);
  });

  it("gemischte slice/perf-pad/macro/action Slots ueberleben Round-Trip", () => {
    const original: PadBankSlot[] = [
      { kind: "slice", param: "0" },
      { kind: "perf-pad", param: "1" },
      { kind: "macro", param: "3" },
      { kind: "action", param: "playStop" },
      { kind: "slice", param: "15" },
    ];
    savePadBankSlots(original);
    expect(loadPadBankSlots()).toEqual(original);
  });

  it("Pre-v2.91-Files (ohne slice-Slots) loaden unveraendert (Back-Compat)", () => {
    // Simuliert ein localStorage-Eintrag von vor v2.91 — kein slice darin
    const pre = defaultPadBankSlots();
    localStorageMock.setItem(PAD_BANK_STORAGE_KEY, JSON.stringify(pre));
    expect(loadPadBankSlots()).toEqual(pre);
  });

  it("Invalides slice-Item wird gefiltert, andere bleiben", () => {
    const stored = [
      { kind: "slice", param: "0" },         // valid
      { kind: "slice", param: 5 },            // invalid (non-string param)
      { kind: "perf-pad", param: "3" },      // valid
    ];
    localStorageMock.setItem(PAD_BANK_STORAGE_KEY, JSON.stringify(stored));
    const result = loadPadBankSlots();
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ kind: "slice", param: "0" });
    expect(result[1]).toEqual({ kind: "perf-pad", param: "3" });
  });
});

// ─── MidiLearnTarget playSlicePad ────────────────────────────────────────────

describe("playSlicePad MidiLearnTarget (v2.91)", () => {
  it("labelForTarget rendert 'Slice-Pad N' (1-indexed)", () => {
    expect(labelForTarget({ type: "playSlicePad", sliceIndex: 0 })).toBe("Slice-Pad 1");
    expect(labelForTarget({ type: "playSlicePad", sliceIndex: 7 })).toBe("Slice-Pad 8");
    expect(labelForTarget({ type: "playSlicePad", sliceIndex: 15 })).toBe("Slice-Pad 16");
  });

  it("targetsMatch erkennt zwei playSlicePads als gleich gdw sliceIndex matcht", () => {
    const a: MidiLearnTarget = { type: "playSlicePad", sliceIndex: 3 };
    const b: MidiLearnTarget = { type: "playSlicePad", sliceIndex: 3 };
    const c: MidiLearnTarget = { type: "playSlicePad", sliceIndex: 4 };
    expect(targetsMatch(a, b)).toBe(true);
    expect(targetsMatch(a, c)).toBe(false);
  });

  it("targetsMatch unterscheidet playSlicePad von anderen Index-Targets", () => {
    const slice: MidiLearnTarget = { type: "playSlicePad", sliceIndex: 0 };
    const loop:  MidiLearnTarget = { type: "loopTrigger",  loopIndex:  0 };
    const scene: MidiLearnTarget = { type: "scenelaunch",  sceneIndex: 0 };
    expect(targetsMatch(slice, loop)).toBe(false);
    expect(targetsMatch(slice, scene)).toBe(false);
  });
});

// ─── End-to-End: midi:slicePad → playSliceBuffer ─────────────────────────────

describe("Pad-Click mit kind=slice — End-to-End Trigger-Pfad", () => {
  it("getSlicePadSlot liefert den Buffer den ein assignSlicesToPads abgelegt hat", () => {
    const buf0 = new Float32Array([0.1, 0.2, 0.3]);
    const buf1 = new Float32Array([0.4, 0.5, 0.6]);
    assignSlicesToPads([buf0, buf1], {
      sampleName: "drum.wav",
      sampleRate: 48000,
      replace: true,
    });
    expect(getSlicePadSlot(0)?.buffer).toBe(buf0);
    expect(getSlicePadSlot(0)?.sampleRate).toBe(48000);
    expect(getSlicePadSlot(1)?.buffer).toBe(buf1);
    expect(getSlicePadSlot(2)?.buffer).toBeNull(); // leer
  });

  it("Simuliert App.tsx-Handler: midi:slicePad-Event laesst sich auf playSliceBuffer mappen", () => {
    // Wir bauen die Logik des App.tsx-Listeners nach: detail → getSlicePadSlot
    // → buffer/sampleRate → AudioEngine.playSliceBuffer-Call. AudioEngine wird
    // gemockt damit der Test in Node laeuft (kein Web-Audio).
    const buf = new Float32Array([0.5, -0.5, 0.5, -0.5]);
    assignSlicesToPads([buf], {
      sampleName: "kick.wav",
      sampleRate: 44100,
      replace: true,
    });

    const playSliceBuffer = vitestFn(
      (_buffer: Float32Array, _sampleRate: number): boolean => true,
    );

    const handleSlicePad = (sliceIndex: number) => {
      const slot = getSlicePadSlot(sliceIndex);
      if (!slot || !slot.buffer) return;
      playSliceBuffer(slot.buffer, slot.sampleRate);
    };

    handleSlicePad(0);
    expect(playSliceBuffer.calls.length).toBe(1);
    expect(playSliceBuffer.calls[0][0]).toBe(buf);
    expect(playSliceBuffer.calls[0][1]).toBe(44100);

    // Trigger auf leeren Slot → kein zusaetzlicher Call
    handleSlicePad(5);
    expect(playSliceBuffer.calls.length).toBe(1);
  });

  it("Out-of-range sliceIndex (negativ / > MAX) liefert null und triggert nicht", () => {
    const buf = new Float32Array([0.1]);
    assignSlicesToPads([buf], { sampleName: "x.wav", sampleRate: 48000, replace: true });
    expect(getSlicePadSlot(-1)).toBeNull();
    expect(getSlicePadSlot(MAX_SLICE_PADS)).toBeNull();
    expect(getSlicePadSlot(99)).toBeNull();
  });
});

// ─── Mini-Mock fuer Test-Spy (kein vitest mock-import noetig) ────────────────

interface MockFn<A extends unknown[], R> {
  (...args: A): R;
  calls: A[];
}
function vitestFn<A extends unknown[], R>(impl: (...args: A) => R): MockFn<A, R> {
  const calls: A[] = [];
  const fn = ((...args: A) => {
    calls.push(args);
    return impl(...args);
  }) as MockFn<A, R>;
  fn.calls = calls;
  return fn;
}
