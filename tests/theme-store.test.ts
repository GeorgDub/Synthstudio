/**
 * tests/theme-store.test.ts
 *
 * Unit-Tests für useThemeStore (Phase 1 – Theme-System).
 * Umgebung: Node (kein DOM) → document und localStorage werden gemockt.
 * Getestet wird die exportierte Logik-Schicht (applyTheme, initFromStorage,
 * THEMES, getCurrentTheme, __resetForTests) ohne React-Renderer.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

// ─── Mock-Setup ───────────────────────────────────────────────────────────────

/** Einfacher in-memory localStorage-Mock */
function createLocalStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string): string | null => store[key] ?? null,
    setItem: (key: string, value: string): void => { store[key] = value; },
    removeItem: (key: string): void => { delete store[key]; },
    clear: (): void => { store = {}; },
  };
}

const localStorageMock = createLocalStorageMock();
const datasetMock: Record<string, string> = {};

// Globals vor Modul-Import setzen, damit _readFromStorage / _applyToDOM die
// Mocks bereits sehen, wenn das Modul das erste Mal ausgeführt wird.
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

Object.defineProperty(globalThis, "document", {
  value: { documentElement: { dataset: datasetMock } },
  writable: true,
  configurable: true,
});

Object.defineProperty(globalThis, "window", {
  value: {},
  writable: true,
  configurable: true,
});

// Erst NACH den Global-Mocks importieren
import {
  THEMES,
  applyTheme,
  initFromStorage,
  getCurrentTheme,
  __resetForTests,
} from "../client/src/store/useThemeStore";

// ─── Hilfsfunktion ───────────────────────────────────────────────────────────

function resetAll() {
  localStorageMock.clear();
  delete datasetMock["theme"];
  __resetForTests();
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("useThemeStore – Logik-Schicht", () => {
  beforeEach(resetAll);
  afterEach(resetAll);

  // Test 1 ─────────────────────────────────────────────────────────────────────
  it("initialer Theme ist 'dark' wenn kein localStorage-Wert vorhanden", () => {
    const result = initFromStorage();
    expect(result).toBe("dark");
    expect(getCurrentTheme()).toBe("dark");
  });

  // Test 2 ─────────────────────────────────────────────────────────────────────
  it("applyTheme('neon') setzt currentTheme auf 'neon'", () => {
    applyTheme("neon");
    expect(getCurrentTheme()).toBe("neon");
  });

  // Test 3 ─────────────────────────────────────────────────────────────────────
  it("applyTheme('analog') setzt currentTheme auf 'analog'", () => {
    applyTheme("analog");
    expect(getCurrentTheme()).toBe("analog");
  });

  // Test 4 ─────────────────────────────────────────────────────────────────────
  it("applyTheme persistiert den Wert in localStorage", () => {
    applyTheme("neon");
    expect(localStorageMock.getItem("ss-theme")).toBe("neon");

    applyTheme("analog");
    expect(localStorageMock.getItem("ss-theme")).toBe("analog");

    applyTheme("dark");
    expect(localStorageMock.getItem("ss-theme")).toBe("dark");
  });

  // Test 5 ─────────────────────────────────────────────────────────────────────
  it("applyTheme setzt document.documentElement.dataset.theme", () => {
    applyTheme("neon");
    expect(datasetMock["theme"]).toBe("neon");

    applyTheme("analog");
    expect(datasetMock["theme"]).toBe("analog");

    applyTheme("dark");
    expect(datasetMock["theme"]).toBe("dark");
  });

  // Test 6 ─────────────────────────────────────────────────────────────────────
  it("theme.name ist korrekt für alle 3 Themes", () => {
    const byId = Object.fromEntries(THEMES.map((t) => [t.id, t.name]));
    expect(byId["dark"]).toBe("Dark Studio");
    expect(byId["neon"]).toBe("Neon Circuit");
    expect(byId["analog"]).toBe("Analog Hardware");
  });

  // Test 7 ─────────────────────────────────────────────────────────────────────
  it("initFromStorage liest gespeicherten Theme-Wert aus localStorage", () => {
    localStorageMock.setItem("ss-theme", "neon");
    const result = initFromStorage();
    expect(result).toBe("neon");
    expect(getCurrentTheme()).toBe("neon");
  });

  // Test 8 ─────────────────────────────────────────────────────────────────────
  it("THEMES-Array enthält alle 3 Themes mit korrekten IDs", () => {
    expect(THEMES).toHaveLength(3);
    const ids = THEMES.map((t) => t.id);
    expect(ids).toContain("dark");
    expect(ids).toContain("neon");
    expect(ids).toContain("analog");
  });
});
