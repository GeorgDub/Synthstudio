// @vitest-environment jsdom
/**
 * tests/features/use-transport-hook.test.ts (TASK-CVG-USE-TRANSPORT / v2.67)
 *
 * Unit-Coverage für useTransport — die Glue-Schicht zwischen React-State
 * (isPlaying, bpm, transpose, dm) und der AudioEngine. Tests mocken den
 * AudioEngine-Singleton komplett mit vi.mock + vi.fn(); damit verifizieren
 * wir die useEffect-getriebenen `AudioEngine.*`-Aufrufe ohne Audio-Context.
 *
 * Was getestet wird:
 *   - Callback-Registrierung beim Mount (MIDI-Out, Follow-Action, Pattern-
 *     Getter, Melodic-Getter, Position-Handler)
 *   - Play/Stop-Flow: bpm + steps + play, dann stop + setCurrentStep(0)
 *   - BPM-Sync: Pattern-eigene BPM hat Vorrang, bpmRatio wird angewendet
 *   - Position-Handler: setCurrentStep + Quantized-Commit auf Step 0
 *   - Transpose-Propagation an Engine
 *   - Unmount-Cleanup (Callbacks auf null gesetzt)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { PatternData } from "@/audio/AudioEngine";
import type { DrumMachineState, DrumMachineActions } from "@/store/useDrumMachineStore";

// ─── Mocks (vor Hook-Import!) ────────────────────────────────────────────────

vi.mock("@/audio/AudioEngine", () => {
  return {
    AudioEngine: {
      setMidiOutCallback:     vi.fn(),
      setMidiClockCallback:   vi.fn(),
      setFollowActionCallback: vi.fn(),
      setGlobalTranspose:     vi.fn(),
      setPatternGetter:       vi.fn(),
      setMelodicGetter:       vi.fn(),
      setArpGetter:           vi.fn(),
      setPatternCrossfade:    vi.fn(),
      onPatternSwitch:        vi.fn(() => () => {}),
      setBpm:                 vi.fn(),
      setSteps:               vi.fn(),
      play:                   vi.fn(() => Promise.resolve()),
      stop:                   vi.fn(),
      onPosition:             vi.fn(() => () => {}),
      previewSample:          vi.fn(() => Promise.resolve()),
    },
  };
});

vi.mock("@/store/useMelodicPartStore", () => ({
  getPattern: vi.fn(() => undefined),
}));

import { useTransport } from "@/hooks/useTransport";
import { AudioEngine } from "@/audio/AudioEngine";
import { __resetForTests as resetTranspose, setSemitones } from "@/store/useTransposeStore";
import { getPlayheadStep, __resetPlayheadForTests } from "@/store/usePlayheadStore";

// ─── Test-Fixtures ───────────────────────────────────────────────────────────

function fakeDm(overrides: Partial<DrumMachineState & DrumMachineActions> = {}): DrumMachineState & DrumMachineActions {
  return {
    getPlaybackPattern: vi.fn(() => null),
    setCurrentStep: vi.fn(),
    commitLivePatternEdit: vi.fn(),
    commitPending: false,
    ...overrides,
  } as unknown as DrumMachineState & DrumMachineActions;
}

function basePattern(overrides: Partial<PatternData> = {}): PatternData {
  return {
    id: "pat-1",
    name: "Test",
    stepCount: 16,
    stepResolution: "1/16",
    bpm: null,
    parts: [],
    ...overrides,
  } as PatternData;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resetTranspose();
  __resetPlayheadForTests();
});

// ─── Mount-Behavior ──────────────────────────────────────────────────────────

describe("useTransport – Mount-Verhalten", () => {
  it("registriert Follow-Action-Callback beim Mount", () => {
    renderHook(() => useTransport({ isPlaying: false, bpm: 120, dm: fakeDm() }));
    expect(AudioEngine.setFollowActionCallback).toHaveBeenCalledTimes(1);
  });

  it("registriert Pattern-Getter + Melodic-Getter beim Mount", () => {
    renderHook(() => useTransport({ isPlaying: false, bpm: 120, dm: fakeDm() }));
    expect(AudioEngine.setPatternGetter).toHaveBeenCalledTimes(1);
    expect(AudioEngine.setMelodicGetter).toHaveBeenCalledTimes(1);
  });

  it("registriert onPatternSwitch beim Mount (v3.269 — war vorher tot)", () => {
    renderHook(() => useTransport({ isPlaying: false, bpm: 120, dm: fakeDm() }));
    expect(AudioEngine.onPatternSwitch).toHaveBeenCalled();
  });

  it("bridged Pattern-Crossfade-Config in die Engine (v3.269)", () => {
    // Vorher gab es KEINEN Aufrufer von setPatternCrossfade → Engine-Logik tot.
    renderHook(() => useTransport({ isPlaying: false, bpm: 120, dm: fakeDm() }));
    expect(AudioEngine.setPatternCrossfade).toHaveBeenCalled();
    const cfg = (AudioEngine.setPatternCrossfade as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(cfg).toHaveProperty("enabled");
    expect(cfg).toHaveProperty("lengthSteps");
    expect(cfg).toHaveProperty("curve");
  });

  it("registriert Position-Handler beim Mount", () => {
    renderHook(() => useTransport({ isPlaying: false, bpm: 120, dm: fakeDm() }));
    expect(AudioEngine.onPosition).toHaveBeenCalledTimes(1);
  });

  it("ohne onMidiOut: setMidiOutCallback wird mit null aufgerufen", () => {
    renderHook(() => useTransport({ isPlaying: false, bpm: 120, dm: fakeDm() }));
    expect(AudioEngine.setMidiOutCallback).toHaveBeenLastCalledWith(null);
  });

  it("mit onMidiOut: setMidiOutCallback wird mit Function aufgerufen", () => {
    const onMidiOut = vi.fn();
    renderHook(() => useTransport({ isPlaying: false, bpm: 120, dm: fakeDm(), onMidiOut }));
    const lastCall = (AudioEngine.setMidiOutCallback as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    expect(typeof lastCall?.[0]).toBe("function");
  });

  it("ohne midiOutputDeviceId: setMidiClockCallback wird mit null aufgerufen", () => {
    renderHook(() => useTransport({ isPlaying: false, bpm: 120, dm: fakeDm(), onMidiOut: vi.fn() }));
    expect(AudioEngine.setMidiClockCallback).toHaveBeenLastCalledWith(null);
  });

  it("mit onMidiOut + midiOutputDeviceId: setMidiClockCallback bekommt Function", () => {
    renderHook(() => useTransport({
      isPlaying: false, bpm: 120, dm: fakeDm(),
      onMidiOut: vi.fn(),
      midiOutputDeviceId: "midi-out-1",
    }));
    const lastCall = (AudioEngine.setMidiClockCallback as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    expect(typeof lastCall?.[0]).toBe("function");
  });
});

// ─── Play/Stop ───────────────────────────────────────────────────────────────

describe("useTransport – Play/Stop-Flow", () => {
  it("isPlaying=false initial: weder play noch stop wird aufgerufen", () => {
    renderHook(() => useTransport({ isPlaying: false, bpm: 120, dm: fakeDm() }));
    expect(AudioEngine.play).not.toHaveBeenCalled();
    expect(AudioEngine.stop).not.toHaveBeenCalled();
  });

  it("isPlaying false → true ruft setBpm + setSteps + play", () => {
    const { rerender } = renderHook(
      ({ isPlaying }) => useTransport({ isPlaying, bpm: 120, dm: fakeDm() }),
      { initialProps: { isPlaying: false } },
    );
    rerender({ isPlaying: true });
    expect(AudioEngine.setBpm).toHaveBeenCalledWith(120);
    expect(AudioEngine.setSteps).toHaveBeenCalledWith(16);
    expect(AudioEngine.play).toHaveBeenCalledWith(0);
  });

  it("Play mit Pattern.stepCount=32 ruft setSteps(32)", () => {
    const dm = fakeDm({
      getPlaybackPattern: vi.fn(() => basePattern({ stepCount: 32 })),
    });
    const { rerender } = renderHook(
      ({ isPlaying }) => useTransport({ isPlaying, bpm: 120, dm }),
      { initialProps: { isPlaying: false } },
    );
    rerender({ isPlaying: true });
    expect(AudioEngine.setSteps).toHaveBeenCalledWith(32);
  });

  it("isPlaying true → false ruft stop + dm.setCurrentStep(0)", () => {
    const dm = fakeDm();
    const { rerender } = renderHook(
      ({ isPlaying }) => useTransport({ isPlaying, bpm: 120, dm }),
      { initialProps: { isPlaying: true } },
    );
    rerender({ isPlaying: false });
    expect(AudioEngine.stop).toHaveBeenCalledTimes(1);
    expect(dm.setCurrentStep).toHaveBeenCalledWith(0);
  });
});

// ─── BPM-Sync ────────────────────────────────────────────────────────────────

describe("useTransport – BPM-Sync mit Pattern-Vorrang", () => {
  it("BPM-Change ohne Pattern-Override → setBpm wird mit neuem Wert aufgerufen", () => {
    const dm = fakeDm({ getPlaybackPattern: vi.fn(() => basePattern({ bpm: null })) });
    const { rerender } = renderHook(
      ({ bpm }) => useTransport({ isPlaying: false, bpm, dm }),
      { initialProps: { bpm: 120 } },
    );
    (AudioEngine.setBpm as ReturnType<typeof vi.fn>).mockClear();
    rerender({ bpm: 140 });
    expect(AudioEngine.setBpm).toHaveBeenCalledWith(140);
  });

  it("Pattern-eigene BPM hat Vorrang vor Globaler BPM", () => {
    const dm = fakeDm({ getPlaybackPattern: vi.fn(() => basePattern({ bpm: 170 })) });
    const { rerender } = renderHook(
      ({ bpm }) => useTransport({ isPlaying: false, bpm, dm }),
      { initialProps: { bpm: 120 } },
    );
    (AudioEngine.setBpm as ReturnType<typeof vi.fn>).mockClear();
    rerender({ bpm: 140 });
    expect(AudioEngine.setBpm).toHaveBeenCalledWith(170); // pattern.bpm gewinnt
  });

  it("bpmRatio=2 (Doppeltempo): setBpm wird mit bpm*ratio aufgerufen", () => {
    const dm = fakeDm({
      getPlaybackPattern: vi.fn(() => ({ ...basePattern(), bpmRatio: 2 } as PatternData)),
    });
    const { rerender } = renderHook(
      ({ bpm }) => useTransport({ isPlaying: false, bpm, dm }),
      { initialProps: { bpm: 120 } },
    );
    (AudioEngine.setBpm as ReturnType<typeof vi.fn>).mockClear();
    rerender({ bpm: 100 });
    expect(AudioEngine.setBpm).toHaveBeenCalledWith(200); // 100 * 2
  });

  it("bpmRatio=0.5 (Halbtempo): setBpm wird mit bpm/2 aufgerufen", () => {
    const dm = fakeDm({
      getPlaybackPattern: vi.fn(() => ({ ...basePattern(), bpmRatio: 0.5 } as PatternData)),
    });
    const { rerender } = renderHook(
      ({ bpm }) => useTransport({ isPlaying: false, bpm, dm }),
      { initialProps: { bpm: 120 } },
    );
    (AudioEngine.setBpm as ReturnType<typeof vi.fn>).mockClear();
    rerender({ bpm: 160 });
    expect(AudioEngine.setBpm).toHaveBeenCalledWith(80);
  });

  it("Gleicher BPM-Wert → kein erneuter setBpm-Aufruf (Identity-Guard)", () => {
    const { rerender } = renderHook(
      ({ bpm }) => useTransport({ isPlaying: false, bpm, dm: fakeDm() }),
      { initialProps: { bpm: 120 } },
    );
    (AudioEngine.setBpm as ReturnType<typeof vi.fn>).mockClear();
    rerender({ bpm: 120 });
    expect(AudioEngine.setBpm).not.toHaveBeenCalled();
  });
});

// ─── Position-Callback ───────────────────────────────────────────────────────

describe("useTransport – Position-Callback", () => {
  // TASK-251: Per-Step wird NUR noch der dedizierte usePlayheadStore gespeist —
  // NICHT mehr dm.setCurrentStep. Dadurch erzeugt der geteilte DrumMachine-Store
  // kein neues Objekt pro Step → App.tsx (und der DrumMachine-Parent) re-rendern
  // nicht mehr 8-16×/Sekunde während Playback. Diese Assertion IST die
  // Verifikation, dass useDrumMachineStore.notify() nicht mehr pro Step feuert.
  it("Bei jedem Step-Trigger wird der Playhead-Store gespeist, NICHT dm.setCurrentStep", () => {
    let positionFn: ((step: number) => void) | null = null;
    (AudioEngine.onPosition as ReturnType<typeof vi.fn>).mockImplementationOnce((fn: (step: number) => void) => {
      positionFn = fn;
      return () => {};
    });
    const dm = fakeDm();
    renderHook(() => useTransport({ isPlaying: false, bpm: 120, dm }));

    expect(positionFn).not.toBeNull();
    positionFn!(5);
    expect(getPlayheadStep()).toBe(5);
    positionFn!(7);
    expect(getPlayheadStep()).toBe(7);
    // Der geteilte Store wird pro Step NICHT mehr mutiert (verhindert Full-Rerender).
    expect(dm.setCurrentStep).not.toHaveBeenCalled();
  });

  it("Step 0 + commitPending=true → commitLivePatternEdit wird aufgerufen", () => {
    let positionFn: ((step: number) => void) | null = null;
    (AudioEngine.onPosition as ReturnType<typeof vi.fn>).mockImplementationOnce((fn: (step: number) => void) => {
      positionFn = fn;
      return () => {};
    });
    const dm = fakeDm({ commitPending: true });
    renderHook(() => useTransport({ isPlaying: false, bpm: 120, dm }));

    positionFn!(0);
    expect(dm.commitLivePatternEdit).toHaveBeenCalledTimes(1);
  });

  it("Step 0 + commitPending=false → commitLivePatternEdit wird NICHT aufgerufen", () => {
    let positionFn: ((step: number) => void) | null = null;
    (AudioEngine.onPosition as ReturnType<typeof vi.fn>).mockImplementationOnce((fn: (step: number) => void) => {
      positionFn = fn;
      return () => {};
    });
    const dm = fakeDm({ commitPending: false });
    renderHook(() => useTransport({ isPlaying: false, bpm: 120, dm }));

    positionFn!(0);
    expect(dm.commitLivePatternEdit).not.toHaveBeenCalled();
  });

  it("Step != 0 → commitLivePatternEdit wird NICHT aufgerufen, auch wenn commitPending", () => {
    let positionFn: ((step: number) => void) | null = null;
    (AudioEngine.onPosition as ReturnType<typeof vi.fn>).mockImplementationOnce((fn: (step: number) => void) => {
      positionFn = fn;
      return () => {};
    });
    const dm = fakeDm({ commitPending: true });
    renderHook(() => useTransport({ isPlaying: false, bpm: 120, dm }));

    positionFn!(7);
    expect(dm.commitLivePatternEdit).not.toHaveBeenCalled();
  });
});

// ─── Globaler Transpose ──────────────────────────────────────────────────────

describe("useTransport – Globaler Transpose", () => {
  it("Initial: setGlobalTranspose wird mit 0 aufgerufen", () => {
    renderHook(() => useTransport({ isPlaying: false, bpm: 120, dm: fakeDm() }));
    expect(AudioEngine.setGlobalTranspose).toHaveBeenCalledWith(0);
  });

  it("Transpose-Mutation propagiert an Engine", () => {
    renderHook(() => useTransport({ isPlaying: false, bpm: 120, dm: fakeDm() }));
    (AudioEngine.setGlobalTranspose as ReturnType<typeof vi.fn>).mockClear();
    act(() => setSemitones(5));
    expect(AudioEngine.setGlobalTranspose).toHaveBeenCalledWith(5);
  });
});

// ─── Unmount-Cleanup ─────────────────────────────────────────────────────────

describe("useTransport – Unmount-Cleanup", () => {
  it("setMidiOutCallback wird mit null aufgerufen beim Unmount", () => {
    const { unmount } = renderHook(() => useTransport({
      isPlaying: false, bpm: 120, dm: fakeDm(), onMidiOut: vi.fn(),
    }));
    (AudioEngine.setMidiOutCallback as ReturnType<typeof vi.fn>).mockClear();
    unmount();
    expect(AudioEngine.setMidiOutCallback).toHaveBeenCalledWith(null);
  });

  it("setFollowActionCallback wird mit null aufgerufen beim Unmount", () => {
    const { unmount } = renderHook(() => useTransport({ isPlaying: false, bpm: 120, dm: fakeDm() }));
    (AudioEngine.setFollowActionCallback as ReturnType<typeof vi.fn>).mockClear();
    unmount();
    expect(AudioEngine.setFollowActionCallback).toHaveBeenCalledWith(null);
  });

  it("Position-Handler Unsubscribe wird aufgerufen beim Unmount", () => {
    const unsubscribe = vi.fn();
    (AudioEngine.onPosition as ReturnType<typeof vi.fn>).mockImplementationOnce(() => unsubscribe);
    const { unmount } = renderHook(() => useTransport({ isPlaying: false, bpm: 120, dm: fakeDm() }));
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

// ─── Return-API ──────────────────────────────────────────────────────────────

describe("useTransport – previewSample Return-API", () => {
  it("previewSample(url) ruft AudioEngine.previewSample mit Default-Volume 1.0", async () => {
    const { result } = renderHook(() => useTransport({ isPlaying: false, bpm: 120, dm: fakeDm() }));
    await act(async () => {
      await result.current.previewSample("kick.wav");
    });
    expect(AudioEngine.previewSample).toHaveBeenCalledWith("kick.wav", 1.0);
  });

  it("previewSample mit explizitem Volume reicht durch", async () => {
    const { result } = renderHook(() => useTransport({ isPlaying: false, bpm: 120, dm: fakeDm() }));
    await act(async () => {
      await result.current.previewSample("snare.wav", 0.5);
    });
    expect(AudioEngine.previewSample).toHaveBeenCalledWith("snare.wav", 0.5);
  });
});
