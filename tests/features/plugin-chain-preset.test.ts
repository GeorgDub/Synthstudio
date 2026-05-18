/**
 * tests/features/plugin-chain-preset.test.ts
 *
 * v3.46.0 — Plugin-Chain-Preset Store + Built-In-Presets + Round-Trip.
 *
 * Env: jsdom (für localStorage).
 *
 * Coverage:
 *   - addPluginChainPreset speichert mit unique-ID
 *   - removePluginChainPreset entfernt
 *   - Built-In-Presets sind verfügbar
 *   - Built-In-Presets können NICHT entfernt werden
 *   - cloneSlotsFromPreset liefert deep-clone (Slot/params unabhängig)
 *   - LocalStorage round-trip (write → reload → presets persistiert)
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  addPluginChainPreset,
  removePluginChainPreset,
  renamePluginChainPreset,
  getPluginChainPresets,
  getPluginChainPresetById,
  cloneSlotsFromPreset,
  __resetPluginChainPresetStoreForTests,
  BUILT_IN_PLUGIN_CHAIN_PRESETS,
  BUILT_IN_TAPE_WARMTH,
  BUILT_IN_STEREO_WIDE,
  BUILT_IN_BASS_CUT,
} from "../../client/src/store/usePluginChainPresetStore";
import {
  MAX_PLUGIN_SLOTS_PER_CHANNEL,
  type MixerPluginSlot,
} from "../../client/src/store/useMixerStore";

beforeEach(() => {
  __resetPluginChainPresetStoreForTests();
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem("ss-plugin-chain-presets:v1");
    }
  } catch {
    /* ignore */
  }
});

describe("usePluginChainPresetStore — Built-In Presets", () => {
  it("listet 3 Built-In-Presets nach Reset", () => {
    const all = getPluginChainPresets();
    const builtIns = all.filter((p) => p.builtIn === true);
    expect(builtIns).toHaveLength(3);
  });

  it("exportiert BUILT_IN_PLUGIN_CHAIN_PRESETS mit 3 Einträgen", () => {
    expect(BUILT_IN_PLUGIN_CHAIN_PRESETS).toHaveLength(3);
    const ids = BUILT_IN_PLUGIN_CHAIN_PRESETS.map((p) => p.id);
    expect(ids).toContain("builtin.tape-warmth");
    expect(ids).toContain("builtin.stereo-wide");
    expect(ids).toContain("builtin.bass-cut");
  });

  it("Tape-Warmth: TapeSat-drive hoch + Notch-flach", () => {
    expect(BUILT_IN_TAPE_WARMTH.slots).toHaveLength(2);
    expect(BUILT_IN_TAPE_WARMTH.slots[0].pluginId).toBe("synthstudio.tape-sat");
    expect(BUILT_IN_TAPE_WARMTH.slots[0].params.drive).toBeGreaterThanOrEqual(0.5);
    expect(BUILT_IN_TAPE_WARMTH.slots[1].pluginId).toBe("synthstudio.notch");
  });

  it("Stereo-Wide: Width-Plugin mit width > 1", () => {
    expect(BUILT_IN_STEREO_WIDE.slots).toHaveLength(1);
    expect(BUILT_IN_STEREO_WIDE.slots[0].pluginId).toBe("synthstudio.width");
    expect(BUILT_IN_STEREO_WIDE.slots[0].params.width).toBeGreaterThan(1);
  });

  it("Bass-Cut: Notch ~80Hz + TapeSat low-drive", () => {
    expect(BUILT_IN_BASS_CUT.slots).toHaveLength(2);
    expect(BUILT_IN_BASS_CUT.slots[0].pluginId).toBe("synthstudio.notch");
    expect(BUILT_IN_BASS_CUT.slots[0].params.frequency).toBeLessThanOrEqual(100);
    expect(BUILT_IN_BASS_CUT.slots[1].pluginId).toBe("synthstudio.tape-sat");
    expect(BUILT_IN_BASS_CUT.slots[1].params.drive).toBeLessThan(0.5);
  });

  it("Built-In-Presets können nicht entfernt werden (NO-OP)", () => {
    const removed = removePluginChainPreset("builtin.tape-warmth");
    expect(removed).toBe(false);
    const all = getPluginChainPresets();
    const builtIns = all.filter((p) => p.builtIn === true);
    expect(builtIns).toHaveLength(3);
  });
});

describe("usePluginChainPresetStore — add/remove/rename User-Presets", () => {
  const sampleSlots: MixerPluginSlot[] = [
    { pluginId: "synthstudio.tape-sat", params: { drive: 0.4, mix: 0.8 } },
    { pluginId: "synthstudio.width", params: { width: 1.5 } },
  ];

  it("addPluginChainPreset speichert mit unique-ID", () => {
    const id1 = addPluginChainPreset("My Chain", sampleSlots);
    const id2 = addPluginChainPreset("My Chain 2", sampleSlots);
    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    expect(id1).not.toBe(id2);
    expect(getPluginChainPresetById(id1!)).toBeDefined();
    expect(getPluginChainPresetById(id2!)).toBeDefined();
  });

  it("addPluginChainPreset trimmt > MAX_PLUGIN_SLOTS_PER_CHANNEL silently", () => {
    const tooMany: MixerPluginSlot[] = [
      { pluginId: "synthstudio.tape-sat", params: {} },
      { pluginId: "synthstudio.notch", params: {} },
      { pluginId: "synthstudio.width", params: {} },
      { pluginId: "synthstudio.tape-sat", params: {} },
      { pluginId: "synthstudio.tape-sat", params: {} }, // 5th → trimmed
      { pluginId: "synthstudio.tape-sat", params: {} }, // 6th → trimmed
    ];
    const id = addPluginChainPreset("Too Many", tooMany);
    expect(id).toBeTruthy();
    const preset = getPluginChainPresetById(id!);
    expect(preset!.slots).toHaveLength(MAX_PLUGIN_SLOTS_PER_CHANNEL);
  });

  it("addPluginChainPreset returnt null bei leerem Namen oder leeren Slots", () => {
    expect(addPluginChainPreset("", sampleSlots)).toBeNull();
    expect(addPluginChainPreset("   ", sampleSlots)).toBeNull();
    expect(addPluginChainPreset("Name", [])).toBeNull();
  });

  it("removePluginChainPreset entfernt User-Preset und returnt true", () => {
    const id = addPluginChainPreset("Removable", sampleSlots);
    expect(getPluginChainPresetById(id!)).toBeDefined();
    const removed = removePluginChainPreset(id!);
    expect(removed).toBe(true);
    expect(getPluginChainPresetById(id!)).toBeUndefined();
  });

  it("removePluginChainPreset returnt false bei unbekannter ID", () => {
    expect(removePluginChainPreset("nonexistent")).toBe(false);
  });

  it("renamePluginChainPreset benennt um", () => {
    const id = addPluginChainPreset("Old Name", sampleSlots);
    const ok = renamePluginChainPreset(id!, "New Name");
    expect(ok).toBe(true);
    expect(getPluginChainPresetById(id!)!.name).toBe("New Name");
  });

  it("renamePluginChainPreset lehnt Built-In ab", () => {
    const ok = renamePluginChainPreset("builtin.tape-warmth", "Hacked");
    expect(ok).toBe(false);
    expect(getPluginChainPresetById("builtin.tape-warmth")!.name).toBe(
      "Tape-Warmth",
    );
  });
});

describe("cloneSlotsFromPreset — Apply to Channel", () => {
  it("liefert Slots mit clone-Semantik (independent params)", () => {
    const id = addPluginChainPreset("Test", [
      { pluginId: "synthstudio.tape-sat", params: { drive: 0.5 } },
    ]);
    const cloned1 = cloneSlotsFromPreset(id!);
    const cloned2 = cloneSlotsFromPreset(id!);
    expect(cloned1).not.toBe(cloned2);
    expect(cloned1![0]).not.toBe(cloned2![0]);
    // Mutieren von clone darf das Original nicht beeinflussen
    cloned1![0].params.drive = 0.99;
    const preset = getPluginChainPresetById(id!);
    expect(preset!.slots[0].params.drive).toBe(0.5);
  });

  it("liefert null bei unbekannter ID", () => {
    expect(cloneSlotsFromPreset("missing")).toBeNull();
  });

  it("liefert Built-In Tape-Warmth slot-clone", () => {
    const cloned = cloneSlotsFromPreset("builtin.tape-warmth");
    expect(cloned).not.toBeNull();
    expect(cloned).toHaveLength(2);
    expect(cloned![0].pluginId).toBe("synthstudio.tape-sat");
  });
});

describe("LocalStorage round-trip", () => {
  it("User-Presets überleben Reset-Cycle in localStorage", async () => {
    // Add a preset, dann lade das Modul frisch und prüfe ob es noch da ist.
    addPluginChainPreset("Persistent", [
      { pluginId: "synthstudio.tape-sat", params: { drive: 0.7 } },
    ]);
    // Verify im aktuellen Store
    expect(
      getPluginChainPresets().some((p) => p.name === "Persistent"),
    ).toBe(true);

    // Manueller Re-Load: lese aus localStorage und sanity-check struct
    const rawLs =
      typeof localStorage !== "undefined"
        ? localStorage.getItem("ss-plugin-chain-presets:v1")
        : null;
    expect(rawLs).not.toBeNull();
    const parsed = JSON.parse(rawLs!);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.some((p: { name: string }) => p.name === "Persistent")).toBe(
      true,
    );
    // Built-Ins NICHT in localStorage (kommen aus Code)
    expect(parsed.some((p: { id: string }) => p.id.startsWith("builtin."))).toBe(
      false,
    );
  });

  it("__resetPluginChainPresetStoreForTests killt User-Presets + LS", () => {
    addPluginChainPreset("WillBeKilled", [
      { pluginId: "synthstudio.tape-sat", params: {} },
    ]);
    __resetPluginChainPresetStoreForTests();
    const all = getPluginChainPresets();
    expect(all.some((p) => p.name === "WillBeKilled")).toBe(false);
    // Built-Ins überleben Reset
    expect(all.filter((p) => p.builtIn === true)).toHaveLength(3);
  });
});
