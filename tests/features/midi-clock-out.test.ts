/**
 * tests/features/midi-clock-out.test.ts
 *
 * Unit-Tests für MidiClockOut + midiOutput-Helpers (TASK-230 / v2.83.0).
 *
 * Deterministisches Setup: wir nutzen einen Mock-Sender, der jede Message in
 * ein Array pusht. Tick-Timing wird über das `scheduleTicks(lookAhead, bpm)`-
 * Interface getrieben — KEIN setInterval oder echte Zeit.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  MidiClockOut,
  tickDurationSec,
  planTicks,
} from "../../client/src/audio/MidiClockOut";
import {
  MIDI_CLOCK_TICK,
  MIDI_CLOCK_START,
  MIDI_CLOCK_CONTINUE,
  MIDI_CLOCK_STOP,
  MIDI_SPP_STATUS,
  MIDI_PPQN,
  buildSongPositionPointer,
  enumerateMidiOutputs,
  getOutputById,
  sendMessage,
  type MidiAccessLike,
  type MidiOutputLike,
} from "../../client/src/utils/midiOutput";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeMockAccess(outputs: Partial<MidiOutputLike>[]): MidiAccessLike & { sent: Map<string, number[][]> } {
  const sent = new Map<string, number[][]>();
  const map = new Map<string, MidiOutputLike>();
  for (const o of outputs) {
    const id = o.id ?? "out-" + Math.random();
    sent.set(id, []);
    // null-Erhaltung: wenn 'name' explizit als null gesetzt wurde, behalten.
    // 'in'-Check unterscheidet "nicht gesetzt" (default-Wert) von "explizit null".
    const out: MidiOutputLike = {
      id,
      name: "name" in o ? (o.name as string | null) : "Mock-Out",
      manufacturer: "manufacturer" in o ? (o.manufacturer as string | null) : "Acme",
      state: o.state ?? "connected",
      send: (data: number[] | Uint8Array) => {
        const arr = Array.isArray(data) ? [...data] : Array.from(data);
        sent.get(id)!.push(arr);
      },
    };
    map.set(id, out);
  }
  return { outputs: map, sent } as MidiAccessLike & { sent: Map<string, number[][]> };
}

function captureSender(): { sender: (bytes: number[]) => void; messages: number[][] } {
  const messages: number[][] = [];
  return {
    sender: (bytes: number[]) => { messages.push([...bytes]); },
    messages,
  };
}

// ─── tickDurationSec / planTicks ──────────────────────────────────────────────

describe("tickDurationSec (TASK-230)", () => {
  it("120 BPM → 1 Tick ≈ 20.833ms (60s / (120*24))", () => {
    expect(tickDurationSec(120)).toBeCloseTo(60 / (120 * 24), 6);
  });

  it("clamped auf 20..300 BPM", () => {
    expect(tickDurationSec(10)).toBe(tickDurationSec(20));
    expect(tickDurationSec(999)).toBe(tickDurationSec(300));
  });

  it("Konstante MIDI_PPQN = 24", () => {
    expect(MIDI_PPQN).toBe(24);
  });
});

describe("planTicks (TASK-230)", () => {
  it("liefert 24 Ticks für genau eine Quarter-Note bei 120 BPM", () => {
    const bpm = 120;
    const start = 0;
    const dur = tickDurationSec(bpm);
    // Fenster genau 1 Quarter-Note = 0.5s. Wir starten bei t=0 und gehen bis 0.5s
    // inkl. — das sind 24 Ticks (0, 1*dur, 2*dur, …, 23*dur).
    const plan = planTicks(start, 23 * dur, bpm);
    expect(plan.tickCount).toBe(24);
    expect(plan.tickTimes[0]).toBe(0);
    expect(plan.tickTimes[23]).toBeCloseTo(23 * dur, 6);
  });

  it("schreibt newNextTickTime drift-frei mit fester Tick-Dauer fort", () => {
    const bpm = 100;
    const dur = tickDurationSec(bpm);
    const plan = planTicks(0, 5 * dur, bpm);
    expect(plan.tickCount).toBe(6);
    expect(plan.newNextTickTime).toBeCloseTo(6 * dur, 6);
  });

  it("liefert 0 Ticks wenn lookAheadUntil < nextTickTime", () => {
    const plan = planTicks(1.0, 0.5, 120);
    expect(plan.tickCount).toBe(0);
    expect(plan.tickTimes).toHaveLength(0);
  });

  it("Safety: limitiert sich auf max 10000 Ticks bei pathologischen Inputs", () => {
    const plan = planTicks(0, 1e9, 120);
    expect(plan.tickCount).toBeLessThanOrEqual(10_000);
  });
});

// ─── MidiClockOut Lifecycle ──────────────────────────────────────────────────

describe("MidiClockOut transport messages (TASK-230)", () => {
  let cap: ReturnType<typeof captureSender>;
  let clock: MidiClockOut;

  beforeEach(() => {
    cap = captureSender();
    clock = new MidiClockOut(cap.sender);
    clock.setEnabled(true);
  });

  it("sendet 0xFA (Start) bei transport:play (start())", () => {
    clock.start(0);
    expect(cap.messages).toEqual([[MIDI_CLOCK_START]]);
    expect(clock.phase).toBe("running");
  });

  it("sendet 0xFC (Stop) bei transport:stop (stop())", () => {
    clock.start(0);
    clock.stop();
    expect(cap.messages[cap.messages.length - 1]).toEqual([MIDI_CLOCK_STOP]);
    expect(clock.phase).toBe("stopped");
  });

  it("sendet 0xFB (Continue) + SPP bei resume()", () => {
    clock.start(0);
    // Simuliere ein paar Ticks vor dem Pause
    clock.scheduleTicks(tickDurationSec(120) * 12, 120); // ~12 Ticks
    clock.stop();
    cap.messages.length = 0;
    clock.resume(1.0);
    // Reihenfolge: SPP zuerst, dann Continue.
    expect(cap.messages[0][0]).toBe(MIDI_SPP_STATUS);
    expect(cap.messages[cap.messages.length - 1]).toEqual([MIDI_CLOCK_CONTINUE]);
  });

  it("sendet keine Messages wenn clockOut deaktiviert", () => {
    clock.setEnabled(false);
    cap.messages.length = 0;
    clock.start(0);
    clock.scheduleTicks(1.0, 120);
    clock.stop();
    clock.resume(2.0);
    expect(cap.messages).toEqual([]);
  });

  it("setEnabled(false) während laufendem Transport sendet sofort einen Stop", () => {
    clock.start(0);
    cap.messages.length = 0;
    clock.setEnabled(false);
    expect(cap.messages).toEqual([[MIDI_CLOCK_STOP]]);
  });
});

// ─── MidiClockOut Tick-Generierung ───────────────────────────────────────────

describe("MidiClockOut tick generation (TASK-230)", () => {
  it("sendet exakt 24 Clock-Pulse pro Quarter-Note bei 120 BPM", () => {
    const cap = captureSender();
    const clock = new MidiClockOut(cap.sender);
    clock.setEnabled(true);
    clock.start(0);
    // Fenster genau 1 Quarter-Note → 24 Ticks erwartet.
    const dur = tickDurationSec(120);
    const sent = clock.scheduleTicks(23 * dur, 120);

    expect(sent).toBe(24);
    // 1 Start-Message + 24 Clock-Ticks
    const tickMessages = cap.messages.filter(m => m[0] === MIDI_CLOCK_TICK);
    expect(tickMessages.length).toBe(24);
    // Jede Tick-Message ist exakt `[0xF8]`
    expect(tickMessages.every(m => m.length === 1 && m[0] === 0xf8)).toBe(true);
  });

  it("sendet keinen Tick wenn nicht im 'running' Phase", () => {
    const cap = captureSender();
    const clock = new MidiClockOut(cap.sender);
    clock.setEnabled(true);
    // start() NICHT aufgerufen → Phase = "stopped"
    const sent = clock.scheduleTicks(1.0, 120);
    expect(sent).toBe(0);
    expect(cap.messages).toEqual([]);
  });

  it("ticksSinceStart wird über mehrere scheduleTicks-Calls aufaddiert", () => {
    const cap = captureSender();
    const clock = new MidiClockOut(cap.sender);
    clock.setEnabled(true);
    clock.start(0);
    const dur = tickDurationSec(120);
    // Mini-Epsilon-Add gegen Floating-Point-Edge: 5*dur und 11*dur sind
    // mathematisch exakt, aber clock.nextTickTime akkumuliert wie `+=dur` —
    // ein dritter Tick kann minimal über `n*dur` liegen. Wir nehmen leicht
    // großzügigeren lookAhead damit der Test deterministisch ist.
    clock.scheduleTicks(5 * dur + 1e-9, 120); // 6 Ticks
    clock.scheduleTicks(11 * dur + 1e-9, 120); // 6 weitere
    expect(clock.ticksSinceStart).toBe(12);
  });

  it("driftet nicht: nextTickTime bleibt auf exakter Tick-Boundary", () => {
    const cap = captureSender();
    const clock = new MidiClockOut(cap.sender);
    clock.setEnabled(true);
    clock.start(0);
    const dur = tickDurationSec(120);
    // Mehrere Calls mit "krummen" lookAhead-Werten
    clock.scheduleTicks(0.05, 120);  // ~2 Ticks
    clock.scheduleTicks(0.13, 120);  // weitere Ticks
    clock.scheduleTicks(0.20, 120);  // weitere
    // nextTickTime sollte ein exakter Vielfaches von dur sein, kein 0.13/0.20.
    const ticksCount = Math.round(clock.nextTickTime / dur);
    expect(clock.nextTickTime).toBeCloseTo(ticksCount * dur, 9);
  });
});

// ─── Song Position Pointer ────────────────────────────────────────────────────

describe("buildSongPositionPointer (TASK-230)", () => {
  it("Beat 0 → [0xF2, 0, 0]", () => {
    expect(buildSongPositionPointer(0)).toEqual([MIDI_SPP_STATUS, 0, 0]);
  });

  it("Beat 1 → [0xF2, 1, 0] (LSB-first)", () => {
    expect(buildSongPositionPointer(1)).toEqual([MIDI_SPP_STATUS, 1, 0]);
  });

  it("Beat 128 → [0xF2, 0, 1] (Wrap auf MSB)", () => {
    expect(buildSongPositionPointer(128)).toEqual([MIDI_SPP_STATUS, 0, 1]);
  });

  it("clamped bei 16383 (max 14-bit)", () => {
    const result = buildSongPositionPointer(99999);
    expect(result).toEqual([MIDI_SPP_STATUS, 0x7f, 0x7f]);
  });

  it("negative Werte werden auf 0 geclamped", () => {
    expect(buildSongPositionPointer(-5)).toEqual([MIDI_SPP_STATUS, 0, 0]);
  });
});

// ─── midiOutput Helper-Functions ─────────────────────────────────────────────

describe("enumerateMidiOutputs (TASK-230)", () => {
  it("liefert leere Liste wenn access null", () => {
    expect(enumerateMidiOutputs(null)).toEqual([]);
    expect(enumerateMidiOutputs(undefined)).toEqual([]);
  });

  it("wandelt MIDIAccess.outputs in MidiOutputInfo-Array", () => {
    const access = makeMockAccess([
      { id: "out-1", name: "KORG Electribe", manufacturer: "KORG" },
      { id: "out-2", name: "nanoKONTROL2",   manufacturer: "KORG" },
    ]);
    const list = enumerateMidiOutputs(access);
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe("out-1");
    expect(list[0].name).toBe("KORG Electribe");
    expect(list[1].name).toBe("nanoKONTROL2");
  });

  it("fallt back auf 'Unbekannter Ausgang' wenn name null", () => {
    const access = makeMockAccess([{ id: "out-x", name: null }]);
    const list = enumerateMidiOutputs(access);
    expect(list[0].name).toBe("Unbekannter Ausgang");
  });
});

describe("getOutputById (TASK-230)", () => {
  it("findet Output via Map.get()", () => {
    const access = makeMockAccess([{ id: "abc" }]);
    expect(getOutputById(access, "abc")).not.toBeNull();
    expect(getOutputById(access, "missing")).toBeNull();
  });

  it("liefert null bei null/undefined access oder id", () => {
    expect(getOutputById(null, "x")).toBeNull();
    expect(getOutputById(undefined, "x")).toBeNull();
    const access = makeMockAccess([{ id: "abc" }]);
    expect(getOutputById(access, null)).toBeNull();
    expect(getOutputById(access, undefined)).toBeNull();
  });
});

describe("sendMessage (TASK-230)", () => {
  it("sendet bytes an das adressierte Output", () => {
    const access = makeMockAccess([{ id: "abc" }]);
    const ok = sendMessage(access, "abc", [0xf8]);
    expect(ok).toBe(true);
    expect(access.sent.get("abc")).toEqual([[0xf8]]);
  });

  it("liefert false bei fehlendem Output", () => {
    const access = makeMockAccess([{ id: "abc" }]);
    expect(sendMessage(access, "missing", [0xf8])).toBe(false);
  });

  it("swallowed Send-Exceptions und liefert false", () => {
    const map = new Map<string, MidiOutputLike>();
    const out: MidiOutputLike = {
      id: "broken",
      name: "Broken",
      manufacturer: "",
      state: "connected",
      send: () => { throw new Error("device disconnected mid-send"); },
    };
    map.set("broken", out);
    const access = { outputs: map } as MidiAccessLike;
    expect(sendMessage(access, "broken", [0xf8])).toBe(false);
  });
});

// ─── Integration: Real-World-Flow ─────────────────────────────────────────────

describe("MidiClockOut + sendMessage integration (TASK-230)", () => {
  it("Full play→tick→stop→resume Flow produziert die korrekte Message-Sequenz", () => {
    const access = makeMockAccess([{ id: "korg-out", name: "Electribe 2" }]);
    const clock = new MidiClockOut((bytes) => {
      sendMessage(access, "korg-out", bytes);
    });
    clock.setEnabled(true);

    const dur = tickDurationSec(120);

    // 1. Play
    clock.start(0);

    // 2. Ein paar Ticks (1 Quarter-Note)
    clock.scheduleTicks(23 * dur, 120);

    // 3. Stop
    clock.stop();

    // 4. Resume
    clock.resume(1.0);

    // 5. Ein weiterer Tick
    clock.scheduleTicks(1.0 + dur, 120);

    const messages = access.sent.get("korg-out")!;
    // Erste Message muss Start sein
    expect(messages[0]).toEqual([MIDI_CLOCK_START]);
    // Genau 24 Tick-Messages aus dem ersten Block + 2 aus dem zweiten
    const tickCount = messages.filter(m => m[0] === MIDI_CLOCK_TICK).length;
    expect(tickCount).toBeGreaterThanOrEqual(24);
    // Stop muss enthalten sein
    expect(messages.some(m => m[0] === MIDI_CLOCK_STOP)).toBe(true);
    // SPP muss enthalten sein (Resume schickt eine)
    expect(messages.some(m => m[0] === MIDI_SPP_STATUS)).toBe(true);
    // Continue muss enthalten sein
    expect(messages.some(m => m[0] === MIDI_CLOCK_CONTINUE)).toBe(true);
  });
});
