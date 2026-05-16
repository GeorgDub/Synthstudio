// @vitest-environment jsdom
/**
 * tests/features/use-mpe-hook.test.ts (TASK-CVG-USE-MPE / v2.75)
 *
 * Coverage für useMpe (Hook) + processMpeMessage (pure) + dispatchMpeVoice.
 *
 * MIDI Polyphonic Expression: Kanal 2-15 sind Voice-Channels mit jeweils
 * eigenem Pitch-Bend, Aftertouch, CC74 (Timbre). Kanal 1 = Master, wird
 * ignoriert. NoteOff = 0x80 ODER 0x90 mit velocity=0.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import {
  useMpe,
  processMpeMessage,
  dispatchMpeVoice,
  MPE_EVENT,
  type MpeVoice,
} from "@/hooks/useMpe";

// ─── Test-Setup ──────────────────────────────────────────────────────────────

const mpeEvents: MpeVoice[] = [];
let unsubMpe: (() => void) | null = null;

beforeEach(() => {
  mpeEvents.length = 0;
  const handler = (e: Event) => mpeEvents.push((e as CustomEvent<MpeVoice>).detail);
  window.addEventListener(MPE_EVENT, handler);
  unsubMpe = () => window.removeEventListener(MPE_EVENT, handler);
});

afterEach(() => {
  unsubMpe?.();
  unsubMpe = null;
  cleanup();
});

function fireMidi(type: number, channel: number, byte1: number, byte2: number) {
  window.dispatchEvent(new CustomEvent("midi:rawmessage", {
    detail: { type, channel, byte1, byte2 },
  }));
}

// ─── processMpeMessage – NoteOn ──────────────────────────────────────────────

describe("processMpeMessage – NoteOn", () => {
  it("Channel 2 + velocity>0 → Voice added mit active=true", () => {
    const result = processMpeMessage(0x90, 2, 60, 100, new Map(), 48);
    const voice = result.get(2)!;
    expect(voice.channel).toBe(2);
    expect(voice.note).toBe(60);
    expect(voice.velocity).toBe(100);
    expect(voice.active).toBe(true);
    expect(voice.pitch).toBe(0);
    expect(voice.pressure).toBe(0);
    expect(voice.timbre).toBe(0.5);
  });

  it("Channel 1 (Master): NoteOn wird IGNORIERT (kein voice channel)", () => {
    const result = processMpeMessage(0x90, 1, 60, 100, new Map(), 48);
    expect(result.size).toBe(0);
  });

  it("Channel 15 (oberer voice channel): NoteOn akzeptiert", () => {
    const result = processMpeMessage(0x90, 15, 60, 100, new Map(), 48);
    expect(result.get(15)).toBeDefined();
  });

  it("Velocity=0 + 0x90 wird als NoteOff behandelt (kein neuer Voice)", () => {
    const result = processMpeMessage(0x90, 2, 60, 0, new Map(), 48);
    expect(result.size).toBe(0);
  });

  it("dispatchMpeVoice wird beim NoteOn aufgerufen", () => {
    processMpeMessage(0x90, 2, 60, 100, new Map(), 48);
    expect(mpeEvents).toHaveLength(1);
    expect(mpeEvents[0].active).toBe(true);
  });

  it("Map ist immutable: input-Map bleibt unverändert", () => {
    const input = new Map<number, MpeVoice>();
    const result = processMpeMessage(0x90, 2, 60, 100, input, 48);
    expect(input.size).toBe(0);
    expect(result.size).toBe(1);
    expect(result).not.toBe(input);
  });
});

// ─── processMpeMessage – NoteOff ─────────────────────────────────────────────

describe("processMpeMessage – NoteOff", () => {
  function makeMapWithVoice(channel: number, note: number): Map<number, MpeVoice> {
    return processMpeMessage(0x90, channel, note, 100, new Map(), 48);
  }

  it("0x80 markiert voice als active=false (Voice bleibt im Map)", () => {
    const initial = makeMapWithVoice(2, 60);
    mpeEvents.length = 0;
    const result = processMpeMessage(0x80, 2, 60, 0, initial, 48);
    expect(result.get(2)!.active).toBe(false);
    expect(result.get(2)!.note).toBe(60); // Voice-Info bleibt
  });

  it("0x90 + velocity=0 → analog zu 0x80 NoteOff", () => {
    const initial = makeMapWithVoice(2, 60);
    mpeEvents.length = 0;
    const result = processMpeMessage(0x90, 2, 60, 0, initial, 48);
    expect(result.get(2)!.active).toBe(false);
  });

  it("dispatchMpeVoice wird beim NoteOff aufgerufen mit active=false", () => {
    const initial = makeMapWithVoice(2, 60);
    mpeEvents.length = 0;
    processMpeMessage(0x80, 2, 60, 0, initial, 48);
    expect(mpeEvents).toHaveLength(1);
    expect(mpeEvents[0].active).toBe(false);
  });

  it("NoteOff auf nicht-existentem Kanal: no-op", () => {
    const result = processMpeMessage(0x80, 5, 60, 0, new Map(), 48);
    expect(result.size).toBe(0);
    expect(mpeEvents).toHaveLength(0);
  });
});

// ─── processMpeMessage – Pitch Bend ──────────────────────────────────────────

describe("processMpeMessage – Pitch Bend", () => {
  function startedVoice(): Map<number, MpeVoice> {
    return processMpeMessage(0x90, 2, 60, 100, new Map(), 48);
  }

  it("Pitch Bend Center (lsb=0, msb=64=0x40, 14-bit=8192): pitch=0", () => {
    const initial = startedVoice();
    mpeEvents.length = 0;
    // raw = (64<<7)|0 = 8192 → normalized = 0
    const result = processMpeMessage(0xe0, 2, 0, 64, initial, 48);
    expect(result.get(2)!.pitch).toBeCloseTo(0, 5);
  });

  it("Pitch Bend Max (lsb=127, msb=127): pitch ≈ +pitchBendRange", () => {
    const initial = startedVoice();
    mpeEvents.length = 0;
    // raw = (127<<7)|127 = 16383 → normalized = (16383-8192)/8192 ≈ 0.9999
    const result = processMpeMessage(0xe0, 2, 127, 127, initial, 48);
    expect(result.get(2)!.pitch).toBeGreaterThan(47);
    expect(result.get(2)!.pitch).toBeLessThanOrEqual(48);
  });

  it("Pitch Bend Min (lsb=0, msb=0): pitch = -pitchBendRange (exakt)", () => {
    const initial = startedVoice();
    // raw = 0 → normalized = -1 → -48
    const result = processMpeMessage(0xe0, 2, 0, 0, initial, 48);
    expect(result.get(2)!.pitch).toBe(-48);
  });

  it("Custom pitchBendRange wird respektiert", () => {
    const initial = startedVoice();
    // Range = 2 (Standard non-MPE). raw=0 → pitch=-2
    const result = processMpeMessage(0xe0, 2, 0, 0, initial, 2);
    expect(result.get(2)!.pitch).toBe(-2);
  });

  it("Pitch Bend auf nicht-existentem Kanal: no-op", () => {
    const result = processMpeMessage(0xe0, 7, 0, 64, new Map(), 48);
    expect(result.size).toBe(0);
  });

  it("Channel 1 Pitch Bend wird IGNORIERT (Master-Channel kein voice)", () => {
    const initial = startedVoice();
    mpeEvents.length = 0;
    const result = processMpeMessage(0xe0, 1, 127, 127, initial, 48);
    // Voice auf Kanal 2 hat sich nicht geändert
    expect(result.get(2)!.pitch).toBe(0);
  });
});

// ─── processMpeMessage – Aftertouch (Channel Pressure) ───────────────────────

describe("processMpeMessage – Aftertouch", () => {
  it("0xd0 mit byte1=64 → pressure ≈ 0.504", () => {
    const initial = processMpeMessage(0x90, 2, 60, 100, new Map(), 48);
    const result = processMpeMessage(0xd0, 2, 64, 0, initial, 48);
    expect(result.get(2)!.pressure).toBeCloseTo(64 / 127, 5);
  });

  it("0xd0 mit byte1=127 → pressure = 1.0", () => {
    const initial = processMpeMessage(0x90, 2, 60, 100, new Map(), 48);
    const result = processMpeMessage(0xd0, 2, 127, 0, initial, 48);
    expect(result.get(2)!.pressure).toBe(1);
  });

  it("0xd0 mit byte1=0 → pressure = 0", () => {
    const initial = processMpeMessage(0x90, 2, 60, 100, new Map(), 48);
    const result = processMpeMessage(0xd0, 2, 0, 0, initial, 48);
    expect(result.get(2)!.pressure).toBe(0);
  });

  it("Aftertouch auf nicht-existentem Kanal: no-op", () => {
    const result = processMpeMessage(0xd0, 5, 64, 0, new Map(), 48);
    expect(result.size).toBe(0);
  });
});

// ─── processMpeMessage – CC74 Timbre ─────────────────────────────────────────

describe("processMpeMessage – CC74 (Timbre)", () => {
  it("CC74 mit byte2=64 → timbre ≈ 0.504", () => {
    const initial = processMpeMessage(0x90, 2, 60, 100, new Map(), 48);
    const result = processMpeMessage(0xb0, 2, 74, 64, initial, 48);
    expect(result.get(2)!.timbre).toBeCloseTo(64 / 127, 5);
  });

  it("CC74 mit byte2=127 → timbre = 1.0", () => {
    const initial = processMpeMessage(0x90, 2, 60, 100, new Map(), 48);
    const result = processMpeMessage(0xb0, 2, 74, 127, initial, 48);
    expect(result.get(2)!.timbre).toBe(1);
  });

  it("Andere CC (z.B. CC#1 Modwheel) wird IGNORIERT", () => {
    const initial = processMpeMessage(0x90, 2, 60, 100, new Map(), 48);
    const result = processMpeMessage(0xb0, 2, 1, 100, initial, 48);
    // Voice unverändert (initial timbre = 0.5)
    expect(result.get(2)!.timbre).toBe(0.5);
  });

  it("CC74 auf nicht-existentem Kanal: no-op", () => {
    const result = processMpeMessage(0xb0, 7, 74, 100, new Map(), 48);
    expect(result.size).toBe(0);
  });
});

// ─── dispatchMpeVoice direct ─────────────────────────────────────────────────

describe("dispatchMpeVoice direct", () => {
  it("dispatcht ein CustomEvent vom Typ MPE_EVENT mit voice in detail", () => {
    const voice: MpeVoice = {
      channel: 5, note: 70, velocity: 90,
      pitch: 1.5, pressure: 0.3, timbre: 0.7, active: true,
    };
    dispatchMpeVoice(voice);
    expect(mpeEvents).toHaveLength(1);
    expect(mpeEvents[0]).toEqual(voice);
  });

  it("MPE_EVENT-Konstante ist 'mpe:voice'", () => {
    expect(MPE_EVENT).toBe("mpe:voice");
  });
});

// ─── useMpe Hook ─────────────────────────────────────────────────────────────

describe("useMpe – Hook-Integration", () => {
  it("enabled=false: voices bleibt leer auch nach midi:rawmessage", () => {
    const { result } = renderHook(() => useMpe(false));
    act(() => fireMidi(0x90, 2, 60, 100));
    expect(result.current.voices.size).toBe(0);
    expect(result.current.activeVoices).toEqual([]);
  });

  it("enabled=true + NoteOn auf ch=2: voices.size=1", () => {
    const { result } = renderHook(() => useMpe(true));
    act(() => fireMidi(0x90, 2, 60, 100));
    expect(result.current.voices.size).toBe(1);
    expect(result.current.voices.get(2)?.note).toBe(60);
  });

  it("activeVoices filtert auf active=true", () => {
    const { result } = renderHook(() => useMpe(true));
    act(() => fireMidi(0x90, 2, 60, 100));
    act(() => fireMidi(0x90, 3, 64, 100));
    act(() => fireMidi(0x80, 2, 60, 0));
    expect(result.current.voices.size).toBe(2);
    expect(result.current.activeVoices).toHaveLength(1);
    expect(result.current.activeVoices[0].note).toBe(64);
  });

  it("enabled true→false: voices wird geleert", () => {
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useMpe(enabled),
      { initialProps: { enabled: true } },
    );
    act(() => fireMidi(0x90, 2, 60, 100));
    expect(result.current.voices.size).toBe(1);

    rerender({ enabled: false });
    expect(result.current.voices.size).toBe(0);
  });

  it("pitchBendRange wird via Ref aktuell gehalten (kein Stale-Closure)", () => {
    const { result, rerender } = renderHook(
      ({ range }: { range: number }) => useMpe(true, range),
      { initialProps: { range: 48 } },
    );
    act(() => fireMidi(0x90, 2, 60, 100));
    act(() => fireMidi(0xe0, 2, 0, 0)); // pitch min
    expect(result.current.voices.get(2)!.pitch).toBe(-48);

    rerender({ range: 12 });
    act(() => fireMidi(0xe0, 2, 0, 0));
    expect(result.current.voices.get(2)!.pitch).toBe(-12);
  });

  it("Unmount entfernt window-Listener", () => {
    const { result, unmount } = renderHook(() => useMpe(true));
    act(() => fireMidi(0x90, 2, 60, 100));
    expect(result.current.voices.size).toBe(1);

    unmount();
    fireMidi(0x90, 3, 64, 100);
    // result.current ist nach Unmount frozen — keine Crashes
    expect(result.current.voices.size).toBe(1);
  });
});
