// @vitest-environment jsdom
/**
 * tests/features/automation.test.ts
 *
 * Unit-Tests fuer useAutomationStore + interpolate-Pure-Helper.
 *
 * Setup-History:
 *   v1.x: 4 Hook-Tests waren `it.skip`, weil Node-only Vitest keinen React-
 *   Renderer hatte. Mit jsdom + @testing-library/react (verfuegbar seit
 *   Sprint-119c / TASK-242) sind sie reaktiviert via `renderHook`.
 *   Plus: `interpolate()` ist jetzt exportiert und kann isoliert pure-getestet
 *   werden — das deckt die `getValueAt`-Logik unabhaengig vom Hook ab.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ─── localStorage Mock ────────────────────────────────────────────────────────

function createLocalStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string): string | null => store[k] ?? null,
    setItem: (k: string, v: string): void => {
      store[k] = v;
    },
    removeItem: (k: string): void => {
      delete store[k];
    },
    clear: (): void => {
      store = {};
    },
  };
}

const localStorageMock = createLocalStorageMock();
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

import {
  useAutomationStore,
  interpolate,
  type AutomationTarget,
  type AutomationLane,
  type AutomationState,
  type AutomationActions,
} from "../../client/src/store/useAutomationStore";

describe("useAutomationStore - Modul-Exports", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("exportiert die Hook-Funktion useAutomationStore", () => {
    expect(typeof useAutomationStore).toBe("function");
  });

  it("AutomationTarget akzeptiert die bekannten String-Literal-Typen", () => {
    const a: AutomationTarget = "bpm";
    const b: AutomationTarget = "master-vol";
    const c: AutomationTarget = "vol:kick";
    const d: AutomationTarget = "pan:snare";
    const e: AutomationTarget = "send-rev:hihat";
    const f: AutomationTarget = "send-dly:perc";
    expect([a, b, c, d, e, f]).toHaveLength(6);
  });

  it("AutomationLane-Shape ist konsistent (Typcheck)", () => {
    const lane: AutomationLane = {
      id: "test-id",
      target: "bpm",
      label: "Test",
      points: { 0: 120, 8: 140 },
      enabled: true,
      min: 60,
      max: 200,
      defaultValue: 120,
    };
    expect(lane.points[0]).toBe(120);
    expect(lane.points[8]).toBe(140);
    expect(lane.enabled).toBe(true);
  });

  it("AutomationState hat lanes, stepCount, recording", () => {
    const state: AutomationState = {
      lanes: [],
      stepCount: 16,
      recording: false,
    };
    expect(state.stepCount).toBe(16);
    expect(state.recording).toBe(false);
    expect(Array.isArray(state.lanes)).toBe(true);
  });

  it("AutomationActions deklariert alle erwarteten Methoden (Typcheck)", () => {
    const required: (keyof AutomationActions)[] = [
      "addLane",
      "removeLane",
      "setPoint",
      "clearPoint",
      "clearLane",
      "setLaneEnabled",
      "setStepCount",
      "setRecording",
      "getValueAt",
    ];
    expect(required).toHaveLength(9);
  });
});

// ─── Pure Interpolate-Tests (kein Hook, kein Renderer) ─────────────────────

describe("interpolate (pure helper)", () => {
  it("leeres Points-Objekt liefert null", () => {
    expect(interpolate({}, 5, 16)).toBeNull();
  });

  it("exakter Treffer liefert den hinterlegten Wert", () => {
    expect(interpolate({ 4: 100 }, 4, 16)).toBe(100);
  });

  it("vor dem ersten Punkt liefert den ersten Punkt (clamp links)", () => {
    expect(interpolate({ 8: 0.5 }, 0, 16)).toBe(0.5);
  });

  it("nach dem letzten Punkt liefert den letzten Punkt (clamp rechts)", () => {
    expect(interpolate({ 4: 0.5 }, 15, 16)).toBe(0.5);
  });

  it("linear interpoliert in der Mitte zwischen zwei Punkten", () => {
    expect(interpolate({ 0: 0, 8: 100 }, 4, 16)).toBe(50);
  });

  it("interpoliert asymmetrische Punkt-Abstaende korrekt", () => {
    // points 2: 10, 10: 90, step 4 -> (4-2)/(10-2)=0.25 -> 10 + 0.25*80 = 30
    expect(interpolate({ 2: 10, 10: 90 }, 4, 16)).toBe(30);
  });

  it("akzeptiert negative Werte (Pan-Lane)", () => {
    expect(interpolate({ 0: -1, 8: 1 }, 4, 16)).toBe(0);
  });

  it("liefert exakten Wert wenn step === existierender key (kein Floating-Point-Drift)", () => {
    expect(interpolate({ 7: 0.42 }, 7, 16)).toBe(0.42);
  });
});

// ─── Hook-Tests (via @testing-library/react renderHook) ─────────────────────

describe("useAutomationStore Actions", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("addLane fuegt neue Lane hinzu und liefert deren ID", () => {
    const { result } = renderHook(() => useAutomationStore());
    expect(result.current.lanes).toEqual([]);

    let newId = "";
    act(() => {
      newId = result.current.addLane("bpm", "Tempo");
    });
    expect(newId).toBeTruthy();
    expect(result.current.lanes).toHaveLength(1);
    expect(result.current.lanes[0].target).toBe("bpm");
    expect(result.current.lanes[0].label).toBe("Tempo");
    expect(result.current.lanes[0].id).toBe(newId);
    expect(result.current.lanes[0].enabled).toBe(true);
  });

  it("addLane mit leerem Label nutzt targetDefaults-Label", () => {
    const { result } = renderHook(() => useAutomationStore());
    let id = "";
    act(() => { id = result.current.addLane("bpm", ""); });
    const lane = result.current.lanes.find(l => l.id === id);
    expect(lane?.label).toBe("BPM");
  });

  it("removeLane entfernt Lane anhand der ID", () => {
    const { result } = renderHook(() => useAutomationStore());
    let idA = "", idB = "";
    act(() => {
      idA = result.current.addLane("bpm", "A");
      idB = result.current.addLane("master-vol", "B");
    });
    expect(result.current.lanes).toHaveLength(2);
    act(() => { result.current.removeLane(idA); });
    expect(result.current.lanes).toHaveLength(1);
    expect(result.current.lanes[0].id).toBe(idB);
  });

  it("setPoint setzt einen Punkt und klemmt auf min/max", () => {
    const { result } = renderHook(() => useAutomationStore());
    let id = "";
    act(() => { id = result.current.addLane("bpm", "Tempo"); });
    // Im default: bpm min=60, max=200
    act(() => { result.current.setPoint(id, 4, 150); });
    expect(result.current.lanes[0].points[4]).toBe(150);

    // ueber max -> clamp auf 200
    act(() => { result.current.setPoint(id, 5, 999); });
    expect(result.current.lanes[0].points[5]).toBe(200);

    // unter min -> clamp auf 60
    act(() => { result.current.setPoint(id, 6, -10); });
    expect(result.current.lanes[0].points[6]).toBe(60);
  });

  it("clearPoint entfernt nur den angegebenen Step", () => {
    const { result } = renderHook(() => useAutomationStore());
    let id = "";
    act(() => {
      id = result.current.addLane("bpm", "T");
      result.current.setPoint(id, 0, 120);
      result.current.setPoint(id, 8, 140);
    });
    act(() => { result.current.clearPoint(id, 0); });
    expect(result.current.lanes[0].points[0]).toBeUndefined();
    expect(result.current.lanes[0].points[8]).toBe(140);
  });

  it("clearLane leert alle Punkte einer Lane", () => {
    const { result } = renderHook(() => useAutomationStore());
    let id = "";
    act(() => {
      id = result.current.addLane("bpm", "T");
      result.current.setPoint(id, 0, 120);
      result.current.setPoint(id, 8, 140);
    });
    act(() => { result.current.clearLane(id); });
    expect(result.current.lanes[0].points).toEqual({});
  });

  it("setLaneEnabled wechselt den enabled-Flag", () => {
    const { result } = renderHook(() => useAutomationStore());
    let id = "";
    act(() => { id = result.current.addLane("bpm", "T"); });
    expect(result.current.lanes[0].enabled).toBe(true);
    act(() => { result.current.setLaneEnabled(id, false); });
    expect(result.current.lanes[0].enabled).toBe(false);
  });

  it("setStepCount aktualisiert die globale Step-Anzahl", () => {
    const { result } = renderHook(() => useAutomationStore());
    expect(result.current.stepCount).toBe(16);
    act(() => { result.current.setStepCount(32); });
    expect(result.current.stepCount).toBe(32);
    act(() => { result.current.setStepCount(64); });
    expect(result.current.stepCount).toBe(64);
  });

  it("setRecording wechselt den recording-Flag", () => {
    const { result } = renderHook(() => useAutomationStore());
    expect(result.current.recording).toBe(false);
    act(() => { result.current.setRecording(true); });
    expect(result.current.recording).toBe(true);
  });

  it("getValueAt liefert linear interpolierten Wert zwischen Punkten", () => {
    const { result } = renderHook(() => useAutomationStore());
    let id = "";
    act(() => {
      id = result.current.addLane("bpm", "T");
      result.current.setPoint(id, 0, 100);
      result.current.setPoint(id, 8, 140);
    });
    // bei step 4 sollte (100+140)/2 = 120 sein
    expect(result.current.getValueAt("bpm", 4)).toBe(120);
    // exakter Treffer
    expect(result.current.getValueAt("bpm", 0)).toBe(100);
    expect(result.current.getValueAt("bpm", 8)).toBe(140);
    // unused id-Variable suppress
    expect(id).toBeTruthy();
  });

  it("getValueAt liefert null wenn keine Lane fuer das Target existiert", () => {
    const { result } = renderHook(() => useAutomationStore());
    expect(result.current.getValueAt("bpm", 5)).toBeNull();
  });

  it("getValueAt ignoriert disabled Lanes", () => {
    const { result } = renderHook(() => useAutomationStore());
    let id = "";
    act(() => {
      id = result.current.addLane("bpm", "T");
      result.current.setPoint(id, 0, 100);
      result.current.setLaneEnabled(id, false);
    });
    expect(result.current.getValueAt("bpm", 0)).toBeNull();
  });

  it("resetAutomation laesst State auf Defaults zurueck", () => {
    const { result } = renderHook(() => useAutomationStore());
    act(() => {
      result.current.addLane("bpm", "T");
      result.current.setStepCount(64);
      result.current.setRecording(true);
    });
    expect(result.current.lanes.length).toBeGreaterThan(0);
    act(() => { result.current.resetAutomation(); });
    expect(result.current.lanes).toEqual([]);
    expect(result.current.stepCount).toBe(16);
    expect(result.current.recording).toBe(false);
  });
});
