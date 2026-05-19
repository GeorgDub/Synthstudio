/**
 * tests/features/midi-fx-engine.test.ts (v3.92.0)
 *
 * Unit-Tests für den MIDI-FX Transform-Layer + Store.
 *
 * Test-Cluster:
 *  (1) Engine: Scale-Snap
 *  (2) Engine: Velocity-Curve
 *  (3) Engine: Octave-Shift
 *  (4) Engine: Chord-Expander
 *  (5) Engine: Note-Repeat
 *  (6) Engine: Chain sequenziell
 *  (7) Engine: Bypass + Defaults
 *  (8) Store: addNode/removeNode/moveNode/updateNode + Persistenz + MAX
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

let engine: typeof import("../../client/src/utils/midiFxEngine");
let store: typeof import("../../client/src/store/useMidiFxStore");

beforeEach(async () => {
  vi.resetModules();
  localStorageMock.clear();
  engine = await import("../../client/src/utils/midiFxEngine");
  store = await import("../../client/src/store/useMidiFxStore");
  store.__resetMidiFxStoreForTests();
});

// ─── (1) Scale-Snap ──────────────────────────────────────────────────────────

describe("Engine: scale-snap", () => {
  it("scale-snap C-major: D# (63) → D (62)", () => {
    // 63 = D# in MIDI (Oktave 4); C-major hat kein D# → snap auf D (62).
    const snapped = engine.snapNoteToScale(63, "major", 0);
    expect(snapped).toBe(62);
  });

  it("scale-snap C-major: C (60) bleibt C (60)", () => {
    const snapped = engine.snapNoteToScale(60, "major", 0);
    expect(snapped).toBe(60);
  });

  it("scale-snap A-minor: C (60) bleibt C (60) — C ist in A-minor", () => {
    // A-minor: A B C D E F G — C ist enthalten
    const snapped = engine.snapNoteToScale(60, "minor", 9);
    expect(snapped).toBe(60);
  });

  it("applyMidiFx chain scale-snap C-major: D# → D als NoteOn-Liste", () => {
    const node: import("../../client/src/utils/midiFxEngine").MidiFxNode = {
      id: "n1",
      kind: "scale-snap",
      scale: "major",
      root: 0,
    };
    const out = engine.applyMidiFx({ note: 63, velocity: 100, channel: 1 }, [node]);
    expect(out).toHaveLength(1);
    expect(out[0].note).toBe(62);
    expect(out[0].velocity).toBe(100);
  });
});

// ─── (2) Velocity-Curve ──────────────────────────────────────────────────────

describe("Engine: velocity-curve", () => {
  it("velocity-curve exp amount=0.5: 64 → ~32", () => {
    // 64/127 ≈ 0.504; 0.504^2 ≈ 0.254; *127 ≈ 32 → strenge Toleranz ±4.
    const out = engine.applyVelocityCurve(64, "exp", 0.5);
    expect(out).toBeGreaterThanOrEqual(28);
    expect(out).toBeLessThanOrEqual(36);
  });

  it("velocity-curve linear ist no-op", () => {
    const out = engine.applyVelocityCurve(100, "linear", 0.5);
    expect(out).toBe(100);
  });

  it("velocity-curve log amount=0.5: 64 → höher (~90)", () => {
    // log-Kurve hebt mittlere Werte: 0.504^(1/2) ≈ 0.71; *127 ≈ 90.
    const out = engine.applyVelocityCurve(64, "log", 0.5);
    expect(out).toBeGreaterThan(64);
    expect(out).toBeLessThanOrEqual(100);
  });

  it("velocity-curve amount=0 ist no-op auch bei exp", () => {
    const out = engine.applyVelocityCurve(64, "exp", 0);
    expect(out).toBe(64);
  });
});

// ─── (3) Octave-Shift ────────────────────────────────────────────────────────

describe("Engine: octave-shift", () => {
  it("octave-shift +12: C4 (60) → C5 (72)", () => {
    const node: import("../../client/src/utils/midiFxEngine").MidiFxNode = {
      id: "o1",
      kind: "octave-shift",
      semitones: 12,
    };
    const out = engine.applyMidiFx({ note: 60, velocity: 100, channel: 1 }, [node]);
    expect(out).toHaveLength(1);
    expect(out[0].note).toBe(72);
  });

  it("octave-shift -12: C5 (72) → C4 (60)", () => {
    const node: import("../../client/src/utils/midiFxEngine").MidiFxNode = {
      id: "o2",
      kind: "octave-shift",
      semitones: -12,
    };
    const out = engine.applyMidiFx({ note: 72, velocity: 100, channel: 1 }, [node]);
    expect(out[0].note).toBe(60);
  });

  it("octave-shift clampt am Note-Range-Ende (127)", () => {
    const node: import("../../client/src/utils/midiFxEngine").MidiFxNode = {
      id: "o3",
      kind: "octave-shift",
      semitones: 24,
    };
    const out = engine.applyMidiFx({ note: 120, velocity: 100, channel: 1 }, [node]);
    expect(out[0].note).toBe(127);
  });
});

// ─── (4) Chord-Expander ──────────────────────────────────────────────────────

describe("Engine: chord-expander", () => {
  it("chord-expander major: C (60) → C + E + G (60, 64, 67)", () => {
    const node: import("../../client/src/utils/midiFxEngine").MidiFxNode = {
      id: "c1",
      kind: "chord-expander",
      chordType: "major",
    };
    const out = engine.applyMidiFx({ note: 60, velocity: 100, channel: 1 }, [node]);
    expect(out).toHaveLength(3);
    expect(out.map((e) => e.note)).toEqual([60, 64, 67]);
    expect(out.every((e) => e.velocity === 100)).toBe(true);
  });

  it("chord-expander minor: C (60) → C + E♭ + G (60, 63, 67)", () => {
    const node: import("../../client/src/utils/midiFxEngine").MidiFxNode = {
      id: "c2",
      kind: "chord-expander",
      chordType: "minor",
    };
    const out = engine.applyMidiFx({ note: 60, velocity: 80, channel: 5 }, [node]);
    expect(out.map((e) => e.note)).toEqual([60, 63, 67]);
    expect(out.every((e) => e.channel === 5)).toBe(true);
  });

  it("chord-expander 7th: C (60) → 4 Noten (60, 64, 67, 70)", () => {
    const node: import("../../client/src/utils/midiFxEngine").MidiFxNode = {
      id: "c3",
      kind: "chord-expander",
      chordType: "7th",
    };
    const out = engine.applyMidiFx({ note: 60, velocity: 100, channel: 1 }, [node]);
    expect(out).toHaveLength(4);
    expect(out.map((e) => e.note)).toEqual([60, 64, 67, 70]);
  });
});

// ─── (5) Note-Repeat ─────────────────────────────────────────────────────────

describe("Engine: note-repeat", () => {
  it("note-repeat 4×: 1 Event → 4 Events", () => {
    const node: import("../../client/src/utils/midiFxEngine").MidiFxNode = {
      id: "r1",
      kind: "note-repeat",
      rate: "1/16",
      count: 4,
    };
    const out = engine.applyMidiFx({ note: 60, velocity: 100, channel: 1 }, [node]);
    expect(out).toHaveLength(4);
    expect(out.every((e) => e.note === 60)).toBe(true);
  });

  it("note-repeat hat ansteigende timeOffsetMs-Werte", () => {
    const node: import("../../client/src/utils/midiFxEngine").MidiFxNode = {
      id: "r2",
      kind: "note-repeat",
      rate: "1/16",
      count: 4,
    };
    const out = engine.applyMidiFx({ note: 60, velocity: 100, channel: 1 }, [node]);
    expect(out[0].timeOffsetMs).toBe(0);
    expect(out[1].timeOffsetMs).toBe(125); // 1/16 @ 120 BPM = 125ms
    expect(out[2].timeOffsetMs).toBe(250);
    expect(out[3].timeOffsetMs).toBe(375);
  });

  it("note-repeat clampt count auf [2..8]", () => {
    const node = engine.applyMidiFxNode(
      { id: "r3", kind: "note-repeat", rate: "1/8", count: 20 } as import("../../client/src/utils/midiFxEngine").MidiFxNode,
      [{ note: 60, velocity: 100, channel: 1 }],
    );
    // Engine selbst clampt nur — count=20 → 8.
    expect(node).toHaveLength(8);
  });
});

// ─── (6) Chain sequenziell ───────────────────────────────────────────────────

describe("Engine: chain sequenziell", () => {
  it("chain octave-shift +12 → scale-snap C-major: D#4 (63) → D#5 (75) → D5 (74)", () => {
    const chain: import("../../client/src/utils/midiFxEngine").MidiFxNode[] = [
      { id: "n1", kind: "octave-shift", semitones: 12 },
      { id: "n2", kind: "scale-snap", scale: "major", root: 0 },
    ];
    const out = engine.applyMidiFx({ note: 63, velocity: 100, channel: 1 }, chain);
    expect(out).toHaveLength(1);
    expect(out[0].note).toBe(74); // D5
  });

  it("chain chord-expander major → octave-shift +12: 1 → 3 Noten alle um 12 erhöht", () => {
    const chain: import("../../client/src/utils/midiFxEngine").MidiFxNode[] = [
      { id: "c1", kind: "chord-expander", chordType: "major" },
      { id: "o1", kind: "octave-shift", semitones: 12 },
    ];
    const out = engine.applyMidiFx({ note: 60, velocity: 100, channel: 1 }, chain);
    expect(out).toHaveLength(3);
    expect(out.map((e) => e.note)).toEqual([72, 76, 79]);
  });

  it("chain mit bypass-Node überspringt diesen Schritt", () => {
    const chain: import("../../client/src/utils/midiFxEngine").MidiFxNode[] = [
      { id: "b1", kind: "octave-shift", semitones: 12, bypass: true },
      { id: "b2", kind: "octave-shift", semitones: 12 },
    ];
    const out = engine.applyMidiFx({ note: 60, velocity: 100, channel: 1 }, chain);
    // nur zweite shiftet → 60+12 = 72
    expect(out[0].note).toBe(72);
  });

  it("empty chain liefert das Original-Event unverändert", () => {
    const out = engine.applyMidiFx({ note: 60, velocity: 100, channel: 1 }, []);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ note: 60, velocity: 100, channel: 1 });
  });
});

// ─── (7) Defaults & Constants ────────────────────────────────────────────────

describe("Engine: defaults + constants", () => {
  it("MAX_MIDI_FX_CHAIN ist 6", () => {
    expect(engine.MAX_MIDI_FX_CHAIN).toBe(6);
  });

  it("noteRepeatStepMs(1/16, 120) = 125", () => {
    expect(engine.noteRepeatStepMs("1/16", 120)).toBe(125);
  });

  it("noteRepeatStepMs skaliert mit BPM (60 BPM → doppelt so lang)", () => {
    expect(engine.noteRepeatStepMs("1/16", 60)).toBe(250);
  });
});

// ─── (8) Store ───────────────────────────────────────────────────────────────

describe("Store: addNode + Defaults", () => {
  it("addNode erzeugt Node mit Defaults", () => {
    const id = store.addNode("octave-shift");
    expect(id).toBeTruthy();
    const chain = store.getMidiFxChain();
    expect(chain).toHaveLength(1);
    expect(chain[0].kind).toBe("octave-shift");
    if (chain[0].kind === "octave-shift") {
      expect(chain[0].semitones).toBe(0);
    }
  });

  it("addNode returnt null bei MAX_MIDI_FX_CHAIN", () => {
    for (let i = 0; i < engine.MAX_MIDI_FX_CHAIN; i++) {
      const id = store.addNode("octave-shift");
      expect(id).toBeTruthy();
    }
    const overflow = store.addNode("octave-shift");
    expect(overflow).toBeNull();
    expect(store.getMidiFxChain()).toHaveLength(engine.MAX_MIDI_FX_CHAIN);
  });

  it("updateNode mergt Felder + clampt", () => {
    const id = store.addNode("octave-shift");
    expect(id).toBeTruthy();
    store.updateNode(id!, { semitones: 999 } as Partial<import("../../client/src/utils/midiFxEngine").MidiFxNode>);
    const node = store.getMidiFxChain()[0];
    if (node.kind === "octave-shift") {
      expect(node.semitones).toBe(24); // clamped to 24
    }
  });

  it("moveNode tauscht Reihenfolge", () => {
    const id1 = store.addNode("octave-shift");
    const id2 = store.addNode("scale-snap");
    expect(id1 && id2).toBeTruthy();
    expect(store.getMidiFxChain()[0].kind).toBe("octave-shift");
    store.moveNode(0, 1);
    expect(store.getMidiFxChain()[0].kind).toBe("scale-snap");
    expect(store.getMidiFxChain()[1].kind).toBe("octave-shift");
  });

  it("removeNode entfernt + persistiert via localStorage", () => {
    const id = store.addNode("octave-shift");
    expect(id).toBeTruthy();
    store.removeNode(id!);
    expect(store.getMidiFxChain()).toHaveLength(0);
    // Persistenz-Check: localStorage enthält die leere chain.
    const persisted = localStorageMock.getItem("synthstudio:midi-fx:v1");
    expect(persisted).toBeTruthy();
    const parsed = JSON.parse(persisted as string);
    expect(parsed.chain).toEqual([]);
  });

  it("setNodeBypass schaltet Node ab + applyMidiFx überspringt bypassed Nodes", () => {
    const id = store.addNode("octave-shift");
    expect(id).toBeTruthy();
    store.updateNode(id!, { semitones: 12 } as Partial<import("../../client/src/utils/midiFxEngine").MidiFxNode>);
    let out = engine.applyMidiFx(
      { note: 60, velocity: 100, channel: 1 },
      store.getMidiFxChain(),
    );
    expect(out[0].note).toBe(72);
    store.setNodeBypass(id!, true);
    out = engine.applyMidiFx({ note: 60, velocity: 100, channel: 1 }, store.getMidiFxChain());
    expect(out[0].note).toBe(60);
  });

  it("sanitizeMidiFxState validiert + clampt unsichere Inputs", () => {
    const result = store.sanitizeMidiFxState({
      chain: [
        { id: "valid", kind: "octave-shift", semitones: 5 },
        { id: "bad", kind: "unknown-kind" },
        { id: "" }, // invalid id
        { id: "noKind" }, // missing kind
        null,
        { id: "valid", kind: "scale-snap" }, // dupe id
        { id: "ok2", kind: "velocity-curve", curve: "invalid", amount: 99 },
      ],
    });
    expect(result.chain.length).toBeGreaterThan(0);
    expect(result.chain[0].kind).toBe("octave-shift");
    // velocity-curve mit invalid curve → fallback "linear", amount clamped to 1.
    const vc = result.chain.find((n) => n.kind === "velocity-curve");
    expect(vc).toBeDefined();
    if (vc && vc.kind === "velocity-curve") {
      expect(vc.curve).toBe("linear");
      expect(vc.amount).toBe(1);
    }
  });

  it("setAllNodes mit undefined no-op (User-localStorage nicht überschreiben)", () => {
    store.addNode("octave-shift");
    const before = store.getMidiFxChain().length;
    store.setAllNodes(undefined);
    expect(store.getMidiFxChain()).toHaveLength(before);
  });

  it("setAllNodes mit leerem Array löscht die Chain", () => {
    store.addNode("octave-shift");
    expect(store.getMidiFxChain()).toHaveLength(1);
    store.setAllNodes([]);
    expect(store.getMidiFxChain()).toHaveLength(0);
  });
});

// ─── (9) Note-Off-Tracking (v3.93.0) ─────────────────────────────────────────

describe("MidiFxNoteTracker (v3.93.0 Note-Off-Tracking)", () => {
  it("chord-expander Note-On → Note-Off räumt alle expanded Notes auf", () => {
    const tracker = new engine.MidiFxNoteTracker();
    const chordNode: import("../../client/src/utils/midiFxEngine").MidiFxNode = {
      id: "c1",
      kind: "chord-expander",
      chordType: "major",
    };
    const events = engine.applyMidiFx(
      { note: 60, velocity: 100, channel: 1 },
      [chordNode],
    );
    // Major-Chord: [60, 64, 67]
    expect(events.map((e) => e.note)).toEqual([60, 64, 67]);
    const tracked = tracker.trackNoteOn(60, 1, events);
    expect(tracked).toBe(3);
    expect(tracker.size).toBe(1);
    const expanded = tracker.consumeNoteOff(60, 1);
    expect(expanded).toHaveLength(3);
    expect(expanded.map((e) => e.note).sort((a, b) => a - b)).toEqual([60, 64, 67]);
    // Map ist nach Consume leer.
    expect(tracker.size).toBe(0);
  });

  it("Note-Off ohne vorheriges trackNoteOn liefert leeres Array (no-op)", () => {
    const tracker = new engine.MidiFxNoteTracker();
    const out = tracker.consumeNoteOff(60, 1);
    expect(out).toEqual([]);
    expect(tracker.size).toBe(0);
  });

  it("note-repeat-Voices (timeOffsetMs > 0) werden NICHT getrackt", () => {
    const tracker = new engine.MidiFxNoteTracker();
    const repeatNode: import("../../client/src/utils/midiFxEngine").MidiFxNode = {
      id: "r1",
      kind: "note-repeat",
      rate: "1/16",
      count: 4,
    };
    const events = engine.applyMidiFx(
      { note: 60, velocity: 100, channel: 1 },
      [repeatNode],
    );
    expect(events).toHaveLength(4);
    const tracked = tracker.trackNoteOn(60, 1, events);
    // Alle 4 Repeats sind dieselbe Note 60. Erstes Event ist t=0 + identisch
    // zu Original → kein Tracking (Caller verwendet Original-Note-Off).
    // Drei spätere Events (t>0) werden ignoriert (Note-Repeat-Spec).
    expect(tracked).toBe(0);
    expect(tracker.size).toBe(0);
  });

  it("Identity-Expansion (FX-Chain = Original-Note) wird NICHT getrackt", () => {
    const tracker = new engine.MidiFxNoteTracker();
    // Octave-Shift +0 ist effektiv identity.
    const shiftNode: import("../../client/src/utils/midiFxEngine").MidiFxNode = {
      id: "o1",
      kind: "octave-shift",
      semitones: 0,
    };
    const events = engine.applyMidiFx(
      { note: 60, velocity: 100, channel: 1 },
      [shiftNode],
    );
    expect(events).toHaveLength(1);
    expect(events[0].note).toBe(60);
    const tracked = tracker.trackNoteOn(60, 1, events);
    expect(tracked).toBe(0);
    expect(tracker.consumeNoteOff(60, 1)).toEqual([]);
  });

  it("Octave-Shift +12 expanded zu Pitch-shifted Note → wird getrackt", () => {
    const tracker = new engine.MidiFxNoteTracker();
    const shiftNode: import("../../client/src/utils/midiFxEngine").MidiFxNode = {
      id: "o2",
      kind: "octave-shift",
      semitones: 12,
    };
    const events = engine.applyMidiFx(
      { note: 60, velocity: 100, channel: 1 },
      [shiftNode],
    );
    expect(events[0].note).toBe(72);
    const tracked = tracker.trackNoteOn(60, 1, events);
    expect(tracked).toBe(1);
    const off = tracker.consumeNoteOff(60, 1);
    expect(off).toEqual([{ note: 72, channel: 1 }]);
  });

  it("Mehrere Original-Notes parallel — Note-Off räumt nur die richtige auf", () => {
    const tracker = new engine.MidiFxNoteTracker();
    const chordNode: import("../../client/src/utils/midiFxEngine").MidiFxNode = {
      id: "c1",
      kind: "chord-expander",
      chordType: "major",
    };
    const e60 = engine.applyMidiFx({ note: 60, velocity: 100, channel: 1 }, [chordNode]);
    const e64 = engine.applyMidiFx({ note: 64, velocity: 100, channel: 1 }, [chordNode]);
    tracker.trackNoteOn(60, 1, e60);
    tracker.trackNoteOn(64, 1, e64);
    expect(tracker.size).toBe(2);
    const off60 = tracker.consumeNoteOff(60, 1);
    expect(off60.map((o) => o.note).sort((a, b) => a - b)).toEqual([60, 64, 67]);
    // Note 64-Chord ist noch da.
    expect(tracker.size).toBe(1);
    const off64 = tracker.consumeNoteOff(64, 1);
    expect(off64.map((o) => o.note).sort((a, b) => a - b)).toEqual([64, 68, 71]);
    expect(tracker.size).toBe(0);
  });

  it("clear() leert alle aktiven Tracks (Panic-Stop)", () => {
    const tracker = new engine.MidiFxNoteTracker();
    const chord: import("../../client/src/utils/midiFxEngine").MidiFxNode = {
      id: "c1",
      kind: "chord-expander",
      chordType: "major",
    };
    tracker.trackNoteOn(60, 1, engine.applyMidiFx({ note: 60, velocity: 100, channel: 1 }, [chord]));
    tracker.trackNoteOn(64, 1, engine.applyMidiFx({ note: 64, velocity: 100, channel: 1 }, [chord]));
    expect(tracker.size).toBe(2);
    tracker.clear();
    expect(tracker.size).toBe(0);
    expect(tracker.consumeNoteOff(60, 1)).toEqual([]);
  });

  it("Channel-getrennte Tracks: gleiche Note auf Ch1 und Ch2 unabhängig", () => {
    const tracker = new engine.MidiFxNoteTracker();
    const chord: import("../../client/src/utils/midiFxEngine").MidiFxNode = {
      id: "c1",
      kind: "chord-expander",
      chordType: "minor",
    };
    tracker.trackNoteOn(60, 1, engine.applyMidiFx({ note: 60, velocity: 100, channel: 1 }, [chord]));
    tracker.trackNoteOn(60, 2, engine.applyMidiFx({ note: 60, velocity: 100, channel: 2 }, [chord]));
    expect(tracker.size).toBe(2);
    const off1 = tracker.consumeNoteOff(60, 1);
    expect(off1.every((o) => o.channel === 1)).toBe(true);
    const off2 = tracker.consumeNoteOff(60, 2);
    expect(off2.every((o) => o.channel === 2)).toBe(true);
  });
});

// ─── (10) Schema v1.34 Round-Trip (v3.93.0) ──────────────────────────────────

describe("Schema v1.34 (midiFxChain) Round-Trip", () => {
  it("SYNTH_FILE_VERSION ist 1.34", async () => {
    const serializer = await import("../../client/src/utils/projectSerializer");
    expect(serializer.SYNTH_FILE_VERSION).toBe("1.35");
  });

  it("Round-Trip: midiFxChain wird serialisiert + reparst", async () => {
    const serializer = await import("../../client/src/utils/projectSerializer");
    const chain: import("../../client/src/utils/midiFxEngine").MidiFxNode[] = [
      { id: "n1", kind: "octave-shift", semitones: 12 },
      { id: "n2", kind: "scale-snap", scale: "major", root: 0 },
      { id: "n3", kind: "chord-expander", chordType: "major" },
    ];
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
      midiFxChain: chain,
    } as unknown as Parameters<typeof serializer.serializeProject>[0]);

    expect(project.version).toBe("1.35");
    expect(project.midiFxChain).toBeDefined();
    expect(project.midiFxChain!).toHaveLength(3);

    const json = serializer.toJson(project);
    const parsed = serializer.parseProject(json);
    expect(parsed.midiFxChain).toBeDefined();
    expect(parsed.midiFxChain!).toHaveLength(3);
    expect(parsed.midiFxChain![0].kind).toBe("octave-shift");
    if (parsed.midiFxChain![0].kind === "octave-shift") {
      expect(parsed.midiFxChain![0].semitones).toBe(12);
    }
    expect(parsed.midiFxChain![2].kind).toBe("chord-expander");
  });

  it("Pre-v1.34 File ohne midiFxChain-Feld lädt mit empty/undefined (User-Store nicht überschreiben)", async () => {
    const serializer = await import("../../client/src/utils/projectSerializer");
    const oldJson = JSON.stringify({
      version: "1.33",
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
    // Signal an Restore: User-localStorage nicht überschreiben.
    expect(parsed.midiFxChain).toBeUndefined();
  });

  it("Invalide midiFxChain-Einträge werden silent gefiltert beim parseProject", async () => {
    const serializer = await import("../../client/src/utils/projectSerializer");
    const project = {
      version: "1.34",
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
      midiFxChain: [
        { id: "valid", kind: "octave-shift", semitones: 5 },
        { id: "bad", kind: "unknown-kind" },
        null,
        { id: "valid", kind: "scale-snap" }, // dupe id
        { id: "ok2", kind: "velocity-curve", curve: "exp", amount: 99 },
      ],
    };
    const parsed = serializer.parseProject(JSON.stringify(project));
    expect(parsed.midiFxChain).toBeDefined();
    // Mindestens octave-shift + velocity-curve sollten reinkommen
    expect(parsed.midiFxChain!.length).toBeGreaterThanOrEqual(2);
    const vc = parsed.midiFxChain!.find((n) => n.kind === "velocity-curve");
    expect(vc).toBeDefined();
    if (vc && vc.kind === "velocity-curve") {
      // amount clamped to 1 (war 99)
      expect(vc.amount).toBe(1);
    }
  });

  it("Explicit leeres midiFxChain-Array wird respektiert", async () => {
    const serializer = await import("../../client/src/utils/projectSerializer");
    const project = {
      version: "1.34",
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
      midiFxChain: [],
    };
    const parsed = serializer.parseProject(JSON.stringify(project));
    expect(parsed.midiFxChain).toBeDefined();
    expect(parsed.midiFxChain!).toHaveLength(0);
  });
});
