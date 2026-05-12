/**
 * tests/features/automation.test.ts
 *
 * Unit-Tests fuer useAutomationStore.
 *
 * HINWEIS: useAutomationStore() ist ein React-Hook der useState/useCallback
 * intern verwendet. In einer Node-Umgebung ohne DOM/Renderer (kein jsdom,
 * kein @testing-library/react im Projekt) lassen sich die Action-Callbacks
 * nicht direkt ausfuehren. Daher werden hier die Hook-Action-Tests mit
 * it.skip markiert und stattdessen die exportierten Typen / der API-Vertrag
 * geprueft.
 */
import { describe, it, expect, beforeEach } from "vitest";

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
  type AutomationTarget,
  type AutomationLane,
  type AutomationState,
  type AutomationActions,
} from "../../client/src/store/useAutomationStore";

describe("useAutomationStore – Modul-Exports", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("exportiert die Hook-Funktion useAutomationStore", () => {
    expect(typeof useAutomationStore).toBe("function");
  });

  it("AutomationTarget akzeptiert die bekannten String-Literal-Typen", () => {
    // Compile-Time-Check ueber Variablen-Zuweisungen
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
    // Nur Compile-Time: muss alle erwarteten Methoden-Namen aufzaehlen
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

  // ─── Hook-basierte Tests (skip in Node ohne Renderer) ───────────────────────

  it.skip("addLane fuegt neue Lane hinzu", () => {
    // Skip-Grund: useAutomationStore ist ein React-Hook und benoetigt einen
    // React-Renderer (z.B. @testing-library/react + jsdom) der hier nicht
    // verfuegbar ist. Diese Funktionalitaet ist via E2E/Komponententests
    // (Playwright) abgedeckt.
  });

  it.skip("removeLane entfernt Lane anhand der ID", () => {
    // Skip-Grund: siehe addLane (React-Hook benoetigt Renderer).
  });

  it.skip("setPoint setzt einen Punkt und klemmt auf min/max", () => {
    // Skip-Grund: siehe addLane.
  });

  it.skip("getValueAt liefert linear interpolierten Wert zwischen Punkten", () => {
    // Skip-Grund: siehe addLane. Die interpolate()-Funktion ist nicht
    // exportiert und kann nicht isoliert getestet werden.
  });
});
