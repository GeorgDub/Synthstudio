/**
 * tests/features/drag-drop.test.ts
 *
 * v3.1.0 — Tests fuer den globalen Drag-Drop-Dispatch (detectFileType +
 * dispatchFileDrop).
 *
 * Strategie:
 *   - Pure-Helpers werden Node-only ohne JSDOM gepruefte.
 *   - CustomEvent + window.dispatchEvent werden in jsdom oder per shim
 *     simuliert. Wir koennen den Vitest-Default-Env (node) verwenden weil
 *     wir window + CustomEvent selbst stub'en.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Window + CustomEvent Shim ────────────────────────────────────────────────
//
// Node hat kein DOM. Wir stub'en das Minimum was dispatchFileDrop braucht.

interface FakeEvent {
  type: string;
  detail: unknown;
}

interface FakeWindow {
  dispatchEvent: (e: FakeEvent) => boolean;
  addEventListener: (type: string, listener: (e: FakeEvent) => void) => void;
  removeEventListener: (type: string, listener: (e: FakeEvent) => void) => void;
  __dispatched: FakeEvent[];
  __listeners: Map<string, Set<(e: FakeEvent) => void>>;
}

function makeWindow(): FakeWindow {
  const w: FakeWindow = {
    __dispatched: [],
    __listeners: new Map(),
    dispatchEvent(e: FakeEvent): boolean {
      this.__dispatched.push(e);
      const ls = this.__listeners.get(e.type);
      if (ls) for (const l of ls) l(e);
      return true;
    },
    addEventListener(type, listener) {
      let set = this.__listeners.get(type);
      if (!set) { set = new Set(); this.__listeners.set(type, set); }
      set.add(listener);
    },
    removeEventListener(type, listener) {
      this.__listeners.get(type)?.delete(listener);
    },
  };
  return w;
}

// CustomEvent-Polyfill (Node hat keine).
class FakeCustomEvent<T = unknown> implements FakeEvent {
  type: string;
  detail: T;
  constructor(type: string, init?: { detail?: T }) {
    this.type = type;
    this.detail = (init?.detail as T);
  }
}

let fakeWindow: FakeWindow;

beforeEach(() => {
  fakeWindow = makeWindow();
  // @ts-expect-error - test global injection
  globalThis.window = fakeWindow;
  // @ts-expect-error - test global injection
  globalThis.CustomEvent = FakeCustomEvent;
});

import {
  detectFileType,
  detectFileTypeFromFiles,
  dispatchFileDrop,
  dispatchAllFiles,
  getFileExtension,
  AUDIO_EXTENSIONS,
  PROJECT_EXTENSIONS,
  ZIP_EXTENSIONS,
  MIDI_EXTENSIONS,
  ELECTRIBE_EXTENSIONS,
} from "../../client/src/utils/dragDropDispatch";

// ─── getFileExtension ─────────────────────────────────────────────────────────

describe("getFileExtension", () => {
  it("liefert die kleingeschriebene Endung inkl. Punkt", () => {
    expect(getFileExtension("Kick 01.WAV")).toBe(".wav");
    expect(getFileExtension("song.SYNTH")).toBe(".synth");
    expect(getFileExtension("My.Sample.With.Dots.flac")).toBe(".flac");
  });

  it("liefert '' fuer Dateien ohne Endung", () => {
    expect(getFileExtension("README")).toBe("");
    expect(getFileExtension("")).toBe("");
    expect(getFileExtension("foo.")).toBe("");
  });

  it("ist defensiv bei null/undefined-Input", () => {
    // @ts-expect-error - bewusst kaputten Input testen
    expect(getFileExtension(null)).toBe("");
    // @ts-expect-error - bewusst kaputten Input testen
    expect(getFileExtension(undefined)).toBe("");
  });
});

// ─── detectFileType (Hauptmatrix) ─────────────────────────────────────────────

describe("detectFileType", () => {
  it("erkennt alle Audio-Endungen aus AUDIO_EXTENSIONS", () => {
    for (const ext of AUDIO_EXTENSIONS) {
      expect(detectFileType(`kick${ext}`)).toBe("audio");
    }
  });

  it("erkennt .synth als project", () => {
    expect(detectFileType("Song.synth")).toBe("project");
    expect(detectFileType("backup.SYNTH")).toBe("project");
  });

  it("erkennt .zip als zip", () => {
    expect(detectFileType("samples.zip")).toBe("zip");
  });

  it("erkennt .mid und .midi als midi", () => {
    expect(detectFileType("loop.mid")).toBe("midi");
    expect(detectFileType("loop.MIDI")).toBe("midi");
  });

  it("erkennt alle KORG-Electribe-Endungen als electribe", () => {
    expect(detectFileType("bank.e2spat")).toBe("electribe");
    expect(detectFileType("bank.e2sallpat")).toBe("electribe");
    expect(detectFileType("legacy.esx")).toBe("electribe");
    expect(detectFileType("legacy.elst")).toBe("electribe");
    expect(detectFileType("alias.e2pattern")).toBe("electribe");
  });

  it("liefert 'unknown' fuer unbekannte Endungen", () => {
    expect(detectFileType("model.gltf")).toBe("unknown");
    expect(detectFileType("doc.pdf")).toBe("unknown");
    expect(detectFileType("video.mp4")).toBe("unknown");
  });

  it("liefert 'unknown' fuer Dateien ohne Endung", () => {
    expect(detectFileType("README")).toBe("unknown");
    expect(detectFileType("")).toBe("unknown");
  });

  it("die Endungs-Sets sind disjunkt", () => {
    const sets = [AUDIO_EXTENSIONS, PROJECT_EXTENSIONS, ZIP_EXTENSIONS, MIDI_EXTENSIONS, ELECTRIBE_EXTENSIONS];
    const seen = new Set<string>();
    for (const s of sets) {
      for (const ext of s) {
        expect(seen.has(ext)).toBe(false);
        seen.add(ext);
      }
    }
  });
});

// ─── detectFileTypeFromFiles ──────────────────────────────────────────────────

describe("detectFileTypeFromFiles", () => {
  it("nimmt den Typ der ersten Datei", () => {
    expect(detectFileTypeFromFiles([{ name: "a.wav" }, { name: "b.synth" }])).toBe("audio");
    expect(detectFileTypeFromFiles([{ name: "x.synth" }])).toBe("project");
  });

  it("liefert 'unknown' bei leerer Liste", () => {
    expect(detectFileTypeFromFiles([])).toBe("unknown");
  });
});

// ─── dispatchFileDrop ─────────────────────────────────────────────────────────

describe("dispatchFileDrop", () => {
  it("Drop einer .wav feuert 'drop:audio' CustomEvent", () => {
    const file = { name: "kick.wav" };
    const res = dispatchFileDrop(file);
    expect(res.handled).toBe(true);
    expect(res.type).toBe("audio");
    expect(res.extension).toBe(".wav");
    expect(fakeWindow.__dispatched).toHaveLength(1);
    expect(fakeWindow.__dispatched[0].type).toBe("drop:audio");
    expect(fakeWindow.__dispatched[0].detail).toBe(file);
  });

  it("Drop einer .synth feuert 'drop:project' CustomEvent (Project-Load)", () => {
    const file = { name: "Song.synth" };
    const res = dispatchFileDrop(file);
    expect(res.handled).toBe(true);
    expect(res.type).toBe("project");
    expect(fakeWindow.__dispatched[0].type).toBe("drop:project");
  });

  it("Drop einer .e2sallpat feuert 'electribe:fileImport' CustomEvent", () => {
    const file = { name: "drum.e2sallpat" };
    const res = dispatchFileDrop(file);
    expect(res.handled).toBe(true);
    expect(res.type).toBe("electribe");
    expect(fakeWindow.__dispatched[0].type).toBe("electribe:fileImport");
    expect(fakeWindow.__dispatched[0].detail).toBe(file);
  });

  it("Drop einer .mid feuert 'midi:fileImport' CustomEvent", () => {
    const file = { name: "loop.mid" };
    const res = dispatchFileDrop(file);
    expect(res.handled).toBe(true);
    expect(res.type).toBe("midi");
    expect(fakeWindow.__dispatched[0].type).toBe("midi:fileImport");
  });

  it("Drop einer .zip feuert 'drop:zip' CustomEvent", () => {
    const file = { name: "pack.zip" };
    const res = dispatchFileDrop(file);
    expect(res.handled).toBe(true);
    expect(res.type).toBe("zip");
    expect(fakeWindow.__dispatched[0].type).toBe("drop:zip");
  });

  it("Drop unbekannter Endung feuert KEIN Event und meldet unhandled", () => {
    const file = { name: "video.mp4" };
    const res = dispatchFileDrop(file);
    expect(res.handled).toBe(false);
    expect(res.type).toBe("unknown");
    expect(res.extension).toBe(".mp4");
    expect(fakeWindow.__dispatched).toHaveLength(0);
  });

  it("Endpoint-Listener empfaengt File-Detail", () => {
    let received: { name: string } | null = null;
    fakeWindow.addEventListener("drop:audio", (e) => {
      received = (e as unknown as { detail: { name: string } }).detail;
    });
    const file = { name: "snare.flac" };
    dispatchFileDrop(file);
    expect(received).toBe(file);
  });
});

// ─── dispatchAllFiles (Multi-File-Drop) ───────────────────────────────────────

describe("dispatchAllFiles", () => {
  it("iteriert ueber alle Files und feuert pro File ein Event", () => {
    const files = [
      { name: "kick.wav" },
      { name: "snare.wav" },
      { name: "Song.synth" },
    ];
    const res = dispatchAllFiles(files);
    expect(res.handled).toBe(3);
    expect(res.unknown).toBe(0);
    expect(res.types).toEqual(["audio", "audio", "project"]);
    expect(fakeWindow.__dispatched).toHaveLength(3);
    expect(fakeWindow.__dispatched.map(e => e.type)).toEqual([
      "drop:audio",
      "drop:audio",
      "drop:project",
    ]);
  });

  it("zaehlt Unknown-Endungen ohne Event-Feuerung", () => {
    const files = [
      { name: "kick.wav" },
      { name: "movie.mp4" },
      { name: "doc.pdf" },
    ];
    const res = dispatchAllFiles(files);
    expect(res.handled).toBe(1);
    expect(res.unknown).toBe(2);
    expect(res.types).toEqual(["audio", "unknown", "unknown"]);
    expect(fakeWindow.__dispatched).toHaveLength(1);
  });

  it("akzeptiert mixed Multi-File-Drop (alle 5 Typen + unknown)", () => {
    const files = [
      { name: "kick.wav" },          // audio
      { name: "Song.synth" },        // project
      { name: "bank.e2sallpat" },    // electribe
      { name: "groove.mid" },        // midi
      { name: "samples.zip" },       // zip
      { name: "video.mp4" },         // unknown
    ];
    const res = dispatchAllFiles(files);
    expect(res.handled).toBe(5);
    expect(res.unknown).toBe(1);
    expect(new Set(res.types)).toEqual(
      new Set(["audio", "project", "electribe", "midi", "zip", "unknown"]),
    );
  });

  it("leeres Array → handled=0, unknown=0", () => {
    const res = dispatchAllFiles([]);
    expect(res.handled).toBe(0);
    expect(res.unknown).toBe(0);
    expect(res.types).toEqual([]);
    expect(fakeWindow.__dispatched).toHaveLength(0);
  });
});

// ─── Defensive ────────────────────────────────────────────────────────────────

describe("dispatchFileDrop defensive paths", () => {
  it("kaputtes File-Objekt ohne name → unknown ohne Crash", () => {
    // @ts-expect-error - bewusst kaputter Input
    const res = dispatchFileDrop({});
    expect(res.handled).toBe(false);
    expect(res.type).toBe("unknown");
  });

  it("ohne window-Global → unhandled aber ohne Crash", () => {
    // @ts-expect-error - test
    globalThis.window = undefined;
    const res = dispatchFileDrop({ name: "kick.wav" });
    expect(res.handled).toBe(false);
    expect(res.type).toBe("audio");
  });

  it("wenn dispatchEvent throws → unhandled aber kein Re-Throw", () => {
    const orig = fakeWindow.dispatchEvent;
    fakeWindow.dispatchEvent = vi.fn(() => { throw new Error("test boom"); });
    const res = dispatchFileDrop({ name: "kick.wav" });
    expect(res.handled).toBe(false);
    expect(res.type).toBe("audio");
    fakeWindow.dispatchEvent = orig;
  });
});
