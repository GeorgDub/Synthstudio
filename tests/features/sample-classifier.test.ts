/**
 * tests/features/sample-classifier.test.ts (v3.106.0)
 *
 * Tests für:
 *  - classifyByFilename (heuristische Kategorisierung)
 *  - extractTags (Tag-Extraction aus folder + filename)
 *  - extractBpm (BPM-Hint aus filename)
 *  - useSamplePackStore (addPack, filterSamples, getAllTags)
 *  - importLogic.scanFolderForSamples
 */
import { describe, it, expect, beforeEach } from "vitest";

// ─── localStorage Mock ────────────────────────────────────────────────────────

function createLocalStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string): string | null => store[k] ?? null,
    setItem: (k: string, v: string): void => { store[k] = v; },
    removeItem: (k: string): void => { delete store[k]; },
    clear: (): void => { store = {}; },
  };
}

const localStorageMock = createLocalStorageMock();
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

import {
  classifyByFilename,
  extractTags,
  extractBpm,
  isAudioFilename,
} from "../../client/src/utils/sampleClassifier";

import { scanFolderForSamples } from "../../client/src/components/SamplePackBrowser/importLogic";

import {
  addPack,
  filterSamples,
  getAllTags,
  getAllSamples,
  __resetSamplePackStoreForTests,
} from "../../client/src/store/useSamplePackStore";

// ─── classifyByFilename ──────────────────────────────────────────────────────

describe("classifyByFilename", () => {
  it("identifies kick variations", () => {
    expect(classifyByFilename("kick.wav")).toBe("kick");
    expect(classifyByFilename("BD_01.wav")).toBe("kick");
    expect(classifyByFilename("808_kick.wav")).toBe("kick");
    expect(classifyByFilename("Bass_Drum_punchy.wav")).toBe("kick");
    expect(classifyByFilename("KIK_dark.wav")).toBe("kick");
  });

  it("identifies snare variations", () => {
    expect(classifyByFilename("snare.wav")).toBe("snare");
    expect(classifyByFilename("SD_07.wav")).toBe("snare");
    expect(classifyByFilename("snr_tight.wav")).toBe("snare");
    expect(classifyByFilename("rimshot_01.wav")).toBe("snare");
  });

  it("distinguishes hihat-open vs hihat-closed", () => {
    expect(classifyByFilename("open_hat.wav")).toBe("hihat-open");
    expect(classifyByFilename("HH_open_01.wav")).toBe("hihat-open");
    expect(classifyByFilename("closed_hat.wav")).toBe("hihat-closed");
    expect(classifyByFilename("hihat.wav")).toBe("hihat-closed");
    expect(classifyByFilename("HH_01.wav")).toBe("hihat-closed");
  });

  it("identifies claps, cymbals, perc", () => {
    expect(classifyByFilename("clap_01.wav")).toBe("clap");
    expect(classifyByFilename("crash_long.wav")).toBe("cymbal");
    expect(classifyByFilename("conga_high.wav")).toBe("perc");
    expect(classifyByFilename("tambourine.wav")).toBe("perc");
  });

  it("identifies loops, bass, vocals, fx, synth", () => {
    expect(classifyByFilename("drum_loop_120.wav")).toBe("loop");
    expect(classifyByFilename("sub_bass_F.wav")).toBe("bass");
    expect(classifyByFilename("vocal_chop.wav")).toBe("vocal");
    expect(classifyByFilename("riser_long.wav")).toBe("fx");
    expect(classifyByFilename("lead_pluck.wav")).toBe("synth");
    expect(classifyByFilename("pad_warm.wav")).toBe("synth");
  });

  it("falls back to unknown when no rule matches", () => {
    expect(classifyByFilename("foobar.wav")).toBe("unknown");
    expect(classifyByFilename("xyz_42.wav")).toBe("unknown");
    expect(classifyByFilename("")).toBe("unknown");
  });

  it("handles full paths (extracts basename)", () => {
    expect(classifyByFilename("Drum_Pack/Kicks/BD_01.wav")).toBe("kick");
    expect(classifyByFilename("C:\\samples\\snare\\SD_dry.wav")).toBe("snare");
  });
});

// ─── extractTags ─────────────────────────────────────────────────────────────

describe("extractTags", () => {
  it("extracts tags from parent-folder", () => {
    const tags = extractTags("808_kick.wav", "Trap_Kicks");
    expect(tags).toContain("trap");
    expect(tags).toContain("kicks");
  });

  it("includes 808 as tag when present", () => {
    const tags = extractTags("808_Kick_01.wav", "Trap_Kicks");
    expect(tags).toContain("808");
    expect(tags).toContain("trap");
  });

  it("filters stopwords like wav/mp3/vol", () => {
    const tags = extractTags("snare_vol_01.wav", "");
    expect(tags).not.toContain("wav");
    expect(tags).not.toContain("vol");
  });

  it("dedupliziert overlap zwischen folder und filename", () => {
    const tags = extractTags("kick_punchy.wav", "kicks_punchy");
    const punchy = tags.filter((t) => t === "punchy");
    expect(punchy.length).toBe(1);
  });

  it("handles empty inputs gracefully", () => {
    expect(extractTags("", "")).toEqual([]);
    expect(extractTags("foo.wav", "")).toEqual(expect.any(Array));
  });
});

// ─── extractBpm ──────────────────────────────────────────────────────────────

describe("extractBpm", () => {
  it("parses '120bpm' style", () => {
    expect(extractBpm("loop_120bpm.wav")).toBe(120);
    expect(extractBpm("groove_140BPM.wav")).toBe(140);
  });

  it("parses '120 bpm' with separators", () => {
    expect(extractBpm("loop_120_bpm.wav")).toBe(120);
    expect(extractBpm("loop-128-bpm.wav")).toBe(128);
  });

  it("parses 'bpm120' reverse style", () => {
    expect(extractBpm("bpm120_drum_loop.wav")).toBe(120);
    expect(extractBpm("bpm_140_house.wav")).toBe(140);
  });

  it("returns null when no bpm hint found", () => {
    expect(extractBpm("no_bpm.wav")).toBeNull();
    expect(extractBpm("kick.wav")).toBeNull();
    expect(extractBpm("")).toBeNull();
  });

  it("returns null for out-of-range bpm", () => {
    expect(extractBpm("loop_999bpm.wav")).toBeNull();
    expect(extractBpm("loop_10bpm.wav")).toBeNull();
  });
});

// ─── isAudioFilename ─────────────────────────────────────────────────────────

describe("isAudioFilename", () => {
  it("accepts common audio extensions", () => {
    expect(isAudioFilename("kick.wav")).toBe(true);
    expect(isAudioFilename("snare.MP3")).toBe(true);
    expect(isAudioFilename("loop.flac")).toBe(true);
    expect(isAudioFilename("vox.aiff")).toBe(true);
    expect(isAudioFilename("clap.m4a")).toBe(true);
  });

  it("rejects non-audio files", () => {
    expect(isAudioFilename("README.md")).toBe(false);
    expect(isAudioFilename("kick.png")).toBe(false);
    expect(isAudioFilename("")).toBe(false);
  });
});

// ─── scanFolderForSamples ────────────────────────────────────────────────────

describe("scanFolderForSamples", () => {
  it("filters non-audio files", () => {
    const out = scanFolderForSamples([
      { relPath: "Pack/kick.wav" },
      { relPath: "Pack/README.md" },
      { relPath: "Pack/cover.jpg" },
    ]);
    expect(out.length).toBe(1);
    expect(out[0].filename).toBe("kick.wav");
  });

  it("classifies and tags samples in subfolders", () => {
    const out = scanFolderForSamples([
      { relPath: "Trap_Pack/Kicks/808_Kick_01.wav", sizeBytes: 12345 },
      { relPath: "Trap_Pack/Snares/SD_dry.wav", sizeBytes: 6789 },
    ]);
    expect(out.length).toBe(2);

    const kick = out.find((s) => s.filename === "808_Kick_01.wav")!;
    expect(kick.category).toBe("kick");
    expect(kick.parentFolder).toBe("Trap_Pack/Kicks");
    expect(kick.tags).toContain("trap");
    expect(kick.tags).toContain("808");
    expect(kick.sizeBytes).toBe(12345);
  });

  it("deduplicates by relPath", () => {
    const out = scanFolderForSamples([
      { relPath: "Pack/kick.wav" },
      { relPath: "Pack/kick.wav" },
    ]);
    expect(out.length).toBe(1);
  });

  it("handles invalid inputs silently", () => {
    expect(scanFolderForSamples([] as any)).toEqual([]);
    expect(scanFolderForSamples(null as any)).toEqual([]);
    expect(scanFolderForSamples([{ relPath: "" } as any])).toEqual([]);
  });
});

// ─── useSamplePackStore ──────────────────────────────────────────────────────

describe("useSamplePackStore", () => {
  beforeEach(() => {
    __resetSamplePackStoreForTests();
  });

  it("addPack adds a new pack and persists samples", () => {
    const scanned = scanFolderForSamples([
      { relPath: "Pack/kick.wav" },
      { relPath: "Pack/snare.wav" },
    ]);
    const id = addPack("My Pack", "/path", scanned);
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
    expect(getAllSamples().length).toBe(2);
  });

  it("filterSamples by category", () => {
    addPack("Pack", "/p", scanFolderForSamples([
      { relPath: "Pack/kick_01.wav" },
      { relPath: "Pack/snare_01.wav" },
      { relPath: "Pack/hihat.wav" },
    ]));
    const kicks = filterSamples({ category: "kick" });
    expect(kicks.length).toBe(1);
    expect(kicks[0].filename).toBe("kick_01.wav");
  });

  it("filterSamples by BPM range", () => {
    addPack("Pack", "/p", scanFolderForSamples([
      { relPath: "Pack/loop_100bpm.wav" },
      { relPath: "Pack/loop_120bpm.wav" },
      { relPath: "Pack/loop_140bpm.wav" },
      { relPath: "Pack/no_bpm.wav" },
    ]));
    const mid = filterSamples({ bpmMin: 110, bpmMax: 130 });
    expect(mid.length).toBe(1);
    expect(mid[0].bpm).toBe(120);
  });

  it("filterSamples by tag intersection (AND)", () => {
    addPack("Pack", "/p", scanFolderForSamples([
      { relPath: "Trap_Pack/Kicks/808_kick.wav" },
      { relPath: "House_Pack/Kicks/kick_punchy.wav" },
    ]));
    const trapOnly = filterSamples({ tags: ["trap"] });
    expect(trapOnly.length).toBe(1);
    expect(trapOnly[0].filename).toBe("808_kick.wav");

    const both = filterSamples({ tags: ["trap", "808"] });
    expect(both.length).toBe(1);

    const impossible = filterSamples({ tags: ["trap", "house"] });
    expect(impossible.length).toBe(0);
  });

  it("filterSamples by query (filename + tag substring)", () => {
    addPack("Pack", "/p", scanFolderForSamples([
      { relPath: "Pack/kick_warm.wav" },
      { relPath: "Pack/snare_bright.wav" },
    ]));
    const warm = filterSamples({ query: "warm" });
    expect(warm.length).toBe(1);
    expect(warm[0].filename).toBe("kick_warm.wav");
  });

  it("getAllTags returns unique sorted tags", () => {
    addPack("P1", "/p1", scanFolderForSamples([
      { relPath: "Trap/kick.wav" },
      { relPath: "Trap/snare.wav" },
    ]));
    addPack("P2", "/p2", scanFolderForSamples([
      { relPath: "House/kick_punchy.wav" },
    ]));
    const tags = getAllTags();
    expect(tags).toEqual([...tags].sort());
    expect(new Set(tags).size).toBe(tags.length); // unique
    expect(tags).toContain("trap");
    expect(tags).toContain("house");
  });

  it("persists state across reset", () => {
    addPack("Persist Pack", "/persist", scanFolderForSamples([
      { relPath: "Persist/kick.wav" },
    ]));
    const before = getAllSamples().length;
    expect(before).toBe(1);
    // localStorage should have the entry
    const raw = localStorage.getItem("ss-sample-packs:v1");
    expect(raw).toBeTruthy();
    if (raw) {
      const parsed = JSON.parse(raw);
      expect(parsed.packs.length).toBe(1);
    }
  });
});
