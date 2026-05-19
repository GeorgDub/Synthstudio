/**
 * tests/features/audio-track.test.ts
 *
 * Unit-Tests fuer die externen Audio-Track-Channels in AudioEngine.ts
 * (TASK-102 / F1 — v1.16.0).
 *
 * Da Vitest mit `environment: "node"` laeuft, sind Web Audio API,
 * `window`, `requestAnimationFrame` etc. nicht vorhanden. Wir setzen
 * vor dem Import der Engine globale Stubs auf, die das Verhalten ohne
 * echte AudioNodes simulieren.
 *
 * Coverage:
 *  - loadAudioTrack  (cache + File-Pfad + File-Objekt)
 *  - registerAudioTrack + playAudioTrack (Source-Erzeugung)
 *  - stopAudioTrack
 *  - setAudioTrackVolume delegiert an setChannelVolume
 *  - setBpm aktualisiert playbackRate fuer syncMode "stretch"
 *  - seekAudioTrack startet neu wenn aktiv
 *  - disposeAudioTrack raeumt alle Maps + rAF
 *  - playAllRegisteredAudioTracks ueberspringt muted und nutzt getter
 *  - onAudioTrackPosition Listener-Registrierung
 *  - onAudioTrackEnded
 *  - setAudioTrackMute / setAudioTrackSolo Verhalten
 *  - getAudioTrackDuration
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ─── Globale Stubs vor Import der Engine ─────────────────────────────────────

interface MockParam {
  value: number;
  setValueAtTime: (v: number, _t: number) => void;
  setTargetAtTime: (v: number, _t: number, _c: number) => void;
  linearRampToValueAtTime: (v: number, _t: number) => void;
  cancelScheduledValues: (_t: number) => void;
}

function makeParam(initial = 0): MockParam {
  return {
    value: initial,
    setValueAtTime(v: number) { this.value = v; },
    setTargetAtTime(v: number) { this.value = v; },
    linearRampToValueAtTime(v: number) { this.value = v; },
    cancelScheduledValues() { /* no-op */ },
  };
}

interface MockNode {
  connect: (n?: unknown) => void;
  disconnect: () => void;
  start?: (..._args: number[]) => void;
  stop?: () => void;
  onended?: (() => void) | null;
  buffer?: unknown;
  loop?: boolean;
  type?: string;
  curve?: Float32Array | null;
  oversample?: string;
  gain?: MockParam;
  pan?: MockParam;
  frequency?: MockParam;
  Q?: MockParam;
  threshold?: MockParam;
  ratio?: MockParam;
  attack?: MockParam;
  release?: MockParam;
  delayTime?: MockParam;
  reduction?: number;
  playbackRate?: MockParam;
  __started?: boolean;
  __stopped?: boolean;
  __startArgs?: number[];
  __isSource?: boolean;
}

function makeBaseNode(): MockNode {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

// Globaler Track-Source-Sammler: damit Tests die zuletzt erzeugte Source pruefen koennen.
const __createdSources: MockNode[] = [];

class MockAudioBuffer {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  duration: number;
  private data: Float32Array[];
  constructor(channels: number, length: number, sampleRate: number) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.data = Array.from({ length: channels }, () => new Float32Array(length));
  }
  getChannelData(c: number): Float32Array { return this.data[c]; }
}

class MockAudioContext {
  currentTime = 0;
  sampleRate = 44100;
  state: "suspended" | "running" = "running";
  destination = makeBaseNode();
  audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };

  resume = vi.fn().mockResolvedValue(undefined);
  decodeAudioData = vi.fn().mockResolvedValue(new MockAudioBuffer(2, 44100, 44100));

  createGain(): MockNode {
    return { ...makeBaseNode(), gain: makeParam(1) };
  }
  createStereoPanner(): MockNode {
    return { ...makeBaseNode(), pan: makeParam(0) };
  }
  createBiquadFilter(): MockNode {
    return {
      ...makeBaseNode(),
      type: "lowpass",
      frequency: makeParam(8000),
      Q: makeParam(1),
      gain: makeParam(0),
    };
  }
  createWaveShaper(): MockNode {
    return { ...makeBaseNode(), curve: null, oversample: "4x" };
  }
  createDynamicsCompressor(): MockNode {
    return {
      ...makeBaseNode(),
      threshold: makeParam(-24),
      ratio: makeParam(4),
      attack: makeParam(0.003),
      release: makeParam(0.25),
      knee: makeParam(30),
      reduction: 0,
    };
  }
  createDelay(): MockNode {
    return { ...makeBaseNode(), delayTime: makeParam(0.25) };
  }
  createConvolver(): MockNode {
    return { ...makeBaseNode(), buffer: null };
  }
  createAnalyser(): MockNode {
    return {
      ...makeBaseNode(),
      // @ts-expect-error mock-only
      fftSize: 512,
      smoothingTimeConstant: 0.8,
      getFloatTimeDomainData: vi.fn(),
    };
  }
  createBuffer(channels: number, length: number, sr: number): MockAudioBuffer {
    return new MockAudioBuffer(channels, length, sr);
  }
  createBufferSource(): MockNode {
    const src: MockNode = {
      ...makeBaseNode(),
      __isSource: true,
      __started: false,
      __stopped: false,
      __startArgs: [],
      onended: null,
      buffer: null,
      loop: false,
      playbackRate: makeParam(1),
      start(when = 0, offset = 0) {
        this.__started = true;
        this.__startArgs = [when, offset];
      },
      stop() {
        this.__stopped = true;
      },
    };
    __createdSources.push(src);
    return src;
  }
  createOscillator(): MockNode {
    return {
      ...makeBaseNode(),
      type: "sine",
      frequency: makeParam(440),
      start: vi.fn(),
      stop: vi.fn(),
    };
  }
}

// rAF/cAF: kontrollierbar, damit kein echter Frame-Loop laeuft.
const rafCallbacks = new Map<number, FrameRequestCallback>();
let rafCounter = 1;

// Globals registrieren VOR dem Import der Engine.
(globalThis as Record<string, unknown>).AudioContext = MockAudioContext;
(globalThis as Record<string, unknown>).requestAnimationFrame = (cb: FrameRequestCallback) => {
  const id = rafCounter++;
  rafCallbacks.set(id, cb);
  return id;
};
(globalThis as Record<string, unknown>).cancelAnimationFrame = (id: number) => {
  rafCallbacks.delete(id);
};
// window-Objekt minimal stubben (electronAPI nicht vorhanden -> _loadBuffer faellt auf fetch).
if (typeof (globalThis as Record<string, unknown>).window === "undefined") {
  (globalThis as Record<string, unknown>).window = {};
}

// Dynamischer Import nach Mock-Setup
import type { AudioTrackChannelData } from "../../client/src/audio/AudioEngine";

let AudioEngine: typeof import("../../client/src/audio/AudioEngine").AudioEngine;

beforeEach(async () => {
  // Singleton zwischen Tests resetten: Modul re-importieren mit isolierter Registry.
  vi.resetModules();
  __createdSources.length = 0;
  rafCallbacks.clear();
  rafCounter = 1;
  const mod = await import("../../client/src/audio/AudioEngine");
  AudioEngine = mod.AudioEngine;
  await AudioEngine.init();
});

afterEach(() => {
  // Cleanup: alle Tracks entfernen falls Test sie hinterlassen hat.
  // Wir nutzen disposeAudioTrack direkt auf den IDs, die in Tests verwendet werden.
});

// ─── Helper ────────────────────────────────────────────────────────────────

function makeTrackData(overrides: Partial<AudioTrackChannelData> = {}): AudioTrackChannelData {
  return {
    id: overrides.id ?? "audiotrack:test-1",
    name: "Test Vocal",
    filePath: "/fake/path/vocal.wav",
    fileName: "vocal.wav",
    volume: 1,
    pan: 0,
    muted: false,
    soloed: false,
    sends: { reverb: 0, delay: 0 },
    syncMode: "free",
    originalBpm: null,
    ...overrides,
  };
}

async function loadFakeBuffer(id: string, durationSec = 10): Promise<void> {
  // Wir umgehen _loadBuffer komplett, indem wir die loadAudioTrack mit File-Objekt
  // aufrufen. decodeAudioData liefert einen MockAudioBuffer.
  const fakeFile = {
    arrayBuffer: async () => new ArrayBuffer(1024),
  } as unknown as File;
  // decodeAudioData wird durch MockAudioContext implementiert; liefert 1s default,
  // wir override per direct call wenn andere Dauer benoetigt:
  const ctx = AudioEngine.getAudioContext() as unknown as MockAudioContext;
  ctx.decodeAudioData = vi.fn().mockResolvedValue(
    new MockAudioBuffer(2, Math.round(durationSec * 44100), 44100),
  );
  await AudioEngine.loadAudioTrack(id, fakeFile);
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("AudioTrack: loadAudioTrack", () => {
  it("cached Buffer beim zweiten Aufruf (gleiche ID)", async () => {
    const id = "audiotrack:cache-1";
    await loadFakeBuffer(id, 5);
    const ctx = AudioEngine.getAudioContext() as unknown as MockAudioContext;
    const decodeSpy = ctx.decodeAudioData as ReturnType<typeof vi.fn>;
    const callsBefore = decodeSpy.mock.calls.length;

    // Zweiter Load mit gleicher ID -> sollte cached buffer zurueckgeben, kein decode.
    const fakeFile = { arrayBuffer: async () => new ArrayBuffer(64) } as unknown as File;
    const buf = await AudioEngine.loadAudioTrack(id, fakeFile);
    expect(buf).not.toBeNull();
    expect(decodeSpy.mock.calls.length).toBe(callsBefore);

    AudioEngine.disposeAudioTrack(id);
  });

  it("liefert null bei decode-Fehler", async () => {
    const id = "audiotrack:decode-fail";
    const ctx = AudioEngine.getAudioContext() as unknown as MockAudioContext;
    ctx.decodeAudioData = vi.fn().mockRejectedValue(new Error("decode error"));
    const fakeFile = { arrayBuffer: async () => new ArrayBuffer(64) } as unknown as File;
    const buf = await AudioEngine.loadAudioTrack(id, fakeFile);
    expect(buf).toBeNull();
  });
});

describe("AudioTrack: register + play", () => {
  it("registerAudioTrack + playAudioTrack startet AudioBufferSourceNode", async () => {
    const id = "audiotrack:play-1";
    await loadFakeBuffer(id, 5);
    AudioEngine.registerAudioTrack(makeTrackData({ id }));

    const beforeCount = __createdSources.length;
    AudioEngine.playAudioTrack(id);
    const afterCount = __createdSources.length;

    expect(afterCount).toBe(beforeCount + 1);
    const latest = __createdSources[afterCount - 1];
    expect(latest.__started).toBe(true);
    expect(latest.__startArgs?.[1]).toBe(0); // offset default 0

    AudioEngine.disposeAudioTrack(id);
  });

  it("playAudioTrack mit startOffsetSec setzt den Buffer-Offset", async () => {
    const id = "audiotrack:offset";
    await loadFakeBuffer(id, 5);
    AudioEngine.registerAudioTrack(makeTrackData({ id }));
    AudioEngine.playAudioTrack(id, { startOffsetSec: 2.5 });
    const latest = __createdSources[__createdSources.length - 1];
    expect(latest.__startArgs?.[1]).toBe(2.5);
    AudioEngine.disposeAudioTrack(id);
  });
});

describe("AudioTrack: stopAudioTrack", () => {
  it("stoppt die Source und ruft cleanup auf", async () => {
    const id = "audiotrack:stop";
    await loadFakeBuffer(id, 5);
    AudioEngine.registerAudioTrack(makeTrackData({ id }));
    AudioEngine.playAudioTrack(id);
    const latest = __createdSources[__createdSources.length - 1];

    AudioEngine.stopAudioTrack(id);
    expect(latest.__stopped).toBe(true);

    // Erneutes Stoppen ist no-op (kein Throw).
    expect(() => AudioEngine.stopAudioTrack(id)).not.toThrow();

    AudioEngine.disposeAudioTrack(id);
  });
});

describe("AudioTrack: setAudioTrackVolume", () => {
  it("delegiert an setChannelVolume und persistiert in metadata", async () => {
    const id = "audiotrack:vol";
    await loadFakeBuffer(id, 5);
    AudioEngine.registerAudioTrack(makeTrackData({ id, volume: 1 }));

    const spy = vi.spyOn(AudioEngine, "setChannelVolume");
    AudioEngine.setAudioTrackVolume(id, 0.42);
    expect(spy).toHaveBeenCalledWith(id, 0.42);
    spy.mockRestore();

    AudioEngine.disposeAudioTrack(id);
  });

  it("setzt Volume NICHT direkt wenn muted=true (bleibt auf 0)", async () => {
    const id = "audiotrack:vol-muted";
    await loadFakeBuffer(id, 5);
    AudioEngine.registerAudioTrack(makeTrackData({ id, muted: true }));
    const spy = vi.spyOn(AudioEngine, "setChannelVolume");
    AudioEngine.setAudioTrackVolume(id, 0.8);
    // setChannelVolume mit dem neuen volume-Wert NICHT aufgerufen,
    // weil der Track stumm bleibt bis unmute.
    const calledWithNewVol = spy.mock.calls.some(c => c[0] === id && c[1] === 0.8);
    expect(calledWithNewVol).toBe(false);
    spy.mockRestore();
    AudioEngine.disposeAudioTrack(id);
  });
});

describe("AudioTrack: setBpm + playbackRate sync", () => {
  it("syncMode='stretch' + originalBpm=120: playbackRate = bpm / 120", async () => {
    const id = "audiotrack:stretch";
    await loadFakeBuffer(id, 5);
    AudioEngine.registerAudioTrack(makeTrackData({
      id,
      syncMode: "stretch",
      originalBpm: 120,
    }));
    AudioEngine.setBpm(140);
    AudioEngine.playAudioTrack(id);
    const latest = __createdSources[__createdSources.length - 1];
    expect(latest.playbackRate?.value).toBeCloseTo(140 / 120, 5);

    // BPM-Wechsel waehrend Wiedergabe -> Rate update.
    AudioEngine.setBpm(180);
    expect(latest.playbackRate?.value).toBeCloseTo(180 / 120, 5);

    AudioEngine.disposeAudioTrack(id);
  });

  it("syncMode='free': playbackRate bleibt 1.0 unabhaengig vom BPM", async () => {
    const id = "audiotrack:free";
    await loadFakeBuffer(id, 5);
    AudioEngine.registerAudioTrack(makeTrackData({
      id,
      syncMode: "free",
      originalBpm: 120,
    }));
    AudioEngine.setBpm(180);
    AudioEngine.playAudioTrack(id);
    const latest = __createdSources[__createdSources.length - 1];
    expect(latest.playbackRate?.value).toBe(1);
    AudioEngine.disposeAudioTrack(id);
  });
});

describe("AudioTrack: seekAudioTrack", () => {
  it("erzeugt neue Source mit korrektem Offset wenn aktiv", async () => {
    const id = "audiotrack:seek";
    await loadFakeBuffer(id, 10);
    AudioEngine.registerAudioTrack(makeTrackData({ id }));
    AudioEngine.playAudioTrack(id);
    const beforeCount = __createdSources.length;

    AudioEngine.seekAudioTrack(id, 3.5);
    const afterCount = __createdSources.length;
    expect(afterCount).toBe(beforeCount + 1);
    const latest = __createdSources[afterCount - 1];
    expect(latest.__startArgs?.[1]).toBe(3.5);

    AudioEngine.disposeAudioTrack(id);
  });

  it("kein Replay wenn Track nicht aktiv (nur Metadaten-Update)", async () => {
    const id = "audiotrack:seek-inactive";
    await loadFakeBuffer(id, 10);
    AudioEngine.registerAudioTrack(makeTrackData({ id }));
    const beforeCount = __createdSources.length;
    AudioEngine.seekAudioTrack(id, 4);
    expect(__createdSources.length).toBe(beforeCount);
    AudioEngine.disposeAudioTrack(id);
  });
});

describe("AudioTrack: disposeAudioTrack", () => {
  it("entfernt Buffer, Source, Listener und rAF", async () => {
    const id = "audiotrack:dispose";
    await loadFakeBuffer(id, 5);
    AudioEngine.registerAudioTrack(makeTrackData({ id }));
    AudioEngine.playAudioTrack(id);

    // Position-Listener registrieren -> startet rAF.
    const posCb = vi.fn();
    AudioEngine.onAudioTrackPosition(id, posCb);
    expect(rafCallbacks.size).toBeGreaterThan(0);

    AudioEngine.disposeAudioTrack(id);

    // Duration ist null (Buffer entfernt).
    expect(AudioEngine.getAudioTrackDuration(id)).toBeNull();

    // Erneutes Dispose ist no-op (kein Throw).
    expect(() => AudioEngine.disposeAudioTrack(id)).not.toThrow();
  });
});

describe("AudioTrack: playAllRegisteredAudioTracks", () => {
  it("iteriert audioTracksGetter() und ueberspringt muted Tracks", async () => {
    const idA = "audiotrack:all-A";
    const idB = "audiotrack:all-B";
    const idC = "audiotrack:all-C";

    await loadFakeBuffer(idA, 5);
    await loadFakeBuffer(idB, 5);
    await loadFakeBuffer(idC, 5);

    AudioEngine.registerAudioTrack(makeTrackData({ id: idA }));
    AudioEngine.registerAudioTrack(makeTrackData({ id: idB, muted: true }));
    AudioEngine.registerAudioTrack(makeTrackData({ id: idC }));

    AudioEngine.setAudioTracksGetter(() => [
      makeTrackData({ id: idA }),
      makeTrackData({ id: idB, muted: true }),
      makeTrackData({ id: idC }),
    ]);

    const beforeCount = __createdSources.length;
    AudioEngine.playAllRegisteredAudioTracks();
    const startedSources = __createdSources.slice(beforeCount);

    // Genau 2 Sources erzeugt (A und C); B muted ueberspringen.
    expect(startedSources.length).toBe(2);
    expect(startedSources.every(s => s.__started)).toBe(true);

    AudioEngine.stopAllAudioTracks();
    AudioEngine.disposeAudioTrack(idA);
    AudioEngine.disposeAudioTrack(idB);
    AudioEngine.disposeAudioTrack(idC);
  });

  it("stopAllAudioTracks stoppt alle aktiven Sources", async () => {
    const idA = "audiotrack:stop-all-A";
    const idB = "audiotrack:stop-all-B";
    await loadFakeBuffer(idA, 5);
    await loadFakeBuffer(idB, 5);
    AudioEngine.registerAudioTrack(makeTrackData({ id: idA }));
    AudioEngine.registerAudioTrack(makeTrackData({ id: idB }));
    AudioEngine.playAudioTrack(idA);
    AudioEngine.playAudioTrack(idB);

    const srcA = __createdSources[__createdSources.length - 2];
    const srcB = __createdSources[__createdSources.length - 1];

    AudioEngine.stopAllAudioTracks();
    expect(srcA.__stopped).toBe(true);
    expect(srcB.__stopped).toBe(true);

    AudioEngine.disposeAudioTrack(idA);
    AudioEngine.disposeAudioTrack(idB);
  });
});

describe("AudioTrack: position + ended listeners", () => {
  it("onAudioTrackPosition registriert Listener + liefert Unsub", async () => {
    const id = "audiotrack:pos";
    await loadFakeBuffer(id, 5);
    AudioEngine.registerAudioTrack(makeTrackData({ id }));
    AudioEngine.playAudioTrack(id);

    const cb = vi.fn();
    const unsub = AudioEngine.onAudioTrackPosition(id, cb);
    expect(typeof unsub).toBe("function");
    expect(rafCallbacks.size).toBeGreaterThan(0);

    // rAF einmal manuell triggern um Callback zu pruefen.
    const ctx = AudioEngine.getAudioContext() as unknown as MockAudioContext;
    ctx.currentTime = 0.5;
    const firstRafCb = rafCallbacks.values().next().value;
    if (firstRafCb) firstRafCb(0);

    expect(cb).toHaveBeenCalled();
    const [pos01, sec] = cb.mock.calls[0];
    expect(typeof pos01).toBe("number");
    expect(typeof sec).toBe("number");
    expect(sec).toBeGreaterThanOrEqual(0);

    unsub();
    AudioEngine.disposeAudioTrack(id);
  });

  it("onAudioTrackEnded feuert wenn Source.onended ausloest", async () => {
    const id = "audiotrack:ended";
    await loadFakeBuffer(id, 5);
    AudioEngine.registerAudioTrack(makeTrackData({ id }));

    const cb = vi.fn();
    AudioEngine.onAudioTrackEnded(id, cb);

    AudioEngine.playAudioTrack(id);
    const src = __createdSources[__createdSources.length - 1];
    src.onended?.();
    expect(cb).toHaveBeenCalledTimes(1);

    AudioEngine.disposeAudioTrack(id);
  });
});

describe("AudioTrack: mute + solo", () => {
  it("setAudioTrackMute(true) setzt Volume auf 0, unmute stellt wieder her", async () => {
    const id = "audiotrack:mute";
    await loadFakeBuffer(id, 5);
    AudioEngine.registerAudioTrack(makeTrackData({ id, volume: 0.7 }));

    const spy = vi.spyOn(AudioEngine, "setChannelVolume");
    AudioEngine.setAudioTrackMute(id, true);
    expect(spy).toHaveBeenCalledWith(id, 0);

    spy.mockClear();
    AudioEngine.setAudioTrackMute(id, false);
    // Beim Unmute wird volume aus metadata uebernommen.
    const restored = spy.mock.calls.find(c => c[0] === id && c[1] === 0.7);
    expect(restored).toBeDefined();
    spy.mockRestore();
    AudioEngine.disposeAudioTrack(id);
  });

  it("setAudioTrackSolo: andere audio-tracks werden stumm geschaltet", async () => {
    const idA = "audiotrack:solo-A";
    const idB = "audiotrack:solo-B";
    await loadFakeBuffer(idA, 5);
    await loadFakeBuffer(idB, 5);
    AudioEngine.registerAudioTrack(makeTrackData({ id: idA, volume: 0.5 }));
    AudioEngine.registerAudioTrack(makeTrackData({ id: idB, volume: 0.8 }));

    const spy = vi.spyOn(AudioEngine, "setChannelVolume");
    AudioEngine.setAudioTrackSolo(idA, true);

    // B sollte auf 0 gesetzt sein (anderer Track soloed),
    // A bleibt bei seinem volume (0.5).
    const bMuted = spy.mock.calls.find(c => c[0] === idB && c[1] === 0);
    const aOn = spy.mock.calls.find(c => c[0] === idA && c[1] === 0.5);
    expect(bMuted).toBeDefined();
    expect(aOn).toBeDefined();
    spy.mockRestore();

    AudioEngine.disposeAudioTrack(idA);
    AudioEngine.disposeAudioTrack(idB);
  });
});

describe("AudioTrack: getAudioTrackDuration", () => {
  it("liefert die Dauer des geladenen Buffers", async () => {
    const id = "audiotrack:dur";
    await loadFakeBuffer(id, 7.5);
    const dur = AudioEngine.getAudioTrackDuration(id);
    expect(dur).not.toBeNull();
    expect(dur!).toBeCloseTo(7.5, 3);
    AudioEngine.disposeAudioTrack(id);
  });

  it("liefert null wenn nichts geladen ist", () => {
    const dur = AudioEngine.getAudioTrackDuration("audiotrack:does-not-exist");
    expect(dur).toBeNull();
  });
});
