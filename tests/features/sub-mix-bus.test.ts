/**
 * tests/features/sub-mix-bus.test.ts (v3.79.0)
 *
 * Unit-Tests für Sub-Mix-Buses (Channel-Grouping mit shared FX).
 * 100. Release. Closes v3.78-Caveat "kein Bus-of-Channels".
 *
 * Test-Cluster:
 *  (1) Store: createBus + assignChannelToBus + Defaults + Clamping
 *  (2) Channel-Assignment + Re-Assignment (Auto-Unassign)
 *  (3) Bus-Volume/Mute/Solo wirkt auf alle Members (Helpers)
 *  (4) MAX_SUB_MIX_BUSES enforced
 *  (5) Schema v1.32 Project Round-Trip
 *  (6) Channel ohne Bus default zu master
 *
 * 11 Tests in 6 describes.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── localStorage-Mock ────────────────────────────────────────────────────────

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
if (typeof (globalThis as { window?: unknown }).window === "undefined") {
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: localStorageMock },
    writable: true,
    configurable: true,
  });
}

// ─── Dynamische Imports (NACH Mock-Setup) ─────────────────────────────────────

let storeModule: typeof import("../../client/src/store/useSubMixStore");
let serializer: typeof import("../../client/src/utils/projectSerializer");

beforeEach(async () => {
  vi.resetModules();
  localStorageMock.clear();
  storeModule = await import("../../client/src/store/useSubMixStore");
  serializer = await import("../../client/src/utils/projectSerializer");
  storeModule.__resetSubMixStoreForTests();
});

// ─── (1) Store: createBus + assignChannelToBus + Defaults ────────────────────

describe("useSubMixStore — createBus + Defaults", () => {
  it("createBus liefert eine neue ID und appendet Bus mit Defaults", () => {
    const id = storeModule.createBus("Drums");
    expect(id).toBeTruthy();
    const buses = storeModule.getBuses();
    expect(buses).toHaveLength(1);
    const b = buses[0];
    expect(b.id).toBe(id);
    expect(b.name).toBe("Drums");
    expect(b.volume).toBe(0.85);
    expect(b.pan).toBe(0);
    expect(b.mute).toBe(false);
    expect(b.solo).toBe(false);
    expect(b.channelIds).toEqual([]);
  });

  it("renameBus + setBusVolume + setBusPan clampen + persistieren", () => {
    const id = storeModule.createBus("X")!;
    storeModule.renameBus(id, "  Bass  ");
    expect(storeModule.getBusById(id)!.name).toBe("Bass");

    storeModule.setBusVolume(id, 5); // overclamp
    expect(storeModule.getBusById(id)!.volume).toBe(2);
    storeModule.setBusVolume(id, -1);
    expect(storeModule.getBusById(id)!.volume).toBe(0);
    storeModule.setBusVolume(id, 1.2);
    expect(storeModule.getBusById(id)!.volume).toBe(1.2);

    storeModule.setBusPan(id, 5);
    expect(storeModule.getBusById(id)!.pan).toBe(1);
    storeModule.setBusPan(id, -2);
    expect(storeModule.getBusById(id)!.pan).toBe(-1);

    const raw = localStorageMock.getItem("synthstudio:sub-mix:v1");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.buses[0].name).toBe("Bass");
    expect(parsed.buses[0].volume).toBe(1.2);
  });
});

// ─── (2) Channel-Assignment + Re-Assignment ──────────────────────────────────

describe("useSubMixStore — assignChannelToBus", () => {
  it("assignChannelToBus fügt einen partId in den Bus", () => {
    const id = storeModule.createBus("Drums")!;
    storeModule.assignChannelToBus(id, "kick");
    storeModule.assignChannelToBus(id, "snare");
    const b = storeModule.getBusById(id)!;
    expect(b.channelIds).toEqual(["kick", "snare"]);
    // getBusForChannel lookup
    expect(storeModule.getBusForChannel("kick")!.id).toBe(id);
    expect(storeModule.getBusForChannel("unknown")).toBeUndefined();
  });

  it("Re-Assignment entfernt den Channel automatisch aus anderem Bus", () => {
    const a = storeModule.createBus("Drums")!;
    const b = storeModule.createBus("FX")!;
    storeModule.assignChannelToBus(a, "kick");
    expect(storeModule.getBusById(a)!.channelIds).toEqual(["kick"]);
    storeModule.assignChannelToBus(b, "kick");
    expect(storeModule.getBusById(a)!.channelIds).toEqual([]);
    expect(storeModule.getBusById(b)!.channelIds).toEqual(["kick"]);
  });

  it("unassignChannel entfernt den Channel aus allen Buses (default → master)", () => {
    const id = storeModule.createBus("Drums")!;
    storeModule.assignChannelToBus(id, "kick");
    storeModule.assignChannelToBus(id, "snare");
    storeModule.unassignChannel("kick");
    const b = storeModule.getBusById(id)!;
    expect(b.channelIds).toEqual(["snare"]);
    expect(storeModule.getBusForChannel("kick")).toBeUndefined();
  });
});

// ─── (3) Bus-Volume/Mute/Solo Helpers ────────────────────────────────────────

describe("useSubMixStore — Volume/Mute/Solo wirkt auf alle Members", () => {
  it("setBusVolume / setBusMute wirken state-level (Engine wendet pro Member an)", () => {
    const id = storeModule.createBus("Drums")!;
    storeModule.assignChannelToBus(id, "kick");
    storeModule.assignChannelToBus(id, "snare");
    storeModule.setBusVolume(id, 0.5);
    storeModule.setBusMute(id, true);
    const b = storeModule.getBusById(id)!;
    expect(b.volume).toBe(0.5);
    expect(b.mute).toBe(true);
    // Bus-Mute repräsentiert "gruppe stumm" — alle Members hängen am Bus-Gain.
    expect(storeModule.isBusEffectivelyMuted(id)).toBe(true);
    expect(b.channelIds).toEqual(["kick", "snare"]);
  });

  it("Bus-Solo: andere Buses werden effektiv stumm geschaltet", () => {
    const a = storeModule.createBus("Drums")!;
    const b = storeModule.createBus("Bass")!;
    storeModule.assignChannelToBus(a, "kick");
    storeModule.assignChannelToBus(b, "bass1");
    expect(storeModule.anyBusSolo()).toBe(false);
    expect(storeModule.isBusEffectivelyMuted(a)).toBe(false);
    storeModule.setBusSolo(a, true);
    expect(storeModule.anyBusSolo()).toBe(true);
    expect(storeModule.isBusEffectivelyMuted(a)).toBe(false); // self
    expect(storeModule.isBusEffectivelyMuted(b)).toBe(true);  // other
  });
});

// ─── (4) MAX_SUB_MIX_BUSES enforced ──────────────────────────────────────────

describe("useSubMixStore — MAX_SUB_MIX_BUSES enforced", () => {
  it("Max 8 Buses — createBus #9 returnt null", () => {
    const max = storeModule.MAX_SUB_MIX_BUSES;
    expect(max).toBe(8);
    for (let i = 0; i < max; i++) {
      const id = storeModule.createBus(`Bus ${i + 1}`);
      expect(id).toBeTruthy();
    }
    expect(storeModule.getBuses()).toHaveLength(max);
    const overflow = storeModule.createBus("nope");
    expect(overflow).toBeNull();
    expect(storeModule.getBuses()).toHaveLength(max);
  });

  it("removeBus erlaubt wieder neue Buses bis zum Limit", () => {
    const max = storeModule.MAX_SUB_MIX_BUSES;
    const ids: string[] = [];
    for (let i = 0; i < max; i++) ids.push(storeModule.createBus(`B${i}`)!);
    expect(storeModule.createBus("over")).toBeNull();
    storeModule.removeBus(ids[0]);
    expect(storeModule.getBuses()).toHaveLength(max - 1);
    const newId = storeModule.createBus("After");
    expect(newId).toBeTruthy();
    expect(storeModule.getBuses()).toHaveLength(max);
  });
});

// ─── (5) Schema v1.32 Round-Trip ─────────────────────────────────────────────

describe("Schema v1.33 — Project Round-Trip", () => {
  it("SYNTH_FILE_VERSION ist '1.33' (v3.86.0 Bump für SubMixBus volle FX-Chain)", () => {
    expect(serializer.SYNTH_FILE_VERSION).toBe("1.33");
  });

  it("Round-Trip: subMixBuses werden serialisiert + reparst", () => {
    const id = storeModule.createBus("Drums")!;
    storeModule.assignChannelToBus(id, "kick");
    storeModule.assignChannelToBus(id, "snare");
    storeModule.setBusVolume(id, 0.7);

    const buses = storeModule.getBuses();
    const project = serializer.serializeProject({
      projectName: "Test",
      bpm: 120,
      samples: [],
      patterns: [],
      activePatternId: "p1",
      song: { slots: [], songModeActive: false, loopSong: false },
      mixer: {
        masterVolume: 0.85,
        channels: {},
        returnTracks: {
          reverb: { id: "reverb", name: "Reverb Return", volume: 0.85, muted: false },
          delay: { id: "delay", name: "Delay Return", volume: 0.85, muted: false },
        },
        insertChains: {},
        eq16: {},
        sidechains: {},
        transientShapers: {},
      },
      humanizer: { global: { swing: 0, velocityJitter: 0, timeJitter: 0 } as unknown as never },
      automation: { lanes: [], stepCount: 16 },
      subMixBuses: buses,
    } as unknown as Parameters<typeof serializer.serializeProject>[0]);

    expect(project.version).toBe("1.33");
    expect(project.subMixBuses).toBeDefined();
    expect(project.subMixBuses!).toHaveLength(1);
    expect(project.subMixBuses![0].channelIds).toEqual(["kick", "snare"]);

    const json = serializer.toJson(project);
    const parsed = serializer.parseProject(json);
    expect(parsed.subMixBuses).toBeDefined();
    expect(parsed.subMixBuses!).toHaveLength(1);
    expect(parsed.subMixBuses![0].name).toBe("Drums");
    expect(parsed.subMixBuses![0].volume).toBe(0.7);
    expect(parsed.subMixBuses![0].channelIds).toEqual(["kick", "snare"]);
  });

  it("Pre-v1.32 File ohne subMixBuses-Feld lädt ohne Crash (undefined bleibt)", () => {
    const oldJson = JSON.stringify({
      version: "1.31",
      projectId: "11111111-2222-4333-8444-555555555555",
      projectName: "Old",
      savedAt: new Date().toISOString(),
      bpm: 120,
      samples: [],
      patterns: [{ id: "p", name: "P", stepCount: 16, stepResolution: "1/16", bpm: null, parts: [] }],
      activePatternId: "p",
      song: { slots: [], songModeActive: false, loopSong: false },
      mixer: {
        masterVolume: 0.85,
        channels: {},
        returnTracks: {
          reverb: { id: "reverb", name: "Reverb Return", volume: 0.85, muted: false },
          delay: { id: "delay", name: "Delay Return", volume: 0.85, muted: false },
        },
        insertChains: {},
        eq16: {},
        sidechains: {},
        transientShapers: {},
      },
      humanizer: { global: {} },
      automation: { lanes: [], stepCount: 16 },
    });
    const parsed = serializer.parseProject(oldJson);
    expect(parsed.subMixBuses).toBeUndefined(); // Signal: User-localStorage nicht überschreiben
  });

  it("Invalide subMixBuses-Einträge werden silent gefiltert", () => {
    const project = {
      version: "1.32",
      projectId: "11111111-2222-4333-8444-555555555555",
      projectName: "Test",
      savedAt: new Date().toISOString(),
      bpm: 120,
      samples: [],
      patterns: [{ id: "p", name: "P", stepCount: 16, stepResolution: "1/16", bpm: null, parts: [] }],
      activePatternId: "p",
      song: { slots: [], songModeActive: false, loopSong: false },
      mixer: {
        masterVolume: 0.85,
        channels: {},
        returnTracks: {
          reverb: { id: "reverb", name: "Reverb Return", volume: 0.85, muted: false },
          delay: { id: "delay", name: "Delay Return", volume: 0.85, muted: false },
        },
        insertChains: {},
        eq16: {},
        sidechains: {},
        transientShapers: {},
      },
      humanizer: { global: {} },
      automation: { lanes: [], stepCount: 16 },
      subMixBuses: [
        { id: "good", name: "OK", volume: 0.5, pan: 0, mute: false, solo: false, channelIds: ["a"] },
        { id: "", name: "no id" }, // → gefiltert
        null,                       // → gefiltert
        "not an object",            // → gefiltert
        { id: "good2", name: "Q", volume: 999, pan: 99, mute: "yes", solo: 0, channelIds: ["x"] },
      ],
    };
    const parsed = serializer.parseProject(JSON.stringify(project));
    expect(parsed.subMixBuses).toBeDefined();
    expect(parsed.subMixBuses!).toHaveLength(2);
    expect(parsed.subMixBuses![0].id).toBe("good");
    // clamping
    expect(parsed.subMixBuses![1].volume).toBe(2);
    expect(parsed.subMixBuses![1].pan).toBe(1);
    expect(parsed.subMixBuses![1].mute).toBe(false); // non-bool → fallback false
    expect(parsed.subMixBuses![1].solo).toBe(false);
  });
});

// ─── (6) Channel ohne Bus default zu master ──────────────────────────────────

describe("useSubMixStore — Channel ohne Bus default zu master", () => {
  it("getBusForChannel returnt undefined wenn nichts assigned (→ master-Routing)", () => {
    const id = storeModule.createBus("Drums")!;
    storeModule.assignChannelToBus(id, "kick");
    expect(storeModule.getBusForChannel("kick")!.id).toBe(id);
    expect(storeModule.getBusForChannel("hihat")).toBeUndefined();
    expect(storeModule.getBusForChannel("snare")).toBeUndefined();
    expect(storeModule.getBusForChannel("")).toBeUndefined();
  });

  it("localStorage round-trip: gespeicherte Buses + Member kommen zurück", async () => {
    const id = storeModule.createBus("Drums")!;
    storeModule.assignChannelToBus(id, "kick");
    storeModule.setBusVolume(id, 0.4);

    // Re-Mount durch Modul-Reset
    vi.resetModules();
    storeModule = await import("../../client/src/store/useSubMixStore");
    const buses = storeModule.getBuses();
    expect(buses).toHaveLength(1);
    expect(buses[0].volume).toBe(0.4);
    expect(buses[0].channelIds).toEqual(["kick"]);
  });
});
