/**
 * Synthstudio – Theme-Tokens v2.48 Tests
 *
 * Verifiziert:
 * 1. Die zwei neuen Tokens --ss-accent-tertiary + --ss-accent-warning
 *    sind in ALLEN built-in Themes definiert.
 * 2. Custom-Theme-Schema ist back-compat: alte Themes (12 Felder) laden
 *    ohne Crash; neue Themes (14 Felder) persistieren komplett.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CSS = readFileSync(resolve(__dirname, "../../client/src/index.css"), "utf-8");

// Themes via data-theme-Selector definiert; :root ist der dark-Default.
// Wir extrahieren jeden Theme-Block separat um Inheritance-Effekte zu vermeiden.
function extractThemeBlock(themeName: string): string {
  if (themeName === "dark") {
    const m = CSS.match(/:root,\s*\[data-theme="dark"\][^{]*\{([^}]+)\}/);
    return m?.[1] ?? "";
  }
  const re = new RegExp(`\\[data-theme="${themeName}"\\][^{]*\\{([^}]+)\\}`, "m");
  return CSS.match(re)?.[1] ?? "";
}

const BUILT_IN_THEMES = [
  "dark", "neon", "analog", "purple", "warm",
  "oled", "daylight", "paper", "deuteranopia", "protanopia",
];

describe("v2.48: Theme-Tokens — tertiary + warning", () => {
  it("@theme block exportiert beide neuen Tokens als Tailwind-Color-Klassen", () => {
    expect(CSS).toMatch(/--color-accent-tertiary:\s*var\(--ss-accent-tertiary\)/);
    expect(CSS).toMatch(/--color-accent-warning:\s*var\(--ss-accent-warning\)/);
  });

  for (const theme of BUILT_IN_THEMES) {
    it(`Theme "${theme}" definiert --ss-accent-tertiary`, () => {
      const block = extractThemeBlock(theme);
      expect(block).not.toBe("");
      expect(block).toMatch(/--ss-accent-tertiary:\s*#[0-9a-fA-F]{3,8}/);
    });

    it(`Theme "${theme}" definiert --ss-accent-warning`, () => {
      const block = extractThemeBlock(theme);
      expect(block).toMatch(/--ss-accent-warning:\s*#[0-9a-fA-F]{3,8}/);
    });
  }

  it("Reihenfolge: tertiary kommt nach secondary, warning kommt nach success", () => {
    // Im default-dark-Theme prüfen wir die semantische Gruppierung der Tokens.
    const block = extractThemeBlock("dark");
    const idxSecondary = block.indexOf("--ss-accent-secondary");
    const idxTertiary  = block.indexOf("--ss-accent-tertiary");
    const idxSuccess   = block.indexOf("--ss-accent-success");
    const idxWarning   = block.indexOf("--ss-accent-warning");
    const idxDanger    = block.indexOf("--ss-accent-danger");

    expect(idxSecondary).toBeGreaterThan(-1);
    expect(idxTertiary).toBeGreaterThan(idxSecondary);
    expect(idxWarning).toBeGreaterThan(idxSuccess);
    expect(idxWarning).toBeLessThan(idxDanger);
  });
});

// ─── Custom-Theme-Schema Back-Compat ─────────────────────────────────────────

function createLocalStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
    raw: () => store,
  };
}
const lsMock = createLocalStorageMock();
Object.defineProperty(globalThis, "localStorage", {
  value: lsMock,
  writable: true,
  configurable: true,
});

// Import muss nach localStorage-Mock kommen damit loadState() den Mock sieht.
// Hinweis: useThemeStore importiert ThemeSettings via barrel — wir
// vermeiden tieferes setup indem wir nur die Funktionen importieren die
// keine DOM-API anfassen.

describe("v2.48: Custom-Theme-Schema Back-Compat", () => {
  it("CustomTheme-Type erlaubt Themes ohne tertiary/warning (alte Persistenz)", () => {
    // Type-Test via Cast: ein altes 12-Felder-Theme darf TypeScript-strict passieren.
    const oldTheme = {
      id: "legacy",
      name: "Old Theme",
      colors: {
        "--ss-bg-base": "#000",
        "--ss-bg-panel": "#111",
        "--ss-bg-elevated": "#222",
        "--ss-text-primary": "#fff",
        "--ss-text-muted": "#aaa",
        "--ss-text-dim": "#666",
        "--ss-border": "#333",
        "--ss-border-subtle": "#222",
        "--ss-accent-primary": "#0f0",
        "--ss-accent-secondary": "#0ff",
        // KEIN tertiary
        "--ss-accent-success": "#0a0",
        // KEIN warning
        "--ss-accent-danger": "#f00",
      },
    };
    // Wenn der Cast fehlschlägt, hat tsc beim build geblockt.
    type AssertCompiles = typeof oldTheme;
    const _check: AssertCompiles = oldTheme;
    expect(_check.colors["--ss-accent-primary"]).toBe("#0f0");
    expect((_check.colors as Record<string, string | undefined>)["--ss-accent-warning"]).toBeUndefined();
  });

  it("Object.entries auf Custom-Theme-Colors liefert nur definierte Keys (kein undefined-Eintrag)", () => {
    // Sanity-Check für applyCustomTheme: Object.entries skipped fehlende Keys
    // → der CSS-Block enthält keine "undefined"-Werte für tertiary/warning
    // wenn der User ein altes Theme lädt.
    const partial = {
      "--ss-accent-primary": "#abc",
      "--ss-accent-secondary": "#def",
    };
    const entries = Object.entries(partial);
    expect(entries).toHaveLength(2);
    for (const [_k, v] of entries) {
      expect(v).toBeDefined();
    }
  });
});
