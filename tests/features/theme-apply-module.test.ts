/**
 * tests/features/theme-apply-module.test.ts (TASK-248)
 *
 * Tests für das neutrale Modul client/src/utils/themeApply.ts, das beim
 * Auflösen des Runtime-Import-Cycles useThemeStore <-> ThemeSettings
 * entstanden ist.
 *
 * Verifiziert die reine DOM/Token + Persistenz-Logik der extrahierten
 * Funktionen `applyTheme` (data-theme-Setzen) und `loadSavedTheme`
 * (localStorage-Roundtrip, validiert gegen THEMES).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  applyTheme,
  loadSavedTheme,
  THEMES,
  type ThemeId,
} from "@/utils/themeApply";

const STORAGE_KEY = "ss-theme";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("themeApply.THEMES", () => {
  it("enthält alle eingebauten Theme-IDs als Single-Source-of-Truth", () => {
    const ids = THEMES.map((t) => t.id);
    // Stichprobe der bekannten Built-Ins (siehe CLAUDE.md / ThemeSettings)
    for (const expected of ["dark", "neon", "analog", "oled"] as ThemeId[]) {
      expect(ids).toContain(expected);
    }
    // jede Theme-Definition hat ein 3-Farben-Preview-Tupel
    for (const t of THEMES) {
      expect(t.preview).toHaveLength(3);
    }
  });
});

describe("themeApply.applyTheme (Happy Path)", () => {
  it("setzt data-theme-Attribut für ein nicht-dark Theme", () => {
    applyTheme("neon");
    expect(document.documentElement.getAttribute("data-theme")).toBe("neon");
  });

  it("entfernt data-theme für 'dark' (Default ohne Attribut)", () => {
    // erst ein anderes Theme setzen ...
    applyTheme("oled");
    expect(document.documentElement.getAttribute("data-theme")).toBe("oled");
    // ... dann zurück auf dark -> Attribut weg
    applyTheme("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
  });
});

describe("themeApply.loadSavedTheme (Edge Cases)", () => {
  it("liefert 'dark' als Fallback wenn nichts gespeichert ist", () => {
    expect(loadSavedTheme()).toBe("dark");
  });

  it("ignoriert einen ungültigen gespeicherten Wert und fällt auf 'dark' zurück", () => {
    localStorage.setItem(STORAGE_KEY, "not-a-real-theme");
    expect(loadSavedTheme()).toBe("dark");
  });
});

describe("themeApply (Persistence Round-Trip)", () => {
  it("ein in localStorage gespeicherter gültiger Theme-Wert wird zurückgelesen", () => {
    localStorage.setItem(STORAGE_KEY, "analog");
    const loaded = loadSavedTheme();
    expect(loaded).toBe("analog");
    // und lässt sich ohne Fehler anwenden
    applyTheme(loaded);
    expect(document.documentElement.getAttribute("data-theme")).toBe("analog");
  });

  it("jede THEMES-ID ist ein gültig speicherbarer/ladbarer Wert", () => {
    for (const t of THEMES) {
      localStorage.setItem(STORAGE_KEY, t.id);
      expect(loadSavedTheme()).toBe(t.id);
    }
  });
});
