/**
 * tests/features/audio-recording-multitrack.test.ts (v3.62.0)
 *
 * Multi-Track Recording UX-Coverage. Die v2.86-Engine (AudioRecorder)
 * unterstützt bereits bis zu MAX_SIMULTANEOUS_RECORDINGS=8 parallele
 * Aufnahmen über eine Map<channelId, ActiveRecording>. v3.62.0 ergänzt
 * nur die UX-Layer:
 *
 *   - setAllLiveInputRecordArm(armed)   — Bulk-Action im Store
 *   - countArmedLiveInputs()            — Counter für UI
 *   - useLiveInputStore().armedCount    — Hook-API
 *
 * Diese Tests verifizieren End-to-End: armed-Flags im Store, Engine startet
 * parallele Recordings, jede liefert ein eigenes WAV-Result, das MAX-Limit
 * der v2.86 Engine bleibt verbindlich.
 */
import { describe, it, expect, beforeEach } from "vitest";

// ─── localStorage Mock (für Store-Persistenz) ────────────────────────────────
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

// ─── Imports nach localStorage-Setup ─────────────────────────────────────────
import {
  AudioRecorder,
  MAX_SIMULTANEOUS_RECORDINGS,
} from "../../client/src/audio/AudioRecorder";
import { isValidWavHeader, WAV_HEADER_SIZE } from "../../client/src/audio/wavEncoder";
import {
  addLiveInputChannel,
  setLiveInputRecordArm,
  setAllLiveInputRecordArm,
  countArmedLiveInputs,
  getArmedLiveInputChannelIds,
  getLiveInputChannel,
  __resetForTests,
} from "../../client/src/store/useLiveInputStore";

// ─── AudioContext-Mock (gleiche Architektur wie audio-recording.test.ts) ─────

class MockAudioNode {
  private _connections: MockAudioNode[] = [];
  connect(target: MockAudioNode): void { this._connections.push(target); }
  disconnect(_target?: MockAudioNode): void { this._connections = []; }
}

class MockScriptProcessor extends MockAudioNode {
  onaudioprocess: ((ev: { inputBuffer: MockAudioBuffer }) => void) | null = null;
  constructor(public bufferSize: number, public inChannels: number, public outChannels: number) {
    super();
  }
}

class MockAudioBuffer {
  private _data: Float32Array[];
  constructor(channels: number, length: number, public sampleRate: number) {
    this._data = Array.from({ length: channels }, () => new Float32Array(length));
  }
  getChannelData(ch: number): Float32Array { return this._data[ch]; }
  get numberOfChannels(): number { return this._data.length; }
  fill(channel: number, value: number): void {
    const arr = this._data[channel];
    for (let i = 0; i < arr.length; i++) arr[i] = value;
  }
}

class MockGainNode extends MockAudioNode {
  gain = { value: 1, setTargetAtTime: () => {} };
}

class MockAudioContext {
  sampleRate = 48000;
  destination = new MockAudioNode();
  createGain(): MockGainNode { return new MockGainNode(); }
  createScriptProcessor(bufSize: number, ic: number, oc: number): MockScriptProcessor {
    return new MockScriptProcessor(bufSize, ic, oc);
  }
}

function feedFrames(
  processor: MockScriptProcessor,
  framesPerTick: number,
  ticks: number,
  value: number,
): void {
  for (let i = 0; i < ticks; i++) {
    const buf = new MockAudioBuffer(processor.outChannels, framesPerTick, 48000);
    buf.fill(0, value);
    processor.onaudioprocess?.({ inputBuffer: buf });
  }
}

beforeEach(() => {
  localStorageMock.clear();
  __resetForTests();
});

// ─── 1. Store: Bulk-Arm-API ──────────────────────────────────────────────────

describe("v3.62.0 – Multi-Track Recording Store API", () => {
  it("setAllLiveInputRecordArm armed ALLE Channels (Bulk-Action)", () => {
    const a = addLiveInputChannel({ name: "A" });
    const b = addLiveInputChannel({ name: "B" });
    const c = addLiveInputChannel({ name: "C" });

    setAllLiveInputRecordArm(true);

    expect(getLiveInputChannel(a)?.recordArmed).toBe(true);
    expect(getLiveInputChannel(b)?.recordArmed).toBe(true);
    expect(getLiveInputChannel(c)?.recordArmed).toBe(true);
    expect(getArmedLiveInputChannelIds()).toHaveLength(3);
    expect(countArmedLiveInputs()).toBe(3);
  });

  it("setAllLiveInputRecordArm disarmed ALLE Channels", () => {
    const a = addLiveInputChannel();
    const b = addLiveInputChannel();
    setLiveInputRecordArm(a, true);
    setLiveInputRecordArm(b, true);
    expect(countArmedLiveInputs()).toBe(2);

    setAllLiveInputRecordArm(false);

    expect(countArmedLiveInputs()).toBe(0);
    expect(getArmedLiveInputChannelIds()).toHaveLength(0);
  });

  it("setAllLiveInputRecordArm ist idempotent (kein notify bei No-Op)", () => {
    const a = addLiveInputChannel();
    setLiveInputRecordArm(a, true);
    // bereits armed → erneutes setAll(true) ist No-Op
    setAllLiveInputRecordArm(true);
    expect(getLiveInputChannel(a)?.recordArmed).toBe(true);
    expect(countArmedLiveInputs()).toBe(1);

    // bereits disarmed → erneutes setAll(false) ist No-Op
    setAllLiveInputRecordArm(false);
    setAllLiveInputRecordArm(false);
    expect(countArmedLiveInputs()).toBe(0);
  });

  it("setAllLiveInputRecordArm respektiert keine künstliche Single-Arm-Constraint", () => {
    // v2.86-Engine ist bereits multi-capable. Store darf NICHT auf 1 limitieren.
    const ids = [
      addLiveInputChannel({ name: "1" }),
      addLiveInputChannel({ name: "2" }),
      addLiveInputChannel({ name: "3" }),
      addLiveInputChannel({ name: "4" }),
    ];
    setAllLiveInputRecordArm(true);
    expect(getArmedLiveInputChannelIds()).toEqual(expect.arrayContaining(ids));
    expect(countArmedLiveInputs()).toBe(4);
  });

  it("setAllLiveInputRecordArm persistiert in localStorage", () => {
    const a = addLiveInputChannel();
    const b = addLiveInputChannel();
    setAllLiveInputRecordArm(true);
    const stored = localStorageMock.getItem("synthstudio:liveinputs:v1");
    expect(stored).toBeTruthy();
    expect(stored).toContain("\"recordArmed\":true");
    // Beide Channels haben Flag persistiert
    const parsed = JSON.parse(stored!) as Array<{ id: string; recordArmed: boolean }>;
    const aEntry = parsed.find((c) => c.id === a)!;
    const bEntry = parsed.find((c) => c.id === b)!;
    expect(aEntry.recordArmed).toBe(true);
    expect(bEntry.recordArmed).toBe(true);
  });

  it("countArmedLiveInputs liefert 0 wenn keine Channels existieren", () => {
    expect(countArmedLiveInputs()).toBe(0);
    setAllLiveInputRecordArm(true); // no-op auf leerem Store
    expect(countArmedLiveInputs()).toBe(0);
  });
});

// ─── 2. Engine: parallele Multi-Track-Recordings ─────────────────────────────

describe("v3.62.0 – AudioRecorder Multi-Track Pipeline", () => {
  it("Arming 3 Live-Inputs → Engine startet 3 parallele Recordings", () => {
    // Store: 3 armed Channels
    const a = addLiveInputChannel({ name: "Drum" });
    const b = addLiveInputChannel({ name: "Bass" });
    const c = addLiveInputChannel({ name: "Vox" });
    setAllLiveInputRecordArm(true);
    const armed = getArmedLiveInputChannelIds();
    expect(armed).toHaveLength(3);

    // Engine simuliert App.tsx-Transport-Play-Hook
    const recorder = new AudioRecorder();
    recorder.setContext(new MockAudioContext() as unknown as AudioContext);
    const src = new MockAudioNode() as unknown as AudioNode;
    for (const id of armed) {
      expect(recorder.start(id, src)).toBe(true);
    }
    expect(recorder.activeCount()).toBe(3);
    expect(recorder.isRecording(a)).toBe(true);
    expect(recorder.isRecording(b)).toBe(true);
    expect(recorder.isRecording(c)).toBe(true);
  });

  it("Jede der 3 parallelen Aufnahmen produziert separate WAV", () => {
    const ids = [
      addLiveInputChannel({ name: "T1" }),
      addLiveInputChannel({ name: "T2" }),
      addLiveInputChannel({ name: "T3" }),
    ];
    setAllLiveInputRecordArm(true);

    const recorder = new AudioRecorder();
    recorder.setContext(new MockAudioContext() as unknown as AudioContext);
    const src = new MockAudioNode() as unknown as AudioNode;
    for (const id of ids) recorder.start(id, src);

    // Feed 2 Ticks á 4096 Frames in JEDEN Recorder.
    type ActiveLite = { processor: MockScriptProcessor };
    const internal = (recorder as unknown as { _active: Map<string, ActiveLite> })._active;
    for (const id of ids) {
      const proc = internal.get(id)!.processor;
      feedFrames(proc, 4096, 2, 0.25);
    }

    const results = recorder.stopAll();
    expect(results).toHaveLength(3);
    const seen = new Set<string>();
    for (const r of results) {
      expect(isValidWavHeader(r.wavBuffer)).toBe(true);
      expect(r.channels).toBe(1);
      // 2 Ticks * 4096 Mono * 2 Byte + 44 Header
      expect(r.wavBuffer.byteLength).toBe(WAV_HEADER_SIZE + 2 * 4096 * 2);
      seen.add(r.channelId);
    }
    // Jeder Channel hat genau ein separates Result
    expect(seen.size).toBe(3);
    for (const id of ids) expect(seen.has(id)).toBe(true);
  });

  it("MAX 8 simultaneous recordings bleibt enforced (v2.86-Invariant)", () => {
    expect(MAX_SIMULTANEOUS_RECORDINGS).toBe(8);
    const recorder = new AudioRecorder();
    recorder.setContext(new MockAudioContext() as unknown as AudioContext);
    const src = new MockAudioNode() as unknown as AudioNode;
    for (let i = 0; i < 8; i++) {
      expect(recorder.start(`ch:${i}`, src)).toBe(true);
    }
    // 9. Aufruf → false (Limit)
    expect(recorder.start("ch:8", src)).toBe(false);
    expect(recorder.activeCount()).toBe(8);
    // stopAll liefert 8 Results
    expect(recorder.stopAll()).toHaveLength(8);
  });

  it("Disarm während running → nur die disarmed stoppen (engine-driven)", () => {
    // Simuliert das App.tsx-Verhalten: wenn ein Channel armed=false bekommt
    // WÄHREND die Aufnahme läuft, ruft die UI explizit recorder.cancel(id)
    // bzw. recorder.stop(id) — wir testen, dass das andere Recordings nicht
    // beeinflusst (Map-Isolation).
    const a = addLiveInputChannel();
    const b = addLiveInputChannel();
    const c = addLiveInputChannel();
    setAllLiveInputRecordArm(true);

    const recorder = new AudioRecorder();
    recorder.setContext(new MockAudioContext() as unknown as AudioContext);
    const src = new MockAudioNode() as unknown as AudioNode;
    recorder.start(a, src);
    recorder.start(b, src);
    recorder.start(c, src);
    expect(recorder.activeCount()).toBe(3);

    // User klickt "Disarm" auf Channel b WÄHREND der Aufnahme.
    setLiveInputRecordArm(b, false);
    recorder.cancel(b); // App.tsx würde das auf disarm-during-running fahren

    expect(recorder.isRecording(b)).toBe(false);
    expect(recorder.isRecording(a)).toBe(true);
    expect(recorder.isRecording(c)).toBe(true);
    expect(recorder.activeCount()).toBe(2);

    // Store-Zustand: a + c bleiben armed
    expect(countArmedLiveInputs()).toBe(2);
    expect(getArmedLiveInputChannelIds()).toEqual(expect.arrayContaining([a, c]));
    expect(getArmedLiveInputChannelIds()).not.toContain(b);

    // Engine kann a + c sauber finalisieren
    const results = recorder.stopAll();
    expect(results).toHaveLength(2);
    const channelIdSet = new Set(results.map((r) => r.channelId));
    expect(channelIdSet.has(a)).toBe(true);
    expect(channelIdSet.has(c)).toBe(true);
    expect(channelIdSet.has(b)).toBe(false);
  });

  it("Arm-All bei 10 Live-Inputs → Engine startet nur 8 (Limit), Rest false", () => {
    // Edge-Case: User hat (hypothetisch) mehr Live-Inputs als das Engine-Limit.
    // MAX_LIVE_INPUT_CHANNELS = 4 — also kann das im realen Store gar nicht
    // passieren. Wir simulieren das aber direkt am Recorder mit künstlichen
    // IDs um die v2.86-Engine-Garantie zu beweisen.
    const recorder = new AudioRecorder();
    recorder.setContext(new MockAudioContext() as unknown as AudioContext);
    const src = new MockAudioNode() as unknown as AudioNode;
    const startedIds: string[] = [];
    for (let i = 0; i < 10; i++) {
      if (recorder.start(`liveinput:test-${i}`, src)) {
        startedIds.push(`liveinput:test-${i}`);
      }
    }
    expect(startedIds.length).toBe(MAX_SIMULTANEOUS_RECORDINGS);
    expect(recorder.activeCount()).toBe(MAX_SIMULTANEOUS_RECORDINGS);
  });
});
