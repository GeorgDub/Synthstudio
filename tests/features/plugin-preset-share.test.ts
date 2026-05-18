/**
 * tests/features/plugin-preset-share.test.ts
 *
 * v3.47.0 — Plugin-Chain-Preset JSON-Sharing (Export/Import).
 *
 * Coverage:
 *   - exportPresetAsJson liefert envelope-wrapped JSON mit korrektem Schema
 *   - importPresetFromJson akzeptiert Single + Bundle Envelopes
 *   - Dedup über (name + slot-hash) — Round-Trip importiert NICHT doppelt
 *   - Missing-Plugin: warning + import erfolgreich
 *   - Schema-Validation: unbekanntes Schema → clean reject
 *   - Round-Trip: export → import → identical (after dedup-skip)
 *   - Drag-Drop: `.synthpreset.json` routet zu "plugin-preset:import"
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from "vitest";

import {
  PRESET_EXPORT_SCHEMA,
  PRESET_BUNDLE_SCHEMA,
  addPluginChainPreset,
  exportPresetAsJson,
  exportAllPresetsAsJson,
  importPresetFromJson,
  hashPresetSlots,
  getPluginChainPresets,
  getPluginChainPresetById,
  __resetPluginChainPresetStoreForTests,
} from "../../client/src/store/usePluginChainPresetStore";
import { registerBuiltInPlugins, _resetPluginRegistry } from "../../client/src/audio/PluginRegistry";
import type { MixerPluginSlot } from "../../client/src/store/useMixerStore";
import {
  detectFileType,
  dispatchFileDrop,
} from "../../client/src/utils/dragDropDispatch";

beforeEach(() => {
  __resetPluginChainPresetStoreForTests();
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem("ss-plugin-chain-presets:v1");
    }
  } catch {
    /* ignore */
  }
  _resetPluginRegistry();
  registerBuiltInPlugins();
});

const sampleSlots: MixerPluginSlot[] = [
  { pluginId: "synthstudio.tape-sat", params: { drive: 0.4, mix: 0.8 }, bypassed: false },
  { pluginId: "synthstudio.width", params: { width: 1.2 }, bypassed: false },
];

describe("v3.47 — exportPresetAsJson liefert valides Schema", () => {
  it("Single-Envelope mit korrektem Schema-Tag + Preset-Inhalt", () => {
    const id = addPluginChainPreset("Share Test", sampleSlots);
    expect(id).toBeTruthy();
    const json = exportPresetAsJson(id!);
    expect(json.length).toBeGreaterThan(0);
    const parsed = JSON.parse(json);
    expect(parsed.schema).toBe(PRESET_EXPORT_SCHEMA);
    expect(parsed.preset).toBeDefined();
    expect(parsed.preset.name).toBe("Share Test");
    expect(parsed.preset.slots).toHaveLength(2);
    expect(parsed.preset.slots[0].pluginId).toBe("synthstudio.tape-sat");
    expect(parsed.preset.slots[0].params.drive).toBe(0.4);
  });

  it("liefert '' bei unbekannter ID (defensive)", () => {
    const json = exportPresetAsJson("nonexistent-id");
    expect(json).toBe("");
  });

  it("Bundle-Export enthält alle Presets (Built-Ins + User)", () => {
    addPluginChainPreset("User One", sampleSlots);
    addPluginChainPreset("User Two", sampleSlots);
    const json = exportAllPresetsAsJson();
    const parsed = JSON.parse(json);
    expect(parsed.schema).toBe(PRESET_BUNDLE_SCHEMA);
    expect(Array.isArray(parsed.presets)).toBe(true);
    // 3 Built-Ins + 2 User
    expect(parsed.presets).toHaveLength(5);
    const names = parsed.presets.map((p: { name: string }) => p.name);
    expect(names).toContain("User One");
    expect(names).toContain("User Two");
    expect(names).toContain("Tape-Warmth");
  });
});

describe("v3.47 — importPresetFromJson + Dedup", () => {
  it("importiert Single-Envelope + erzeugt neuen Preset-Eintrag", () => {
    const envelope = {
      schema: PRESET_EXPORT_SCHEMA,
      preset: {
        id: "external-id-123",
        name: "Imported Chain",
        createdAt: 1700000000000,
        slots: sampleSlots,
      },
    };
    const result = importPresetFromJson(JSON.stringify(envelope));
    expect(result.success).toBe(true);
    expect(result.importedIds).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
    const preset = getPluginChainPresetById(result.importedIds[0]);
    expect(preset).toBeDefined();
    expect(preset!.name).toBe("Imported Chain");
    expect(preset!.slots).toHaveLength(2);
  });

  it("dedupliziert identische Chains (gleicher Name + slot-hash)", () => {
    // 1. Import
    const envelope = {
      schema: PRESET_EXPORT_SCHEMA,
      preset: {
        id: "x",
        name: "Dup Test",
        createdAt: 1,
        slots: sampleSlots,
      },
    };
    const r1 = importPresetFromJson(JSON.stringify(envelope));
    expect(r1.success).toBe(true);

    // 2. erneuter Import → Dedup
    const r2 = importPresetFromJson(JSON.stringify(envelope));
    expect(r2.duplicatesSkipped).toBe(1);
    expect(r2.importedIds).toHaveLength(0);
    expect(r2.success).toBe(false);

    // Nur 1 User-Preset im Store (+ 3 Built-Ins = 4 gesamt)
    const all = getPluginChainPresets();
    const userOnes = all.filter((p) => !p.builtIn);
    expect(userOnes).toHaveLength(1);
  });

  it("Bundle-Envelope importiert alle Presets", () => {
    const bundle = {
      schema: PRESET_BUNDLE_SCHEMA,
      presets: [
        {
          id: "a",
          name: "Bundle-A",
          createdAt: 1,
          slots: [{ pluginId: "synthstudio.notch", params: { frequency: 200, q: 2, mix: 1 } }],
        },
        {
          id: "b",
          name: "Bundle-B",
          createdAt: 2,
          slots: [{ pluginId: "synthstudio.width", params: { width: 1.5 } }],
        },
      ],
    };
    const result = importPresetFromJson(JSON.stringify(bundle));
    expect(result.success).toBe(true);
    expect(result.importedIds).toHaveLength(2);
  });
});

describe("v3.47 — Missing-Plugin Handling", () => {
  it("importiert auch bei fehlendem Plugin — warnings statt errors", () => {
    const envelope = {
      schema: PRESET_EXPORT_SCHEMA,
      preset: {
        id: "x",
        name: "Has Missing",
        createdAt: 1,
        slots: [
          { pluginId: "synthstudio.tape-sat", params: { drive: 0.5 } },
          // Diese Plugin-ID ist nicht in der Registry → warning, kein error
          { pluginId: "thirdparty.unknown-plugin-v99", params: { foo: 1 } },
        ],
      },
    };
    const result = importPresetFromJson(JSON.stringify(envelope));
    expect(result.success).toBe(true);
    expect(result.importedIds).toHaveLength(1);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(
      result.warnings.some((w) => w.includes("thirdparty.unknown-plugin-v99")),
    ).toBe(true);
    // Slot bleibt im Preset — User entscheidet später was damit passiert
    const preset = getPluginChainPresetById(result.importedIds[0]);
    expect(preset!.slots).toHaveLength(2);
  });
});

describe("v3.47 — Schema-Validation", () => {
  it("rejected unbekanntes Schema mit clean error", () => {
    const bad = {
      schema: "some-other-app-v3",
      preset: { id: "x", name: "fake", createdAt: 0, slots: [] },
    };
    const result = importPresetFromJson(JSON.stringify(bad));
    expect(result.success).toBe(false);
    expect(result.importedIds).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/schema/i);
  });

  it("rejected nicht-JSON Input", () => {
    const result = importPresetFromJson("not a json string {");
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatch(/Parse-Fehler|JSON/);
  });

  it("rejected Envelope ohne preset/presets-Feld", () => {
    const r1 = importPresetFromJson(
      JSON.stringify({ schema: PRESET_EXPORT_SCHEMA }),
    );
    expect(r1.success).toBe(false);
    const r2 = importPresetFromJson(
      JSON.stringify({ schema: PRESET_BUNDLE_SCHEMA }),
    );
    expect(r2.success).toBe(false);
  });
});

describe("v3.47 — Round-Trip: export → import → identical content", () => {
  it("Round-Trip preserves slot-content exact (params + pluginId)", () => {
    const originalSlots: MixerPluginSlot[] = [
      { pluginId: "synthstudio.tape-sat", params: { drive: 0.77, mix: 0.42 }, bypassed: true },
      { pluginId: "synthstudio.notch", params: { frequency: 4321, q: 7.5, mix: 0.6 } },
    ];
    const id = addPluginChainPreset("Round Trip", originalSlots);
    const json = exportPresetAsJson(id!);

    // Store leeren
    __resetPluginChainPresetStoreForTests();
    expect(
      getPluginChainPresets().filter((p) => !p.builtIn),
    ).toHaveLength(0);

    // Re-Import
    const result = importPresetFromJson(json);
    expect(result.success).toBe(true);
    const reImported = getPluginChainPresetById(result.importedIds[0]);
    expect(reImported).toBeDefined();
    expect(reImported!.name).toBe("Round Trip");
    expect(reImported!.slots).toHaveLength(2);
    expect(reImported!.slots[0].pluginId).toBe("synthstudio.tape-sat");
    expect(reImported!.slots[0].params.drive).toBe(0.77);
    expect(reImported!.slots[0].params.mix).toBe(0.42);
    expect(reImported!.slots[0].bypassed).toBe(true);
    expect(reImported!.slots[1].pluginId).toBe("synthstudio.notch");
    expect(reImported!.slots[1].params.frequency).toBe(4321);

    // hashPresetSlots ist stable
    expect(hashPresetSlots(reImported!.slots)).toBe(hashPresetSlots(originalSlots));
  });

  it("Bundle Round-Trip: export-all → reset → import → User-Presets restored", () => {
    addPluginChainPreset("UA", sampleSlots);
    addPluginChainPreset("UB", sampleSlots);
    const json = exportAllPresetsAsJson();

    __resetPluginChainPresetStoreForTests();
    const result = importPresetFromJson(json);
    expect(result.success).toBe(true);

    // 3 Built-Ins werden beim Bundle als User-Variante importiert ("(imported)")
    // 2 User-Presets werden neu importiert. → 5 imported, 3 als "(imported)"
    const all = getPluginChainPresets();
    const names = all.map((p) => p.name);
    expect(names).toContain("UA");
    expect(names).toContain("UB");
    // Built-Ins selbst bleiben in der Code-Registry — wir prüfen dass die
    // imported "(imported)"-Variante existiert
    expect(names.some((n) => n.includes("(imported)"))).toBe(true);
  });
});

describe("v3.47 — Drag-Drop Routing", () => {
  it(".synthpreset.json wird als 'plugin-preset' erkannt", () => {
    expect(detectFileType("my-chain.synthpreset.json")).toBe("plugin-preset");
    expect(detectFileType("backup-2026.synthpreset.json")).toBe("plugin-preset");
    // Normales .json bleibt unknown (kein false-positive)
    expect(detectFileType("foo.json")).toBe("unknown");
  });

  it("dispatchFileDrop für .synthpreset.json feuert 'plugin-preset:import'", () => {
    const received: { type: string; detail: unknown }[] = [];
    const handler = (e: Event) => {
      received.push({ type: e.type, detail: (e as CustomEvent).detail });
    };
    window.addEventListener("plugin-preset:import", handler);
    try {
      const fakeFile = { name: "preset.synthpreset.json" };
      const result = dispatchFileDrop(fakeFile);
      expect(result.handled).toBe(true);
      expect(result.type).toBe("plugin-preset");
      expect(received).toHaveLength(1);
      expect(received[0].type).toBe("plugin-preset:import");
    } finally {
      window.removeEventListener("plugin-preset:import", handler);
    }
  });
});

describe("v3.47 — hashPresetSlots (Dedup-Helper)", () => {
  it("identische Slots liefern identischen Hash", () => {
    const a: MixerPluginSlot[] = [
      { pluginId: "synthstudio.tape-sat", params: { drive: 0.5, mix: 1 } },
    ];
    const b: MixerPluginSlot[] = [
      { pluginId: "synthstudio.tape-sat", params: { mix: 1, drive: 0.5 } },
    ];
    expect(hashPresetSlots(a)).toBe(hashPresetSlots(b));
  });

  it("unterschiedliche Param-Werte → unterschiedlicher Hash", () => {
    const a: MixerPluginSlot[] = [
      { pluginId: "synthstudio.tape-sat", params: { drive: 0.5 } },
    ];
    const b: MixerPluginSlot[] = [
      { pluginId: "synthstudio.tape-sat", params: { drive: 0.6 } },
    ];
    expect(hashPresetSlots(a)).not.toBe(hashPresetSlots(b));
  });

  it("Reihenfolge der Slots ist signifikant", () => {
    const slot1: MixerPluginSlot = { pluginId: "a", params: {} };
    const slot2: MixerPluginSlot = { pluginId: "b", params: {} };
    expect(hashPresetSlots([slot1, slot2])).not.toBe(
      hashPresetSlots([slot2, slot1]),
    );
  });
});
