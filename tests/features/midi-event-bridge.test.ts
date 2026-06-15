/**
 * Synthstudio – MIDI-Event-Bridge Tests (v2.40)
 *
 * Testet die Handler-Factory makeMidiBridgeHandlers direkt — kein DOM,
 * kein React-Renderer nötig. Wir bauen synthetic Event-Objekte mit dem
 * minimalen Interface das die Handler lesen (nur .detail wird benutzt).
 */
import { describe, it, expect, vi } from "vitest";
import { makeMidiBridgeHandlers } from "../../client/src/hooks/useMidiEventBridge";

function makeMocks() {
  const dm = {
    setPartVolume: vi.fn(),
    setPartPan: vi.fn(),
    setPartSoloed: vi.fn(),
    setPartMuted: vi.fn(),
    setPartFx: vi.fn(),
    setActivePattern: vi.fn(),
    getActivePattern: vi.fn(() => ({
      parts: [
        { id: "p1", muted: false, soloed: false },
        { id: "p2", muted: true, soloed: true },
      ],
    })),
    patterns: [{ id: "pat-a" }, { id: "pat-b" }, { id: "pat-c" }],
  };
  const project = {
    setBpm: vi.fn(),
    togglePlayStop: vi.fn(),
    isPlaying: false,
  };
  const audio = { setMasterVolume: vi.fn() };
  const refs = {
    dmRef: { current: dm },
    projectRef: { current: project },
    audioEngine: audio,
  };
  return { ...refs, dm, project, audio };
}

/** Synthetic „Event"-Shape — Handler lesen nur .detail. */
function ev(detail: unknown): Event {
  return { detail } as unknown as Event;
}

describe("makeMidiBridgeHandlers — Part-Volume / Pan / Solo / FX (v1.76)", () => {
  it("handleVolume clamped 0..1", () => {
    const m = makeMocks();
    const h = makeMidiBridgeHandlers(m);
    h.handleVolume(ev({ partId: "p1", value: 0.5 }));
    expect(m.dm.setPartVolume).toHaveBeenCalledWith("p1", 0.5);
    h.handleVolume(ev({ partId: "p1", value: 1.5 }));
    expect(m.dm.setPartVolume).toHaveBeenLastCalledWith("p1", 1);
    h.handleVolume(ev({ partId: "p1", value: -0.2 }));
    expect(m.dm.setPartVolume).toHaveBeenLastCalledWith("p1", 0);
  });

  it("handlePan clamped -1..1", () => {
    const m = makeMocks();
    const h = makeMidiBridgeHandlers(m);
    h.handlePan(ev({ partId: "p1", value: -2 }));
    expect(m.dm.setPartPan).toHaveBeenCalledWith("p1", -1);
    h.handlePan(ev({ partId: "p1", value: 0.3 }));
    expect(m.dm.setPartPan).toHaveBeenLastCalledWith("p1", 0.3);
  });

  it("handleSolo togglet basierend auf aktuellem State", () => {
    const m = makeMocks();
    const h = makeMidiBridgeHandlers(m);
    h.handleSolo(ev("p1")); // soloed=false → true
    expect(m.dm.setPartSoloed).toHaveBeenCalledWith("p1", true);
    h.handleSolo(ev("p2")); // soloed=true → false
    expect(m.dm.setPartSoloed).toHaveBeenCalledWith("p2", false);
  });

  it("handleFxParam routet auf setPartFx mit dynamic key", () => {
    const m = makeMocks();
    const h = makeMidiBridgeHandlers(m);
    h.handleFxParam(ev({ partId: "p1", param: "filterFreq", value: 8000 }));
    expect(m.dm.setPartFx).toHaveBeenCalledWith("p1", { filterFreq: 8000 });
  });

  it("handleFxParam routet `audiotrack:`-IDs NICHT an dm.setPartFx (TASK-268)", () => {
    const m = makeMocks();
    const h = makeMidiBridgeHandlers(m);
    // Audio-Track teilt die midi:fxParam-Seam, ist aber an der ID-Prefix
    // erkennbar → muss am DrumMachine-Store vorbei geroutet werden.
    h.handleFxParam(ev({ partId: "audiotrack:abc", param: "filterFreq", value: 5000 }));
    expect(m.dm.setPartFx).not.toHaveBeenCalled();
    // Drum-Part-IDs gehen weiterhin an dm.setPartFx (Regression-Guard).
    h.handleFxParam(ev({ partId: "p1", param: "reverbMix", value: 0.5 }));
    expect(m.dm.setPartFx).toHaveBeenCalledWith("p1", { reverbMix: 0.5 });
  });

  it("Ungültige Detail-Shapes werden ignoriert (kein Crash)", () => {
    const m = makeMocks();
    const h = makeMidiBridgeHandlers(m);
    h.handleVolume(ev(null));
    h.handleVolume(ev("nicht-objekt"));
    h.handleVolume(ev({ partId: 123, value: 0.5 }));
    h.handleVolume(ev({ partId: "p1", value: "foo" }));
    expect(m.dm.setPartVolume).not.toHaveBeenCalled();
  });
});

describe("makeMidiBridgeHandlers — Mute (Toggle + Set)", () => {
  it("handleMute togglet basierend auf muted-State", () => {
    const m = makeMocks();
    const h = makeMidiBridgeHandlers(m);
    h.handleMute(ev("p1")); // muted=false → true
    expect(m.dm.setPartMuted).toHaveBeenCalledWith("p1", true);
    h.handleMute(ev("p2")); // muted=true → false
    expect(m.dm.setPartMuted).toHaveBeenCalledWith("p2", false);
  });

  it("handleMuteSet ist explicit set (kein Toggle)", () => {
    const m = makeMocks();
    const h = makeMidiBridgeHandlers(m);
    h.handleMuteSet(ev({ partId: "p1", value: true }));
    expect(m.dm.setPartMuted).toHaveBeenCalledWith("p1", true);
    h.handleMuteSet(ev({ partId: "p1", value: false }));
    expect(m.dm.setPartMuted).toHaveBeenCalledWith("p1", false);
  });

  it("handleMuteSet ignoriert nicht-boolean values", () => {
    const m = makeMocks();
    const h = makeMidiBridgeHandlers(m);
    h.handleMuteSet(ev({ partId: "p1", value: 1 }));
    h.handleMuteSet(ev({ partId: "p1", value: "true" }));
    expect(m.dm.setPartMuted).not.toHaveBeenCalled();
  });
});

describe("makeMidiBridgeHandlers — Transport / BPM / Master-Volume (v2.34)", () => {
  it("handleBpm clamped 20..300 + rundet", () => {
    const m = makeMocks();
    const h = makeMidiBridgeHandlers(m);
    h.handleBpm(ev({ value: 128.7 }));
    expect(m.project.setBpm).toHaveBeenCalledWith(129);
    h.handleBpm(ev({ value: 500 }));
    expect(m.project.setBpm).toHaveBeenLastCalledWith(300);
    h.handleBpm(ev({ value: 5 }));
    expect(m.project.setBpm).toHaveBeenLastCalledWith(20);
  });

  it("handleBpm akzeptiert auch detail als Number direkt", () => {
    const m = makeMocks();
    const h = makeMidiBridgeHandlers(m);
    h.handleBpm(ev(140));
    expect(m.project.setBpm).toHaveBeenCalledWith(140);
  });

  it("handleBpm ignoriert NaN/Infinity", () => {
    const m = makeMocks();
    const h = makeMidiBridgeHandlers(m);
    h.handleBpm(ev({ value: NaN }));
    h.handleBpm(ev({ value: Infinity }));
    expect(m.project.setBpm).not.toHaveBeenCalled();
  });

  it("handlePlayStop togglet immer (außer toggle=false)", () => {
    const m = makeMocks();
    const h = makeMidiBridgeHandlers(m);
    h.handlePlayStop(ev({}));
    h.handlePlayStop(ev({ toggle: true }));
    expect(m.project.togglePlayStop).toHaveBeenCalledTimes(2);
    h.handlePlayStop(ev({ toggle: false }));
    expect(m.project.togglePlayStop).toHaveBeenCalledTimes(2); // unchanged
  });

  it("handleStop ruft togglePlayStop nur wenn isPlaying=true", () => {
    const m = makeMocks();
    m.project.isPlaying = false;
    const h = makeMidiBridgeHandlers(m);
    h.handleStop(ev(undefined));
    expect(m.project.togglePlayStop).not.toHaveBeenCalled();
    m.project.isPlaying = true;
    h.handleStop(ev(undefined));
    expect(m.project.togglePlayStop).toHaveBeenCalledTimes(1);
  });

  it("handleMasterVolume routet auf audioEngine.setMasterVolume mit Clamp 0..1", () => {
    const m = makeMocks();
    const h = makeMidiBridgeHandlers(m);
    h.handleMasterVolume(ev({ value: 0.7 }));
    expect(m.audio.setMasterVolume).toHaveBeenCalledWith(0.7);
    h.handleMasterVolume(ev({ value: 2 }));
    expect(m.audio.setMasterVolume).toHaveBeenLastCalledWith(1);
    h.handleMasterVolume(ev({ value: -0.5 }));
    expect(m.audio.setMasterVolume).toHaveBeenLastCalledWith(0);
  });
});

describe("makeMidiBridgeHandlers — Pattern-Switch", () => {
  it("handlePattern mit number = direkter Index (Legacy useMidi-Format)", () => {
    const m = makeMocks();
    const h = makeMidiBridgeHandlers(m);
    h.handlePattern(ev(1));
    expect(m.dm.setActivePattern).toHaveBeenCalledWith("pat-b");
  });

  it("handlePattern mit { index } (OSC-Integer-Format)", () => {
    const m = makeMocks();
    const h = makeMidiBridgeHandlers(m);
    h.handlePattern(ev({ index: 2 }));
    expect(m.dm.setActivePattern).toHaveBeenCalledWith("pat-c");
  });

  it("handlePattern mit { patternId } (OSC-String-Format)", () => {
    const m = makeMocks();
    const h = makeMidiBridgeHandlers(m);
    h.handlePattern(ev({ patternId: "pat-b" }));
    expect(m.dm.setActivePattern).toHaveBeenCalledWith("pat-b");
  });

  it("handlePattern mit unbekannter patternId ist No-Op", () => {
    const m = makeMocks();
    const h = makeMidiBridgeHandlers(m);
    h.handlePattern(ev({ patternId: "nicht-existent" }));
    expect(m.dm.setActivePattern).not.toHaveBeenCalled();
  });

  it("handlePattern mit out-of-range Index ist No-Op", () => {
    const m = makeMocks();
    const h = makeMidiBridgeHandlers(m);
    h.handlePattern(ev(99));
    expect(m.dm.setActivePattern).not.toHaveBeenCalled();
  });

  it("handlePattern mit invalid detail-Shape ist No-Op", () => {
    const m = makeMocks();
    const h = makeMidiBridgeHandlers(m);
    h.handlePattern(ev(null));
    h.handlePattern(ev("string-direct"));
    h.handlePattern(ev({}));
    expect(m.dm.setActivePattern).not.toHaveBeenCalled();
  });
});
