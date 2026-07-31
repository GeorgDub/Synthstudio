// @vitest-environment jsdom
/**
 * tests/features/e2-chord-playback.test.ts
 *
 * v3.311 — E2-Chord-Noten (Step-Bytes 5..7) klingen in der Engine.
 *
 * Prüft chordVoicePitches (pure) und beide Trigger-Pfade über die private
 * _scheduleStep-Seam (Muster aus audio-schedule-step-alloc.test.ts):
 *   Sample-Part → 1 Haupt- + N Chord-Aufrufe von _triggerBufferWithFx,
 *   Synth-Part  → 1 Haupt- + N Chord-Aufrufe von _triggerSynthOnChannel
 *                 (Chord-Stimmen mit auxVoice=true und ohne Slide).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  AudioEngine,
  chordVoicePitches,
  E2_CHORD_BASE_NOTE,
} from "../../client/src/audio/AudioEngine";
import type { PartData, PatternData, StepData } from "../../client/src/audio/AudioEngine";

const fakeCtx = { currentTime: 0 } as unknown as AudioContext;

function mkStep(active: boolean, over: Partial<StepData> = {}): StepData {
  return { active, velocity: 100, probability: 100, ...over };
}

function mkPart(id: string, steps: StepData[], over: Partial<PartData> = {}): PartData {
  return {
    id,
    name: id,
    muted: false,
    soloed: false,
    volume: 1,
    pan: 0,
    steps,
    fx: {} as PartData["fx"],
    ...over,
  };
}

function mkPattern(parts: PartData[]): PatternData {
  return {
    id: "p1",
    name: "p1",
    stepCount: 16,
    stepResolution: "1/16",
    bpm: 120,
    parts,
  } as unknown as PatternData;
}

function scheduleStep(stepIndex: number, time: number, pattern: PatternData): void {
  (AudioEngine as unknown as {
    _scheduleStep: (i: number, t: number, p: PatternData) => void;
  })._scheduleStep(stepIndex, time, pattern);
}

const eng = AudioEngine as unknown as Record<string, unknown>;

// ─── chordVoicePitches (pure) ────────────────────────────────────────────────

describe("chordVoicePitches", () => {
  it("Basis ist C5=72 (E2-Konvention, wie synthPitchToE2Note)", () => {
    expect(E2_CHORD_BASE_NOTE).toBe(72);
  });

  it("rechnet absolute MIDI-Noten in Halbton-Offsets um", () => {
    expect(chordVoicePitches([76, 80])).toEqual([4, 8]);
    expect(chordVoicePitches([60])).toEqual([-12]);
  });

  it("filtert 0-Slots und ungültige Werte", () => {
    expect(chordVoicePitches([76, 0, 0])).toEqual([4]);
    expect(chordVoicePitches([300, Number.NaN, -5])).toEqual([]);
    expect(chordVoicePitches(undefined)).toEqual([]);
    expect(chordVoicePitches([])).toEqual([]);
  });
});

// ─── Engine-Pfade über _scheduleStep ─────────────────────────────────────────

describe("Chord-Playback in _scheduleStep", () => {
  let randomSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fakeCtx.currentTime = 0;
    Object.assign(eng, { ctx: fakeCtx, _steps: 16 });
    randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    delete (globalThis as Record<string, unknown>)["__synthstudio_humanizer__"];
    delete (globalThis as Record<string, unknown>)["__synthstudio_beatrepeat__"];
  });

  afterEach(() => {
    randomSpy.mockRestore();
    // Own-Property-Stubs entfernen → Prototyp-Methoden gelten wieder.
    delete eng._triggerBufferWithFx;
    delete eng._triggerSynthOnChannel;
    delete eng._loadBuffer;
    Object.assign(eng, { ctx: null });
  });

  it("Sample-Part: Hauptnote + eine Voice pro Chord-Note, Pitch = Note−72", async () => {
    const fakeBuf = { duration: 1 } as unknown as AudioBuffer;
    const loadSpy = vi.fn().mockResolvedValue(fakeBuf);
    const trigSpy = vi.fn();
    eng._loadBuffer = loadSpy;
    eng._triggerBufferWithFx = trigSpy;

    const part = mkPart(
      "smp",
      [mkStep(true, { velocity: 96, pitch: 2, chordNotes: [76, 79, 0] })],
      { sampleUrl: "blob:test" }
    );
    scheduleStep(0, 0, mkPattern([part]));
    await new Promise((r) => setTimeout(r, 0));

    expect(trigSpy).toHaveBeenCalledTimes(3);
    // Aufruf-Signatur: (buf, time, vol, pan, pitch, part, stepLength)
    const pitches = trigSpy.mock.calls.map((c) => c[4]);
    expect(pitches).toEqual([2, 4, 7]); // Hauptnote step.pitch, dann 76−72, 79−72
    // Alle Stimmen: gleiches Buffer, gleiche Zeit, gleiches Volume.
    for (const call of trigSpy.mock.calls) {
      expect(call[0]).toBe(fakeBuf);
      expect(call[1]).toBe(0);
      expect(call[2]).toBeCloseTo(96 / 127, 10);
    }
  });

  it("Sample-Part ohne chordNotes: exakt eine Voice (keine Regression)", async () => {
    const fakeBuf = { duration: 1 } as unknown as AudioBuffer;
    eng._loadBuffer = vi.fn().mockResolvedValue(fakeBuf);
    const trigSpy = vi.fn();
    eng._triggerBufferWithFx = trigSpy;

    const part = mkPart("smp", [mkStep(true, { velocity: 100 })], { sampleUrl: "blob:test" });
    scheduleStep(0, 0, mkPattern([part]));
    await new Promise((r) => setTimeout(r, 0));

    expect(trigSpy).toHaveBeenCalledTimes(1);
  });

  it("Synth-Part: Chord-Stimmen mit auxVoice=true, ohne Slide, richtige Frequenzen", () => {
    const trigSpy = vi.fn();
    eng._triggerSynthOnChannel = trigSpy;

    const part = mkPart(
      "syn",
      [mkStep(true, { velocity: 100, pitch: 0, slide: true, chordNotes: [76, 84] })],
      { sourceType: "wavetable", synthParams: {} as PartData["synthParams"] }
    );
    scheduleStep(0, 0, mkPattern([part]));

    expect(trigSpy).toHaveBeenCalledTimes(3);
    // (time, freq, vol, pan, part, slide, auxVoice)
    const [main, chord1, chord2] = trigSpy.mock.calls;
    expect(main[1]).toBeCloseTo(440, 6);
    expect(main[5]).toBe(true); // Haupt-Slide bleibt erhalten
    expect(main[6]).toBeUndefined(); // Hauptnote ohne auxVoice-Flag

    expect(chord1[1]).toBeCloseTo(440 * Math.pow(2, 4 / 12), 6); // 76−72 = +4
    expect(chord2[1]).toBeCloseTo(440 * Math.pow(2, 12 / 12), 6); // 84−72 = +12
    for (const call of [chord1, chord2]) {
      expect(call[5]).toBe(false); // kein Slide auf Chord-Stimmen
      expect(call[6]).toBe(true); // auxVoice
    }
  });

  it("auxVoice-Stimmen lassen den Slide-State des Parts unangetastet", () => {
    // Echter _triggerSynthOnChannel-Codepfad bis zum Slide-State: SynthEngine
    // und Channel-Nodes stubben, dann Hauptnote + Chord-Stimme feuern und
    // prüfen, dass lastFreq die HAUPT-Frequenz ist.
    const triggered: number[] = [];
    eng._getOrCreateSynthEngine = vi.fn().mockReturnValue({
      triggerNote: (freq: number) => triggered.push(freq),
    });
    eng._getOrCreateChannelNodes = vi.fn().mockReturnValue({
      panner: { pan: { value: 0 } },
      input: {},
    });
    const ctxWithGain = {
      currentTime: 0,
      createGain: () => ({ gain: { value: 1 }, connect: () => {} }),
    } as unknown as AudioContext;
    Object.assign(eng, { ctx: ctxWithGain });

    const part = mkPart("syn2", [], {
      sourceType: "wavetable",
      synthParams: {} as PartData["synthParams"],
    });
    type TriggerFn = (
      time: number, freq: number, volume: number, pan: number,
      part: PartData, slide?: boolean, auxVoice?: boolean
    ) => boolean;
    const trigger = (
      AudioEngine as unknown as { _triggerSynthOnChannel: TriggerFn }
    )._triggerSynthOnChannel.bind(AudioEngine);

    trigger(0, 440, 1, 0, part, true); // Hauptnote, slide=true
    trigger(0, 554.37, 1, 0, part, false, true); // Chord-Stimme

    const slideState = (
      AudioEngine as unknown as {
        _partSlideState: Map<string, { lastFreq: number; lastHadSlide: boolean }>;
      }
    )._partSlideState.get("syn2");
    expect(triggered).toHaveLength(2);
    expect(slideState).toEqual({ lastFreq: 440, lastHadSlide: true });

    delete eng._getOrCreateSynthEngine;
    delete eng._getOrCreateChannelNodes;
  });
});
