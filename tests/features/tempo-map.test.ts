/**
 * tests/features/tempo-map.test.ts (v3.95.0)
 *
 * Unit-Tests fuer useTempoMapStore + tempoMap-Resolver.
 *
 * Deckt ab:
 *  - addEvent appended + sortiert nach atBar
 *  - getCurrentBpm bei static (hard-change, kein ramp)
 *  - getCurrentBpm bei ramp=true → lineare Interpolation
 *  - Empty map → null Fallback
 *  - Schema v1.35 Round-Trip (serialize + parse)
 *  - Max 32 Events enforced
 *  - Pre-erstes-Event → null Fallback
 *  - Clamping BPM in MIN_BPM..MAX_BPM
 */
import { describe, it, expect, beforeEach } from "vitest";

// ─── localStorage Mock (vor Store-Import) ────────────────────────────────────

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

import {
  addEvent,
  removeEvent,
  setEventBpm,
  setEventRamp,
  clear,
  replaceEvents,
  getTempoMapState,
  __resetTempoMapForTests,
  MAX_TEMPO_EVENTS,
  MIN_BPM,
  MAX_BPM,
  type TempoEvent,
} from "../../client/src/store/useTempoMapStore";

import {
  getCurrentBpm,
  getCurrentBpmOrFallback,
  getCurrentBpmFromStep,
  getCurrentBar,
  DEFAULT_STEPS_PER_BAR,
  serializeTempoEvents,
  parseTempoEvents,
} from "../../client/src/utils/tempoMap";

// ─── Store: addEvent sortiert ────────────────────────────────────────────────

describe("useTempoMapStore – addEvent", () => {
  beforeEach(() => {
    localStorageMock.clear();
    __resetTempoMapForTests();
  });

  it("addEvent appended + sortiert by atBar", () => {
    addEvent(32, 130);
    addEvent(0, 120);
    addEvent(16, 125);
    const state = getTempoMapState();
    expect(state.events.map((e) => e.atBar)).toEqual([0, 16, 32]);
    expect(state.events.map((e) => e.bpm)).toEqual([120, 125, 130]);
  });

  it("addEvent mit existierender atBar ueberschreibt (idempotent)", () => {
    addEvent(16, 125);
    addEvent(16, 140, true);
    const state = getTempoMapState();
    expect(state.events).toHaveLength(1);
    expect(state.events[0].bpm).toBe(140);
    expect(state.events[0].ramp).toBe(true);
  });

  it("addEvent clamped BPM in MIN_BPM..MAX_BPM", () => {
    addEvent(0, 5); // unter MIN
    addEvent(8, 500); // ueber MAX
    const state = getTempoMapState();
    expect(state.events[0].bpm).toBe(MIN_BPM);
    expect(state.events[1].bpm).toBe(MAX_BPM);
  });
});

// ─── Resolver: static (no ramp) ──────────────────────────────────────────────

describe("tempoMap.getCurrentBpm – static (kein ramp)", () => {
  it("liefert prev.bpm wenn naechstes Event ohne ramp", () => {
    const events: TempoEvent[] = [
      { atBar: 0, bpm: 120 },
      { atBar: 16, bpm: 130 },
    ];
    // Zwischen 0 und 16 bleibt es konstant 120 (hard-change am next-Event)
    expect(getCurrentBpm(events, 0)).toBe(120);
    expect(getCurrentBpm(events, 8)).toBe(120);
    expect(getCurrentBpm(events, 15.99)).toBe(120);
    expect(getCurrentBpm(events, 16)).toBe(130);
    expect(getCurrentBpm(events, 20)).toBe(130);
  });

  it("nach letztem Event → konstantes letztes BPM", () => {
    const events: TempoEvent[] = [{ atBar: 0, bpm: 100 }];
    expect(getCurrentBpm(events, 999)).toBe(100);
  });
});

// ─── Resolver: ramp ──────────────────────────────────────────────────────────

describe("tempoMap.getCurrentBpm – ramp=true → linear interpoliert", () => {
  it("interpoliert zwischen prev und next", () => {
    const events: TempoEvent[] = [
      { atBar: 0, bpm: 100 },
      { atBar: 10, bpm: 200, ramp: true },
    ];
    expect(getCurrentBpm(events, 0)).toBe(100);
    expect(getCurrentBpm(events, 5)).toBe(150);
    expect(getCurrentBpm(events, 7.5)).toBe(175);
    expect(getCurrentBpm(events, 10)).toBe(200);
  });

  it("Ramp + Hold: ramp endet bei next, dann konstant", () => {
    const events: TempoEvent[] = [
      { atBar: 0, bpm: 100 },
      { atBar: 10, bpm: 200, ramp: true },
      { atBar: 20, bpm: 150 }, // hard-change zurueck (kein ramp)
    ];
    expect(getCurrentBpm(events, 5)).toBe(150); // mitten in ramp
    expect(getCurrentBpm(events, 10)).toBe(200); // Plateau erreicht
    expect(getCurrentBpm(events, 15)).toBe(200); // hold bis next
    expect(getCurrentBpm(events, 20)).toBe(150); // hard-change
  });
});

// ─── Resolver: Empty map + Fallback ──────────────────────────────────────────

describe("tempoMap.getCurrentBpm – Empty / Fallback", () => {
  it("Empty map → null", () => {
    expect(getCurrentBpm([], 0)).toBe(null);
    expect(getCurrentBpm([], 99)).toBe(null);
  });

  it("Position vor erstem Event → null", () => {
    const events: TempoEvent[] = [{ atBar: 4, bpm: 130 }];
    expect(getCurrentBpm(events, 0)).toBe(null);
    expect(getCurrentBpm(events, 3.99)).toBe(null);
    expect(getCurrentBpm(events, 4)).toBe(130);
  });

  it("getCurrentBpmOrFallback nutzt fallback bei null", () => {
    expect(getCurrentBpmOrFallback([], 0, 120)).toBe(120);
    expect(getCurrentBpmOrFallback([{ atBar: 4, bpm: 140 }], 0, 120)).toBe(120);
    expect(getCurrentBpmOrFallback([{ atBar: 4, bpm: 140 }], 4, 120)).toBe(140);
  });
});

// ─── Schema v1.35 Round-Trip ──────────────────────────────────────────────────

describe("tempoMap – Schema v1.35 Round-Trip", () => {
  it("serialize + parse round-trip mit ramp-Flag", () => {
    const orig: TempoEvent[] = [
      { atBar: 0, bpm: 120 },
      { atBar: 16, bpm: 130, ramp: true },
      { atBar: 32, bpm: 100 },
    ];
    const serialized = serializeTempoEvents(orig);
    const json = JSON.stringify(serialized);
    const restored = parseTempoEvents(JSON.parse(json));
    expect(restored).toEqual([
      { atBar: 0, bpm: 120, ramp: false },
      { atBar: 16, bpm: 130, ramp: true },
      { atBar: 32, bpm: 100, ramp: false },
    ]);
  });

  it("parseTempoEvents filtert invalide Eintraege weg", () => {
    const input = [
      { atBar: 0, bpm: 120 },
      { foo: "bar" },
      null,
      { atBar: "x", bpm: 130 },
      { atBar: 16, bpm: 140 },
    ];
    const parsed = parseTempoEvents(input);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].atBar).toBe(0);
    expect(parsed[1].atBar).toBe(16);
  });

  it("parseTempoEvents auf non-Array → leere Liste", () => {
    expect(parseTempoEvents(null)).toEqual([]);
    expect(parseTempoEvents(undefined)).toEqual([]);
    expect(parseTempoEvents({})).toEqual([]);
    expect(parseTempoEvents("foo")).toEqual([]);
  });
});

// ─── Max 32 Events enforced ──────────────────────────────────────────────────

describe("useTempoMapStore – MAX_TEMPO_EVENTS enforced", () => {
  beforeEach(() => {
    localStorageMock.clear();
    __resetTempoMapForTests();
  });

  it("addEvent ueber MAX_TEMPO_EVENTS → silent no-op", () => {
    for (let i = 0; i < MAX_TEMPO_EVENTS; i++) {
      addEvent(i, 100 + i);
    }
    expect(getTempoMapState().events).toHaveLength(MAX_TEMPO_EVENTS);
    addEvent(999, 222); // sollte ignoriert werden
    expect(getTempoMapState().events).toHaveLength(MAX_TEMPO_EVENTS);
    expect(getTempoMapState().events.find((e) => e.atBar === 999)).toBeUndefined();
  });

  it("replaceEvents kappt auf MAX_TEMPO_EVENTS", () => {
    const huge: TempoEvent[] = Array.from({ length: MAX_TEMPO_EVENTS + 10 }, (_, i) => ({
      atBar: i,
      bpm: 100 + i,
    }));
    replaceEvents(huge);
    expect(getTempoMapState().events).toHaveLength(MAX_TEMPO_EVENTS);
  });
});

// ─── Update / Remove / Clear ──────────────────────────────────────────────────

describe("useTempoMapStore – setEventBpm / setEventRamp / removeEvent / clear", () => {
  beforeEach(() => {
    localStorageMock.clear();
    __resetTempoMapForTests();
  });

  it("setEventBpm aendert BPM eines existierenden Events", () => {
    addEvent(0, 120);
    setEventBpm(0, 140);
    expect(getTempoMapState().events[0].bpm).toBe(140);
  });

  it("setEventRamp toggelt das Ramp-Flag", () => {
    addEvent(0, 120);
    setEventRamp(0, true);
    expect(getTempoMapState().events[0].ramp).toBe(true);
    setEventRamp(0, false);
    expect(getTempoMapState().events[0].ramp).toBe(false);
  });

  it("removeEvent entfernt by atBar", () => {
    addEvent(0, 120);
    addEvent(16, 130);
    removeEvent(0);
    const state = getTempoMapState();
    expect(state.events).toHaveLength(1);
    expect(state.events[0].atBar).toBe(16);
  });

  it("clear leert die ganze Map", () => {
    addEvent(0, 120);
    addEvent(16, 130);
    clear();
    expect(getTempoMapState().events).toHaveLength(0);
  });
});

// ─── localStorage Persistenz ──────────────────────────────────────────────────

describe("useTempoMapStore – localStorage Persistenz", () => {
  beforeEach(() => {
    localStorageMock.clear();
    __resetTempoMapForTests();
  });

  it("addEvent persistiert in localStorage", () => {
    addEvent(8, 135, true);
    const raw = localStorageMock.getItem("ss-tempo-map:v1");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.events[0].atBar).toBe(8);
    expect(parsed.events[0].bpm).toBe(135);
    expect(parsed.events[0].ramp).toBe(true);
  });
});

// ─── v3.104.0: stepCount-aware Resolver ───────────────────────────────────────

describe("tempoMap.getCurrentBar – stepCount-aware (v3.104.0)", () => {
  it("16-step pattern: step 0..15 = bar 0, step 16..31 = bar 1", () => {
    expect(getCurrentBar(0, 16)).toBe(0);
    expect(getCurrentBar(8, 16)).toBe(0);
    expect(getCurrentBar(15, 16)).toBe(0);
    expect(getCurrentBar(16, 16)).toBe(1);
    expect(getCurrentBar(24, 16)).toBe(1);
    expect(getCurrentBar(31, 16)).toBe(1);
    expect(getCurrentBar(32, 16)).toBe(2);
  });

  it("32-step pattern: step 0..31 = bar 0, step 32..63 = bar 1", () => {
    expect(getCurrentBar(0, 32)).toBe(0);
    expect(getCurrentBar(16, 32)).toBe(0);
    expect(getCurrentBar(31, 32)).toBe(0);
    expect(getCurrentBar(32, 32)).toBe(1);
    expect(getCurrentBar(48, 32)).toBe(1);
    expect(getCurrentBar(63, 32)).toBe(1);
    expect(getCurrentBar(64, 32)).toBe(2);
  });

  it("12-step triplet: step 0..11 = bar 0, step 12..23 = bar 1", () => {
    expect(getCurrentBar(0, 12)).toBe(0);
    expect(getCurrentBar(6, 12)).toBe(0);
    expect(getCurrentBar(11, 12)).toBe(0);
    expect(getCurrentBar(12, 12)).toBe(1);
    expect(getCurrentBar(23, 12)).toBe(1);
    expect(getCurrentBar(24, 12)).toBe(2);
  });

  it("Backwards-compat: default stepsPerBar = 16 wenn nicht angegeben", () => {
    expect(getCurrentBar(0)).toBe(0);
    expect(getCurrentBar(15)).toBe(0);
    expect(getCurrentBar(16)).toBe(1);
    expect(getCurrentBar(32)).toBe(2);
    expect(DEFAULT_STEPS_PER_BAR).toBe(16);
  });

  it("Edge: negative step → 0, NaN/Inf → 0", () => {
    expect(getCurrentBar(-1, 16)).toBe(0);
    expect(getCurrentBar(-100, 32)).toBe(0);
    expect(getCurrentBar(NaN, 16)).toBe(0);
    expect(getCurrentBar(Infinity, 16)).toBe(0);
  });

  it("Edge: stepsPerBar=0 oder NaN → fallback auf DEFAULT_STEPS_PER_BAR", () => {
    expect(getCurrentBar(16, 0)).toBe(1);
    expect(getCurrentBar(32, NaN)).toBe(2);
    expect(getCurrentBar(48, -1)).toBe(3);
  });

  it("Edge: step exakt am Pattern-Ende eines 16-step Patterns = bar 1", () => {
    // step = patternLength bei stepCount=16 entspricht bar 1 (Wrap)
    expect(getCurrentBar(16, 16)).toBe(1);
    expect(getCurrentBar(32, 16)).toBe(2);
  });
});

describe("tempoMap.getCurrentBpmFromStep – stepsPerBar-aware (v3.104.0)", () => {
  it("16-step pattern: BPM-change bei bar 1 = step 16", () => {
    const events: TempoEvent[] = [
      { atBar: 0, bpm: 120 },
      { atBar: 1, bpm: 140 },
    ];
    expect(getCurrentBpmFromStep(0, 16, events, 100)).toBe(120);
    expect(getCurrentBpmFromStep(15, 16, events, 100)).toBe(120);
    expect(getCurrentBpmFromStep(16, 16, events, 100)).toBe(140);
    expect(getCurrentBpmFromStep(31, 16, events, 100)).toBe(140);
  });

  it("32-step pattern: BPM-change bei bar 1 = step 32", () => {
    const events: TempoEvent[] = [
      { atBar: 0, bpm: 120 },
      { atBar: 1, bpm: 140 },
    ];
    // Bar 0 = step 0..31, Bar 1 = step 32..63
    expect(getCurrentBpmFromStep(0, 32, events, 100)).toBe(120);
    expect(getCurrentBpmFromStep(16, 32, events, 100)).toBe(120);
    expect(getCurrentBpmFromStep(31, 32, events, 100)).toBe(120);
    expect(getCurrentBpmFromStep(32, 32, events, 100)).toBe(140);
    expect(getCurrentBpmFromStep(60, 32, events, 100)).toBe(140);
  });

  it("12-step triplet: BPM-change bei bar 1 = step 12", () => {
    const events: TempoEvent[] = [
      { atBar: 0, bpm: 100 },
      { atBar: 1, bpm: 150 },
    ];
    expect(getCurrentBpmFromStep(0, 12, events, 80)).toBe(100);
    expect(getCurrentBpmFromStep(11, 12, events, 80)).toBe(100);
    expect(getCurrentBpmFromStep(12, 12, events, 80)).toBe(150);
    expect(getCurrentBpmFromStep(23, 12, events, 80)).toBe(150);
  });

  it("Empty map → fallback BPM (alle stepsPerBar-Werte)", () => {
    expect(getCurrentBpmFromStep(0, 16, [], 120)).toBe(120);
    expect(getCurrentBpmFromStep(100, 32, [], 130)).toBe(130);
    expect(getCurrentBpmFromStep(50, 12, [], 110)).toBe(110);
  });

  it("Backwards-compat: stepsPerBar nicht angegeben → bar via Standard 16", () => {
    const events: TempoEvent[] = [
      { atBar: 0, bpm: 120 },
      { atBar: 1, bpm: 140 },
    ];
    // Direct getCurrentBpm bleibt bar-basiert (kein stepsPerBar Param)
    expect(getCurrentBpm(events, 0)).toBe(120);
    expect(getCurrentBpm(events, 1)).toBe(140);
  });
});
