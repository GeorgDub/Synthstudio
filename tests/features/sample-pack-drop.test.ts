/**
 * tests/features/sample-pack-drop.test.ts (v3.107.0)
 *
 * Tests für:
 *  - parsePackSamplePayload (JSON-Parsing, Garbage-Defense)
 *  - samplePackPreview (stop() idempotent + cleanup)
 *  - useSamplePackStore.getSampleData (null fuer unknown sampleId)
 *  - validatePackSamplePath (Path-Traversal-Schutz)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as path from "path";

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
  parsePackSamplePayload,
  PACK_SAMPLE_DRAG_MIME,
} from "@/components/SamplePackBrowser/dropPayload";
import {
  validatePackSamplePath,
  validatePackSampleFileSize,
  PACK_SAMPLE_MAX_BYTES,
} from "../../electron/ipcValidators";
import { previewSample } from "@/utils/samplePackPreview";
import {
  addPack,
  getSampleData,
  getSampleBlobUrl,
  __resetSamplePackStoreForTests,
} from "@/store/useSamplePackStore";

// ─── parsePackSamplePayload ──────────────────────────────────────────────────

describe("parsePackSamplePayload", () => {
  it("parsed valides JSON-Payload korrekt", () => {
    const json = JSON.stringify({
      sampleId: "s-1",
      packId: "p-1",
      filename: "kick.wav",
      relPath: "Trap/kick.wav",
    });
    expect(parsePackSamplePayload(json)).toEqual({
      sampleId: "s-1",
      packId: "p-1",
      filename: "kick.wav",
      relPath: "Trap/kick.wav",
    });
  });

  it("liefert null bei invalidem JSON", () => {
    expect(parsePackSamplePayload("{not-json")).toBeNull();
    expect(parsePackSamplePayload("")).toBeNull();
    expect(parsePackSamplePayload(null)).toBeNull();
    expect(parsePackSamplePayload(undefined)).toBeNull();
  });

  it("liefert null bei fehlenden Pflicht-Feldern", () => {
    expect(parsePackSamplePayload(JSON.stringify({ sampleId: "x" }))).toBeNull();
    expect(
      parsePackSamplePayload(JSON.stringify({ sampleId: "", packId: "p", filename: "f", relPath: "r" })),
    ).toBeNull();
    expect(
      parsePackSamplePayload(JSON.stringify({ sampleId: "s", packId: "p", filename: "", relPath: "r" })),
    ).toBeNull();
  });

  it("akzeptiert leeren relPath (root-level Sample)", () => {
    const json = JSON.stringify({
      sampleId: "s-1", packId: "p-1", filename: "kick.wav", relPath: "",
    });
    expect(parsePackSamplePayload(json)).not.toBeNull();
  });

  it("exportiert MIME-Konstante korrekt", () => {
    expect(PACK_SAMPLE_DRAG_MIME).toBe("application/x-synthstudio-pack-sample");
  });
});

// ─── samplePackPreview ───────────────────────────────────────────────────────

describe("samplePackPreview", () => {
  it("stop() ist idempotent und disconnected den Source", async () => {
    const disconnectSpy = vi.fn();
    const stopSpy = vi.fn();
    const mockSource = {
      buffer: null,
      connect: vi.fn(),
      disconnect: disconnectSpy,
      start: vi.fn(),
      stop: stopSpy,
      onended: null as null | (() => void),
    };
    const mockGain = {
      gain: { value: 0 },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    const mockCtx = {
      decodeAudioData: vi.fn(async (_b: ArrayBuffer) => ({ duration: 0.5 })),
      createBufferSource: vi.fn(() => mockSource),
      createGain: vi.fn(() => mockGain),
      destination: {},
    } as unknown as AudioContext;

    const data = new ArrayBuffer(16);
    const handle = await previewSample(data, mockCtx, { durationMs: 100 });
    expect(handle.isStopped()).toBe(false);
    expect(mockSource.start).toHaveBeenCalled();
    handle.stop();
    expect(handle.isStopped()).toBe(true);
    expect(stopSpy).toHaveBeenCalled();
    expect(disconnectSpy).toHaveBeenCalled();
    // Zweiter stop() ist no-op (idempotent)
    const stopCallsBefore = stopSpy.mock.calls.length;
    handle.stop();
    expect(stopSpy.mock.calls.length).toBe(stopCallsBefore);
  });

  it("liefert non-throwing stop()-Handle bei decodeAudioData-Error", async () => {
    const mockCtx = {
      decodeAudioData: vi.fn(async () => { throw new Error("bad audio"); }),
      createBufferSource: vi.fn(),
      createGain: vi.fn(),
      destination: {},
    } as unknown as AudioContext;
    const data = new ArrayBuffer(16);
    const handle = await previewSample(data, mockCtx);
    expect(handle.isStopped()).toBe(true);
    expect(() => handle.stop()).not.toThrow();
  });
});

// ─── useSamplePackStore.getSampleData ────────────────────────────────────────

describe("useSamplePackStore.getSampleData", () => {
  beforeEach(() => {
    __resetSamplePackStoreForTests();
  });

  it("liefert null fuer unbekannte sampleId", async () => {
    expect(await getSampleData("non-existent")).toBeNull();
    expect(await getSampleBlobUrl("non-existent")).toBeNull();
  });

  it("liefert null wenn kein File-Handle und kein absolutePath gesetzt sind", async () => {
    addPack("TestPack", "TestPack", [{
      id: "s-1",
      filename: "kick.wav",
      relPath: "kick.wav",
      parentFolder: "",
      category: "kick",
      tags: [],
      bpm: null,
      sizeBytes: 100,
    }]);
    // Ohne fileHandles + ohne absolutePath
    expect(await getSampleData("s-1")).toBeNull();
  });
});

// ─── validatePackSamplePath ──────────────────────────────────────────────────

describe("validatePackSamplePath (Path-Traversal)", () => {
  // Plattform-portable Root + absolute path.
  const root = path.resolve("/tmp/pack-root");
  const validAbs = path.resolve(root, "Trap", "kick.wav");
  const traversal = path.resolve(root, "..", "etc", "passwd.wav");

  it("akzeptiert Pfad direkt unter dem registrierten Root", () => {
    const res = validatePackSamplePath(validAbs, [root]);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.ext).toBe(".wav");
  });

  it("lehnt '../../etc/passwd.wav' ab — Pfad ausserhalb des Roots", () => {
    const res = validatePackSamplePath(traversal, [root]);
    expect(res.ok).toBe(false);
  });

  it("lehnt Path-Traversal mit '..' im Original-String ab (nach resolve)", () => {
    // resolve normalisiert ../ — danach prüft die Funktion Containment.
    const tricky = path.join(root, "..", "outside.wav");
    const res = validatePackSamplePath(tricky, [root]);
    expect(res.ok).toBe(false);
  });

  it("lehnt NUL-Byte im Pfad ab", () => {
    expect(validatePackSamplePath("/tmp/pack-root/k\0ick.wav", [root]).ok).toBe(false);
  });

  it("lehnt Nicht-Audio-Endungen ab (z.B. .exe)", () => {
    const exe = path.resolve(root, "evil.exe");
    expect(validatePackSamplePath(exe, [root]).ok).toBe(false);
  });

  it("lehnt relative Pfade ab", () => {
    expect(validatePackSamplePath("relative/file.wav", [root]).ok).toBe(false);
  });

  it("lehnt leere allowedRoots-Liste ab", () => {
    expect(validatePackSamplePath(validAbs, []).ok).toBe(false);
  });

  it("matcht nur exakt unter dem Root (kein Prefix-Confusion-Bug)", () => {
    // /tmp/pack-root vs /tmp/pack-root2 — darf NICHT matchen.
    const sibling = path.resolve("/tmp/pack-root2/file.wav");
    expect(validatePackSamplePath(sibling, [root]).ok).toBe(false);
  });

  it("size-cap rejected oversized files", () => {
    expect(validatePackSampleFileSize(PACK_SAMPLE_MAX_BYTES + 1).ok).toBe(false);
    expect(validatePackSampleFileSize(1024).ok).toBe(true);
    expect(validatePackSampleFileSize(-1).ok).toBe(false);
    expect(validatePackSampleFileSize(NaN).ok).toBe(false);
  });
});
