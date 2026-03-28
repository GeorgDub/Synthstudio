/**
 * Synthstudio – AppStore Unit-Tests (Testing-Agent)
 *
 * Testet die AppStore-Klasse aus electron/store.ts vollständig.
 * Kein Electron-Import – reine Node.js-Logik mit fs-Mocking.
 *
 * Abgedeckte Bereiche:
 * - Initialisierung (Standardwerte, Laden aus Datei)
 * - get() / set() für alle Store-Schlüssel
 * - addRecentProject() inkl. Deduplizierung und MAX_RECENT-Limit
 * - removeRecentProject()
 * - clearRecentProjects()
 * - saveWindowBounds()
 * - getStorePath()
 * - Fehlerbehandlung (korrupte JSON-Datei, Schreib-Fehler)
 *
 * Ausführen: pnpm test
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ─── Kein Electron-Import! ────────────────────────────────────────────────────
// AppStore importiert nur fs und path – keine Electron-Abhängigkeiten.
import { AppStore } from "../../electron/store";

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────

/** Erstellt ein temporäres Verzeichnis für jeden Test */
function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "synthstudio-store-test-"));
}

/** Löscht ein Verzeichnis rekursiv */
function removeTempDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignorieren
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AppStore – Initialisierung", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it("erstellt Store mit Standardwerten wenn keine Datei existiert", () => {
    const store = new AppStore(tempDir);
    expect(store.get("theme")).toBe("dark");
    expect(store.get("recentProjects")).toEqual([]);
    expect(store.get("lastImportPath")).toBe("");
    expect(store.get("version")).toBe(1);
  });

  it("erstellt synthstudio-store.json im userData-Verzeichnis", () => {
    const store = new AppStore(tempDir);
    // Trigger save durch set()
    store.set("theme", "light");
    const storePath = path.join(tempDir, "synthstudio-store.json");
    expect(fs.existsSync(storePath)).toBe(true);
  });

  it("getStorePath() gibt korrekten Pfad zurück", () => {
    const store = new AppStore(tempDir);
    expect(store.getStorePath()).toBe(path.join(tempDir, "synthstudio-store.json"));
  });

  it("lädt vorhandene Daten aus JSON-Datei", () => {
    const storePath = path.join(tempDir, "synthstudio-store.json");
    const testData = {
      recentProjects: [{ filePath: "/test.esx1", name: "test", lastOpened: "2025-01-01T00:00:00Z" }],
      windowBounds: { width: 1920, height: 1080, isMaximized: true },
      theme: "light",
      lastImportPath: "/samples",
      version: 1,
    };
    fs.writeFileSync(storePath, JSON.stringify(testData), "utf-8");

    const store = new AppStore(tempDir);
    expect(store.get("theme")).toBe("light");
    expect(store.get("lastImportPath")).toBe("/samples");
    expect(store.get("recentProjects")).toHaveLength(1);
    expect(store.get("windowBounds").width).toBe(1920);
  });

  it("fällt auf Standardwerte zurück bei korrupter JSON-Datei", () => {
    const storePath = path.join(tempDir, "synthstudio-store.json");
    fs.writeFileSync(storePath, "{ ungültiges JSON !!!", "utf-8");

    const store = new AppStore(tempDir);
    // BUG-002: Korrupte JSON-Datei sollte Standardwerte liefern, nicht crashen
    expect(store.get("theme")).toBe("dark");
    expect(store.get("recentProjects")).toEqual([]);
  });

  it("merged windowBounds mit Standardwerten bei partiellen Daten", () => {
    const storePath = path.join(tempDir, "synthstudio-store.json");
    // Nur width gespeichert, height fehlt
    fs.writeFileSync(storePath, JSON.stringify({ windowBounds: { width: 800 } }), "utf-8");

    const store = new AppStore(tempDir);
    // Fehlende Werte werden aus DEFAULT übernommen
    expect(store.get("windowBounds").width).toBe(800);
    expect(store.get("windowBounds").height).toBe(900); // DEFAULT
    expect(store.get("windowBounds").isMaximized).toBe(false); // DEFAULT
  });
});

// ─── get() / set() ────────────────────────────────────────────────────────────

describe("AppStore – get() und set()", () => {
  let tempDir: string;
  let store: AppStore;

  beforeEach(() => {
    tempDir = createTempDir();
    store = new AppStore(tempDir);
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it("set('theme', 'light') speichert und get() liest zurück", () => {
    store.set("theme", "light");
    expect(store.get("theme")).toBe("light");
  });

  it("set('lastImportPath', ...) speichert Pfad korrekt", () => {
    store.set("lastImportPath", "/home/user/samples");
    expect(store.get("lastImportPath")).toBe("/home/user/samples");
  });

  it("set() persistiert Daten in JSON-Datei", () => {
    store.set("theme", "light");
    const storePath = path.join(tempDir, "synthstudio-store.json");
    const raw = fs.readFileSync(storePath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.theme).toBe("light");
  });

  it("Neuer Store-Instanz liest persistierte Daten", () => {
    store.set("theme", "light");
    store.set("lastImportPath", "/my/samples");

    // Neue Instanz auf demselben Verzeichnis
    const store2 = new AppStore(tempDir);
    expect(store2.get("theme")).toBe("light");
    expect(store2.get("lastImportPath")).toBe("/my/samples");
  });

  it("set('windowBounds', ...) speichert vollständige Bounds", () => {
    const bounds = { width: 1280, height: 720, isMaximized: false, x: 100, y: 50 };
    store.set("windowBounds", bounds);
    const retrieved = store.get("windowBounds");
    expect(retrieved.width).toBe(1280);
    expect(retrieved.height).toBe(720);
    expect(retrieved.x).toBe(100);
    expect(retrieved.y).toBe(50);
  });
});

// ─── saveWindowBounds() ───────────────────────────────────────────────────────

describe("AppStore – saveWindowBounds()", () => {
  let tempDir: string;
  let store: AppStore;

  beforeEach(() => {
    tempDir = createTempDir();
    store = new AppStore(tempDir);
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it("speichert Fenster-Bounds korrekt", () => {
    store.saveWindowBounds({ width: 1600, height: 900, isMaximized: true });
    expect(store.get("windowBounds").width).toBe(1600);
    expect(store.get("windowBounds").isMaximized).toBe(true);
  });

  it("speichert optionale x/y-Koordinaten", () => {
    store.saveWindowBounds({ width: 1024, height: 768, isMaximized: false, x: 200, y: 100 });
    expect(store.get("windowBounds").x).toBe(200);
    expect(store.get("windowBounds").y).toBe(100);
  });
});

// ─── addRecentProject() ───────────────────────────────────────────────────────

describe("AppStore – addRecentProject()", () => {
  let tempDir: string;
  let store: AppStore;

  beforeEach(() => {
    tempDir = createTempDir();
    store = new AppStore(tempDir);
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it("fügt ein Projekt zur leeren Liste hinzu", () => {
    store.addRecentProject("/projects/my-project.esx1");
    const recent = store.getRecentProjects();
    expect(recent).toHaveLength(1);
    expect(recent[0].filePath).toBe("/projects/my-project.esx1");
    expect(recent[0].name).toBe("my-project");
  });

  it("extrahiert Name korrekt aus Pfad (ohne Erweiterung)", () => {
    store.addRecentProject("/samples/drum-kit.esx1");
    expect(store.getRecentProjects()[0].name).toBe("drum-kit");
  });

  it("setzt lastOpened als gültiges ISO-8601-Datum", () => {
    store.addRecentProject("/test.esx1");
    const lastOpened = store.getRecentProjects()[0].lastOpened;
    expect(() => new Date(lastOpened)).not.toThrow();
    expect(new Date(lastOpened).toISOString()).toBe(lastOpened);
  });

  it("neuestes Projekt steht an erster Stelle", () => {
    store.addRecentProject("/projects/old.esx1");
    store.addRecentProject("/projects/new.esx1");
    const recent = store.getRecentProjects();
    expect(recent[0].filePath).toBe("/projects/new.esx1");
    expect(recent[1].filePath).toBe("/projects/old.esx1");
  });

  it("entfernt Duplikate (selber Pfad wird nach oben verschoben)", () => {
    store.addRecentProject("/projects/project.esx1");
    store.addRecentProject("/projects/other.esx1");
    store.addRecentProject("/projects/project.esx1"); // Duplikat

    const recent = store.getRecentProjects();
    expect(recent).toHaveLength(2);
    expect(recent[0].filePath).toBe("/projects/project.esx1");
  });

  it("begrenzt Liste auf 10 Einträge (MAX_RECENT)", () => {
    for (let i = 0; i < 12; i++) {
      store.addRecentProject(`/projects/project-${i}.esx1`);
    }
    expect(store.getRecentProjects()).toHaveLength(10);
  });

  it("behält die neuesten 10 Projekte bei Überschreitung", () => {
    for (let i = 0; i < 12; i++) {
      store.addRecentProject(`/projects/project-${i}.esx1`);
    }
    const recent = store.getRecentProjects();
    // Neueste (11, 10, 9, ..., 2) – project-0 und project-1 fallen raus
    expect(recent[0].filePath).toBe("/projects/project-11.esx1");
    expect(recent[9].filePath).toBe("/projects/project-2.esx1");
  });

  it("persistiert neue Projekte in JSON-Datei", () => {
    store.addRecentProject("/projects/saved.esx1");
    const store2 = new AppStore(tempDir);
    expect(store2.getRecentProjects()[0].filePath).toBe("/projects/saved.esx1");
  });
});

// ─── removeRecentProject() ────────────────────────────────────────────────────

describe("AppStore – removeRecentProject()", () => {
  let tempDir: string;
  let store: AppStore;

  beforeEach(() => {
    tempDir = createTempDir();
    store = new AppStore(tempDir);
    store.addRecentProject("/projects/a.esx1");
    store.addRecentProject("/projects/b.esx1");
    store.addRecentProject("/projects/c.esx1");
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it("entfernt ein vorhandenes Projekt", () => {
    store.removeRecentProject("/projects/b.esx1");
    const recent = store.getRecentProjects();
    expect(recent).toHaveLength(2);
    expect(recent.map((p) => p.filePath)).not.toContain("/projects/b.esx1");
  });

  it("ignoriert nicht-vorhandene Pfade ohne Fehler", () => {
    expect(() => store.removeRecentProject("/nonexistent.esx1")).not.toThrow();
    expect(store.getRecentProjects()).toHaveLength(3);
  });

  it("persistiert Änderungen nach Entfernen", () => {
    store.removeRecentProject("/projects/a.esx1");
    const store2 = new AppStore(tempDir);
    expect(store2.getRecentProjects().map((p) => p.filePath)).not.toContain("/projects/a.esx1");
  });
});

// ─── clearRecentProjects() ────────────────────────────────────────────────────

describe("AppStore – clearRecentProjects()", () => {
  let tempDir: string;
  let store: AppStore;

  beforeEach(() => {
    tempDir = createTempDir();
    store = new AppStore(tempDir);
    store.addRecentProject("/projects/a.esx1");
    store.addRecentProject("/projects/b.esx1");
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it("löscht alle Projekte", () => {
    store.clearRecentProjects();
    expect(store.getRecentProjects()).toHaveLength(0);
  });

  it("persistiert leere Liste nach clearRecentProjects()", () => {
    store.clearRecentProjects();
    const store2 = new AppStore(tempDir);
    expect(store2.getRecentProjects()).toHaveLength(0);
  });

  it("clearRecentProjects() auf leerer Liste wirft keinen Fehler", () => {
    store.clearRecentProjects();
    expect(() => store.clearRecentProjects()).not.toThrow();
  });
});

// ─── Fehlerbehandlung ─────────────────────────────────────────────────────────

describe("AppStore – Fehlerbehandlung", () => {
  it("fällt auf Standardwerte zurück wenn storePath nicht lesbar ist", () => {
    // Nicht-existentes Verzeichnis → existsSync gibt false zurück → DEFAULT
    const store = new AppStore("/nonexistent/path/that/does/not/exist");
    expect(store.get("theme")).toBe("dark");
    expect(store.get("recentProjects")).toEqual([]);
  });

  it("wirft keinen Fehler wenn save() fehlschlägt (Verzeichnis schreibgeschützt)", () => {
    const tempDir = createTempDir();
    const store = new AppStore(tempDir);

    // Datei schreibgeschützt machen
    const storePath = path.join(tempDir, "synthstudio-store.json");
    store.set("theme", "dark"); // Erst speichern damit Datei existiert
    fs.chmodSync(storePath, 0o444); // Nur-Lesen

    // set() sollte keinen Fehler werfen (intern try/catch)
    expect(() => store.set("theme", "light")).not.toThrow();

    fs.chmodSync(storePath, 0o644); // Wieder beschreibbar
    removeTempDir(tempDir);
  });
});
