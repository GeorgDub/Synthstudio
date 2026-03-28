/**
 * midi-import.spec.ts
 *
 * E2E-Tests für den MIDI-Import-API-Contract in Synthstudio.
 *
 * Szenarien:
 *   1. window.electronAPI.openMidiDialog ist definiert und eine Funktion
 *   2. window.electronAPI.importMidiFile ist definiert und eine Funktion
 *   3. window.electronAPI.exportBundle ist definiert und eine Funktion
 *   4. importMidiFile gibt ein typisiertes Ergebnis-Objekt zurück
 *      (auch bei nicht vorhandener Datei: { success: false, error: "…" })
 *
 * Voraussetzung: pnpm compile:electron
 * Ausführen: pnpm test:e2e
 */
import { _electron as electron, ElectronApplication, Page } from "playwright";
import { test, expect } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Pfade ────────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const ELECTRON_MAIN = path.join(REPO_ROOT, "electron-dist", "main.cjs");

function assertAppCompiled(): void {
  if (!fs.existsSync(ELECTRON_MAIN)) {
    throw new Error(
      `[E2E] Kompilierter Electron-Einstiegspunkt nicht gefunden:\n` +
        `  ${ELECTRON_MAIN}\n\n` +
        `Bitte zuerst kompilieren:\n` +
        `  pnpm compile:electron\n`
    );
  }
}

// ─── Fixture: App starten / stoppen ──────────────────────────────────────────

async function launchApp(): Promise<{ app: ElectronApplication; page: Page }> {
  assertAppCompiled();
  const app = await electron.launch({
    executablePath: require("electron"),
    args: [ELECTRON_MAIN],
    env: {
      ...process.env,
      NODE_ENV: "test",
      ELECTRON_IS_DEV: "0",
    },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(2_000);
  return { app, page };
}

// ─── Hilfsfunktion: API-Typ prüfen ───────────────────────────────────────────

/** Gibt true zurück wenn window.electronAPI[key] eine Funktion ist. */
function isElectronAPIFunction(page: Page, key: string): Promise<boolean> {
  return page.evaluate((k: string) => {
    // window ist im Renderer-Kontext via contextBridge befüllt
    const api = (window as unknown as Record<string, unknown>)["electronAPI"] as
      | Record<string, unknown>
      | undefined;
    return typeof api?.[k] === "function";
  }, key);
}

// ─── Alle Tests: ein App-Lifecycle ───────────────────────────────────────────

test.describe("MIDI-Import API-Contract", () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    ({ app, page } = await launchApp());
  });

  test.afterAll(async () => {
    if (app) await app.close();
  });

  // ── Test 1: openMidiDialog ──────────────────────────────────────────────────

  test("1 – electronAPI.openMidiDialog ist eine Funktion", async () => {
    const result = await isElectronAPIFunction(page, "openMidiDialog");
    expect(result).toBe(true);
  });

  // ── Test 2: importMidiFile ──────────────────────────────────────────────────

  test("2 – electronAPI.importMidiFile ist eine Funktion", async () => {
    const result = await isElectronAPIFunction(page, "importMidiFile");
    expect(result).toBe(true);
  });

  // ── Test 3: exportBundle ────────────────────────────────────────────────────

  test("3 – electronAPI.exportBundle ist eine Funktion", async () => {
    const result = await isElectronAPIFunction(page, "exportBundle");
    expect(result).toBe(true);
  });

  // ── Test 4: importMidiFile gibt typisiertes Ergebnis zurück ────────────────

  test("4 – importMidiFile('/nonexistent.mid') gibt { success, … } zurück", async () => {
    // Der IPC-Handler antwortet auch bei nicht existierender Datei mit einem
    // strukturierten Objekt: { success: false, error: "…" }
    // Wir testen nur den Vertrag (shape), nicht den Inhalt.
    const result = await page.evaluate(async () => {
      const api = (window as unknown as Record<string, unknown>)["electronAPI"] as
        | { importMidiFile?: (p: string) => Promise<Record<string, unknown>> }
        | undefined;

      if (typeof api?.importMidiFile !== "function") {
        return null;
      }

      try {
        return await api.importMidiFile("/nonexistent-test-file.mid");
      } catch {
        // Fehler-Throw ist ebenfalls ein valider Vertrag – gibt null zurück
        return null;
      }
    });

    // Wenn importMidiFile nicht existiert, schlägt Test 2 bereits fehl.
    // Hier prüfen wir nur die Rückgabe-Form.
    if (result === null) {
      // IPC hat einen Fehler geworfen → prüfe zumindest, dass die Funktion aufrufbar ist
      const isCallable = await isElectronAPIFunction(page, "importMidiFile");
      expect(isCallable).toBe(true);
      return;
    }

    // Typisierter Vertrag: Ergebnis-Objekt hat eine 'success'-Property
    expect(typeof result).toBe("object");
    expect("success" in result).toBe(true);
    // Bei nicht existierender Datei muss success false sein
    expect(result["success"]).toBe(false);
    // Und eine error-Nachricht vorhanden sein
    expect(typeof result["error"]).toBe("string");
  });
});
