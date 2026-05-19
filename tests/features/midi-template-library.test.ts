/**
 * tests/features/midi-template-library.test.ts (v3.121.0)
 *
 * Tests für die neue MIDI-Templates-Library:
 *   - midiHardwareTemplates.ts (structured re-export, lookup, category filter)
 *   - useMidiTemplateStore.ts (recently-used, JSON import/export)
 */
import { describe, it, expect, beforeEach } from "vitest";

// localStorage Mock (vor Module-Load)
function createLocalStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem:    (key: string): string | null => store[key] ?? null,
    setItem:    (key: string, value: string): void => { store[key] = value; },
    removeItem: (key: string): void => { delete store[key]; },
    clear:      (): void => { store = {}; },
  };
}
const localStorageMock = createLocalStorageMock();
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

import {
  HARDWARE_TEMPLATES,
  ALL_CATEGORIES,
  CATEGORY_LABELS,
  getTemplateById,
  getTemplatesByCategory,
  type HardwareTemplate,
} from "../../client/src/utils/midiHardwareTemplates";

import {
  exportTemplateToJson,
  importTemplateFromJson,
  markRecentlyUsed,
  getRecentlyUsed,
  clearRecentlyUsed,
  __resetMidiTemplateStoreForTests,
  TEMPLATE_EXPORT_VERSION,
} from "../../client/src/store/useMidiTemplateStore";

beforeEach(() => {
  localStorageMock.clear();
  __resetMidiTemplateStoreForTests();
});

describe("midiHardwareTemplates", () => {
  it("HARDWARE_TEMPLATES enthält mindestens 13 Vorlagen (Re-Export der MIDI_TEMPLATES)", () => {
    expect(HARDWARE_TEMPLATES.length).toBeGreaterThanOrEqual(13);
  });

  it("getTemplateById findet ein bekanntes Template", () => {
    const t = getTemplateById("launchpad-mk2");
    expect(t).toBeDefined();
    expect(t!.name).toContain("Launchpad");
    expect(t!.category).toBe("pad-grid");
  });

  it("getTemplateById gibt undefined für unbekannte ID", () => {
    expect(getTemplateById("does-not-exist")).toBeUndefined();
  });

  it("getTemplatesByCategory filtert korrekt nach Kategorie", () => {
    const padGrids = getTemplatesByCategory("pad-grid");
    expect(padGrids.length).toBeGreaterThan(0);
    padGrids.forEach((t) => expect(t.category).toBe("pad-grid"));

    const drums = getTemplatesByCategory("drum-machine");
    expect(drums.length).toBeGreaterThan(0);
    drums.forEach((t) => expect(t.category).toBe("drum-machine"));
  });

  it("getTemplatesByCategory('all') returnt alle Templates", () => {
    const all = getTemplatesByCategory("all");
    expect(all.length).toBe(HARDWARE_TEMPLATES.length);
  });

  it("ALL_CATEGORIES + CATEGORY_LABELS sind konsistent", () => {
    expect(ALL_CATEGORIES.length).toBeGreaterThanOrEqual(4);
    ALL_CATEGORIES.forEach((c) => {
      expect(CATEGORY_LABELS[c]).toBeTruthy();
    });
  });

  it("Jedes Hardware-Template hat valide Pflichtfelder", () => {
    HARDWARE_TEMPLATES.forEach((t) => {
      expect(t.id).toBeTruthy();
      expect(t.name).toBeTruthy();
      expect(t.manufacturer).toBeTruthy();
      expect(t.description.length).toBeGreaterThan(5);
      expect(ALL_CATEGORIES.includes(t.category)).toBe(true);
    });
  });

  it("nanoKONTROL2 ist als 'controller' kategorisiert", () => {
    const t = getTemplateById("nanokontrol2");
    expect(t?.category).toBe("controller");
  });

  it("KORG Electribe 2 ist als 'drum-machine' kategorisiert mit Tips", () => {
    const t = getTemplateById("korg-electribe-2");
    expect(t?.category).toBe("drum-machine");
    expect(t?.tips).toBeDefined();
    expect(t!.tips!.length).toBeGreaterThan(0);
  });
});

describe("useMidiTemplateStore – Import/Export", () => {
  function makeFixtureTemplate(): HardwareTemplate {
    return {
      id: "fixture-test",
      name: "Fixture Test Controller",
      manufacturer: "TestCorp",
      category: "controller",
      description: "Ein Test-Template für die Test-Suite.",
      tips: ["Tipp eins", "Tipp zwei"],
      ccMappings: [
        { cc: 7, channel: 0, target: { type: "masterVolume" } },
        { cc: 1, channel: 0, target: { type: "bpm" } },
      ],
      noteMappings: [
        { note: 36, channel: 9, partId: "part-0" },
      ],
    };
  }

  it("exportTemplateToJson erzeugt valides Schema mit Marker", () => {
    const t = makeFixtureTemplate();
    const json = exportTemplateToJson(t);
    const parsed = JSON.parse(json);
    expect(parsed.synthstudioTemplate).toBe(TEMPLATE_EXPORT_VERSION);
    expect(parsed.id).toBe("fixture-test");
    expect(parsed.ccMappings).toHaveLength(2);
    expect(parsed.noteMappings).toHaveLength(1);
    expect(parsed.tips).toEqual(["Tipp eins", "Tipp zwei"]);
  });

  it("importTemplateFromJson akzeptiert valid JSON (Round-Trip)", () => {
    const t = makeFixtureTemplate();
    const json = exportTemplateToJson(t);
    const result = importTemplateFromJson(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.template.id).toBe(t.id);
      expect(result.template.name).toBe(t.name);
      expect(result.template.category).toBe(t.category);
      expect(result.template.ccMappings).toHaveLength(2);
      expect(result.template.noteMappings).toHaveLength(1);
    }
  });

  it("importTemplateFromJson lehnt leeren Text ab", () => {
    const result = importTemplateFromJson("");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/leer/i);
  });

  it("importTemplateFromJson lehnt invalides JSON ab", () => {
    const result = importTemplateFromJson("not valid json {{");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/JSON-Parse-Fehler/);
  });

  it("importTemplateFromJson lehnt fehlenden synthstudioTemplate-Marker ab", () => {
    const result = importTemplateFromJson(JSON.stringify({ id: "x", name: "X" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/synthstudioTemplate/);
  });

  it("importTemplateFromJson lehnt fehlende required fields ab (kein name)", () => {
    const result = importTemplateFromJson(
      JSON.stringify({
        synthstudioTemplate: "v1",
        id: "x",
        manufacturer: "Test",
        description: "desc",
        ccMappings: [],
        noteMappings: [],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/name/);
  });

  it("importTemplateFromJson lehnt nicht-Array ccMappings ab", () => {
    const result = importTemplateFromJson(
      JSON.stringify({
        synthstudioTemplate: "v1",
        id: "x",
        name: "X",
        manufacturer: "Test",
        description: "desc",
        category: "controller",
        ccMappings: "not an array",
        noteMappings: [],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/ccMappings/);
  });

  it("importTemplateFromJson warnt bei unbekannter Kategorie (Fallback auf controller)", () => {
    const result = importTemplateFromJson(
      JSON.stringify({
        synthstudioTemplate: "v1",
        id: "x",
        name: "X",
        manufacturer: "Test",
        description: "desc",
        category: "nonsense-category",
        ccMappings: [],
        noteMappings: [],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.template.category).toBe("controller");
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.length).toBeGreaterThan(0);
    }
  });
});

describe("useMidiTemplateStore – Recently-Used", () => {
  it("recentlyUsed startet leer", () => {
    expect(getRecentlyUsed()).toEqual([]);
  });

  it("markRecentlyUsed fügt eine ID hinzu (LIFO)", () => {
    markRecentlyUsed("template-a");
    markRecentlyUsed("template-b");
    const list = getRecentlyUsed();
    expect(list[0]).toBe("template-b");
    expect(list[1]).toBe("template-a");
  });

  it("markRecentlyUsed dedupliziert + verschiebt an die Spitze", () => {
    markRecentlyUsed("a");
    markRecentlyUsed("b");
    markRecentlyUsed("c");
    markRecentlyUsed("a"); // duplicate — sollte an die Spitze
    const list = getRecentlyUsed();
    expect(list).toEqual(["a", "c", "b"]);
    expect(list.length).toBe(3);
  });

  it("markRecentlyUsed cap'd auf 5 Einträge (FIFO eviction)", () => {
    ["a", "b", "c", "d", "e", "f", "g"].forEach((id) => markRecentlyUsed(id));
    const list = getRecentlyUsed();
    expect(list.length).toBe(5);
    expect(list[0]).toBe("g"); // neuester zuerst
    expect(list).not.toContain("a");
    expect(list).not.toContain("b");
  });

  it("clearRecentlyUsed leert die Liste", () => {
    markRecentlyUsed("x");
    expect(getRecentlyUsed().length).toBe(1);
    clearRecentlyUsed();
    expect(getRecentlyUsed()).toEqual([]);
  });

  it("Recently-Used persistiert über localStorage", () => {
    markRecentlyUsed("persisted-template");
    // Persistenz-Check: localStorage muss den Eintrag enthalten
    const raw = localStorageMock.getItem("ss-midi-templates:v1");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.recentlyUsed).toContain("persisted-template");
  });
});
