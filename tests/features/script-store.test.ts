/**
 * tests/features/script-store.test.ts
 *
 * Unit-Tests für useScriptStore + projectSerializer-Integration (v1.16).
 *
 * Abgedeckt:
 *  - addScript happy path → returnt sc-prefix id
 *  - addScript mit zu großem Code → throws
 *  - addScript über das Limit (>64) → throws
 *  - removeScript / updateScript happy paths
 *  - getProjectScripts / getAppScripts filtern korrekt nach scope
 *  - loadProjectScripts replaced project-scope, app-scope bleibt
 *  - disableAllForeignProject erzwingt enabled:false auf project-scope
 *  - Persistierung: scope:app → localStorage round-trip
 *  - Persistierung: scope:project NICHT in localStorage
 *  - validateScript edge cases (empty name, big code, invalid KeyCombo,
 *    invalid macroIdx)
 *  - findScriptByKeyCombo: Modifier strict-match
 *  - findScriptByMacroIndex: korrekter idx-Match
 *  - Serializer round-trip: store → serialize → parse → loadProjectScripts
 *  - Migration: v1.15-File ohne scripts → []
 *  - Foreign-load: enabled=true im File → geparste Scripts haben enabled=false
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

if (typeof (globalThis as { window?: unknown }).window === "undefined") {
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: localStorageMock },
    writable: true,
    configurable: true,
  });
}

import {
  addScript,
  removeScript,
  updateScript,
  getScript,
  getAllScripts,
  getProjectScripts,
  getAppScripts,
  loadProjectScripts,
  clearProjectScripts,
  disableAllForeignProject,
  validateScript,
  isValidScriptEntry,
  findScriptByKeyCombo,
  findScriptByMacroIndex,
  __resetForTests,
  MAX_SCRIPTS,
  MAX_SCRIPT_CODE_BYTES,
  DEFAULT_MAX_RUNTIME_MS,
  type Script,
  type KeyCombo,
} from "../../client/src/store/useScriptStore";

import {
  serializeProject,
  parseProject,
  toJson,
  SYNTH_FILE_VERSION,
  type SynthProject,
} from "../../client/src/utils/projectSerializer";

const STORAGE_KEY = "ss-scripts:v1";

// ─── Test-Daten ───────────────────────────────────────────────────────────────

function makeScriptInput(
  overrides: Partial<Omit<Script, "id" | "createdAt" | "updatedAt">> = {},
): Omit<Script, "id" | "createdAt" | "updatedAt"> {
  return {
    name: "My Script",
    code: 'console.log("hi")',
    scope: "app",
    enabled: true,
    maxRuntimeMs: DEFAULT_MAX_RUNTIME_MS,
    ...overrides,
  };
}

function makeFullScript(overrides: Partial<Script> = {}): Script {
  const now = Date.now();
  return {
    id: `sc-${now}-aaa111`,
    name: "Full",
    code: 'ss.bpm(120)',
    scope: "project",
    enabled: true,
    createdAt: now,
    updatedAt: now,
    maxRuntimeMs: DEFAULT_MAX_RUNTIME_MS,
    ...overrides,
  };
}

function makeBaseProject(
  scripts?: Script[],
): Omit<SynthProject, "version" | "savedAt"> {
  return {
    projectName: "Test Project",
    bpm: 120,
    samples: [],
    patterns: [
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
    audioTracks: [],
    ...(scripts !== undefined ? { scripts } : {}),
  };
}

// ─── Test-Suite: Konstanten/Exports ──────────────────────────────────────────

describe("useScriptStore – Konstanten/Exports", () => {
  beforeEach(() => {
    __resetForTests();
    localStorageMock.clear();
  });

  it("exportiert MAX_SCRIPTS = 64 und MAX_SCRIPT_CODE_BYTES = 10000", () => {
    expect(MAX_SCRIPTS).toBe(64);
    expect(MAX_SCRIPT_CODE_BYTES).toBe(10_000);
    expect(DEFAULT_MAX_RUNTIME_MS).toBe(5000);
  });
});

// ─── Test-Suite: addScript ───────────────────────────────────────────────────

describe("useScriptStore – addScript", () => {
  beforeEach(() => {
    __resetForTests();
    localStorageMock.clear();
  });

  it("addScript happy path returnt ID mit 'sc-' Prefix", () => {
    const id = addScript(makeScriptInput());
    expect(typeof id).toBe("string");
    expect(id.startsWith("sc-")).toBe(true);
    const all = getAllScripts();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(id);
    expect(all[0].name).toBe("My Script");
    // createdAt + updatedAt sind gesetzt
    expect(typeof all[0].createdAt).toBe("number");
    expect(typeof all[0].updatedAt).toBe("number");
  });

  it("addScript mit Code > 10KB wirft Fehler", () => {
    const huge = "x".repeat(MAX_SCRIPT_CODE_BYTES + 1);
    expect(() =>
      addScript(makeScriptInput({ code: huge })),
    ).toThrow(/code exceeds maximum size/);
    expect(getAllScripts()).toHaveLength(0);
  });

  it("addScript für 65. Script wirft Fehler", () => {
    for (let i = 0; i < MAX_SCRIPTS; i++) {
      addScript(makeScriptInput({ name: `S${i}` }));
    }
    expect(getAllScripts()).toHaveLength(MAX_SCRIPTS);
    expect(() => addScript(makeScriptInput({ name: "overflow" }))).toThrow(
      /Maximum number of scripts reached/,
    );
    expect(getAllScripts()).toHaveLength(MAX_SCRIPTS);
  });

  it("addScript mit leerem Namen wirft Fehler", () => {
    expect(() =>
      addScript(makeScriptInput({ name: "" })),
    ).toThrow(/Invalid script/);
    expect(getAllScripts()).toHaveLength(0);
  });
});

// ─── Test-Suite: removeScript / updateScript ─────────────────────────────────

describe("useScriptStore – remove / update", () => {
  beforeEach(() => {
    __resetForTests();
    localStorageMock.clear();
  });

  it("removeScript entfernt das Script per ID", () => {
    const a = addScript(makeScriptInput({ name: "A" }));
    const b = addScript(makeScriptInput({ name: "B" }));
    removeScript(a);
    const remaining = getAllScripts();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(b);
    expect(getScript(a)).toBeNull();
  });

  it("removeScript mit unbekannter ID ist no-op", () => {
    addScript(makeScriptInput());
    expect(() => removeScript("sc-not-real")).not.toThrow();
    expect(getAllScripts()).toHaveLength(1);
  });

  it("updateScript patcht nur die übergebenen Felder + setzt updatedAt", async () => {
    const id = addScript(makeScriptInput({ name: "Old", enabled: true }));
    const before = getScript(id)!;
    // Kleine Pause damit Date.now() einen anderen Wert hat
    await new Promise((r) => setTimeout(r, 5));
    updateScript(id, { name: "New", enabled: false });
    const after = getScript(id)!;
    expect(after.name).toBe("New");
    expect(after.enabled).toBe(false);
    expect(after.code).toBe(before.code); // unverändert
    expect(after.id).toBe(before.id); // unverändert
    expect(after.createdAt).toBe(before.createdAt); // unverändert
    expect(after.updatedAt).toBeGreaterThanOrEqual(before.updatedAt);
  });

  it("updateScript lässt id + createdAt nicht überschreiben", () => {
    const id = addScript(makeScriptInput());
    const before = getScript(id)!;
    updateScript(id, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      id: "sc-hacked" as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createdAt: 0 as any,
    } as Partial<Omit<Script, "id" | "createdAt">>);
    const after = getScript(id)!;
    expect(after.id).toBe(id);
    expect(after.createdAt).toBe(before.createdAt);
    expect(getScript("sc-hacked")).toBeNull();
  });

  it("updateScript mit unbekannter ID ist no-op", () => {
    addScript(makeScriptInput());
    expect(() => updateScript("sc-nope", { name: "X" })).not.toThrow();
    expect(getAllScripts()[0].name).toBe("My Script");
  });

  it("updateScript rejected wenn Resultat invalid (z.B. zu langer Code)", () => {
    const id = addScript(makeScriptInput());
    const huge = "x".repeat(MAX_SCRIPT_CODE_BYTES + 1);
    updateScript(id, { code: huge });
    // Patch wurde abgelehnt – alter Code bleibt
    expect(getScript(id)!.code).toBe('console.log("hi")');
  });
});

// ─── Test-Suite: scope-Filter ────────────────────────────────────────────────

describe("useScriptStore – getProjectScripts / getAppScripts", () => {
  beforeEach(() => {
    __resetForTests();
    localStorageMock.clear();
  });

  it("getAppScripts liefert nur scope:'app' Items", () => {
    addScript(makeScriptInput({ scope: "app", name: "A1" }));
    addScript(makeScriptInput({ scope: "project", name: "P1" }));
    addScript(makeScriptInput({ scope: "app", name: "A2" }));
    const app = getAppScripts();
    expect(app).toHaveLength(2);
    expect(app.every((s) => s.scope === "app")).toBe(true);
    expect(app.map((s) => s.name).sort()).toEqual(["A1", "A2"]);
  });

  it("getProjectScripts liefert nur scope:'project' Items", () => {
    addScript(makeScriptInput({ scope: "app", name: "A1" }));
    addScript(makeScriptInput({ scope: "project", name: "P1" }));
    addScript(makeScriptInput({ scope: "project", name: "P2" }));
    const proj = getProjectScripts();
    expect(proj).toHaveLength(2);
    expect(proj.every((s) => s.scope === "project")).toBe(true);
    expect(proj.map((s) => s.name).sort()).toEqual(["P1", "P2"]);
  });
});

// ─── Test-Suite: loadProjectScripts / clearProjectScripts ────────────────────

describe("useScriptStore – loadProjectScripts", () => {
  beforeEach(() => {
    __resetForTests();
    localStorageMock.clear();
  });

  it("loadProjectScripts ersetzt project-scope, app-scope bleibt", () => {
    const aId = addScript(makeScriptInput({ scope: "app", name: "AppKeep" }));
    addScript(makeScriptInput({ scope: "project", name: "ProjOld" }));
    expect(getAllScripts()).toHaveLength(2);

    loadProjectScripts([
      makeFullScript({ id: "sc-1", name: "ProjNew1", scope: "project" }),
      makeFullScript({ id: "sc-2", name: "ProjNew2", scope: "project" }),
    ]);
    const all = getAllScripts();
    expect(all).toHaveLength(3); // 1 app + 2 neue project
    expect(all.find((s) => s.id === aId)?.name).toBe("AppKeep");
    expect(all.find((s) => s.id === aId)?.scope).toBe("app");
    expect(getProjectScripts().map((s) => s.name).sort()).toEqual([
      "ProjNew1",
      "ProjNew2",
    ]);
  });

  it("loadProjectScripts filtert non-project + invalide Items", () => {
    loadProjectScripts([
      makeFullScript({ id: "sc-ok", name: "OK", scope: "project" }),
      // scope:"app" → ignoriert (auch wenn valide)
      makeFullScript({ id: "sc-app", name: "Wrong", scope: "app" }),
      // invalid: leerer Name
      makeFullScript({ id: "sc-bad", name: "", scope: "project" }),
    ]);
    const proj = getProjectScripts();
    expect(proj).toHaveLength(1);
    expect(proj[0].id).toBe("sc-ok");
  });

  it("clearProjectScripts entfernt nur project-scope", () => {
    const aId = addScript(makeScriptInput({ scope: "app", name: "Keep" }));
    addScript(makeScriptInput({ scope: "project", name: "Drop" }));
    clearProjectScripts();
    const all = getAllScripts();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(aId);
  });
});

// ─── Test-Suite: disableAllForeignProject ────────────────────────────────────

describe("useScriptStore – disableAllForeignProject", () => {
  beforeEach(() => {
    __resetForTests();
    localStorageMock.clear();
  });

  it("disableAllForeignProject setzt alle project-Scripts auf enabled=false", () => {
    const appId = addScript(
      makeScriptInput({ scope: "app", name: "App", enabled: true }),
    );
    addScript(makeScriptInput({ scope: "project", name: "P1", enabled: true }));
    addScript(makeScriptInput({ scope: "project", name: "P2", enabled: true }));
    disableAllForeignProject();
    const proj = getProjectScripts();
    expect(proj.every((s) => s.enabled === false)).toBe(true);
    // App-scope bleibt unangetastet
    expect(getScript(appId)!.enabled).toBe(true);
  });
});

// ─── Test-Suite: Persistenz ──────────────────────────────────────────────────

describe("useScriptStore – Persistenz", () => {
  beforeEach(() => {
    __resetForTests();
    localStorageMock.clear();
  });

  it("addScript scope:app persistiert in localStorage (Key ss-scripts:v1)", () => {
    addScript(makeScriptInput({ scope: "app", name: "Persisted" }));
    const raw = localStorageMock.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe("Persisted");
    expect(parsed[0].scope).toBe("app");
  });

  it("addScript scope:project landet NICHT in localStorage", () => {
    addScript(makeScriptInput({ scope: "project", name: "OnlyMemory" }));
    const raw = localStorageMock.getItem(STORAGE_KEY);
    // Entweder kein Eintrag, oder leeres Array.
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(0);
    }
    // Memory-State hat das Script aber.
    expect(getProjectScripts()).toHaveLength(1);
  });

  it("Bei gemischten Scopes nur app-scope wird persistiert", () => {
    addScript(makeScriptInput({ scope: "app", name: "A" }));
    addScript(makeScriptInput({ scope: "project", name: "P" }));
    const raw = localStorageMock.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe("A");
    expect(parsed[0].scope).toBe("app");
  });
});

// ─── Test-Suite: validateScript Edge-Cases ───────────────────────────────────

describe("useScriptStore – validateScript", () => {
  it("rejected leeren Namen", () => {
    const r = validateScript(makeFullScript({ name: "" }));
    expect(r.ok).toBe(false);
    expect(r.errors.join(";")).toMatch(/name/);
  });

  it("rejected Code > 10KB", () => {
    const big = "x".repeat(MAX_SCRIPT_CODE_BYTES + 1);
    const r = validateScript(makeFullScript({ code: big }));
    expect(r.ok).toBe(false);
    expect(r.errors.join(";")).toMatch(/code exceeds/);
  });

  it("rejected KeyCombo mit leerem key", () => {
    const r = validateScript(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeFullScript({ keyBinding: { key: "" } as any }),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join(";")).toMatch(/keyBinding/);
  });

  it("rejected macroButtonIndex außerhalb 0..7", () => {
    const tooHigh = validateScript(makeFullScript({ macroButtonIndex: 8 }));
    expect(tooHigh.ok).toBe(false);
    expect(tooHigh.errors.join(";")).toMatch(/macroButtonIndex/);
    const negative = validateScript(makeFullScript({ macroButtonIndex: -1 }));
    expect(negative.ok).toBe(false);
  });

  it("akzeptiert minimal-gültiges Script", () => {
    const r = validateScript(makeFullScript());
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("isValidScriptEntry ist konsistent mit validateScript", () => {
    expect(isValidScriptEntry(makeFullScript())).toBe(true);
    expect(isValidScriptEntry({ id: "x" })).toBe(false);
    expect(isValidScriptEntry(null)).toBe(false);
    expect(isValidScriptEntry(undefined)).toBe(false);
    expect(isValidScriptEntry("string")).toBe(false);
  });
});

// ─── Test-Suite: findScriptByKeyCombo ────────────────────────────────────────

describe("useScriptStore – findScriptByKeyCombo / MacroIndex", () => {
  it("findScriptByKeyCombo: Ctrl+Shift+B findet, Shift+B nicht", () => {
    const scripts: Script[] = [
      makeFullScript({
        id: "sc-a",
        name: "A",
        keyBinding: { key: "b", ctrl: true, shift: true },
      }),
      makeFullScript({
        id: "sc-b",
        name: "B",
        keyBinding: { key: "x" },
      }),
    ];
    const ctrlShiftB: KeyCombo = { key: "b", ctrl: true, shift: true };
    const shiftB: KeyCombo = { key: "b", shift: true };
    expect(findScriptByKeyCombo(scripts, ctrlShiftB)?.id).toBe("sc-a");
    expect(findScriptByKeyCombo(scripts, shiftB)).toBeUndefined();
  });

  it("findScriptByKeyCombo: ignoriert undefined-vs-false Unterschied", () => {
    // KeyBinding hat `ctrl: undefined`, Combo hat `ctrl: false` → match.
    const scripts: Script[] = [
      makeFullScript({
        id: "sc-z",
        keyBinding: { key: "z" }, // alle modifier undefined
      }),
    ];
    const plainZ: KeyCombo = { key: "z", ctrl: false, shift: false };
    expect(findScriptByKeyCombo(scripts, plainZ)?.id).toBe("sc-z");
  });

  it("findScriptByKeyCombo: ungültige Combo (leerer key) liefert undefined", () => {
    const scripts: Script[] = [makeFullScript({ keyBinding: { key: "a" } })];
    expect(findScriptByKeyCombo(scripts, { key: "" })).toBeUndefined();
  });

  it("findScriptByMacroIndex: idx 3 findet, idx 4 nicht", () => {
    const scripts: Script[] = [
      makeFullScript({ id: "sc-m3", macroButtonIndex: 3 }),
      makeFullScript({ id: "sc-m5", macroButtonIndex: 5 }),
    ];
    expect(findScriptByMacroIndex(scripts, 3)?.id).toBe("sc-m3");
    expect(findScriptByMacroIndex(scripts, 4)).toBeUndefined();
    expect(findScriptByMacroIndex(scripts, 5)?.id).toBe("sc-m5");
  });

  it("findScriptByMacroIndex: out-of-range idx liefert undefined", () => {
    const scripts: Script[] = [makeFullScript({ macroButtonIndex: 0 })];
    expect(findScriptByMacroIndex(scripts, -1)).toBeUndefined();
    expect(findScriptByMacroIndex(scripts, 99)).toBeUndefined();
  });
});

// ─── Test-Suite: Serializer-Integration ──────────────────────────────────────

describe("projectSerializer × scripts (v1.16)", () => {
  beforeEach(() => {
    __resetForTests();
    localStorageMock.clear();
  });

  it("SYNTH_FILE_VERSION ist '1.25'", () => {
    expect(SYNTH_FILE_VERSION).toBe("1.25");
  });

  it("Round-trip: store (project-scope) → serialize → parse → loadProjectScripts", () => {
    // Setup: 1 app-Script (lokal), 2 project-Scripts (sollen in .synth wandern)
    addScript(makeScriptInput({ scope: "app", name: "AppOnly" }));
    addScript(
      makeScriptInput({
        scope: "project",
        name: "P1",
        keyBinding: { key: "p", ctrl: true },
      }),
    );
    addScript(
      makeScriptInput({
        scope: "project",
        name: "P2",
        macroButtonIndex: 3,
      }),
    );
    expect(getAllScripts()).toHaveLength(3);
    expect(getProjectScripts()).toHaveLength(2);

    const projectScripts = getProjectScripts();
    const project = serializeProject({
      ...makeBaseProject(),
      scripts: projectScripts,
    });
    const json = toJson(project);

    // Memory reset (simuliert Neustart)
    __resetForTests();
    expect(getAllScripts()).toHaveLength(0);

    const restored = parseProject(json);
    expect(restored.scripts).toHaveLength(2);
    loadProjectScripts(restored.scripts ?? []);

    const proj = getProjectScripts();
    expect(proj).toHaveLength(2);
    expect(proj.map((s) => s.name).sort()).toEqual(["P1", "P2"]);
    // Wichtigster Punkt: parseProject hat enabled auf false gezwungen.
    expect(proj.every((s) => s.enabled === false)).toBe(true);
    // KeyBinding + macroButtonIndex sind erhalten.
    expect(
      proj.find((s) => s.name === "P1")?.keyBinding,
    ).toEqual({ key: "p", ctrl: true });
    expect(proj.find((s) => s.name === "P2")?.macroButtonIndex).toBe(3);
  });

  it("Migration: v1.15 .synth ohne scripts-Feld → scripts: [] nach parse", () => {
    // Simuliere ein altes File: serialisiere und entferne dann scripts/version.
    const old = serializeProject(makeBaseProject());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (old as any).scripts;
    (old as { version: string }).version = "1.15";
    const json = JSON.stringify(old);

    const restored = parseProject(json);
    expect(restored.scripts).toEqual([]);
    // audioTracks blieb auch korrekt
    expect(restored.audioTracks).toEqual([]);
  });

  it("Foreign-load: enabled=true im File → geparste Scripts haben enabled=false", () => {
    const malicious = serializeProject({
      ...makeBaseProject(),
      scripts: [
        makeFullScript({
          id: "sc-foreign",
          name: "RunWild",
          scope: "project",
          enabled: true, // böse Datei
          code: 'while(true){}',
        }),
      ],
    });
    const json = toJson(malicious);
    const restored = parseProject(json);
    expect(restored.scripts).toHaveLength(1);
    expect(restored.scripts![0].enabled).toBe(false);
    expect(restored.scripts![0].name).toBe("RunWild");
  });

  it("Parser: scripts ist Nicht-Array → []", () => {
    const proj = serializeProject(makeBaseProject());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (proj as any).scripts = 42;
    const restored = parseProject(JSON.stringify(proj));
    expect(restored.scripts).toEqual([]);
  });

  it("Parser: filtert invalide Script-Items silent", () => {
    const proj = serializeProject({
      ...makeBaseProject(),
      scripts: [
        makeFullScript({ id: "sc-good", name: "Good", scope: "project" }),
      ],
    });
    // Ein invalides Item dazupushen (kein name)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (proj as any).scripts.push({ id: "sc-bad", code: "", scope: "project" });
    const restored = parseProject(JSON.stringify(proj));
    expect(restored.scripts).toHaveLength(1);
    expect(restored.scripts![0].id).toBe("sc-good");
  });
});
