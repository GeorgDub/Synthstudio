/**
 * tests/features/midi-fx-presets.test.ts (v3.94.0)
 *
 * Test-Cluster:
 *  (1) Preset-Definitions: jede ID liefert Node-Sequence mit erwarteten kinds.
 *  (2) Glissando transformiert 1 Note → N Events (Chord × Repeat Expansion).
 *  (3) Restore-Wiring: setAllNodes lädt chain in Store.
 *  (4) Pre-v1.34 (midiFxChain undefined) → setAllNodes no-op, Store unverändert.
 *  (5) Round-Trip: Preset laden → applyMidiFx liefert nicht-leere Event-Liste.
 *  (6) UUID-Frische: zwei loadPreset()-Calls liefern verschiedene IDs.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── localStorage-Mock ────────────────────────────────────────────────────────

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
if (typeof (globalThis as { window?: unknown }).window === "undefined") {
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: localStorageMock },
    writable: true,
    configurable: true,
  });
}

// ─── Dynamische Imports (NACH Mock-Setup) ─────────────────────────────────────

let presets: typeof import("../../client/src/utils/midiFxPresets");
let engine: typeof import("../../client/src/utils/midiFxEngine");
let store: typeof import("../../client/src/store/useMidiFxStore");

beforeEach(async () => {
  vi.resetModules();
  localStorageMock.clear();
  presets = await import("../../client/src/utils/midiFxPresets");
  engine = await import("../../client/src/utils/midiFxEngine");
  store = await import("../../client/src/store/useMidiFxStore");
  store.__resetMidiFxStoreForTests();
});

// ─── (1) Preset-Definitions ───────────────────────────────────────────────────

describe("MIDI-FX Presets — Definitions", () => {
  it("MIDI_FX_PRESETS listet 5 Built-Ins", () => {
    expect(presets.MIDI_FX_PRESETS).toHaveLength(5);
    const ids = presets.MIDI_FX_PRESETS.map((p) => p.id);
    expect(ids).toEqual([
      "strum",
      "glissando",
      "arp-up",
      "octave-double",
      "hard-hits",
    ]);
  });

  it("PRESET_STRUM hat erwartete Node-Sequence [chord-expander, note-repeat]", () => {
    const chain = presets.loadPreset("strum");
    expect(chain).toHaveLength(2);
    expect(chain[0].kind).toBe("chord-expander");
    expect(chain[1].kind).toBe("note-repeat");
    // Major-Chord
    if (chain[0].kind === "chord-expander") {
      expect(chain[0].chordType).toBe("major");
    }
    if (chain[1].kind === "note-repeat") {
      expect(chain[1].count).toBe(4);
    }
  });

  it("PRESET_GLISSANDO hat scale-snap + chord-expander(7th) + note-repeat", () => {
    const chain = presets.loadPreset("glissando");
    expect(chain).toHaveLength(3);
    expect(chain[0].kind).toBe("scale-snap");
    expect(chain[1].kind).toBe("chord-expander");
    expect(chain[2].kind).toBe("note-repeat");
    if (chain[1].kind === "chord-expander") {
      expect(chain[1].chordType).toBe("7th");
    }
    if (chain[2].kind === "note-repeat") {
      expect(chain[2].count).toBe(8);
    }
  });

  it("PRESET_OCTAVE_DOUBLE hat zwei octave-shift-Nodes (-12 + +12)", () => {
    const chain = presets.loadPreset("octave-double");
    expect(chain).toHaveLength(2);
    expect(chain[0].kind).toBe("octave-shift");
    expect(chain[1].kind).toBe("octave-shift");
    if (chain[0].kind === "octave-shift") expect(chain[0].semitones).toBe(-12);
    if (chain[1].kind === "octave-shift") expect(chain[1].semitones).toBe(12);
  });

  it("PRESET_HARD_HITS hat velocity-curve(exp) + scale-snap", () => {
    const chain = presets.loadPreset("hard-hits");
    expect(chain).toHaveLength(2);
    expect(chain[0].kind).toBe("velocity-curve");
    expect(chain[1].kind).toBe("scale-snap");
    if (chain[0].kind === "velocity-curve") {
      expect(chain[0].curve).toBe("exp");
      expect(chain[0].amount).toBeGreaterThan(0);
    }
  });

  it("PRESET_ARP_UP hat chord-expander(major) + note-repeat 1/16", () => {
    const chain = presets.loadPreset("arp-up");
    expect(chain).toHaveLength(2);
    if (chain[1].kind === "note-repeat") {
      expect(chain[1].rate).toBe("1/16");
      expect(chain[1].count).toBe(4);
    }
  });
});

// ─── (2) Glissando-Expansion ──────────────────────────────────────────────────

describe("MIDI-FX Presets — Engine-Interplay", () => {
  it("PRESET_GLISSANDO transformiert 1 note → N events (>1)", () => {
    const chain = presets.loadPreset("glissando");
    const input: { note: number; velocity: number; channel: number } = {
      note: 60,
      velocity: 100,
      channel: 1,
    };
    const out = engine.applyMidiFx(input, chain);
    // 7th-Chord = 4 Voices × 8 Repeats = 32 Events
    expect(out.length).toBeGreaterThan(1);
    expect(out.length).toBe(4 * 8);
  });

  it("PRESET_STRUM produziert 3 × 4 = 12 Events", () => {
    const chain = presets.loadPreset("strum");
    const out = engine.applyMidiFx(
      { note: 60, velocity: 100, channel: 1 },
      chain,
    );
    expect(out.length).toBe(3 * 4);
  });

  it("PRESET_OCTAVE_DOUBLE shifted Note bleibt im Bereich 0..127", () => {
    const chain = presets.loadPreset("octave-double");
    const out = engine.applyMidiFx(
      { note: 60, velocity: 100, channel: 1 },
      chain,
    );
    // Zwei sequenzielle Octave-Shifts (-12 dann +12) = Original
    expect(out).toHaveLength(1);
    expect(out[0].note).toBe(60);
  });
});

// ─── (3) Restore-Wiring ───────────────────────────────────────────────────────

describe("MIDI-FX Presets — Restore-Wiring", () => {
  it("setAllNodes lädt chain in Store", () => {
    const chain = presets.loadPreset("strum");
    store.setAllNodes(chain);
    const state = store.getMidiFxState();
    expect(state.chain).toHaveLength(2);
    expect(state.chain[0].kind).toBe("chord-expander");
    expect(state.chain[1].kind).toBe("note-repeat");
  });

  it("Pre-v1.34 (undefined) → store bleibt unchanged", () => {
    // Erst etwas in den Store legen
    store.addNode("velocity-curve");
    const before = store.getMidiFxState().chain.slice();
    expect(before).toHaveLength(1);

    // Simuliere "Pre-v1.34"-File: data.midiFxChain === undefined
    store.setAllNodes(undefined);

    const after = store.getMidiFxState().chain;
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(before[0].id);
    expect(after[0].kind).toBe("velocity-curve");
  });

  it("Explicit leeres Array [] respektieren (User-Intent leeren)", () => {
    store.addNode("octave-shift");
    expect(store.getMidiFxState().chain).toHaveLength(1);

    store.setAllNodes([]);

    expect(store.getMidiFxState().chain).toHaveLength(0);
  });

  it("Round-Trip: Preset laden → Store enthält dieselben kinds", () => {
    const chain = presets.loadPreset("glissando");
    store.setAllNodes(chain);
    const restored = store.getMidiFxState().chain;
    expect(restored.map((n) => n.kind)).toEqual([
      "scale-snap",
      "chord-expander",
      "note-repeat",
    ]);
  });
});

// ─── (4) UUID-Frische ─────────────────────────────────────────────────────────

describe("MIDI-FX Presets — UUID-Frische", () => {
  it("Zwei loadPreset()-Calls liefern verschiedene Node-IDs", () => {
    const a = presets.loadPreset("strum");
    const b = presets.loadPreset("strum");
    expect(a[0].id).not.toBe(b[0].id);
    expect(a[1].id).not.toBe(b[1].id);
  });

  it("getPresetMeta liefert Beschreibung für bekannte IDs", () => {
    const meta = presets.getPresetMeta("arp-up");
    expect(meta).toBeDefined();
    expect(meta?.label).toBe("Arp Up");
    expect(meta?.description.length).toBeGreaterThan(0);
  });
});
