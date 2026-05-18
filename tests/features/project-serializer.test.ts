/**
 * tests/features/project-serializer.test.ts (TASK-CVG-PROJSER / v2.63)
 *
 * Pure-Coverage für client/src/utils/projectSerializer.ts.
 *
 * .synth Project-File Format v1.16. Diese Suite verifiziert die Schema-
 * Migrations-Defensive an der Persistenz-Boundary (v1.14 → v1.15 audioTracks-
 * Default, v1.15 → v1.16 scripts-Default) und die Sicherheits-Regel
 * "Scripts beim Load disabled".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  SYNTH_FILE_VERSION,
  SYNTH_LATEST_KEY,
  serializeProject,
  toJson,
  parseProject,
  float32ToFrames,
  framesToFloat32,
  type SynthProject,
} from "@/utils/projectSerializer";

// ─── Test-Fixture ────────────────────────────────────────────────────────────

function baseProject(overrides: Partial<SynthProject> = {}): SynthProject {
  return {
    version: SYNTH_FILE_VERSION,
    // v3.58.0 (v1.24): projectId ist required im Schema. Test-Fixture
    // verwendet einen statischen UUID-v4-String für Determinismus.
    projectId: "11111111-2222-4333-8444-555555555555",
    projectName: "Test Project",
    savedAt: new Date().toISOString(),
    bpm: 120,
    samples: [],
    patterns: [],
    activePatternId: "pat-1",
    song: { slots: [], songModeActive: false, loopSong: false },
    mixer: {
      masterVolume: 1,
      channels: [],
      returnTracks: [],
      insertChains: {},
      eq16: {},
      sidechains: {},
      transientShapers: {},
    } as SynthProject["mixer"],
    humanizer: { global: {} as SynthProject["humanizer"]["global"] },
    automation: { lanes: [], stepCount: 16 },
    audioTracks: [],
    scripts: [],
    ...overrides,
  };
}

describe("ProjectSerializer – Konstanten", () => {
  it("SYNTH_FILE_VERSION ist '1.24' (seit v3.58: stable projectId UUID)", () => {
    expect(SYNTH_FILE_VERSION).toBe("1.24");
  });

  it("SYNTH_LATEST_KEY ist 'synthstudio:last-project' (localStorage-Key)", () => {
    expect(SYNTH_LATEST_KEY).toBe("synthstudio:last-project");
  });
});

describe("ProjectSerializer – serializeProject", () => {
  it("setzt version auf SYNTH_FILE_VERSION", () => {
    const result = serializeProject({
      projectName: "P",
      bpm: 120,
      samples: [],
      patterns: [],
      activePatternId: "x",
      song: { slots: [], songModeActive: false, loopSong: false },
      mixer: baseProject().mixer,
      humanizer: baseProject().humanizer,
      automation: baseProject().automation,
    });
    expect(result.version).toBe(SYNTH_FILE_VERSION);
  });

  it("setzt savedAt als gültigen ISO-Timestamp", () => {
    const result = serializeProject({
      projectName: "P", bpm: 120, samples: [], patterns: [], activePatternId: "x",
      song: { slots: [], songModeActive: false, loopSong: false },
      mixer: baseProject().mixer,
      humanizer: baseProject().humanizer,
      automation: baseProject().automation,
    });
    expect(result.savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    // ISO-String parsiert ohne Fehler
    expect(new Date(result.savedAt).toString()).not.toBe("Invalid Date");
  });

  it("Übergebene Felder werden durchgereicht (projectName, bpm)", () => {
    const result = serializeProject({
      projectName: "Hardstyle Set 1",
      bpm: 170,
      samples: [], patterns: [], activePatternId: "x",
      song: { slots: [], songModeActive: false, loopSong: false },
      mixer: baseProject().mixer,
      humanizer: baseProject().humanizer,
      automation: baseProject().automation,
    });
    expect(result.projectName).toBe("Hardstyle Set 1");
    expect(result.bpm).toBe(170);
  });
});

describe("ProjectSerializer – toJson + parseProject Round-Trip", () => {
  it("parseProject(toJson(p)) liefert den gleichen projectName + bpm", () => {
    const p = baseProject({ projectName: "RT", bpm: 140 });
    const parsed = parseProject(toJson(p));
    expect(parsed.projectName).toBe("RT");
    expect(parsed.bpm).toBe(140);
  });

  it("toJson ist pretty-printed (indent=2)", () => {
    const json = toJson(baseProject());
    expect(json).toMatch(/^\{\n  "/); // beginnt mit indent
  });
});

describe("ProjectSerializer – parseProject Defensive (Invalid Inputs)", () => {
  it("Fehlende version wirft", () => {
    expect(() => parseProject(JSON.stringify({ patterns: [] }))).toThrow(/Ungültiges/);
  });

  it("Fehlende patterns wirft", () => {
    expect(() => parseProject(JSON.stringify({ version: "1.16" }))).toThrow(/Ungültiges/);
  });

  it("Invalid JSON wirft (von JSON.parse)", () => {
    expect(() => parseProject("not-json{")).toThrow();
  });
});

describe("ProjectSerializer – audioTracks Migration (v1.14 → v1.15+)", () => {
  it("Fehlendes audioTracks-Feld → defaultet auf []", () => {
    const oldFile = JSON.stringify({
      version: "1.14",
      patterns: [],
    });
    const parsed = parseProject(oldFile);
    expect(parsed.audioTracks).toEqual([]);
  });

  it("audioTracks=null → defaultet auf []", () => {
    const file = JSON.stringify({
      version: "1.15", patterns: [],
      audioTracks: null,
    });
    expect(parseProject(file).audioTracks).toEqual([]);
  });

  it("audioTracks ist kein Array (z.B. String) → defaultet auf [] + warnt", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const file = JSON.stringify({
        version: "1.15", patterns: [],
        audioTracks: "not-an-array",
      });
      const result = parseProject(file);
      expect(result.audioTracks).toEqual([]);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("audioTracks mit invalidem Eintrag → wird gefiltert", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const validTrack = {
        id: "t1",
        name: "Vocals",
        filePath: "/abs/path/vocals.wav",
        fileName: "vocals.wav",
        volume: 1, pan: 0,
        muted: false, soloed: false,
        sends: { reverb: 0, delay: 0 },
      };
      const file = JSON.stringify({
        version: "1.16", patterns: [],
        audioTracks: [validTrack, { broken: true }, null],
      });
      const result = parseProject(file);
      expect(result.audioTracks).toHaveLength(1);
      expect(result.audioTracks![0].id).toBe("t1");
    } finally {
      warn.mockRestore();
    }
  });

  it("audioTracks mit ungültigem syncMode → gefiltert", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const invalidTrack = {
        id: "t1", name: "X", filePath: "/x.wav", fileName: "x.wav",
        volume: 1, pan: 0, muted: false, soloed: false,
        sends: { reverb: 0, delay: 0 },
        syncMode: "not-a-real-mode",
      };
      const file = JSON.stringify({
        version: "1.16", patterns: [], audioTracks: [invalidTrack],
      });
      expect(parseProject(file).audioTracks).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("ProjectSerializer – scripts Migration (v1.15 → v1.16) + Disable-on-Load", () => {
  it("Fehlendes scripts-Feld (v1.15-File) → defaultet auf []", () => {
    const file = JSON.stringify({
      version: "1.15", patterns: [],
    });
    expect(parseProject(file).scripts).toEqual([]);
  });

  it("scripts=null → defaultet auf []", () => {
    const file = JSON.stringify({
      version: "1.16", patterns: [], scripts: null,
    });
    expect(parseProject(file).scripts).toEqual([]);
  });

  it("scripts kein Array → defaultet auf [] + warnt", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const file = JSON.stringify({
        version: "1.16", patterns: [], scripts: "broken",
      });
      const result = parseProject(file);
      expect(result.scripts).toEqual([]);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("Valides Script wird übernommen, ABER enabled wird ZWINGEND auf false gesetzt", () => {
    // Konstruieren wir ein minimal-valides Script (Schema aus useScriptStore)
    const validScript = {
      id: "s1",
      name: "My Script",
      code: "// safe code",
      enabled: true, // <- soll beim Load auf false gehen
      maxRuntimeMs: 1000,
      scope: "project",
      createdAt: 1_000_000,
      updatedAt: 1_000_000,
    };
    const file = JSON.stringify({
      version: "1.16", patterns: [], scripts: [validScript],
    });
    const result = parseProject(file);
    expect(result.scripts).toHaveLength(1);
    expect(result.scripts![0].enabled).toBe(false);
    expect(result.scripts![0].name).toBe("My Script");
  });

  it("Invalides Script wird silent + warn gefiltert", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const file = JSON.stringify({
        version: "1.16", patterns: [],
        scripts: [{ broken: true }, null, 42],
      });
      expect(parseProject(file).scripts).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  it("Sicherheits-Invariant: ALLE Scripts werden disabled (auch wenn explizit enabled=false)", () => {
    const validScript = {
      id: "s1", name: "S", code: "//", enabled: false, maxRuntimeMs: 1000, scope: "project",
      createdAt: 1, updatedAt: 1,
    };
    const file = JSON.stringify({
      version: "1.16", patterns: [], scripts: [validScript],
    });
    expect(parseProject(file).scripts![0].enabled).toBe(false);
  });
});

describe("ProjectSerializer – Mixed v1.14 (oldest) File", () => {
  it("v1.14 ohne audioTracks UND ohne scripts → beide Felder defaulten auf []", () => {
    const oldFile = JSON.stringify({
      version: "1.14",
      patterns: [{ id: "p1" }],
    });
    const parsed = parseProject(oldFile);
    expect(parsed.audioTracks).toEqual([]);
    expect(parsed.scripts).toEqual([]);
    expect(parsed.version).toBe("1.14"); // Version-String wird NICHT auto-upgraded
  });
});

// ─── padBank Migration (seit v1.17) ──────────────────────────────────────────

describe("ProjectSerializer – padBank Migration (v1.16 → v1.17)", () => {
  it("SYNTH_FILE_VERSION ist '1.24'", () => {
    expect(SYNTH_FILE_VERSION).toBe("1.24");
  });

  it("Fehlendes padBank-Feld (v1.16-File) → padBank bleibt undefined (Signal: localStorage nicht überschreiben)", () => {
    const file = JSON.stringify({
      version: "1.16", patterns: [],
    });
    expect(parseProject(file).padBank).toBeUndefined();
  });

  it("padBank=null → undefined (kein Vertrauen in Schema)", () => {
    const file = JSON.stringify({
      version: "1.17", patterns: [], padBank: null,
    });
    expect(parseProject(file).padBank).toBeUndefined();
  });

  it("padBank kein Array (String) → undefined", () => {
    const file = JSON.stringify({
      version: "1.17", patterns: [], padBank: "broken",
    });
    expect(parseProject(file).padBank).toBeUndefined();
  });

  it("padBank leeres Array bleibt leer (User-Reset wird respektiert)", () => {
    const file = JSON.stringify({
      version: "1.17", patterns: [], padBank: [],
    });
    expect(parseProject(file).padBank).toEqual([]);
  });

  it("padBank valides Array wird übernommen", () => {
    const slots = [
      { kind: "perf-pad", param: "0" },
      { kind: "macro", param: "3" },
      { kind: "script", param: "scr-1" },
      { kind: "action", param: "playStop" },
    ];
    const file = JSON.stringify({
      version: "1.17", patterns: [], padBank: slots,
    });
    expect(parseProject(file).padBank).toEqual(slots);
  });

  it("padBank mit invaliden Items → werden silent gefiltert", () => {
    const slots = [
      { kind: "perf-pad", param: "0" },       // valid
      { kind: "unknown", param: "x" },         // invalid kind
      null,                                     // not object
      { kind: "macro", param: 5 },              // non-string param
      { kind: "action", param: "tapTempo" },  // valid
    ];
    const file = JSON.stringify({
      version: "1.17", patterns: [], padBank: slots,
    });
    const result = parseProject(file).padBank;
    expect(result).toHaveLength(2);
    expect(result![0]).toEqual({ kind: "perf-pad", param: "0" });
    expect(result![1]).toEqual({ kind: "action", param: "tapTempo" });
  });
});

// ─── v1.18 Extended Persistence ──────────────────────────────────────────────

describe("ProjectSerializer – v1.18 extended persistence (liveInputs/midiNoteOut/slicePads)", () => {
  describe("liveInputs Migration (v1.17 → v1.18)", () => {
    it("Pre-v1.18-File ohne liveInputs-Feld → undefined (Signal: User-localStorage in Ruhe lassen)", () => {
      const file = JSON.stringify({ version: "1.17", patterns: [] });
      expect(parseProject(file).liveInputs).toBeUndefined();
    });

    it("liveInputs=null → undefined", () => {
      const file = JSON.stringify({ version: "1.18", patterns: [], liveInputs: null });
      expect(parseProject(file).liveInputs).toBeUndefined();
    });

    it("liveInputs=non-array → undefined", () => {
      const file = JSON.stringify({ version: "1.18", patterns: [], liveInputs: "broken" });
      expect(parseProject(file).liveInputs).toBeUndefined();
    });

    it("liveInputs leeres Array bleibt leer (User-Reset wird respektiert)", () => {
      const file = JSON.stringify({ version: "1.18", patterns: [], liveInputs: [] });
      expect(parseProject(file).liveInputs).toEqual([]);
    });

    it("Round-Trip valider LiveInputChannel mit allen Feldern", () => {
      const ch = {
        id: "liveinput:abc123",
        name: "KORG In",
        deviceId: "dev-uuid-456",
        deviceLabel: "USB Audio Codec",
        volume: 0.6,
        pan: -0.2,
        muted: false,
        soloed: true,
        sends: { reverb: 0.3, delay: 0.1 },
        latencyCompensationMs: 12,
        recordArmed: true,
      };
      const file = JSON.stringify({ version: "1.18", patterns: [], liveInputs: [ch] });
      const parsed = parseProject(file).liveInputs;
      expect(parsed).toHaveLength(1);
      expect(parsed![0].id).toBe("liveinput:abc123");
      expect(parsed![0].deviceId).toBe("dev-uuid-456");
      expect(parsed![0].sends).toEqual({ reverb: 0.3, delay: 0.1 });
      expect(parsed![0].recordArmed).toBe(true);
    });

    it("Invalid liveInput-Eintrag wird silent gefiltert", () => {
      const validCh = {
        id: "liveinput:ok",
        name: "X",
        deviceId: null,
        volume: 0.5, pan: 0, muted: false, soloed: false,
        sends: { reverb: 0, delay: 0 },
        latencyCompensationMs: 0,
      };
      const file = JSON.stringify({
        version: "1.18", patterns: [],
        liveInputs: [validCh, { broken: true }, null, { id: "no-prefix" }],
      });
      expect(parseProject(file).liveInputs).toHaveLength(1);
      expect(parseProject(file).liveInputs![0].id).toBe("liveinput:ok");
    });
  });

  describe("midiNoteOut Migration (v1.17 → v1.18)", () => {
    it("Pre-v1.18-File ohne midiNoteOut-Feld → undefined", () => {
      const file = JSON.stringify({ version: "1.17", patterns: [] });
      expect(parseProject(file).midiNoteOut).toBeUndefined();
    });

    it("midiNoteOut=null → undefined", () => {
      const file = JSON.stringify({ version: "1.18", patterns: [], midiNoteOut: null });
      expect(parseProject(file).midiNoteOut).toBeUndefined();
    });

    it("midiNoteOut=Array (falscher Typ) → undefined", () => {
      const file = JSON.stringify({ version: "1.18", patterns: [], midiNoteOut: [] });
      expect(parseProject(file).midiNoteOut).toBeUndefined();
    });

    it("Round-Trip midiNoteOut mit enabled + Configs", () => {
      const mno = {
        enabled: true,
        configs: {
          "part-0": { outputId: "out-electribe", channel: 9, note: 36, noteDurationMs: 120, localSoundEnabled: false },
          "part-1": { outputId: "out-electribe", channel: 9, note: 38 },
        },
      };
      const file = JSON.stringify({ version: "1.18", patterns: [], midiNoteOut: mno });
      const parsed = parseProject(file).midiNoteOut;
      expect(parsed?.enabled).toBe(true);
      expect(parsed?.configs["part-0"].outputId).toBe("out-electribe");
      expect(parsed?.configs["part-0"].channel).toBe(9);
      expect(parsed?.configs["part-0"].note).toBe(36);
      expect(parsed?.configs["part-0"].noteDurationMs).toBe(120);
      expect(parsed?.configs["part-0"].localSoundEnabled).toBe(false);
      // Defaults bei fehlenden optionalen Feldern
      expect(parsed?.configs["part-1"].noteDurationMs).toBeGreaterThan(0);
      expect(parsed?.configs["part-1"].localSoundEnabled).toBe(true);
    });

    it("Configs mit invaliden Einträgen werden silent gefiltert", () => {
      const mno = {
        enabled: false,
        configs: {
          "ok": { outputId: "x", channel: 0, note: 60 },
          "no-output": { outputId: "", channel: 0, note: 60 },
          "broken-channel": { outputId: "x", channel: "abc", note: 60 },
        },
      };
      const file = JSON.stringify({ version: "1.18", patterns: [], midiNoteOut: mno });
      const parsed = parseProject(file).midiNoteOut;
      expect(Object.keys(parsed!.configs)).toEqual(["ok"]);
    });

    it("enabled wird auf boolean reduziert (truthy non-bool → false)", () => {
      const file = JSON.stringify({
        version: "1.18", patterns: [],
        midiNoteOut: { enabled: "yes", configs: {} },
      });
      expect(parseProject(file).midiNoteOut?.enabled).toBe(false);
    });

    it("midiNoteOut.channel/note werden geclamped (out-of-range → in-range)", () => {
      const mno = {
        enabled: true,
        configs: {
          "p": { outputId: "x", channel: 99, note: 9999 },
        },
      };
      const file = JSON.stringify({ version: "1.18", patterns: [], midiNoteOut: mno });
      const cfg = parseProject(file).midiNoteOut?.configs["p"];
      expect(cfg?.channel).toBeLessThanOrEqual(15);
      expect(cfg?.note).toBeLessThanOrEqual(127);
    });
  });

  describe("slicePads Migration (v1.17 → v1.18)", () => {
    it("Pre-v1.18-File ohne slicePads-Feld → undefined", () => {
      const file = JSON.stringify({ version: "1.17", patterns: [] });
      expect(parseProject(file).slicePads).toBeUndefined();
    });

    it("slicePads=null → undefined", () => {
      const file = JSON.stringify({ version: "1.18", patterns: [], slicePads: null });
      expect(parseProject(file).slicePads).toBeUndefined();
    });

    it("slicePads=Object (kein Array) → undefined", () => {
      const file = JSON.stringify({ version: "1.18", patterns: [], slicePads: { foo: 1 } });
      expect(parseProject(file).slicePads).toBeUndefined();
    });

    it("slicePads leeres Array bleibt leer", () => {
      const file = JSON.stringify({ version: "1.18", patterns: [], slicePads: [] });
      expect(parseProject(file).slicePads).toEqual([]);
    });

    it("Round-Trip slicePad mit eingebettetem Float32-Buffer", () => {
      const slot = {
        index: 0,
        sampleRate: 48000,
        sampleName: "kick.wav",
        sliceIndex: 0,
        frames: [0.1, -0.2, 0.3, -0.4],
      };
      const file = JSON.stringify({
        version: "1.18", patterns: [],
        slicePads: [slot, null, slot, null],
      });
      const parsed = parseProject(file).slicePads;
      expect(parsed).toHaveLength(4);
      expect(parsed![0]).not.toBeNull();
      expect(parsed![0]!.frames).toEqual([0.1, -0.2, 0.3, -0.4]);
      expect(parsed![0]!.sampleRate).toBe(48000);
      expect(parsed![1]).toBeNull();
    });

    it("Metadata-only-Slot (frames=null) bleibt null beim Parse", () => {
      const slot = {
        index: 5,
        sampleRate: 44100,
        sampleName: "snare.wav",
        sliceIndex: 2,
        frames: null,
      };
      const file = JSON.stringify({ version: "1.18", patterns: [], slicePads: [slot] });
      const parsed = parseProject(file).slicePads;
      expect(parsed![0]!.frames).toBeNull();
      expect(parsed![0]!.sampleName).toBe("snare.wav");
    });

    it("Invalide slot-Einträge werden zu null (Index-Stabilität)", () => {
      const validSlot = {
        index: 0, sampleRate: 48000, sampleName: "x", sliceIndex: 0, frames: [0.1],
      };
      const file = JSON.stringify({
        version: "1.18", patterns: [],
        slicePads: [validSlot, { broken: true }, "string", validSlot],
      });
      const parsed = parseProject(file).slicePads;
      expect(parsed).toHaveLength(4);
      expect(parsed![0]).not.toBeNull();
      expect(parsed![1]).toBeNull();
      expect(parsed![2]).toBeNull();
      expect(parsed![3]).not.toBeNull();
    });
  });

  describe("Float32 ↔ Frames Codec", () => {
    it("float32ToFrames(null) → null", () => {
      expect(float32ToFrames(null)).toBeNull();
    });

    it("framesToFloat32(null) → null", () => {
      expect(framesToFloat32(null)).toBeNull();
    });

    it("Round-Trip: identical values (Float32 precision-safe)", () => {
      const original = new Float32Array([0.5, -0.5, 0.25, 0]);
      const frames = float32ToFrames(original);
      const restored = framesToFloat32(frames);
      expect(restored).toBeInstanceOf(Float32Array);
      expect(restored!.length).toBe(4);
      expect(restored![0]).toBeCloseTo(0.5);
      expect(restored![1]).toBeCloseTo(-0.5);
      expect(restored![3]).toBe(0);
    });
  });

  describe("serializeProject mit includeSliceBuffers-Option", () => {
    it("Default: includeSliceBuffers=true behält frames", () => {
      const result = serializeProject({
        projectName: "P", bpm: 120, samples: [], patterns: [], activePatternId: "x",
        song: { slots: [], songModeActive: false, loopSong: false },
        mixer: baseProject().mixer,
        humanizer: baseProject().humanizer,
        automation: baseProject().automation,
        slicePads: [
          { index: 0, sampleRate: 48000, sampleName: "k.wav", sliceIndex: 0, frames: [0.1, 0.2] },
        ],
      });
      expect(result.slicePads![0]!.frames).toEqual([0.1, 0.2]);
    });

    it("includeSliceBuffers=false strippt nur frames, behält Metadata", () => {
      const result = serializeProject(
        {
          projectName: "P", bpm: 120, samples: [], patterns: [], activePatternId: "x",
          song: { slots: [], songModeActive: false, loopSong: false },
          mixer: baseProject().mixer,
          humanizer: baseProject().humanizer,
          automation: baseProject().automation,
          slicePads: [
            { index: 0, sampleRate: 48000, sampleName: "k.wav", sliceIndex: 0, frames: [0.1, 0.2] },
            null,
            { index: 2, sampleRate: 48000, sampleName: "s.wav", sliceIndex: 1, frames: [0.3] },
          ],
        },
        { includeSliceBuffers: false },
      );
      expect(result.slicePads![0]!.frames).toBeNull();
      expect(result.slicePads![0]!.sampleName).toBe("k.wav");
      expect(result.slicePads![1]).toBeNull();
      expect(result.slicePads![2]!.frames).toBeNull();
      expect(result.slicePads![2]!.sampleName).toBe("s.wav");
    });
  });

  describe("Back-Compat Combined", () => {
    it("Pre-v1.18-File (v1.14) hat liveInputs/midiNoteOut/slicePads alle undefined und wirft NICHT", () => {
      const oldFile = JSON.stringify({
        version: "1.14",
        patterns: [{ id: "p1" }],
      });
      const parsed = parseProject(oldFile);
      expect(parsed.liveInputs).toBeUndefined();
      expect(parsed.midiNoteOut).toBeUndefined();
      expect(parsed.slicePads).toBeUndefined();
      // Andere migrations greifen weiter (audioTracks/scripts default auf [])
      expect(parsed.audioTracks).toEqual([]);
      expect(parsed.scripts).toEqual([]);
    });

    it("v1.18-File mit leeren neuen Feldern lädt fehlerfrei", () => {
      const file = JSON.stringify({
        version: "1.18", patterns: [],
        liveInputs: [],
        midiNoteOut: { enabled: false, configs: {} },
        slicePads: [],
      });
      const parsed = parseProject(file);
      expect(parsed.liveInputs).toEqual([]);
      expect(parsed.midiNoteOut).toEqual({ enabled: false, configs: {} });
      expect(parsed.slicePads).toEqual([]);
    });
  });
});

// ─── v1.23 Sample-Tags Persist (seit v3.55.0) ────────────────────────────────

describe("ProjectSerializer – samples[].tags Migration (v1.22 → v1.23)", () => {
  it("Pre-v1.23-File ohne tags-Property an Samples → tags bleibt undefined", () => {
    const file = JSON.stringify({
      version: "1.22", patterns: [],
      samples: [
        { id: "s1", name: "kick.wav", path: "/k.wav", category: "drum" },
        { id: "s2", name: "snare.wav", path: "/sn.wav", category: "drum" },
      ],
    });
    const parsed = parseProject(file);
    expect(parsed.samples).toHaveLength(2);
    expect(parsed.samples[0].tags).toBeUndefined();
    expect(parsed.samples[1].tags).toBeUndefined();
  });

  it("v1.23-File mit tags=string[] → round-trip erhalten", () => {
    const file = JSON.stringify({
      version: "1.23", patterns: [],
      samples: [
        { id: "s1", name: "kick.wav", path: "/k.wav", category: "drum", tags: ["kick", "808"] },
      ],
    });
    const parsed = parseProject(file);
    expect(parsed.samples[0].tags).toEqual(["kick", "808"]);
  });

  it("v1.23-File mit tags=non-string-Entries → werden silent gefiltert", () => {
    const file = JSON.stringify({
      version: "1.23", patterns: [],
      samples: [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: "s1", name: "x", path: "/x.wav", category: "drum", tags: ["kick", 42, null, "snare", undefined] } as any,
      ],
    });
    const parsed = parseProject(file);
    expect(parsed.samples[0].tags).toEqual(["kick", "snare"]);
  });

  it("v1.23-File mit tags=null → tags-Property wird entfernt (defensive)", () => {
    const file = JSON.stringify({
      version: "1.23", patterns: [],
      samples: [
        { id: "s1", name: "x", path: "/x.wav", category: "drum", tags: null },
      ],
    });
    const parsed = parseProject(file);
    expect(parsed.samples[0].tags).toBeUndefined();
  });

  it("v1.23-File mit tags=non-array (z.B. String) → tags-Property wird entfernt", () => {
    const file = JSON.stringify({
      version: "1.23", patterns: [],
      samples: [
        { id: "s1", name: "x", path: "/x.wav", category: "drum", tags: "not-an-array" },
      ],
    });
    const parsed = parseProject(file);
    expect(parsed.samples[0].tags).toBeUndefined();
  });

  it("v1.23 tags werden normalisiert (trim + lowercase + dedup)", () => {
    const file = JSON.stringify({
      version: "1.23", patterns: [],
      samples: [
        { id: "s1", name: "x", path: "/x.wav", category: "drum", tags: ["  KICK ", "kick", "Snare", "snare"] },
      ],
    });
    const parsed = parseProject(file);
    expect(parsed.samples[0].tags).toEqual(["kick", "snare"]);
  });

  it("Full round-trip: serialize → parse mit tags-Feldern", () => {
    const p = {
      projectName: "Tag-Test", bpm: 128,
      samples: [
        { id: "s1", name: "k.wav", path: "/k.wav", category: "drum", tags: ["kick", "808"] },
        { id: "s2", name: "v.wav", path: "/v.wav", category: "vocal", tags: ["vox", "wet"] },
      ],
      patterns: [], activePatternId: "x",
      song: { slots: [], songModeActive: false, loopSong: false },
      mixer: { masterVolume: 1, channels: [], returnTracks: [], insertChains: {}, eq16: {}, sidechains: {}, transientShapers: {} },
      humanizer: { global: {} },
      automation: { lanes: [], stepCount: 16 as 16 | 32 | 64 },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ser = serializeProject(p as any);
    const json = toJson(ser);
    const parsed = parseProject(json);
    expect(parsed.version).toBe("1.24");
    expect(parsed.samples).toHaveLength(2);
    expect(parsed.samples[0].tags).toEqual(["kick", "808"]);
    expect(parsed.samples[1].tags).toEqual(["vox", "wet"]);
  });
});
