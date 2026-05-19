/**
 * tests/features/sub-mix-bus-midi.test.ts (v3.81.0)
 *
 * Unit-Tests für Sub-Mix-Bus MIDI-Learn + Color-Picker (closes v3.80 Caveat
 * "kein MIDI-Learn auf Bus-Controls").
 *
 * Test-Cluster:
 *  (1) MidiLearnTarget-Union enthält die 4 neuen Bus-Targets
 *  (2) targetsMatch + findMappingForTarget arbeiten korrekt mit Bus-IDs
 *  (3) labelForTarget liefert sinnvolle Labels (busName-Fallback auf busId-Slice)
 *  (4) VALID_TARGET_TYPES enthält alle 4 Targets (Layout-Import-Path)
 *  (5) MIDI-Event-Bridge: subMixBusVolume/Pan-Events mappen auf Store-Setter,
 *      Mute/Solo togglen den Store (auch wenn Bus mit solo/mute=true bereits)
 *  (6) Color-Picker: setBusColor mit valid/invalid/undefined-Hex
 *
 * 12 Tests in 6 describes. env:node mit localStorage-Mock — kein jsdom-Render
 * nötig, da die UI-Komponente onContextMenu/onClick 1:1 an Store-Setter und
 * MIDI-CustomEvents durchreicht.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── localStorage + window-Mocks ─────────────────────────────────────────────

function createLocalStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string): string | null => store[k] ?? null,
    setItem: (k: string, v: string): void => { store[k] = v; },
    removeItem: (k: string): void => { delete store[k]; },
    clear: (): void => { store = {}; },
  };
}

const localStorageMock = createLocalStorageMock();
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

// Minimal window-Stub (für CustomEvent + dispatchEvent / addEventListener).
// Wir nutzen den nativen EventTarget-Konstruktor (Node-built-in) als Backbone.
class TestEventTarget extends EventTarget {
  confirm = (): boolean => true;
  // localStorage-Bridge damit Store-Persistenz funktioniert
  get localStorage() { return localStorageMock; }
}
const winStub = new TestEventTarget();
Object.defineProperty(globalThis, "window", {
  value: winStub,
  writable: true,
  configurable: true,
});

// ─── Dynamische Imports ──────────────────────────────────────────────────────

let storeModule: typeof import("../../client/src/store/useSubMixStore");
let midiModule:  typeof import("../../client/src/hooks/useMidi");
let layoutModule: typeof import("../../client/src/utils/midiLayoutImport");
let bridgeModule: typeof import("../../client/src/hooks/useMidiEventBridge");

beforeEach(async () => {
  vi.resetModules();
  localStorageMock.clear();
  storeModule  = await import("../../client/src/store/useSubMixStore");
  midiModule   = await import("../../client/src/hooks/useMidi");
  layoutModule = await import("../../client/src/utils/midiLayoutImport");
  bridgeModule = await import("../../client/src/hooks/useMidiEventBridge");
  storeModule.__resetSubMixStoreForTests();
});

// ─── (1) Targets-Union + (2) targetsMatch ────────────────────────────────────

describe("subMixBus* MidiLearnTarget — Identität & Matching", () => {
  it("targetsMatch: gleicher busId & gleicher type → match", () => {
    const a: import("../../client/src/hooks/useMidi").MidiLearnTarget = {
      type: "subMixBusVolume", busId: "bus-1",
    };
    const b: import("../../client/src/hooks/useMidi").MidiLearnTarget = {
      type: "subMixBusVolume", busId: "bus-1", busName: "Drums",
    };
    expect(midiModule.targetsMatch(a, b)).toBe(true);
  });

  it("targetsMatch: unterschiedlicher busId → no match", () => {
    const a: import("../../client/src/hooks/useMidi").MidiLearnTarget = {
      type: "subMixBusMute", busId: "bus-1",
    };
    const b: import("../../client/src/hooks/useMidi").MidiLearnTarget = {
      type: "subMixBusMute", busId: "bus-2",
    };
    expect(midiModule.targetsMatch(a, b)).toBe(false);
  });

  it("targetsMatch: unterschiedlicher type (volume vs mute) → no match", () => {
    expect(midiModule.targetsMatch(
      { type: "subMixBusVolume", busId: "x" },
      { type: "subMixBusMute",   busId: "x" },
    )).toBe(false);
  });

  it("findMappingForTarget findet das Bus-Mapping über alle 4 Sub-Targets", () => {
    const mappings = [
      { cc: 20, channel: 0, target: { type: "subMixBusVolume" as const, busId: "bus-A" }, label: "Vol A" },
      { cc: 21, channel: 0, target: { type: "subMixBusPan"    as const, busId: "bus-A" }, label: "Pan A" },
      { cc: 22, channel: 0, target: { type: "subMixBusMute"   as const, busId: "bus-A" }, label: "Mute A" },
      { cc: 23, channel: 0, target: { type: "subMixBusSolo"   as const, busId: "bus-A" }, label: "Solo A" },
    ];
    const hit = midiModule.findMappingForTarget(mappings, { type: "subMixBusVolume", busId: "bus-A" });
    expect(hit?.cc).toBe(20);
    const hit2 = midiModule.findMappingForTarget(mappings, { type: "subMixBusSolo", busId: "bus-A" });
    expect(hit2?.cc).toBe(23);
  });
});

// ─── (3) labelForTarget ──────────────────────────────────────────────────────

describe("labelForTarget für subMixBus*-Targets", () => {
  it("liefert busName wenn vorhanden", () => {
    expect(midiModule.labelForTarget({
      type: "subMixBusVolume", busId: "abc123def", busName: "Drums Bus",
    })).toBe("Bus Volume: Drums Bus");
    expect(midiModule.labelForTarget({
      type: "subMixBusMute", busId: "abc123def", busName: "Drums Bus",
    })).toBe("Bus Mute: Drums Bus");
  });

  it("fällt auf busId-Slice zurück wenn busName fehlt", () => {
    expect(midiModule.labelForTarget({
      type: "subMixBusPan", busId: "abcdef12345",
    })).toBe("Bus Pan: abcdef12");
  });
});

// ─── (4) Layout-Import VALID_TARGET_TYPES ────────────────────────────────────

describe("midiLayoutImport.VALID_TARGET_TYPES — Sub-Mix-Bus", () => {
  it("enthält alle 4 neuen Sub-Mix-Bus-Targets", () => {
    expect(layoutModule.VALID_TARGET_TYPES.has("subMixBusVolume")).toBe(true);
    expect(layoutModule.VALID_TARGET_TYPES.has("subMixBusPan")).toBe(true);
    expect(layoutModule.VALID_TARGET_TYPES.has("subMixBusMute")).toBe(true);
    expect(layoutModule.VALID_TARGET_TYPES.has("subMixBusSolo")).toBe(true);
  });

  it("Layout-Import akzeptiert subMixBusVolume-Mapping", () => {
    const json = JSON.stringify({
      synthstudioLayout: "v1",
      name: "Test",
      ccMappings: [{
        cc: 10, channel: 0,
        target: { type: "subMixBusVolume", busId: "bus-A", busName: "Drums" },
        label: "Bus Vol",
      }],
    });
    const result = layoutModule.parseMidiLayoutJson(json);
    expect(result.ok).toBe(true);
    expect(result.layout!.ccMappings).toHaveLength(1);
    expect(result.layout!.ccMappings[0].target).toEqual({
      type: "subMixBusVolume", busId: "bus-A", busName: "Drums",
    });
  });
});

// ─── (5) Event-Bridge: subMixBus*-CustomEvents → Store-Setter ────────────────

describe("MidiEventBridge — subMixBus*-Handler bindet auf Store", () => {
  function makeRefs() {
    // Minimal-Refs — Bus-Handler nutzen sie nicht, aber das Interface verlangt sie.
    return {
      dmRef: { current: {
        setPartVolume: () => {}, setPartPan: () => {},
        setPartSoloed: () => {}, setPartMuted: () => {},
        setPartFx: () => {}, setActivePattern: () => {},
        getActivePattern: () => undefined, patterns: [],
      } } as any,
      projectRef: { current: {
        setBpm: () => {}, togglePlayStop: () => {}, isPlaying: false,
      } } as any,
      audioEngine: { setMasterVolume: () => {} },
    };
  }

  it("subMixBusVolume CC bindet → setBusVolume mit linear-scalierter Value", () => {
    const id = storeModule.createBus("Drums")!;
    const handlers = bridgeModule.makeMidiBridgeHandlers(makeRefs());
    // 127 → 2.0 (max), 64 → ~1.0, 0 → 0
    handlers.handleSubMixBusVolume(
      new CustomEvent("midi:subMixBusVolume", { detail: { busId: id, value: 2.0 } }),
    );
    expect(storeModule.getBusById(id)!.volume).toBe(2);

    handlers.handleSubMixBusVolume(
      new CustomEvent("midi:subMixBusVolume", { detail: { busId: id, value: 0.5 } }),
    );
    expect(storeModule.getBusById(id)!.volume).toBeCloseTo(0.5, 5);
  });

  it("subMixBusMute toggelt via CC-Event (false → true → false)", () => {
    const id = storeModule.createBus("Drums")!;
    expect(storeModule.getBusById(id)!.mute).toBe(false);

    const handlers = bridgeModule.makeMidiBridgeHandlers(makeRefs());
    handlers.handleSubMixBusMute(new CustomEvent("midi:subMixBusMute", { detail: id }));
    expect(storeModule.getBusById(id)!.mute).toBe(true);

    handlers.handleSubMixBusMute(new CustomEvent("midi:subMixBusMute", { detail: id }));
    expect(storeModule.getBusById(id)!.mute).toBe(false);
  });

  it("subMixBusSolo toggelt korrekt", () => {
    const id = storeModule.createBus("Drums")!;
    const handlers = bridgeModule.makeMidiBridgeHandlers(makeRefs());
    handlers.handleSubMixBusSolo(new CustomEvent("midi:subMixBusSolo", { detail: id }));
    expect(storeModule.getBusById(id)!.solo).toBe(true);
  });

  it("subMixBusPan setzt pan im -1..+1 Range (defensive bei NaN)", () => {
    const id = storeModule.createBus("Drums")!;
    const handlers = bridgeModule.makeMidiBridgeHandlers(makeRefs());
    handlers.handleSubMixBusPan(
      new CustomEvent("midi:subMixBusPan", { detail: { busId: id, value: -0.5 } }),
    );
    expect(storeModule.getBusById(id)!.pan).toBeCloseTo(-0.5, 5);

    // NaN → silent no-op (kein crash, kein Mutation)
    handlers.handleSubMixBusPan(
      new CustomEvent("midi:subMixBusPan", { detail: { busId: id, value: NaN } }),
    );
    expect(storeModule.getBusById(id)!.pan).toBeCloseTo(-0.5, 5);
  });

  it("subMixBusMute/Solo no-op bei unbekanntem busId (defensive)", () => {
    const id = storeModule.createBus("Drums")!;
    const before = storeModule.getBusById(id)!;
    const handlers = bridgeModule.makeMidiBridgeHandlers(makeRefs());
    handlers.handleSubMixBusMute(new CustomEvent("midi:subMixBusMute", { detail: "ghost-id" }));
    handlers.handleSubMixBusSolo(new CustomEvent("midi:subMixBusSolo", { detail: "ghost-id" }));
    // bus-1 bleibt unverändert
    const after = storeModule.getBusById(id)!;
    expect(after.mute).toBe(before.mute);
    expect(after.solo).toBe(before.solo);
  });
});

// ─── (6) Color-Picker → setBusColor ─────────────────────────────────────────

describe("setBusColor — Color-Picker-Mount-Pfad", () => {
  it("Color-Picker setzt setBusColor mit valider Hex (lowercased)", () => {
    const id = storeModule.createBus("Drums")!;
    storeModule.setBusColor(id, "#A855F7");
    expect(storeModule.getBusById(id)!.color).toBe("#a855f7");
  });

  it("Color-Picker Reset (undefined) entfernt color-Feld komplett", () => {
    const id = storeModule.createBus("Drums")!;
    storeModule.setBusColor(id, "#22c55e");
    expect(storeModule.getBusById(id)!.color).toBe("#22c55e");
    storeModule.setBusColor(id, undefined);
    expect(storeModule.getBusById(id)!.color).toBeUndefined();
  });

  it("Color-Picker invalider Hex bleibt no-op (silent reject)", () => {
    const id = storeModule.createBus("Drums")!;
    storeModule.setBusColor(id, "#22c55e");
    storeModule.setBusColor(id, "not-a-hex");
    // bleibt der valide Wert von vorher
    expect(storeModule.getBusById(id)!.color).toBe("#22c55e");
  });
});
