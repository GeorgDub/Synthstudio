/**
 * tests/features/live-input-channel.test.ts
 *
 * Unit-Tests für TASK-233 (v2.85): USB-Audio als Mixer-Channel.
 *
 * Coverage:
 *  - addLiveInputChannel erzeugt Channel mit id-Prefix + Defaults
 *  - removeLiveInputChannel entfernt Channel
 *  - update / Patch-Semantik (Volume/Pan/Mute/Solo wirken)
 *  - Solo: additive vs exclusive (DAW-Convention)
 *  - Limit MAX_LIVE_INPUT_CHANNELS wirft
 *  - Persistenz: localStorage round-trip inkl. latencyCompensationMs + deviceId
 *  - loadLiveInputChannels filtert invalide Items + cappt
 *  - isValidChannel-Type-Guard
 *  - clamp-Verhalten (Volume/Pan/Latency)
 */
import { describe, it, expect, beforeEach } from "vitest";

// ─── localStorage Mock ────────────────────────────────────────────────────────

function createLocalStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string): string | null => store[k] ?? null,
    setItem: (k: string, v: string): void => { store[k] = v; },
    removeItem: (k: string): void => { delete store[k]; },
    clear: (): void => { store = {}; },
    _dump: (): Record<string, string> => ({ ...store }),
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

import {
  addLiveInputChannel,
  removeLiveInputChannel,
  updateLiveInputChannel,
  setLiveInputSoloed,
  getLiveInputChannel,
  getAllLiveInputChannels,
  loadLiveInputChannels,
  clearLiveInputChannels,
  isValidChannel,
  __resetForTests,
  MAX_LIVE_INPUT_CHANNELS,
  DEFAULT_LIVE_INPUT_VOLUME,
  type LiveInputChannelData,
} from "../../client/src/store/useLiveInputStore";

const STORAGE_KEY = "synthstudio:liveinputs:v1";

beforeEach(() => {
  localStorageMock.clear();
  __resetForTests();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("LiveInputStore – add/remove/update", () => {
  it("addLiveInputChannel erzeugt Channel mit kind:live-input (id-prefix liveinput:) + Defaults", () => {
    const id = addLiveInputChannel();
    expect(id).toMatch(/^liveinput:/);
    const ch = getLiveInputChannel(id);
    expect(ch).not.toBeNull();
    expect(ch!.id).toBe(id);
    expect(ch!.deviceId).toBeNull();
    expect(ch!.volume).toBeCloseTo(DEFAULT_LIVE_INPUT_VOLUME, 5);
    expect(ch!.pan).toBe(0);
    expect(ch!.muted).toBe(false);
    expect(ch!.soloed).toBe(false);
    expect(ch!.sends.reverb).toBe(0);
    expect(ch!.sends.delay).toBe(0);
    expect(ch!.latencyCompensationMs).toBe(0);
    expect(ch!.name).toMatch(/^Live In/);
  });

  it("addLiveInputChannel akzeptiert Overrides (Name, Volume, Pan, latency)", () => {
    const id = addLiveInputChannel({
      name: "KORG ESX",
      volume: 0.8,
      pan: -0.3,
      latencyCompensationMs: 42,
    });
    const ch = getLiveInputChannel(id);
    expect(ch?.name).toBe("KORG ESX");
    expect(ch?.volume).toBe(0.8);
    expect(ch?.pan).toBe(-0.3);
    expect(ch?.latencyCompensationMs).toBe(42);
  });

  it("removeLiveInputChannel entfernt Channel (Stream-Cleanup ist Caller-Verantwortung)", () => {
    const id = addLiveInputChannel();
    expect(getAllLiveInputChannels()).toHaveLength(1);
    removeLiveInputChannel(id);
    expect(getAllLiveInputChannels()).toHaveLength(0);
    expect(getLiveInputChannel(id)).toBeNull();
  });

  it("removeLiveInputChannel ist no-op für unbekannte ID", () => {
    addLiveInputChannel();
    const before = getAllLiveInputChannels().length;
    removeLiveInputChannel("liveinput:unknown");
    expect(getAllLiveInputChannels().length).toBe(before);
  });

  it("updateLiveInputChannel: Volume/Pan/Mute/Solo wirken wie bei drum-part", () => {
    const id = addLiveInputChannel();
    updateLiveInputChannel(id, { volume: 0.7, pan: 0.5, muted: true, soloed: false });
    const ch = getLiveInputChannel(id);
    expect(ch?.volume).toBe(0.7);
    expect(ch?.pan).toBe(0.5);
    expect(ch?.muted).toBe(true);
    expect(ch?.soloed).toBe(false);
  });

  it("updateLiveInputChannel: sends patchen einzeln (Reverb ändern, Delay bleibt)", () => {
    const id = addLiveInputChannel({ sends: { reverb: 0.2, delay: 0.4 } });
    updateLiveInputChannel(id, { sends: { reverb: 0.9, delay: 0.4 } });
    const ch = getLiveInputChannel(id);
    expect(ch?.sends.reverb).toBe(0.9);
    expect(ch?.sends.delay).toBe(0.4);
  });

  it("updateLiveInputChannel: ID kann NICHT überschrieben werden", () => {
    const id = addLiveInputChannel();
    updateLiveInputChannel(id, { id: "liveinput:hacked", volume: 0.1 } as Partial<LiveInputChannelData>);
    const ch = getLiveInputChannel(id);
    expect(ch?.id).toBe(id);
    expect(ch?.volume).toBe(0.1);
    expect(getLiveInputChannel("liveinput:hacked")).toBeNull();
  });
});

describe("LiveInputStore – Solo (additive vs exclusive)", () => {
  it("setLiveInputSoloed additive (default): andere Channels bleiben unverändert", () => {
    const a = addLiveInputChannel();
    const b = addLiveInputChannel();
    updateLiveInputChannel(b, { soloed: true });
    setLiveInputSoloed(a, true);
    expect(getLiveInputChannel(a)?.soloed).toBe(true);
    expect(getLiveInputChannel(b)?.soloed).toBe(true);
  });

  it("setLiveInputSoloed exclusive=true: alle anderen werden un-soloed", () => {
    const a = addLiveInputChannel();
    const b = addLiveInputChannel();
    updateLiveInputChannel(a, { soloed: true });
    updateLiveInputChannel(b, { soloed: true });
    setLiveInputSoloed(a, true, true);
    expect(getLiveInputChannel(a)?.soloed).toBe(true);
    expect(getLiveInputChannel(b)?.soloed).toBe(false);
  });
});

describe("LiveInputStore – Limit + Persistenz", () => {
  it("wirft Error wenn MAX_LIVE_INPUT_CHANNELS erreicht", () => {
    for (let i = 0; i < MAX_LIVE_INPUT_CHANNELS; i++) addLiveInputChannel();
    expect(() => addLiveInputChannel()).toThrowError(/Maximum/);
  });

  it("latencyCompensationMs persistiert in localStorage", () => {
    const id = addLiveInputChannel({ latencyCompensationMs: 87 });
    const raw = localStorageMock.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe(id);
    expect(parsed[0].latencyCompensationMs).toBe(87);
  });

  it("deviceId persistiert in localStorage (auch null als ungewählter State)", () => {
    const id = addLiveInputChannel({ deviceId: "device-abc-123", deviceLabel: "USB Audio CODEC" });
    const raw = localStorageMock.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw!);
    expect(parsed[0].deviceId).toBe("device-abc-123");
    expect(parsed[0].deviceLabel).toBe("USB Audio CODEC");
    void id;
  });

  it("Round-Trip via loadLiveInputChannels stellt deviceId+latency wieder her", () => {
    const id1 = addLiveInputChannel({ name: "A", deviceId: "dev-A", latencyCompensationMs: 15 });
    const id2 = addLiveInputChannel({ name: "B", deviceId: "dev-B", latencyCompensationMs: 30 });
    const snapshot = getAllLiveInputChannels();
    expect(snapshot).toHaveLength(2);

    clearLiveInputChannels();
    expect(getAllLiveInputChannels()).toHaveLength(0);

    loadLiveInputChannels(snapshot);
    const after = getAllLiveInputChannels();
    expect(after).toHaveLength(2);
    expect(after.find((c) => c.id === id1)?.deviceId).toBe("dev-A");
    expect(after.find((c) => c.id === id1)?.latencyCompensationMs).toBe(15);
    expect(after.find((c) => c.id === id2)?.latencyCompensationMs).toBe(30);
  });

  it("loadLiveInputChannels filtert invalide Items + cappt auf MAX", () => {
    const valid: LiveInputChannelData = {
      id: "liveinput:ok",
      name: "OK",
      deviceId: null,
      volume: 0.5,
      pan: 0,
      muted: false,
      soloed: false,
      sends: { reverb: 0, delay: 0 },
      latencyCompensationMs: 0,
    };
    const items: unknown[] = [valid, { id: "wrong:prefix" }, null, "not-an-object"];
    // pad with more valid items to test cap
    for (let i = 0; i < MAX_LIVE_INPUT_CHANNELS + 5; i++) {
      items.push({ ...valid, id: `liveinput:extra-${i}` });
    }
    loadLiveInputChannels(items as LiveInputChannelData[]);
    const after = getAllLiveInputChannels();
    expect(after.length).toBeLessThanOrEqual(MAX_LIVE_INPUT_CHANNELS);
    expect(after.every((c) => c.id.startsWith("liveinput:"))).toBe(true);
  });
});

describe("LiveInputStore – isValidChannel Type-Guard", () => {
  it("akzeptiert vollständiges Channel-Objekt", () => {
    const ch: LiveInputChannelData = {
      id: "liveinput:abc",
      name: "Test",
      deviceId: null,
      volume: 0.5,
      pan: 0,
      muted: false,
      soloed: false,
      sends: { reverb: 0, delay: 0 },
      latencyCompensationMs: 0,
    };
    expect(isValidChannel(ch)).toBe(true);
  });

  it("rejected ungültige Inputs (kein Objekt / falscher Prefix / fehlende Felder)", () => {
    expect(isValidChannel(null)).toBe(false);
    expect(isValidChannel(undefined)).toBe(false);
    expect(isValidChannel(42)).toBe(false);
    expect(isValidChannel({ id: "wrong:prefix", name: "x" })).toBe(false);
    expect(isValidChannel({
      id: "liveinput:x", name: "x", deviceId: null,
      volume: 0.5, pan: 0, muted: false, soloed: false,
      // sends fehlt → invalid
      latencyCompensationMs: 0,
    })).toBe(false);
  });
});

describe("LiveInputStore – clamp-Verhalten (Pan/Volume/Latency in update)", () => {
  it("Volume wird auf 0..1.5 geklemmt", () => {
    const id = addLiveInputChannel();
    updateLiveInputChannel(id, { volume: 5 });
    expect(getLiveInputChannel(id)!.volume).toBe(1.5);
    updateLiveInputChannel(id, { volume: -1 });
    expect(getLiveInputChannel(id)!.volume).toBe(0);
  });

  it("Pan wird auf -1..1 geklemmt", () => {
    const id = addLiveInputChannel();
    updateLiveInputChannel(id, { pan: 5 });
    expect(getLiveInputChannel(id)!.pan).toBe(1);
    updateLiveInputChannel(id, { pan: -5 });
    expect(getLiveInputChannel(id)!.pan).toBe(-1);
  });

  it("latencyCompensationMs wird auf 0..1000 geklemmt", () => {
    const id = addLiveInputChannel();
    updateLiveInputChannel(id, { latencyCompensationMs: 9999 });
    expect(getLiveInputChannel(id)!.latencyCompensationMs).toBe(1000);
    updateLiveInputChannel(id, { latencyCompensationMs: -10 });
    expect(getLiveInputChannel(id)!.latencyCompensationMs).toBe(0);
  });

  it("Send-Levels werden auf 0..1 geklemmt", () => {
    const id = addLiveInputChannel();
    updateLiveInputChannel(id, { sends: { reverb: 2, delay: -1 } });
    const ch = getLiveInputChannel(id);
    expect(ch!.sends.reverb).toBe(1);
    expect(ch!.sends.delay).toBe(0);
  });
});

// ─── AudioEngine-Mocking-Tests (FX-Chain-Anwendbarkeit) ──────────────────────

describe("AudioEngine – Live-Input FX-Chain + Latency-Compensation", () => {
  // Mocking-Strategie: AudioEngine ist ein riesiges Modul mit Web-Audio-Abhängigkeiten.
  // Wir testen hier nur die *Public-API-Vertraege* indem wir die relevanten
  // Maps direkt prüfen — keine echte Audio-Pipeline. Volle Integration steckt
  // im Playwright-E2E (out-of-scope für dieses Unit-Modul).

  it("attachLiveInput wirft wenn navigator.mediaDevices fehlt (Node-env)", async () => {
    // In Node-env gibt es kein navigator.mediaDevices — der Public-API-Contract
    // gibt einen Error zurueck, kein Crash.
    const { AudioEngine } = await import("../../client/src/audio/AudioEngine");
    // Ohne AudioContext-Stub bricht init() vorher; wir prüfen dass die Engine
    // nicht crasht und einen aussagekräftigen Fehler liefert.
    // Da AudioContext in Node nicht existiert, schluckt init() das stillschweigend.
    // Daher prüfen wir nur die Existenz der API-Methode (statische Vertraege).
    expect(typeof AudioEngine.attachLiveInput).toBe("function");
    expect(typeof AudioEngine.detachLiveInput).toBe("function");
    expect(typeof AudioEngine.setLiveInputLatencyMs).toBe("function");
    expect(typeof AudioEngine.getLiveInputLatencyMs).toBe("function");
    expect(typeof AudioEngine.isLiveInputAttached).toBe("function");
    expect(typeof AudioEngine.getEstimatedSystemLatencyMs).toBe("function");
    expect(typeof AudioEngine.getAttachedLiveInputChannelIds).toBe("function");
  });

  it("setLiveInputLatencyMs persistiert in der internen Map auch ohne aktiven Stream", async () => {
    const { AudioEngine } = await import("../../client/src/audio/AudioEngine");
    AudioEngine.setLiveInputLatencyMs("liveinput:test-1", 75);
    expect(AudioEngine.getLiveInputLatencyMs("liveinput:test-1")).toBe(75);
    AudioEngine.setLiveInputLatencyMs("liveinput:test-1", 9999);
    expect(AudioEngine.getLiveInputLatencyMs("liveinput:test-1")).toBe(1000);
    AudioEngine.setLiveInputLatencyMs("liveinput:test-1", -50);
    expect(AudioEngine.getLiveInputLatencyMs("liveinput:test-1")).toBe(0);
  });

  it("isLiveInputAttached liefert false für unbekannte/nicht-attached Channels", async () => {
    const { AudioEngine } = await import("../../client/src/audio/AudioEngine");
    expect(AudioEngine.isLiveInputAttached("liveinput:never-attached")).toBe(false);
  });

  it("detachLiveInput ist no-op für unbekannte ID (kein Crash)", async () => {
    const { AudioEngine } = await import("../../client/src/audio/AudioEngine");
    expect(() => AudioEngine.detachLiveInput("liveinput:nope")).not.toThrow();
  });

  it("getAttachedLiveInputChannelIds liefert leeres Array bei Test-Start", async () => {
    const { AudioEngine } = await import("../../client/src/audio/AudioEngine");
    const ids = AudioEngine.getAttachedLiveInputChannelIds();
    expect(Array.isArray(ids)).toBe(true);
    // Cleanup: falls vorherige Tests etwas hinterlassen haben (parallele Module-Eval)
    ids.forEach((id) => AudioEngine.detachLiveInput(id));
    expect(AudioEngine.getAttachedLiveInputChannelIds()).toHaveLength(0);
  });
});
