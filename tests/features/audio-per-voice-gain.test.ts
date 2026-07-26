/**
 * tests/features/audio-per-voice-gain.test.ts (v3.284.0)
 *
 * Regressionstest für den Wechsel von Volume-am-geteilten-Channel-Input auf
 * Volume-pro-Voice.
 *
 * Der behobene Fehler: `volume` enthält die Velocity des Steps
 * (`velocity/127 * part.volume`) und wurde als `nodes.input.gain.value` auf den
 * **geteilten** Kanal-Eingang geschrieben. Damit verbog jeder neue Step
 * rückwirkend die Lautstärke aller noch klingenden Voices desselben Parts — ein
 * leiser 16tel-Step mitten in einem langen Crash zog den Crash mit runter.
 *
 * Pan ist ausdrücklich NICHT betroffen und bleibt am Kanal-Panner: er stammt aus
 * `part.pan`, ist also pro Part konstant, überlappende Voices haben denselben
 * Wert. Ein Test unten hält das fest, damit die Unterscheidung nicht später
 * versehentlich „vereinheitlicht" wird.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── localStorage Mock ───────────────────────────────────────────────────────

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
  value: localStorageMock, writable: true, configurable: true,
});
if (typeof (globalThis as { window?: unknown }).window === "undefined") {
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: localStorageMock }, writable: true, configurable: true,
  });
}

// ─── Mock-AudioContext ───────────────────────────────────────────────────────

interface MockParam {
  value: number;
  setValueAtTime: (v: number, t?: number) => MockParam;
  linearRampToValueAtTime: (v: number, t?: number) => MockParam;
  exponentialRampToValueAtTime: (v: number, t?: number) => MockParam;
  setTargetAtTime: (v: number, t?: number, c?: number) => MockParam;
  setValueCurveAtTime: (...a: unknown[]) => MockParam;
  cancelScheduledValues: (t?: number) => MockParam;
  /** Alle je gesetzten Werte, in Reihenfolge — macht Rampen prüfbar. */
  __history: number[];
}

function makeParam(initial = 0): MockParam {
  const p = {
    value: initial,
    __history: [] as number[],
    setValueAtTime(v: number) { p.value = v; p.__history.push(v); return p; },
    linearRampToValueAtTime(v: number) { p.value = v; p.__history.push(v); return p; },
    exponentialRampToValueAtTime(v: number) { p.value = v; p.__history.push(v); return p; },
    setTargetAtTime(v: number) { p.value = v; p.__history.push(v); return p; },
    setValueCurveAtTime() { return p; },
    cancelScheduledValues() { return p; },
  };
  return p;
}

interface MockNode {
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  gain?: MockParam;
  pan?: MockParam;
  [k: string]: unknown;
}

function baseNode(): MockNode {
  return { connect: vi.fn(), disconnect: vi.fn() };
}

/** Jeder je erzeugte GainNode, in Erzeugungsreihenfolge. */
const createdGains: MockNode[] = [];
/** Jeder je erzeugte BufferSource. */
const createdSources: MockNode[] = [];

class MockAudioBuffer {
  numberOfChannels = 1;
  sampleRate = 44100;
  length = 44100;
  duration = 1;
  getChannelData() { return new Float32Array(this.length); }
}

class MockAudioContext {
  currentTime = 0;
  sampleRate = 44100;
  state: "suspended" | "running" = "running";
  destination = baseNode();
  audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
  resume = vi.fn().mockResolvedValue(undefined);
  decodeAudioData = vi.fn().mockResolvedValue(new MockAudioBuffer());
  createGain(): MockNode {
    const g: MockNode = { ...baseNode(), gain: makeParam(1) };
    createdGains.push(g);
    return g;
  }
  createStereoPanner(): MockNode { return { ...baseNode(), pan: makeParam(0) }; }
  createBiquadFilter(): MockNode {
    return { ...baseNode(), type: "lowpass", frequency: makeParam(8000), Q: makeParam(1), gain: makeParam(0) };
  }
  createWaveShaper(): MockNode { return { ...baseNode(), curve: null, oversample: "4x" }; }
  createDynamicsCompressor(): MockNode {
    return {
      ...baseNode(), threshold: makeParam(-24), ratio: makeParam(4),
      attack: makeParam(0.003), release: makeParam(0.25), knee: makeParam(30), reduction: 0,
    };
  }
  createDelay(): MockNode { return { ...baseNode(), delayTime: makeParam(0.25) }; }
  createConvolver(): MockNode { return { ...baseNode(), buffer: null }; }
  createAnalyser(): MockNode {
    return {
      ...baseNode(), fftSize: 512, smoothingTimeConstant: 0.8,
      getFloatTimeDomainData: vi.fn(), getByteFrequencyData: vi.fn(), frequencyBinCount: 256,
    };
  }
  createBuffer() { return new MockAudioBuffer(); }
  createOscillator(): MockNode {
    return {
      ...baseNode(), type: "sine", frequency: makeParam(440), detune: makeParam(0),
      start: vi.fn(), stop: vi.fn(),
    };
  }
  createBufferSource(): MockNode {
    const listeners: Record<string, (() => void)[]> = {};
    const src: MockNode = {
      ...baseNode(),
      buffer: null, loop: false, loopStart: 0, loopEnd: 0,
      playbackRate: makeParam(1),
      onended: null,
      start: vi.fn(),
      stop: vi.fn(),
      addEventListener: (ev: string, cb: () => void) => {
        (listeners[ev] ??= []).push(cb);
      },
      /** Test-Hilfe: simuliert das Ende der Voice. */
      __fireEnded: () => { (listeners["ended"] ?? []).forEach((cb) => cb()); },
    };
    createdSources.push(src);
    return src;
  }
}

(globalThis as Record<string, unknown>).AudioContext = MockAudioContext;
(globalThis as Record<string, unknown>).requestAnimationFrame = () => 0;
(globalThis as Record<string, unknown>).cancelAnimationFrame = () => { /* no-op */ };

// ─── Import + Helfer ─────────────────────────────────────────────────────────

import type { PartData } from "../../client/src/audio/AudioEngine";

let DEFAULT_CHANNEL_FX: typeof import("../../client/src/audio/AudioEngine").DEFAULT_CHANNEL_FX;

let AudioEngine: typeof import("../../client/src/audio/AudioEngine").AudioEngine;

function makePart(id: string, overrides: Partial<PartData> = {}): PartData {
  return {
    id,
    name: id,
    sampleUrl: `/fake/${id}.wav`,
    volume: 1,
    pan: 0,
    muted: false,
    soloed: false,
    steps: [],
    // Ohne fx wirft _applyFxToNodes — der Sequencer liefert hier immer welche.
    fx: { ...DEFAULT_CHANNEL_FX },
    ...overrides,
  } as PartData;
}

/** Der Kanal-Eingang eines Parts (privates Feld — Invariante ist genau das). */
function channelInputGain(partId: string): MockParam {
  const nodes = (AudioEngine as unknown as {
    channelNodes: Map<string, { input: MockNode; panner: MockNode }>;
  }).channelNodes.get(partId);
  if (!nodes) throw new Error(`keine Channel-Nodes für ${partId}`);
  return nodes.input.gain!;
}

function channelPan(partId: string): MockParam {
  const nodes = (AudioEngine as unknown as {
    channelNodes: Map<string, { input: MockNode; panner: MockNode }>;
  }).channelNodes.get(partId);
  if (!nodes) throw new Error(`keine Channel-Nodes für ${partId}`);
  return nodes.panner.pan!;
}

/** Die Voice-Gains, die seit dem Marker erzeugt wurden. */
function gainsSince(marker: number): MockNode[] {
  return createdGains.slice(marker);
}

beforeEach(async () => {
  vi.resetModules();
  createdGains.length = 0;
  createdSources.length = 0;
  localStorageMock.clear();
  const mod = await import("../../client/src/audio/AudioEngine");
  AudioEngine = mod.AudioEngine;
  DEFAULT_CHANNEL_FX = mod.DEFAULT_CHANNEL_FX;
  await AudioEngine.init();
});

// ─── triggerDrum: Volume pro Voice ───────────────────────────────────────────

describe("triggerDrum — Volume liegt pro Voice", () => {
  it("schreibt das Volume NICHT auf den geteilten Kanal-Eingang", () => {
    const part = makePart("p1");
    const buf = new MockAudioBuffer() as unknown as AudioBuffer;
    AudioEngine.triggerDrum("p1", buf, 0, 0.25, 0, 0, part);

    // Der Kanal-Eingang ist ein reiner Durchgang und bleibt bei 1.
    expect(channelInputGain("p1").value).toBe(1);
  });

  it("legt das Volume auf den Voice-Gain der jeweiligen Voice", () => {
    const part = makePart("p1");
    const buf = new MockAudioBuffer() as unknown as AudioBuffer;

    // Kanal einmal aufbauen, damit der Marker nur Voice-Gains erfasst.
    AudioEngine.triggerDrum("p1", buf, 0, 1, 0, 0, part);
    const marker = createdGains.length;

    AudioEngine.triggerDrum("p1", buf, 0, 0.25, 0, 0, part);
    const voiceGains = gainsSince(marker);
    expect(voiceGains).toHaveLength(1);
    expect(voiceGains[0].gain!.value).toBeCloseTo(0.25, 6);
  });

  it("zwei überlappende Voices behalten ihr eigenes Volume — der Kern des Fehlers", () => {
    const part = makePart("p1");
    const buf = new MockAudioBuffer() as unknown as AudioBuffer;

    AudioEngine.triggerDrum("p1", buf, 0, 1, 0, 0, part); // Kanal-Aufbau
    const marker = createdGains.length;

    // Lauter Crash, danach ein leiser Step desselben Parts.
    AudioEngine.triggerDrum("p1", buf, 0, 1.0, 0, 0, part);
    AudioEngine.triggerDrum("p1", buf, 0, 0.1, 0, 0, part);

    const [loud, quiet] = gainsSince(marker);
    // Vorher hätte der zweite Trigger den ersten mit runtergezogen, weil beide
    // am selben nodes.input hingen.
    expect(loud.gain!.value).toBeCloseTo(1.0, 6);
    expect(quiet.gain!.value).toBeCloseTo(0.1, 6);
  });

  it("begrenzt das Volume auf 0..2", () => {
    const part = makePart("p1");
    const buf = new MockAudioBuffer() as unknown as AudioBuffer;
    AudioEngine.triggerDrum("p1", buf, 0, 1, 0, 0, part);

    let marker = createdGains.length;
    AudioEngine.triggerDrum("p1", buf, 0, 99, 0, 0, part);
    expect(gainsSince(marker)[0].gain!.value).toBe(2);

    marker = createdGains.length;
    AudioEngine.triggerDrum("p1", buf, 0, -5, 0, 0, part);
    expect(gainsSince(marker)[0].gain!.value).toBe(0);
  });

  it("hält Voices verschiedener Parts auseinander", () => {
    const buf = new MockAudioBuffer() as unknown as AudioBuffer;
    AudioEngine.triggerDrum("a", buf, 0, 0.4, 0, 0, makePart("a"));
    AudioEngine.triggerDrum("b", buf, 0, 0.9, 0, 0, makePart("b"));

    // Beide Kanal-Eingänge unangetastet.
    expect(channelInputGain("a").value).toBe(1);
    expect(channelInputGain("b").value).toBe(1);
  });
});

// ─── Pan bleibt bewusst am Kanal ─────────────────────────────────────────────

describe("Pan bleibt am Kanal-Panner", () => {
  it("schreibt den Pan weiterhin auf den Kanal — pro Part konstant, kein Fehler", () => {
    const part = makePart("p1", { pan: -0.5 });
    const buf = new MockAudioBuffer() as unknown as AudioBuffer;
    AudioEngine.triggerDrum("p1", buf, 0, 1, -0.5, 0, part);

    expect(channelPan("p1").value).toBeCloseTo(-0.5, 6);
  });

  it("begrenzt den Pan auf -1..1", () => {
    const part = makePart("p1");
    const buf = new MockAudioBuffer() as unknown as AudioBuffer;
    AudioEngine.triggerDrum("p1", buf, 0, 1, -9, 0, part);
    expect(channelPan("p1").value).toBe(-1);
    AudioEngine.triggerDrum("p1", buf, 0, 1, 9, 0, part);
    expect(channelPan("p1").value).toBe(1);
  });
});

// ─── _triggerBufferWithFx: Fade-in auf das Voice-Volume ──────────────────────

describe("_triggerBufferWithFx — Fade-in endet auf dem Voice-Volume", () => {
  /** Der Sequencer-Pfad ist privat; direkt aufrufen ist hier der Punkt. */
  function triggerWithFx(part: PartData, volume: number) {
    const buf = new MockAudioBuffer() as unknown as AudioBuffer;
    (AudioEngine as unknown as {
      _triggerBufferWithFx: (
        b: AudioBuffer, t: number, v: number, p: number, pitch: number, part: PartData, m?: number,
      ) => void;
    })._triggerBufferWithFx(buf, 0, volume, 0, 0, part, 1);
  }

  it("rampt von 0 auf das Volume der Voice, nicht auf 1", () => {
    const part = makePart("p1");
    triggerWithFx(part, 1); // Kanal-Aufbau
    const marker = createdGains.length;

    triggerWithFx(part, 0.3);
    const voice = gainsSince(marker)[0];
    // Erst 0 (Klick-Vermeidung), dann das Ziel-Volume — nicht 1.
    expect(voice.gain!.__history).toEqual([0, 0.3]);
    expect(voice.gain!.value).toBeCloseTo(0.3, 6);
  });

  it("lässt den Kanal-Eingang unangetastet", () => {
    const part = makePart("p1");
    triggerWithFx(part, 0.42);
    expect(channelInputGain("p1").value).toBe(1);
  });

  it("gibt jeder Voice ihre eigene Rampe", () => {
    const part = makePart("p1");
    triggerWithFx(part, 1);
    const marker = createdGains.length;

    triggerWithFx(part, 0.8);
    triggerWithFx(part, 0.2);
    const [first, second] = gainsSince(marker);
    expect(first.gain!.__history).toEqual([0, 0.8]);
    expect(second.gain!.__history).toEqual([0, 0.2]);
  });
});

// ─── applyParamLock ──────────────────────────────────────────────────────────

describe("applyParamLock — Volume-Lock hält jetzt", () => {
  it("setzt das Lock und stellt den Kanal-Basiswert wieder her", () => {
    const part = makePart("p1");
    const buf = new MockAudioBuffer() as unknown as AudioBuffer;
    AudioEngine.triggerDrum("p1", buf, 0, 0.5, 0, 0, part);

    const input = channelInputGain("p1");
    input.__history.length = 0;

    AudioEngine.applyParamLock("p1", { volume: 0.2 }, 0.25);

    // Erst der Lock-Wert, dann zurück auf den Basiswert des Kanals (1) —
    // nicht auf ein zufällig zuletzt getriggertes Step-Volume.
    expect(input.__history).toEqual([0.2, 1]);
  });

  it("tut nichts für einen Part ohne Kanal-Nodes", () => {
    expect(() => AudioEngine.applyParamLock("gibtsNicht", { volume: 0.5 }, 0.25)).not.toThrow();
  });
});

// ─── Voice-Hygiene ───────────────────────────────────────────────────────────

describe("Voice-Aufräumen", () => {
  it("trennt Source UND Voice-Gain, wenn die Voice endet", () => {
    // Der Voice-Gain trägt jetzt das Volume — er darf trotzdem nicht am
    // Kanal-Eingang hängen bleiben, sonst sammelt sich pro Step ein Knoten an.
    const part = makePart("p1");
    const buf = new MockAudioBuffer() as unknown as AudioBuffer;
    AudioEngine.triggerDrum("p1", buf, 0, 1, 0, 0, part);
    const marker = createdGains.length;

    AudioEngine.triggerDrum("p1", buf, 0, 0.6, 0, 0, part);
    const voiceGain = gainsSince(marker)[0];
    const source = createdSources[createdSources.length - 1];

    expect(voiceGain.disconnect).not.toHaveBeenCalled();
    (source.__fireEnded as () => void)();
    expect(source.disconnect).toHaveBeenCalled();
    expect(voiceGain.disconnect).toHaveBeenCalled();
  });
});
