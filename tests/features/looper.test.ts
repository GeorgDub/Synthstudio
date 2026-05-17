/**
 * tests/features/looper.test.ts
 *
 * Unit-Tests für TASK-235 (v2.87): Live-Looping (Record / Loop / Overdub).
 *
 * Coverage (Test-First-Pflicht: mind. 7):
 *  1.  nextLoopState State-Machine (empty→arming→recording→playing→overdubbing→playing)
 *  2.  eraseLoopState setzt state=empty unabhängig vom Vorzustand
 *  3.  quantizeLoopLengthBars snapt auf 1/2/4/8 bars
 *  4.  mixLoopBuffersLinear addiert + cliped auf [-1,+1]
 *  5.  nextBeatBoundary / nextBarBoundary nie in der Vergangenheit
 *  6.  beatDurationSec respektiert BPM-Clamp 20..300
 *  7.  Store: triggerLoop respektiert isValidLoopIndex
 *  8.  Store: max 4 simultane Loops (MAX_LOOPS = 4)
 *  9.  Store: setLoopLength persistiert metadata, NICHT audioBuffer
 * 10.  isValidLoopIndex Bounds-Check
 * 11.  LooperEngine setBpm + getProgress mit Mock-Context
 * 12.  LooperEngine.erase resettet Buffer + State unabhängig vom Vorzustand
 * 13.  loopLengthSec / Bar-Mathematik
 * 14.  Overdub-Trim: kürzerer Overdub-Buffer → wird gepadded mit Null
 */

import { describe, it, expect, beforeEach } from "vitest";

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

// ─── Imports ─────────────────────────────────────────────────────────────────

import {
  nextLoopState,
  eraseLoopState,
  toggleLoopPlayStop,
  quantizeLoopLengthBars,
  mixLoopBuffersLinear,
  mixLoopBuffersStereoLinear,
  nextBeatBoundary,
  nextBarBoundary,
  beatDurationSec,
  loopLengthSec,
  isValidLoopIndex,
  canAddLoop,
  MAX_LOOPS,
  MIN_LOOP_BARS,
  MAX_LOOP_BARS,
  LOOP_ERASE_LONG_PRESS_MS,
  type LoopState,
} from "../../client/src/audio/looperUtils";
import {
  getAllLoopSlots,
  getLoopSlot,
  setLoopState,
  setLoopLength,
  resetLoopSlot,
  getActiveLoopCount,
  updateLoopSlot,
  setLoopSourceChannel,
  __resetForTests,
} from "../../client/src/store/useLooperStore";
import { LooperEngine } from "../../client/src/audio/LooperEngine";

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  localStorageMock.clear();
  __resetForTests();
});

// ─── 1. State-Machine ────────────────────────────────────────────────────────

describe("looperUtils – nextLoopState", () => {
  it("läuft den vollen Record-Cycle: empty → arming → recording → playing → overdubbing → playing", () => {
    let s: LoopState = "empty";
    s = nextLoopState(s); expect(s).toBe("arming");
    s = nextLoopState(s); expect(s).toBe("recording");
    s = nextLoopState(s); expect(s).toBe("playing");
    s = nextLoopState(s); expect(s).toBe("overdubbing");
    s = nextLoopState(s); expect(s).toBe("playing");
    // Repeat oscillation playing ⇄ overdubbing
    s = nextLoopState(s); expect(s).toBe("overdubbing");
  });

  it("stopped → playing (re-start nach pause)", () => {
    expect(nextLoopState("stopped")).toBe("playing");
  });

  it("eraseLoopState setzt jeden state auf empty", () => {
    const states: LoopState[] = ["empty", "arming", "recording", "playing", "overdubbing", "stopped"];
    for (const s of states) expect(eraseLoopState(s)).toBe("empty");
  });

  it("toggleLoopPlayStop: playing→stopped, stopped→playing, andere unverändert", () => {
    expect(toggleLoopPlayStop("playing")).toBe("stopped");
    expect(toggleLoopPlayStop("overdubbing")).toBe("stopped");
    expect(toggleLoopPlayStop("stopped")).toBe("playing");
    expect(toggleLoopPlayStop("empty")).toBe("empty");
    expect(toggleLoopPlayStop("arming")).toBe("arming");
    expect(toggleLoopPlayStop("recording")).toBe("recording");
  });
});

// ─── 2. Quantisierung ────────────────────────────────────────────────────────

describe("looperUtils – quantizeLoopLengthBars (Snap-Policy Power-of-2)", () => {
  it("snapt auf 1 Bar bei <= 1.0", () => {
    expect(quantizeLoopLengthBars(0.3)).toBe(1);
    expect(quantizeLoopLengthBars(0.99)).toBe(1);
    expect(quantizeLoopLengthBars(1.0)).toBe(1);
  });

  it("snapt 2.7 Bars → 4 Bars (Akzeptanzkriterium aus TASK-235)", () => {
    expect(quantizeLoopLengthBars(2.7)).toBe(4);
  });

  it("snapt 1.5 → 2, 4.1 → 8", () => {
    expect(quantizeLoopLengthBars(1.5)).toBe(2);
    expect(quantizeLoopLengthBars(4.1)).toBe(8);
  });

  it("cap auf MAX_LOOP_BARS", () => {
    expect(quantizeLoopLengthBars(100)).toBe(MAX_LOOP_BARS);
  });

  it("liefert MIN_LOOP_BARS bei 0 / negativ / NaN", () => {
    expect(quantizeLoopLengthBars(0)).toBe(MIN_LOOP_BARS);
    expect(quantizeLoopLengthBars(-1)).toBe(MIN_LOOP_BARS);
    expect(quantizeLoopLengthBars(NaN)).toBe(MIN_LOOP_BARS);
  });
});

describe("looperUtils – Beat/Bar-Mathematik", () => {
  it("beatDurationSec clampt BPM auf 20..300", () => {
    expect(beatDurationSec(120)).toBeCloseTo(0.5, 5);
    expect(beatDurationSec(60)).toBeCloseTo(1.0, 5);
    expect(beatDurationSec(10)).toBeCloseTo(beatDurationSec(20), 5);     // unter-Clamp
    expect(beatDurationSec(1000)).toBeCloseTo(beatDurationSec(300), 5);  // über-Clamp
  });

  it("nextBeatBoundary liefert nie eine Zeit in der Vergangenheit", () => {
    const next = nextBeatBoundary(/*now*/10, /*anchor*/0, /*bpm*/120);
    expect(next).toBeGreaterThanOrEqual(10);
    expect(next).toBeLessThanOrEqual(10 + 0.5); // max 1 beat in der Zukunft
  });

  it("nextBarBoundary respektiert beatsPerBar=4 (default)", () => {
    // Bei 120 BPM = 0.5 sec/beat, 1 Bar = 2 sec.
    // currentTime=0.3, anchorTime=0 → nächste Bar bei 2.0
    const t = nextBarBoundary(0.3, 0, 120, 4);
    expect(t).toBeCloseTo(2.0, 3);
  });

  it("loopLengthSec(4 bars, 120 BPM, 4/4) = 8 sec", () => {
    expect(loopLengthSec(4, 120, 4)).toBeCloseTo(8.0, 3);
  });
});

// ─── 3. Overdub-Merge ────────────────────────────────────────────────────────

describe("looperUtils – mixLoopBuffersLinear", () => {
  it("addiert Sample für Sample", () => {
    const base = new Float32Array([0.1, 0.2, 0.3]);
    const over = new Float32Array([0.5, 0.1, 0.0]);
    const out = mixLoopBuffersLinear(base, over);
    expect(out[0]).toBeCloseTo(0.6, 5);
    expect(out[1]).toBeCloseTo(0.3, 5);
    expect(out[2]).toBeCloseTo(0.3, 5);
  });

  it("cliped auf [-1, +1]", () => {
    const base = new Float32Array([0.7, -0.7]);
    const over = new Float32Array([0.8, -0.8]);
    const out = mixLoopBuffersLinear(base, over);
    expect(out[0]).toBe(1);   // 0.7+0.8 = 1.5 → 1
    expect(out[1]).toBe(-1);  // -1.5 → -1
  });

  it("padded Overdub mit Null wenn kürzer als Base", () => {
    const base = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const over = new Float32Array([0.5, 0.5]); // nur 2 Frames
    const out = mixLoopBuffersLinear(base, over);
    expect(out[0]).toBeCloseTo(0.6, 5);
    expect(out[1]).toBeCloseTo(0.7, 5);
    expect(out[2]).toBeCloseTo(0.3, 5); // ungepatcht
    expect(out[3]).toBeCloseTo(0.4, 5); // ungepatcht
  });

  it("Stereo-Variante mischt L+R unabhängig", () => {
    const bL = new Float32Array([0.1]); const oL = new Float32Array([0.2]);
    const bR = new Float32Array([0.3]); const oR = new Float32Array([0.1]);
    const out = mixLoopBuffersStereoLinear(bL, bR, oL, oR);
    expect(out.left[0]).toBeCloseTo(0.3, 5);
    expect(out.right[0]).toBeCloseTo(0.4, 5);
  });
});

// ─── 4. Bounds & Limits ──────────────────────────────────────────────────────

describe("looperUtils – Limits", () => {
  it("isValidLoopIndex akzeptiert nur 0..MAX_LOOPS-1", () => {
    expect(isValidLoopIndex(0)).toBe(true);
    expect(isValidLoopIndex(MAX_LOOPS - 1)).toBe(true);
    expect(isValidLoopIndex(MAX_LOOPS)).toBe(false);
    expect(isValidLoopIndex(-1)).toBe(false);
    expect(isValidLoopIndex(1.5)).toBe(false);
    expect(isValidLoopIndex(null)).toBe(false);
    expect(isValidLoopIndex("0")).toBe(false);
  });

  it("canAddLoop limitiert auf MAX_LOOPS", () => {
    expect(canAddLoop(0)).toBe(true);
    expect(canAddLoop(MAX_LOOPS - 1)).toBe(true);
    expect(canAddLoop(MAX_LOOPS)).toBe(false);
    expect(canAddLoop(MAX_LOOPS + 1)).toBe(false);
  });

  it("MAX_LOOPS ist exakt 4 (Akzeptanzkriterium)", () => {
    expect(MAX_LOOPS).toBe(4);
  });

  it("LOOP_ERASE_LONG_PRESS_MS ist 500ms (Akzeptanzkriterium)", () => {
    expect(LOOP_ERASE_LONG_PRESS_MS).toBe(500);
  });
});

// ─── 5. Looper-Store ─────────────────────────────────────────────────────────

describe("useLooperStore – initialer State", () => {
  it("erzeugt exakt MAX_LOOPS Default-Slots", () => {
    const slots = getAllLoopSlots();
    expect(slots).toHaveLength(MAX_LOOPS);
    for (const s of slots) {
      expect(s.state).toBe("empty");
      expect(s.lengthBeats).toBeNull();
      expect(s.frameCount).toBe(0);
    }
  });

  it("Slots haben stabile IDs 'loop:1' bis 'loop:4'", () => {
    const slots = getAllLoopSlots();
    expect(slots[0].id).toBe("loop:1");
    expect(slots[1].id).toBe("loop:2");
    expect(slots[2].id).toBe("loop:3");
    expect(slots[3].id).toBe("loop:4");
  });

  it("getLoopSlot returnt null für invalide Indizes", () => {
    expect(getLoopSlot(-1)).toBeNull();
    expect(getLoopSlot(MAX_LOOPS)).toBeNull();
    expect(getLoopSlot(0)).not.toBeNull();
  });
});

describe("useLooperStore – Mutationen", () => {
  it("setLoopState updated Slot + ignoriert invalid index", () => {
    setLoopState(0, "recording");
    expect(getLoopSlot(0)?.state).toBe("recording");
    setLoopState(99, "playing"); // no-op
    // Andere Slots bleiben empty
    expect(getLoopSlot(1)?.state).toBe("empty");
  });

  it("setLoopLength schreibt Bars + Sec + frameCount", () => {
    setLoopLength(2, /*beats*/16, /*sec*/8.0, /*frames*/384000);
    const s = getLoopSlot(2);
    expect(s?.lengthBeats).toBe(16);
    expect(s?.lengthSec).toBe(8.0);
    expect(s?.frameCount).toBe(384000);
  });

  it("resetLoopSlot räumt Buffer-Felder, behält ID + Metadata", () => {
    setLoopState(1, "playing");
    setLoopLength(1, 8, 4.0, 192000);
    updateLoopSlot(1, { name: "Bass-Loop" });
    expect(getLoopSlot(1)?.name).toBe("Bass-Loop");
    expect(getLoopSlot(1)?.state).toBe("playing");

    resetLoopSlot(1);
    const after = getLoopSlot(1);
    expect(after?.state).toBe("empty");
    expect(after?.lengthBeats).toBeNull();
    expect(after?.frameCount).toBe(0);
    expect(after?.name).toBe("Bass-Loop"); // Metadata bleibt
    expect(after?.id).toBe("loop:2");
  });

  it("getActiveLoopCount zählt nur non-empty Slots", () => {
    expect(getActiveLoopCount()).toBe(0);
    setLoopState(0, "recording");
    setLoopState(1, "playing");
    expect(getActiveLoopCount()).toBe(2);
    setLoopState(0, "empty");
    expect(getActiveLoopCount()).toBe(1);
  });

  it("persistiert NUR Metadata (Name/Volume/Pan/Mute/Solo/Source), KEIN audioBuffer/frameCount/state", () => {
    setLoopState(0, "recording");
    setLoopLength(0, 8, 4.0, 192000);
    updateLoopSlot(0, { name: "Hook-Loop", volume: 0.7 });
    setLoopSourceChannel(0, "liveinput:abc");

    const raw = localStorageMock.getItem("synthstudio:looper:v1");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed[0].name).toBe("Hook-Loop");
    expect(parsed[0].volume).toBeCloseTo(0.7, 3);
    expect(parsed[0].sourceChannelId).toBe("liveinput:abc");
    // KEIN state / frameCount / audioBuffer in der persistierten Form
    expect(parsed[0].state).toBeUndefined();
    expect(parsed[0].frameCount).toBeUndefined();
  });
});

// ─── 6. LooperEngine (Mock-Web-Audio) ────────────────────────────────────────

class MockAudioNode {
  connect(_t: MockAudioNode): void { void _t; }
  disconnect(_t?: MockAudioNode): void { void _t; }
}

class MockScriptProcessor extends MockAudioNode {
  onaudioprocess: ((ev: { inputBuffer: MockAudioBuffer }) => void) | null = null;
}

class MockAudioBuffer {
  private _data: Float32Array[];
  constructor(channels: number, length: number, public sampleRate: number) {
    this._data = Array.from({ length: channels }, () => new Float32Array(length));
  }
  getChannelData(ch: number): Float32Array { return this._data[ch]; }
  get numberOfChannels(): number { return this._data.length; }
}

class MockBufferSource extends MockAudioNode {
  buffer: MockAudioBuffer | null = null;
  loop = false;
  start(_w?: number): void { void _w; }
  stop(): void { /* */ }
}

class MockGainNode extends MockAudioNode {
  gain = { value: 1 };
}

class MockAudioContext {
  sampleRate = 48000;
  currentTime = 0;
  destination = new MockAudioNode();
  createGain(): MockGainNode { return new MockGainNode(); }
  createScriptProcessor(_b: number, _i: number, _o: number): MockScriptProcessor {
    void _b; void _i; void _o;
    return new MockScriptProcessor();
  }
  createBufferSource(): MockBufferSource { return new MockBufferSource(); }
  createBuffer(channels: number, length: number, sampleRate: number): MockAudioBuffer {
    return new MockAudioBuffer(channels, length, sampleRate);
  }
}

describe("LooperEngine – Public-API mit Mock-Context", () => {
  function setupEngine() {
    const ctx = new MockAudioContext();
    const dest = new MockAudioNode();
    const engine = new LooperEngine();
    engine.setContext(
      ctx as unknown as AudioContext,
      dest as unknown as AudioNode,
    );
    engine.setBpm(120);
    engine.setTransportAnchor(0);
    return { ctx, dest, engine };
  }

  it("Initial: getLoopState(0) === 'empty'", () => {
    const { engine } = setupEngine();
    expect(engine.getLoopState(0)).toBe("empty");
  });

  it("erase resettet state auf empty unabhängig vom Vorzustand", () => {
    const { engine } = setupEngine();
    const tap = new MockAudioNode() as unknown as AudioNode;
    engine.trigger(0, tap);
    // → arming
    engine.erase(0);
    expect(engine.getLoopState(0)).toBe("empty");
  });

  it("getProgress returnt 0 wenn nicht playing/overdubbing", () => {
    const { engine } = setupEngine();
    expect(engine.getProgress(0, 1.0)).toBe(0);
  });

  it("invalid loopIndex no-op", () => {
    const { engine } = setupEngine();
    const tap = new MockAudioNode() as unknown as AudioNode;
    // Sollte keinen Throw werfen
    expect(() => engine.trigger(99, tap)).not.toThrow();
    expect(() => engine.erase(-1)).not.toThrow();
    expect(engine.getLoopState(99)).toBe("empty");
  });

  it("callbacks werden bei State-Übergang gefeuert", () => {
    const { engine } = setupEngine();
    const states: Array<{ idx: number; state: LoopState }> = [];
    engine.setCallbacks({
      onState: (idx, state) => states.push({ idx, state }),
    });
    const tap = new MockAudioNode() as unknown as AudioNode;
    engine.trigger(0, tap);
    expect(states.length).toBeGreaterThan(0);
    expect(states[0]).toEqual({ idx: 0, state: "arming" });
  });

  it("dispose() räumt alle Slots auf", () => {
    const { engine } = setupEngine();
    const tap = new MockAudioNode() as unknown as AudioNode;
    engine.trigger(0, tap);
    engine.trigger(1, tap);
    engine.dispose();
    expect(engine.getLoopState(0)).toBe("empty");
    expect(engine.getLoopState(1)).toBe("empty");
  });

  it("setBpm + setTransportAnchor + getProgress sind sicher ohne aktive Loops", () => {
    const { engine } = setupEngine();
    engine.setBpm(140);
    engine.setTransportAnchor(5);
    expect(engine.getProgress(0, 5.5)).toBe(0);
  });
});
