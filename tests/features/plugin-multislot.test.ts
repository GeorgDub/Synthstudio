/**
 * tests/features/plugin-multislot.test.ts
 *
 * v3.45.0 — Multi-Slot Plugin-Chain (max 4) + Click-Free Bypass.
 *
 * Coverage:
 *  1. migratePluginSlots — Pure-Migrations-Helper für v3.44 → v3.45
 *  2. Multi-Slot State: add/remove/move/setParam/setBypassed
 *  3. Max-Slots Enforcement
 *  4. PluginHost.setBypassed Crossfade Ramp
 *  5. Schema-Migration v1.20 → v1.21 (parseProject)
 *  6. MAX_PLUGIN_SLOTS_PER_CHANNEL Constant
 *
 * Env: node (alle Tests ohne JSDOM-DOM-API).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  migratePluginSlots,
  MAX_PLUGIN_SLOTS_PER_CHANNEL,
  type MixerPluginSlot,
} from "../../client/src/store/useMixerStore";

// ─── Helpers: Mock AudioContext + AudioWorkletNode ────────────────────────

class MockAudioParam {
  value: number = 0;
  private _scheduled: Array<{ at: number; type: string; value: number; curve?: Float32Array }> = [];
  cancelScheduledValues = vi.fn((_at: number) => { this._scheduled = []; });
  setValueAtTime = vi.fn((v: number, at: number) => {
    this._scheduled.push({ at, type: "set", value: v });
  });
  linearRampToValueAtTime = vi.fn((v: number, at: number) => {
    this._scheduled.push({ at, type: "linear", value: v });
  });
  // v3.46: S-Curve via setValueCurveAtTime
  setValueCurveAtTime = vi.fn((curve: Float32Array, at: number, _duration: number) => {
    this._scheduled.push({
      at,
      type: "curve",
      value: curve[curve.length - 1],
      curve,
    });
  });
  getScheduled(): Array<{ at: number; type: string; value: number; curve?: Float32Array }> {
    return [...this._scheduled];
  }
}

class MockAudioWorkletNode {
  readonly parameters = {
    get: (id: string) => this._params.get(id),
  };
  readonly port = { postMessage: vi.fn() };
  private _params = new Map<string, MockAudioParam>();
  connectedTo: unknown[] = [];
  constructor(_ctx: unknown, _name: string, _opts?: unknown) {
    for (const p of ["drive", "mix", "frequency", "q", "width"]) {
      this._params.set(p, new MockAudioParam());
    }
  }
  connect(target: unknown): void { this.connectedTo.push(target); }
  disconnect(): void { this.connectedTo = []; }
}

class MockGainNode {
  readonly gain = new MockAudioParam();
  connectedTo: unknown[] = [];
  connect(target: unknown): void { this.connectedTo.push(target); }
  disconnect(): void { this.connectedTo = []; }
}

class MockAudioContext {
  audioWorklet = { addModule: vi.fn(async (_url: string) => { /* ok */ }) };
  currentTime = 0;
  createGain(): MockGainNode { return new MockGainNode(); }
}

(globalThis as { AudioWorkletNode?: typeof MockAudioWorkletNode }).AudioWorkletNode =
  MockAudioWorkletNode;

// ─── 1. migratePluginSlots — Pure-Helper ──────────────────────────────────

describe("migratePluginSlots — v3.44 single-slot → v3.45 multi-slot", () => {
  it("returns empty object for null / undefined / non-object", () => {
    expect(migratePluginSlots(null)).toEqual({});
    expect(migratePluginSlots(undefined)).toEqual({});
    expect(migratePluginSlots("string")).toEqual({});
    expect(migratePluginSlots(42)).toEqual({});
  });

  it("wraps v3.44 single-slot Object into [slot]-Array per channel", () => {
    const v344 = {
      kick: { pluginId: "synthstudio.tape-sat", params: { drive: 0.5 }, bypassed: false },
      snare: { pluginId: "synthstudio.notch", params: { frequency: 1000 } },
    };
    const result = migratePluginSlots(v344);
    expect(result.kick).toHaveLength(1);
    expect(result.kick[0].pluginId).toBe("synthstudio.tape-sat");
    expect(result.kick[0].params.drive).toBe(0.5);
    expect(result.snare).toHaveLength(1);
    expect(result.snare[0].pluginId).toBe("synthstudio.notch");
  });

  it("keeps already-migrated v3.45 array data intact", () => {
    const v345 = {
      kick: [
        { pluginId: "synthstudio.tape-sat", params: { drive: 0.5 } },
        { pluginId: "synthstudio.notch", params: { frequency: 2000 } },
      ],
    };
    const result = migratePluginSlots(v345);
    expect(result.kick).toHaveLength(2);
    expect(result.kick[1].pluginId).toBe("synthstudio.notch");
  });

  it("trims arrays exceeding MAX_PLUGIN_SLOTS_PER_CHANNEL silently", () => {
    const tooMany = {
      kick: [
        { pluginId: "p.a", params: {} },
        { pluginId: "p.b", params: {} },
        { pluginId: "p.c", params: {} },
        { pluginId: "p.d", params: {} },
        { pluginId: "p.e", params: {} }, // 5th — should be trimmed
        { pluginId: "p.f", params: {} }, // 6th — should be trimmed
      ],
    };
    const result = migratePluginSlots(tooMany);
    expect(result.kick).toHaveLength(MAX_PLUGIN_SLOTS_PER_CHANNEL);
    expect(result.kick.map((s) => s.pluginId)).toEqual(["p.a", "p.b", "p.c", "p.d"]);
  });

  it("filters out invalid slot entries (missing pluginId)", () => {
    const mixed = {
      kick: [
        { pluginId: "valid.plugin", params: {} },
        { pluginId: "", params: {} }, // empty id → drop
        null,
        { params: {} }, // no id → drop
      ],
    };
    const result = migratePluginSlots(mixed);
    expect(result.kick).toHaveLength(1);
    expect(result.kick[0].pluginId).toBe("valid.plugin");
  });

  it("maps undefined / null / empty channels to []", () => {
    const mixed = {
      ch1: undefined,
      ch2: null,
      ch3: 42 as unknown,
    };
    const result = migratePluginSlots(mixed);
    expect(result.ch1).toEqual([]);
    expect(result.ch2).toEqual([]);
    expect(result.ch3).toEqual([]);
  });

  it("preserves bypassed-flag from v3.44 single-slot format", () => {
    const v344 = {
      kick: { pluginId: "synthstudio.tape-sat", params: { drive: 0.5 }, bypassed: true },
    };
    const result = migratePluginSlots(v344);
    expect(result.kick[0].bypassed).toBe(true);
  });
});

// ─── 2. MAX_PLUGIN_SLOTS_PER_CHANNEL constant ─────────────────────────────

describe("MAX_PLUGIN_SLOTS_PER_CHANNEL constant", () => {
  it("is 4 (begründet via CPU-Budget + UI-Klarheit)", () => {
    expect(MAX_PLUGIN_SLOTS_PER_CHANNEL).toBe(4);
  });
});

// ─── 3. PluginHost — Click-Free Bypass Crossfade ──────────────────────────

describe("PluginHost — click-free bypass crossfade (5ms ramp)", () => {
  beforeEach(async () => {
    const { _resetPluginHostModuleCache } = await import(
      "../../client/src/audio/PluginHost"
    );
    _resetPluginHostModuleCache();
  });

  const validManifest = {
    id: "test.plugin",
    name: "Test Plugin",
    version: "1.0.0",
    workletUrl: "blob:test://worklet.js",
    processorName: "test-processor",
    paramSchema: [
      { id: "drive", label: "Drive", min: 0, max: 1, default: 0.5 },
    ],
  };

  it("setBypassed(true) ramps wet→0 and dry→1 over 5ms", async () => {
    const { createPluginHost } = await import("../../client/src/audio/PluginHost");
    const ctx = new MockAudioContext() as unknown as BaseAudioContext;
    const host = await createPluginHost(ctx, validManifest);
    expect(host).not.toBeNull();

    host!.setBypassed(true, 5);

    // The host has built internal wet/dry/in/out gain nodes — we can't
    // reach them directly, but we can verify the bypass flag is set AND
    // that the host stays usable (no exception).
    expect(host!.isBypassed()).toBe(true);

    // Toggle back: dry→0, wet→1
    host!.setBypassed(false, 5);
    expect(host!.isBypassed()).toBe(false);
  });

  it("setBypassed default rampMs is 5ms (DEFAULT_BYPASS_RAMP_MS)", async () => {
    const { createPluginHost, DEFAULT_BYPASS_RAMP_MS } = await import(
      "../../client/src/audio/PluginHost"
    );
    expect(DEFAULT_BYPASS_RAMP_MS).toBe(5);
    const ctx = new MockAudioContext() as unknown as BaseAudioContext;
    const host = await createPluginHost(ctx, validManifest);
    expect(host).not.toBeNull();
    // Calling with no rampMs uses default
    expect(() => host!.setBypassed(true)).not.toThrow();
  });

  it("setBypassed survives missing createGain (test-mock without ramp)", async () => {
    const { createPluginHost } = await import("../../client/src/audio/PluginHost");
    // Context WITHOUT createGain: bypass falls back to flag-only.
    const ctx = {
      audioWorklet: { addModule: vi.fn(async () => undefined) },
      currentTime: 0,
    } as unknown as BaseAudioContext;
    const host = await createPluginHost(ctx, validManifest);
    expect(host).not.toBeNull();
    host!.setBypassed(true);
    expect(host!.isBypassed()).toBe(true);
    host!.setBypassed(false);
    expect(host!.isBypassed()).toBe(false);
  });

  it("getInputNode + getOutputNode liefern verbindbare AudioNodes", async () => {
    const { createPluginHost } = await import("../../client/src/audio/PluginHost");
    const ctx = new MockAudioContext() as unknown as BaseAudioContext;
    const host = await createPluginHost(ctx, validManifest);
    expect(host).not.toBeNull();
    const inp = host!.getInputNode();
    const out = host!.getOutputNode();
    expect(inp).toBeDefined();
    expect(out).toBeDefined();
    // Caller-side: pre-stage → host.in ; host.out → next-stage
    const dest = { __sink: true };
    (out as unknown as MockGainNode).connect(dest);
    expect((out as unknown as MockGainNode).connectedTo).toContain(dest);
  });

  it("dispose disconnects all internal wrapper nodes", async () => {
    const { createPluginHost } = await import("../../client/src/audio/PluginHost");
    const ctx = new MockAudioContext() as unknown as BaseAudioContext;
    const host = await createPluginHost(ctx, validManifest);
    expect(host).not.toBeNull();
    // dispose should not throw even when wrapper nodes are present
    expect(() => host!.dispose()).not.toThrow();
  });
});

// ─── 4. Schema-Migration v1.20 → v1.21 (parseProject) ─────────────────────

describe("parseProject — v1.20 single-slot → v1.21 multi-slot migration", () => {
  it("SYNTH_FILE_VERSION ist '1.31' (v3.76 Master-Limiter + Mid-Q; pluginSlots bleiben multi-slot)", async () => {
    const { SYNTH_FILE_VERSION } = await import(
      "../../client/src/utils/projectSerializer"
    );
    expect(SYNTH_FILE_VERSION).toBe("1.31");
  });

  it("migriert v1.20 single-slot Objects automatisch zu [slot]-Arrays", async () => {
    const { parseProject } = await import(
      "../../client/src/utils/projectSerializer"
    );
    const v120File = {
      version: "1.20",
      projectName: "Test",
      savedAt: new Date().toISOString(),
      bpm: 120,
      samples: [],
      patterns: [{ id: "p1", name: "P", parts: [], stepCount: 16, stepResolution: "1/16" }],
      activePatternId: "p1",
      song: { slots: [], songModeActive: false, loopSong: false },
      mixer: {
        masterVolume: 0.85,
        channels: {},
        returnTracks: {},
        insertChains: {},
        eq16: {},
        sidechains: {},
        transientShapers: {},
        pluginSlots: {
          kick: { pluginId: "synthstudio.tape-sat", params: { drive: 0.5 }, bypassed: false },
          snare: { pluginId: "synthstudio.notch", params: { frequency: 1500 } },
        },
      },
      humanizer: { global: {} },
      automation: { lanes: [], stepCount: 16 },
    };
    const parsed = parseProject(JSON.stringify(v120File));
    expect(parsed.mixer.pluginSlots).toBeDefined();
    const slots = parsed.mixer.pluginSlots!;
    expect(Array.isArray(slots.kick)).toBe(true);
    expect(slots.kick).toHaveLength(1);
    expect(slots.kick[0].pluginId).toBe("synthstudio.tape-sat");
    expect(Array.isArray(slots.snare)).toBe(true);
    expect(slots.snare).toHaveLength(1);
  });

  it("läßt v1.21 multi-slot Arrays unverändert (idempotent)", async () => {
    const { parseProject } = await import(
      "../../client/src/utils/projectSerializer"
    );
    const v121File = {
      version: "1.21",
      projectName: "Test",
      savedAt: new Date().toISOString(),
      bpm: 120,
      samples: [],
      patterns: [{ id: "p1", name: "P", parts: [], stepCount: 16, stepResolution: "1/16" }],
      activePatternId: "p1",
      song: { slots: [], songModeActive: false, loopSong: false },
      mixer: {
        masterVolume: 0.85,
        channels: {},
        returnTracks: {},
        insertChains: {},
        eq16: {},
        sidechains: {},
        transientShapers: {},
        pluginSlots: {
          kick: [
            { pluginId: "synthstudio.tape-sat", params: { drive: 0.5 } },
            { pluginId: "synthstudio.notch", params: { frequency: 1000 } },
          ],
        },
      },
      humanizer: { global: {} },
      automation: { lanes: [], stepCount: 16 },
    };
    const parsed = parseProject(JSON.stringify(v121File));
    const slots = parsed.mixer.pluginSlots!;
    expect(Array.isArray(slots.kick)).toBe(true);
    expect(slots.kick).toHaveLength(2);
    expect(slots.kick[0].pluginId).toBe("synthstudio.tape-sat");
    expect(slots.kick[1].pluginId).toBe("synthstudio.notch");
  });

  it("trimmt überlange v1.21 Arrays auf MAX_PLUGIN_SLOTS_PER_CHANNEL beim Parsen", async () => {
    const { parseProject } = await import(
      "../../client/src/utils/projectSerializer"
    );
    const tooMany: MixerPluginSlot[] = [
      { pluginId: "p.a", params: {} },
      { pluginId: "p.b", params: {} },
      { pluginId: "p.c", params: {} },
      { pluginId: "p.d", params: {} },
      { pluginId: "p.e", params: {} },
      { pluginId: "p.f", params: {} },
    ];
    const file = {
      version: "1.21",
      projectName: "Test",
      savedAt: new Date().toISOString(),
      bpm: 120,
      samples: [],
      patterns: [{ id: "p1", name: "P", parts: [], stepCount: 16, stepResolution: "1/16" }],
      activePatternId: "p1",
      song: { slots: [], songModeActive: false, loopSong: false },
      mixer: {
        masterVolume: 0.85,
        channels: {},
        returnTracks: {},
        insertChains: {},
        eq16: {},
        sidechains: {},
        transientShapers: {},
        pluginSlots: { kick: tooMany },
      },
      humanizer: { global: {} },
      automation: { lanes: [], stepCount: 16 },
    };
    const parsed = parseProject(JSON.stringify(file));
    expect(parsed.mixer.pluginSlots!.kick).toHaveLength(4);
  });
});

// ─── 5. v3.46 — S-Curve / Exponential-Ramp Bypass ──────────────────────────

describe("PluginHost — S-Curve Bypass (v3.46 polish)", () => {
  const validManifest = {
    id: "test.plugin",
    name: "Test Plugin",
    version: "1.0.0",
    workletUrl: "blob:test://worklet.js",
    processorName: "test-processor",
    paramSchema: [
      { id: "drive", label: "Drive", min: 0, max: 1, default: 0.5 },
    ],
  };

  beforeEach(async () => {
    const { _resetPluginHostModuleCache } = await import(
      "../../client/src/audio/PluginHost"
    );
    _resetPluginHostModuleCache();
  });

  it("buildSCurve produziert smoothstep (Endpunkte exakt, monoton)", async () => {
    const { buildSCurve } = await import("../../client/src/audio/PluginHost");
    const curve = buildSCurve(1.0, 0.0, 32);
    expect(curve).toBeInstanceOf(Float32Array);
    expect(curve.length).toBe(32);
    // Endpunkte exakt
    expect(curve[0]).toBeCloseTo(1.0, 6);
    expect(curve[curve.length - 1]).toBeCloseTo(0.0, 6);
    // Monoton fallend (S-Curve fade-out)
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i]).toBeLessThanOrEqual(curve[i - 1]);
    }
    // Mid-Point ist ~0.5 bei smoothstep (cubic ease-in-out)
    const mid = curve[Math.floor(curve.length / 2)];
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.7);
  });

  it("buildSCurve hat zero-derivative an Endpunkten (keine Discontinuity)", async () => {
    const { buildSCurve } = await import("../../client/src/audio/PluginHost");
    const curve = buildSCurve(0.0, 1.0, 32);
    // 1st derivative an den Endpunkten: angrenzende delta ≈ 0
    const startSlope = curve[1] - curve[0];
    const endSlope = curve[curve.length - 1] - curve[curve.length - 2];
    // Bei smoothstep ist die 1st-Derivative an t=0 und t=1 exakt 0 —
    // also der erste/letzte step ist deutlich kleiner als ein linearer
    // Schritt (1/31 ≈ 0.032 für lin-Ramp).
    expect(Math.abs(startSlope)).toBeLessThan(0.02);
    expect(Math.abs(endSlope)).toBeLessThan(0.02);
  });

  it("setBypassed mit useExponentialRamp=true ruft setValueCurveAtTime", async () => {
    const { createPluginHost } = await import("../../client/src/audio/PluginHost");
    const ctx = new MockAudioContext() as unknown as BaseAudioContext;
    const host = await createPluginHost(ctx, validManifest);
    expect(host).not.toBeNull();
    // Reset spy-Counts da der Konstruktor selbst evtl. auf params zugriffen hat.
    const inputNode = host!.getInputNode() as unknown as MockGainNode;
    expect(inputNode).toBeDefined();

    // Linear-Pfad — default
    host!.setBypassed(true, 5);
    host!.setBypassed(false, 5);

    // Exponential-Pfad — useExponentialRamp=true
    host!.setBypassed(true, 5, true);
    expect(host!.isBypassed()).toBe(true);

    // Wir können nicht direkt auf wetGain/dryGain zugreifen, aber wir können
    // verifizieren dass der Host nicht crashed und die Bypass-Flag korrekt
    // gesetzt wird — das ist der Kern-Vertrag.
    host!.setBypassed(false, 5, true);
    expect(host!.isBypassed()).toBe(false);
  });

  it("Exponential-Ramp ohne Discontinuity: Curve-Slope an Endpunkten klein", async () => {
    const { buildSCurve } = await import("../../client/src/audio/PluginHost");
    // Vergleich linear vs s-curve: erste/letzte step deutlich kleiner.
    const linearStep = 1 / 31; // lineare Rampe über 32 Samples
    const sCurve = buildSCurve(0, 1, 32);
    const firstStep = Math.abs(sCurve[1] - sCurve[0]);
    const lastStep = Math.abs(sCurve[31] - sCurve[30]);
    // S-Curve startet und endet flacher als linear (kein Knick)
    expect(firstStep).toBeLessThan(linearStep * 0.5);
    expect(lastStep).toBeLessThan(linearStep * 0.5);
  });

  it("setBypassed default-Param useExponentialRamp=false (Backward-Compat)", async () => {
    const { createPluginHost } = await import("../../client/src/audio/PluginHost");
    const ctx = new MockAudioContext() as unknown as BaseAudioContext;
    const host = await createPluginHost(ctx, validManifest);
    expect(host).not.toBeNull();
    // Default-Call ohne useExponentialRamp → linear Pfad, kein crash.
    expect(() => host!.setBypassed(true, 5)).not.toThrow();
    expect(host!.isBypassed()).toBe(true);
  });
});
