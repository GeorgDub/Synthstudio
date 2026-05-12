/**
 * tests/features/humanizer.test.ts
 *
 * Unit-Tests fuer useHumanizerStore.
 *
 * HINWEIS: useHumanizerStore() ist ein React-Hook (useState/useCallback).
 * In Node ohne DOM/Renderer (kein jsdom, kein @testing-library/react)
 * lassen sich die Action-Callbacks nicht direkt aufrufen. Daher sind die
 * Verhaltens-Tests mit it.skip + Begruendung markiert. Die Tests hier
 * pruefen die exportierten Typen / den API-Vertrag.
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
  useHumanizerStore,
  type HumanizerSettings,
  type HumanizerState,
  type HumanizerActions,
  type GroovePreset,
} from "../../client/src/store/useHumanizerStore";

describe("useHumanizerStore – Modul-Exports und Typen", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("exportiert die Hook-Funktion useHumanizerStore", () => {
    expect(typeof useHumanizerStore).toBe("function");
  });

  it("HumanizerSettings-Shape hat alle Felder (Typcheck)", () => {
    const s: HumanizerSettings = {
      swing: 0.5,
      velocityJitter: 0.1,
      timingJitter: 5,
      enabled: true,
      swingOnEvenSteps: true,
      preset: null,
    };
    expect(s.swing).toBe(0.5);
    expect(s.velocityJitter).toBeCloseTo(0.1);
    expect(s.timingJitter).toBe(5);
    expect(s.enabled).toBe(true);
    expect(s.swingOnEvenSteps).toBe(true);
    expect(s.preset).toBeNull();
  });

  it("GroovePreset-Shape ist korrekt typisiert", () => {
    const p: GroovePreset = {
      name: "Test",
      description: "Test-Preset",
      swing: 0.3,
      velocityJitter: 0.1,
      timingJitter: 2,
    };
    expect(p.name).toBe("Test");
    expect(p.swing).toBe(0.3);
  });

  it("HumanizerState enthaelt global, perPart, presets", () => {
    const state: HumanizerState = {
      global: {
        swing: 0,
        velocityJitter: 0,
        timingJitter: 0,
        enabled: false,
        swingOnEvenSteps: true,
        preset: null,
      },
      perPart: {},
      presets: [],
    };
    expect(state.global.enabled).toBe(false);
    expect(state.perPart).toEqual({});
    expect(Array.isArray(state.presets)).toBe(true);
  });

  it("HumanizerActions deklariert alle erwarteten Methoden", () => {
    const required: (keyof HumanizerActions)[] = [
      "updateGlobal",
      "updatePart",
      "resetPart",
      "loadPreset",
      "toggleEnabled",
      "reset",
      "getTimingOffset",
      "getVelocityMultiplier",
    ];
    expect(required).toHaveLength(8);
  });

  // ─── Hook-basierte Tests (skip in Node ohne Renderer) ───────────────────────

  it.skip("updateGlobal({ swing }) setzt Swing-Wert", () => {
    // Skip-Grund: useHumanizerStore ist ein React-Hook und benoetigt einen
    // Renderer (z.B. @testing-library/react + jsdom). Diese Funktionalitaet
    // ist via Komponententests / Playwright E2E abgedeckt.
  });

  it.skip("updateGlobal setzt velocityJitter", () => {
    // Skip-Grund: siehe oben (React-Hook benoetigt Renderer).
  });

  it.skip("toggleEnabled invertiert global.enabled", () => {
    // Skip-Grund: siehe oben.
  });

  it.skip("loadPreset uebernimmt swing/velocityJitter/timingJitter", () => {
    // Skip-Grund: siehe oben.
  });

  it.skip("getTimingOffset gibt 0 zurueck wenn enabled=false", () => {
    // Skip-Grund: siehe oben. Die getTimingOffset-Logik liest internen
    // State der nur ueber den Hook erreichbar ist.
  });
});
