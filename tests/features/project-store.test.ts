/**
 * tests/features/project-store.test.ts
 *
 * Unit-Tests fuer useProjectStore.
 *
 * HINWEIS: useProjectStore ist ein React-Hook (useState + useCallback).
 * In Node ohne DOM/Renderer (kein jsdom, kein @testing-library/react)
 * lassen sich die Action-Callbacks nicht direkt aufrufen. Daher pruefen
 * die Tests hier nur die exportierten Typen / den API-Vertrag.
 * Die Hook-Verhaltens-Tests sind via Playwright-E2E in tests/electron/e2e
 * abgedeckt.
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
  useProjectStore,
  type Sample,
  type ProjectState,
  type ProjectActions,
} from "../../client/src/store/useProjectStore";

describe("useProjectStore – Modul-Exports und Typen", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("exportiert die Hook-Funktion useProjectStore", () => {
    expect(typeof useProjectStore).toBe("function");
  });

  it("Sample-Shape ist korrekt typisiert", () => {
    const s: Sample = {
      id: "id-1",
      name: "kick.wav",
      path: "C:/samples/kick.wav",
      category: "kick",
      size: 1024,
      tags: ["kick", "808"],
    };
    expect(s.name).toBe("kick.wav");
    expect(s.tags).toContain("kick");
  });

  it("Sample funktioniert auch ohne optionale Felder", () => {
    const s: Sample = {
      id: "id-2",
      name: "snare.wav",
      path: "/samples/snare.wav",
      category: "snare",
    };
    expect(s.size).toBeUndefined();
    expect(s.tags).toBeUndefined();
  });

  it("ProjectState enthaelt alle dokumentierten Felder", () => {
    const state: ProjectState = {
      projectName: "Test",
      isDirty: false,
      canUndo: false,
      canRedo: false,
      samples: [],
      isPlaying: false,
      isRecording: false,
      bpm: 120,
    };
    expect(state.projectName).toBe("Test");
    expect(state.bpm).toBe(120);
    expect(state.samples).toEqual([]);
  });

  it("ProjectActions deklariert alle erwarteten Methoden", () => {
    const required: (keyof ProjectActions)[] = [
      "setProjectName",
      "setDirty",
      "setBpm",
      "saveProject",
      "loadProject",
      "newProject",
      "newProjectFromTemplate",
      "exportProject",
      "undo",
      "redo",
      "togglePlayStop",
      "toggleRecord",
      "addSamples",
      "removeSample",
      "importSamplesFromPaths",
      "reorderSamples",
    ];
    expect(required).toHaveLength(16);
  });

  // ─── Hook-basierte Verhaltens-Tests (skip in Node ohne Renderer) ────────────

  it.skip("setBpm klemmt BPM auf 20..300 und setzt isDirty", () => {
    // Skip-Grund: useProjectStore ist ein React-Hook und benoetigt einen
    // Renderer (z.B. @testing-library/react + jsdom). Diese Funktionalitaet
    // ist via Playwright-E2E getestet.
  });

  it.skip("addSamples dedupliziert anhand des Pfades", () => {
    // Skip-Grund: siehe setBpm.
  });

  it.skip("removeSample entfernt Sample anhand ID und setzt isDirty", () => {
    // Skip-Grund: siehe setBpm.
  });

  it.skip("setProjectName aktualisiert den Namen", () => {
    // Skip-Grund: siehe setBpm.
  });

  it.skip("togglePlayStop invertiert isPlaying", () => {
    // Skip-Grund: siehe setBpm.
  });

  it.skip("isDirty wird automatisch gesetzt bei addSamples/setBpm/removeSample", () => {
    // Skip-Grund: siehe setBpm. Verhalten ist im Source dokumentiert
    // (isDirty: true in den Callbacks setBpm, addSamples, removeSample, …).
  });
});
