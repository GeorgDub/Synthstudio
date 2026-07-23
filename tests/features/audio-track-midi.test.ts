/**
 * tests/features/audio-track-midi.test.ts
 *
 * MIDI-Learn für Audio-Track- / Loop-Sampler-Lanes (Volume/Pan/Mute/Solo).
 * FX-Params laufen bereits über das geteilte `fxParam`-Target (getestet in
 * midi-event-bridge). Hier: die 4 neuen audioTrack*-Targets + ihr Bridge-Wiring.
 *
 * Muster 1:1 aus sub-mix-bus-midi.test.ts übernommen (env:node + localStorage-
 * Mock; die UI reicht onContextMenu/onClick 1:1 an Store-Setter + MIDI-Events
 * durch, daher kein jsdom-Render nötig).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

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

class TestEventTarget extends EventTarget {
  get localStorage() {
    return localStorageMock;
  }
}
Object.defineProperty(globalThis, "window", {
  value: new TestEventTarget(),
  writable: true,
  configurable: true,
});

let storeModule: typeof import("../../client/src/store/useAudioTrackStore");
let midiModule: typeof import("../../client/src/hooks/useMidi");
let layoutModule: typeof import("../../client/src/utils/midiLayoutImport");
let bridgeModule: typeof import("../../client/src/hooks/useMidiEventBridge");

beforeEach(async () => {
  vi.resetModules();
  localStorageMock.clear();
  storeModule = await import("../../client/src/store/useAudioTrackStore");
  midiModule = await import("../../client/src/hooks/useMidi");
  layoutModule = await import("../../client/src/utils/midiLayoutImport");
  bridgeModule = await import("../../client/src/hooks/useMidiEventBridge");
  storeModule.__resetForTests();
});

function seedTrack(
  patch: Partial<
    import("../../client/src/audio/AudioEngine").AudioTrackChannelData
  > = {}
) {
  return storeModule.addAudioTrack({
    name: "Melody",
    filePath: "melody.wav",
    fileName: "melody.wav",
    volume: 1,
    pan: 0,
    muted: false,
    soloed: false,
    sends: { reverb: 0, delay: 0 },
    ...patch,
  });
}

// ─── Targets + Matching ──────────────────────────────────────────────────────

describe("audioTrack* MidiLearnTarget — Identität & Matching", () => {
  it("targetsMatch: gleicher trackId & type → match, sonst nicht", () => {
    expect(
      midiModule.targetsMatch(
        { type: "audioTrackVolume", trackId: "audiotrack:1" },
        { type: "audioTrackVolume", trackId: "audiotrack:1", trackName: "Mel" }
      )
    ).toBe(true);
    expect(
      midiModule.targetsMatch(
        { type: "audioTrackVolume", trackId: "audiotrack:1" },
        { type: "audioTrackVolume", trackId: "audiotrack:2" }
      )
    ).toBe(false);
    expect(
      midiModule.targetsMatch(
        { type: "audioTrackVolume", trackId: "audiotrack:1" },
        { type: "audioTrackMute", trackId: "audiotrack:1" }
      )
    ).toBe(false);
  });

  it("labelForTarget: trackName mit Fallback auf trackId-Slice", () => {
    expect(
      midiModule.labelForTarget({
        type: "audioTrackVolume",
        trackId: "audiotrack:abc",
        trackName: "Chorus",
      })
    ).toBe("Audio Volume: Chorus");
    expect(
      midiModule.labelForTarget({
        type: "audioTrackSolo",
        trackId: "audiotrack:xyz9",
      })
    ).toBe("Audio Solo: audiotrack:x");
  });
});

describe("VALID_TARGET_TYPES enthält die audioTrack*-Targets", () => {
  it("alle 4 sind gültige Layout-Import-Targets", () => {
    for (const t of [
      "audioTrackVolume",
      "audioTrackPan",
      "audioTrackMute",
      "audioTrackSolo",
    ]) {
      expect(layoutModule.VALID_TARGET_TYPES.has(t)).toBe(true);
    }
  });
});

// ─── Bridge-Handler → Audio-Track-Store ──────────────────────────────────────

describe("MidiEventBridge — audioTrack*-Handler bindet auf Store", () => {
  function makeRefs() {
    return {
      dmRef: {
        current: {
          setPartVolume: () => {},
          setPartPan: () => {},
          setPartSoloed: () => {},
          setPartMuted: () => {},
          setPartFx: () => {},
          setActivePattern: () => {},
          getActivePattern: () => undefined,
          patterns: [],
        },
      } as never,
      projectRef: {
        current: {
          setBpm: () => {},
          togglePlayStop: () => {},
          isPlaying: false,
        },
      } as never,
      audioEngine: {
        setMasterVolume: vi.fn(),
        setAudioTrackVolume: vi.fn(),
        setAudioTrackPan: vi.fn(),
        setAudioTrackMute: vi.fn(),
      },
    };
  }
  const find = (id: string) =>
    storeModule.getAllAudioTracks().find(t => t.id === id)!;

  it("audioTrackVolume setzt Store + Engine, clamped 0..2", () => {
    const id = seedTrack();
    const refs = makeRefs();
    const h = bridgeModule.makeMidiBridgeHandlers(refs);
    h.handleAudioTrackVolume(
      new CustomEvent("midi:audioTrackVolume", {
        detail: { trackId: id, value: 1.5 },
      })
    );
    expect(find(id).volume).toBeCloseTo(1.5, 5);
    expect(refs.audioEngine.setAudioTrackVolume).toHaveBeenCalledWith(id, 1.5);
    // Über-Range → auf 2 geclampt.
    h.handleAudioTrackVolume(
      new CustomEvent("midi:audioTrackVolume", {
        detail: { trackId: id, value: 5 },
      })
    );
    expect(find(id).volume).toBe(2);
  });

  it("audioTrackPan setzt Store, clamped -1..1, NaN = no-op", () => {
    const id = seedTrack();
    const h = bridgeModule.makeMidiBridgeHandlers(makeRefs());
    h.handleAudioTrackPan(
      new CustomEvent("midi:audioTrackPan", {
        detail: { trackId: id, value: -0.5 },
      })
    );
    expect(find(id).pan).toBeCloseTo(-0.5, 5);
    h.handleAudioTrackPan(
      new CustomEvent("midi:audioTrackPan", {
        detail: { trackId: id, value: NaN },
      })
    );
    expect(find(id).pan).toBeCloseTo(-0.5, 5); // unverändert
  });

  it("audioTrackMute toggelt (false → true → false)", () => {
    const id = seedTrack({ muted: false });
    const h = bridgeModule.makeMidiBridgeHandlers(makeRefs());
    h.handleAudioTrackMute(
      new CustomEvent("midi:audioTrackMute", { detail: id })
    );
    expect(find(id).muted).toBe(true);
    h.handleAudioTrackMute(
      new CustomEvent("midi:audioTrackMute", { detail: id })
    );
    expect(find(id).muted).toBe(false);
  });

  it("audioTrackSolo setzt soloed true", () => {
    const id = seedTrack({ soloed: false });
    const h = bridgeModule.makeMidiBridgeHandlers(makeRefs());
    h.handleAudioTrackSolo(
      new CustomEvent("midi:audioTrackSolo", { detail: id })
    );
    expect(find(id).soloed).toBe(true);
  });

  it("unbekannte trackId → no-op (kein Crash)", () => {
    const id = seedTrack();
    const h = bridgeModule.makeMidiBridgeHandlers(makeRefs());
    h.handleAudioTrackMute(
      new CustomEvent("midi:audioTrackMute", { detail: "ghost" })
    );
    h.handleAudioTrackSolo(
      new CustomEvent("midi:audioTrackSolo", { detail: "ghost" })
    );
    expect(find(id).muted).toBe(false);
    expect(find(id).soloed).toBe(false);
  });
});
