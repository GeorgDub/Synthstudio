/**
 * tests/features/audio-track-store.test.ts
 *
 * Unit-Tests für useAudioTrackStore + projectSerializer-Integration.
 *
 * Abgedeckt:
 *  - addAudioTrack (happy path, ID-Prefix, Limit-Wurf)
 *  - removeAudioTrack
 *  - updateAudioTrack (Patch-Semantik, ID nicht überschreibbar)
 *  - markBroken (runtime-only)
 *  - Persistenz (localStorage round-trip)
 *  - Runtime-State wird NICHT persistiert
 *  - loadAudioTracks (kompletter Replace)
 *  - clear()
 *  - Serializer round-trip
 *  - Migration v1.14 → v1.15 (fehlendes audioTracks-Feld defaultet auf [])
 *  - Serializer filtert invalide Audio-Track-Items
 */
import { describe, it, expect, beforeEach } from "vitest";

// ─── localStorage Mock ────────────────────────────────────────────────────────

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
    _dump: (): Record<string, string> => ({ ...store }),
  };
}

const localStorageMock = createLocalStorageMock();
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

// window-Shim (für `typeof window !== "undefined"`-Pfade in anderen Modulen,
// die mitgezogen werden könnten – defensiv, kostet nichts)
if (typeof (globalThis as { window?: unknown }).window === "undefined") {
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: localStorageMock },
    writable: true,
    configurable: true,
  });
}

import {
  addAudioTrack,
  removeAudioTrack,
  updateAudioTrack,
  getAudioTrack,
  getAllAudioTracks,
  loadAudioTracks,
  clear,
  markBroken,
  getRuntimeState,
  setRuntimeWaveform,
  setAudioTrackSoloed,
  useAudioTrackStore,
  MAX_AUDIO_TRACKS,
  __resetForTests,
  type AudioTrackChannelData,
} from "../../client/src/store/useAudioTrackStore";

import {
  serializeProject,
  parseProject,
  toJson,
  SYNTH_FILE_VERSION,
  type SynthProject,
} from "../../client/src/utils/projectSerializer";

const STORAGE_KEY = "synthstudio:audiotracks:v1";

// ─── Test-Daten ───────────────────────────────────────────────────────────────

function makeTrackInput(
  overrides: Partial<Omit<AudioTrackChannelData, "id">> = {},
): Omit<AudioTrackChannelData, "id"> {
  return {
    name: "Vocal Take",
    filePath: "C:/audio/vocal.wav",
    fileName: "vocal.wav",
    fileSize: 1024,
    volume: 1.0,
    pan: 0,
    muted: false,
    soloed: false,
    sends: { reverb: 0, delay: 0 },
    startOffsetSec: 0,
    loop: false,
    syncMode: "free",
    originalBpm: null,
    ...overrides,
  };
}

function makeBaseProject(audioTracks?: AudioTrackChannelData[]): Omit<SynthProject, "version" | "savedAt"> {
  return {
    projectName: "Test Project",
    bpm: 120,
    samples: [],
    patterns: [
      // Minimaler Pattern-Stub – parseProject prüft nur "patterns" als truthy/Array.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ({ id: "p1", name: "Pattern 1", steps: [], stepCount: 16 } as any),
    ],
    activePatternId: "p1",
    song: { slots: [], songModeActive: false, loopSong: false },
    mixer: {
      masterVolume: 0.85,
      channels: {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      returnTracks: {} as any,
      insertChains: {},
      eq16: {},
      sidechains: {},
      transientShapers: {},
    },
    humanizer: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      global: {} as any,
    },
    automation: { lanes: [], stepCount: 16 },
    ...(audioTracks !== undefined ? { audioTracks } : {}),
  };
}

// ─── Test-Suite: Store ────────────────────────────────────────────────────────

describe("useAudioTrackStore", () => {
  beforeEach(() => {
    __resetForTests();
    localStorageMock.clear();
  });

  // ── Konstanten / Exporte ───────────────────────────────────────────────────

  it("exportiert MAX_AUDIO_TRACKS = 8", () => {
    expect(MAX_AUDIO_TRACKS).toBe(8);
  });

  it("exportiert useAudioTrackStore-Hook-Funktion", () => {
    expect(typeof useAudioTrackStore).toBe("function");
  });

  // ── addAudioTrack ──────────────────────────────────────────────────────────

  it("addAudioTrack mit gültigen Daten returnt ID mit 'audiotrack:' Prefix", () => {
    const id = addAudioTrack(makeTrackInput());
    expect(typeof id).toBe("string");
    expect(id.startsWith("audiotrack:")).toBe(true);
    expect(id.length).toBeGreaterThan("audiotrack:".length);
    const all = getAllAudioTracks();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(id);
    expect(all[0].name).toBe("Vocal Take");
  });

  it("addAudioTrack über das Limit (>8) wirft eine Fehler", () => {
    for (let i = 0; i < MAX_AUDIO_TRACKS; i++) {
      addAudioTrack(makeTrackInput({ name: `T${i}`, filePath: `/x/${i}.wav`, fileName: `${i}.wav` }));
    }
    expect(getAllAudioTracks()).toHaveLength(MAX_AUDIO_TRACKS);
    expect(() => addAudioTrack(makeTrackInput({ name: "overflow" }))).toThrow(
      /Maximum number of audio tracks reached/,
    );
    // State unverändert nach Fehler
    expect(getAllAudioTracks()).toHaveLength(MAX_AUDIO_TRACKS);
  });

  // ── removeAudioTrack ──────────────────────────────────────────────────────

  it("removeAudioTrack entfernt den Track per ID", () => {
    const a = addAudioTrack(makeTrackInput({ name: "A" }));
    const b = addAudioTrack(makeTrackInput({ name: "B" }));
    removeAudioTrack(a);
    const remaining = getAllAudioTracks();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(b);
    expect(getAudioTrack(a)).toBeNull();
  });

  it("removeAudioTrack mit unbekannter ID ist no-op (kein Crash)", () => {
    addAudioTrack(makeTrackInput());
    expect(() => removeAudioTrack("audiotrack:does-not-exist")).not.toThrow();
    expect(getAllAudioTracks()).toHaveLength(1);
  });

  // ── updateAudioTrack ──────────────────────────────────────────────────────

  it("updateAudioTrack patcht nur die angegebenen Felder", () => {
    const id = addAudioTrack(makeTrackInput({ name: "Old", volume: 0.5 }));
    updateAudioTrack(id, { volume: 0.8, pan: -0.5 });
    const t = getAudioTrack(id);
    expect(t).not.toBeNull();
    expect(t!.name).toBe("Old"); // unverändert
    expect(t!.volume).toBe(0.8); // gepatcht
    expect(t!.pan).toBe(-0.5);   // gepatcht
    // sends bleibt das originale Objekt (kein Patch übergeben)
    expect(t!.sends.reverb).toBe(0);
  });

  it("updateAudioTrack lässt ID-Überschreiben nicht zu", () => {
    const id = addAudioTrack(makeTrackInput());
    updateAudioTrack(id, { id: "audiotrack:hacked" } as Partial<AudioTrackChannelData>);
    const t = getAudioTrack(id);
    expect(t).not.toBeNull();
    expect(t!.id).toBe(id);
    expect(getAudioTrack("audiotrack:hacked")).toBeNull();
  });

  it("updateAudioTrack mit unbekannter ID ist no-op", () => {
    addAudioTrack(makeTrackInput());
    expect(() => updateAudioTrack("audiotrack:nope", { volume: 0.1 })).not.toThrow();
    expect(getAllAudioTracks()[0].volume).toBe(1.0);
  });

  // ── markBroken (runtime-only) ─────────────────────────────────────────────

  it("markBroken(id, true) setzt broken=true in runtime-state", () => {
    const id = addAudioTrack(makeTrackInput());
    expect(getRuntimeState(id).broken).toBe(false);
    markBroken(id, true);
    expect(getRuntimeState(id).broken).toBe(true);
    markBroken(id, false);
    expect(getRuntimeState(id).broken).toBe(false);
  });

  it("setRuntimeWaveform speichert duration + peaks (runtime-only)", () => {
    const id = addAudioTrack(makeTrackInput());
    const peaks = new Float32Array([0.1, 0.2, 0.3]);
    setRuntimeWaveform(id, 12.5, peaks);
    const rt = getRuntimeState(id);
    expect(rt.durationSec).toBe(12.5);
    expect(rt.peaks).toBe(peaks);
    expect(rt.broken).toBe(false);
  });

  // ── Persistenz ─────────────────────────────────────────────────────────────

  it("addAudioTrack persistiert in localStorage (key: synthstudio:audiotracks:v1)", () => {
    addAudioTrack(makeTrackInput({ name: "Persisted" }));
    const raw = localStorageMock.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe("Persisted");
    expect(parsed[0].id.startsWith("audiotrack:")).toBe(true);
  });

  it("Runtime-State (broken, peaks, durationSec) wird NICHT persistiert", () => {
    const id = addAudioTrack(makeTrackInput());
    markBroken(id, true);
    setRuntimeWaveform(id, 99, new Float32Array([1, 2, 3]));
    const raw = localStorageMock.getItem(STORAGE_KEY)!;
    const parsed = JSON.parse(raw);
    // Persistiertes Track-Objekt enthält keine runtime-Felder
    expect(parsed[0]).not.toHaveProperty("broken");
    expect(parsed[0]).not.toHaveProperty("peaks");
    expect(parsed[0]).not.toHaveProperty("durationSec");
  });

  // ── loadAudioTracks ────────────────────────────────────────────────────────

  it("loadAudioTracks ersetzt den State komplett", () => {
    addAudioTrack(makeTrackInput({ name: "Original" }));
    expect(getAllAudioTracks()).toHaveLength(1);

    const replacement: AudioTrackChannelData[] = [
      {
        id: "audiotrack:fromProject1",
        name: "Loaded A",
        filePath: "/proj/a.wav",
        fileName: "a.wav",
        volume: 1,
        pan: 0,
        muted: false,
        soloed: false,
        sends: { reverb: 0.1, delay: 0.2 },
      },
      {
        id: "audiotrack:fromProject2",
        name: "Loaded B",
        filePath: "/proj/b.wav",
        fileName: "b.wav",
        volume: 0.5,
        pan: 1,
        muted: true,
        soloed: false,
        sends: { reverb: 0, delay: 0 },
      },
    ];
    loadAudioTracks(replacement);
    const tracks = getAllAudioTracks();
    expect(tracks).toHaveLength(2);
    expect(tracks[0].id).toBe("audiotrack:fromProject1");
    expect(tracks[1].id).toBe("audiotrack:fromProject2");
    expect(tracks[0].name).toBe("Loaded A");
  });

  it("loadAudioTracks filtert invalide Items", () => {
    const mixed = [
      // valide
      {
        id: "audiotrack:ok",
        name: "OK",
        filePath: "/p/ok.wav",
        fileName: "ok.wav",
        volume: 1,
        pan: 0,
        muted: false,
        soloed: false,
        sends: { reverb: 0, delay: 0 },
      },
      // invalide: fehlendes filePath
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ({ id: "audiotrack:broken", name: "X", fileName: "x.wav", volume: 1, pan: 0, muted: false, soloed: false, sends: { reverb: 0, delay: 0 } } as any),
      // invalide: falsches ID-Prefix
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ({ id: "wrong-prefix", name: "Y", filePath: "/y.wav", fileName: "y.wav", volume: 1, pan: 0, muted: false, soloed: false, sends: { reverb: 0, delay: 0 } } as any),
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    loadAudioTracks(mixed as any);
    const tracks = getAllAudioTracks();
    expect(tracks).toHaveLength(1);
    expect(tracks[0].id).toBe("audiotrack:ok");
  });

  it("loadAudioTracks cappt bei MAX_AUDIO_TRACKS", () => {
    const tooMany: AudioTrackChannelData[] = [];
    for (let i = 0; i < 12; i++) {
      tooMany.push({
        id: `audiotrack:t${i}`,
        name: `T${i}`,
        filePath: `/p/${i}.wav`,
        fileName: `${i}.wav`,
        volume: 1,
        pan: 0,
        muted: false,
        soloed: false,
        sends: { reverb: 0, delay: 0 },
      });
    }
    loadAudioTracks(tooMany);
    expect(getAllAudioTracks()).toHaveLength(MAX_AUDIO_TRACKS);
  });

  it("loadAudioTracks setzt runtime-state zurück", () => {
    const id = addAudioTrack(makeTrackInput());
    markBroken(id, true);
    expect(getRuntimeState(id).broken).toBe(true);
    // Komplett anderer Track via loadAudioTracks
    loadAudioTracks([
      {
        id: "audiotrack:fresh",
        name: "F",
        filePath: "/f.wav",
        fileName: "f.wav",
        volume: 1,
        pan: 0,
        muted: false,
        soloed: false,
        sends: { reverb: 0, delay: 0 },
      },
    ]);
    // Alter Track ist weg, runtime-state für ihn ist weg
    expect(getRuntimeState(id).broken).toBe(false);
    expect(getRuntimeState("audiotrack:fresh").broken).toBe(false);
  });

  // ── clear ──────────────────────────────────────────────────────────────────

  it("clear() leert alle Tracks + runtime-state", () => {
    const id = addAudioTrack(makeTrackInput());
    markBroken(id, true);
    clear();
    expect(getAllAudioTracks()).toHaveLength(0);
    expect(getRuntimeState(id).broken).toBe(false);
  });
});

// ─── Test-Suite: Serializer-Integration ───────────────────────────────────────

describe("projectSerializer × audioTracks", () => {
  beforeEach(() => {
    __resetForTests();
    localStorageMock.clear();
  });

  it("SYNTH_FILE_VERSION ist '1.32' (v3.79.0 Sub-Mix-Buses, audioTracks bleiben additiv-kompatibel)", () => {
    expect(SYNTH_FILE_VERSION).toBe("1.33");
  });

  it("Serializer Round-trip: serialize → JSON → parse erhält audioTracks", () => {
    const tracks: AudioTrackChannelData[] = [
      {
        id: "audiotrack:rt-1",
        name: "Roundtrip",
        filePath: "/data/song.wav",
        fileName: "song.wav",
        fileSize: 4096,
        volume: 1.5,
        pan: -0.25,
        muted: false,
        soloed: true,
        sends: { reverb: 0.4, delay: 0.2 },
        startOffsetSec: 1.5,
        loop: true,
        syncMode: "stretch",
        originalBpm: 128,
      },
    ];
    const project = serializeProject(makeBaseProject(tracks));
    const json = toJson(project);
    const restored = parseProject(json);

    expect(restored.audioTracks).toBeDefined();
    expect(restored.audioTracks).toHaveLength(1);
    expect(restored.audioTracks![0]).toEqual(tracks[0]);
    expect(restored.version).toBe("1.33");
  });

  it("Migration: v1.14-File ohne audioTracks-Feld → audioTracks ist []", () => {
    // Simuliere ein v1.14-File: serialisiere und entferne dann das audioTracks-Feld
    const v114 = serializeProject(makeBaseProject(/* keine audioTracks */));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (v114 as any).audioTracks;
    (v114 as { version: string }).version = "1.14";
    const json = JSON.stringify(v114);

    const restored = parseProject(json);
    expect(restored.audioTracks).toEqual([]);
  });

  it("Serializer-parse: audioTracks=null wird zu []", () => {
    const project = serializeProject(makeBaseProject(/* keine audioTracks */));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (project as any).audioTracks = null;
    const json = JSON.stringify(project);
    const restored = parseProject(json);
    expect(restored.audioTracks).toEqual([]);
  });

  it("Serializer-parse: audioTracks=42 (kein Array) wird zu []", () => {
    const project = serializeProject(makeBaseProject(/* keine audioTracks */));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (project as any).audioTracks = 42;
    const json = JSON.stringify(project);
    const restored = parseProject(json);
    expect(restored.audioTracks).toEqual([]);
  });

  it("Serializer-parse: filtert invalide Audio-Track-Items silent", () => {
    const project = serializeProject(
      makeBaseProject([
        // valide
        {
          id: "audiotrack:keep",
          name: "Keep",
          filePath: "/keep.wav",
          fileName: "keep.wav",
          volume: 1,
          pan: 0,
          muted: false,
          soloed: false,
          sends: { reverb: 0, delay: 0 },
        },
      ]),
    );
    // Eine invalide Entry direkt im JSON dazupacken (fehlendes filePath)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (project as any).audioTracks.push({
      id: "audiotrack:drop",
      name: "Drop",
      // filePath fehlt
      fileName: "drop.wav",
      volume: 1,
      pan: 0,
      muted: false,
      soloed: false,
      sends: { reverb: 0, delay: 0 },
    });
    const json = JSON.stringify(project);
    const restored = parseProject(json);
    expect(restored.audioTracks).toHaveLength(1);
    expect(restored.audioTracks![0].id).toBe("audiotrack:keep");
  });

  it("End-to-end: Store → serialize → parse → loadAudioTracks bringt Tracks zurück", () => {
    const id1 = addAudioTrack(makeTrackInput({ name: "E2E-A", filePath: "/a.wav", fileName: "a.wav" }));
    const id2 = addAudioTrack(makeTrackInput({ name: "E2E-B", filePath: "/b.wav", fileName: "b.wav" }));
    expect(getAllAudioTracks()).toHaveLength(2);

    const project = serializeProject({
      ...makeBaseProject(),
      audioTracks: getAllAudioTracks(),
    });
    const json = toJson(project);

    // Store leeren
    clear();
    expect(getAllAudioTracks()).toHaveLength(0);

    // Aus JSON wieder laden
    const restored = parseProject(json);
    loadAudioTracks(restored.audioTracks ?? []);

    const after = getAllAudioTracks();
    expect(after).toHaveLength(2);
    expect(after.map((t) => t.id)).toEqual([id1, id2]);
    expect(after.map((t) => t.name)).toEqual(["E2E-A", "E2E-B"]);
  });
});

// ─── FOLLOWUP-102-3: setAudioTrackSoloed (additive vs exclusive) ──────────────

describe("setAudioTrackSoloed (FOLLOWUP-102-3)", () => {
  beforeEach(() => {
    __resetForTests();
    localStorageMock.clear();
  });

  it("Default (exclusive=false): toggle setzt nur Ziel-Track, andere bleiben unverändert", () => {
    const a = addAudioTrack(makeTrackInput({ name: "A" }));
    const b = addAudioTrack(makeTrackInput({ name: "B" }));
    const c = addAudioTrack(makeTrackInput({ name: "C", soloed: true }));

    setAudioTrackSoloed(a, true);

    expect(getAudioTrack(a)?.soloed).toBe(true);
    // B unverändert (war false, bleibt false)
    expect(getAudioTrack(b)?.soloed).toBe(false);
    // C unverändert (war true, bleibt true — ADDITIV)
    expect(getAudioTrack(c)?.soloed).toBe(true);
  });

  it("exclusive=true: setzt Ziel-Track UND un-solo't alle anderen Tracks", () => {
    const a = addAudioTrack(makeTrackInput({ name: "A", soloed: true }));
    const b = addAudioTrack(makeTrackInput({ name: "B", soloed: true }));
    const c = addAudioTrack(makeTrackInput({ name: "C", soloed: false }));

    setAudioTrackSoloed(c, true, true);

    expect(getAudioTrack(c)?.soloed).toBe(true);
    // A + B wurden un-soloed
    expect(getAudioTrack(a)?.soloed).toBe(false);
    expect(getAudioTrack(b)?.soloed).toBe(false);
  });

  it("setAudioTrackSoloed(false, exclusive=true) un-solo't ALLE Tracks (auch Ziel)", () => {
    const a = addAudioTrack(makeTrackInput({ name: "A", soloed: true }));
    const b = addAudioTrack(makeTrackInput({ name: "B", soloed: true }));

    setAudioTrackSoloed(a, false, true);

    expect(getAudioTrack(a)?.soloed).toBe(false);
    expect(getAudioTrack(b)?.soloed).toBe(false);
  });

  it("Unbekannte ID ist no-op (kein Throw, keine Änderung)", () => {
    const a = addAudioTrack(makeTrackInput({ name: "A", soloed: false }));
    expect(() => setAudioTrackSoloed("audiotrack:unknown", true)).not.toThrow();
    expect(getAudioTrack(a)?.soloed).toBe(false);
  });

  it("Persistiert via localStorage (round-trip)", () => {
    const a = addAudioTrack(makeTrackInput({ name: "A" }));
    setAudioTrackSoloed(a, true);
    const raw = localStorageMock.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as AudioTrackChannelData[];
    const aData = parsed.find((t) => t.id === a);
    expect(aData?.soloed).toBe(true);
  });
});
