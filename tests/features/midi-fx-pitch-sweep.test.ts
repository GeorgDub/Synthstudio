/**
 * tests/features/midi-fx-pitch-sweep.test.ts (v3.100.0)
 *
 * Tests für den neuen `pitch-sweep` MidiFx-Node-Type. Pitch-Sweep nimmt
 * 1 Note-On-Event und generiert N Events mit interpolierter Pitch über
 * eine konfigurierbare Halbton-Range, Richtung und Kurve.
 *
 * Cluster:
 *  (1) Linear-Curve: gleichmäßig verteilte Pitches
 *  (2) Direction: up vs down (Vorzeichen-Inversion)
 *  (3) Exp-Curve: accelerating (Pitch-Änderung beschleunigt sich)
 *  (4) Updown: U-Form (Pitch geht hoch, dann zurück)
 *  (5) Glissando-Preset: nutzt pitch-sweep statt Chord+Repeat
 *  (6) Timing-Offsets sind monoton steigend
 *  (7) Defensive: Note-Bounds (0..127), Steps-Clamp
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

// ─── Dynamische Imports ───────────────────────────────────────────────────────

let engine: typeof import("../../client/src/utils/midiFxEngine");
let presets: typeof import("../../client/src/utils/midiFxPresets");
let store: typeof import("../../client/src/store/useMidiFxStore");

beforeEach(async () => {
  vi.resetModules();
  localStorageMock.clear();
  engine = await import("../../client/src/utils/midiFxEngine");
  presets = await import("../../client/src/utils/midiFxPresets");
  store = await import("../../client/src/store/useMidiFxStore");
  store.__resetMidiFxStoreForTests();
});

// Helper: baut einen pitch-sweep-Node mit Overrides.
function buildSweep(overrides: Partial<{
  semitones: number;
  steps: number;
  direction: "up" | "down" | "updown";
  curve: "linear" | "exp" | "log";
  stepRate: "1/8" | "1/16" | "1/32";
}> = {}) {
  return {
    id: "sweep-test",
    kind: "pitch-sweep" as const,
    semitones: overrides.semitones ?? 12,
    steps: overrides.steps ?? 8,
    direction: overrides.direction ?? ("up" as "up" | "down" | "updown"),
    curve: overrides.curve ?? ("linear" as "linear" | "exp" | "log"),
    stepRate: overrides.stepRate ?? ("1/32" as "1/8" | "1/16" | "1/32"),
  };
}

// ─── (1) Linear-Curve ─────────────────────────────────────────────────────────

describe("Pitch-Sweep: linear curve", () => {
  it("linear up 12st / 8 steps: erste Note = 60, letzte = 72", () => {
    const node = buildSweep({ semitones: 12, steps: 8, curve: "linear", direction: "up" });
    const out = engine.applyMidiFx(
      { note: 60, velocity: 100, channel: 1 },
      [node],
    );
    expect(out).toHaveLength(8);
    expect(out[0].note).toBe(60);
    expect(out[out.length - 1].note).toBe(72);
  });

  it("linear: gleichmäßig verteilte Pitches (monoton ansteigend)", () => {
    const node = buildSweep({ semitones: 12, steps: 5, curve: "linear", direction: "up" });
    const out = engine.applyMidiFx(
      { note: 60, velocity: 100, channel: 1 },
      [node],
    );
    expect(out).toHaveLength(5);
    // linear: 60, 63, 66, 69, 72 (Schritte von 3)
    expect(out.map((e) => e.note)).toEqual([60, 63, 66, 69, 72]);
    // Monotonie
    for (let i = 1; i < out.length; i++) {
      expect(out[i].note).toBeGreaterThanOrEqual(out[i - 1].note);
    }
  });

  it("pitchSweepOffsetAt linear: Mitte = halbe Range", () => {
    const off = engine.pitchSweepOffsetAt(2, 5, 12, "up", "linear");
    expect(off).toBeCloseTo(6, 5);
  });
});

// ─── (2) Direction: up vs down ────────────────────────────────────────────────

describe("Pitch-Sweep: direction", () => {
  it("Direction up: Pitches steigen", () => {
    const node = buildSweep({ semitones: 12, steps: 5, direction: "up", curve: "linear" });
    const out = engine.applyMidiFx(
      { note: 60, velocity: 100, channel: 1 },
      [node],
    );
    expect(out[0].note).toBe(60);
    expect(out[out.length - 1].note).toBe(72);
  });

  it("Direction down: Pitches fallen", () => {
    const node = buildSweep({ semitones: 12, steps: 5, direction: "down", curve: "linear" });
    const out = engine.applyMidiFx(
      { note: 60, velocity: 100, channel: 1 },
      [node],
    );
    expect(out[0].note).toBe(60);
    expect(out[out.length - 1].note).toBe(48);
    // monotone Abnahme
    for (let i = 1; i < out.length; i++) {
      expect(out[i].note).toBeLessThanOrEqual(out[i - 1].note);
    }
  });

  it("Direction up vs down: spiegelbildlich um den Mittelpunkt", () => {
    const up = engine.applyMidiFx(
      { note: 60, velocity: 100, channel: 1 },
      [buildSweep({ semitones: 12, steps: 5, direction: "up", curve: "linear" })],
    );
    const down = engine.applyMidiFx(
      { note: 60, velocity: 100, channel: 1 },
      [buildSweep({ semitones: 12, steps: 5, direction: "down", curve: "linear" })],
    );
    for (let i = 0; i < up.length; i++) {
      expect(up[i].note + down[i].note).toBe(120); // 2 × Origin
    }
  });
});

// ─── (3) Exp-Curve ────────────────────────────────────────────────────────────

describe("Pitch-Sweep: exp curve (accelerating)", () => {
  it("Exp curve: Pitch-Änderung beschleunigt sich (Δ wächst monoton)", () => {
    const node = buildSweep({ semitones: 12, steps: 8, curve: "exp", direction: "up" });
    const out = engine.applyMidiFx(
      { note: 60, velocity: 100, channel: 1 },
      [node],
    );
    expect(out).toHaveLength(8);
    expect(out[0].note).toBe(60);
    expect(out[out.length - 1].note).toBe(72);

    // Bei exp (t²) sind die Deltas am Anfang klein, am Ende groß.
    // Vergleich: erste Δ < letzte Δ.
    const firstDelta = out[1].note - out[0].note;
    const lastDelta = out[out.length - 1].note - out[out.length - 2].note;
    expect(lastDelta).toBeGreaterThan(firstDelta);
  });

  it("Log curve: Pitch-Änderung verlangsamt sich (Δ schrumpft)", () => {
    const node = buildSweep({ semitones: 24, steps: 8, curve: "log", direction: "up" });
    const out = engine.applyMidiFx(
      { note: 60, velocity: 100, channel: 1 },
      [node],
    );
    expect(out).toHaveLength(8);
    // Log: schnell am Anfang, langsam am Ende
    const firstDelta = out[1].note - out[0].note;
    const lastDelta = out[out.length - 1].note - out[out.length - 2].note;
    expect(firstDelta).toBeGreaterThan(lastDelta);
  });

  it("pitchSweepOffsetAt exp: Mitte < halbe Range (accelerating)", () => {
    // Bei t² ist offset bei t=0.5 → 0.25 × range = 3 (statt 6 linear)
    const off = engine.pitchSweepOffsetAt(2, 5, 12, "up", "exp");
    expect(off).toBeCloseTo(3, 5);
    expect(off).toBeLessThan(6);
  });
});

// ─── (4) Updown: U-Form ───────────────────────────────────────────────────────

describe("Pitch-Sweep: updown direction", () => {
  it("Updown: Pitch geht hoch, erreicht Peak in der Mitte, fällt zurück auf 0", () => {
    const node = buildSweep({
      semitones: 12,
      steps: 5,
      direction: "updown",
      curve: "linear",
    });
    const out = engine.applyMidiFx(
      { note: 60, velocity: 100, channel: 1 },
      [node],
    );
    expect(out).toHaveLength(5);
    // Start und Ende = Original-Note
    expect(out[0].note).toBe(60);
    expect(out[out.length - 1].note).toBe(60);
    // Mitte = Peak = +12
    expect(out[2].note).toBe(72);
  });

  it("Updown: U-Form symmetrisch (mirror um den Peak)", () => {
    const node = buildSweep({
      semitones: 12,
      steps: 5,
      direction: "updown",
      curve: "linear",
    });
    const out = engine.applyMidiFx(
      { note: 60, velocity: 100, channel: 1 },
      [node],
    );
    // Symmetrie: out[0]==out[4], out[1]==out[3]
    expect(out[0].note).toBe(out[4].note);
    expect(out[1].note).toBe(out[3].note);
  });
});

// ─── (5) Glissando-Preset ─────────────────────────────────────────────────────

describe("Pitch-Sweep: Glissando-Preset (v3.100.0)", () => {
  it("Glissando-Preset nutzt pitch-sweep (nicht Chord+Repeat)", () => {
    const chain = presets.loadPreset("glissando");
    const kinds = chain.map((n) => n.kind);
    expect(kinds).toContain("pitch-sweep");
    expect(kinds).not.toContain("chord-expander");
    expect(kinds).not.toContain("note-repeat");
  });

  it("Glissando: monophone Sequence (genau steps Events, nicht steps×chord)", () => {
    const chain = presets.loadPreset("glissando");
    const out = engine.applyMidiFx(
      { note: 60, velocity: 100, channel: 1 },
      chain,
    );
    // 8 Steps × 1 Voice (monophon) = 8 Events
    expect(out).toHaveLength(8);
  });

  it("Glissando: timing-Offsets monoton wachsend", () => {
    const chain = presets.loadPreset("glissando");
    const out = engine.applyMidiFx(
      { note: 60, velocity: 100, channel: 1 },
      chain,
    );
    for (let i = 1; i < out.length; i++) {
      const cur = out[i].timeOffsetMs ?? 0;
      const prev = out[i - 1].timeOffsetMs ?? 0;
      expect(cur).toBeGreaterThan(prev);
    }
  });
});

// ─── (6) Timing + Defensive ──────────────────────────────────────────────────

describe("Pitch-Sweep: timing + defensive", () => {
  it("Timing-Offsets sind monoton steigend (i × stepMs)", () => {
    const node = buildSweep({ steps: 6, stepRate: "1/16" });
    const out = engine.applyMidiFx(
      { note: 60, velocity: 100, channel: 1 },
      [node],
    );
    for (let i = 1; i < out.length; i++) {
      const cur = out[i].timeOffsetMs ?? 0;
      const prev = out[i - 1].timeOffsetMs ?? 0;
      expect(cur).toBeGreaterThan(prev);
    }
  });

  it("Note-Bounds: shift über 127 wird auf 127 geclamped", () => {
    const node = buildSweep({ semitones: 24, steps: 4, direction: "up" });
    const out = engine.applyMidiFx(
      { note: 120, velocity: 100, channel: 1 },
      [node],
    );
    for (const ev of out) {
      expect(ev.note).toBeGreaterThanOrEqual(0);
      expect(ev.note).toBeLessThanOrEqual(127);
    }
  });

  it("Store sanitizes pitch-sweep node mit invaliden Werten", () => {
    const sanitized = store.sanitizeMidiFxState({
      chain: [
        {
          id: "x",
          kind: "pitch-sweep",
          semitones: 999, // invalid → clamp 24
          steps: 1, // invalid → clamp 4
          direction: "sideways", // invalid → fallback "up"
          curve: "wobble", // invalid → fallback "linear"
          stepRate: "1/64", // invalid → fallback "1/32"
        },
      ],
    });
    expect(sanitized.chain).toHaveLength(1);
    const node = sanitized.chain[0];
    expect(node.kind).toBe("pitch-sweep");
    if (node.kind === "pitch-sweep") {
      expect(node.semitones).toBe(24);
      expect(node.steps).toBe(4);
      expect(node.direction).toBe("up");
      expect(node.curve).toBe("linear");
      expect(node.stepRate).toBe("1/32");
    }
  });

  it("makeDefaultNode('pitch-sweep') liefert sinnvolle Defaults", () => {
    const node = store.makeDefaultNode("pitch-sweep");
    expect(node.kind).toBe("pitch-sweep");
    if (node.kind === "pitch-sweep") {
      expect(node.semitones).toBe(12);
      expect(node.steps).toBe(8);
      expect(node.direction).toBe("up");
      expect(node.curve).toBe("linear");
      expect(node.stepRate).toBe("1/32");
    }
  });
});
