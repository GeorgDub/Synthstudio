/**
 * tests/features/electron-pack-import.test.ts (v3.108.0)
 *
 * Tests für den Electron-Pack-Import-Flow (closes v3.107 caveat):
 *  - walkPackRoot (Recursive-Scan) — Filter, Caps, Symlink-Schutz
 *  - resolvePreviewDurationMs — sample-length-aware preview duration
 *  - useSamplePackStore — addPack mit electron-fs vs browser-memory source
 *  - Electron-API surface (browser-Fallback)
 *
 * Hinweise:
 *  - vitest env:node — kein echtes Web-Audio, AudioContext gemockt wenn nötig.
 *  - fs.promises wird über das deps-Argument der walkPackRoot gemockt
 *    (kein realer Disk-Access in tests).
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
  walkPackRoot,
  PACK_SCAN_MAX_FILES,
  PACK_SCAN_MAX_DEPTH,
  type FsDirent,
  type FsStat,
  type PackScanDeps,
} from "../../electron/packScanner";
import {
  resolvePreviewDurationMs,
  SAMPLE_LENGTH_CAP_MS,
  previewSample,
} from "@/utils/samplePackPreview";
import {
  addPack,
  getSampleData,
  __resetSamplePackStoreForTests,
  getSamplePackState,
  registerSampleFile,
} from "@/store/useSamplePackStore";

// ─── In-Memory FS Helper ──────────────────────────────────────────────────────
//
// Simuliert eine FS-Tree als plain Object → walkPackRoot kann es ohne
// echte fs-Calls traversieren.

interface MemNode {
  /** child name → child node. Wenn vorhanden = directory. */
  children?: Record<string, MemNode>;
  /** Wenn !children = file. */
  size?: number;
  /** Symlink-Flag (wird nicht verfolgt). */
  symlink?: boolean;
}

function mkFile(size = 1024): MemNode { return { size, children: undefined }; }
function mkDir(children: Record<string, MemNode>): MemNode { return { children }; }
function mkSymlink(): MemNode { return { symlink: true }; }

function _lookup(root: MemNode, parts: string[]): MemNode | null {
  let node: MemNode | undefined = root;
  for (const p of parts) {
    if (!node || !node.children) return null;
    node = node.children[p];
    if (!node) return null;
  }
  return node ?? null;
}

function _resolveRel(target: string, base: string): string[] {
  // Convert e.g. "/tmp/pack-root/Trap/kick.wav" relative to "/tmp/pack-root"
  // to ["Trap", "kick.wav"]. Uses path.sep to be Windows/POSIX-portable.
  const sep = path.sep;
  const rel = target === base ? "" : target.startsWith(base + sep) ? target.slice(base.length + 1) : target;
  if (rel.length === 0) return [];
  return rel.split(sep).filter((p) => p.length > 0);
}

function makeFsDeps(rootAbs: string, root: MemNode): PackScanDeps {
  return {
    readdir: async (dirPath: string): Promise<FsDirent[]> => {
      const parts = _resolveRel(dirPath, rootAbs);
      const node = _lookup(root, parts);
      if (!node || !node.children) throw new Error("ENOTDIR");
      return Object.entries(node.children).map(([name, child]) => ({
        name,
        isDirectory: () => !!child.children && !child.symlink,
        isFile: () => !child.children && !child.symlink,
        isSymbolicLink: () => !!child.symlink,
      }));
    },
    lstat: async (target: string): Promise<FsStat> => {
      const parts = _resolveRel(target, rootAbs);
      const node = _lookup(root, parts);
      if (!node) throw new Error("ENOENT");
      return {
        size: node.size ?? 0,
        isFile: () => !node.children && !node.symlink,
        isDirectory: () => !!node.children && !node.symlink,
      };
    },
  };
}

// ─── walkPackRoot ────────────────────────────────────────────────────────────

describe("walkPackRoot — recursive folder scan", () => {
  const root = path.resolve("/tmp/pack-root");

  it("filters non-audio extensions out", async () => {
    const fs = mkDir({
      "kick.wav":   mkFile(),
      "snare.mp3":  mkFile(),
      "readme.txt": mkFile(),
      "notes.md":   mkFile(),
      "evil.exe":   mkFile(),
    });
    const result = await walkPackRoot(root, makeFsDeps(root, fs));
    const names = result.files.map((f) => f.relPath).sort();
    expect(names).toEqual(["kick.wav", "snare.mp3"]);
    expect(result.truncated).toBe(false);
  });

  it("scans nested directories up to maxDepth", async () => {
    const fs = mkDir({
      "kick.wav": mkFile(),
      "Trap":     mkDir({
        "808.wav": mkFile(),
        "Drums":   mkDir({
          "hihat.wav": mkFile(),
        }),
      }),
    });
    const result = await walkPackRoot(root, makeFsDeps(root, fs));
    const names = result.files.map((f) => f.relPath).sort();
    expect(names).toEqual(["Trap/808.wav", "Trap/Drums/hihat.wav", "kick.wav"]);
  });

  it("rejects symlinks (kein follow → kein Path-Escape)", async () => {
    const fs = mkDir({
      "real.wav":     mkFile(),
      "escape":       mkSymlink(),
      "kick.wav":     mkFile(),
    });
    const result = await walkPackRoot(root, makeFsDeps(root, fs));
    const names = result.files.map((f) => f.relPath);
    expect(names).toContain("real.wav");
    expect(names).toContain("kick.wav");
    expect(names).not.toContain("escape");
  });

  it("rejects entries with NUL byte in name", async () => {
    const fs = mkDir({
      "ok.wav":        mkFile(),
      "bad\0name.wav": mkFile(),
    });
    const result = await walkPackRoot(root, makeFsDeps(root, fs));
    const names = result.files.map((f) => f.relPath);
    expect(names).toContain("ok.wav");
    expect(names.find((n) => n.includes("\0"))).toBeUndefined();
  });

  it("limit 5000 files: returns first cap and sets truncated flag", async () => {
    const children: Record<string, MemNode> = {};
    // 5050 audio files — over the cap.
    for (let i = 0; i < 5050; i++) {
      children[`file_${String(i).padStart(5, "0")}.wav`] = mkFile();
    }
    const fs = mkDir(children);
    const result = await walkPackRoot(root, makeFsDeps(root, fs), { maxFiles: PACK_SCAN_MAX_FILES });
    expect(result.files.length).toBe(PACK_SCAN_MAX_FILES);
    expect(result.truncated).toBe(true);
  });

  it("respects depth cap (3 levels with maxDepth=2)", async () => {
    const fs = mkDir({
      "Lvl1": mkDir({
        "a.wav":  mkFile(),
        "Lvl2":   mkDir({
          "b.wav": mkFile(),
          "Lvl3":  mkDir({
            "c.wav": mkFile(),
          }),
        }),
      }),
    });
    const result = await walkPackRoot(root, makeFsDeps(root, fs), { maxDepth: 2 });
    const names = result.files.map((f) => f.relPath).sort();
    expect(names).toContain("Lvl1/a.wav");
    expect(names).toContain("Lvl1/Lvl2/b.wav");
    expect(names).not.toContain("Lvl1/Lvl2/Lvl3/c.wav");
    expect(result.depthSkipped).toBeGreaterThan(0);
  });

  it("throws on relative or empty rootPath (defense-in-depth)", async () => {
    const fs = mkDir({});
    const deps = makeFsDeps(root, fs);
    await expect(walkPackRoot("", deps)).rejects.toThrow();
    await expect(walkPackRoot("relative/path", deps)).rejects.toThrow();
    await expect(walkPackRoot("/tmp/with\0nul", deps)).rejects.toThrow();
  });

  it("returns absolutePath under the resolved root", async () => {
    const fs = mkDir({
      "kick.wav": mkFile(),
      "Trap":     mkDir({
        "808.wav": mkFile(),
      }),
    });
    const result = await walkPackRoot(root, makeFsDeps(root, fs));
    for (const f of result.files) {
      expect(path.isAbsolute(f.absolutePath)).toBe(true);
      // Containment: absolutePath beginnt mit resolvedRoot + sep.
      expect(f.absolutePath.startsWith(root + path.sep) || f.absolutePath === root).toBe(true);
    }
    expect(PACK_SCAN_MAX_DEPTH).toBeGreaterThanOrEqual(1);
  });
});

// ─── Preview-Duration (sample-length-aware) ──────────────────────────────────

describe("resolvePreviewDurationMs — sample-length-aware preview", () => {
  it("loops capped at 3s (SAMPLE_LENGTH_CAP_MS)", () => {
    // 10s sample → cap at 3s.
    expect(resolvePreviewDurationMs(10)).toBe(SAMPLE_LENGTH_CAP_MS);
    expect(SAMPLE_LENGTH_CAP_MS).toBe(3000);
  });

  it("short one-shot (200 ms) plays full length", () => {
    // 0.2s drum hit → 200 ms preview.
    expect(resolvePreviewDurationMs(0.2)).toBe(200);
  });

  it("very short sample clamped to MIN_DURATION_MS (50ms)", () => {
    // 0.01s (10 ms) gets clamped to 50.
    expect(resolvePreviewDurationMs(0.01)).toBe(50);
  });

  it("explicit override beats the sample length", () => {
    // Override 500ms wins even though sample is 5s long.
    expect(resolvePreviewDurationMs(5, 500)).toBe(500);
  });

  it("invalid duration falls back to 1500ms", () => {
    expect(resolvePreviewDurationMs(null)).toBe(1500);
    expect(resolvePreviewDurationMs(undefined)).toBe(1500);
    expect(resolvePreviewDurationMs(NaN)).toBe(1500);
    expect(resolvePreviewDurationMs(-1)).toBe(1500);
    expect(resolvePreviewDurationMs(0)).toBe(1500);
  });
});

// ─── previewSample uses sample-length ─────────────────────────────────────────

describe("previewSample uses AudioBuffer.duration", () => {
  it("schedules setTimeout based on min(3s, sample duration)", async () => {
    vi.useFakeTimers();
    try {
      const stopSpy = vi.fn();
      const mockSource = {
        buffer: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: stopSpy,
        onended: null as null | (() => void),
      };
      const mockGain = { gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() };
      // 10s long → preview should cap at 3s.
      const mockCtx = {
        decodeAudioData: vi.fn(async () => ({ duration: 10 })),
        createBufferSource: vi.fn(() => mockSource),
        createGain: vi.fn(() => mockGain),
        destination: {},
      } as unknown as AudioContext;
      const handle = await previewSample(new ArrayBuffer(16), mockCtx);
      expect(handle.isStopped()).toBe(false);
      // Just before cap → still running.
      vi.advanceTimersByTime(2999);
      expect(handle.isStopped()).toBe(false);
      // Cross 3s boundary → stopped.
      vi.advanceTimersByTime(2);
      expect(handle.isStopped()).toBe(true);
      expect(stopSpy).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("short sample plays full length, then auto-stops", async () => {
    vi.useFakeTimers();
    try {
      const stopSpy = vi.fn();
      const mockSource = {
        buffer: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: stopSpy,
        onended: null as null | (() => void),
      };
      const mockGain = { gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() };
      // 0.5s drum-hit → preview spielt 500 ms voll durch.
      const mockCtx = {
        decodeAudioData: vi.fn(async () => ({ duration: 0.5 })),
        createBufferSource: vi.fn(() => mockSource),
        createGain: vi.fn(() => mockGain),
        destination: {},
      } as unknown as AudioContext;
      const handle = await previewSample(new ArrayBuffer(16), mockCtx);
      vi.advanceTimersByTime(499);
      expect(handle.isStopped()).toBe(false);
      vi.advanceTimersByTime(2);
      expect(handle.isStopped()).toBe(true);
      expect(stopSpy).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ─── useSamplePackStore: source + electron-fs vs browser-memory ──────────────

describe("useSamplePackStore — pack source field", () => {
  beforeEach(() => {
    __resetSamplePackStoreForTests();
  });

  it("addPack with absolutePaths persists source='electron-fs'", () => {
    const absPaths = new Map<string, string>();
    absPaths.set("s-1", "/tmp/pack-root/kick.wav");
    addPack("TestPack", "/tmp/pack-root", [{
      id: "s-1",
      filename: "kick.wav",
      relPath: "kick.wav",
      parentFolder: "",
      category: "kick",
      tags: [],
      bpm: null,
      sizeBytes: 100,
    }], { absolutePaths: absPaths });
    const state = getSamplePackState();
    const pack = state.packs[0];
    expect(pack.source).toBe("electron-fs");
    expect(pack.samples[0].absolutePath).toBe("/tmp/pack-root/kick.wav");
  });

  it("addPack with fileHandles only → source='browser-memory'", () => {
    const fileHandles = new Map<string, File>();
    fileHandles.set("s-1", new File([new Uint8Array([1, 2, 3])], "kick.wav"));
    addPack("BrowserPack", "BrowserPack", [{
      id: "s-1",
      filename: "kick.wav",
      relPath: "kick.wav",
      parentFolder: "",
      category: "kick",
      tags: [],
      bpm: null,
      sizeBytes: 3,
    }], { fileHandles });
    const state = getSamplePackState();
    expect(state.packs[0].source).toBe("browser-memory");
    expect(state.packs[0].samples[0].absolutePath).toBeUndefined();
  });

  it("addPack mit beidem (gemischtes Pack): wenn auch nur EIN absolutePath gesetzt ist → 'electron-fs'", () => {
    const absPaths = new Map<string, string>();
    absPaths.set("s-1", "/tmp/pack-root/kick.wav");
    addPack("MixedPack", "/tmp/pack-root", [
      { id: "s-1", filename: "kick.wav", relPath: "kick.wav", parentFolder: "", category: "kick", tags: [], bpm: null, sizeBytes: 1 },
      { id: "s-2", filename: "snare.wav", relPath: "snare.wav", parentFolder: "", category: "snare", tags: [], bpm: null, sizeBytes: 1 },
    ], { absolutePaths: absPaths });
    expect(getSamplePackState().packs[0].source).toBe("electron-fs");
  });

  it("source field roundtrips via localStorage", () => {
    addPack("ElectronPack", "/tmp/foo", [{
      id: "s-1", filename: "k.wav", relPath: "k.wav", parentFolder: "",
      category: "kick", tags: [], bpm: null, sizeBytes: 10,
    }], { absolutePaths: new Map([["s-1", "/tmp/foo/k.wav"]]) });
    // Simuliere Reload — Store re-loaded vom localStorage.
    const raw = localStorageMock.getItem("ss-sample-packs:v1");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string);
    expect(parsed.packs[0].source).toBe("electron-fs");
  });
});

// ─── getSampleData: browser-memory WeakMap lookup ────────────────────────────

describe("useSamplePackStore.getSampleData — source-aware lookup", () => {
  beforeEach(() => {
    __resetSamplePackStoreForTests();
  });

  it("browser-memory: lookup via in-memory file handle returns bytes", async () => {
    const bytes = new Uint8Array([10, 20, 30, 40, 50]);
    const file = new File([bytes], "kick.wav");
    addPack("MemPack", "MemPack", [{
      id: "s-mem-1", filename: "kick.wav", relPath: "kick.wav", parentFolder: "",
      category: "kick", tags: [], bpm: null, sizeBytes: bytes.byteLength,
    }]);
    registerSampleFile("s-mem-1", file);
    const data = await getSampleData("s-mem-1");
    expect(data).not.toBeNull();
    if (data) {
      const arr = new Uint8Array(data);
      expect(arr.length).toBe(5);
      expect(arr[0]).toBe(10);
      expect(arr[4]).toBe(50);
    }
  });

  it("electron-fs without window.electronAPI returns null (graceful)", async () => {
    addPack("ElectronPack", "/tmp/foo", [{
      id: "s-el-1", filename: "k.wav", relPath: "k.wav", parentFolder: "",
      category: "kick", tags: [], bpm: null, sizeBytes: 10,
    }], { absolutePaths: new Map([["s-el-1", "/tmp/foo/k.wav"]]) });
    // env:node — no window.electronAPI → getSampleData falls through to null.
    const data = await getSampleData("s-el-1");
    expect(data).toBeNull();
  });
});

// ─── Electron-API surface (browser-fallback) ─────────────────────────────────

describe("electronAPI surface — browser fallback shape", () => {
  it("packChooseFolder is undefined in non-Electron env (= browser)", () => {
    // In vitest env:node ist window.electronAPI nicht gesetzt.
    const w = (globalThis as unknown as { window?: { electronAPI?: unknown } }).window;
    const api = w?.electronAPI as { packChooseFolder?: unknown } | undefined;
    expect(api?.packChooseFolder).toBeUndefined();
  });
});
