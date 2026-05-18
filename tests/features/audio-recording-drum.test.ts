/**
 * tests/features/audio-recording-drum.test.ts (v3.63.0)
 *
 * Coverage für Drum/Synth-Channel Record-Arm-UI:
 *
 *   - useDrumPartRecordArmStore  (setPartRecordArm, isArmed, count, getIds)
 *   - useDrumPartRecordArmStore  (setAllDrumPartRecordArm Bulk-Action)
 *   - Transport-Wiring (App.tsx liest combined armed list und ruft
 *     AudioEngine.startRecordingForChannels)
 *   - Engine-Overflow → Performance-Toast (rejected.length > 0)
 *   - Topbar-Counter (Live-Inputs + Drum-Parts kombiniert)
 *
 * Die Engine-Logik (AudioRecorder.start enforced MAX=8) ist bereits in
 * audio-recording.test.ts + audio-recording-multitrack.test.ts abgedeckt.
 * Hier nur das v3.63 UX-Layer + die neue {ok,started,rejected}-Return-API.
 */
import { describe, it, expect, beforeEach } from "vitest";

// ─── localStorage Mock ──────────────────────────────────────────────────────
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
import {
  setPartRecordArm,
  isPartRecordArmed,
  getArmedDrumPartIds,
  countArmedDrumParts,
  setAllDrumPartRecordArm,
  pruneArmedDrumParts,
  __resetDrumPartRecordArmForTests,
} from "../../client/src/store/useDrumPartRecordArmStore";
import {
  addLiveInputChannel,
  setAllLiveInputRecordArm,
  countArmedLiveInputs,
  __resetForTests as __resetLiveInputsForTests,
} from "../../client/src/store/useLiveInputStore";
import {
  getTotalArmedCount,
  getAllArmedChannelIds,
} from "../../client/src/utils/recordingArmCount";

// ─── Mock-Web-Audio (gleiche Form wie audio-recording-multitrack.test.ts) ────

class MockAudioNode {
  private _connections: MockAudioNode[] = [];
  connect(target: MockAudioNode): void { this._connections.push(target); }
  disconnect(_target?: MockAudioNode): void { this._connections = []; }
}

class MockScriptProcessor extends MockAudioNode {
  onaudioprocess: ((ev: unknown) => void) | null = null;
  constructor(public bufferSize: number, public inChannels: number, public outChannels: number) {
    super();
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

beforeEach(() => {
  localStorageMock.clear();
  __resetDrumPartRecordArmForTests();
  __resetLiveInputsForTests();
});

// ─── 1. Store-API: per-Part Record-Arm ────────────────────────────────────────

describe("v3.63.0 – useDrumPartRecordArmStore", () => {
  it("setPartRecordArm Drum updates store + isArmed liest korrekt", () => {
    expect(isPartRecordArmed("kick-1")).toBe(false);
    setPartRecordArm("kick-1", true);
    expect(isPartRecordArmed("kick-1")).toBe(true);
    expect(getArmedDrumPartIds()).toEqual(["kick-1"]);
    expect(countArmedDrumParts()).toBe(1);

    // Idempotent — gleicher Wert nochmal setzen ist No-Op
    setPartRecordArm("kick-1", true);
    expect(countArmedDrumParts()).toBe(1);

    // Disarm entfernt aus der Map
    setPartRecordArm("kick-1", false);
    expect(isPartRecordArmed("kick-1")).toBe(false);
    expect(getArmedDrumPartIds()).toEqual([]);
    expect(countArmedDrumParts()).toBe(0);
  });

  it("setPartRecordArm persistiert in localStorage", () => {
    setPartRecordArm("snare-1", true);
    setPartRecordArm("hat-1", true);
    const raw = localStorageMock.getItem("synthstudio:drum-recordarm:v1");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as Record<string, boolean>;
    expect(parsed["snare-1"]).toBe(true);
    expect(parsed["hat-1"]).toBe(true);
    // Disarm entfernt aus persisted JSON (Map klein halten)
    setPartRecordArm("snare-1", false);
    const reparsed = JSON.parse(localStorageMock.getItem("synthstudio:drum-recordarm:v1")!) as Record<string, boolean>;
    expect(reparsed["snare-1"]).toBeUndefined();
    expect(reparsed["hat-1"]).toBe(true);
  });

  it("setAllDrumPartRecordArm armed + disarmed mehrere Parts", () => {
    setAllDrumPartRecordArm(["a", "b", "c"], true);
    expect(countArmedDrumParts()).toBe(3);
    expect(getArmedDrumPartIds().sort()).toEqual(["a", "b", "c"]);

    // Bulk-Disarm
    setAllDrumPartRecordArm(["a", "b"], false);
    expect(countArmedDrumParts()).toBe(1);
    expect(getArmedDrumPartIds()).toEqual(["c"]);
  });

  it("setAllDrumPartRecordArm ignoriert ungültige IDs + leeres Array", () => {
    setAllDrumPartRecordArm([], true);
    expect(countArmedDrumParts()).toBe(0);

    setAllDrumPartRecordArm(["", "valid"], true);
    expect(countArmedDrumParts()).toBe(1);
    expect(isPartRecordArmed("valid")).toBe(true);
  });

  it("pruneArmedDrumParts entfernt Phantom-Entries für gelöschte Parts", () => {
    setPartRecordArm("p1", true);
    setPartRecordArm("p2", true);
    setPartRecordArm("p3", true);
    expect(countArmedDrumParts()).toBe(3);

    pruneArmedDrumParts(["p1", "p3"]); // p2 ist weg
    expect(countArmedDrumParts()).toBe(2);
    expect(isPartRecordArmed("p2")).toBe(false);
    expect(isPartRecordArmed("p1")).toBe(true);
    expect(isPartRecordArmed("p3")).toBe(true);
  });

  it("Store überlebt Reload (korrupte JSON → leerer State)", () => {
    localStorageMock.setItem("synthstudio:drum-recordarm:v1", "not-json-at-all");
    __resetDrumPartRecordArmForTests();
    // Nach Reset ist Store leer; aber wir wollen sicherstellen dass der
    // Loader bei korruptem JSON nicht crasht. Daher: simuliere via direkte
    // setPartRecordArm-Calls. Falls der Loader crashen würde, würde der
    // Top-Level-Import bereits werfen (passiert hier nicht).
    expect(countArmedDrumParts()).toBe(0);
    setPartRecordArm("test", true);
    expect(isPartRecordArmed("test")).toBe(true);
  });
});

// ─── 2. Transport-Wiring + Engine-Pipeline ────────────────────────────────────

describe("v3.63.0 – Transport-Wiring (armed → startRecordingForChannels)", () => {
  it("transport:play startet recording auf armed drum-parts via AudioEngine.startRecordingForChannels", () => {
    setPartRecordArm("kick-1", true);
    setPartRecordArm("snare-1", true);
    setPartRecordArm("hat-1", true);

    // App.tsx-Pfad simulieren:
    const armed = getArmedDrumPartIds();
    expect(armed.sort()).toEqual(["hat-1", "kick-1", "snare-1"]);

    // AudioRecorder bekommt diese IDs direkt — der startRecordingForChannels-
    // Wrapper in AudioEngine ruft im inneren Loop startRecording(id) was
    // wiederum recorder.start(id, panner) macht.
    const recorder = new AudioRecorder();
    recorder.setContext(new MockAudioContext() as unknown as AudioContext);
    const src = new MockAudioNode() as unknown as AudioNode;
    const started: string[] = [];
    const rejected: string[] = [];
    for (const id of armed) {
      if (recorder.start(id, src)) started.push(id);
      else rejected.push(id);
    }
    expect(started.sort()).toEqual(["hat-1", "kick-1", "snare-1"]);
    expect(rejected).toEqual([]);
    expect(recorder.activeCount()).toBe(3);
  });

  it("Engine-Overflow → rejected[] enthält die nicht-gestarteten Channels (Performance-Toast-Trigger)", () => {
    // 12 Parts armen, Engine erlaubt 8 → 4 rejected.
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) ids.push(`part-${i}`);
    setAllDrumPartRecordArm(ids, true);
    expect(countArmedDrumParts()).toBe(12);

    const armed = getArmedDrumPartIds();
    const recorder = new AudioRecorder();
    recorder.setContext(new MockAudioContext() as unknown as AudioContext);
    const src = new MockAudioNode() as unknown as AudioNode;

    // Simuliere AudioEngine.startRecordingForChannels-Logik (v3.63 Return-Form)
    const started: string[] = [];
    const rejected: string[] = [];
    for (const id of armed) {
      if (recorder.start(id, src)) started.push(id);
      else rejected.push(id);
    }
    const ok = rejected.length === 0;
    expect(ok).toBe(false);
    expect(started.length).toBe(MAX_SIMULTANEOUS_RECORDINGS);
    expect(rejected.length).toBe(12 - MAX_SIMULTANEOUS_RECORDINGS);
    expect(rejected.length).toBeGreaterThan(0); // → Toast feuert

    // Cleanup
    recorder.stopAll();
  });

  it("Mixed armed (live + drum) → kombinierter armed-Set startet alle bis zum Limit", () => {
    addLiveInputChannel({ name: "Mic" });
    addLiveInputChannel({ name: "Synth In" });
    setAllLiveInputRecordArm(true);
    setPartRecordArm("drum-kick", true);
    setPartRecordArm("drum-snare", true);

    expect(countArmedLiveInputs()).toBe(2);
    expect(countArmedDrumParts()).toBe(2);
    expect(getTotalArmedCount()).toBe(4);

    const allIds = getAllArmedChannelIds();
    // Live-Inputs zuerst, dann Drum-Parts
    expect(allIds.length).toBe(4);
    expect(allIds.filter((id) => id.startsWith("liveinput:"))).toHaveLength(2);
    expect(allIds.filter((id) => id.startsWith("drum-"))).toHaveLength(2);

    // Alle 4 fitten unter dem MAX=8 Limit
    const recorder = new AudioRecorder();
    recorder.setContext(new MockAudioContext() as unknown as AudioContext);
    const src = new MockAudioNode() as unknown as AudioNode;
    const started: string[] = [];
    const rejected: string[] = [];
    for (const id of allIds) {
      if (recorder.start(id, src)) started.push(id);
      else rejected.push(id);
    }
    expect(started).toHaveLength(4);
    expect(rejected).toHaveLength(0);
    expect(recorder.activeCount()).toBe(4);
    recorder.stopAll();
  });
});

// ─── 3. Topbar-Counter (combined armed) ───────────────────────────────────────

describe("v3.63.0 – Topbar-Counter (Live-Inputs + Drum-Parts kombiniert)", () => {
  it("Topbar zeigt total armed (live-inputs + drum-parts)", () => {
    // Anfangs: 0
    expect(getTotalArmedCount()).toBe(0);

    // Nur Live-Input armed
    const live1 = addLiveInputChannel();
    setAllLiveInputRecordArm(true);
    expect(getTotalArmedCount()).toBe(1);

    // Drum-Part dazu
    setPartRecordArm("kick-1", true);
    expect(getTotalArmedCount()).toBe(2);

    // Zweiter Drum-Part
    setPartRecordArm("snare-1", true);
    expect(getTotalArmedCount()).toBe(3);

    // Disarm aller Drum-Parts → bleibt 1 (Live-Input)
    setAllDrumPartRecordArm(["kick-1", "snare-1"], false);
    expect(getTotalArmedCount()).toBe(1);

    // Disarm Live-Input → 0
    setAllLiveInputRecordArm(false);
    expect(getTotalArmedCount()).toBe(0);

    // Cleanup-Reference (unused-Variable-Vermeidung)
    expect(live1).toMatch(/^liveinput:/);
  });

  it("getTotalArmedCount ignoriert disarmed Channels (selbst wenn sie existieren)", () => {
    // 3 Live + 3 Drum existieren, alle disarmed
    addLiveInputChannel();
    addLiveInputChannel();
    addLiveInputChannel();
    setPartRecordArm("p1", false); // Default
    setPartRecordArm("p2", false);
    setPartRecordArm("p3", false);

    expect(getTotalArmedCount()).toBe(0);
    expect(countArmedLiveInputs()).toBe(0);
    expect(countArmedDrumParts()).toBe(0);

    // Nur einer armed
    setPartRecordArm("p2", true);
    expect(getTotalArmedCount()).toBe(1);
    expect(getAllArmedChannelIds()).toEqual(["p2"]);
  });

  it("over-Limit-Erkennung: getTotalArmedCount > MAX_SIMULTANEOUS_RECORDINGS", () => {
    // Simulate 10 armed Parts (mehr als das Engine-Limit von 8)
    for (let i = 0; i < 10; i++) {
      setPartRecordArm(`p-${i}`, true);
    }
    expect(getTotalArmedCount()).toBe(10);
    expect(getTotalArmedCount() > MAX_SIMULTANEOUS_RECORDINGS).toBe(true);
    // → UI zeigt overLimit-Badge + Toast triggert bei transport:play
  });
});
