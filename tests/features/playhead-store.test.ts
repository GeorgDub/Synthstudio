/**
 * Synthstudio – playhead-store.test.ts (TASK-247)
 *
 * Testet den leichten Playhead-Step-Observer-Store, der den Playback-Step
 * aus dem geteilten dm-Render-Pfad löst (Full-Rerender-Fix der DrumMachine).
 *
 * Außerdem getestet: der pure React.memo-Comparator `drumMachinePropsAreEqual`,
 * der entscheidet, wann die 4495-Zeilen-DrumMachine-Komponente einen
 * Parent-Rerender überspringen darf (nur currentStep unterscheidet sich).
 * Dieser Comparator ist der eigentliche Perf-Hebel — er ist in Node direkt
 * testbar, während der Rerender-Effekt selbst es nicht ist.
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  getPlayheadStep,
  setPlayheadStep,
  subscribePlayhead,
  __resetPlayheadForTests,
} from "@/store/usePlayheadStore";
import { drumMachinePropsAreEqual } from "@/components/DrumMachine/drumMachineMemo";
import { useDrumMachineStore } from "@/store/useDrumMachineStore";

describe("usePlayheadStore – Observer", () => {
  beforeEach(() => {
    __resetPlayheadForTests();
  });

  // ── getSnapshot / Happy Path ───────────────────────────────────────────────
  it("getPlayheadStep liefert initial 0", () => {
    expect(getPlayheadStep()).toBe(0);
  });

  it("setPlayheadStep aktualisiert den Snapshot", () => {
    setPlayheadStep(5);
    expect(getPlayheadStep()).toBe(5);
    setPlayheadStep(0);
    expect(getPlayheadStep()).toBe(0);
  });

  // ── subscribe / notify ─────────────────────────────────────────────────────
  it("subscribePlayhead benachrichtigt Listener bei Änderung", () => {
    let calls = 0;
    const unsub = subscribePlayhead(() => {
      calls++;
    });
    setPlayheadStep(3);
    setPlayheadStep(7);
    expect(calls).toBe(2);
    unsub();
  });

  it("unsubscribe stoppt weitere Benachrichtigungen", () => {
    let calls = 0;
    const unsub = subscribePlayhead(() => {
      calls++;
    });
    setPlayheadStep(1);
    unsub();
    setPlayheadStep(2);
    setPlayheadStep(3);
    expect(calls).toBe(1);
  });

  // ── Edge: identischer Wert notifyt NICHT (verhindert redundante Rerenders) ──
  it("setPlayheadStep mit identischem Wert notifyt nicht", () => {
    setPlayheadStep(4);
    let calls = 0;
    const unsub = subscribePlayhead(() => {
      calls++;
    });
    setPlayheadStep(4);
    expect(calls).toBe(0);
    setPlayheadStep(5);
    expect(calls).toBe(1);
    unsub();
  });

  it("mehrere Listener werden alle benachrichtigt", () => {
    let a = 0;
    let b = 0;
    const ua = subscribePlayhead(() => a++);
    const ub = subscribePlayhead(() => b++);
    setPlayheadStep(9);
    expect(a).toBe(1);
    expect(b).toBe(1);
    ua();
    ub();
  });
});

// ─── Comparator (der eigentliche Perf-Hebel) ──────────────────────────────────

interface FakeDm {
  currentStep: number;
  patterns: unknown[];
  activePartId: string | null;
  velocityMode: boolean;
  [k: string]: unknown;
}

function makeProps(overrides: Partial<Record<string, unknown>> = {}) {
  const sharedPatterns: unknown[] = [{ id: "p1" }];
  const sharedSamples: unknown[] = [];
  const onPlayStop = () => {};
  const onBpmChange = (_b: number) => {};
  const dm: FakeDm = {
    currentStep: 0,
    patterns: sharedPatterns,
    activePartId: "a",
    velocityMode: false,
    setCurrentStep: () => {},
  };
  return {
    dm: dm as unknown,
    samples: sharedSamples as unknown,
    isPlaying: true,
    bpm: 120,
    onPlayStop,
    onBpmChange,
    className: "h-full",
    externalSyncEnabled: false,
    externalSyncStatus: "off",
    ...overrides,
  } as Parameters<typeof drumMachinePropsAreEqual>[0];
}

describe("drumMachinePropsAreEqual – memo comparator", () => {
  // ── Kern-Verhalten: nur currentStep unterscheidet sich → skip (true) ───────
  it("returns true (skip) wenn sich NUR dm.currentStep unterscheidet", () => {
    const prev = makeProps();
    const nextDm = { ...(prev.dm as FakeDm), currentStep: 7 };
    const next = makeProps({ dm: nextDm });
    // Alle übrigen dm-Felder + Top-Level-Props referenziell identisch halten:
    (next as { samples: unknown }).samples = prev.samples;
    (next as { onPlayStop: unknown }).onPlayStop = prev.onPlayStop;
    (next as { onBpmChange: unknown }).onBpmChange = prev.onBpmChange;
    (nextDm as FakeDm).patterns = (prev.dm as FakeDm).patterns;
    expect(drumMachinePropsAreEqual(prev, next)).toBe(true);
  });

  // ── Edge: dm.patterns Referenz unterscheidet sich → re-render (false) ───────
  it("returns false wenn dm.patterns Referenz wechselt", () => {
    const prev = makeProps();
    const nextDm = { ...(prev.dm as FakeDm), patterns: [{ id: "p2" }] };
    const next = makeProps({ dm: nextDm });
    (next as { samples: unknown }).samples = prev.samples;
    (next as { onPlayStop: unknown }).onPlayStop = prev.onPlayStop;
    (next as { onBpmChange: unknown }).onBpmChange = prev.onBpmChange;
    expect(drumMachinePropsAreEqual(prev, next)).toBe(false);
  });

  // ── Top-Level-Prop unterscheidet sich → re-render (false) ──────────────────
  it("returns false wenn isPlaying sich unterscheidet", () => {
    const prev = makeProps();
    const next = makeProps({ isPlaying: false });
    (next as { samples: unknown }).samples = prev.samples;
    (next as { onPlayStop: unknown }).onPlayStop = prev.onPlayStop;
    (next as { onBpmChange: unknown }).onBpmChange = prev.onBpmChange;
    (next.dm as FakeDm).patterns = (prev.dm as FakeDm).patterns;
    expect(drumMachinePropsAreEqual(prev, next)).toBe(false);
  });

  it("returns false wenn ein dm-Feld (activePartId) sich unterscheidet", () => {
    const prev = makeProps();
    const nextDm = { ...(prev.dm as FakeDm), activePartId: "b" };
    const next = makeProps({ dm: nextDm });
    (next as { samples: unknown }).samples = prev.samples;
    (next as { onPlayStop: unknown }).onPlayStop = prev.onPlayStop;
    (next as { onBpmChange: unknown }).onBpmChange = prev.onBpmChange;
    (nextDm as FakeDm).patterns = (prev.dm as FakeDm).patterns;
    expect(drumMachinePropsAreEqual(prev, next)).toBe(false);
  });

  it("returns false wenn ein Callback-Prop (onBpmChange) sich unterscheidet", () => {
    const prev = makeProps();
    const next = makeProps({ onBpmChange: (_b: number) => {} });
    (next as { samples: unknown }).samples = prev.samples;
    (next as { onPlayStop: unknown }).onPlayStop = prev.onPlayStop;
    (next.dm as FakeDm).patterns = (prev.dm as FakeDm).patterns;
    expect(drumMachinePropsAreEqual(prev, next)).toBe(false);
  });

  it("returns true wenn ALLE Props (inkl. currentStep) identisch sind", () => {
    const prev = makeProps();
    const next = makeProps();
    (next as { dm: unknown }).dm = prev.dm;
    (next as { samples: unknown }).samples = prev.samples;
    (next as { onPlayStop: unknown }).onPlayStop = prev.onPlayStop;
    (next as { onBpmChange: unknown }).onBpmChange = prev.onBpmChange;
    expect(drumMachinePropsAreEqual(prev, next)).toBe(true);
  });
});

// ─── Integration: Comparator gegen den ECHTEN Store ───────────────────────────
// Verifiziert die zentrale Annahme des Fixes: bei einer reinen
// currentStep-Änderung erzeugt useDrumMachineStore ein dm, dessen übrige Felder
// (inkl. aller Action-Funktionen) referenziell identisch bleiben → Comparator
// skippt. Wäre eine Action nicht useCallback-stabil, wäre der memo-Fix wirkungslos.

describe("drumMachinePropsAreEqual – gegen echten useDrumMachineStore", () => {
  const stableProps = {
    samples: [] as unknown,
    isPlaying: true,
    bpm: 120,
    onPlayStop: () => {},
    onBpmChange: (_b: number) => {},
    className: "h-full",
    externalSyncEnabled: false,
    externalSyncStatus: "off" as const,
  };

  it("nur setCurrentStep → Comparator returns true (memo skippt → kein Full-Rerender)", () => {
    const { result } = renderHook(() => useDrumMachineStore());
    const prev = { dm: result.current, ...stableProps };
    act(() => {
      result.current.setCurrentStep(5);
    });
    const next = { dm: result.current, ...stableProps };
    expect(prev.dm.currentStep).toBe(0);
    expect(next.dm.currentStep).toBe(5);
    expect(
      drumMachinePropsAreEqual(
        prev as unknown as Parameters<typeof drumMachinePropsAreEqual>[0],
        next as unknown as Parameters<typeof drumMachinePropsAreEqual>[1],
      ),
    ).toBe(true);
  });

  it("echte State-Änderung (addPattern) → Comparator returns false (Rerender)", () => {
    const { result } = renderHook(() => useDrumMachineStore());
    const prev = { dm: result.current, ...stableProps };
    act(() => {
      result.current.addPattern("Neu");
    });
    const next = { dm: result.current, ...stableProps };
    expect(
      drumMachinePropsAreEqual(
        prev as unknown as Parameters<typeof drumMachinePropsAreEqual>[0],
        next as unknown as Parameters<typeof drumMachinePropsAreEqual>[1],
      ),
    ).toBe(false);
  });
});
