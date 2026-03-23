/**
 * Synthstudio – Drag & Drop Unit-Tests (Testing-Agent)
 *
 * Testet die Kategorisierungs-Logik für gedropte Dateien und Ordner.
 * Kein Electron-Import nötig – reine Logik-Tests.
 *
 * Ausführen: pnpm vitest tests/electron/dragdrop.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";

// ─── fs.statSync mocken ───────────────────────────────────────────────────────

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return {
    ...actual,
    statSync: vi.fn(),
  };
});

// ─── Kategorisierungs-Logik (aus dragdrop.ts extrahiert für Tests) ─────────────

type DropCategory = "audio" | "folder" | "project" | "unknown";

interface DropItem {
  filePath: string;
  isDirectory: boolean;
}

interface DropResult {
  category: DropCategory;
  filePath: string;
}

const AUDIO_EXTENSIONS = new Set([".wav", ".mp3", ".ogg", ".flac", ".aiff", ".aif", ".m4a"]);
const PROJECT_EXTENSIONS = new Set([".esx1", ".json"]);

function getExtension(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  return dot >= 0 ? filePath.slice(dot).toLowerCase() : "";
}

function categorizeDropItem(item: DropItem): DropResult {
  if (item.isDirectory) {
    return { category: "folder", filePath: item.filePath };
  }
  const ext = getExtension(item.filePath);
  if (AUDIO_EXTENSIONS.has(ext)) {
    return { category: "audio", filePath: item.filePath };
  }
  if (PROJECT_EXTENSIONS.has(ext)) {
    return { category: "project", filePath: item.filePath };
  }
  return { category: "unknown", filePath: item.filePath };
}

function categorizeDropItems(filePaths: string[]): DropResult[] {
  const statSync = fs.statSync as ReturnType<typeof vi.fn>;
  return filePaths.map((filePath) => {
    let isDirectory = false;
    try {
      const stat = statSync(filePath) as { isDirectory: () => boolean };
      isDirectory = stat.isDirectory();
    } catch {
      isDirectory = false;
    }
    return categorizeDropItem({ filePath, isDirectory });
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Drag & Drop Kategorisierung", () => {
  const mockStatSync = fs.statSync as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Standard: Dateien (keine Ordner)
    mockStatSync.mockReturnValue({ isDirectory: () => false });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Audio-Dateien ──────────────────────────────────────────────────────────
  describe("Audio-Dateien", () => {
    it.each([
      ["/samples/kick.wav", ".wav"],
      ["/samples/snare.mp3", ".mp3"],
      ["/samples/hihat.ogg", ".ogg"],
      ["/samples/bass.flac", ".flac"],
      ["/samples/pad.aiff", ".aiff"],
      ["/samples/lead.aif", ".aif"],
      ["/samples/chord.m4a", ".m4a"],
    ])("erkennt %s als Audio-Datei (%s)", (filePath) => {
      const results = categorizeDropItems([filePath]);
      expect(results[0].category).toBe("audio");
      expect(results[0].filePath).toBe(filePath);
    });

    it("kategorisiert mehrere Audio-Dateien korrekt", () => {
      const paths = ["/a.wav", "/b.mp3", "/c.flac"];
      const results = categorizeDropItems(paths);
      expect(results).toHaveLength(3);
      results.forEach((r) => expect(r.category).toBe("audio"));
    });

    it("WAV-Erweiterung ist case-insensitiv", () => {
      // Erweiterung wird in Kleinbuchstaben konvertiert
      const result = categorizeDropItem({ filePath: "/sample.WAV", isDirectory: false });
      expect(result.category).toBe("audio");
    });
  });

  // ── Ordner ─────────────────────────────────────────────────────────────────
  describe("Ordner", () => {
    beforeEach(() => {
      mockStatSync.mockReturnValue({ isDirectory: () => true });
    });

    it("erkennt Ordner korrekt", () => {
      const results = categorizeDropItems(["/samples/drums"]);
      expect(results[0].category).toBe("folder");
    });

    it("erkennt Ordner auch wenn Pfad wie Datei aussieht", () => {
      // Ordner mit Punkt im Namen
      const results = categorizeDropItems(["/samples/my.samples"]);
      expect(results[0].category).toBe("folder");
    });

    it("Ordner hat keinen Audio-Typ auch mit Audio-Erweiterung im Namen", () => {
      const results = categorizeDropItems(["/samples/kick.wav"]); // Ordner namens "kick.wav"
      expect(results[0].category).toBe("folder");
    });
  });

  // ── Projekt-Dateien ────────────────────────────────────────────────────────
  describe("Projekt-Dateien", () => {
    it.each([
      ["/projects/my-project.esx1"],
      ["/projects/backup.json"],
    ])("erkennt %s als Projekt-Datei", (filePath) => {
      const results = categorizeDropItems([filePath]);
      expect(results[0].category).toBe("project");
    });

    it("esx1-Erweiterung wird als Projekt erkannt", () => {
      const result = categorizeDropItem({ filePath: "/test.esx1", isDirectory: false });
      expect(result.category).toBe("project");
    });
  });

  // ── Unbekannte Dateitypen ──────────────────────────────────────────────────
  describe("Unbekannte Dateitypen", () => {
    it.each([
      ["/document.pdf"],
      ["/image.png"],
      ["/video.mp4"],
      ["/text.txt"],
      ["/archive.zip"],
      ["/no-extension"],
    ])("erkennt %s als unbekannt", (filePath) => {
      const results = categorizeDropItems([filePath]);
      expect(results[0].category).toBe("unknown");
    });

    it("Datei ohne Erweiterung ist unbekannt", () => {
      const result = categorizeDropItem({ filePath: "/Makefile", isDirectory: false });
      expect(result.category).toBe("unknown");
    });
  });

  // ── Gemischte Drops ────────────────────────────────────────────────────────
  describe("Gemischte Drops", () => {
    it("kategorisiert gemischte Dateien korrekt", () => {
      mockStatSync.mockImplementation((filePath: string) => ({
        isDirectory: () => filePath === "/samples/drums",
      }));

      const paths = ["/samples/kick.wav", "/samples/drums", "/project.esx1", "/readme.txt"];
      const results = categorizeDropItems(paths);

      expect(results[0].category).toBe("audio");
      expect(results[1].category).toBe("folder");
      expect(results[2].category).toBe("project");
      expect(results[3].category).toBe("unknown");
    });
  });

  // ── Fehlerbehandlung ───────────────────────────────────────────────────────
  describe("Fehlerbehandlung", () => {
    it("behandelt statSync-Fehler graceful (Datei nicht gefunden)", () => {
      mockStatSync.mockImplementation(() => {
        throw new Error("ENOENT: no such file or directory");
      });

      const results = categorizeDropItems(["/nonexistent.wav"]);
      // Fällt auf Datei-Erkennung zurück (isDirectory = false)
      expect(results[0].category).toBe("audio");
    });

    it("leeres Array gibt leeres Ergebnis zurück", () => {
      const results = categorizeDropItems([]);
      expect(results).toHaveLength(0);
    });
  });
});

// ─── getExtension Tests ────────────────────────────────────────────────────────

describe("getExtension Hilfsfunktion", () => {
  it("gibt .wav für /path/to/file.wav zurück", () => {
    expect(getExtension("/path/to/file.wav")).toBe(".wav");
  });

  it("gibt leeren String zurück wenn keine Erweiterung", () => {
    expect(getExtension("/path/to/Makefile")).toBe("");
  });

  it("konvertiert zu Kleinbuchstaben", () => {
    expect(getExtension("/path/FILE.WAV")).toBe(".wav");
  });

  it("nimmt die letzte Erweiterung bei mehreren Punkten", () => {
    expect(getExtension("/path/my.backup.wav")).toBe(".wav");
  });
});
