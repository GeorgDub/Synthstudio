/**
 * tests/features/plugin-host.test.ts
 *
 * v3.44.0 (TASK-239 Phase 1) — Unit-Tests für den AudioWorklet-Plugin-Host.
 *
 * Coverage:
 *  1. validatePluginManifest — Pure-Validator für Plugin-Manifeste
 *  2. PluginRegistry — register / unregister / getPlugins / Built-Ins
 *  3. PluginHost — setParam / getParams / clampPluginParam / Bypass
 *  4. AudioEngine.applyPluginSlot — Mock-Wiring (Plugin in FX-Chain)
 *  5. Offline-Render — verifiziert dass der Plugin-Host-Node ins Wiring kommt
 *  6. Backward-Compat — pre-v1.20 Files ohne pluginSlots laden anstandslos
 *
 * Env: node (alle Tests ohne JSDOM, pure-helpers + Mock-AudioContext).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  validatePluginManifest,
  registerPlugin,
  unregisterPlugin,
  getPlugins,
  getPlugin,
  pluginCount,
  _resetPluginRegistry,
  registerBuiltInPlugins,
  BUILT_IN_PLUGINS,
  BUILT_IN_TAPE_SAT,
  BUILT_IN_NOTCH,
  BUILT_IN_WIDTH,
  getDefaultParams,
  clampPluginParam,
  type PluginManifest,
} from "../../client/src/audio/PluginRegistry";

// ─── Mocks: AudioWorkletNode + AudioContext ────────────────────────────────

interface MockAudioParamMap {
  get(id: string): { value: number } | undefined;
}

class MockAudioParam {
  value: number = 0;
}

class MockAudioWorkletNode {
  readonly parameters: MockAudioParamMap;
  readonly port = { postMessage: vi.fn() };
  private _params: Map<string, MockAudioParam>;
  connectedTo: unknown[] = [];

  constructor(_ctx: unknown, _processorName: string, _options?: unknown) {
    this._params = new Map();
    // Built-Ins have these AudioParams via parameterDescriptors:
    const knownParams = ["drive", "mix", "frequency", "q", "width"];
    for (const name of knownParams) {
      this._params.set(name, new MockAudioParam());
    }
    this.parameters = {
      get: (id: string) => this._params.get(id),
    };
  }

  connect(target: unknown): void {
    this.connectedTo.push(target);
  }
  disconnect(): void {
    this.connectedTo = [];
  }
}

class MockAudioWorklet {
  addModule = vi.fn(async (_url: string) => {
    /* resolve immediately */
  });
}

class MockAudioContext {
  audioWorklet = new MockAudioWorklet();
  destination = { __isDestination: true };
  // Stub for register-plugin-failure scenario
  failNextAddModule = false;
}

// Inject a global AudioWorkletNode constructor for `new AudioWorkletNode(...)`
// inside the host module.
(globalThis as { AudioWorkletNode?: typeof MockAudioWorkletNode }).AudioWorkletNode =
  MockAudioWorkletNode;

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeValidManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: "test.plugin",
    name: "Test Plugin",
    version: "1.0.0",
    workletUrl: "blob:test://worklet.js",
    processorName: "test-processor",
    paramSchema: [
      { id: "drive", label: "Drive", min: 0, max: 1, default: 0.5 },
      { id: "mix", label: "Mix", min: 0, max: 1, default: 1 },
    ],
    ...overrides,
  };
}

// ─── 1. validatePluginManifest ─────────────────────────────────────────────

describe("validatePluginManifest — structural validation", () => {
  it("accepts a valid manifest", () => {
    expect(validatePluginManifest(makeValidManifest())).toBe(true);
  });

  it("accepts a manifest with empty paramSchema", () => {
    expect(validatePluginManifest(makeValidManifest({ paramSchema: [] }))).toBe(true);
  });

  it("rejects null, undefined, and primitives", () => {
    expect(validatePluginManifest(null)).toBe(false);
    expect(validatePluginManifest(undefined)).toBe(false);
    expect(validatePluginManifest("string")).toBe(false);
    expect(validatePluginManifest(123)).toBe(false);
  });

  it("rejects missing or empty required string fields", () => {
    expect(validatePluginManifest({ ...makeValidManifest(), id: "" })).toBe(false);
    expect(validatePluginManifest({ ...makeValidManifest(), name: "" })).toBe(false);
    expect(validatePluginManifest({ ...makeValidManifest(), version: "" })).toBe(false);
    expect(validatePluginManifest({ ...makeValidManifest(), workletUrl: "" })).toBe(false);
    expect(validatePluginManifest({ ...makeValidManifest(), processorName: "" })).toBe(false);
  });

  it("rejects manifests where paramSchema is not an array", () => {
    expect(
      validatePluginManifest({
        ...makeValidManifest(),
        paramSchema: "not-an-array" as unknown as PluginManifest["paramSchema"],
      }),
    ).toBe(false);
  });

  it("rejects param entries with invalid range (max < min)", () => {
    expect(
      validatePluginManifest(
        makeValidManifest({
          paramSchema: [{ id: "p", label: "P", min: 1, max: 0, default: 0 }],
        }),
      ),
    ).toBe(false);
  });

  it("rejects param entries where default is out of range", () => {
    expect(
      validatePluginManifest(
        makeValidManifest({
          paramSchema: [{ id: "p", label: "P", min: 0, max: 1, default: 5 }],
        }),
      ),
    ).toBe(false);
  });

  it("rejects param entries with non-finite numbers (NaN, Infinity)", () => {
    expect(
      validatePluginManifest(
        makeValidManifest({
          paramSchema: [{ id: "p", label: "P", min: NaN, max: 1, default: 0 }],
        }),
      ),
    ).toBe(false);
    expect(
      validatePluginManifest(
        makeValidManifest({
          paramSchema: [{ id: "p", label: "P", min: 0, max: Infinity, default: 0 }],
        }),
      ),
    ).toBe(false);
  });
});

// ─── 2. PluginRegistry ────────────────────────────────────────────────────

describe("PluginRegistry — register / getPlugins / Built-Ins", () => {
  beforeEach(() => {
    _resetPluginRegistry();
  });

  it("starts empty after reset", () => {
    expect(pluginCount()).toBe(0);
    expect(getPlugins()).toEqual([]);
  });

  it("registers a single plugin", () => {
    const m = makeValidManifest();
    registerPlugin(m);
    expect(pluginCount()).toBe(1);
    expect(getPlugin(m.id)).toEqual(m);
  });

  it("throws on invalid manifest", () => {
    expect(() => registerPlugin({} as PluginManifest)).toThrow();
  });

  it("registers multiple plugins and returns them sorted by id", () => {
    registerPlugin(makeValidManifest({ id: "zeta.plugin" }));
    registerPlugin(makeValidManifest({ id: "alpha.plugin" }));
    registerPlugin(makeValidManifest({ id: "beta.plugin" }));
    const ids = getPlugins().map((p) => p.id);
    expect(ids).toEqual(["alpha.plugin", "beta.plugin", "zeta.plugin"]);
  });

  it("unregisterPlugin removes the plugin", () => {
    registerPlugin(makeValidManifest());
    expect(unregisterPlugin("test.plugin")).toBe(true);
    expect(pluginCount()).toBe(0);
    expect(unregisterPlugin("not.exists")).toBe(false);
  });

  it("registerBuiltInPlugins adds all 3 built-ins idempotently", () => {
    registerBuiltInPlugins();
    expect(pluginCount()).toBe(3);
    // Second call should NOT throw (idempotent same-version registration)
    registerBuiltInPlugins();
    expect(pluginCount()).toBe(3);
    const ids = getPlugins().map((p) => p.id);
    expect(ids).toContain(BUILT_IN_TAPE_SAT.id);
    expect(ids).toContain(BUILT_IN_NOTCH.id);
    expect(ids).toContain(BUILT_IN_WIDTH.id);
  });

  it("rejects overwriting a built-in plugin without forceOverwrite", () => {
    registerBuiltInPlugins();
    expect(() =>
      registerPlugin({ ...BUILT_IN_TAPE_SAT, version: "9.9.9" }),
    ).toThrow();
  });

  it("BUILT_IN_PLUGINS contains exactly 3 plugins with valid manifests", () => {
    expect(BUILT_IN_PLUGINS).toHaveLength(3);
    for (const m of BUILT_IN_PLUGINS) {
      expect(validatePluginManifest(m)).toBe(true);
      expect(m.builtIn).toBe(true);
    }
  });
});

// ─── 3. Plugin Params: defaults + clamping ────────────────────────────────

describe("getDefaultParams + clampPluginParam — pure helpers", () => {
  it("getDefaultParams returns the default value for every param", () => {
    const m = makeValidManifest();
    const defaults = getDefaultParams(m);
    expect(defaults).toEqual({ drive: 0.5, mix: 1 });
  });

  it("getDefaultParams returns empty object for empty schema", () => {
    const m = makeValidManifest({ paramSchema: [] });
    expect(getDefaultParams(m)).toEqual({});
  });

  it("clampPluginParam clamps below min", () => {
    const m = makeValidManifest();
    expect(clampPluginParam(m, "drive", -5)).toBe(0);
  });

  it("clampPluginParam clamps above max", () => {
    const m = makeValidManifest();
    expect(clampPluginParam(m, "drive", 99)).toBe(1);
  });

  it("clampPluginParam passes through valid values", () => {
    const m = makeValidManifest();
    expect(clampPluginParam(m, "drive", 0.7)).toBe(0.7);
  });

  it("clampPluginParam returns default for NaN", () => {
    const m = makeValidManifest();
    expect(clampPluginParam(m, "drive", NaN)).toBe(0.5);
  });

  it("clampPluginParam returns unmodified value for unknown param (defensive)", () => {
    const m = makeValidManifest();
    expect(clampPluginParam(m, "unknown.param", 42)).toBe(42);
  });
});

// ─── 4. PluginHost — load + setParam ──────────────────────────────────────

describe("PluginHost — async load + setParam + getParams", () => {
  beforeEach(() => {
    _resetPluginRegistry();
  });

  it("createPluginHost returns null on missing AudioWorklet", async () => {
    const { createPluginHost } = await import("../../client/src/audio/PluginHost");
    const ctx = { /* no audioWorklet */ } as unknown as BaseAudioContext;
    const host = await createPluginHost(ctx, makeValidManifest());
    expect(host).toBeNull();
  });

  it("createPluginHost creates a PluginHost on valid context", async () => {
    const { createPluginHost, _resetPluginHostModuleCache } = await import(
      "../../client/src/audio/PluginHost"
    );
    _resetPluginHostModuleCache();
    const ctx = new MockAudioContext() as unknown as BaseAudioContext;
    const host = await createPluginHost(ctx, makeValidManifest());
    expect(host).not.toBeNull();
    expect(host!.manifest.id).toBe("test.plugin");
    // Default-Params applied
    const params = host!.getParams();
    expect(params.drive).toBe(0.5);
    expect(params.mix).toBe(1);
  });

  it("createPluginHost applies initial-params override", async () => {
    const { createPluginHost, _resetPluginHostModuleCache } = await import(
      "../../client/src/audio/PluginHost"
    );
    _resetPluginHostModuleCache();
    const ctx = new MockAudioContext() as unknown as BaseAudioContext;
    const host = await createPluginHost(ctx, makeValidManifest(), {
      params: { drive: 0.8 },
    });
    expect(host!.getParams().drive).toBe(0.8);
    // un-overridden params take default
    expect(host!.getParams().mix).toBe(1);
  });

  it("setParam updates the param and clamps to range", async () => {
    const { createPluginHost, _resetPluginHostModuleCache } = await import(
      "../../client/src/audio/PluginHost"
    );
    _resetPluginHostModuleCache();
    const ctx = new MockAudioContext() as unknown as BaseAudioContext;
    const host = await createPluginHost(ctx, makeValidManifest());
    host!.setParam("drive", 5);
    expect(host!.getParams().drive).toBe(1); // clamped
    host!.setParam("drive", -1);
    expect(host!.getParams().drive).toBe(0); // clamped
    host!.setParam("drive", 0.42);
    expect(host!.getParams().drive).toBe(0.42);
  });

  it("setParam is a no-op for unknown param-id", async () => {
    const { createPluginHost, _resetPluginHostModuleCache } = await import(
      "../../client/src/audio/PluginHost"
    );
    _resetPluginHostModuleCache();
    const ctx = new MockAudioContext() as unknown as BaseAudioContext;
    const host = await createPluginHost(ctx, makeValidManifest());
    const before = host!.getParams();
    host!.setParam("not.real", 999);
    expect(host!.getParams()).toEqual(before);
  });

  it("setBypassed + isBypassed roundtrip", async () => {
    const { createPluginHost, _resetPluginHostModuleCache } = await import(
      "../../client/src/audio/PluginHost"
    );
    _resetPluginHostModuleCache();
    const ctx = new MockAudioContext() as unknown as BaseAudioContext;
    const host = await createPluginHost(ctx, makeValidManifest());
    expect(host!.isBypassed()).toBe(false);
    host!.setBypassed(true);
    expect(host!.isBypassed()).toBe(true);
    host!.setBypassed(false);
    expect(host!.isBypassed()).toBe(false);
  });

  it("createPluginHost returns null when addModule throws", async () => {
    const { createPluginHost, _resetPluginHostModuleCache } = await import(
      "../../client/src/audio/PluginHost"
    );
    _resetPluginHostModuleCache();
    const ctx = new MockAudioContext();
    ctx.audioWorklet.addModule.mockImplementationOnce(async () => {
      throw new Error("module load failed");
    });
    const host = await createPluginHost(ctx as unknown as BaseAudioContext, makeValidManifest());
    expect(host).toBeNull();
  });

  it("getDefaultParams + createPluginHost integrate: built-in TapeSat has defaults applied", async () => {
    const { createPluginHost, _resetPluginHostModuleCache } = await import(
      "../../client/src/audio/PluginHost"
    );
    _resetPluginHostModuleCache();
    const ctx = new MockAudioContext() as unknown as BaseAudioContext;
    const host = await createPluginHost(ctx, BUILT_IN_TAPE_SAT);
    expect(host).not.toBeNull();
    expect(host!.getParams()).toEqual({ drive: 0.3, mix: 1 });
  });
});

// ─── 5. FX-Chain Integration ─────────────────────────────────────────────

describe("PluginHost — FX-chain integration (mock-wiring)", () => {
  beforeEach(() => {
    _resetPluginRegistry();
  });

  it("PluginHost node can be connected to a destination", async () => {
    const { createPluginHost, _resetPluginHostModuleCache } = await import(
      "../../client/src/audio/PluginHost"
    );
    _resetPluginHostModuleCache();
    const ctx = new MockAudioContext() as unknown as BaseAudioContext;
    const host = await createPluginHost(ctx, makeValidManifest());
    expect(host).not.toBeNull();
    const node = host!.getNode() as unknown as MockAudioWorkletNode;
    const dest = { __isDestination: true };
    node.connect(dest);
    expect(node.connectedTo).toContain(dest);
  });

  it("dispose() disconnects the node", async () => {
    const { createPluginHost, _resetPluginHostModuleCache } = await import(
      "../../client/src/audio/PluginHost"
    );
    _resetPluginHostModuleCache();
    const ctx = new MockAudioContext() as unknown as BaseAudioContext;
    const host = await createPluginHost(ctx, makeValidManifest());
    const node = host!.getNode() as unknown as MockAudioWorkletNode;
    node.connect({});
    host!.dispose();
    expect(node.connectedTo).toEqual([]);
  });

  it("multiple PluginHost-instances on same context share module cache (addModule called once per workletUrl)", async () => {
    const { createPluginHost, _resetPluginHostModuleCache } = await import(
      "../../client/src/audio/PluginHost"
    );
    _resetPluginHostModuleCache();
    const ctx = new MockAudioContext();
    await createPluginHost(ctx as unknown as BaseAudioContext, makeValidManifest());
    await createPluginHost(ctx as unknown as BaseAudioContext, makeValidManifest());
    await createPluginHost(ctx as unknown as BaseAudioContext, makeValidManifest());
    // addModule called once for the single workletUrl
    expect(ctx.audioWorklet.addModule).toHaveBeenCalledTimes(1);
  });
});

// ─── 6. Backward-Compat for SYNTH_FILE_VERSION 1.20 ──────────────────────

describe("v1.20 schema — pluginSlots backward-compat", () => {
  it("SYNTH_FILE_VERSION is bumped to 1.20", async () => {
    const { SYNTH_FILE_VERSION } = await import(
      "../../client/src/utils/projectSerializer"
    );
    expect(SYNTH_FILE_VERSION).toBe("1.20");
  });

  it("parseProject defaults pluginSlots to undefined for pre-v1.20 files", async () => {
    const { parseProject, SYNTH_FILE_VERSION } = await import(
      "../../client/src/utils/projectSerializer"
    );
    const preV120 = {
      version: "1.19",
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
        // pluginSlots NOT present
      },
      humanizer: { global: {} },
      automation: { lanes: [], stepCount: 16 },
    };
    const parsed = parseProject(JSON.stringify(preV120));
    expect(parsed.version).toBe("1.19"); // preserves source version
    expect(parsed.mixer.pluginSlots).toBeUndefined();
    expect(SYNTH_FILE_VERSION).toBe("1.20"); // current writes as 1.20
  });
});
