/**
 * tests/features/pattern-library-store.test.ts (TASK-CVG-LIB-STORE / v2.65)
 *
 * Unit-Tests für usePatternLibraryStore. CRUD + Search + Export/Import.
 */
import { describe, it, expect, beforeEach } from "vitest";

// ─── localStorage Mock ───────────────────────────────────────────────────────

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
  savePatternToLibrary,
  deleteLibraryEntry,
  updateLibraryEntry,
  getLibraryEntry,
  searchLibrary,
  exportLibrary,
  importLibrary,
} from "@/store/usePatternLibraryStore";
import type { PatternData } from "@/audio/AudioEngine";

const STORAGE_KEY = "ss-pattern-library:v1";

function fakePattern(overrides: Partial<PatternData> = {}): PatternData {
  return {
    id: "p1",
    name: "Pat 1",
    stepCount: 16,
    stepResolution: "1/16",
    bpm: 120,
    parts: [],
    ...overrides,
  } as PatternData;
}

function getAllRaw(): unknown[] {
  const raw = localStorageMock.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

function clearLibrary() {
  // Räume Bibliothek auf — lese aktuelle IDs aus localStorage und delete jede
  for (const e of getAllRaw() as Array<{ id: string }>) {
    deleteLibraryEntry(e.id);
  }
  localStorageMock.clear();
}

describe("usePatternLibraryStore – savePatternToLibrary", () => {
  beforeEach(clearLibrary);

  it("speichert Pattern und liefert id zurück", () => {
    const id = savePatternToLibrary(fakePattern());
    expect(typeof id).toBe("string");
    expect(getLibraryEntry(id)).toBeDefined();
  });

  it("id-Format folgt 'lib-<timestamp>-<rand>'", () => {
    const id = savePatternToLibrary(fakePattern());
    expect(id).toMatch(/^lib-\d+-[a-z0-9]+$/);
  });

  it("Default-Felder: name ist aus Pattern, genre='Unbekannt', tags=[], rating=0", () => {
    const id = savePatternToLibrary(fakePattern({ name: "My Pat", bpm: 140 }));
    const entry = getLibraryEntry(id)!;
    expect(entry.name).toBe("My Pat");
    expect(entry.genre).toBe("Unbekannt");
    expect(entry.tags).toEqual([]);
    expect(entry.rating).toBe(0);
    expect(entry.bpm).toBe(140);
  });

  it("Opts können name/genre/tags/rating überschreiben", () => {
    const id = savePatternToLibrary(fakePattern(), {
      name: "Override",
      genre: "Techno",
      tags: ["dark", "180bpm"],
      rating: 5,
    });
    const e = getLibraryEntry(id)!;
    expect(e.name).toBe("Override");
    expect(e.genre).toBe("Techno");
    expect(e.tags).toEqual(["dark", "180bpm"]);
    expect(e.rating).toBe(5);
  });

  it("patternJson enthält das serialisierte Original-Pattern", () => {
    const pattern = fakePattern({ name: "Orig", stepCount: 32 });
    const id = savePatternToLibrary(pattern);
    const e = getLibraryEntry(id)!;
    const parsed = JSON.parse(e.patternJson) as PatternData;
    expect(parsed.name).toBe("Orig");
    expect(parsed.stepCount).toBe(32);
  });

  it("createdAt ist plausibler Timestamp (>0)", () => {
    const id = savePatternToLibrary(fakePattern());
    expect(getLibraryEntry(id)!.createdAt).toBeGreaterThan(0);
  });

  it("Neue Entries werden vorne eingefügt (jüngste zuerst)", () => {
    const id1 = savePatternToLibrary(fakePattern({ name: "First" }));
    const id2 = savePatternToLibrary(fakePattern({ name: "Second" }));
    const all = getAllRaw() as Array<{ id: string }>;
    expect(all[0].id).toBe(id2); // neuer zuerst
    expect(all[1].id).toBe(id1);
  });
});

describe("usePatternLibraryStore – delete/update", () => {
  beforeEach(clearLibrary);

  it("deleteLibraryEntry entfernt nur matching id", () => {
    const id1 = savePatternToLibrary(fakePattern());
    const id2 = savePatternToLibrary(fakePattern());
    deleteLibraryEntry(id1);
    expect(getLibraryEntry(id1)).toBeUndefined();
    expect(getLibraryEntry(id2)).toBeDefined();
  });

  it("deleteLibraryEntry auf unbekannter id → no-op", () => {
    const id = savePatternToLibrary(fakePattern());
    deleteLibraryEntry("nope");
    expect(getLibraryEntry(id)).toBeDefined();
  });

  it("updateLibraryEntry partial → andere Felder bleiben", () => {
    const id = savePatternToLibrary(fakePattern(), { rating: 3, genre: "House" });
    updateLibraryEntry(id, { rating: 5 });
    const e = getLibraryEntry(id)!;
    expect(e.rating).toBe(5);
    expect(e.genre).toBe("House"); // unverändert
  });

  it("updateLibraryEntry auf unbekannter id → no-op", () => {
    updateLibraryEntry("nope", { rating: 5 });
    expect(getLibraryEntry("nope")).toBeUndefined();
  });
});

describe("usePatternLibraryStore – searchLibrary", () => {
  beforeEach(clearLibrary);

  it("leerer query liefert alle Einträge", () => {
    savePatternToLibrary(fakePattern({ name: "A" }));
    savePatternToLibrary(fakePattern({ name: "B" }));
    const results = searchLibrary("");
    expect(results).toHaveLength(2);
  });

  it("matcht im Name (case-insensitive)", () => {
    savePatternToLibrary(fakePattern({ name: "Hardstyle Banger" }), { genre: "Hardstyle" });
    savePatternToLibrary(fakePattern({ name: "Smooth Vibes" }), { genre: "Lofi" });
    expect(searchLibrary("hardstyle").length).toBeGreaterThanOrEqual(1);
    expect(searchLibrary("smooth")).toHaveLength(1);
  });

  it("matcht in Tags", () => {
    savePatternToLibrary(fakePattern(), { tags: ["dark", "minimal"] });
    savePatternToLibrary(fakePattern(), { tags: ["uplifting"] });
    expect(searchLibrary("minimal")).toHaveLength(1);
  });

  it("matcht im Genre", () => {
    savePatternToLibrary(fakePattern(), { genre: "Techno" });
    savePatternToLibrary(fakePattern(), { genre: "Trance" });
    expect(searchLibrary("techno")).toHaveLength(1);
  });

  it("Genre-Filter (exact match) zusätzlich zu query", () => {
    savePatternToLibrary(fakePattern({ name: "Banger" }), { genre: "Techno" });
    savePatternToLibrary(fakePattern({ name: "Banger" }), { genre: "House" });
    const results = searchLibrary("banger", "Techno");
    expect(results).toHaveLength(1);
    expect(results[0].genre).toBe("Techno");
  });
});

describe("usePatternLibraryStore – Export/Import", () => {
  beforeEach(clearLibrary);

  it("exportLibrary liefert valides JSON mit version + entries", () => {
    savePatternToLibrary(fakePattern());
    const json = exportLibrary();
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe("1.0");
    expect(parsed.entries).toHaveLength(1);
  });

  it("importLibrary merge=true fügt neue Einträge hinzu, behält existing", () => {
    const idExisting = savePatternToLibrary(fakePattern({ name: "Existing" }));
    const externalJson = JSON.stringify({
      version: "1.0",
      entries: [{
        id: "external-1", name: "External", genre: "Test", tags: [],
        bpm: 120, stepCount: 16, patternJson: "{}", createdAt: 1, rating: 0,
      }],
    });
    importLibrary(externalJson, true);
    expect(getLibraryEntry(idExisting)).toBeDefined();
    expect(getLibraryEntry("external-1")).toBeDefined();
  });

  it("importLibrary merge=false ersetzt komplett", () => {
    savePatternToLibrary(fakePattern({ name: "Old" }));
    const externalJson = JSON.stringify({
      version: "1.0",
      entries: [{
        id: "ext-only", name: "External", genre: "X", tags: [],
        bpm: 120, stepCount: 16, patternJson: "{}", createdAt: 1, rating: 0,
      }],
    });
    importLibrary(externalJson, false);
    expect(getLibraryEntry("ext-only")).toBeDefined();
    // alte Einträge weg
    const all = getAllRaw() as Array<{ id: string }>;
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe("ext-only");
  });

  it("importLibrary merge=true: doppelte IDs werden nicht dupliziert (existing wins)", () => {
    const id = savePatternToLibrary(fakePattern({ name: "Original" }));
    const externalJson = JSON.stringify({
      version: "1.0",
      entries: [{
        id, name: "Duplicate-Attempt", genre: "X", tags: [],
        bpm: 120, stepCount: 16, patternJson: "{}", createdAt: 0, rating: 0,
      }],
    });
    importLibrary(externalJson, true);
    expect(getLibraryEntry(id)!.name).toBe("Original");
  });
});
