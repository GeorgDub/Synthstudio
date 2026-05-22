/**
 * tests/features/clean-release-script.test.ts — TASK-244 Regression-Test.
 *
 * Verifiziert das scripts/clean-release.cjs Pre-Build-Cleanup-Skript:
 *  - Loescht NUR EXE/blockmap der AKTUELLEN package.json-Version
 *  - LAESST alte Versionen unberuehrt (User-Werkzeug zum Vergleichen)
 *  - Loescht NSIS-Pre-Intermediate-Files
 *  - Ist idempotent (zweiter Aufruf = no-op)
 *  - Verarbeitet fehlendes release/ ohne Fehler
 *
 * Test-Strategie: schreibt Dummy-Dateien in einen tmp-Dir, ruft das exportierte
 * `cleanReleaseForVersion()` auf, verifiziert deleted/preserved.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// CJS-Modul-Import via require (Vitest unterstuetzt das im Node-Env).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { cleanReleaseForVersion } = require("../../scripts/clean-release.cjs");

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clean-release-test-"));
});

afterEach(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* tmp leak on Windows possible — ignored */
  }
});

function writeDummy(relPath: string, content = "dummy"): string {
  const full = path.join(tmpRoot, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

describe("clean-release.cjs — cleanReleaseForVersion", () => {
  it("loescht EXE der aktuellen Version", () => {
    writeDummy("Synthstudio Setup 3.234.0.exe");
    const result = cleanReleaseForVersion(tmpRoot, "3.234.0");
    expect(result.deleted).toContain("Synthstudio Setup 3.234.0.exe");
    expect(fs.existsSync(path.join(tmpRoot, "Synthstudio Setup 3.234.0.exe"))).toBe(false);
  });

  it("loescht .blockmap der aktuellen Version", () => {
    writeDummy("Synthstudio Setup 3.234.0.exe.blockmap");
    const result = cleanReleaseForVersion(tmpRoot, "3.234.0");
    expect(result.deleted).toContain("Synthstudio Setup 3.234.0.exe.blockmap");
    expect(fs.existsSync(path.join(tmpRoot, "Synthstudio Setup 3.234.0.exe.blockmap"))).toBe(false);
  });

  it("loescht KEINE alten Versionen", () => {
    writeDummy("Synthstudio Setup 3.100.0.exe");
    writeDummy("Synthstudio Setup 3.200.0.exe");
    writeDummy("Synthstudio Setup 3.234.0.exe");
    const result = cleanReleaseForVersion(tmpRoot, "3.234.0");
    expect(result.deleted).toEqual(["Synthstudio Setup 3.234.0.exe"]);
    // Alte Versionen bleiben:
    expect(fs.existsSync(path.join(tmpRoot, "Synthstudio Setup 3.100.0.exe"))).toBe(true);
    expect(fs.existsSync(path.join(tmpRoot, "Synthstudio Setup 3.200.0.exe"))).toBe(true);
  });

  it("loescht NSIS-Pre-Uninstaller-Intermediate (Wildcard-Pattern)", () => {
    writeDummy("__uninstaller-NSIS-3.08-Synthstudio.exe");
    writeDummy("__uninstaller-NSIS-3.09-Synthstudio.exe");
    const result = cleanReleaseForVersion(tmpRoot, "3.234.0");
    expect(result.deleted).toContain("__uninstaller-NSIS-3.08-Synthstudio.exe");
    expect(result.deleted).toContain("__uninstaller-NSIS-3.09-Synthstudio.exe");
  });

  it("loescht .__uninstaller.exe falls vorhanden", () => {
    writeDummy(".__uninstaller.exe");
    const result = cleanReleaseForVersion(tmpRoot, "3.234.0");
    expect(result.deleted).toContain(".__uninstaller.exe");
  });

  it("ignoriert unrelated Files (latest.yml, packs/, etc.)", () => {
    writeDummy("latest.yml");
    writeDummy("Synthstudio-3.234.0-mac.zip");
    writeDummy("Synthstudio-3.234.0.dmg");
    const result = cleanReleaseForVersion(tmpRoot, "3.234.0");
    expect(result.deleted).toEqual([]);
    expect(fs.existsSync(path.join(tmpRoot, "latest.yml"))).toBe(true);
    expect(fs.existsSync(path.join(tmpRoot, "Synthstudio-3.234.0.dmg"))).toBe(true);
  });

  it("ist idempotent (zweiter Aufruf = no-op)", () => {
    writeDummy("Synthstudio Setup 3.234.0.exe");
    const first = cleanReleaseForVersion(tmpRoot, "3.234.0");
    const second = cleanReleaseForVersion(tmpRoot, "3.234.0");
    expect(first.deleted.length).toBeGreaterThan(0);
    expect(second.deleted).toEqual([]);
  });

  it("toleriert fehlendes release/-Directory", () => {
    const missing = path.join(tmpRoot, "doesnt-exist");
    const result = cleanReleaseForVersion(missing, "3.234.0");
    expect(result.deleted).toEqual([]);
    expect(result.note).toContain("existiert noch nicht");
  });

  it("toleriert leeres release/-Directory", () => {
    const result = cleanReleaseForVersion(tmpRoot, "3.234.0");
    expect(result.deleted).toEqual([]);
  });

  it("unterscheidet Versions-Subset-Strings (3.23.0 vs 3.234.0)", () => {
    writeDummy("Synthstudio Setup 3.23.0.exe");   // alte Version mit prefix-match-Risiko
    writeDummy("Synthstudio Setup 3.234.0.exe");  // current
    const result = cleanReleaseForVersion(tmpRoot, "3.234.0");
    expect(result.deleted).toEqual(["Synthstudio Setup 3.234.0.exe"]);
    expect(fs.existsSync(path.join(tmpRoot, "Synthstudio Setup 3.23.0.exe"))).toBe(true);
  });
});
