/**
 * tests/features/project-id-migration.test.ts
 *
 * v3.58.0 — Schema v1.24: Stable projectId UUID + AutoSave-Migration.
 * v3.60.0 — projectId localStorage Cache + Post-Restore lastSaveAt-Reset.
 *
 * Coverage:
 *   (1) projectId.ts Pure-fn:
 *       - generateProjectId() liefert RFC-4122-v4 UUIDs (Format-Match)
 *       - isValidProjectId() Whitelist + Reject (non-string, non-UUID)
 *       - ensureProjectId() Pass-through bei validen, regeneriert bei invalid
 *       - generateProjectId() ist nicht-deterministisch (zwei Aufrufe ≠ gleich)
 *   (2) projectSerializer:
 *       - SYNTH_FILE_VERSION = "1.24"
 *       - serializeProject() schreibt projectId (preserve oder auto-generate)
 *       - parseProject() generiert projectId bei pre-v1.24-Files
 *       - parseProject() preserves valide projectId bei v1.24-Files
 *       - parseProject() regeneriert invalide projectId-Felder
 *       - Round-Trip (serialize → parse → equal projectId)
 *       - Rename-Szenario: setze projectName neu, projectId bleibt gleich
 *   (3) AutoSave-Engine-Kompat:
 *       - sanitizeProjectId() akzeptiert UUID-v4 (36 chars, alphanumeric + -)
 *   (4) Legacy-Slug-Migration:
 *       - checkLegacySlugMigration: kein Prompt wenn keine Legacy-Versionen
 *       - checkLegacySlugMigration: kein Prompt wenn UUID schon History hat
 *       - checkLegacySlugMigration: Prompt wenn Legacy>0 und UUID=0
 *   (5) v3.60.0 makeDefaultState + AutoSave Post-Restore:
 *       - makeDefaultState liest gecachte projectId
 *       - makeDefaultState({forceFresh:true}) ignoriert Cache
 *       - newProject-Action erzeugt frische UUID trotz Cache
 *       - resetAutoSaveLastSaveAt setzt lastSaveAt auf null
 *       - Cache mit invalider ID → frische UUID (defensive)
 *
 * Pure node-env Tests (kein DOM nötig — v3.60-Block mit localStorage-Mock).
 */
import { describe, it, expect, beforeEach } from "vitest";

// ─── v3.60.0: localStorage Mock (für makeDefaultState-Cache-Tests) ───────────

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
  generateProjectId,
  isValidProjectId,
  ensureProjectId,
} from "../../client/src/utils/projectId";

import {
  SYNTH_FILE_VERSION,
  serializeProject,
  parseProject,
  toJson,
  type SynthProject,
} from "../../client/src/utils/projectSerializer";

import { sanitizeProjectId } from "../../client/src/utils/autoSaveEngine";
import { checkLegacySlugMigration } from "../../client/src/utils/autoSaveController";

// ─── Test-Fixture ────────────────────────────────────────────────────────────

function makeBaseInput(overrides: Partial<SynthProject> = {}) {
  return {
    projectName: "Test Project",
    bpm: 120,
    samples: [],
    patterns: [{ id: "pat-1", name: "Pat 1", stepCount: 16, steps: {} } as unknown as SynthProject["patterns"][number]],
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
    } as unknown as SynthProject["mixer"],
    humanizer: { global: {} as SynthProject["humanizer"]["global"] },
    automation: { lanes: [], stepCount: 16 as const },
    audioTracks: [],
    scripts: [],
    ...overrides,
  };
}

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// ─── (1) projectId.ts Pure-fn ────────────────────────────────────────────────

describe("v3.58.0 – projectId.ts Pure-fn", () => {
  it("generateProjectId liefert wohlgeformte UUID v4", () => {
    const id = generateProjectId();
    expect(id).toMatch(UUID_V4_REGEX);
    expect(id.length).toBe(36);
  });

  it("isValidProjectId akzeptiert generated IDs", () => {
    const id = generateProjectId();
    expect(isValidProjectId(id)).toBe(true);
  });

  it("isValidProjectId lehnt non-string + non-UUID ab", () => {
    expect(isValidProjectId(undefined)).toBe(false);
    expect(isValidProjectId(null)).toBe(false);
    expect(isValidProjectId(42)).toBe(false);
    expect(isValidProjectId("")).toBe(false);
    expect(isValidProjectId("not-a-uuid")).toBe(false);
    expect(isValidProjectId("default")).toBe(false);
    expect(isValidProjectId("my-project-slug")).toBe(false);
    // UUID v1 (zeitbasiert) → reject (wir wollen v4)
    expect(isValidProjectId("550e8400-e29b-11d4-a716-446655440000")).toBe(false);
  });

  it("ensureProjectId gibt valide ID 1:1 zurück", () => {
    const id = generateProjectId();
    expect(ensureProjectId(id)).toBe(id);
  });

  it("ensureProjectId regeneriert bei invalid input", () => {
    expect(ensureProjectId(undefined)).toMatch(UUID_V4_REGEX);
    expect(ensureProjectId(null)).toMatch(UUID_V4_REGEX);
    expect(ensureProjectId("")).toMatch(UUID_V4_REGEX);
    expect(ensureProjectId("foo")).toMatch(UUID_V4_REGEX);
    expect(ensureProjectId(123)).toMatch(UUID_V4_REGEX);
  });

  it("generateProjectId ist nicht-deterministisch (keine Kollisionen in 100 calls)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(generateProjectId());
    expect(seen.size).toBe(100);
  });
});

// ─── (2) projectSerializer Schema v1.24 ──────────────────────────────────────

describe("v3.58.0 – projectSerializer Schema v1.24", () => {
  it("SYNTH_FILE_VERSION = '1.32'", () => {
    // v3.79.0 bumped to 1.32 (Sub-Mix-Buses). v1.24/…/1.31-Files laden weiterhin.
    expect(SYNTH_FILE_VERSION).toBe("1.33");
  });

  it("serializeProject übernimmt mitgegebene projectId", () => {
    const id = generateProjectId();
    const result = serializeProject({ ...makeBaseInput(), projectId: id });
    expect(result.projectId).toBe(id);
    expect(result.version).toBe("1.33");
  });

  it("serializeProject auto-generiert projectId wenn fehlt", () => {
    const result = serializeProject(makeBaseInput());
    expect(isValidProjectId(result.projectId)).toBe(true);
  });

  it("parseProject auto-generiert projectId bei pre-v1.24-Files (kein projectId-Feld)", () => {
    // v1.23-File ohne projectId-Feld
    const v123 = {
      version: "1.23",
      projectName: "Old Project",
      savedAt: "2024-01-01T00:00:00Z",
      bpm: 120,
      samples: [],
      patterns: [{ id: "p1" }],
      activePatternId: "p1",
      song: { slots: [], songModeActive: false, loopSong: false },
      mixer: { masterVolume: 1, channels: [], returnTracks: [], insertChains: {}, eq16: {}, sidechains: {}, transientShapers: {} },
      humanizer: { global: {} },
      automation: { lanes: [], stepCount: 16 },
    };
    const parsed = parseProject(JSON.stringify(v123));
    expect(isValidProjectId(parsed.projectId)).toBe(true);
  });

  it("parseProject preserves valide projectId bei v1.24-Files", () => {
    const id = generateProjectId();
    const input = serializeProject({ ...makeBaseInput(), projectId: id });
    const parsed = parseProject(toJson(input));
    expect(parsed.projectId).toBe(id);
  });

  it("parseProject regeneriert bei invalider projectId (defensive)", () => {
    const malformed = {
      version: "1.24",
      projectId: "not-a-uuid-just-junk",
      projectName: "X",
      savedAt: "2024-01-01T00:00:00Z",
      bpm: 120,
      samples: [],
      patterns: [{ id: "p1" }],
      activePatternId: "p1",
      song: { slots: [], songModeActive: false, loopSong: false },
      mixer: { masterVolume: 1, channels: [], returnTracks: [], insertChains: {}, eq16: {}, sidechains: {}, transientShapers: {} },
      humanizer: { global: {} },
      automation: { lanes: [], stepCount: 16 },
    };
    const parsed = parseProject(JSON.stringify(malformed));
    expect(parsed.projectId).not.toBe("not-a-uuid-just-junk");
    expect(isValidProjectId(parsed.projectId)).toBe(true);
  });

  it("Round-Trip: serialize → parse → projectId bleibt identisch", () => {
    const id = generateProjectId();
    const ser = serializeProject({ ...makeBaseInput(), projectId: id });
    const json = toJson(ser);
    const parsed = parseProject(json);
    expect(parsed.projectId).toBe(id);
    expect(parsed.projectName).toBe("Test Project");
  });

  it("Rename-Szenario: projectName ändert sich, projectId bleibt stable", () => {
    const id = generateProjectId();
    const before = serializeProject({
      ...makeBaseInput({ projectName: "Original" }),
      projectId: id,
    });
    // User benennt um, neuer Save mit derselben projectId
    const after = serializeProject({
      ...makeBaseInput({ projectName: "Renamed To Something Else" }),
      projectId: before.projectId,
    });
    expect(after.projectId).toBe(id);
    expect(before.projectId).toBe(after.projectId);
    expect(before.projectName).not.toBe(after.projectName);
  });

  it("AutoSave nutzt projectId statt name-slug — Round-Trip-Test", () => {
    // Simuliere: ein File mit projectName="My Beat" + stable UUID. Selbst
    // wenn der User es zu "Renamed!" macht, ist die projectId weiter die
    // gleiche UUID — AutoSave-History bleibt erreichbar.
    const id = generateProjectId();
    const fileV1 = serializeProject({
      ...makeBaseInput({ projectName: "My Beat" }),
      projectId: id,
    });
    const reloaded = parseProject(toJson(fileV1));
    expect(reloaded.projectId).toBe(id);
    // Slug aus altem Namen würde "my-beat" sein, neuer wäre "renamed".
    // Die echte projectId bleibt aber unabhängig davon konstant.
    const fileV2 = serializeProject({
      ...makeBaseInput({ projectName: "Renamed!" }),
      projectId: reloaded.projectId,
    });
    expect(fileV2.projectId).toBe(id);
  });
});

// ─── (3) AutoSave-Engine-Kompat ──────────────────────────────────────────────

describe("v3.58.0 – sanitizeProjectId akzeptiert UUID-v4", () => {
  it("UUID v4 passt durch sanitizeProjectId (Whitelist alphanum + - + _, ≤64 chars)", () => {
    const id = generateProjectId();
    expect(id.length).toBeLessThanOrEqual(64);
    expect(sanitizeProjectId(id)).toBe(id);
  });

  it("100 generierte UUIDs validieren alle gegen die AutoSave-Whitelist", () => {
    for (let i = 0; i < 100; i++) {
      const id = generateProjectId();
      expect(sanitizeProjectId(id)).toBe(id);
    }
  });
});

// ─── (4) Legacy-Slug-Migration ───────────────────────────────────────────────

describe("v3.58.0 – checkLegacySlugMigration", () => {
  it("kein Prompt wenn keine Legacy-Versionen existieren", () => {
    const r = checkLegacySlugMigration(0, 0, "My Project");
    expect(r.shouldPrompt).toBe(false);
    expect(r.reason).toBe("no-legacy");
  });

  it("kein Prompt wenn UUID-projectId schon AutoSaves hat", () => {
    const r = checkLegacySlugMigration(5, 3, "My Project");
    expect(r.shouldPrompt).toBe(false);
    expect(r.reason).toBe("uuid-has-history");
    expect(r.legacyCount).toBe(5);
  });

  it("Prompt wenn Legacy>0 und UUID=0 (typischer Erst-Migrations-Fall)", () => {
    const r = checkLegacySlugMigration(7, 0, "My Beat 2024");
    expect(r.shouldPrompt).toBe(true);
    expect(r.reason).toBe("migrate");
    expect(r.legacyCount).toBe(7);
    expect(r.legacySlug).toBe("my-beat-2024");
  });
});

// ─── (5) v3.60.0 makeDefaultState Cache + Post-Restore-Reset ─────────────────

import {
  __makeDefaultStateForTests,
} from "../../client/src/store/useProjectStore";
import {
  cacheLastProjectId,
  readLastProjectId,
  LAST_PROJECT_ID_STORAGE_KEY,
} from "../../client/src/utils/autoSaveController";
import {
  resetAutoSaveLastSaveAt,
  markAutoSaveCompleted,
  getAutoSaveSettings,
  __resetAutoSaveStoreForTests,
} from "../../client/src/store/useAutoSaveStore";

describe("v3.60.0 – makeDefaultState liest projectId-Cache", () => {
  beforeEach(() => {
    localStorageMock.clear();
    __resetAutoSaveStoreForTests();
  });

  it("makeDefaultState reads readLastProjectId wenn cached vorhanden", () => {
    // Cache eine valide UUID
    const cached = generateProjectId();
    cacheLastProjectId(cached);
    expect(readLastProjectId()).toBe(cached);
    // Hook-Init-Pfad (forceFresh nicht gesetzt) → nutzt Cache
    const state = __makeDefaultStateForTests();
    expect(state.projectId).toBe(cached);
  });

  it("makeDefaultState ignoriert leeren Cache und generiert frische UUID", () => {
    // Kein Cache → fallback auf generateProjectId()
    expect(readLastProjectId()).toBeNull();
    const state = __makeDefaultStateForTests();
    expect(isValidProjectId(state.projectId)).toBe(true);
    expect(state.projectId.length).toBe(36);
  });

  it("makeDefaultState mit invalider gecachter ID → frische UUID (defensive)", () => {
    // Korrumpiere den Cache mit einer non-UUID
    localStorageMock.setItem(LAST_PROJECT_ID_STORAGE_KEY, "not-a-valid-uuid");
    const state = __makeDefaultStateForTests();
    expect(state.projectId).not.toBe("not-a-valid-uuid");
    expect(isValidProjectId(state.projectId)).toBe(true);
  });

  it("newProject ignoriert cached projectId (forceFresh=true)", () => {
    // User klickt New Project — soll IMMER eine frische UUID bekommen,
    // auch wenn vorher eine valide ID gecacht war.
    const cached = generateProjectId();
    cacheLastProjectId(cached);
    const state = __makeDefaultStateForTests({ forceFresh: true });
    expect(state.projectId).not.toBe(cached);
    expect(isValidProjectId(state.projectId)).toBe(true);
  });

  it("makeDefaultState liefert konsistente Default-Felder (kein Side-Effect auf Cache)", () => {
    const cached = generateProjectId();
    cacheLastProjectId(cached);
    const a = __makeDefaultStateForTests();
    const b = __makeDefaultStateForTests();
    // Beide laden dieselbe gecachte ID
    expect(a.projectId).toBe(cached);
    expect(b.projectId).toBe(cached);
    expect(a.projectName).toBe("Neues Projekt");
    expect(a.bpm).toBe(120);
    expect(a.samples).toEqual([]);
    expect(a.isDirty).toBe(false);
  });
});

describe("v3.60.0 – resetAutoSaveLastSaveAt (Post-Restore)", () => {
  beforeEach(() => {
    localStorageMock.clear();
    __resetAutoSaveStoreForTests();
  });

  it("restoreProject resets lastSaveAt — markAutoSaveCompleted → resetAutoSaveLastSaveAt → null", () => {
    // Simuliere: User hat schon ein AutoSave gehabt (lastSaveAt != null)
    markAutoSaveCompleted(1700000000000);
    expect(getAutoSaveSettings().lastSaveAt).toBe(1700000000000);
    // Dann lädt er ein Projekt → lastSaveAt soll auf null gehen
    resetAutoSaveLastSaveAt();
    expect(getAutoSaveSettings().lastSaveAt).toBeNull();
  });

  it("resetAutoSaveLastSaveAt erhält andere Settings (enabled, intervalMin)", () => {
    markAutoSaveCompleted(123456);
    const before = getAutoSaveSettings();
    resetAutoSaveLastSaveAt();
    const after = getAutoSaveSettings();
    expect(after.lastSaveAt).toBeNull();
    expect(after.enabled).toBe(before.enabled);
    expect(after.intervalMin).toBe(before.intervalMin);
  });

  it("resetAutoSaveLastSaveAt idempotent bei bereits null", () => {
    // Default ist lastSaveAt=null — Reset soll trotzdem nicht crashen
    expect(getAutoSaveSettings().lastSaveAt).toBeNull();
    expect(() => resetAutoSaveLastSaveAt()).not.toThrow();
    expect(getAutoSaveSettings().lastSaveAt).toBeNull();
  });
});
