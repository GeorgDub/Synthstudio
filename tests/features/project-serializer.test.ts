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
  type SynthProject,
} from "@/utils/projectSerializer";

// ─── Test-Fixture ────────────────────────────────────────────────────────────

function baseProject(overrides: Partial<SynthProject> = {}): SynthProject {
  return {
    version: SYNTH_FILE_VERSION,
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
  it("SYNTH_FILE_VERSION ist '1.16' (aktuelle Format-Version)", () => {
    expect(SYNTH_FILE_VERSION).toBe("1.16");
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
